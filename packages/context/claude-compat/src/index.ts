/**
 * Claude Code compatibility plugin for the DeepSeek Harness.
 *
 * Registers a {@link ClaudeCodeSkillProvider} on `ctx.skills` so Claude Code's
 * directory-bundle skills (`<projectRoot>/.claude/skills` and `~/.claude/skills`)
 * appear in the same session catalog as every other skill source, and folds the
 * Claude Code rule files (`.claude/CLAUDE.md` and `~/.claude/CLAUDE.md`) into
 * the first request as their own instruction context.
 *
 * It also owns the Codex rule contributor (`.codex/AGENTS.md` and
 * `~/.codex/AGENTS.md`) and the single `context-injection` settings namespace
 * whose two master toggles — `claude` and `codex` — decide whether each
 * contributor folds its rule files at all.
 *
 * @module @deepseek-ai/dsh-claude-compat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-skill'
import { ClaudeCodeSkillProvider, type Config as ProviderConfig } from './provider.ts'
import { claudeInstructionListener, type InstructionConfig } from './instructions.ts'
import { codexInstructionListener } from './codex.ts'
import {
  registerContextInjection,
  type ContextInjectionConfig,
} from './context-injection.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'claude-compat'

/** Services required by this plugin (settings is optional and probed lazily). */
export const inject = ['skills']

/** Config forwarded to the provider, both instruction contributors, and the namespace. */
export interface Config extends ProviderConfig, InstructionConfig, ContextInjectionConfig {
  /** Codex home; defaults to `$CODEX_HOME` or `~/.codex`. */
  codexHome?: string
}

export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('claude-code'),
  claudeHome: z.string(),
  codexHome: z.string(),
  projectRootMarkers: z.array(z.string()).default(['.git']),
  includeProjectRoot: z.boolean().default(true),
  includeGlobalRoot: z.boolean().default(true),
  includeProjectRule: z.boolean().default(true),
  includeGlobalRule: z.boolean().default(true),
  claude: z.boolean().default(true),
  codex: z.boolean().default(true),
})

/**
 * Register the Claude Code skill provider and both instruction contributors.
 * The `context-injection` namespace supplies the `claude`/`codex` master
 * toggles; the plugin `config` supplies the composition base and default.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const flags = registerContextInjection(ctx, config)
  ctx.skills.registerProvider(control => new ClaudeCodeSkillProvider(ctx, control, { ...config, enabled: () => flags().claude }))
  claudeInstructionListener(ctx, config, () => flags().claude)
  const codexConfig = {
    ...config.codexHome !== undefined ? { codexHome: config.codexHome } : {},
    ...config.projectRootMarkers !== undefined ? { projectRootMarkers: config.projectRootMarkers } : {},
  }
  codexInstructionListener(ctx, codexConfig, () => flags().codex)
}
