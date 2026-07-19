@echo off
setlocal
set "MONCAHIER_RELAY_CONFIG=%LOCALAPPDATA%\MonCahier\Relay\config.json"
set "MONCAHIER_RELAY_LOG_DIR=%LOCALAPPDATA%\MonCahier\Relay\logs"
if not exist "%MONCAHIER_RELAY_LOG_DIR%" mkdir "%MONCAHIER_RELAY_LOG_DIR%"
cd /d "%~dp0.."
node.exe dist\src\cli.mjs serve >> "%MONCAHIER_RELAY_LOG_DIR%\relay.log" 2>&1
endlocal
