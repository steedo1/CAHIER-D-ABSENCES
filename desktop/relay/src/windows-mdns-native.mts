import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { join } from "node:path";
import {
  RELAY_MDNS_IPV4_GROUP,
  RELAY_MDNS_PORT,
  RELAY_MDNS_SERVICE_TYPE,
  normalizeRelayMdnsHostname,
  relayMdnsFqdn,
  relayMdnsIpv4Addresses,
  relayMdnsUrl,
  type RelayMdnsAnnouncer,
} from "./mdns.mjs";

const WINDOWS_MDNS_READY_TIMEOUT_MS = 12_000;
const WINDOWS_MDNS_STOP_TIMEOUT_MS = 2_000;

export type RelayMdnsStartInput = {
  hostname: string;
  port: number;
  institutionCode?: string | null | undefined;
  refreshIntervalMs?: number;
  log?: (message: string) => void;
};

/**
 * Windows 10+ possède déjà son moteur mDNS dans le service DNS Client.
 * On l'utilise via DnsServiceRegister au lieu d'ouvrir nous-mêmes UDP/5353,
 * ce qui évite la concurrence observée avec Dnscache sur Windows.
 */
export const WINDOWS_NATIVE_MDNS_POWERSHELL = String.raw`
$ErrorActionPreference = "Stop"

$Hostname = [string]$env:MONCAHIER_MDNS_HOSTNAME
$InstitutionCode = [string]$env:MONCAHIER_MDNS_INSTITUTION_CODE
$PortText = [string]$env:MONCAHIER_MDNS_PORT

if ([string]::IsNullOrWhiteSpace($Hostname)) { throw "moncahier_mdns_hostname_required" }
$Port = 0
if (-not [int]::TryParse($PortText, [ref]$Port) -or $Port -lt 1 -or $Port -gt 65535) {
  throw "moncahier_mdns_port_invalid"
}

$ServiceLabel = "Mon Cahier Relay"
if (-not [string]::IsNullOrWhiteSpace($InstitutionCode)) {
  $ServiceLabel = "$ServiceLabel $($InstitutionCode.Trim().ToUpperInvariant())"
}
$ServiceName = "$ServiceLabel._moncahier._tcp.local"
$HostFqdn = "$Hostname.local"

$NativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class MonCahierNativeMdns
{
    private const uint DNS_QUERY_REQUEST_VERSION1 = 1;
    private const uint DNS_REQUEST_PENDING = 9506;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void DnsServiceRegisterComplete(
        uint status,
        IntPtr queryContext,
        IntPtr instance
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct DnsServiceRegisterRequest
    {
        public uint Version;
        public uint InterfaceIndex;
        public IntPtr ServiceInstance;
        public IntPtr RegisterCompletionCallback;
        public IntPtr QueryContext;
        public IntPtr Credentials;
        [MarshalAs(UnmanagedType.Bool)] public bool UnicastEnabled;
    }

    [DllImport("dnsapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr DnsServiceConstructInstance(
        string serviceName,
        string hostName,
        IntPtr ipv4,
        IntPtr ipv6,
        ushort port,
        ushort priority,
        ushort weight,
        uint propertyCount,
        IntPtr keys,
        IntPtr values
    );

    [DllImport("dnsapi.dll", SetLastError = true)]
    private static extern uint DnsServiceRegister(
        ref DnsServiceRegisterRequest request,
        IntPtr cancel
    );

    [DllImport("dnsapi.dll", SetLastError = true)]
    private static extern uint DnsServiceDeRegister(
        ref DnsServiceRegisterRequest request,
        IntPtr cancel
    );

    [DllImport("dnsapi.dll")]
    private static extern void DnsServiceFreeInstance(IntPtr instance);

    private static readonly ManualResetEventSlim Completion = new ManualResetEventSlim(false);
    private static readonly DnsServiceRegisterComplete Callback = OnComplete;
    private static DnsServiceRegisterRequest Request;
    private static IntPtr Instance = IntPtr.Zero;
    private static uint CompletionStatus = UInt32.MaxValue;
    private static bool Registered;

    private static void OnComplete(uint status, IntPtr queryContext, IntPtr instance)
    {
        CompletionStatus = status;
        if (instance != IntPtr.Zero)
        {
            DnsServiceFreeInstance(instance);
        }
        Completion.Set();
    }

    public static void Start(string serviceName, string hostName, ushort port)
    {
        if (Registered) return;

        Instance = DnsServiceConstructInstance(
            serviceName,
            hostName,
            IntPtr.Zero,
            IntPtr.Zero,
            port,
            0,
            0,
            0,
            IntPtr.Zero,
            IntPtr.Zero
        );
        if (Instance == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "DnsServiceConstructInstance failed: " + Marshal.GetLastWin32Error()
            );
        }

        Completion.Reset();
        CompletionStatus = UInt32.MaxValue;
        Request = new DnsServiceRegisterRequest
        {
            Version = DNS_QUERY_REQUEST_VERSION1,
            InterfaceIndex = 0,
            ServiceInstance = Instance,
            RegisterCompletionCallback = Marshal.GetFunctionPointerForDelegate(Callback),
            QueryContext = IntPtr.Zero,
            Credentials = IntPtr.Zero,
            UnicastEnabled = false
        };

        uint result = DnsServiceRegister(ref Request, IntPtr.Zero);
        if (result != DNS_REQUEST_PENDING)
        {
            FreeOriginalInstance();
            throw new InvalidOperationException("DnsServiceRegister failed: " + result);
        }
        if (!Completion.Wait(TimeSpan.FromSeconds(8)))
        {
            throw new TimeoutException("DnsServiceRegister callback timeout");
        }
        if (CompletionStatus != 0)
        {
            FreeOriginalInstance();
            throw new InvalidOperationException(
                "DnsServiceRegister callback failed: " + CompletionStatus
            );
        }

        Registered = true;
    }

    public static void Stop()
    {
        if (!Registered)
        {
            FreeOriginalInstance();
            return;
        }

        Completion.Reset();
        CompletionStatus = UInt32.MaxValue;
        uint result = DnsServiceDeRegister(ref Request, IntPtr.Zero);
        if (result == DNS_REQUEST_PENDING)
        {
            Completion.Wait(TimeSpan.FromSeconds(3));
        }
        Registered = false;
        FreeOriginalInstance();
    }

    private static void FreeOriginalInstance()
    {
        if (Instance == IntPtr.Zero) return;
        DnsServiceFreeInstance(Instance);
        Instance = IntPtr.Zero;
    }
}
'@

Add-Type -TypeDefinition $NativeSource -Language CSharp
[MonCahierNativeMdns]::Start($ServiceName, $HostFqdn, [uint16]$Port)

[pscustomobject]@{
  event = "ready"
  hostname = $Hostname
  fqdn = "$HostFqdn."
  service = $ServiceName
  port = $Port
  provider = "windows-dnsapi"
} | ConvertTo-Json -Compress
[Console]::Out.Flush()

try {
  while ($true) { Start-Sleep -Seconds 60 }
}
finally {
  [MonCahierNativeMdns]::Stop()
}
`;

function powerShellExecutable() {
  const root = String(process.env.SystemRoot || process.env.WINDIR || "").trim();
  return root
    ? join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export function shouldUseWindowsNativeMdns(platform = process.platform) {
  return platform === "win32";
}

export function encodeWindowsNativeMdnsPowerShell(source = WINDOWS_NATIVE_MDNS_POWERSHELL) {
  return Buffer.from(source, "utf16le").toString("base64");
}

export function windowsNativeMdnsPowerShellArguments(
  encodedCommand = encodeWindowsNativeMdnsPowerShell(),
) {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-OutputFormat",
    "Text",
    "-EncodedCommand",
    encodedCommand,
  ];
}

function linesFrom(
  stream: Readable,
  onLine: (line: string) => void,
) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on("end", () => {
    const line = buffer.replace(/\r$/, "").trim();
    if (line) onLine(line);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function startWindowsNativeRelayMdns(
  input: RelayMdnsStartInput,
): Promise<RelayMdnsAnnouncer> {
  const hostname = normalizeRelayMdnsHostname(input.hostname);
  const log = input.log || (() => undefined);
  const encodedCommand = encodeWindowsNativeMdnsPowerShell();
  const child = spawn(
    powerShellExecutable(),
    windowsNativeMdnsPowerShellArguments(encodedCommand),
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MONCAHIER_MDNS_HOSTNAME: hostname,
        MONCAHIER_MDNS_PORT: String(input.port),
        MONCAHIER_MDNS_INSTITUTION_CODE: String(input.institutionCode || ""),
      },
    },
  );

  let ready = false;
  let stderrTail = "";
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  linesFrom(child.stdout, (line) => {
    try {
      const event = JSON.parse(line) as { event?: unknown; provider?: unknown };
      if (event.event === "ready" && event.provider === "windows-dnsapi") {
        ready = true;
        resolveReady();
        return;
      }
    } catch {
      // Les autres lignes PowerShell sont simplement journalisées.
    }
    log(`mDNS Windows: ${line}`);
  });

  linesFrom(child.stderr, (line) => {
    stderrTail = `${stderrTail}\n${line}`.trim().slice(-2_000);
    log(`mDNS Windows: ${line}`);
  });

  child.once("error", (error) => {
    if (!ready) rejectReady(error);
    else log(`mDNS Windows: processus natif indisponible (${error.message}).`);
  });
  child.once("exit", (code, signal) => {
    if (!ready) {
      rejectReady(new Error(
        `windows_mdns_native_exited:${code ?? "null"}:${signal ?? "none"}:${stderrTail || "no_stderr"}`,
      ));
      return;
    }
    log(`mDNS Windows: annonce native arrêtée (${code ?? signal ?? "unknown"}).`);
  });

  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      readyPromise,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("windows_mdns_native_ready_timeout")),
          WINDOWS_MDNS_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  return {
    status() {
      return {
        enabled: true,
        hostname,
        fqdn: relayMdnsFqdn(hostname),
        url: relayMdnsUrl(hostname, input.port),
        service_type: RELAY_MDNS_SERVICE_TYPE,
        addresses: relayMdnsIpv4Addresses(),
        multicast_address: RELAY_MDNS_IPV4_GROUP,
        multicast_port: RELAY_MDNS_PORT,
      };
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await waitForExit(child, WINDOWS_MDNS_STOP_TIMEOUT_MS);
    },
  };
}
