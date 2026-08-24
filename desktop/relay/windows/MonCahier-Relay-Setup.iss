#ifndef MyAppVersion
  #define MyAppVersion "2026.08.22.1"
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
UninstallDisplayName=Mon Cahier Relay

[Files]
Source: "{#SourceDir}\App\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\uninstall-packaged-relay.ps1"""; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellExe: String;
  InstallScript: String;
  InstallArgs: String;
  EnrollmentSource: String;
  EnrollmentTarget: String;
begin
  if CurStep = ssInstall then
  begin
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "Mon Cahier Relay"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
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
