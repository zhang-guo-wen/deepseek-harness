import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { load } from 'js-yaml'
import { ClaudeCompatMcp } from '../src/mcp-remote.ts'
import {
  MCP_CLIENT_MODULE,
  entryIds,
  entryListProblem,
  findEntryRows,
  presetLeafId,
  writeEntryListFile,
  writePresetComposition,
} from '../src/mcp-authoring.ts'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const stdio = { type: 'stdio' as const, command: 'engram', args: ['mcp'] }

let contexts: Context[] = []
let roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  contexts = []
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

async function globalHarness(content: string, patches?: readonly object[]): Promise<{ ctx: Context; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-claude-mcp-'))
  roots.push(root)
  const file = join(root, 'cordis.yml')
  await writeFile(file, content)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === MCP_CLIENT_MODULE) return { name: 'test-mcp-client', inject: [], apply: () => {} }
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as never
  await ctx.loader.create({
    id: 'include',
    name: 'cordis:include',
    config: { path: pathToFileURL(file).href, ...patches === undefined ? {} : { patches } },
  } as never)
  await ctx.loader.await()
  await ctx.plugin(ClaudeCompatMcp)
  await ctx.loader.await()
  return { ctx, file }
}

async function presetHarness(
  file: string,
  options: {
    trust?: string
    broken?: string
    absolutePath?: string
    provide?: boolean
    resolveError?: Error
    logger?: (message: string, ...args: unknown[]) => void
  } = {},
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  if (options.logger !== undefined) ctx.provide('logger', { warn: options.logger })
  await ctx.plugin(Loader)
  if (options.provide !== false) {
    ctx.provide('agentPresets', {
      resolve: async (id: string) => {
        if (options.resolveError !== undefined) throw options.resolveError
        return {
          id,
          trust: options.trust ?? 'user',
          path: options.absolutePath ?? file,
          ...(options.broken === undefined ? {} : { broken: options.broken }),
        }
      },
    })
  }
  await ctx.plugin(ClaudeCompatMcp)
  await ctx.loader.await()
  return ctx
}

async function writeMcpPreset(file: string, extra = ''): Promise<void> {
  await writeFile(file, [
    '- id: memory-engram',
    `  name: "${MCP_CLIENT_MODULE}"`,
    '  config:',
    '    transport: stdio',
    '    serverName: engram',
    '    command: engram',
    extra,
  ].filter(Boolean).join('\n'))
}

function rowsFrom(file: string): Promise<EntryOptions[]> {
  return readFile(file, 'utf8').then(content => load(content, { schema: entryListSchema }) as EntryOptions[])
}

describe('ClaudeCompatMcp', () => {
  it('adds, edits, and disables a row in a direct global Include', async () => {
    const { ctx, file } = await globalHarness([
      '- id: memory-engram',
      `  name: "${MCP_CLIENT_MODULE}"`,
      '  config:',
      '    transport: stdio',
      '    serverName: engram',
      '    command: engram',
    ].join('\n'))
    const target = { scope: 'global' as const }

    const added = await ctx.claudeCompatMcp.addMcp({ target, serverName: 'context7', spec: stdio })
    expect(added).toMatchObject({ target, entryId: 'include:context7', serverName: 'context7', disabled: false })
    await ctx.claudeCompatMcp.editMcp({
      target,
      entryId: 'include:context7',
      serverName: 'context7-new',
      spec: { type: 'http', url: 'https://example.test/mcp' },
    })
    const disabled = await ctx.claudeCompatMcp.disableMcp({ target, entryId: 'include:context7', disabled: true })
    expect(disabled).toMatchObject({ entryId: 'include:context7', serverName: 'context7-new', disabled: true })

    const rows = await rowsFrom(file)
    await ctx.fiber.dispose()
    contexts = contexts.filter(item => item !== ctx)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      id: 'context7', name: MCP_CLIENT_MODULE, disabled: true,
      config: { transport: 'streamable-http', serverName: 'context7-new', url: 'https://example.test/mcp', headers: {} },
    })
  })

  it('rejects global mutations that would flatten patch layers', async () => {
    const { ctx } = await globalHarness('[]\n', [{ insert: [{ id: 'mcp', name: MCP_CLIENT_MODULE, config: { serverName: 'mcp' } }] }])

    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'global' }, serverName: 'new-server', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/read-only' })
  })

  it('rejects global duplicate rows and keeps edits scoped to the Include', async () => {
    const { ctx, file } = await globalHarness([
      '- id: memory-engram',
      `  name: "${MCP_CLIENT_MODULE}"`,
      '  config:',
      '    transport: stdio',
      '    serverName: engram',
      '    command: engram',
    ].join('\n'))
    const target = { scope: 'global' as const }
    await expect(ctx.claudeCompatMcp.addMcp({ target, entryId: 'memory-engram', serverName: 'new', spec: stdio }))
      .rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(ctx.claudeCompatMcp.addMcp({ target, entryId: 'new-id', serverName: 'engram', spec: stdio }))
      .rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(ctx.claudeCompatMcp.addMcp({ target, entryId: 'nested:id', serverName: 'new', spec: stdio }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(ctx.claudeCompatMcp.editMcp({ target, entryId: 'include:missing', serverName: 'new', spec: stdio }))
      .rejects.toMatchObject({ code: 'mcp/not-found' })

    const include = [...ctx.loader.entries()].find(entry => entry.options.id === 'include')
    const original = include?.subtree
    expect(original).toBeDefined()
    await ctx.loader.create({ id: 'outside', name: MCP_CLIENT_MODULE, config: { serverName: 'outside' } } as never)
    await expect(ctx.claudeCompatMcp.disableMcp({ target, entryId: 'outside', disabled: true }))
      .rejects.toMatchObject({ code: 'mcp/not-found' })
    expect(await rowsFrom(file)).toHaveLength(1)
  })

  it('rejects file races before applying a global patch', async () => {
    const run = async (serverName: string, expected: string) => {
      const { ctx, file } = await globalHarness([
        '- id: memory-engram',
        `  name: "${MCP_CLIENT_MODULE}"`,
        '  config: { transport: stdio, serverName: engram, command: engram }',
      ].join('\n'))
      const include = [...ctx.loader.entries()].find(entry => entry.options.id === 'include')
      const tree = include?.subtree
      expect(tree).toBeDefined()
      const original = tree!.entries.bind(tree)
      let calls = 0
      tree!.entries = function* () {
        const current = [...original()]
        if (++calls === 2) {
          writeFileSync(file, [
            '- id: memory-engram',
            `  name: "${MCP_CLIENT_MODULE}"`,
            '  config: { transport: stdio, serverName: engram, command: engram }',
            expected,
          ].join('\n'))
        }
        yield* current
      }
      await expect(ctx.claudeCompatMcp.addMcp({
        target: { scope: 'global' }, entryId: 'raced', serverName, spec: stdio,
      })).rejects.toMatchObject({ code: 'mcp/conflict' })
    }
    await run('raced', '- id: raced\n  name: "' + MCP_CLIENT_MODULE + '"\n  config: { serverName: raced }')
    await run('new', '- id: someone-else\n  name: "' + MCP_CLIENT_MODULE + '"\n  config: { serverName: new }')
  })

  it('rejects missing and ambiguous global Include topologies', async () => {
    const noInclude = new Context()
    contexts.push(noInclude)
    await noInclude.plugin(Loader)
    await noInclude.plugin(ClaudeCompatMcp)
    await expect(noInclude.claudeCompatMcp.addMcp({
      target: { scope: 'global' }, serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/unavailable' })

    const { ctx } = await globalHarness('[]\n')
    const secondRoot = await mkdtemp(join(tmpdir(), 'dsh-claude-second-'))
    roots.push(secondRoot)
    const secondFile = join(secondRoot, 'cordis.yml')
    await writeFile(secondFile, '[]\n')
    await ctx.loader.create({
      id: 'include-second', name: 'cordis:include', config: { path: pathToFileURL(secondFile).href },
    } as never)
    await ctx.loader.await()
    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'global' }, serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/unavailable' })
  })

  it('rejects a global Include without a persistent filename', async () => {
    const { ctx } = await globalHarness('[]\n')
    const include = [...ctx.loader.entries()].find(entry => entry.options.id === 'include')
    expect(include?.subtree).toBeDefined()
    ;(include!.subtree as unknown as { filename: string | undefined }).filename = undefined
    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'global' }, serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/unavailable' })
  })

  it('rejects an inaccessible global Include file', async () => {
    const { ctx, file } = await globalHarness('[]\n')
    const include = [...ctx.loader.entries()].find(entry => entry.options.id === 'include')
    expect(include?.subtree).toBeDefined()
    ;(include!.subtree as { filename?: string }).filename = `${file}.missing`
    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'global' }, serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/read-only' })
  })

  it('handles MCP rows with missing server names safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-missing-server-'))
    roots.push(root)
    const presetFile = join(root, 'agent.cordis.yml')
    await writeFile(presetFile, `- id: bare\n  name: "${MCP_CLIENT_MODULE}"\n`)
    const preset = await presetHarness(presetFile)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }
    await expect(preset.claudeCompatMcp.disableMcp({ target, entryId: 'bare', disabled: true }))
      .resolves.toMatchObject({ serverName: 'bare' })

    const { ctx } = await globalHarness([
      `- id: array-row\n  name: "${MCP_CLIENT_MODULE}"\n  config: []`,
      `- id: null-row\n  name: "${MCP_CLIENT_MODULE}"\n  config: null`,
      `- id: missing-row\n  name: "${MCP_CLIENT_MODULE}"`,
      `- id: number-row\n  name: "${MCP_CLIENT_MODULE}"\n  config: { serverName: 1 }`,
    ].join('\n'))
    for (const entryId of ['include:array-row', 'include:null-row', 'include:missing-row', 'include:number-row']) {
      await expect(ctx.claudeCompatMcp.disableMcp({
        target: { scope: 'global' }, entryId, disabled: true,
      })).rejects.toMatchObject({ code: 'mcp/invalid' })
    }
  })

  it('writes a preset composition with the Loader patch dialect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-preset-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeFile(file, [
      '- id: memory-engram',
      `  name: "${MCP_CLIENT_MODULE}"`,
      '  config:',
      '    transport: stdio',
      '    serverName: engram',
      '    command: engram',
      '    disabled: !!js process.platform === "win32"',
    ].join('\n'))
    const ctx = await presetHarness(file)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }

    const added = await ctx.claudeCompatMcp.addMcp({ target, serverName: 'context7', spec: stdio })
    expect(added.entryId).toBe('context7')
    await ctx.claudeCompatMcp.disableMcp({ target, entryId: 'context7', disabled: true })
    const edited = await ctx.claudeCompatMcp.editMcp({
      target, entryId: 'context7', serverName: 'context7-new', spec: stdio,
    })
    expect(edited).toMatchObject({ entryId: 'context7', disabled: true })

    const rows = await rowsFrom(file)
    expect(rows[1]).toMatchObject({
      id: 'context7', name: MCP_CLIENT_MODULE, disabled: true,
      config: { serverName: 'context7-new', command: 'engram', args: ['mcp'], env: {}, cwd: '' },
    })
    expect(await readFile(file, 'utf8')).toContain('!!js')
  })

  it('does not let global operations mutate another Loader plugin', async () => {
    const { ctx } = await globalHarness([
      '- id: unrelated',
      '  name: cordis:group',
      '  group: true',
      '  config: []',
    ].join('\n'))

    await expect(ctx.claudeCompatMcp.disableMcp({
      target: { scope: 'global' }, entryId: 'include:unrelated', disabled: true,
    })).rejects.toMatchObject({ code: 'mcp/invalid' })
  })

  it('validates nested Loader rows and preserves local ids', () => {
    const rows = [{
      id: 'group', name: 'cordis:group', group: true,
      config: [{ id: 'child', name: MCP_CLIENT_MODULE, config: { serverName: 'child' } }],
    }, { id: 'plain', name: 'plain', group: false, config: [] }] as EntryOptions[]
    expect(entryListProblem(rows)).toBeUndefined()
    expect(findEntryRows(rows, 'child')).toHaveLength(1)
    expect(findEntryRows(rows, 'missing')).toEqual([])
    expect([...entryIds(rows)]).toEqual(['group', 'child', 'plain'])
    expect(presetLeafId('plain')).toBe('plain')
    expect(presetLeafId('group:child')).toBe('child')
    expect(entryListProblem({})).toContain('top-level')
    expect(entryListProblem([null])).toContain('entry object')
    expect(entryListProblem([['nested']])).toContain('entry object')
    expect(entryListProblem([{}])).toContain('.id')
    expect(entryListProblem([{ id: 'x' }])).toContain('.name')
    expect(entryListProblem([{ id: 'x', name: 'x', group: true, config: {} }])).toContain('entry list')
    expect(entryListProblem([{ id: 'x', name: 'x', group: true, config: [{}] }])).toContain('.id')
  })

  it('round-trips YAML and JSON entry lists and reports skipped patches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-authoring-'))
    roots.push(root)
    const yamlFile = join(root, 'composition.yml')
    const jsonFile = join(root, 'composition.json')
    await writeMcpPreset(yamlFile)
    await writeMcpPreset(jsonFile)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }
    const warnings: unknown[][] = []
    const warn = (message: string, ...args: unknown[]) => warnings.push([message, ...args])
    await writeEntryListFile(yamlFile, target, {
      insert: [{ id: 'yaml-new', name: MCP_CLIENT_MODULE, config: { serverName: 'yaml-new' } }],
    }, () => {}, warn)
    await writeEntryListFile(jsonFile, target, {
      id: 'missing', disabled: true,
    }, () => {}, warn)
    expect(warnings).toHaveLength(1)
    expect((await rowsFrom(yamlFile)).some(row => row.id === 'yaml-new')).toBe(true)
    expect(JSON.parse(await readFile(jsonFile, 'utf8'))).toHaveLength(1)
  })

  it('rejects malformed or missing entry-list files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-invalid-'))
    roots.push(root)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }
    const invalid = join(root, 'invalid.yml')
    const malformed = join(root, 'malformed.yml')
    await writeFile(invalid, 'key: value\n')
    await writeFile(malformed, '[\n')
    for (const file of [invalid, malformed, join(root, 'missing.yml')]) {
      await expect(writeEntryListFile(file, target, { id: 'x', disabled: true }, () => {}, () => {}))
        .rejects.toMatchObject({ code: 'mcp/invalid' })
    }
  })

  it('routes skipped patch warnings to the host logger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-warning-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeMcpPreset(file)
    const logs: unknown[][] = []
    const ctx = await presetHarness(file, { logger: (message, ...args) => logs.push([message, ...args]) })
    ;(ctx.claudeCompatMcp as unknown as { warnPatch: (message: string, ...args: unknown[]) => void })
      .warnPatch('skipped %s', 'row')
    expect(logs).toEqual([['skipped %s', 'row']])
  })

  it('rejects a preset path that traverses a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-symlink-'))
    roots.push(root)
    const actual = join(root, 'actual.yml')
    const linked = join(root, 'linked.yml')
    await writeMcpPreset(actual)
    try {
      await symlink(actual, linked)
    } catch (cause) {
      throw new Error(`symlink fixture could not be created: ${String(cause)}`)
    }
    await expect(writePresetComposition({ id: 'memory', trust: 'user', path: linked }, {
      scope: 'preset', agentPreset: 'memory',
    }, { insert: [] }, () => {}, () => {})).rejects.toThrow(/symbolic link/)
  })

  it('rejects shipped, relative, and broken presets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-preset-errors-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeMcpPreset(file)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }
    await expect(writePresetComposition({ id: 'memory', trust: 'shipped', path: file }, target, { insert: [] }, () => {}, () => {}))
      .rejects.toMatchObject({ code: 'mcp/read-only' })
    await expect(writePresetComposition({ id: 'memory', trust: 'user', path: 'relative.yml' }, target, { insert: [] }, () => {}, () => {}))
      .rejects.toMatchObject({ code: 'mcp/invalid' })
    await expect(writePresetComposition({ id: 'memory', trust: 'user', path: file, broken: 'parse failed' }, target, { insert: [] }, () => {}, () => {}))
      .rejects.toMatchObject({ code: 'mcp/invalid' })
  })

  it('rejects unavailable preset services and resolver failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-resolver-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeMcpPreset(file)
    const request = { target: { scope: 'preset' as const, agentPreset: 'memory' }, serverName: 'new', spec: stdio }
    const withoutService = await presetHarness(file, { provide: false })
    await expect(withoutService.claudeCompatMcp.addMcp(request)).rejects.toMatchObject({ code: 'mcp/unavailable' })
    const notFound = await presetHarness(file, { resolveError: new Error('gone') })
    await expect(notFound.claudeCompatMcp.addMcp(request)).rejects.toMatchObject({ code: 'mcp/not-found' })
    const classified = await presetHarness(file, { resolveError: new RemoteError('mcp/read-only', 'no', {
      target: { scope: 'preset', agentPreset: 'memory' }, reason: 'classified',
    }) })
    await expect(classified.claudeCompatMcp.addMcp(request)).rejects.toMatchObject({ code: 'mcp/read-only' })
  })

  it('rejects duplicate and non-MCP preset mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-conflicts-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeFile(file, [
      `- id: memory-engram\n  name: "${MCP_CLIENT_MODULE}"\n  config: { serverName: engram }`,
      '- id: unrelated\n  name: cordis:group\n  group: true\n  config: []',
      `- id: duplicate\n  name: "${MCP_CLIENT_MODULE}"\n  config: { serverName: engram }`,
      `- id: duplicate\n  name: "${MCP_CLIENT_MODULE}"\n  config: { serverName: duplicate }`,
    ].join('\n'))
    const ctx = await presetHarness(file)
    const target = { scope: 'preset' as const, agentPreset: 'memory' }
    await expect(ctx.claudeCompatMcp.addMcp({ target, entryId: 'memory-engram', serverName: 'new', spec: stdio }))
      .rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(ctx.claudeCompatMcp.addMcp({ target, entryId: 'new-id', serverName: 'engram', spec: stdio }))
      .rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(ctx.claudeCompatMcp.editMcp({
      target, entryId: 'unrelated', serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/invalid' })
    await expect(ctx.claudeCompatMcp.disableMcp({ target, entryId: 'unrelated', disabled: true }))
      .rejects.toMatchObject({ code: 'mcp/invalid' })
    await expect(ctx.claudeCompatMcp.editMcp({
      target, entryId: 'missing', serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/not-found' })
    await expect(ctx.claudeCompatMcp.editMcp({
      target, entryId: 'memory-engram', serverName: 'engram', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(ctx.claudeCompatMcp.editMcp({
      target, entryId: 'duplicate', serverName: 'new', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/conflict' })
  })

  it('validates request targets, ids, disabled values, and MCP specs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-validation-'))
    roots.push(root)
    const file = join(root, 'agent.cordis.yml')
    await writeMcpPreset(file)
    const ctx = await presetHarness(file)
    await expect(ctx.claudeCompatMcp.addMcp({ target: { scope: 'preset', agentPreset: '' }, serverName: 'x', spec: stdio }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'preset', agentPreset: 'memory' }, entryId: '', serverName: 'x', spec: stdio,
    })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(ctx.claudeCompatMcp.addMcp({
      target: { scope: 'preset', agentPreset: 'memory' }, serverName: 'bad name!', spec: stdio,
    })).rejects.toMatchObject({ code: 'mcp/invalid' })
  })
})
