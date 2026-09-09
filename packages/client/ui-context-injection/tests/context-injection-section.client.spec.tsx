// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextInjectionSection } from '../src/client/ContextInjectionSection.tsx'
import type { ContextInjectionSectionProps } from '../src/client/ContextInjectionSection.tsx'
import type { ContextInjectionSectionState, McpServer } from '../src/client/settings-controller.ts'
import { en, type ContextInjectionSectionKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: ContextInjectionSectionKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as ContextInjectionSectionProps['t']

const SAMPLE_MCPS: readonly McpServer[] = [
  { serverName: 'filesystem', transport: 'stdio', toolCount: 12, status: 'running' },
  { serverName: 'github', transport: 'streamable-http', toolCount: 18, status: 'running' },
  { serverName: 'playwright', transport: 'stdio', toolCount: 6, status: 'error' },
]

function makeProps(
  state: Partial<ContextInjectionSectionState> = {},
  mcps: () => readonly McpServer[] = () => SAMPLE_MCPS,
): {
  props: ContextInjectionSectionProps
  toggle: ReturnType<typeof vi.fn>
  updateSystemPrompt: ReturnType<typeof vi.fn>
} {
  const snapshot: ContextInjectionSectionState = {
    available: true, writable: true, claude: true, codex: true, systemPrompt: '', ...state,
  }
  const toggle = vi.fn()
  const updateSystemPrompt = vi.fn()
  const props = {
    t,
    useContextInjection: (selector: (value: ContextInjectionSectionState) => unknown) => selector(snapshot),
    toggle,
    updateSystemPrompt,
    mcps,
  } as unknown as ContextInjectionSectionProps
  return { props, toggle, updateSystemPrompt }
}

describe('ContextInjectionSection', () => {
  it('shows the prompt tab first: intro, system-prompt box, and both toggles', () => {
    render(<ContextInjectionSection {...makeProps().props} />)

    expect(screen.getByText(t('prompt.intro'))).toBeTruthy()
    expect(screen.getByRole('textbox')).toHaveProperty('value', '')
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true')
    expect(switches[1]?.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(t('unavailable'))).toBeNull()
  })

  it('commits the system prompt on blur', () => {
    const { props, updateSystemPrompt } = makeProps()
    render(<ContextInjectionSection {...props} />)

    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'Be concise.' } })
    fireEvent.blur(box)
    expect(updateSystemPrompt).toHaveBeenCalledWith('Be concise.')
  })

  it('toggles a rule switch through the controller callback', () => {
    const { props, toggle } = makeProps()
    render(<ContextInjectionSection {...props} />)

    fireEvent.click(screen.getByRole('switch', { name: t('claude') }))
    expect(toggle).toHaveBeenCalledWith('claude')
  })

  it('shows the MCP tab with the loaded servers and status dots', () => {
    render(<ContextInjectionSection {...makeProps().props} />)

    fireEvent.click(screen.getByRole('tab', { name: t('tab.mcp') }))
    expect(screen.getByText('filesystem')).toBeTruthy()
    expect(screen.getByText('github')).toBeTruthy()
    expect(screen.getByText('playwright')).toBeTruthy()
    expect(screen.getAllByText(t('mcp.statusRunning'))).toHaveLength(2)
    expect(screen.getByText(t('mcp.statusError'))).toBeTruthy()
    expect(screen.getByText(t('mcp.transportHttp'))).toBeTruthy()
    expect(screen.getAllByText(t('mcp.transportStdio'))).toHaveLength(2)
    expect(screen.getByText(t('mcp.placeholderNote'))).toBeTruthy()
  })

  it('shows the empty message when no MCP server is loaded', () => {
    const { props } = makeProps({}, () => [])
    render(<ContextInjectionSection {...props} />)

    fireEvent.click(screen.getByRole('tab', { name: t('tab.mcp') }))
    expect(screen.getByText(t('mcp.empty'))).toBeTruthy()
  })

  it('does not write when the system-prompt box is blurred without edits', () => {
    const { props, updateSystemPrompt } = makeProps()
    render(<ContextInjectionSection {...props} />)
    fireEvent.blur(screen.getByRole('textbox'))
    expect(updateSystemPrompt).not.toHaveBeenCalled()
  })

  it('returns to the prompt tab from the MCP tab', () => {
    render(<ContextInjectionSection {...makeProps().props} />)
    fireEvent.click(screen.getByRole('tab', { name: t('tab.mcp') }))
    fireEvent.click(screen.getByRole('tab', { name: t('tab.prompt') }))
    expect(screen.getByText(t('prompt.intro'))).toBeTruthy()
    expect(screen.queryByText('filesystem')).toBeNull()
  })

  it('disables the controls when settings are unavailable', () => {
    render(<ContextInjectionSection {...makeProps({ available: false }).props} />)

    expect(screen.getByText(t('unavailable'))).toBeTruthy()
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true)
    expect((screen.getAllByRole('switch')[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables the controls when the document is not writable', () => {
    render(<ContextInjectionSection {...makeProps({ writable: false }).props} />)

    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('switch')[0]).toHaveProperty('disabled', true)
  })
})
