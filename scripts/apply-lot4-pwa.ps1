param(
  [string]$IconSource = "public/favicon.png"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$legacyWorker = Join-Path $root "public/sw.js"
$iconGenerator = Join-Path $PSScriptRoot "generate-pwa-icons.ps1"

if (-not (Test-Path $iconGenerator)) {
  throw "Script de génération des icônes introuvable : $iconGenerator"
}

& $iconGenerator -Source $IconSource

if (Test-Path $legacyWorker) {
  Remove-Item -LiteralPath $legacyWorker -Force
  Write-Host "Ancien service worker supprimé : public/sw.js"
}

Write-Host "LOT 4 PWA appliqué :"
Write-Host " - icônes 192x192 et 512x512 générées"
Write-Host " - ancien service worker retiré"
Write-Host " - service worker officiel : public/moncahier-sw.js"
