@echo off
setlocal EnableDelayedExpansion
title Jeton Admin Mon Cahier Relay
set "MONCAHIER_RELAY_CONFIG=%LOCALAPPDATA%\MonCahier\Relay\config.json"
cd /d "%~dp0.."
set "RELAY_TOKEN="
for /f "usebackq delims=" %%T in (`node.exe dist\src\cli.mjs access --token-only 2^>nul`) do set "RELAY_TOKEN=%%T"
if not defined RELAY_TOKEN (
  set /p "RELAY_SCHOOL_CODE=Code unique de l'etablissement : "
  for /f "usebackq delims=" %%T in (`node.exe dist\src\cli.mjs access --token-only --institution-code "!RELAY_SCHOOL_CODE!" 2^>nul`) do set "RELAY_TOKEN=%%T"
)
if not defined RELAY_TOKEN (
  echo Impossible de retrouver le jeton Admin.
  pause
  exit /b 1
)
echo(!RELAY_TOKEN!| clip.exe
echo Jeton Admin copie dans le presse-papiers.
timeout /t 3 /nobreak >nul
endlocal
