param(
  [string]$Message = "Met à jour module montage emploi du temps",
  [string]$Branch = "test/notif-admin-v1"
)

$ErrorActionPreference = "Stop"

git checkout $Branch

git add "src/app/admin/ui/sidebar-nav.tsx"
git add "src/app/admin/montage-emploi-du-temps"
git add "src/app/api/admin/montage-emploi-du-temps"
git add "src/modules/montage-emploi-du-temps"
git add "scripts/commit-montage-edt.ps1"

git status

$pending = git status --porcelain
if ([string]::IsNullOrWhiteSpace($pending)) {
  Write-Host "Aucun changement à commiter." -ForegroundColor Yellow
  exit 0
}

git commit -m $Message
git push origin $Branch
