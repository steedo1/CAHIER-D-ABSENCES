param([switch]$Elevated)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

function Show-Info([string]$Message, [string]$Title = "Mon Cahier Relay") {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

function Show-Question([string]$Message, [string]$Title = "Mon Cahier Relay") {
    return [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    ) -eq [System.Windows.Forms.DialogResult]::Yes
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
    $CliPath = Join-Path $RelayRoot "dist\src\cli.mjs"
    $PackagePath = Join-Path $RelayRoot "package.json"
    $ConfigPath = Join-Path $env:LOCALAPPDATA "MonCahier\Relay\config.json"

    if (-not (Test-Path $PackagePath)) {
        throw "Le dossier du relais est incomplet : package.json est introuvable."
    }

    $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $NodeCommand -or -not $NpmCommand) {
        throw "Node.js n'est pas installé. Installez Node.js 20 à 26 puis relancez cet assistant."
    }

    $NodeVersion = (& $NodeCommand.Source --version).TrimStart("v")
    $NodeMajor = [int]($NodeVersion.Split(".")[0])
    if ($NodeMajor -lt 20 -or $NodeMajor -gt 26) {
        throw "Version Node.js incompatible : $NodeVersion. Utilisez une version comprise entre 20 et 26."
    }

    $DefaultCode = ""
    $DefaultName = ""
    $ExistingInstitutionCodes = @()
    if (Test-Path $ConfigPath) {
        try {
            $ExistingConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            $DefaultCode = [string]$ExistingConfig.institution_code
            $DefaultName = [string]$ExistingConfig.institution_name
            if ($ExistingConfig.institutions) {
                $ExistingInstitutionCodes = @(
                    $ExistingConfig.institutions |
                        ForEach-Object { ([string]$_.code).Trim().ToUpperInvariant() } |
                        Where-Object { $_ }
                )
            } elseif ($DefaultCode) {
                $ExistingInstitutionCodes = @(($DefaultCode.Trim().ToUpperInvariant()))
            }
        } catch {
            # L'assistant Node signalera précisément une configuration invalide.
        }
    }

    $InstitutionCode = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Saisissez le code unique de l'établissement. Exemple : LMA-000101",
        "Mon Cahier - Code établissement",
        $DefaultCode
    ).Trim()
    if (-not $InstitutionCode) { throw "Installation annulée : le code établissement est obligatoire." }

    $InstitutionName = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Saisissez le nom de l'établissement.",
        "Mon Cahier - Nom établissement",
        $DefaultName
    ).Trim()
    if (-not $InstitutionName) { throw "Installation annulée : le nom établissement est obligatoire." }

    $NormalizedInstitutionCode = $InstitutionCode.Trim().ToUpperInvariant()
    $AddInstitution = $false
    if (
        $ExistingInstitutionCodes.Count -gt 0 -and
        $ExistingInstitutionCodes -notcontains $NormalizedInstitutionCode
    ) {
        $AddInstitution = Show-Question(
            "Ce PC possède déjà un relais pour : $($ExistingInstitutionCodes -join ', ').`n`n" +
            "Cliquez Oui si ces établissements appartiennent au même groupe scolaire et partagent ce relais sur le même site.`n`n" +
            "Cliquez Non pour remplacer la configuration active par ce nouvel établissement. L'ancienne base ne sera pas supprimée."
        )
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
        if ($LASTEXITCODE -ne 0) { throw "La construction du relais a échoué." }
    } finally {
        Pop-Location
    }

    $ConfigureArgs = @(
        $CliPath,
        "configure",
        "--config", $ConfigPath,
        "--institution-code", $InstitutionCode,
        "--institution-name", $InstitutionName
    )
    if ($AddInstitution) { $ConfigureArgs += "--add-institution" }
    $SetupJson = & $NodeCommand.Source @ConfigureArgs
    if ($LASTEXITCODE -ne 0) { throw "La configuration du relais a échoué." }
    $Setup = $SetupJson | ConvertFrom-Json

    $ConfigIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $ConfigPath `
        /inheritance:r `
        /grant:r "${ConfigIdentity}:(F)" "SYSTEM:(F)" | Out-Null

    $LegacyVariables = @(
        "MONCAHIER_RELAY_DB",
        "MONCAHIER_RELAY_DATA_DIR",
        "MONCAHIER_RELAY_HOST",
        "MONCAHIER_RELAY_PORT",
        "MONCAHIER_RELAY_TOKEN",
        "MONCAHIER_RELAY_ALLOWED_ORIGINS",
        "MONCAHIER_RELAY_MDNS_ENABLED",
        "MONCAHIER_RELAY_MDNS_HOSTNAME"
    )
    foreach ($VariableName in $LegacyVariables) {
        [Environment]::SetEnvironmentVariable($VariableName, $null, "User")
        Remove-Item "Env:$VariableName" -ErrorAction SilentlyContinue
    }
    [Environment]::SetEnvironmentVariable("MONCAHIER_RELAY_CONFIG", $ConfigPath, "User")
    $env:MONCAHIER_RELAY_CONFIG = $ConfigPath

    $Profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Connectivity -ne "Disconnected" }
    $PublicProfiles = @($Profiles | Where-Object { $_.NetworkCategory -eq "Public" })
    if ($PublicProfiles.Count -gt 0) {
        $ProfileNames = ($PublicProfiles | ForEach-Object { $_.Name }) -join ", "
        $MakePrivate = Show-Question(
            "Le réseau suivant est classé Public : $ProfileNames`n`n" +
            "S'il s'agit bien du réseau privé de l'établissement, cliquez Oui pour autoriser le relais local. " +
            "Cliquez Non si vous êtes sur un réseau public ou partagé."
        )
        if ($MakePrivate) {
            foreach ($Profile in $PublicProfiles) {
                Set-NetConnectionProfile -InterfaceIndex $Profile.InterfaceIndex -NetworkCategory Private
            }
        }
    }

    $RuleName = "Mon Cahier Relay - Port 4317"
    $ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($ExistingRule) {
        $ExistingRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private
        $ExistingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 4317
    } else {
        New-NetFirewallRule `
            -DisplayName $RuleName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort 4317 `
            -Action Allow `
            -Profile Private | Out-Null
    }

    $MdnsRuleName = "Mon Cahier Relay - mDNS 5353"
    $ExistingMdnsRule = Get-NetFirewallRule -DisplayName $MdnsRuleName -ErrorAction SilentlyContinue
    if ($ExistingMdnsRule) {
        $ExistingMdnsRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private
        $ExistingMdnsRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol UDP -LocalPort 5353
    } else {
        New-NetFirewallRule `
            -DisplayName $MdnsRuleName `
            -Direction Inbound `
            -Protocol UDP `
            -LocalPort 5353 `
            -Action Allow `
            -Profile Private | Out-Null
    }

    try {
        $Health = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
        if ($Health.ok) {
            $Restart = Show-Question(
                "Un relais Mon Cahier est déjà lancé. Il doit être redémarré pour appliquer la nouvelle configuration. Continuer ?"
            )
            if (-not $Restart) { throw "Installation annulée avant le redémarrage du relais." }
            $Listeners = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
            foreach ($Listener in $Listeners) {
                if ($Listener.OwningProcess -and $Listener.OwningProcess -ne $PID) {
                    Stop-Process -Id $Listener.OwningProcess -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Milliseconds 800
        }
    } catch {
        if ($_.Exception.Message -like "Installation annulée*") { throw }
    }

    & (Join-Path $PSScriptRoot "install-startup-task.ps1") `
        -RelayRoot $RelayRoot `
        -ConfigPath $ConfigPath `
        -NodePath $NodeCommand.Source | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "La tâche de démarrage automatique du relais n'a pas pu être installée."
    }
    Start-ScheduledTask -TaskName "Mon Cahier Relay"
    Start-Sleep -Seconds 3

    $HealthCheck = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 5
    if (-not $HealthCheck.ok) { throw "Le relais a démarré mais son contrôle de santé a échoué." }
    if ([int]$HealthCheck.schema_version -lt 8) {
        throw "Le relais a démarré, mais sa base n'a pas été migrée vers le schéma 8."
    }
    if (-not $HealthCheck.capabilities.bootstrap_revision_ack_v1) {
        throw "Une ancienne version du relais répond encore sur le port 4317. Fermez-la puis relancez l'installation."
    }

    [System.Windows.Forms.Clipboard]::SetText([string]$Setup.token)
    Start-Process "https://www.mon-cahier.com/admin/parametres?tab=school"

    $RecommendedLanAddress = if ($Setup.lan_url) {
        [string]$Setup.lan_url
    } else {
        "Adresse .local non détectée"
    }
    $DirectLanAddress = if (@($Setup.lan_urls).Count -gt 0) {
        [string]$Setup.lan_urls[0]
    } else {
        "Aucune IPv4 LAN détectée actuellement"
    }
    $ConfiguredSchools = @($Setup.institutions | ForEach-Object { $_.name }) -join ", "
    $RelayMode = if ($Setup.mode -eq "school_group") {
        "Relais partagé du groupe scolaire"
    } else {
        "Relais d'établissement"
    }
    Show-Info(
        "$RelayMode configuré avec succès.`n`n" +
        "Établissement(s) autorisé(s) : $ConfiguredSchools`n`n" +
        "Adresse du poste Admin : http://127.0.0.1:4317`n" +
        "Adresse recommandée : $RecommendedLanAddress`n" +
        "Adresse directe de secours : $DirectLanAddress`n`n" +
        "Le jeton Admin a été copié dans le presse-papiers. Collez-le une seule fois dans Mon Cahier, puis cliquez sur Tester et synchroniser.`n`n" +
        "Version relais : $($HealthCheck.relay_version) — schéma : $($HealthCheck.schema_version)`n`n" +
        "Le relais démarrera désormais automatiquement, sans commande PowerShell."
    )
    $DhcpAssistant = Join-Path $PSScriptRoot "Assistant-Reservation-DHCP.cmd"
    if (
        (Test-Path $DhcpAssistant) -and
        (Show-Question(
            "Optionnel : vous pouvez réserver l'IPv4 actuelle du PC relais dans le DHCP du routeur.`n`n" +
            "Le nom .local reste l'adresse recommandée. La réservation DHCP sert seulement à stabiliser l'adresse directe de secours.`n`n" +
            "Voulez-vous lancer l'assistant de réservation DHCP maintenant ?"
        ))
    ) {
        Start-Process -FilePath $DhcpAssistant
    }
    exit 0
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        "Installation Mon Cahier Relay",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    Write-Error $_.Exception.Message
    exit 1
}
