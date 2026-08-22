param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$ReleaseLabel = "Rentree-2026-2027",
    [string]$CertifiedRelaySha = "",
    [string]$PackageSourceSha = $env:GITHUB_SHA
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Copy-RequiredPath {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Packaging incomplet : chemin introuvable : $Source"
    }

    $Parent = Split-Path -Parent $Destination
    if ($Parent) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$RelayRoot = (Resolve-Path -LiteralPath (Join-Path $RepositoryRoot "desktop\relay")).Path

if ([string]::IsNullOrWhiteSpace($CertifiedRelaySha)) {
    $CertifiedRelaySha = if ($PackageSourceSha) { $PackageSourceSha } else { "local" }
}

$CertifiedShortSha = if ($CertifiedRelaySha.Length -ge 8) {
    $CertifiedRelaySha.Substring(0, 8)
} else {
    $CertifiedRelaySha
}

$PackageSourceSha = if ([string]::IsNullOrWhiteSpace($PackageSourceSha)) {
    "local"
} else {
    $PackageSourceSha
}

$ArtifactBaseName = "Mon-Cahier-Relay-$ReleaseLabel-$CertifiedShortSha"
$TempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$WorkRoot = Join-Path $TempBase ("moncahier-relay-package-" + [guid]::NewGuid().ToString("N"))
$PayloadRoot = Join-Path $WorkRoot "payload"
$SfxRoot = Join-Path $WorkRoot "sfx"

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $PayloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $SfxRoot -Force | Out-Null

try {
    $RequiredRelayFiles = @(
        "package.json",
        "package-lock.json",
        "tsconfig.json"
    )
    foreach ($Name in $RequiredRelayFiles) {
        Copy-RequiredPath `
            -Source (Join-Path $RelayRoot $Name) `
            -Destination (Join-Path $PayloadRoot $Name)
    }

    $RequiredRelayDirectories = @(
        "src",
        "scripts",
        "migrations",
        "protocol",
        "windows",
        "dist",
        "node_modules"
    )
    foreach ($Name in $RequiredRelayDirectories) {
        Copy-RequiredPath `
            -Source (Join-Path $RelayRoot $Name) `
            -Destination (Join-Path $PayloadRoot $Name)
    }

    $CliPath = Join-Path $PayloadRoot "dist\src\cli.mjs"
    $SqliteModulePath = Join-Path $PayloadRoot "node_modules\better-sqlite3"
    $TscPath = Join-Path $PayloadRoot "node_modules\.bin\tsc.cmd"
    foreach ($RequiredPath in @($CliPath, $SqliteModulePath, $TscPath)) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            throw "Packaging incomplet : composant obligatoire absent : $RequiredPath"
        }
    }

    $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $NodeHome = Split-Path -Parent $NodeExe
    $BundledNodeHome = Join-Path $PayloadRoot "runtime\node"
    New-Item -ItemType Directory -Path $BundledNodeHome -Force | Out-Null
    Copy-Item -Path (Join-Path $NodeHome "*") -Destination $BundledNodeHome -Recurse -Force

    foreach ($RequiredRuntimePath in @(
        (Join-Path $BundledNodeHome "node.exe"),
        (Join-Path $BundledNodeHome "npm.cmd")
    )) {
        if (-not (Test-Path -LiteralPath $RequiredRuntimePath)) {
            throw "Runtime Node embarqué incomplet : $RequiredRuntimePath"
        }
    }

    $RelayPackage = Get-Content -LiteralPath (Join-Path $RelayRoot "package.json") -Raw | ConvertFrom-Json
    $ReleaseMetadata = [ordered]@{
        product = "Mon Cahier Relay"
        release_label = $ReleaseLabel
        relay_version = [string]$RelayPackage.version
        certified_relay_sha = $CertifiedRelaySha
        package_source_sha = $PackageSourceSha
        node_version = (& $NodeExe --version).Trim()
        architecture = $env:PROCESSOR_ARCHITECTURE
        built_at_utc = [DateTime]::UtcNow.ToString("o")
        schema_required = 9
        port = 4317
        discovery = "Windows native mDNS / <machine-hostname>.local"
    }
    $ReleaseMetadata |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath (Join-Path $PayloadRoot "RELEASE.json") -Encoding UTF8

    $PayloadZip = Join-Path $SfxRoot "relay-payload.zip"
    Compress-Archive -Path (Join-Path $PayloadRoot "*") -DestinationPath $PayloadZip -CompressionLevel Optimal -Force

    $BootstrapTemplate = @'
param([switch]$Elevated)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Error([string]$Message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        "Installation Mon Cahier Relay",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

try {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object System.Security.Principal.WindowsPrincipal($Identity)
    $IsAdministrator = $Principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )

    if (-not $IsAdministrator) {
        $Arguments = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", ('"' + $PSCommandPath + '"'),
            "-Elevated"
        )
        $ElevatedProcess = Start-Process powershell.exe `
            -Verb RunAs `
            -ArgumentList $Arguments `
            -Wait `
            -PassThru
        exit $ElevatedProcess.ExitCode
    }

    $PayloadZip = Join-Path $PSScriptRoot "relay-payload.zip"
    if (-not (Test-Path -LiteralPath $PayloadZip -PathType Leaf)) {
        throw "Le paquet Mon Cahier Relay est incomplet : relay-payload.zip est introuvable."
    }

    $InstallBase = Join-Path $env:ProgramData "MonCahier\RelayApp\versions"
    New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null

    $InstallId = "__INSTALL_ID__-" + (Get-Date -Format "yyyyMMddHHmmss")
    $InstallRoot = Join-Path $InstallBase $InstallId
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Expand-Archive -LiteralPath $PayloadZip -DestinationPath $InstallRoot -Force

    $BundledNodeHome = Join-Path $InstallRoot "runtime\node"
    $BundledNode = Join-Path $BundledNodeHome "node.exe"
    $BundledNpm = Join-Path $BundledNodeHome "npm.cmd"
    $Installer = Join-Path $InstallRoot "windows\install-relay.ps1"

    foreach ($RequiredPath in @($BundledNode, $BundledNpm, $Installer)) {
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Installation impossible : composant embarqué absent : $RequiredPath"
        }
    }

    # Le script d'installation existant est réutilisé tel quel. On lui fournit simplement
    # le runtime Node/npm certifié et stocké dans un chemin stable sous ProgramData.
    $env:PATH = "$BundledNodeHome;$env:PATH"
    [Environment]::SetEnvironmentVariable(
        "MONCAHIER_RELAY_PACKAGE_ROOT",
        $InstallRoot,
        "Process"
    )

    $PointerDirectory = Join-Path $env:ProgramData "MonCahier\RelayApp"
    New-Item -ItemType Directory -Path $PointerDirectory -Force | Out-Null
    Set-Content `
        -LiteralPath (Join-Path $PointerDirectory "latest-install.txt") `
        -Value $InstallRoot `
        -Encoding UTF8

    & $Installer -Elevated
    exit $LASTEXITCODE
}
catch {
    Show-Error $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
'@

    $InstallId = "$ReleaseLabel-$CertifiedShortSha"
    $Bootstrap = $BootstrapTemplate.Replace("__INSTALL_ID__", $InstallId)
    $BootstrapPath = Join-Path $SfxRoot "bootstrap.ps1"
    Set-Content -LiteralPath $BootstrapPath -Value $Bootstrap -Encoding UTF8

    $Launcher = @"
@echo off
setlocal
title Installation Mon Cahier Relay - $ReleaseLabel
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
if errorlevel 1 pause
endlocal
"@
    $LauncherPath = Join-Path $SfxRoot "Installer-Mon-Cahier.cmd"
    Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII

    $Readme = @"
MON CAHIER RELAY - $ReleaseLabel
================================

Version interne du relais : $($RelayPackage.version)
Source relais certifiée   : $CertifiedRelaySha
Port local                 : 4317
Découverte recommandée     : nom-du-PC.local (mDNS Windows natif)
Schéma SQLite requis       : 9

INSTALLATION
------------
1. Double-cliquer sur Installer-Mon-Cahier.cmd (pack ZIP), ou lancer l'EXE autonome.
2. Accepter l'élévation Administrateur Windows.
3. Saisir le code établissement et le nom de l'établissement.
4. Si le réseau est bien celui de l'école, accepter le passage du profil réseau en Privé.
5. Coller le jeton Admin dans Mon Cahier quand l'assistant ouvre les paramètres.
6. Cliquer sur Tester et synchroniser.

Le relais est installé dans C:\ProgramData\MonCahier\RelayApp\versions.
La tâche planifiée "Mon Cahier Relay" démarre le service automatiquement sous SYSTEM au boot.

IMPORTANT
---------
L'EXE n'est pas signé par un certificat de signature de code : Windows SmartScreen peut afficher
un avertissement lors du premier lancement. Vérifier le SHA-256 fourni avec le paquet.
"@
    Set-Content -LiteralPath (Join-Path $SfxRoot "LISEZ-MOI.txt") -Value $Readme -Encoding UTF8

    $PortableZip = Join-Path $OutputDirectory "$ArtifactBaseName.zip"
    Compress-Archive -Path (Join-Path $SfxRoot "*") -DestinationPath $PortableZip -CompressionLevel Optimal -Force

    $IExpress = Join-Path $env:WINDIR "System32\iexpress.exe"
    if (-not (Test-Path -LiteralPath $IExpress -PathType Leaf)) {
        throw "IExpress est introuvable sur ce runner Windows."
    }

    $ExePath = Join-Path $OutputDirectory "$ArtifactBaseName.exe"
    $SedPath = Join-Path $WorkRoot "MonCahierRelay.sed"
    $SfxSource = $SfxRoot.TrimEnd("\") + "\"
    $Sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$ExePath
FriendlyName=Mon Cahier Relay - $ReleaseLabel
AppLaunched=cmd.exe /c Installer-Mon-Cahier.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[SourceFiles]
SourceFiles0=$SfxSource

[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=

[Strings]
FILE0="Installer-Mon-Cahier.cmd"
FILE1="bootstrap.ps1"
FILE2="relay-payload.zip"
FILE3="LISEZ-MOI.txt"
"@
    Set-Content -LiteralPath $SedPath -Value $Sed -Encoding ASCII

    & $IExpress /N $SedPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
        throw "La création de l'EXE autonome Mon Cahier Relay a échoué."
    }

    $Hashes = @(
        Get-FileHash -LiteralPath $ExePath -Algorithm SHA256
        Get-FileHash -LiteralPath $PortableZip -Algorithm SHA256
    )
    $HashLines = $Hashes | ForEach-Object {
        "$($_.Hash.ToLowerInvariant())  $(Split-Path -Leaf $_.Path)"
    }
    $HashPath = Join-Path $OutputDirectory "SHA256SUMS.txt"
    Set-Content -LiteralPath $HashPath -Value $HashLines -Encoding ASCII

    Write-Host "=== MON CAHIER RELAY WINDOWS PACKAGE ===" -ForegroundColor Green
    Write-Host "Certified relay : $CertifiedRelaySha"
    Write-Host "EXE             : $ExePath"
    Write-Host "ZIP             : $PortableZip"
    Write-Host "SHA256          : $HashPath"
}
finally {
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
}
