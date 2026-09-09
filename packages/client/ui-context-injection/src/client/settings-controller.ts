/**
 * Controller bridging the Host `context-injection` settings namespace onto the
 * Harness-compat section snapshot. Reads the current flags and the user system
 * prompt, writes one field per toggle or the system prompt through the settings
 * scope, and supplies the MCP server roster the MCP tab renders.
 *
 * MCP servers load at runtime as `mcp-client` plugin instances; no browser
 * source exposes them yet, so {@link McpServer} rows are a bounded sample. The
 * inject face returns them through `mcps`, so wiring a real Host source later is
 * a one-line swap and does not touch the section component.
 * @module @deepseek-ai/dsh-client-ui-context-injection/settings-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace registered Host-side by @deepseek-ai/dsh-claude-compat. */
export const CONTEXT_INJECTION_NS = 'context-injection'

/** One loaded MCP server, as the MCP management tab presents it. */
export interface McpServer {
  /** Stable server namespace (`mcp__<serverName>__<rawName>`). */
  serverName: string
  /** Transport used to reach the server. */
  transport: 'stdio' | 'streamable-http'
  /** Number of tools the server exposes. */
  toolCount: number
  /** Current connection state. */
  status: 'running' | 'error'
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
  /** Return the loaded MCP server roster (placeholder until a real source lands). */
  mcps: () => readonly McpServer[]
}

/** Owner handle over the `context-injection` namespace. */
export class ContextInjectionController {
  private readonly store: SnapshotStore<ContextInjectionSectionState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `context-injection` settings scope.
   */
  constructor(private readonly scope: SettingsScope<ContextInjectionFlags>) {
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
      mcps: () => sampleMcps(),
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

/**
 * Sample MCP roster for the scaffolded tab. Replaced by a live Host source when
 * the mcp-client inventory is exposed to the browser.
 * @returns a fixed list of representative servers.
 */
function sampleMcps(): readonly McpServer[] {
  return [
    { serverName: 'filesystem', transport: 'stdio', toolCount: 12, status: 'running' },
    { serverName: 'github', transport: 'streamable-http', toolCount: 18, status: 'running' },
    { serverName: 'playwright', transport: 'stdio', toolCount: 6, status: 'error' },
  ]
}
