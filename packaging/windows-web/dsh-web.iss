; DeepSeek Harness Web GUI installer.
;
; Sources the assembled install tree (dist-windows-web/) produced by
; `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`
; and compiles a single setup .exe. The plugin directory and the writable data
; home stay per-user so plugins can be added after install without elevation.
;
; Requires Inno Setup 6+ (ISCC.exe) on the build machine.

#define MyAppName "DeepSeek Harness Web"
#define MyAppVersion "0.1.1"
#define MyAppPublisher "DeepSeek AI"
#define MyAppExeName "dsh-web.exe"

; The assembled install tree, relative to this .iss file (packaging/windows-web/).
#define Stage "..\..\dist-windows-web"

[Setup]
AppId={{8D2B1C9A-4B0E-4F6C-9A2E-7C1D5E3F0A2B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install: no admin needed, and the plugins/data dirs stay writable.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\DeepSeek Harness
DisableProgramGroupPage=yes
OutputDir={#Stage}
OutputBaseFilename=dsh-web-setup
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The launcher exe at the install root.
Source: "{#Stage}\dsh-web.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
; Bundled Node runtime.
Source: "{#Stage}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; The web engine closure (host + client plugins, cordis, frontend dist).
Source: "{#Stage}\engine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Writable plugin directory and data home; created writable by the user.
Name: "{app}\plugins"; Flags: uninsneveruninstall
Name: "{app}\data"; Flags: uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Keep user plugins and data on uninstall; only remove the install tree.
; (Inno never deletes {app} by default, so plugins/data persist.)
