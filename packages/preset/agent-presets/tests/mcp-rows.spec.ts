import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMPOSITION_FILE } from '../src/discovery.ts'
import { fileComposition, type DisabledExpressionEvaluator } from '../src/composition-inventory.ts'
import { addPresetMcp, setPresetMcpDisabled, updatePresetMcp } from '../src/mcp-rows.ts'
import type { AgentPreset } from '../src/preset.ts'

const alwaysEnabled: DisabledExpressionEvaluator = () => false
const warn = () => {}

async function makePreset(): Promise<{ preset: AgentPreset; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-rows-'))
  return { preset: { id: 'mcp', trust: 'user' as const, path: join(dir, COMPOSITION_FILE) } as AgentPreset, dir }
}

describe('mcp-rows', () => {
  it('adds a mcp-client row', async () => {
    const { preset, dir } = await makePreset()
    try {
      await writeFile(preset.path, '- id: memory-engram\n  name: "@deepseek-ai/dsh-mcp-client"\n')
      await addPresetMcp(preset, { serverName: 'context7', transport: 'stdio', command: 'npx' }, warn)
      const result = await fileComposition(preset.path, alwaysEnabled)
      const ids = 'rows' in result ? result.rows.map(row => row.entryId) : []
      expect(ids).toEqual(['memory-engram', 'context7'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('updates a mcp-client row config', async () => {
    const { preset, dir } = await makePreset()
    try {
      await writeFile(preset.path, '- id: memory-engram\n  name: "@deepseek-ai/dsh-mcp-client"\n  config:\n    serverName: memory-engram\n')
      await updatePresetMcp(preset, 'memory-engram', { serverName: 'memory-engram', transport: 'stdio', command: 'engram2' }, warn)
      const content = await readFile(preset.path, 'utf8')
      expect(content).toContain('engram2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('disables a mcp-client row', async () => {
    const { preset, dir } = await makePreset()
    try {
      await writeFile(preset.path, '- id: memory-engram\n  name: "@deepseek-ai/dsh-mcp-client"\n')
      await setPresetMcpDisabled(preset, 'memory-engram', true, warn)
      const result = await fileComposition(preset.path, alwaysEnabled)
      expect('rows' in result && result.rows[0]?.enabled).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
