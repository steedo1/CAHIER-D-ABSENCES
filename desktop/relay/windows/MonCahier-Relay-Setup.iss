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

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\install-packaged-relay.ps1"""; Description: "Configurer et démarrer Mon Cahier Relay"; Flags: waituntilterminated

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\uninstall-packaged-relay.ps1"""; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "Mon Cahier Relay"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
