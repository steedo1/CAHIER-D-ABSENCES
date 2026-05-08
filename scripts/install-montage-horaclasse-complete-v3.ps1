$ErrorActionPreference = "Stop"

$projectRoot = "C:\Projects\CAHIER-D-ABSENCES"
$zip = Get-ChildItem -Path @(
  $projectRoot,
  "$env:USERPROFILE\Downloads"
) -Filter "montage-horaclasse-complete-v3*.zip" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$zip) {
  throw "Zip introuvable. Télécharge montage-horaclasse-complete-v3.zip puis relance cette commande."
}

Write-Host "Zip trouvé : $($zip.FullName)" -ForegroundColor Cyan
Expand-Archive -Path $zip.FullName -DestinationPath $projectRoot -Force

Write-Host "OK : module Montage EDT / HoraClasse installé dans Mon Cahier." -ForegroundColor Green
Write-Host "Étape suivante : exécuter sql/montage_edt_horaclasse_complete_v3.sql dans Supabase, puis npm run build." -ForegroundColor Yellow
