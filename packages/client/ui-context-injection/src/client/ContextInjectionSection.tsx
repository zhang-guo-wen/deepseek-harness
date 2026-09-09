/**
 * Context-injection settings section: the Harness-compat page with two tabs.
 *
 * Tab "提示词管理" describes the default skill and CLAUDE.md / AGENTS.md loading
 * rules, edits a system-level prompt persisted to the `context-injection`
 * namespace (which the Host injects as a real system-prompt section), and holds
 * the two Claude/Codex rule-injection master toggles. Tab "MCP 管理" lists the
 * loaded MCP servers (placeholder roster until a real browser source lands).
 * @module @deepseek-ai/dsh-client-ui-context-injection/ContextInjectionSection
 */

import { useState, type ReactNode } from 'react'
import { StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextInjectionSectionFace, McpServer } from './settings-controller.ts'
import type { ContextInjectionSectionKey } from './locales.ts'
import css from './ContextInjectionSection.module.css'

/** Full component props. */
export type ContextInjectionSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.contextInjection'>
  & InjectFace<ContextInjectionSectionFace>

/** Localized `t` bound to this section's dictionary namespace. */
type Translate = ContextInjectionSectionProps['t']

/** One tab id inside the section. */
type TabId = 'prompt' | 'mcp'

/** Server status → dot state. */
const MCP_DOT: Record<McpServer['status'], StateDotState> = {
  running: 'done',
  error: 'error',
}

/** Localized transport label for an MCP row. */
function transportLabel(transport: McpServer['transport'], t: Translate): string {
  return transport === 'stdio' ? t('mcp.transportStdio') : t('mcp.transportHttp')
}

/** One rendered MCP server row. */
function McpRow({ server, t }: { readonly server: McpServer; readonly t: Translate }): ReactNode {
  const transport = transportLabel(server.transport, t)
  const status = server.status === 'running' ? t('mcp.statusRunning') : t('mcp.statusError')
  return (
    <div className={css.mcpRow}>
      <div className={css.mcpMain}>
        <span className={css.mcpName}>{server.serverName}</span>
        <span className={css.mcpMeta}>
          {transport} · {t('mcp.toolsUnit', { count: String(server.toolCount) })}
        </span>
      </div>
      <div className={css.mcpRight}>
        <span className={css.badge}>{transport}</span>
        <span className={css.status}>
          <StateDot state={MCP_DOT[server.status]} />
          {status}
        </span>
      </div>
    </div>
  )
}

/** The settings section body. */
export function ContextInjectionSection(props: ContextInjectionSectionProps): ReactNode {
  const { useContextInjection, t, toggle, updateSystemPrompt, mcps } = props
  const state = useContextInjection(snapshot => snapshot)
  const [activeTab, setActiveTab] = useState<TabId>('prompt')
  const [promptDraft, setPromptDraft] = useState<string | null>(null)
  const disabled = !state.available || !state.writable
  const promptValue = promptDraft ?? state.systemPrompt

  const commitPrompt = (): void => {
    if (promptDraft === null) return
    updateSystemPrompt(promptDraft)
  }

  const switchRow = (
    key: 'claude' | 'codex',
    descKey: ContextInjectionSectionKey,
    filesKey: ContextInjectionSectionKey,
  ): ReactNode => (
    <div className={css.switchRow}>
      <span className={css.switchText}>
        <span className={css.switchLabel}>{t(key)}</span>
        <span className={css.switchDesc}>{t(descKey)}</span>
        <span className={css.switchFiles}>{t(filesKey)}</span>
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

  const servers = mcps()

  return (
    <div className={css.section}>
      <div className={css.tabs} role="tablist" aria-label={t('nav')}>
        <button
          type="button"
          role="tab"
          className={css.tab}
          aria-selected={activeTab === 'prompt'}
          aria-controls="context-injection-prompt"
          onClick={() => { setActiveTab('prompt') }}
        >
          {t('tab.prompt')}
        </button>
        <button
          type="button"
          role="tab"
          className={css.tab}
          aria-selected={activeTab === 'mcp'}
          aria-controls="context-injection-mcp"
          onClick={() => { setActiveTab('mcp') }}
        >
          {t('tab.mcp')}
        </button>
      </div>

      {activeTab === 'prompt' ? (
        <div className={css.panel} id="context-injection-prompt" role="tabpanel">
          <p className={css.intro}>{t('prompt.intro')}</p>
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('systemPrompt.label')}</span>
            <span className={css.fieldHint}>{t('systemPrompt.hint')}</span>
            <textarea
              className={css.promptArea}
              value={promptValue}
              placeholder={t('systemPrompt.placeholder')}
              disabled={disabled}
              onChange={(event) => { setPromptDraft(event.currentTarget.value) }}
              onBlur={commitPrompt}
            />
          </div>
          {!state.available ? <p className={css.unavailable}>{t('unavailable')}</p> : null}
          <span className={css.switchSectionLabel}>{t('switchSection')}</span>
          <div>
            {switchRow('claude', 'claude.desc', 'claude.files')}
            {switchRow('codex', 'codex.desc', 'codex.files')}
          </div>
        </div>
      ) : (
        <div className={css.panel} id="context-injection-mcp" role="tabpanel">
          <p className={css.mcpSub}>{t('mcp.subtitle')}</p>
          {servers.length > 0 ? (
            <div className={css.mcpList}>
              {servers.map(server => <McpRow key={server.serverName} server={server} t={t} />)}
            </div>
          ) : (
            <p className={css.empty}>{t('mcp.empty')}</p>
          )}
          <p className={css.mcpNote}>{t('mcp.placeholderNote')}</p>
        </div>
      )}
    </div>
  )
}
