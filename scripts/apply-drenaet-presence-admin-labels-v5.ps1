$ErrorActionPreference = "Stop"

$root = "C:\Projects\CAHIER-D-ABSENCES"
Set-Location $root

Write-Host "Patch DRENAET Présence enseignants v5 : libellés administratifs..." -ForegroundColor Cyan

Write-Host "Fichiers à vérifier :" -ForegroundColor Yellow
Write-Host "- src/app/api/drenaet/teacher-presence/route.ts"
Write-Host "- src/app/drenaet/presence-enseignants/page.tsx"

Write-Host "Terminé. Lance npm run build puis commit." -ForegroundColor Green
