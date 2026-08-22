$ErrorActionPreference = "Stop"

$RelayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeRoot = Join-Path $RelayRoot "runtime"
$NodePath = Join-Path $RuntimeRoot "node.exe"
$NpmPath = Join-Path $RuntimeRoot "npm.cmd"
$InstallerPath = Join-Path $PSScriptRoot "install-relay.ps1"

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Paquet Mon Cahier Relay incomplet : runtime\\node.exe est introuvable."
}
if (-not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) {
    throw "Paquet Mon Cahier Relay incomplet : runtime\\npm.cmd est introuvable."
}
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Paquet Mon Cahier Relay incomplet : install-relay.ps1 est introuvable."
}

$env:PATH = "$RuntimeRoot;$env:PATH"
$env:MONCAHIER_RELAY_PACKAGED = "1"

& $InstallerPath -Elevated
