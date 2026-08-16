import assert from "node:assert/strict";
import { test } from "node:test";
import { relayDiscoveryHostname } from "../src/discovery.mjs";
import {
  WINDOWS_NATIVE_MDNS_POWERSHELL,
  encodeWindowsNativeMdnsPowerShell,
  shouldUseWindowsNativeMdns,
  windowsNativeMdnsPowerShellArguments,
} from "../src/windows-mdns-native.mjs";

test("LAN Windows: la découverte choisit l'API DNS-SD native uniquement sur win32", () => {
  assert.equal(shouldUseWindowsNativeMdns("win32"), true);
  assert.equal(shouldUseWindowsNativeMdns("linux"), false);
  assert.equal(shouldUseWindowsNativeMdns("darwin"), false);
});

test("LAN Windows: l'annonce native utilise DnsServiceRegister en mDNS", () => {
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /DnsServiceConstructInstance/);
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /DnsServiceRegister\(/);
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /UnicastEnabled = false/);
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /_moncahier\._tcp\.local/);
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /provider = "windows-dnsapi"/);
});

test("LAN Windows: la commande PowerShell encodée reste fidèle à la source UTF-16LE", () => {
  const encoded = encodeWindowsNativeMdnsPowerShell();
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(decoded, WINDOWS_NATIVE_MDNS_POWERSHELL);
});

test("LAN Windows: force la sortie PowerShell en texte pour éviter le bruit CLIXML", () => {
  const args = windowsNativeMdnsPowerShellArguments("encoded-command");
  const outputFormatIndex = args.indexOf("-OutputFormat");
  assert.notEqual(outputFormatIndex, -1);
  assert.equal(args[outputFormatIndex + 1], "Text");
  assert.equal(args.at(-2), "-EncodedCommand");
  assert.equal(args.at(-1), "encoded-command");
});

test("LAN Windows: utilise le vrai hostname de la machine au lieu d'un alias .local artificiel", () => {
  assert.equal(
    relayDiscoveryHostname("moncahier-relay-lma-000101", "win32", "LAPTOP-2SRLI1BS"),
    "laptop-2srli1bs",
  );
  assert.equal(
    relayDiscoveryHostname("moncahier-relay-lma-000101", "linux", "LAPTOP-2SRLI1BS"),
    "moncahier-relay-lma-000101",
  );
});

test("LAN Windows: le service DNS-SD pointe vers le FQDN .local du PC", () => {
  assert.match(WINDOWS_NATIVE_MDNS_POWERSHELL, /\$HostFqdn = "\$Hostname\.local"/);
  assert.match(
    WINDOWS_NATIVE_MDNS_POWERSHELL,
    /Start\(\$ServiceName, \$HostFqdn, \[uint16\]\$Port\)/,
  );
});
