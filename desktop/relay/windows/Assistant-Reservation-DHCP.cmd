@echo off
setlocal
title Assistant Reservation DHCP - Mon Cahier Relay
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-dhcp-reservation.ps1"
if errorlevel 1 pause
endlocal
