param(
    [string]$Destination,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

function Assert-SafeZipEntries([string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($Entry in $Archive.Entries) {
            $Name = ([string]$Entry.FullName).Replace("\", "/").TrimStart("/")
            if (-not $Name) { continue }
            if ($Name -match '(?i)(^|/)(node_modules|data|backups|\.git)(/|$)') {
                throw "Le ZIP contient un dossier interdit : $Name"
            }
            if (
                $Name -match '(?i)(\.db|\.sqlite|\.sqlite3)(-wal|-shm)?$' -or
                $Name -match '(?i)\.(log|p12|pfx|pem|key|token)$' -or
                $Name -match '(?i)(^|/)config\.json$' -or
                ($Name -match '(?i)(^|/)\.env($|\.)' -and $Name -notmatch '(?i)\.env\.example$')
            ) {
                throw "Le ZIP contient un fichier sensible interdit : $Name"
            }
        }
    } finally {
        $Archive.Dispose()
    }
}

$RelayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PackagePath = Join-Path $RelayRoot "package.json"
if (-not (Test-Path $PackagePath)) {
    throw "package.json est introuvable dans le dossier du relais."
}

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NodeCommand -or -not $NpmCommand) {
    throw "Node.js et npm sont requis pour fabriquer le paquet du relais."
}

$Package = Get-Content $PackagePath -Raw | ConvertFrom-Json
$Version = ([string]$Package.version).Trim()
if (-not $Version) { throw "La version du relais est absente de package.json." }

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $Destination) {
    $ReleaseDirectory = Join-Path $RelayRoot "release"
    New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
    $Destination = Join-Path $ReleaseDirectory "mon-cahier-relay-$Version-$Timestamp.zip"
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path (Split-Path $Destination -Parent) -Force | Out-Null

if (-not $SkipVerify) {
    Push-Location $RelayRoot
    try {
        & $NpmCommand.Source run verify
        if ($LASTEXITCODE -ne 0) {
            throw "La vérification du relais a échoué. Aucun ZIP n'a été créé."
        }
    } finally {
        Pop-Location
    }
}

$StageRoot = Join-Path $env:TEMP "mon-cahier-relay-release-$Timestamp-$PID"
Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

try {
    $RootFiles = @(
        ".gitignore",
        "package.json",
        "package-lock.json",
        "tsconfig.json"
    )
    foreach ($Relative in $RootFiles) {
        $Source = Join-Path $RelayRoot $Relative
        if (-not (Test-Path $Source)) {
            throw "Fichier obligatoire absent : $Relative"
        }
        Copy-Item $Source (Join-Path $StageRoot $Relative) -Force
    }

    $Directories = @("migrations", "protocol", "scripts", "src", "windows")
    foreach ($Relative in $Directories) {
        $Source = Join-Path $RelayRoot $Relative
        if (-not (Test-Path $Source)) {
            throw "Dossier obligatoire absent : $Relative"
        }
        Copy-Item $Source (Join-Path $StageRoot $Relative) -Recurse -Force
    }

    $SafetyScript = Join-Path $StageRoot "scripts\assert-release-safe.mjs"
    & $NodeCommand.Source $SafetyScript --root $StageRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Le contenu préparé contient des fichiers sensibles."
    }

    $GitCommit = ""
    $GitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($GitCommand) {
        try {
            $GitCommit = (& $GitCommand.Source -C $RelayRoot rev-parse HEAD 2>$null).Trim()
        } catch {
            $GitCommit = ""
        }
    }

    $ManifestScript = Join-Path $StageRoot "scripts\create-release-manifest.mjs"
    $ManifestPath = Join-Path $StageRoot "release-manifest.json"
    & $NodeCommand.Source $ManifestScript `
        --root $StageRoot `
        --output $ManifestPath `
        --version $Version `
        --commit $GitCommit `
        --created-at ([DateTime]::UtcNow.ToString("o"))
    if ($LASTEXITCODE -ne 0) {
        throw "La création du manifeste du paquet a échoué."
    }

    & $NodeCommand.Source $SafetyScript --root $StageRoot --manifest $ManifestPath
    if ($LASTEXITCODE -ne 0) {
        throw "Le manifeste du paquet n'a pas pu être vérifié."
    }

    Remove-Item $Destination -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $Destination -CompressionLevel Optimal
    Assert-SafeZipEntries $Destination

    $ZipHash = (Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ""
    Write-Host "PAQUET RELAIS CRÉÉ ET CONTRÔLÉ" -ForegroundColor Green
    Write-Host "Fichier : $Destination"
    Write-Host "SHA-256 : $ZipHash"
    Write-Host "Contenu exclu : data, bases SQLite, WAL/SHM, node_modules, sauvegardes, secrets et journaux."
} finally {
    Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
