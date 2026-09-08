/**
 * Context-injection settings section dictionaries.
 * @module @deepseek-ai/dsh-client-ui-context-injection/locales
 */

/** Locale namespace owned by this plugin. */
export const NS = 'settings.contextInjection'

const zh = {
  'nav': 'harness兼容',
  'claude': '加载 Claude 规则',
  'claude.desc': '把项目与全局的 Claude Code 规则（CLAUDE.md）与 skills 注入到首条请求',
  'codex': '加载 Codex 规则',
  'codex.desc': '把项目与全局的 Codex 规则（AGENTS.md）注入到首条请求',
  'unavailable': '设置当前不可用',
}
/** Key union, sourced from the Chinese dictionary. */
export type ContextInjectionSectionKey = keyof typeof zh

const en: Record<ContextInjectionSectionKey, string> = {
  'nav': 'Harness Compat',
  'claude': 'Load Claude rules',
  'claude.desc': 'Inject project and global Claude Code rules (CLAUDE.md) and skills into the first request',
  'codex': 'Load Codex rules',
  'codex.desc': 'Inject project and global Codex rules (AGENTS.md) into the first request',
  'unavailable': 'Setting currently unavailable',
}

export { zh, en }
