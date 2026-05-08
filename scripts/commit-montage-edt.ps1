param(
  [string]$Message = "Mise a jour montage emploi du temps"
)

$ErrorActionPreference = "Stop"

git checkout test/notif-admin-v1
git config --local core.safecrlf false

git add "src/app/admin/ui/sidebar-nav.tsx" 2>$null
git add "src/app/admin/montage-emploi-du-temps" 2>$null
git add "src/app/api/admin/montage-emploi-du-temps" 2>$null
git add "src/modules/montage-emploi-du-temps" 2>$null
git add "sql/montage_edt_horaclasse_complete_v3.sql" 2>$null
git add "scripts/commit-montage-edt.ps1" 2>$null

git status

git commit -m $Message

git push origin test/notif-admin-v1
