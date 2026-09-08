/**
 * Context-injection settings section dictionaries.
 * @module @deepseek-ai/dsh-client-ui-context-injection/locales
 */

/** Locale namespace owned by this plugin. */
export const NS = 'settings.contextInjection'

const zh = {
  'nav': 'Harness兼容',
  'claude': '加载 Claude 规则',
  'claude.desc': '把项目与全局的 Claude Code 规则与技能注入会话',
  'claude.files': '注入：.claude/CLAUDE.md、~/.claude/CLAUDE.md、.claude/skills/**、~/.claude/skills/**、.claude/rules/**、~/.claude/rules/**',
  'codex': '加载 Codex 规则',
  'codex.desc': '把项目与全局的 Codex 规则注入会话',
  'codex.files': '注入：.codex/AGENTS.md、~/.codex/AGENTS.md',
  'unavailable': '设置当前不可用',
}
/** Key union, sourced from the Chinese dictionary. */
export type ContextInjectionSectionKey = keyof typeof zh

const en: Record<ContextInjectionSectionKey, string> = {
  'nav': 'Harness Compat',
  'claude': 'Load Claude rules',
  'claude.desc': 'Inject project and global Claude Code rules and skills into the session',
  'claude.files': 'Loads: .claude/CLAUDE.md, ~/.claude/CLAUDE.md, .claude/skills/**, ~/.claude/skills/**, .claude/rules/**, ~/.claude/rules/**',
  'codex': 'Load Codex rules',
  'codex.desc': 'Inject project and global Codex rules into the session',
  'codex.files': 'Loads: .codex/AGENTS.md, ~/.codex/AGENTS.md',
  'unavailable': 'Setting currently unavailable',
}

export { zh, en }
