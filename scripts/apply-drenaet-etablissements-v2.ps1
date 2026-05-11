$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Projects\CAHIER-D-ABSENCES"
$PatchRoot = Split-Path -Parent $PSScriptRoot

Copy-Item -Force "$PatchRoot\src\app\drenaet\etablissements\page.tsx" "$ProjectRoot\src\app\drenaet\etablissements\page.tsx"

Write-Host "Patch Etablissements DRENAET v2 applique avec succes." -ForegroundColor Green
