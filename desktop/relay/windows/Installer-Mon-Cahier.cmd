@echo off
setlocal
title Installation de Mon Cahier Relay
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-relay.ps1"
if errorlevel 1 pause
endlocal
