; DeepSeek Harness Web GUI installer.
;
; Sources the assembled install tree (dist-windows-web/) produced by
; `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`
; and compiles a single setup .exe. 安装向导为中文。
;
; 插件加载走 DeepSeek Harness 的默认机制：DSH_HOME 是安装目录内的 data
; （自包含），由安装包在启动时把引擎内置包 heal 进该家园，不依赖用户的
; ~/.dsh。托盘宿主（DeepSeek Harness.exe）是唯一入口；"纯净启动"由它在
; 运行时用一个临时空 DSH_HOME（<install>\clean-data）启动实现。
;
; Requires Inno Setup 6+ (ISCC.exe) on the build machine.

#define MyAppName "DeepSeek Harness Web"
#define MyAppVersion "0.1.1"
#define MyAppPublisher "DeepSeek AI"
; The system-tray host is the app users launch.
#define MyAppExeName "DeepSeek Harness.exe"

; The assembled install tree, relative to this .iss file (packaging/windows-web/).
#define Stage "..\..\dist-windows-web"

[Setup]
AppId={{8D2B1C9A-4B0E-4F6C-9A2E-7C1D5E3F0A2B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install: no admin needed; the writable DSH_HOME (install\data) stays writable.
PrivilegesRequired=lowest
; Install to C:\DeepSeekHarness: the engine's @mistralai SDK has ~229-char file
; paths, and a deeper prefix (e.g. %LOCALAPPDATA%\Programs\...) pushes the full
; path past Inno's 260-char MAX_PATH. C:\DeepSeekHarness keeps it at 254.
DefaultDirName=C:\DeepSeekHarness
; Don't reuse a previous install directory: a stale user-chosen path (e.g. a
; root-level test install) would otherwise override DefaultDirName on upgrade.
UsePreviousAppDir=no
DisableProgramGroupPage=yes
OutputDir={#Stage}
OutputBaseFilename=DeepSeekHarnessSetup
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
; 中文安装向导：语言文件由 build.ts 复制到编译目录（相对 .iss）。
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Files]
; The system-tray host (the app entry).
Source: "{#Stage}\DeepSeek Harness.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
; Bundled Node runtime.
Source: "{#Stage}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; The web engine closure (host + client plugins, cordis, frontend dist).
Source: "{#Stage}\engine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Writable, install-local DSH_HOME; the harness heals the engine's built-in
; packages into it on first run (kept on uninstall so sessions/credentials persist).
Name: "{app}\data"; Flags: uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Only remove the install tree; the install-local DSH_HOME ({app}\data) persists.
