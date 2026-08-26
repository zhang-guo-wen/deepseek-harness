/**
 * Build a Windows-installable DeepSeek Harness Web GUI.
 *
 * Produces an install tree under `dist-windows-web/` with the shape the
 * installer (`dsh-web.iss`) compiles into a setup .exe:
 *
 *   dist-windows-web/
 *     dsh-web.exe            thin pkg-compiled launcher (spawns the installed dsh web)
 *     node/                  bundled Node runtime (the user needs no Node install)
 *     engine/                the web engine closure (`@deepseek-ai/dsh-cli` deploy)
 *       node_modules/...     host + client plugins, cordis, dsh-base, dsh-web-app, web-frontend dist
 *     plugins/               ★ user plugin directory (empty by default)
 *       cordis.patch.yml     the extra patch layer the launcher passes as `--patch`
 *     data/                  writable DSH home (profiles, storage, credentials), created on first run
 *
 * The launcher owns the runtime semantics, not this script:
 *   - it sets `DSH_HOME` to `<install>/data` and `DSH_CWD` to the working dir,
 *   - it boots `dsh web` with `--patch <install>/plugins/cordis.patch.yml`,
 *   - the engine resolves the web composition, serves the frontend dist, and
 *     opens the default browser.
 *
 * Steps mirror the proven `scripts/build-exe-for-python-sdk.ts` pipeline
 * (build → pnpm deploy --prod --hoisted → restore hoists → materialize links),
 * then add the install-specific assembly.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { lstat, cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..', '..')

/** The app whose production dependency closure IS the web engine. */
const DEPLOY_ROOT_PACKAGE = '@deepseek-ai/dsh'
/** Output root for the assembled install tree. */
const OUT_DIR = 'dist-windows-web'
/** Where the engine closure is materialized inside the install tree. */
const ENGINE_SUBDIR = 'engine'
/** Bundled Node runtime directory inside the install tree. */
const NODE_SUBDIR = 'node'
/** User plugin directory inside the install tree. */
const PLUGINS_SUBDIR = 'plugins'
/** Writable DSH home directory, created on first launch. */
const DATA_SUBDIR = 'data'
/** The launcher source pkg compiles into dsh-web.exe. */
const LAUNCHER_SRC = 'packaging/windows-web/launcher.js'
/** The dsh bin inside the deployed engine (the deploy root is the app package). */
const ENGINE_DASH_BIN = 'lib/bin.js'
/** Installer output name. */
const SETUP_OUTPUT = 'dsh-web-setup.exe'
/** The native system-tray host app entry. */
const TRAY_EXE = 'DeepSeek Harness.exe'
/** Pinned pkg spec for the thin launcher. */
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'

/** Staged install root. */
const STAGE = resolve(root, OUT_DIR)
/** Deployed engine root. */
const ENGINE_STAGE = join(STAGE, ENGINE_SUBDIR)

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/** Render a command for logs and errors, quoting arguments with spaces. */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/** Validated CLI configuration; construction owns help and parse-error exits. */
class BuildCli {
  private constructor(
    readonly skipBuild: boolean,
    readonly dryRun: boolean,
    /** Path to a Node distribution (folder containing node.exe) to bundle. */
    readonly nodeDir: string | undefined,
    /** Path to the Inno Setup compiler (ISCC.exe); skip the installer step when absent. */
    readonly iscc: string | undefined,
  ) { }

  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-windows-web: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    return new BuildCli(
      values['skip-build'] ?? false,
      values['dry-run'] ?? false,
      values['node-dir'] as string | undefined,
      values['iscc'] as string | undefined,
    )
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'node-dir': { type: 'string' },
        'iscc': { type: 'string' },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx packaging/windows-web/build.ts [flags]',
      '',
      '  --skip-build         skip `pnpm run build` and `pnpm run build:web` (lib/ + dist/ must exist).',
      '  --node-dir <path>    path to a Node distribution folder (must contain node.exe) to bundle.',
      '  --iscc <path>        path to ISCC.exe to compile the installer; omit to stop at the install tree.',
      '  --dry-run            print every command and filesystem change without executing.',
      '  --help               print this help.',
      '',
      `Assembles the install tree in ${STAGE}; the launcher is compiled with ${PKG_SPEC}.`,
      `The engine closure is ${DEPLOY_ROOT_PACKAGE}'s production dependency tree (${ENGINE_SUBDIR}/).`,
    ].join('\n')
  }
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include the
 * command; dry runs print commands and filesystem changes.
 */
class WindowsWebBuild {
  constructor(private readonly cli: BuildCli) {}

  private get dryRun(): boolean {
    return this.cli.dryRun
  }

  /** Build all package artifacts and the frontend dist unless `--skip-build`. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-windows-web: skipping pnpm run build / build:web (--skip-build)')
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
    await this.run('build:web', pnpmBin(), ['run', 'build:web'])
  }

  /** Clear and re-create the install root. */
  async resetStage(): Promise<void> {
    if (STAGE === root || root.startsWith(STAGE + sep)) {
      throw new Error(`build-windows-web: refusing to clear stage dir ${STAGE}: it contains the repo root.`)
    }
    if (this.dryRun) console.log(`build-windows-web: [dry-run] rm -rf ${STAGE}`)
    else await rm(STAGE, { recursive: true, force: true })
  }

  /** Deploy the web engine closure into `<install>/engine`. */
  async deployEngine(): Promise<void> {
    await this.run('deploy', pnpmBin(), [
      '--filter', DEPLOY_ROOT_PACKAGE,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      ENGINE_STAGE,
    ])
    await this.materializeStagedLinks()
    await this.restoreMissingWorkspacePackages()
    this.assertEngineBin()
  }

  /** The deployed dsh bin must be present; fail loud so a half build cannot ship. */
  private assertEngineBin(): void {
    const bin = join(ENGINE_STAGE, ENGINE_DASH_BIN)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] expect engine bin at ${bin}`)
      return
    }
    if (!existsSync(bin)) {
      throw new Error(`build-windows-web: ${bin} missing — run without --skip-build so lib/ artifacts exist.`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.dryRun) {
      console.log('build-windows-web: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(ENGINE_STAGE, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const source = await realpath(remaining)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(remaining, { recursive: true, force: true })
      await cp(source, remaining, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /**
   * Restore any `@deepseek-ai/*` workspace package the deployed closure imports
   * (or peers) that `pnpm deploy` did not materialize. pnpm deploy drops some
   * vendored `link:`/workspace packages (e.g. `@deepseek-ai/cosmokit`,
   * `@deepseek-ai/schemastery`, `@deepseek-ai/cordis-plugin-group`); without the
   * single shared instance the deployed cordis cannot resolve its foundation
   * imports. This BFS-es the deployed package graph and copies in any missing
   * workspace package, transitively.
   */
  private async restoreMissingWorkspacePackages(): Promise<void> {
    const scopeDir = join(ENGINE_STAGE, 'node_modules', '@deepseek-ai')
    if (!existsSync(scopeDir)) return
    const workspace = await this.workspacePackageMap()
    const queue: string[] = []
    // Seed with every @deepseek-ai/* package already present in the deploy.
    for (const entry of await readdir(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(scopeDir, entry.name)
      if (existsSync(join(dir, 'package.json'))) queue.push(dir)
    }
    const restored: string[] = []
    const seen = new Set<string>()
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (seen.has(next)) continue
      seen.add(next)
      const manifest = JSON.parse(await readFile(join(next, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      const deps = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
      for (const dep of deps) {
        if (!dep.startsWith('@deepseek-ai/')) continue
        const source = workspace.get(dep)
        if (source === undefined) continue
        const destination = join(scopeDir, dep.slice('@deepseek-ai/'.length))
        if (seen.has(destination) || existsSync(destination)) continue
        if (this.dryRun) {
          console.log(`build-windows-web: [dry-run] restore workspace package ${dep} → ${destination}`)
          restored.push(dep)
          queue.push(destination)
          continue
        }
        await cp(source, destination, {
          recursive: true,
          dereference: true,
          filter: path => basename(path) !== 'node_modules' && !path.includes(`${sep}node_modules${sep}`),
        })
        restored.push(dep)
        queue.push(destination)
      }
    }
    if (restored.length > 0 && !this.dryRun) {
      console.log(`build-windows-web: restored workspace packages: ${[...new Set(restored)].join(', ')}`)
    }
  }

  /** Map every workspace `@deepseek-ai/*` package name to its directory. */
  private async workspacePackageMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const rootDir of ['vendor', 'packages', 'apps']) {
      await this.scanManifests(resolve(root, rootDir), map)
    }
    return map
  }

  /** Recursively collect package.json → name→dir entries under `dir`, ignoring build outputs. */
  private async scanManifests(dir: string, map: Map<string, string>): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(await readFile(manifest, 'utf8')) as { name?: string }
        if (typeof parsed.name === 'string' && parsed.name.startsWith('@deepseek-ai/')) map.set(parsed.name, dir)
      } catch {
        // Unreadable manifest: skip it.
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (['node_modules', 'lib', 'dist', 'types'].includes(entry.name)) continue
      await this.scanManifests(join(dir, entry.name), map)
    }
  }

  /** Bundle a Node runtime into `<install>/node`. */
  async copyNodeRuntime(): Promise<void> {
    const nodeDir = this.cli.nodeDir
    if (nodeDir === undefined) {
      if (this.dryRun) {
        console.log('build-windows-web: [dry-run] bundle Node runtime into node/ (pass --node-dir)')
        return
      }
      throw new Error('build-windows-web: pass --node-dir <folder-with-node.exe> to bundle a Node runtime; a running node.exe alone is not the full distribution.')
    }
    if (!existsSync(join(nodeDir, 'node.exe'))) {
      throw new Error(`build-windows-web: --node-dir ${nodeDir} does not contain node.exe.`)
    }
    const target = join(STAGE, NODE_SUBDIR)
    if (this.dryRun) console.log(`build-windows-web: [dry-run] cp -r ${nodeDir} → ${target}`)
    else await cp(nodeDir, target, { recursive: true, dereference: true, filter: p => basename(p) !== 'node_modules' })
  }

  /** Seed the plugin directory and its empty patch layer. */
  async seedPlugins(): Promise<void> {
    const plugins = join(STAGE, PLUGINS_SUBDIR)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] mkdir -p ${plugins}`)
      console.log(`build-windows-web: [dry-run] write ${join(plugins, 'cordis.patch.yml')}`)
      return
    }
    await mkdir(plugins, { recursive: true })
    await writeFile(
      join(plugins, 'cordis.patch.yml'),
      '# plugins/cordis.patch.yml — the launcher passes this to `dsh web` as --patch.\n'
        + '# Add loader patch rows below (id-targeted config overrides, disables, insert lists).\n'
        + '[]\n',
      'utf8',
    )
  }

  /** Create the writable data home directory (DSH_HOME) the launcher uses. */
  async seedDataDir(): Promise<void> {
    const data = join(STAGE, DATA_SUBDIR)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] mkdir -p ${data}`)
      return
    }
    await mkdir(data, { recursive: true })
  }

  /** Compile the thin launcher into `dsh-web.exe`. */
  async compileLauncher(): Promise<void> {
    const product = join(STAGE, 'dsh-web.exe')
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] pkg ${LAUNCHER_SRC} → ${product}`)
      return
    }
    await this.run('pkg launcher', pnpmBin(), [
      'dlx', PKG_SPEC,
      resolve(root, LAUNCHER_SRC),
      '--targets', 'node24-win32-x64',
      '--output', product,
    ])
    if (!existsSync(product)) {
      throw new Error(`build-windows-web: launcher ${product} is missing after the pkg run.`)
    }
  }

  /** Build the native Go system-tray host into the install root. */
  async buildTrayHost(): Promise<void> {
    const product = join(STAGE, TRAY_EXE)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] go build -ldflags "-H windowsgui" → ${product}`)
      return
    }
    // Reuse a prebuilt tray host if present, so a later build needs no Go toolchain.
    if (existsSync(product)) {
      console.log(`build-windows-web: reusing prebuilt tray host ${product}`)
      return
    }
    const srcDir = resolve(root, 'packaging/windows-web/tray-host')
    if (!existsSync(join(srcDir, 'go.mod'))) {
      throw new Error('build-windows-web: tray-host go.mod missing.')
    }
    process.env.GOPROXY = process.env.GOPROXY || 'https://goproxy.cn,direct'
    await this.run('build tray host', 'go', [
      'build', '-C', srcDir, '-ldflags', '-H windowsgui', '-o', product, '.',
    ])
    if (!existsSync(product)) {
      throw new Error(`build-windows-web: tray host ${product} missing after go build.`)
    }
  }

  /** Compile the installer when ISCC is available. */
  async compileInstaller(): Promise<void> {
    const iscc = this.cli.iscc
    if (iscc === undefined) {
      console.log('build-windows-web: no --iscc given; stopping at the install tree.')
      return
    }
    const setup = join(STAGE, SETUP_OUTPUT)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] ISCC dsh-web.iss → ${setup}`)
      return
    }
    // Inno Setup 6 fails on source paths approaching MAX_PATH, and the web
    // engine's deep dependency tree (pi-ai -> mistralai) reaches that at a
    // normal checkout path. Compile from a short-path copy so `--iscc` works
    // from any checkout, then move the setup back into the stage.
    const shortStage = this.shortInstallerStage()
    await this.copyForInstaller(shortStage)
    const tempIss = join(shortStage, 'dsh-web.iss')
    const template = await readFile(resolve(root, 'packaging/windows-web/dsh-web.iss'), 'utf8')
    await writeFile(tempIss, template.replace(/#define Stage ".*"/, `#define Stage "${shortStage}"`), 'utf8')
    await this.run('installer', iscc, [tempIss])
    const stagedSetup = join(shortStage, SETUP_OUTPUT)
    if (!existsSync(stagedSetup)) {
      throw new Error(`build-windows-web: installer ${stagedSetup} not found after ISCC.`)
    }
    await cp(stagedSetup, setup, { dereference: true })
    await rm(shortStage, { recursive: true, force: true })
    console.log(`build-windows-web: installer ready at ${setup} (${(statSync(setup).size / 1024 / 1024).toFixed(1)} MB)`)
  }

  /** A short compile path for ISCC so deep dependency paths stay under MAX_PATH. */
  private shortInstallerStage(): string {
    const drive = process.env.SystemDrive ?? 'C:'
    return join(drive, 'dshw-bundle')
  }

  /** Copy the install-tree sources the installer needs into a short stage. */
  private async copyForInstaller(shortStage: string): Promise<void> {
    await rm(shortStage, { recursive: true, force: true })
    await mkdir(shortStage, { recursive: true })
    await cp(join(STAGE, TRAY_EXE), join(shortStage, TRAY_EXE))
    await cp(join(STAGE, 'dsh-web.exe'), join(shortStage, 'dsh-web.exe'))
    await cp(join(STAGE, NODE_SUBDIR), join(shortStage, NODE_SUBDIR), { recursive: true, dereference: true })
    await cp(join(STAGE, ENGINE_SUBDIR), join(shortStage, ENGINE_SUBDIR), { recursive: true, dereference: true })
  }

  /** Print the assembled tree summary. */
  async printSummary(): Promise<void> {
    const entries = [TRAY_EXE, 'dsh-web.exe', NODE_SUBDIR, ENGINE_SUBDIR, PLUGINS_SUBDIR, DATA_SUBDIR]
    console.log('build-windows-web: install tree:')
    for (const name of entries) {
      const p = join(STAGE, name)
      if (this.dryRun || !existsSync(p)) {
        console.log(`  ${p}`)
        continue
      }
      console.log(`  ${p}  (${(await this.dirBytes(p) / 1024 / 1024).toFixed(1)} MB)`)
    }
  }

  /** Recursive byte count of a path (files only; a directory's own size is not its contents). */
  private async dirBytes(path: string): Promise<number> {
    const stat = statSync(path)
    if (stat.isFile()) return stat.size
    let sum = 0
    for (const entry of await readdir(path, { withFileTypes: true })) {
      sum += await this.dirBytes(join(path, entry.name))
    }
    return sum
  }

  /** Run one subprocess with inherited stdio; dry runs print only. */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.dryRun) {
      console.log(`build-windows-web: [dry-run] ${printable}`)
      return
    }
    console.log(`build-windows-web: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      // On Windows, `.cmd`/`.ps1` launchers (pnpm, corepack) cannot be launched
      // by CreateProcess directly, and a command path with spaces (e.g. ISCC
      // under "Program Files") would be split by the shell if handed as
      // (command, args). Route through the shell with a single, already-quoted
      // command line, which `formatCommand` produces.
      const child = process.platform === 'win32'
        ? spawn(printable, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, CI: 'true' } })
        : spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
      child.once('error', (error) => {
        reject(new Error(`build-windows-web: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) { resolvePromise(); return }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-windows-web: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new WindowsWebBuild(cli)
  console.log(`build-windows-web: staging: ${STAGE}`)
  await pipeline.build()
  await pipeline.resetStage()
  await pipeline.deployEngine()
  await pipeline.copyNodeRuntime()
  await pipeline.seedPlugins()
  await pipeline.seedDataDir()
  await pipeline.compileLauncher()
  await pipeline.buildTrayHost()
  await pipeline.compileInstaller()
  await pipeline.printSummary()
}

await main()
