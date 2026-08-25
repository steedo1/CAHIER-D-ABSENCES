#ifndef MyAppVersion
  #define MyAppVersion "2026.08.25.3"
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
Source: "{#SourceDir}\App\windows\stop-relay-for-upgrade.ps1"; Flags: dontcopy

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\uninstall-packaged-relay.ps1"""; Flags: runhidden waituntilterminated

[Code]
function StopExistingRelayAndWait(AppDir: String): Boolean;
var
  ResultCode: Integer;
  PowerShellExe: String;
  HelperPath: String;
  Args: String;
begin
  ExtractTemporaryFile('stop-relay-for-upgrade.ps1');
  PowerShellExe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  HelperPath := ExpandConstant('{tmp}\stop-relay-for-upgrade.ps1');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + HelperPath + '" -AppDir "' + AppDir + '"';
  Result := Exec(PowerShellExe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
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

    { Le helper extrait dans %TEMP% arrête la tâche, son lanceur PowerShell et le Node enfant,
      puis vérifie le verrou réel de better_sqlite3.node. Les erreurs intermédiaires d'arrêt
      ne bloquent pas l'installation : seul un fichier encore réellement verrouillé l'arrête. }
    if not StopExistingRelayAndWait(AppDir) then
    begin
      RaiseException('L''ancien Mon Cahier Relay utilise encore un fichier nécessaire à la mise à jour. Fermez cette installation, redémarrez Windows puis relancez le Setup.');
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
