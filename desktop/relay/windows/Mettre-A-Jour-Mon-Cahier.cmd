@echo off
setlocal
title Mise a jour de Mon Cahier Relay
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-relay.ps1"
if errorlevel 1 pause
endlocal
