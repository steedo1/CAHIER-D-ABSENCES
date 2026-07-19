@echo off
setlocal
title Diagnostic Mon Cahier Relay
set "MONCAHIER_RELAY_CONFIG=%LOCALAPPDATA%\MonCahier\Relay\config.json"
cd /d "%~dp0.."
node.exe dist\src\cli.mjs doctor
echo.
echo Si service_reachable vaut true, le relais fonctionne correctement.
pause
endlocal
