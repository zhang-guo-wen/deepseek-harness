/**
 * Context-injection settings section: the two master toggles for Claude and
 * Codex rule injection, each showing which rule and skill files it loads. One
 * small page in the settings modal, bound through the injected controller to
 * the `context-injection` namespace.
 * @module @deepseek-ai/dsh-client-ui-context-injection/ContextInjectionSection
 */

import type { ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
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

const files: React.CSSProperties = {
  fontSize: '11px', opacity: 0.6,
  fontFamily: 'var(--dsw-font-mono, monospace)', marginTop: '2px',
}

/** The settings section body. */
export function ContextInjectionSection(props: ContextInjectionSectionProps): ReactNode {
  const { useContextInjection, t, toggle } = props
  const state = useContextInjection(snapshot => snapshot)
  const disabled = !state.available || !state.writable
  const switchRow = (
    key: 'claude' | 'codex',
    descKey: ContextInjectionSectionKey,
    filesKey: ContextInjectionSectionKey,
  ) => (
    <div style={row}>
      <span style={text}>
        <span style={label}>{t(key)}</span>
        <span style={desc}>{t(descKey)}</span>
        <span style={files}>{t(filesKey)}</span>
      </span>
      <Switch
        checked={key === 'claude' ? state.claude : state.codex}
        onChange={() => { toggle(key) }}
        label={t(key)}
        disabled={disabled}
        title={disabled ? t('unavailable') : undefined}
      />
    </div>
  )
  return (
    <div>
      {switchRow('claude', 'claude.desc', 'claude.files')}
      {switchRow('codex', 'codex.desc', 'codex.files')}
      {!state.available ? <p>{t('unavailable')}</p> : null}
    </div>
  )
}
