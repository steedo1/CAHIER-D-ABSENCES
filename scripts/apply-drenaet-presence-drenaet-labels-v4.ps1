$ErrorActionPreference = "Stop"

$root = "C:\Projects\CAHIER-D-ABSENCES"
Set-Location $root

Write-Host "Patch appliqué : libellés et logique DRENAET pour Présence enseignants." -ForegroundColor Green
Write-Host "Fichiers concernés :" -ForegroundColor Cyan
Write-Host "- src/app/api/drenaet/teacher-presence/route.ts"
Write-Host "- src/app/drenaet/presence-enseignants/page.tsx"
Write-Host ""
Write-Host "Prochaine étape : npm run build" -ForegroundColor Yellow
