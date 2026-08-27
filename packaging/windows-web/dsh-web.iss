; DeepSeek Harness Web GUI installer.
;
; Sources the assembled install tree (dist-windows-web/) produced by
; `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`
; and compiles a single setup .exe. 安装向导为中文；安装时让用户选择
; "数据与插件家园"（DSH_HOME）,默认使用用户主目录（~/.dsh），与源码启动
; DeepSeek Harness 的方式一致,因此插件可和源码版同步共享。运行时启动器
; （dsh-web.exe / DeepSeek Harness.exe）读取 <install>\dsh-config.txt 里
; 写入的 DSH_HOME 来决定数据与插件目录。
;
; Requires Inno Setup 6+ (ISCC.exe) on the build machine.

#define MyAppName "DeepSeek Harness Web"
#define MyAppVersion "0.1.1"
#define MyAppPublisher "DeepSeek AI"
; The system-tray host is the app users launch; the pkg launcher stays installed but secondary.
#define MyAppExeName "DeepSeek Harness.exe"
#define MyLauncherExeName "dsh-web.exe"

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
; 中文安装向导：语言文件由 build.ts 复制到编译目录（相对 .iss）。
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Files]
; The system-tray host (primary app entry) and the pkg launcher (secondary).
Source: "{#Stage}\DeepSeek Harness.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "{#Stage}\dsh-web.exe"; DestDir: "{app}"; DestName: "{#MyLauncherExeName}"; Flags: ignoreversion
; Bundled Node runtime.
Source: "{#Stage}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; The web engine closure (host + client plugins, cordis, frontend dist).
Source: "{#Stage}\engine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Writable plugin directory and data home; created writable by the user.
; （插件最终落在所选 DSH_HOME 的 web profile 里；此处仍保留 install 的
;   plugins/ 作为"用户放插件的友好入口"，启动器会把它 junction 到所选
;   DSH_HOME 的 profile。）
Name: "{app}\plugins"; Flags: uninsneveruninstall
; 只有用户选择"安装目录内 data"时才真正需要这个目录；默认 ~/.dsh 时
; 该目录不会被用作 DSH_HOME。保留创建以避免启动器首次运行时报目录缺失。
Name: "{app}\data"; Flags: uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Keep user plugins and data on uninstall; only remove the install tree.
; (Inno never deletes {app} by default, so plugins/data persist.)

[Code]
const
  ; 配置文件键：写入 <install>\dsh-config.txt，启动器/托盘宿主读取。
  DataHomeKey = 'DSH_HOME';

var
  DataHomePage: TInputOptionWizardPage;

; 初始化向导：在"选择安装目录"页之后，插入"选择数据与插件家园"页。
procedure InitializeWizard();
begin
  DataHomePage := CreateInputOptionPage(
    wpSelectDir,
    '选择数据与插件家园',
    '决定 DeepSeek Harness 的数据与插件存放位置',
    '请选择 DSH_HOME（数据与插件目录）。默认使用用户主目录，与源码启动 DeepSeek Harness 的方式一致，插件可在源码版与安装版之间同步共享。',
    True, False, '');

  DataHomePage.Add(
    '使用用户主目录 ~/.dsh（默认，推荐）'#13#10 +
    '与源码启动一致；插件安装到 ~/.dsh\profiles\web，两端共享。');

  DataHomePage.Add(
    '使用安装目录内的 data（自包含）'#13#10 +
    '数据与插件完全独立，不写入用户主目录。');

  DataHomePage.SelectedValueIndex := 0;
end;

; 根据用户选择计算 DSH_HOME。
function ResolveDataHome(): string;
var
  Selected: Integer;
begin
  Selected := DataHomePage.SelectedValueIndex;
  if Selected = 0 then
    Result := ExpandConstant('{userprofile}') + '\.dsh'
  else
    Result := ExpandConstant('{app}') + '\data';
end;

; 安装完成后，把用户选择的 DSH_HOME 写入 <install>\dsh-config.txt。
procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath: string;
  Line: string;
begin
  if CurStep = ssPostInstall then begin
    ConfigPath := ExpandConstant('{app}\dsh-config.txt');
    Line := DataHomeKey + '=' + ResolveDataHome() + #13#10;
    if not SaveStringToFile(ConfigPath, Line, False) then
      MsgBox('无法写入数据家园配置文件：' + ConfigPath + #13#10 +
             '将回退到安装目录内的 data。', mbError, MB_OK);
  end;
end;
