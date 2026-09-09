# Agent Note: Claude Code skills and rules compatibility

Status: implemented

English | [中文](2026-09-07-claude-code-compat.zh.md)

## Problem

Neighboring products keep agent-facing assets in product-specific directories. Claude Code puts skills under `.claude/skills/<name>/SKILL.md` and rules in `CLAUDE.md` (a project one at `<projectRoot>/.claude/CLAUDE.md` and a user-global one at `~/.claude/CLAUDE.md`). The harness already loads flat same-directory `CLAUDE.md` through `agent-instructions`, but it does not scan `.claude/skills`, and it deliberately does not load the `.claude/CLAUDE.md` directory rule (that note defers it). A team that already maintains Claude Code assets wants the harness to reuse them without translating them into DSH-specific roots.

## Decision

Add `@deepseek-ai/dsh-claude-compat` under `packages/context/`, an opt-in plugin that reads the two Claude Code surfaces without touching the shipped `agent-instructions` loader (whose same-directory-only candidate boundary and `.claude/CLAUDE.md` deferral stay as designed).

### Skills

The plugin registers one more skill provider (provider name `claude-code`) on `ctx.skills`, exactly like `skill-filesystem`. It scans `<projectRoot>/.claude/skills` (rank 250, source `project-claude`) and `~/.claude/skills` (rank 550, source `user-claude`), with the project root found by walking upward to a configured marker (default `.git`). It parses the same frontmatter grammar (`name`, `description`, optional `whenToUse`, `metadata`, `disable-model-invocation`, `user-invocable`) so a Claude skill honours the same invocation controls. Candidates merge with every other provider, so a same-name DSH project skill (which ranks higher, i.e. lower number) wins a duplicate. Reads go through `ctx.fs` when present, falling back to abortable Node I/O; discovery and load are separated so body edits need no cache invalidation.

### Rules

Unlike the skills provider, there is no registry seam for instruction files. The plugin contributes `.claude/CLAUDE.md` and `~/.claude/CLAUDE.md` as an additive instructions-form context instead of modifying `agent-instructions`. It listens on `agent/pre-step`, reads the two files, and folds them into an entering decision after the last admitted user message, reusing the `agent/pre-step` waterfall the same way `agent-instructions` does. A missing or unreadable file is not fatal.

### Scoped rules

Rules under `.claude/rules/**` (project) and `~/.claude/rules/**` (user) are folded under a second merge-extensible source kind, `claude-rule`. A rule's YAML frontmatter may carry a `paths:` glob list; a rule without `paths` (or with an empty list) is always-on and folds into the first request like `CLAUDE.md`, while a rule with `paths` is path-scoped and folds into the request that follows a `read` of a file matching one of those globs. Globs are matched against the project-root-relative path with `picomatch`.

The path-scoped trigger listens on `tools/result` for a successful `read` and marks matching scoped rules active on the agent's session; the next `agent/pre-step` folds them. `agent/pre-step` fires once per turn, and a tool-continuation step carries no newly claimed messages, so the rules contributor folds a newly active scoped rule into an empty entering decision (always-on rules stay gated on a non-empty entering step to avoid injecting into a turn with no user prompt). Each rule is folded at most once per session, tracked per session in a `WeakMap`.

To keep the two loaders from managing each other's messages, the injected context carries a new merge-extensible message source `claude-code` (`form: 'instructions'`). `agent-instructions` filters its inbox on `kind === 'agent-instructions'`, so its `syncInbox` never sees or removes these messages, and the new kind is logged and replayed as a `user` message.

### MCP composition authoring

The plugin owns the `claudeCompatMcp` Typert Remote. Its request objects distinguish a global Loader composition from a user-owned agent preset, a Loader row id from the MCP `serverName`, and the transport specification from the display description. Descriptions remain in `context-injection.mcpDescriptions`; the `mcp-client` row contains only connection fields. The browser settings section surfaces these operations as Add / Edit / Enable-Disable controls, all routed through the same Remote.

Preset add, edit, and disable operations resolve the preset through the optional `agentPresets` service, reject shipped presets, validate the Loader entry-list dialect, and commit a locked atomic YAML rewrite. A direct unpatched global Include uses `ctx.loader.update` or its Include child tree so active Loader lifecycle follows the durable row. Layered profile roots are refused because Include write-back would flatten bundle and user patch layers. A committed preset edit affects new standing mounts; an already mounted preset keeps its current generation.

## Alternatives considered

**Extend `agent-instructions` to accept nested candidates (`instructionFileCandidates` containing `.claude/CLAUDE.md`).** Rejected. Its candidate filter deliberately drops entries containing a separator, its test suite pins that behavior, and the workspace-context note explicitly defers directory-rule systems to their own precedence and trust design. Relaxing the boundary would fight a shipped, tested decision.

**Reuse `agent-instructions`' `agent-instructions` source kind for the injected rules.** Rejected. That loader treats any inbox message of that kind as its own workspace context and would reconcile or remove it.

**Reuse the agent `inbox` (as `agent-instructions` does) to deliver mid-turn scoped rules.** Rejected for the always-on path, but the inbox-plus-`pre-step` shape is exactly what `agent-instructions` uses for reconciliation. The scoped-rule contributor instead folds directly into the `agent/pre-step` decision; because the loop emits `agent/pre-step` before every model request (including a tool continuation), folding a newly active scoped rule into the continuation's entering decision reaches the next request without the inbox. The message-source kind isolation keeps the two loaders disjoint.

**Hand-roll a new instruction-filesystem loading pipeline.** Rejected. Duplicating the render, budget, and reconciliation machinery adds surface for little gain; the two Claude rule files are folded once at the first request and deliberately are not reconciled after edits in this increment.

## Consequences

A session that mounts the plugin sees `.claude/skills` in the catalog alongside DSH roots and gets the two Claude rule files folded into its first request. The change is additive and opt-in: it mounts via a profile `patch` or a preset composition and requires `ctx.skills`, so trees without the skill registry boot unchanged.

The rules and scoped-rule contributors are model-visible as `user` messages under distinct source kinds (`claude-code`, `claude-rule`), so they are durable and replayable like other context. Because they are not reconciled after edits, an external change to a rule file mid-session is not re-read until a new turn re-reads at its first request, matching the note's watchdog-free model. Scoped rules activate on `read` only (matching Claude Code), so a rule scoped to a file the agent writes rather than reads may not activate. `.claude/skills` discovery is also non-watching, matching `skill-filesystem`'s existing limit in that it re-runs on the next catalog refresh rather than at the exact filesystem instant.

## Deferred

A skill watcher for the Claude roots, post-edit rule re-reading, and the remaining Claude Code assets (`.claude/commands`, `.claude/settings.json` hooks, and `.mcp.json`) are deferred and out of scope here.
