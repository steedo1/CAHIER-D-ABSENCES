param(
    [switch]$NoBrowser,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$Title) {
    Write-Host ""
    Write-Host ("=== " + $Title + " ===") -ForegroundColor Cyan
}

function Get-ActiveIpv4Context {
    $routes = @(
        Get-NetRoute `
            -AddressFamily IPv4 `
            -DestinationPrefix "0.0.0.0/0" `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $_.NextHop -and
            $_.NextHop -ne "0.0.0.0" -and
            $_.InterfaceIndex
        }
    )

    if ($routes.Count -eq 0) {
        throw "Aucune route IPv4 active vers le réseau n'a été trouvée."
    }

    $candidates = foreach ($route in $routes) {
        $interface = Get-NetIPInterface `
            -AddressFamily IPv4 `
            -InterfaceIndex $route.InterfaceIndex `
            -ErrorAction SilentlyContinue
        if (-not $interface) { continue }

        $adapter = Get-NetAdapter `
            -InterfaceIndex $route.InterfaceIndex `
            -ErrorAction SilentlyContinue
        if (-not $adapter -or $adapter.Status -ne "Up") { continue }

        [pscustomobject]@{
            Route = $route
            Interface = $interface
            Adapter = $adapter
            Score = [int]$route.RouteMetric + [int]$interface.InterfaceMetric
        }
    }

    $selected = $candidates |
        Sort-Object Score |
        Select-Object -First 1

    if (-not $selected) {
        throw "Aucune interface IPv4 active adaptée au relais n'a été trouvée."
    }

    $ipConfig = Get-NetIPConfiguration `
        -InterfaceIndex $selected.Route.InterfaceIndex `
        -ErrorAction Stop

    $ipv4 = @($ipConfig.IPv4Address) |
        Where-Object {
            $_.IPAddress -and
            $_.IPAddress -ne "127.0.0.1" -and
            -not $_.IPAddress.StartsWith("169.254.")
        } |
        Select-Object -First 1

    if (-not $ipv4) {
        throw "L'interface active n'a pas d'adresse IPv4 LAN exploitable."
    }

    $gateway = @($ipConfig.IPv4DefaultGateway) |
        Where-Object { $_.NextHop } |
        Select-Object -First 1

    $profile = Get-NetConnectionProfile `
        -InterfaceIndex $selected.Route.InterfaceIndex `
        -ErrorAction SilentlyContinue

    return [pscustomobject]@{
        InterfaceIndex = [int]$selected.Route.InterfaceIndex
        InterfaceAlias = [string]$selected.Adapter.Name
        InterfaceDescription = [string]$selected.Adapter.InterfaceDescription
        MacAddress = [string]$selected.Adapter.MacAddress
        IpAddress = [string]$ipv4.IPAddress
        PrefixLength = [int]$ipv4.PrefixLength
        Gateway = if ($gateway) { [string]$gateway.NextHop } else { "" }
        Dhcp = [string]$selected.Interface.Dhcp
        NetworkName = if ($profile) { [string]$profile.Name } else { "" }
        NetworkCategory = if ($profile) { [string]$profile.NetworkCategory } else { "Unknown" }
    }
}

function Read-RelayIdentity {
    $configPath = Join-Path $env:LOCALAPPDATA "MonCahier\Relay\config.json"
    $result = [ordered]@{
        ConfigPath = $configPath
        InstitutionCode = ""
        InstitutionName = ""
        Port = 4317
    }

    if (-not (Test-Path $configPath)) {
        return [pscustomobject]$result
    }

    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.institution_code) { $result.InstitutionCode = [string]$config.institution_code }
        if ($config.institution_name) { $result.InstitutionName = [string]$config.institution_name }
        if ($config.port) { $result.Port = [int]$config.port }
    } catch {
        Write-Warning "La configuration Mon Cahier existe mais n'a pas pu être lue : $configPath"
    }

    return [pscustomobject]$result
}

function Test-RelayHealth([string]$IpAddress, [int]$Port) {
    try {
        $health = Invoke-RestMethod `
            -Uri "http://${IpAddress}:${Port}/health" `
            -TimeoutSec 3
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

try {
    $network = Get-ActiveIpv4Context
    $relay = Read-RelayIdentity
    $healthOk = Test-RelayHealth -IpAddress $network.IpAddress -Port $relay.Port

    Write-Section "ASSISTANT RESERVATION DHCP MON CAHIER"

    Write-Host "But : demander au routeur de toujours redonner la meme IP au PC relais."
    Write-Host "Windows reste en DHCP automatique : aucune IP statique n'est imposee dans Windows."
    Write-Host ""

    Write-Host ("Etablissement : " + $(if ($relay.InstitutionName) { $relay.InstitutionName } else { "non renseigne" }))
    Write-Host ("Code          : " + $(if ($relay.InstitutionCode) { $relay.InstitutionCode } else { "non renseigne" }))
    Write-Host ("Reseau        : " + $(if ($network.NetworkName) { $network.NetworkName } else { "non renseigne" }))
    Write-Host ("Carte reseau  : " + $network.InterfaceAlias)
    Write-Host ("Profil Windows: " + $network.NetworkCategory)
    Write-Host ("DHCP Windows  : " + $network.Dhcp)
    Write-Host ("MAC du PC     : " + $network.MacAddress) -ForegroundColor Yellow
    Write-Host ("IP a reserver : " + $network.IpAddress) -ForegroundColor Yellow
    Write-Host ("Passerelle    : " + $(if ($network.Gateway) { $network.Gateway } else { "non detectee" })) -ForegroundColor Yellow
    Write-Host ("Port relais   : " + $relay.Port)
    Write-Host ("Test relais   : " + $(if ($healthOk) { "OK" } else { "ECHEC" }))

    if ($network.NetworkCategory -ne "Private") {
        Write-Warning "Le reseau Windows n'est pas Private. Le relais Mon Cahier doit rester limite a un reseau prive de l'etablissement."
    }

    if ($network.Dhcp -ne "Enabled") {
        Write-Warning "DHCP Windows n'est pas active sur cette interface. Une reservation DHCP suppose normalement que Windows reste en adressage automatique."
    }

    $relayRoot = Split-Path $PSScriptRoot -Parent
    $guidePath = Join-Path $relayRoot "docs\GUIDE-RESERVATION-DHCP.md"
    $stateDir = Join-Path $env:LOCALAPPDATA "MonCahier\Relay"
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

    $reportPath = Join-Path $stateDir "reservation-dhcp-a-configurer.txt"
    $planPath = Join-Path $stateDir "reservation-dhcp-plan.json"

    $summary = @"
MON CAHIER - RESERVATION DHCP

Etablissement : $($relay.InstitutionName)
Code           : $($relay.InstitutionCode)
Reseau         : $($network.NetworkName)
Carte reseau   : $($network.InterfaceAlias)
Adresse MAC    : $($network.MacAddress)
IP a reserver  : $($network.IpAddress)
Passerelle     : $($network.Gateway)
Port relais    : $($relay.Port)

Dans le routeur :
1. Ouvrir LAN / DHCP / Reservation DHCP / Address Reservation / Static Lease.
2. Ajouter le PC relais avec la MAC ci-dessus.
3. Reserver exactement l'IP ci-dessus.
4. Enregistrer.
5. Reconnecter le PC puis relancer cet assistant.
6. Verifier que l'IP n'a pas change et que /health repond.

IMPORTANT :
- Ne pas mettre d'IP statique manuellement dans Windows.
- Ne pas desactiver DHCP sur le routeur.
- Ne pas creer de redirection de port 4317 vers Internet.
- Le PC et les telephones doivent rester sur le meme LAN pour utiliser le relais.
"@

    Set-Content -Path $reportPath -Value $summary -Encoding UTF8

    $plan = [ordered]@{
        version = 1
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        institution_code = $relay.InstitutionCode
        institution_name = $relay.InstitutionName
        network_name = $network.NetworkName
        interface_alias = $network.InterfaceAlias
        interface_index = $network.InterfaceIndex
        mac_address = $network.MacAddress
        reserved_ip = $network.IpAddress
        prefix_length = $network.PrefixLength
        gateway = $network.Gateway
        relay_port = $relay.Port
        windows_network_category = $network.NetworkCategory
        windows_dhcp = $network.Dhcp
        relay_health_ok = $healthOk
        status = "planned"
    }
    $plan | ConvertTo-Json -Depth 4 | Set-Content -Path $planPath -Encoding UTF8

    try {
        Set-Clipboard -Value $summary
        Write-Host ""
        Write-Host "Les informations ont ete copiees dans le presse-papiers." -ForegroundColor Green
    } catch {
        Write-Warning "Impossible de copier automatiquement les informations dans le presse-papiers."
    }

    Write-Host ("Rapport : " + $reportPath)
    Write-Host ("Plan    : " + $planPath)

    Write-Section "ETAPE ROUTEUR"
    Write-Host "Dans la page du routeur, cherchez une rubrique nommee par exemple :"
    Write-Host "DHCP Reservation / Address Reservation / Static Lease / Bail statique / Liaison IP-MAC."
    Write-Host ""
    Write-Host ("MAC : " + $network.MacAddress) -ForegroundColor Yellow
    Write-Host ("IP  : " + $network.IpAddress) -ForegroundColor Yellow

    if ($network.Gateway -and -not $NoBrowser) {
        $answer = Read-Host "Ouvrir maintenant la page du routeur http://$($network.Gateway) ? (O/N)"
        if ($answer.Trim().ToUpperInvariant().StartsWith("O")) {
            Start-Process "http://$($network.Gateway)"
        }
    }

    if (Test-Path $guidePath) {
        Write-Host ""
        Write-Host ("Guide detaille : " + $guidePath) -ForegroundColor Green
    }

    Write-Section "VERIFICATION APRES CONFIGURATION"
    Write-Host "1. Enregistrez la reservation dans le routeur."
    Write-Host "2. Deconnectez/reconnectez le PC au Wi-Fi ou redemarrez le PC."
    Write-Host "3. Relancez Assistant-Reservation-DHCP.cmd."
    Write-Host "4. L'IP affichee doit rester identique a l'IP reservee."
    Write-Host "5. Depuis un telephone du meme LAN, testez http://$($network.IpAddress):$($relay.Port)/health."
    Write-Host ""
    Write-Host "Si le routeur est remplace, il faudra refaire cette reservation une seule fois."

    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Appuyez sur Entree pour fermer"
    }
    exit 0
} catch {
    Write-Host ""
    Write-Host ("ERREUR : " + $_.Exception.Message) -ForegroundColor Red
    if (-not $NoPause) {
        Read-Host "Appuyez sur Entree pour fermer"
    }
    exit 1
}
