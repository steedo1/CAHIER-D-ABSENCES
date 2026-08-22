param(
    [Parameter(Mandatory = $true)][string]$PortableZip,
    [Parameter(Mandatory = $true)][string]$OutputExe
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PortableZip = (Resolve-Path -LiteralPath $PortableZip).Path
$OutputDirectory = Split-Path -Parent $OutputExe
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$CompilerCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$Compiler = $CompilerCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if (-not $Compiler) {
    throw "Compilateur .NET Framework csc.exe introuvable."
}

$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moncahier-sfx-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

try {
    $SourcePath = Join-Path $TempRoot "MonCahierRelaySetup.cs"
    $Source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        string tempRoot = Path.Combine(
            Path.GetTempPath(),
            "MonCahierRelaySetup-" + Guid.NewGuid().ToString("N")
        );

        try
        {
            Directory.CreateDirectory(tempRoot);
            string zipPath = Path.Combine(tempRoot, "package.zip");
            string extractRoot = Path.Combine(tempRoot, "package");
            Directory.CreateDirectory(extractRoot);

            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream input = assembly.GetManifestResourceStream("MonCahierRelay.Package"))
            {
                if (input == null)
                {
                    throw new InvalidOperationException("Payload Mon Cahier Relay introuvable dans l'EXE.");
                }

                using (FileStream output = File.Create(zipPath))
                {
                    input.CopyTo(output);
                }
            }

            ZipFile.ExtractToDirectory(zipPath, extractRoot);
            string bootstrap = Path.Combine(extractRoot, "bootstrap.ps1");
            if (!File.Exists(bootstrap))
            {
                throw new FileNotFoundException("bootstrap.ps1 absent du paquet Mon Cahier Relay.", bootstrap);
            }

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = "powershell.exe";
            start.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + bootstrap + "\"";
            start.WorkingDirectory = extractRoot;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;

            using (Process process = Process.Start(start))
            {
                if (process == null)
                {
                    throw new InvalidOperationException("Impossible de lancer l'assistant Mon Cahier Relay.");
                }
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            try
            {
                System.Windows.Forms.MessageBox.Show(
                    ex.Message,
                    "Installation Mon Cahier Relay",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error
                );
            }
            catch { }
            return 1;
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
            catch { }
        }
    }
}
'@
    Set-Content -LiteralPath $SourcePath -Value $Source -Encoding UTF8

    $References = @(
        "/reference:System.dll",
        "/reference:System.Windows.Forms.dll",
        "/reference:System.IO.Compression.dll",
        "/reference:System.IO.Compression.FileSystem.dll"
    )

    $Arguments = @(
        "/nologo",
        "/target:winexe",
        "/platform:anycpu",
        "/optimize+",
        "/out:$OutputExe",
        "/resource:$PortableZip,MonCahierRelay.Package"
    ) + $References + @($SourcePath)

    & $Compiler @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "La compilation du lanceur .NET Mon Cahier Relay a échoué."
    }

    if (-not (Test-Path -LiteralPath $OutputExe -PathType Leaf)) {
        throw "L'EXE .NET attendu n'a pas été produit."
    }

    if ((Get-Item -LiteralPath $OutputExe).Length -le (Get-Item -LiteralPath $PortableZip).Length) {
        throw "L'EXE produit semble ne pas contenir le payload ZIP."
    }

    Write-Host "SFX .NET : PASS -> $OutputExe" -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
