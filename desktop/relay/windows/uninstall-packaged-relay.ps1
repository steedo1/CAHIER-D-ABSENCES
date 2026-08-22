$ErrorActionPreference = "SilentlyContinue"

$TaskName = "Mon Cahier Relay"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

Get-NetFirewallRule -DisplayName "Mon Cahier Relay - Port 4317" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName "Mon Cahier Relay - mDNS 5353" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# Les donnees et la configuration de l'etablissement restent volontairement conservees
# dans le profil Windows afin de permettre une reinstallation sans perte.
exit 0
