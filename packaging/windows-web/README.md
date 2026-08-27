# DeepSeek Harness Web — Windows installer build

This directory packages `dsh web` (the browser GUI) as a Windows installer. The
result is a per-user install with a single native tray-host entry point:

1. A native system-tray host (`DeepSeek Harness.exe`) you double-click / launch
   from the tray. It spawns the web engine, listens in the tray ("打开页面" /
   "退出"), and opens your default browser automatically on first launch.
2. The host boots the web engine, serves the frontend dist, and shows the page in
   a tray icon; the port is a random OS-assigned one (no 3080 collision).
3. Plugin loading uses the harness's own default mechanism: **DSH_HOME is the
   install-local `data` home**, and the `web` profile's own `cordis.patch.yml`
   mounts the plugins installed there. There is no separate `plugins/` directory.

## What the build produces

```
dist-windows-web/
  DeepSeek Harness.exe   native (Go) system-tray host — the app entry
  node/                  bundled Node runtime (the user needs no Node install)
  engine/                the web engine closure (@deepseek-ai/dsh deploy)
                         (node_modules/…: host + client plugins, cordis,
                          dsh-base, dsh-web-app, web-frontend dist)
dsh-web-setup.exe        ← build --iscc compiles this from the above
```

The tray host reuses the existing `dsh web` surface end to end: it spawns
`node <install>/node/node.exe <install>/engine/lib/bin.js web --port 0 --no-open`,
reads the printed URL to learn the actual port, and shows a tray icon with
"打开页面" / "退出". The web profile composes `dsh-base` + `dsh-web-app` and
serves the built frontend dist. No `--patch` is passed, so plugin mounting rides
the `web` profile's own `cordis.patch.yml` — the harness's default load path.

### DSH_HOME is install-local and self-contained

DSH_HOME is the install-local `data` directory (`<install>\data`). On first
launch the harness heals the engine's full set of built-in packages into it
(via its module-fallback mechanism), so the install boots reproducibly without
depending on the user's `~/.dsh`. Plugins are installed into this home's `web`
profile node_modules. It stays self-contained: the install tree does not read
or modify the source-build `~/.dsh`.

### Harness guardian

The tray host is a guardian for the harness server process. If the child exits
abnormally (it crashes, is killed, or otherwise dies before an explicit quit),
the tray restarts it automatically with a short delay. After too many crashes
in a 30 s window (5 by default) the reboot is dropped and the reason is
surfaced via the tray status item, the tooltip, and the log file. Choosing
"退出" sets the stopping flag so a quit is never followed by a restart. The
harness `stderr` is written to `<DSH_HOME>\harness.log` (the tray app has no
console) so a crash's cause is diagnosable even when only a status item is
shown.

### "纯净启动" (clean start) in the tray menu

A tray checkbox "纯净启动" toggles whether the harness boots against a
**temporary empty DSH_HOME** (`<install>\clean-data`) instead of the normal
`<install>\data` home. That home's `web` profile is never seeded with plugins,
so no user plugin is loaded at all — isolating whether a crash or misbehavior
is caused by an installed plugin while keeping the core `dsh-base` +
`dsh-web-app` composition. Toggling the checkbox restarts the harness to apply
the new home, and resets the crash counter so a manual switch is never counted
as a crash. The normal `<install>\data` home is never touched, so the toggle is
fully reversible.

> The harness child process is spawned with `CREATE_NO_WINDOW`, so no console
> window is created even though the host itself is a GUI app.

## Prerequisites (on the build machine)

- Node `^22.19 || >=24` and pnpm (`pnpm@11.7.0`).
- A Node **distribution** to bundle (a folder containing `node.exe`) — pass it via
  `--node-dir`. A bare running `node.exe` is not the full distribution.
- Go toolchain to build the tray host (or a prebuilt `DeepSeek Harness.exe`).
- Inno Setup 6+ (`ISCC.exe`) only to compile the installer. Optional: the build
  stops at the install tree without `--iscc`. The installer wizard is Chinese;
  `build.ts` copies `languages/ChineseSimplified.isl` next to the compiled
  `.iss`, so no separate Inno language-pack install is needed.

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

Double-click `DeepSeek Harness.exe` (already-installed: the Start menu / desktop
shortcut). It uses the install-local `data` home, boots the `web` profile with
its plugins mounted, and opens the browser. The tray menu offers "打开页面" /
"纯净启动" / "退出".

## Verified on Windows

Built and exercised end to end on a real Windows host with this scaffold:

- **Engine closure** — `pnpm deploy` of `@deepseek-ai/dsh` produces `engine/`
  (~187 MB) including the frontend dist. `pnpm deploy` drops some
  `@deepseek-ai/*` workspace packages, so the build restores the missing
  workspace closure (cosmokit, schemastery, cordis-plugin-group, and transitively
  the rest) as a self-healing step.
- **Tray host** — `go build -ldflags "-H windowsgui"` yields a console-less
  `DeepSeek Harness.exe` that boots `dsh web` and serves the page (HTTP 200 with
  `__DSH_BOOT__`).
- **Installer** — `pnpm run build && pnpm run build:web` then
  `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`
  produces `dist-windows-web\dsh-web-setup.exe`.

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
pipeline and the self-contained DSH_HOME/plugin contract are in place; the
remaining work is Windows-specific verification and the plugin resolution of the
install-local `data` home.
