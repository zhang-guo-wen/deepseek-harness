// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import { apply as applyClient } from '../src/client/index.ts'
import { NS } from '../src/client/locales.ts'
import { CONTEXT_INJECTION_NS } from '../src/client/settings-controller.ts'

function fakeScope(): unknown {
  const value = { claude: true, codex: true, systemPrompt: '' }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready' as const, writable: true, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: () => {},
    unset: () => {},
    mutate: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  }
}

function stubCtx(): { ctx: Context; disposers: Array<() => void> } {
  const disposers: Array<() => void> = []
  const ctx = {
    effect: vi.fn((fn: () => unknown) => {
      const result = fn()
      if (typeof result === 'function') disposers.push(result as () => void)
    }),
    locale: {
      register: vi.fn(),
      bind: vi.fn(() => (key: string) => key),
    },
    settingsScope: {
      bind: vi.fn(() => fakeScope()),
    },
    slots: {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((options: { label: () => string; inject: () => unknown }) => {
        options.label()
        options.inject()
        return () => {}
      }),
    },
  }
  return { ctx: ctx as unknown as Context, disposers }
}

describe('browser plugin', () => {
  it('exposes the host name and a no-op host apply', () => {
    expect(name).toBe('client-ui-context-injection')
    expect(apply()).toBeUndefined()
  })

  it('registers dictionaries and the Harness-compat section through the slots', () => {
    const { ctx, disposers } = stubCtx()
    applyClient(ctx)

    expect(ctx.locale.register).toHaveBeenCalledWith(NS, expect.objectContaining({
      zh: expect.any(Object),
      en: expect.any(Object),
    }))
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({ namespace: CONTEXT_INJECTION_NS })
    expect(ctx.locale.bind).toHaveBeenCalledWith(NS)
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(ctx.slots.register).toHaveBeenCalled()
    // The settings-scope disposer is owned by the caller's fiber.
    expect(disposers).toHaveLength(1)
    for (const dispose of disposers) dispose()
  })
})
