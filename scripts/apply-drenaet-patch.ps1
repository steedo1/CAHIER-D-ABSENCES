# À exécuter depuis le dossier racine du projet : C:\Projects\CAHIER-D-ABSENCES
# Exemple : powershell -ExecutionPolicy Bypass -File scripts/apply-drenaet-patch.ps1

$ErrorActionPreference = "Stop"

Write-Host "Les fichiers du patch DRENAET doivent être copiés à la racine du projet en respectant les chemins." -ForegroundColor Cyan
Write-Host "Ensuite :" -ForegroundColor Cyan
Write-Host "1) Exécuter la migration SQL Supabase : supabase/migrations/20260510_drenaet_regional_dashboard.sql" -ForegroundColor Yellow
Write-Host "2) Créer le rôle drenaet_admin dans user_roles pour le compte concerné" -ForegroundColor Yellow
Write-Host "3) Rattacher le compte dans drenaet_user_scopes avec la valeur regional_direction exacte" -ForegroundColor Yellow
Write-Host "4) Tester /redirect puis /drenaet/dashboard" -ForegroundColor Yellow
