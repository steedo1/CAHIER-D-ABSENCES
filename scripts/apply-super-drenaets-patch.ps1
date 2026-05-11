param(
  [string]$ProjectPath = "C:\Projects\CAHIER-D-ABSENCES"
)

$ErrorActionPreference = "Stop"

Write-Host "Application du patch Super-admin DRENAET vers $ProjectPath" -ForegroundColor Cyan
Copy-Item -Recurse -Force "$PSScriptRoot\..\src" $ProjectPath

Write-Host "Patch appliqué. Vérifiez avec : git status" -ForegroundColor Green
