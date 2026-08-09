param([switch]$Elevated)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

function Show-Info([string]$Message, [string]$Title = "Mon Cahier Relay") {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

function Stop-RelayListener([int]$Port) {
    $Listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($Listener in $Listeners) {
        if ($Listener.OwningProcess -and $Listener.OwningProcess -ne $PID) {
            Stop-Process -Id $Listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 800
}

try {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    $IsAdministrator = $Principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    if (-not $IsAdministrator) {
        $QuotedScript = '"' + $PSCommandPath + '"'
        Start-Process powershell.exe `
            -Verb RunAs `
            -ArgumentList @(
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", $QuotedScript,
                "-Elevated"
            )
        exit 0
    }

    $RelayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $PackagePath = Join-Path $RelayRoot "package.json"
    $ConfigPath = Join-Path $env:LOCALAPPDATA "MonCahier\Relay\config.json"
    $CliPath = Join-Path $RelayRoot "dist\src\cli.mjs"

    if (-not (Test-Path $PackagePath)) {
        throw "Le dossier de mise à jour est incomplet : package.json est introuvable."
    }
    if (-not (Test-Path $ConfigPath)) {
        throw "Aucun relais déjà configuré n'a été trouvé. Utilisez d'abord Installer-Mon-Cahier.cmd."
    }

    $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $NodeCommand -or -not $NpmCommand) {
        throw "Node.js n'est pas installé. Installez Node.js 20 à 26 puis relancez la mise à jour."
    }

    $NodeVersion = (& $NodeCommand.Source --version).TrimStart("v")
    $NodeMajor = [int]($NodeVersion.Split(".")[0])
    if ($NodeMajor -lt 20 -or $NodeMajor -gt 26) {
        throw "Version Node.js incompatible : $NodeVersion. Utilisez une version comprise entre 20 et 26."
    }

    $ExistingConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $Port = if ($ExistingConfig.port) { [int]$ExistingConfig.port } else { 4317 }
    $DatabasePath = [string]$ExistingConfig.database_path
    if (-not $DatabasePath) {
        $DatabasePath = Join-Path (Split-Path $ConfigPath -Parent) "data\moncahier-relay.db"
    }

    Push-Location $RelayRoot
    try {
        $DependenciesMissing =
            -not (Test-Path (Join-Path $RelayRoot "node_modules\better-sqlite3")) -or
            -not (Test-Path (Join-Path $RelayRoot "node_modules\.bin\tsc.cmd"))
        if ($DependenciesMissing) {
            & $NpmCommand.Source ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "L'installation des composants du relais a échoué." }
        }
        & $NpmCommand.Source run build
        if ($LASTEXITCODE -ne 0) { throw "La construction de la nouvelle version du relais a échoué." }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $CliPath)) {
        throw "La nouvelle version du relais n'a pas produit dist\src\cli.mjs."
    }

    Stop-RelayListener $Port

    $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupRoot = Join-Path $env:LOCALAPPDATA "MonCahier\Relay\backups\update-$Timestamp"
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    Copy-Item $ConfigPath (Join-Path $BackupRoot "config.json") -Force
    foreach ($Candidate in @($DatabasePath, "$DatabasePath-wal", "$DatabasePath-shm")) {
        if (Test-Path $Candidate) {
            Copy-Item $Candidate (Join-Path $BackupRoot (Split-Path $Candidate -Leaf)) -Force
        }
    }

    [Environment]::SetEnvironmentVariable("MONCAHIER_RELAY_CONFIG", $ConfigPath, "User")
    $env:MONCAHIER_RELAY_CONFIG = $ConfigPath

    # La tâche SYSTEM démarre avant toute connexion utilisateur et est recréée
    # pour pointer vers cette version du relais.
    & (Join-Path $PSScriptRoot "install-startup-task.ps1") `
        -RelayRoot $RelayRoot `
        -ConfigPath $ConfigPath `
        -NodePath $NodeCommand.Source | Out-Null
    Start-ScheduledTask -TaskName "Mon Cahier Relay"

    $Health = $null
    for ($Attempt = 0; $Attempt -lt 15; $Attempt++) {
        Start-Sleep -Seconds 1
        try {
            $Health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($Health.ok) { break }
        } catch {
            $Health = $null
        }
    }

    if (-not $Health -or -not $Health.ok) {
        throw "Le relais mis à jour n'a pas répondu. La sauvegarde se trouve dans : $BackupRoot"
    }
    if ([int]$Health.schema_version -lt 8) {
        throw "Le relais répond, mais la base n'a pas atteint le schéma 8. Schéma détecté : $($Health.schema_version). Sauvegarde : $BackupRoot"
    }
    if (-not $Health.capabilities.bootstrap_revision_ack_v1) {
        throw "Le relais lancé n'est pas la nouvelle version attendue. Vérifiez qu'aucun ancien dossier ne redémarre le port $Port."
    }

    Show-Info(
        "Mise à jour terminée avec succès.`n`n" +
        "Version relais : $($Health.relay_version)`n" +
        "Schéma de base : $($Health.schema_version)`n" +
        "Port : $Port`n`n" +
        "Une sauvegarde de sécurité a été créée dans :`n$BackupRoot`n`n" +
        "Retournez dans Mon Cahier puis cliquez sur Tester et synchroniser."
    )
    exit 0
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        "Mise à jour Mon Cahier Relay",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    Write-Error $_.Exception.Message
    exit 1
}
