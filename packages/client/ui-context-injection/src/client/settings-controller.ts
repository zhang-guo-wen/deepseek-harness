/**
 * Controller bridging the Host `context-injection` settings namespace onto a
 * two-toggle section snapshot. Reads the current flags and writes a single
 * field per toggle through the settings scope.
 * @module @deepseek-ai/dsh-client-ui-context-injection/settings-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace registered Host-side by @deepseek-ai/dsh-claude-compat. */
export const CONTEXT_INJECTION_NS = 'context-injection'

/** The two master toggles resolved by the Host schema. */
export interface ContextInjectionFlags {
  claude: boolean
  codex: boolean
}

/** Snapshot the section renders. */
export interface ContextInjectionSectionState {
  /** Whether the namespace is exposed to this client. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  claude: boolean
  codex: boolean
}

/** Registration-side face for the section. */
export interface ContextInjectionSectionFace {
  hooks: {
    /** Section snapshot bound by the renderer as useContextInjection. */
    contextInjection: SnapshotStore<ContextInjectionSectionState>
  }
  /** Flip one master toggle. */
  toggle: (name: 'claude' | 'codex') => void
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
    }
  }

  private toggle(name: 'claude' | 'codex'): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    const value = snapshot.value?.[name]
    if (value === undefined) return
    void this.scope.set(name, !value)
  }

  private projection(): ContextInjectionSectionState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      claude: snapshot.value?.claude ?? true,
      codex: snapshot.value?.codex ?? true,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
