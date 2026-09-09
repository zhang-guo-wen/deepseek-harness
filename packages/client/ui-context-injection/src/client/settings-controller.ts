/**
 * Controller bridging the Host `context-injection` settings namespace onto the
 * Harness-compat section snapshot. Reads the current flags and the user system
 * prompt, writes one field per toggle or the system prompt through the settings
 * scope, and supplies the MCP server roster the MCP tab renders.
 *
 * The MCP roster comes from the already-wired `remote.pluginInventory` read of
 * the Loader (which is loaded from the deployment and preset config files), so
 * it is real-time and reflects both the global plane and every agent-preset
 * composition. Every mcp-client occurrence is surfaced without deduplication,
 * tagged with where it is configured (`global` or a preset id).
 * @module @deepseek-ai/dsh-client-ui-context-injection/settings-controller
 */

import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace registered Host-side by @deepseek-ai/dsh-claude-compat. */
export const CONTEXT_INJECTION_NS = 'context-injection'

/** Module specifier of the MCP client bridge whose instances this section lists. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Lifecycle phase of one mcp-client Loader entry (same vocabulary as the inventory). */
export type McpPhase = PluginInventorySnapshot['entries'][number]['fiberPhase']

/** One loaded MCP server, as the MCP management tab presents it. */
export interface McpServer {
  /** Instance identifier (the Loader entry id, or a preset row's id). */
  serverName: string
  /** Where this occurrence is configured. */
  scope: 'global' | 'preset'
  /** Preset id when `scope` is `preset`. */
  presetId: string | undefined
  /** Effective enablement; `'conditional'` marks a `!!js` gate only a mount can resolve. */
  enabled: boolean | 'conditional'
  /** Root-fiber phase when live, otherwise null. */
  fiberPhase: McpPhase
}

/** The two master toggles and the user system prompt resolved by the Host schema. */
export interface ContextInjectionFlags {
  claude: boolean
  codex: boolean
  systemPrompt: string
}

/** Snapshot the section renders. */
export interface ContextInjectionSectionState {
  /** Whether the namespace is exposed to this client. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  claude: boolean
  codex: boolean
  systemPrompt: string
}

/** Registration-side face for the section. */
export interface ContextInjectionSectionFace {
  hooks: {
    /** Section snapshot bound by the renderer as useContextInjection. */
    contextInjection: SnapshotStore<ContextInjectionSectionState>
  }
  /** Flip one master toggle. */
  toggle: (name: 'claude' | 'codex') => void
  /** Persist the system prompt text the user committed. */
  updateSystemPrompt: (value: string) => void
  /** Resolve the current loaded MCP roster from the Host plugin inventory. */
  mcps: () => Promise<readonly McpServer[]>
}

/**
 * Project a Host plugin-inventory snapshot onto the MCP roster, keeping every
 * mcp-client occurrence (global plane plus each preset composition) without
 * deduplicating cross-scope repeats.
 * @param snapshot - the load-time inventory read from the Host.
 * @returns one row per mcp-client occurrence, tagged with its config scope.
 */
export function mapMcpServers(snapshot: PluginInventorySnapshot): readonly McpServer[] {
  const rows: McpServer[] = []
  for (const entry of snapshot.entries) {
    if (entry.moduleName !== MCP_CLIENT_MODULE) continue
    rows.push({
      serverName: entry.entryId,
      scope: 'global',
      presetId: undefined,
      enabled: entry.enabled,
      fiberPhase: entry.fiberPhase,
    })
  }
  for (const preset of snapshot.agentPresets ?? []) {
    for (const row of preset.rows) {
      if (row.moduleName !== MCP_CLIENT_MODULE) continue
      rows.push({
        serverName: row.entryId ?? row.moduleName,
        scope: 'preset',
        presetId: preset.id,
        enabled: row.enabled,
        fiberPhase: row.fiberPhase,
      })
    }
  }
  return rows
}

/** Owner handle over the `context-injection` namespace. */
export class ContextInjectionController {
  private readonly store: SnapshotStore<ContextInjectionSectionState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `context-injection` settings scope.
   * @param mcps - Host-backed MCP roster loader.
   */
  constructor(
    private readonly scope: SettingsScope<ContextInjectionFlags>,
    private readonly mcps: () => Promise<readonly McpServer[]>,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => this.publish())
  }

  /** Stop observing settings. */
  dispose(): void {
    this.unsubscribe()
  }

  /** Build the renderer face for this section. */
  inject(): ContextInjectionSectionFace {
    return {
      hooks: { contextInjection: this.store },
      toggle: (name) => { this.toggle(name) },
      updateSystemPrompt: (value) => { this.updateSystemPrompt(value) },
      mcps: this.mcps,
    }
  }

  private toggle(name: 'claude' | 'codex'): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    const value = snapshot.value?.[name]
    if (value === undefined) return
    void this.scope.set(name, !value)
  }

  private updateSystemPrompt(value: string): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    void this.scope.set('systemPrompt', value)
  }

  private projection(): ContextInjectionSectionState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      claude: snapshot.value?.claude ?? true,
      codex: snapshot.value?.codex ?? true,
      systemPrompt: snapshot.value?.systemPrompt ?? '',
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
