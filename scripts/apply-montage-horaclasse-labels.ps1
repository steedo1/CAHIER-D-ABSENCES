$ErrorActionPreference = "Stop"

$path = "src/app/admin/ui/sidebar-nav.tsx"
if (!(Test-Path $path)) {
  throw "Fichier introuvable : $path"
}

$content = Get-Content $path -Raw
$content = $content.Replace('label: "Volumes horaires"', 'label: "Référentiel & services"')
$content = $content.Replace('label: "Brouillons & génération"', 'label: "Services & génération"')
$content = $content.Replace('7 rubriques', '7 rubriques')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
[System.IO.File]::WriteAllText((Resolve-Path $path), $content, $utf8NoBom)

Write-Host "OK : labels sidebar ajustés au modèle HoraClasse." -ForegroundColor Green
