#ifndef MyAppVersion
  #define MyAppVersion "2026.08.25.2"
#endif
#ifndef SourceDir
  #define SourceDir ".\\stage"
#endif
#ifndef OutputDir
  #define OutputDir ".\\release"
#endif

[Setup]
AppId={{3D970997-75D6-4D44-98AF-0AF1192B2C36}
AppName=Mon Cahier Relay
AppVersion={#MyAppVersion}
AppVerName=Mon Cahier Relay - Rentrée 2026-2027
AppPublisher=Nexa Digital SARL
AppPublisherURL=https://www.mon-cahier.com
AppSupportURL=https://www.mon-cahier.com
DefaultDirName={commonappdata}\MonCahier\Relay\App
DisableProgramGroupPage=yes
DisableReadyMemo=no
DisableReadyPage=no
OutputDir={#OutputDir}
OutputBaseFilename=MonCahier-Relay-Setup-Rentree-2026-2027
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
SetupIconFile={#SourceDir}\moncahier-relay.ico
UninstallDisplayName=Mon Cahier Relay
UninstallDisplayIcon={app}\moncahier-relay.ico

[Files]
Source: "{#SourceDir}\App\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\moncahier-relay.ico"; DestDir: "{app}"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\uninstall-packaged-relay.ps1"""; Flags: runhidden waituntilterminated

[Code]
function RunHiddenPowerShell(Command: String; var ResultCode: Integer): Boolean;
var
  PowerShellExe: String;
  Args: String;
begin
  PowerShellExe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + Command + '"';
  Result := Exec(PowerShellExe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function StopExistingRelay(AppDir: String): Boolean;
var
  ResultCode: Integer;
  Command: String;
begin
  Command :=
    '$ErrorActionPreference=''SilentlyContinue''; ' +
    '$task=''Mon Cahier Relay''; ' +
    'Disable-ScheduledTask -TaskName $task | Out-Null; ' +
    'Stop-ScheduledTask -TaskName $task; ' +
    'Start-Sleep -Milliseconds 400; ' +
    '$app=''' + AppDir + '''; ' +
    '$node=Join-Path $app ''runtime\node.exe''; ' +
    'Get-CimInstance Win32_Process | Where-Object { ' +
    '($_.ExecutablePath -and $_.ExecutablePath -ieq $node) -or ' +
    '($_.CommandLine -and $_.CommandLine -like (''*''+$app+''*dist\src\cli.mjs*'')) ' +
    '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; ' +
    'Start-Sleep -Milliseconds 700; exit 0';

  Result := RunHiddenPowerShell(Command, ResultCode) and (ResultCode = 0);
end;

function WaitForRelayFilesToUnlock(AppDir: String): Boolean;
var
  ResultCode: Integer;
  Command: String;
begin
  Command :=
    '$path=Join-Path ''' + AppDir + ''' ''node_modules\better-sqlite3\build\Release\better_sqlite3.node''; ' +
    'if(-not (Test-Path -LiteralPath $path)){exit 0}; ' +
    'for($i=0;$i -lt 30;$i++){' +
    'try{' +
    '$stream=[System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); ' +
    '$stream.Dispose(); exit 0' +
    '}catch{Start-Sleep -Milliseconds 200}' +
    '}; exit 5';

  Result := RunHiddenPowerShell(Command, ResultCode) and (ResultCode = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellExe: String;
  InstallScript: String;
  InstallArgs: String;
  EnrollmentSource: String;
  EnrollmentTarget: String;
  AppDir: String;
begin
  if CurStep = ssInstall then
  begin
    AppDir := ExpandConstant('{app}');

    { Empêche le watchdog de relancer l'ancien relais pendant la mise à jour. }
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/Change /TN "Mon Cahier Relay" /Disable', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "Mon Cahier Relay"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    { La tâche PowerShell peut laisser son enfant node.exe vivant. On l'arrête donc explicitement. }
    if not StopExistingRelay(AppDir) then
    begin
      RaiseException('Impossible d''arrêter proprement l''ancien Mon Cahier Relay. Réessayez l''installation.');
    end;

    { better_sqlite3.node est un module natif : Windows refuse de le remplacer tant qu'un processus le charge. }
    if not WaitForRelayFilesToUnlock(AppDir) then
    begin
      RaiseException('L''ancien relais utilise encore un fichier nécessaire à la mise à jour. Le Setup a été arrêté pour éviter une installation incomplète.');
    end;
  end;

  if CurStep = ssPostInstall then
  begin
    EnrollmentSource := ExpandConstant('{src}\MonCahier-Relay-Enrollment.json');
    EnrollmentTarget := ExpandConstant('{app}\MonCahier-Relay-Enrollment.json');
    DeleteFile(EnrollmentTarget);
    if FileExists(EnrollmentSource) then
    begin
      if not FileCopy(EnrollmentSource, EnrollmentTarget, False) then
      begin
        RaiseException('Impossible de préparer la configuration automatique du relais.');
      end;
    end;

    PowerShellExe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    InstallScript := ExpandConstant('{app}\windows\install-packaged-relay.ps1');
    InstallArgs := '-NoProfile -ExecutionPolicy Bypass -File "' + InstallScript + '"';

    if not Exec(PowerShellExe, InstallArgs, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
    begin
      RaiseException('Impossible de lancer la configuration Mon Cahier Relay.');
    end;

    if ResultCode <> 0 then
    begin
      RaiseException(Format('La configuration Mon Cahier Relay a échoué (code %d). Le Setup ne sera pas déclaré terminé.', [ResultCode]));
    end;
  end;
end;
