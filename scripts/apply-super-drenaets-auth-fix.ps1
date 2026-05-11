$ErrorActionPreference = "Stop"
$root = "C:\Projects\CAHIER-D-ABSENCES"
$src = Split-Path -Parent $PSScriptRoot

Copy-Item -Force "$src\src\app\api\super\drenaets\route.ts" "$root\src\app\api\super\drenaets\route.ts"

Set-Location $root
git status
