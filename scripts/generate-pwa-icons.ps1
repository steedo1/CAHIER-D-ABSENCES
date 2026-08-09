param(
  [string]$Source = "public/favicon.png"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source
$iconsDir = Join-Path $root "public/icons"

if (-not (Test-Path $sourcePath)) {
  throw "Image source introuvable : $sourcePath"
}

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null

function Write-SquarePng {
  param(
    [System.Drawing.Image]$Image,
    [int]$Size,
    [string]$Destination
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $bitmap.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $scale = [Math]::Min($Size / $Image.Width, $Size / $Image.Height)
    $width = [Math]::Max(1, [int][Math]::Round($Image.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($Image.Height * $scale))
    $x = [int][Math]::Floor(($Size - $width) / 2)
    $y = [int][Math]::Floor(($Size - $height) / 2)

    $graphics.DrawImage($Image, $x, $y, $width, $height)
    $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$image = [System.Drawing.Image]::FromFile($sourcePath)
try {
  Write-SquarePng -Image $image -Size 192 -Destination (Join-Path $iconsDir "icon-192.png")
  Write-SquarePng -Image $image -Size 512 -Destination (Join-Path $iconsDir "icon-512.png")
}
finally {
  $image.Dispose()
}

Write-Host "Icônes PWA générées depuis $Source :"
Write-Host " - public/icons/icon-192.png (192x192)"
Write-Host " - public/icons/icon-512.png (512x512)"
