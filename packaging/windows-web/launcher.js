#!/usr/bin/env node
// dsh-web — the DeepSeek Harness Web GUI launcher.
//
// This executable is pkg-compiled into `dsh-web.exe`. It is deliberately thin:
// it locates the installed engine and bundled Node, then spawns
// `node <install>/node/node.exe <install>/engine/lib/bin.js web --patch <install>/plugins/cordis.patch.yml`,
// forwarding its own argv and stdio. The `dsh web` surface boots the
// dsh-base + dsh-web-app composition, serves the frontend dist, and opens the
// default browser; the plugin directory is passed in as an extra `--patch`
// layer so plugins dropped into `plugins/` are mounted without rebuilding the
// engine.
//
// The writable DSH home (DSH_HOME) and the plugin home are decided at install
// time by the installer and recorded in `<install>/dsh-config.txt` as
// `DSH_HOME=<path>`. The launcher reads that file; when absent it falls back
// to `<install>/data` (the self-contained layout). The chosen DSH_HOME drives
// both the spawned process's DSH_HOME env and where `plugins/` is junctioned
// (the web profile's node_modules), so the user's "+ ~/.dsh" choice keeps
// plugins shared with a source-launched harness.
//
// NOTE: this file is pkg-compiled, so it must stay plain JavaScript (no
// TypeScript annotations) — pkg's Babel parser does not transform TS.
// It uses only Node built-ins so pkg can bundle it without a dependency tree.

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// In the packaged exe `process.execPath` is dsh-web.exe; its directory is the
// install root. In source execution (node launcher.js) it resolves to the
// process's own executable directory.
const INSTALL = dirname(process.execPath)

/** Config file the installer writes: records the chosen DSH_HOME. */
const CONFIG_FILE = join(INSTALL, 'dsh-config.txt')
/** Fallback DSH home when no config exists (self-contained layout). */
const DEFAULT_DATA_DIR = join(INSTALL, 'data')
/** Bundled Node runtime. */
const NODE_BIN = join(INSTALL, 'node', 'node.exe')
/** The deployed dsh command inside the engine closure (the deploy root is the app package). */
const DSH_BIN = join(INSTALL, 'engine', 'lib', 'bin.js')
/** The user-facing plugins directory. */
const PLUGINS_DIR = join(INSTALL, 'plugins')
/** User plugin packages land here; junctioned to the web profile's node_modules. */
const PLUGINS_NODE_MODULES = join(PLUGINS_DIR, 'node_modules')
/** User plugin patch layer. */
const PLUGIN_PATCH = join(PLUGINS_DIR, 'cordis.patch.yml')

function fail(message) {
  console.error(`dsh-web: ${message}`)
  console.error('dsh-web: the install is incomplete. Run the installer again, or build with `pnpm exec tsx packaging/windows-web/build.ts --node-dir <node> --iscc <ISCC.exe>`.')
  process.exit(1)
}

/**
 * Read the DSH_HOME recorded by the installer. The config is one
 * `DSH_HOME=<path>` line; a missing file, an unreadable file, or an empty
 * value all fall back to `<install>/data`.
 * @returns {string} the chosen DSH_HOME absolute path.
 */
function readConfigHome() {
  try {
    const text = readFileSync(CONFIG_FILE, 'utf8')
    const match = text.match(/^DSH_HOME\s*=\s*(.+)$/m)
    if (match && match[1].trim() !== '') return match[1].trim()
  } catch {
    // Missing/unreadable config: fall back to the self-contained data dir.
  }
  return DEFAULT_DATA_DIR
}

/** The writable DSH home the launcher will use (from config, else default). */
const DATA_DIR = readConfigHome()

/** The dsh web profile's own node_modules — the out-of-tree plugin home. */
const PROFILE_NODE_MODULES = join(DATA_DIR, 'profiles', 'web', 'node_modules')

/**
 * Make the user-facing `plugins/` directory the web profile's out-of-tree
 * plugin home by junctioning `plugins/node_modules` onto the web profile's
 * node_modules. A plugin dropped into `plugins/` then lives inside the profile
 * subtree so both its own resolution and its `@deepseek-ai/cordis` fall-through
 * (via the healed `$DSH_HOME/profiles/node_modules`) reach the one shared
 * cordis instance. Junction/symlink errors are non-fatal: the profile's own
 * node_modules is still a valid plugin home.
 */
function linkPluginsIntoProfile() {
  try {
    mkdirSync(PROFILE_NODE_MODULES, { recursive: true })
    mkdirSync(PLUGINS_DIR, { recursive: true })
    let stat
    try {
      stat = lstatSync(PLUGINS_NODE_MODULES)
    } catch {
      stat = undefined
    }
    if (stat !== undefined) {
      if (!stat.isSymbolicLink()) {
        // A real path the user manages directly; not our junction.
        return
      }
      if (readlinkSync(PLUGINS_NODE_MODULES) === PROFILE_NODE_MODULES) return
      unlinkSync(PLUGINS_NODE_MODULES)
    }
    symlinkSync(PROFILE_NODE_MODULES, PLUGINS_NODE_MODULES, 'junction')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`dsh-web: could not link plugins/ to the web profile (${reason}); install plugins into the profile node_modules instead.`)
  }
}

// The engine and bundled Node must exist; fail loud rather than spawn nothing.
if (!existsSync(NODE_BIN)) fail(`missing bundled Node at ${NODE_BIN}`)
if (!existsSync(DSH_BIN)) fail(`missing engine at ${DSH_BIN}`)

// First-run seeds: writable home, plugin-directory wiring, and plugin patch layer.
mkdirSync(DATA_DIR, { recursive: true })
linkPluginsIntoProfile()
if (!existsSync(PLUGIN_PATCH)) {
  writeFileSync(
    PLUGIN_PATCH,
    "# plugins/cordis.patch.yml — the launcher passes this to `dsh web` as --patch.\n# Add loader patch rows below (id-targeted config overrides, disables, insert lists).\n[]\n",
    'utf8',
  )
}

// The user invoked `dsh-web.exe [args...]` — forward everything to `dsh web`.
// Default to an OS-assigned random port so a double-click never collides with a
// fixed port; an explicit `--port` (or `--port=<n>`) always wins.
const forwarded = process.argv.slice(2)
const hasPort = forwarded.some((a) => a === '--port' || a.startsWith('--port='))
const args = ['web', '--patch', PLUGIN_PATCH, ...(hasPort ? [] : ['--port', '0']), ...forwarded]

const child = spawn(NODE_BIN, [DSH_BIN, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_HOME: DATA_DIR,
    DSH_CWD: process.cwd(),
  },
})

// Forward termination so the harness disposes its tree cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.once('error', (error) => {
  fail(`could not start the engine: ${error.message}`)
})

child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === undefined ? 1 : 0)
})
