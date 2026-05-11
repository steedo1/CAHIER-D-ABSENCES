$ErrorActionPreference = "Stop"
$Root = "C:\Projects\CAHIER-D-ABSENCES"
Copy-Item -Force "$PSScriptRoot\..\src\app\api\drenaet\teacher-presence\route.ts" "$Root\src\app\api\drenaet\teacher-presence\route.ts"
Copy-Item -Force "$PSScriptRoot\..\src\app\drenaet\presence-enseignants\page.tsx" "$Root\src\app\drenaet\presence-enseignants\page.tsx"
Write-Host "Patch DRENAET présence enseignants appliqué." -ForegroundColor Green
