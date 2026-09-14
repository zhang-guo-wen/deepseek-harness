# DeepSeek Harness Web — Windows 安装程序构建

[English](README.md) | 中文

本目录把 `dsh web`（浏览器 GUI）打包为 Windows 安装程序，产物是按用户安装、只有一个原生托盘宿主入口的程序：

1. 一个原生系统托盘宿主（`DeepSeek Harness.exe`），你可以双击它，也可以从托盘启动。它启动 Web 引擎，在托盘中响应（"打开页面" / "退出"），并在首次启动时自动打开默认浏览器。
2. 宿主启动 Web 引擎，提供前端 dist，并在托盘图标中展示页面；端口由操作系统随机分配（不会与 3080 冲突）。
3. 插件加载沿用 harness 自身的默认机制：**DSH_HOME 就是用户的 `~/.dsh`**，由 `web` profile 自己的 `cordis.patch.yml` 挂载安装在该 home 中的插件。不存在单独的 `plugins/` 目录。

## 构建产物

```
dist-windows-web/
  DeepSeek Harness.exe   native (Go) system-tray host — the app entry
  node/                  bundled Node runtime (the user needs no Node install)
  engine/                the web engine closure (@deepseek-ai/dsh deploy)
                         (node_modules/…: host + client plugins, cordis,
                          dsh-base, dsh-web-app, web-frontend dist)
DeepSeekHarnessSetup.exe        ← build --iscc compiles this from the above
```

托盘宿主端到端复用现有的 `dsh web` 接口：它启动 `node <install>/node/node.exe <install>/engine/lib/bin.js web --port 0 --no-open`，读取打印出的 URL 以获知实际端口，并显示带"打开页面" / "退出"的托盘图标。web profile 组合 `dsh-base` + `dsh-web-app` 并提供构建好的前端 dist。由于不传 `--patch`，插件挂载沿用 `web` profile 自己的 `cordis.patch.yml`，也就是 harness 的默认加载路径。

### DSH_HOME 就是用户的默认 home

DSH_HOME 是用户的默认 Harness home（`~/.dsh`，Windows 上为 `%USERPROFILE%\.dsh`），与从源码构建的 `dsh` 共用。通过官方 `dsh plugin` 路径安装的插件落在该 home 的 `web` profile 的 node_modules 中，并由其 `cordis.patch.yml` 挂载；会话、设置与凭据也存放在那里。首次启动时，harness 照常把引擎内置包修复进该 home 的模块回退目录。

### harness 守护者

托盘宿主是 harness 服务进程的守护者。如果子进程异常退出（崩溃、被杀，或在显式退出前以其他方式死亡），托盘会在短暂延迟后自动重启它。当 30 秒窗口内崩溃次数过多（默认为 5 次）时，重启会被放弃，并通过托盘状态项、工具提示与日志文件说明原因。选择"退出"会置位停止标志，因此退出之后绝不会再重启。harness 的 `stderr` 写入 `<DSH_HOME>\harness.log`（托盘应用没有控制台），因此即使只显示状态项，也能诊断崩溃原因。

### 反复崩溃时的"纯净启动"

当 harness 反复启动失败（30 秒窗口内崩溃超过 5 次，通常是因为某个已安装插件在加载时抛错）时，托盘宿主会弹出 Windows 对话框，询问是否进入"纯净启动"。选择 **是** 时，它会让 harness 针对一个**临时的空 DSH_HOME**（`<install>\clean-data`）启动，而不是正常的 `~/.dsh` home。该 home 的 `web` profile 从不植入插件，因此完全不加载任何用户插件，从而在保留核心 `dsh-base` + `dsh-web-app` 组合的同时，隔离出崩溃是否由已安装插件引起。选择 **否** 时，托盘停止重启并退出守护者。正常的 `~/.dsh` home 绝不会被修改，因此纯净启动完全可逆（关闭托盘并重新启动即可回到你正常的 home）。

> harness 子进程以 `CREATE_NO_WINDOW` 启动，因此即使宿主本身是 GUI 应用，也不会创建控制台窗口。

## 前置条件（构建机上）

- Node `^22.19 || >=24` 与 pnpm（`pnpm@11.7.0`）。
- 用于打包的 Node **发行版**（包含 `node.exe` 的文件夹），通过 `--node-dir` 传入。单独一个正在运行的 `node.exe` 不是完整发行版。
- 构建托盘宿主的 Go 工具链（或预构建好的 `DeepSeek Harness.exe`）。
- 仅在编译安装程序时需要 Inno Setup 6+（`ISCC.exe`）。该步骤可选：不带 `--iscc` 时构建会停在安装树。安装向导为中文；`build.ts` 会把 `languages/ChineseSimplified.isl` 复制到编译产物 `.iss` 旁，因此无需单独安装 Inno 语言包。

## 构建

在仓库根目录执行：

```sh
pnpm install
pnpm run build            # host + client lib artifacts
pnpm run build:web        # frontend dist into apps/web/dist
pnpm exec tsx packaging/windows-web/build.ts --node-dir <node-dist> --iscc <ISCC.exe>
```

- `--skip-build` 复用已有产物；`--dry-run` 打印执行计划。
- `--rebuild-tray-host` 强制重新执行托盘宿主的 `go build`，而不是复用预构建的 `DeepSeek Harness.exe`（修改 `tray-host/main.go` 后需要，否则陈旧的预构建产物会掩盖改动）。
- 不带 `--iscc` 时只会得到 `dist-windows-web/` 目录树；对 `packaging/windows-web/dsh-web.iss` 运行 Inno Setup 即可编译出 `DeepSeekHarnessSetup.exe`。

## 运行

双击 `DeepSeek Harness.exe`（已安装后为开始菜单或桌面快捷方式）。它使用用户的默认 `~/.dsh` home，启动挂载了插件的 `web` profile，并打开浏览器。托盘菜单提供"打开页面" / "纯净启动" / "退出"。

## 已在 Windows 上验证

使用这套脚手架在真实 Windows 宿主上完成了端到端构建与验证：

- **引擎闭包**：`@deepseek-ai/dsh` 经 `pnpm deploy` 生成 `engine/`（约 187 MB），其中包含前端 dist。`pnpm deploy` 会丢弃部分 `@deepseek-ai/*` 工作区包，因此构建会把缺失的工作区闭包（cosmokit、schemastery、cordis-plugin-group 及其传递依赖）作为自愈步骤恢复。
- **托盘宿主**：`go build -ldflags "-H windowsgui"` 生成无控制台的 `DeepSeek Harness.exe`，它启动 `dsh web` 并提供页面（HTTP 200，含 `__DSH_BOOT__`）。
- **安装程序**：先执行 `pnpm run build && pnpm run build:web`，再执行 `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`，产出 `dist-windows-web\DeepSeekHarnessSetup.exe`。

### 为什么安装程序从短路径编译

Inno Setup 6 无法读取接近 MAX_PATH 的源路径，而 Web 引擎很深的依赖树（`pi-ai` → `mistralai`，在常规检出路径下约 253 个字符）会触达该上限。`build.ts` 把安装树复制到 `C:\dshw-bundle`（短路径）并在那里编译临时的 .iss，然后把 `DeepSeekHarnessSetup.exe` 移回 `dist-windows-web/`。这样 `--iscc` 在任何检出路径下都可用，长仓库路径也因此不会破坏构建。

## 后续待办

发布前仍值得在目标机上确认：从 `{localappdata}` 移交默认浏览器的确切行为，Windows 原生依赖（`node-pty`、ripgrep）能否在部署后的 `pnpm install` 中解析，以及真实插件的 `apply` 是否能在运行中的目录树里被观察到（harness logger 会抑制子进程的 `console.*`/stdout，因此应使用工具或宿主信号断言，而不是 console.log）。
- **沙箱取舍**：除非挂载 ACL 受限令牌执行器，否则 Windows 上的 web profile 可以运行不受限的本地 pwsh 执行器（取决于基础 bundle 的平台门禁）；需要选定沙箱姿态并记录下来。
- **准确体积**：见 `build.ts` 的汇总；该安装远大于 Python SDK EXE（Web GUI 是完整产品）。

这些缺口正是它目前是脚手架而非已交付产物的原因：流水线以及共享 DSH_HOME 与插件约定已经就位，剩下的工作是 Windows 专项验证以及默认 `~/.dsh` home 的插件解析。
