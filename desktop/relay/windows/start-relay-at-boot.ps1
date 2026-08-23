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
$ErrorLogPath = Join-Path $LogDirectory "relay-error.log"

# Windows PowerShell 5.1 transforme parfois stderr d'une commande native en
# NativeCommandError lorsque $ErrorActionPreference vaut Stop. Or le relais
# utilise stderr pour des avertissements non fatals (par exemple un mDNS
# temporairement indisponible) et doit continuer à servir l'API locale.
# Start-Process sépare donc stdout/stderr sans interpréter stderr comme une
# exception PowerShell. Le code de sortie réel de Node reste celui de la tâche.
$Process = Start-Process `
    -FilePath $ResolvedNodePath `
    -ArgumentList @($CliPath, "serve") `
    -WorkingDirectory $ResolvedRelayRoot `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError $ErrorLogPath `
    -NoNewWindow `
    -PassThru `
    -Wait

exit [int]$Process.ExitCode
