# DeepSeek Harness Web — Windows installer build

This directory packages `dsh web` (the browser GUI) as a Windows installer. The
result is a per-user install:

1. A native system-tray host (`DshWebTray.exe`) you double-click / launch from the
   tray. It spawns the web engine, listens in the tray ("打开页面" / "退出"), and
   opens your default browser automatically on first launch.
2. The host boots the web engine, serves the frontend dist, and shows the page in
   a tray icon; the port is a random OS-assigned one (no 3080 collision).
3. The install directory has a `plugins/` folder; plugins added there are loaded
   without rebuilding the engine.

## What the build produces

```
dist-windows-web/
  DeepSeek Harness.exe   native (Go) system-tray host — the app entry
  dsh-web.exe            thin pkg-compiled launcher (secondary, no tray)
  node/
  engine/                the web engine closure (@deepseek-ai/dsh deploy)
  plugins/               ★ user plugin directory (+ cordis.patch.yml layer)
  data/                  fallback writable DSH home; the installer's default is ~/.dsh
dsh-web-setup.exe        ← build --iscc compiles this from the above
```

The installer records the chosen DSH_HOME in `<install>\dsh-config.txt`
(`DSH_HOME=<path>`); both the tray host and the launcher read it. `data/` is
used only when the user picks the self-contained option or no config exists.

The tray host reuses the existing `dsh web` surface end to end: it spawns
`node <install>/node/node.exe <install>/engine/lib/bin.js web --patch <install>/plugins/cordis.patch.yml --port 0 --no-open`,
reads the printed URL to learn the actual port, and shows a tray icon with
"打开页面" / "退出". The web profile composes `dsh-base` + `dsh-web-app`, serves
the built frontend dist; the plugin directory is just an extra `--patch` layer,
so it rides the shipped composition without changes to the engine.

### Harness guardian

The tray host is a guardian for the harness server process. If the child exits
abnormally (it crashes, is killed, or otherwise dies before an explicit quit),
the tray restarts it automatically with a short delay. After too many crashes
in a 30 s window (5 by default) the reboot is dropped and the reason is
surfaced via the tray status item, the tooltip, and the log file. Choosing
"退出" sets the stopping flag so a quit is never followed by a restart. The
harness `stderr` is now written to `<DSH_HOME>\harness.log` (the tray app has no
console) so a crash's cause is diagnosable even when only a status item is
shown.

## Prerequisites (on the build machine)

- Node `^22.19 || >=24` and pnpm (`pnpm@11.7.0`).
- A Node **distribution** to bundle (a folder containing `node.exe`) — pass it via
  `--node-dir`. A bare running `node.exe` is not the full distribution.
- Inno Setup 6+ (`ISCC.exe`) only to compile the installer. Optional: the build
  stops at the install tree without `--iscc`. The installer wizard is Chinese;
  `build.ts` copies `languages/ChineseSimplified.isl` next to the compiled
  `.iss`, so no separate Inno language-pack install is needed. (The shipped
  language file targets Inno 6.5.0+; on an older Inno the wizard falls back to
  its built-in English defaults for framework labels while the steps and info
  added here stay Chinese.)

## Build

From the repository root:

```sh
pnpm install
pnpm run build            # host + client lib artifacts
pnpm run build:web        # frontend dist into apps/web/dist
pnpm exec tsx packaging/windows-web/build.ts --node-dir <node-dist> --iscc <ISCC.exe>
```

- `--skip-build` reuses existing artifacts; `--dry-run` prints the plan.
- `--rebuild-tray-host` forces a fresh `go build` of the tray host instead of
  reusing a prebuilt `DeepSeek Harness.exe` (needed after editing
  `tray-host/main.go`, because a stale prebuilt would otherwise mask the change).
- Without `--iscc`, you get the `dist-windows-web/` tree; run Inno Setup on
  `packaging/windows-web/dsh-web.iss` to compile `dsh-web-setup.exe`.

## Run

Double-click `dsh-web.exe` (already-installed: the Start menu / desktop shortcut).
It boots the web profile, and opens the browser. Pass-through flags work from a
terminal, e.g. `dsh-web.exe --no-open` or `dsh-web.exe --port 8080`.

### Data & plugin home (DSH_HOME) is chosen at install time

The installer is a Chinese-language wizard that asks **"选择数据与插件家园"**
(choose the data & plugin home). The choice is recorded in
`<install>\dsh-config.txt` as `DSH_HOME=<path>`:

- **使用用户主目录 ~/.dsh（默认，推荐）** — the writable home is the same
  `~/.dsh` a source-launched DeepSeek Harness uses, so plugins installed into
  the `web` profile are shared between the source and the installed build.
- **使用安装目录内的 data（自包含）** — everything stays under
  `<install>\data`, fully independent and isolated from the user home.

Both `dsh-web.exe` and the `DeepSeek Harness.exe` tray host read
`dsh-config.txt` at launch and set `DSH_HOME` accordingly. When the file is
absent (e.g. an old install) they fall back to `<install>\data`.

## Adding a plugin

1. Install the plugin package into `<install>\plugins\node_modules\` (the launcher
   junctions that directory to the **chosen** home's `web` profile `node_modules`,
   so a plugin there lives inside the profile subtree and its `@deepseek-ai/cordis`
   import falls through to the installation's single instance via the healed
   `$DSH_HOME\profiles\node_modules` fallback). With the default `~/.dsh` home this
   is the same plugin home the source build uses.
2. Add a row to `<install>\plugins\cordis.patch.yml`:
   ```yaml
   - id: my-plugin
     name: '@dsh/my-plugin'
   ```
3. Restart the app. The plugin mounts on top of the shipped web composition.

`packaging/windows-web/sample-plugin/` is a minimal working example; copy its
patch row to try it.

## Verified on Windows

Built and exercised end to end on a real Windows host with this scaffold:

- **Engine closure** — `pnpm deploy` of `@deepseek-ai/dsh` produces `engine/`
  (~187 MB) including the frontend dist. `pnpm deploy` drops some
  `@deepseek-ai/*` workspace packages, so the build restores the missing
  workspace closure (cosmokit, schemastery, cordis-plugin-group, and transitively
  the rest) as a self-healing step.
- **Launcher exe** — `dsh-web.exe` (pkg-compiled, ~87 MB, bundles Node) runs
  and boots `dsh web`. The launcher spawns the bundled Node, so `openBrowser`'s
  handoff is unaffected by the pkg exe.
- **Plugin directory resolution** — the launcher junctions
  `plugins\node_modules` to the web profile's `node_modules`. A plugin dropped
  into `plugins\` lives inside the profile subtree and its `@deepseek-ai/cordis`
  import resolves via the healed `$DSH_HOME\profiles\node_modules` fallback to
  the one shared instance (validated on the Windows filesystem, including the
  junction + fall-through).
- **Installer** — `pnpm run build && pnpm run build:web` then
  `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`
  produces `dist-windows-web\dsh-web-setup.exe` (~68 MB). A silent install, then
  running the installed `dsh-web.exe`, boots `dsh web` and serves the page
  (HTTP 200 with `__DSH_BOOT__`).

### Why the installer compiles from a short path

Inno Setup 6 cannot read source paths approaching MAX_PATH, and the web
engine's deep dependency tree (`pi-ai` → `mistralai`, ~253 chars at a normal
checkout path) hits that. `build.ts` copies the install tree to
`C:\dshw-bundle` (short) and compiles a temporary .iss there, then moves
`dsh-web-setup.exe` back into `dist-windows-web/`. This makes `--iscc` work
from any checkout, and is why a long repo path does not break the build.

## Remaining follow-ups

Still worth confirming on the target before shipping: the exact default-browser
handoff from `{localappdata}`, that Windows native deps (`node-pty`, ripgrep)
resolve in the deployed `pnpm install`, and that a real plugin's `apply` is
observable in the running tree (the harness logger suppresses `console.*`/stdout
in the child, so assert with a tool or host signal rather than a console.log).
- **Sandbox trade-off** — the web profile on Windows can run the unconfined
  local pwsh executor (per the base bundle's platform gate) unless you mount the
  ACL restricted-token runner; pick the sandbox posture and document it.
- **Exact volume** — see `build.ts`'s summary; the install is far larger than
  the Python SDK exe (the web GUI is the full product).

These gaps are the reason this is a scaffold rather than a shipped artifact: the
pipeline and the plugin-directory contract are in place; the remaining work is
Windows-specific verification and the plugin-module-fallback resolution.
