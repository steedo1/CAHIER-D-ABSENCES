param(
    [Parameter(Mandatory = $true)][string]$RelayRoot,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$NodePath
)

$ErrorActionPreference = "Stop"
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "La création de la tâche de démarrage exige une console Administrateur."
}

$ResolvedRelayRoot = (Resolve-Path -LiteralPath $RelayRoot).Path
$ResolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$ResolvedNodePath = (Resolve-Path -LiteralPath $NodePath).Path
$RunnerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "start-relay-at-boot.ps1")).Path
$RelayDataRoot = Split-Path $ResolvedConfigPath -Parent
$LogDirectory = Join-Path (Split-Path $ResolvedConfigPath -Parent) "logs"

# SYSTEM doit pouvoir relire la configuration et écrire la base/journal après un redémarrage
# sans ouverture de session utilisateur.
& icacls.exe $RelayDataRoot /grant:r "SYSTEM:(OI)(CI)(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Impossible d'accorder à SYSTEM l'accès aux données du relais." }

function Quote-TaskArgument([string]$Value) {
    return '"' + $Value.Replace('"', '""') + '"'
}

$Arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-TaskArgument $RunnerPath),
    "-RelayRoot", (Quote-TaskArgument $ResolvedRelayRoot),
    "-ConfigPath", (Quote-TaskArgument $ResolvedConfigPath),
    "-NodePath", (Quote-TaskArgument $ResolvedNodePath),
    "-LogDirectory", (Quote-TaskArgument $LogDirectory)
) -join " "

$Action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $Arguments
$Trigger = New-ScheduledTaskTrigger -AtStartup
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName "Mon Cahier Relay" `
    -Description "Démarre le relais local Mon Cahier au boot, avant toute connexion utilisateur." `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $TaskPrincipal `
    -Settings $Settings `
    -Force | Out-Null

# Supprime l'ancien mécanisme limité à l'ouverture de session, qui créerait un second processus.
$StartupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Mon Cahier Relay.lnk"
if (Test-Path -LiteralPath $StartupShortcut) {
    Remove-Item -LiteralPath $StartupShortcut -Force
}

Get-ScheduledTask -TaskName "Mon Cahier Relay"
