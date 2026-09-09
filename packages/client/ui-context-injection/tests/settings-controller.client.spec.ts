// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  ContextInjectionController,
  type ContextInjectionFlags,
} from '../src/client/settings-controller.ts'

/** A minimal Host settings scope the controller reads and writes. */
function fakeScope(
  initial: ContextInjectionFlags = { claude: true, codex: true, systemPrompt: '' },
  opts: { ready?: boolean; writable?: boolean; value?: ContextInjectionFlags | undefined } = {},
): {
  scope: SettingsScope<ContextInjectionFlags>
  set: Mock
} {
  let value: ContextInjectionFlags | undefined
  if ('value' in opts) value = opts.value
  else value = initial
  const ready = opts.ready ?? true
  const writable = opts.writable ?? true
  const listeners = new Set<() => void>()
  const set = vi.fn((field: string, next: unknown) => {
    if (value === undefined) return
    value = { ...value, [field]: next }
    listeners.forEach(listener => listener())
  })
  const scope = {
    getSnapshot: () => ({ status: ready ? 'ready' as const : 'loading' as const, writable, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset: () => {},
    mutate: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  } as unknown as SettingsScope<ContextInjectionFlags>
  return { scope, set }
}

describe('ContextInjectionController', () => {
  it('projects the ready snapshot and exposes the section face', () => {
    const { scope } = fakeScope({ claude: true, codex: false, systemPrompt: 'hi' })
    const controller = new ContextInjectionController(scope)

    const state = controller.inject().hooks.contextInjection.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.writable).toBe(true)
    expect(state.claude).toBe(true)
    expect(state.codex).toBe(false)
    expect(state.systemPrompt).toBe('hi')

    expect(controller.inject().mcps().length).toBeGreaterThan(0)
    controller.dispose()
  })

  it('toggles a field through the scope when ready and writable', () => {
    const { scope, set } = fakeScope({ claude: true, codex: true, systemPrompt: '' })
    const controller = new ContextInjectionController(scope)

    controller.inject().toggle('claude')
    expect(set).toHaveBeenCalledWith('claude', false)
    controller.dispose()
  })

  it('ignores toggle writes when not ready or not writable', () => {
    const notReady = fakeScope({ claude: true, codex: true, systemPrompt: '' }, { ready: false })
    new ContextInjectionController(notReady.scope).inject().toggle('claude')
    expect(notReady.set).not.toHaveBeenCalled()

    const notWritable = fakeScope({ claude: true, codex: true, systemPrompt: '' }, { writable: false })
    new ContextInjectionController(notWritable.scope).inject().toggle('codex')
    expect(notWritable.set).not.toHaveBeenCalled()
  })

  it('ignores toggle writes when no value is held', () => {
    const { scope, set } = fakeScope({ claude: true, codex: true, systemPrompt: '' }, { value: undefined })
    const controller = new ContextInjectionController(scope)
    controller.inject().toggle('claude')
    expect(set).not.toHaveBeenCalled()
    // Projection falls back to defaults when no value is held.
    const state = controller.inject().hooks.contextInjection.getSnapshot()
    expect(state.claude).toBe(true)
    expect(state.systemPrompt).toBe('')
    controller.dispose()
  })

  it('persists the system prompt through the scope', () => {
    const { scope, set } = fakeScope()
    const controller = new ContextInjectionController(scope)
    controller.inject().updateSystemPrompt('answer in Chinese')
    expect(set).toHaveBeenCalledWith('systemPrompt', 'answer in Chinese')
    controller.dispose()
  })

  it('ignores system-prompt writes when not ready or not writable', () => {
    const notReady = fakeScope(undefined, { ready: false })
    new ContextInjectionController(notReady.scope).inject().updateSystemPrompt('x')
    expect(notReady.set).not.toHaveBeenCalled()

    const notWritable = fakeScope(undefined, { writable: false })
    new ContextInjectionController(notWritable.scope).inject().updateSystemPrompt('x')
    expect(notWritable.set).not.toHaveBeenCalled()
  })

  it('publishes a fresh projection when the scope notifies', () => {
    const { scope, set } = fakeScope({ claude: true, codex: true, systemPrompt: '' }, { writable: true })
    const controller = new ContextInjectionController(scope)
    const store = controller.inject().hooks.contextInjection
    expect(store.getSnapshot().claude).toBe(true)
    // Simulate a Host write landing: the scope mutates value and notifies.
    set('claude', false)
    expect(store.getSnapshot().claude).toBe(false)
    controller.dispose()
  })
})
