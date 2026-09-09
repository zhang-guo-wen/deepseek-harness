/**
 * Context-injection settings section dictionaries.
 * @module @deepseek-ai/dsh-client-ui-context-injection/locales
 */

/** Locale namespace owned by this plugin. */
export const NS = 'settings.contextInjection'

const zh = {
  'nav': 'Harness兼容',
  'tab.prompt': '提示词管理',
  'tab.mcp': 'MCP 管理',
  'prompt.intro': '默认加载 AGENTS.md、CLAUDE.md：会话开始时加载一次（项目根 + 全局），后续对文件的修改不会重复注入。',
  'systemPrompt.label': '系统提示词',
  'systemPrompt.hint': '这里的内容会作为 system 级别的提示词注入会话，默认留空；可嵌入固定规则与身份信息。',
  'systemPrompt.placeholder': '例如：你是资深工程师，优先用中文作答，遇到不确定的配置先查文档，不要臆断。',
  'switchSection': '加载开关',
  'claude': '加载 Claude 规则',
  'claude.desc': '把项目与全局的 Claude Code 规则与技能注入会话',
  'claude.files': '注入：.claude/CLAUDE.md、~/.claude/CLAUDE.md、.claude/skills/**、~/.claude/skills/**、.claude/rules/**、~/.claude/rules/**',
  'codex': '加载 Codex 规则',
  'codex.desc': '把项目与全局的 Codex 规则注入会话',
  'codex.files': '注入：.codex/AGENTS.md、~/.codex/AGENTS.md',
  'mcp.subtitle': '此处展示当前会话已加载的 MCP（Model Context Protocol）服务器。下方为占位示例数据，真实数据源接入后替换。',
  'mcp.toolsUnit': '{count} 个工具',
  'mcp.statusRunning': '运行中',
  'mcp.statusError': '连接失败',
  'mcp.transportStdio': 'stdio',
  'mcp.transportHttp': 'http',
  'mcp.placeholderNote': '⚠️ 占位示例数据：接入真实 MCP 数据源后，这里将展示实际加载的服务器（serverName、transport、工具数、状态）。',
  'mcp.empty': '暂无已加载的 MCP 服务器',
  'unavailable': '设置当前不可用',
}
/** Key union, sourced from the Chinese dictionary. */
export type ContextInjectionSectionKey = keyof typeof zh

const en: Record<ContextInjectionSectionKey, string> = {
  'nav': 'Harness Compat',
  'tab.prompt': 'Prompt management',
  'tab.mcp': 'MCP management',
  'prompt.intro': 'AGENTS.md and CLAUDE.md load by default, once at session start (project root + global); later edits are not re-injected.',
  'systemPrompt.label': 'System prompt',
  'systemPrompt.hint': 'Content here is injected into the session at the system level; it defaults to empty. Embed fixed rules and identity.',
  'systemPrompt.placeholder': 'e.g. You are a senior engineer; answer in Chinese; check docs before guessing.',
  'switchSection': 'Loading switches',
  'claude': 'Load Claude rules',
  'claude.desc': 'Inject project and global Claude Code rules and skills into the session',
  'claude.files': 'Loads: .claude/CLAUDE.md, ~/.claude/CLAUDE.md, .claude/skills/**, ~/.claude/skills/**, .claude/rules/**, ~/.claude/rules/**',
  'codex': 'Load Codex rules',
  'codex.desc': 'Inject project and global Codex rules into the session',
  'codex.files': 'Loads: .codex/AGENTS.md, ~/.codex/AGENTS.md',
  'mcp.subtitle': 'MCP (Model Context Protocol) servers loaded into the current session. The rows below are sample data; replaced once a real source is wired in.',
  'mcp.toolsUnit': '{count} tools',
  'mcp.statusRunning': 'Running',
  'mcp.statusError': 'Connection failed',
  'mcp.transportStdio': 'stdio',
  'mcp.transportHttp': 'http',
  'mcp.placeholderNote': '⚠️ Sample data: once a real MCP source is wired in, the loaded servers (serverName, transport, tool count, status) appear here.',
  'mcp.empty': 'No MCP servers loaded',
  'unavailable': 'Setting currently unavailable',
}

export { zh, en }
