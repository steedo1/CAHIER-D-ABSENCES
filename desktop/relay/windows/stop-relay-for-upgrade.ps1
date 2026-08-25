param(
    [Parameter(Mandatory = $true)][string]$AppDir
)

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "Mon Cahier Relay"
$ResolvedAppDir = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\')
$NodePath = Join-Path $ResolvedAppDir "runtime\node.exe"
$CliFragment = Join-Path $ResolvedAppDir "dist\src\cli.mjs"
$BootScriptFragment = Join-Path $ResolvedAppDir "windows\start-relay-at-boot.ps1"
$NativeModule = Join-Path $ResolvedAppDir "node_modules\better-sqlite3\build\Release\better_sqlite3.node"

# Empêche la tâche planifiée de relancer le relais pendant la mise à jour.
& "$env:WINDIR\System32\schtasks.exe" /Change /TN $TaskName /Disable | Out-Null
& "$env:WINDIR\System32\schtasks.exe" /End /TN $TaskName | Out-Null
Start-Sleep -Milliseconds 500

function Get-RelayProcesses {
    $all = @(Get-CimInstance Win32_Process)
    return @($all | Where-Object {
        $exe = [string]$_.ExecutablePath
        $cmd = [string]$_.CommandLine
        ($exe -and $exe.Equals($NodePath, [System.StringComparison]::OrdinalIgnoreCase)) -or
        ($cmd -and $cmd.IndexOf($CliFragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
        ($cmd -and $cmd.IndexOf($BootScriptFragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
}

function Stop-RelayProcesses {
    $targets = @(Get-RelayProcesses | Sort-Object ProcessId -Descending -Unique)
    foreach ($process in $targets) {
        if (-not $process.ProcessId -or [int]$process.ProcessId -eq $PID) { continue }
        # /T ferme aussi les éventuels processus enfants du lanceur PowerShell.
        & "$env:WINDIR\System32\taskkill.exe" /PID ([string]$process.ProcessId) /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
}

# Plusieurs passages couvrent le cas où la tâche était en train de relancer Node au même moment.
for ($round = 0; $round -lt 5; $round++) {
    Stop-RelayProcesses
    Start-Sleep -Milliseconds 500
    if (@(Get-RelayProcesses).Count -eq 0) { break }
}

# Le seul critère bloquant est le verrou réel du module natif. Les commandes d'arrêt
# précédentes sont volontairement best-effort pour rester compatibles avec Windows 10/11.
if (-not (Test-Path -LiteralPath $NativeModule -PathType Leaf)) {
    exit 0
}

for ($attempt = 0; $attempt -lt 50; $attempt++) {
    try {
        $stream = [System.IO.File]::Open(
            $NativeModule,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $stream.Dispose()
        exit 0
    } catch {
        Stop-RelayProcesses
        Start-Sleep -Milliseconds 200
    }
}

exit 5
