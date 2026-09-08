/**
 * Context-injection settings section: the two master toggles for Claude and
 * Codex rule injection. One small page in the settings modal, bound through
 * the injected controller to the `context-injection` namespace.
 * @module @deepseek-ai/dsh-client-ui-context-injection/ContextInjectionSection
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextInjectionSectionFace } from './settings-controller.ts'
import type { ContextInjectionSectionKey } from './locales.ts'

/** Full component props. */
export type ContextInjectionSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.contextInjection'>
  & InjectFace<ContextInjectionSectionFace>

/** Row layout for one toggle. */
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 0', borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  gap: '16px',
}

const text: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '2px' }

const label: React.CSSProperties = { fontSize: '13px', fontWeight: 600 }

const desc: React.CSSProperties = { fontSize: '12px', opacity: 0.7 }

/** The settings section body. */
export function ContextInjectionSection(props: ContextInjectionSectionProps): ReactNode {
  const { useContextInjection, t, toggle } = props
  const state = useContextInjection(snapshot => snapshot)
  const disabled = !state.available || !state.writable
  const switchRow = (key: ContextInjectionSectionKey, descKey: ContextInjectionSectionKey) => (
    <label style={row}>
      <span style={text}>
        <span style={label}>{t(key)}</span>
        <span style={desc}>{t(descKey)}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={key === 'claude' ? state.claude : state.codex}
        checked={key === 'claude' ? state.claude : state.codex}
        disabled={disabled}
        title={disabled ? t('unavailable') : undefined}
        onChange={() => { toggle(key === 'claude' ? 'claude' : 'codex') }}
      />
    </label>
  )
  return (
    <div>
      {switchRow('claude', 'claude.desc')}
      {switchRow('codex', 'codex.desc')}
      {!state.available ? <p>{t('unavailable')}</p> : null}
    </div>
  )
}
