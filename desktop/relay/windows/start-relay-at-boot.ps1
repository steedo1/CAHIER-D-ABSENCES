param(
    [Parameter(Mandatory = $true)][string]$RelayRoot,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$LogDirectory
)

$ErrorActionPreference = "Stop"
$ResolvedRelayRoot = (Resolve-Path -LiteralPath $RelayRoot).Path
$ResolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$ResolvedNodePath = (Resolve-Path -LiteralPath $NodePath).Path
$CliPath = Join-Path $ResolvedRelayRoot "dist\src\cli.mjs"
if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw "Relais incomplet : dist\src\cli.mjs est introuvable."
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$env:MONCAHIER_RELAY_CONFIG = $ResolvedConfigPath
$env:MONCAHIER_RELAY_LOG_DIR = $LogDirectory
Set-Location -LiteralPath $ResolvedRelayRoot

$LogPath = Join-Path $LogDirectory "relay.log"
& $ResolvedNodePath $CliPath serve *>> $LogPath
exit $LASTEXITCODE
