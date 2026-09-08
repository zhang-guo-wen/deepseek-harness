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

To keep the two loaders from managing each other's messages, the injected context carries a new merge-extensible message source `claude-code` (`form: 'instructions'`). `agent-instructions` filters its inbox on `kind === 'agent-instructions'`, so its `syncInbox` never sees or removes these messages, and the new kind is logged and replayed as a `user` message.

## Alternatives considered

**Extend `agent-instructions` to accept nested candidates (`instructionFileCandidates` containing `.claude/CLAUDE.md`).** Rejected. Its candidate filter deliberately drops entries containing a separator, its test suite pins that behavior, and the workspace-context note explicitly defers directory-rule systems to their own precedence and trust design. Relaxing the boundary would fight a shipped, tested decision.

**Reuse `agent-instructions`' `agent-instructions` source kind for the injected rules.** Rejected. That loader treats any inbox message of that kind as its own workspace context and would reconcile or remove it.

**Hand-roll a new instruction-filesystem loading pipeline.** Rejected. Duplicating the render, budget, and reconciliation machinery adds surface for little gain; the two Claude rule files are folded once at the first request and deliberately are not reconciled after edits in this increment.

## Consequences

A session that mounts the plugin sees `.claude/skills` in the catalog alongside DSH roots and gets the two Claude rule files folded into its first request. The change is additive and opt-in: it mounts via a profile `patch` or a preset composition and requires `ctx.skills`, so trees without the skill registry boot unchanged.

The rules contributor is model-visible as a `user` message under a distinct source kind, so it is durable and replayable like other context. Because it is not reconciled after edits, an external change to a Claude rule file mid-session is not re-read until a new turn re-reads at its first request, matching the note's watchdog-free model. `.claude/skills` discovery is also non-watching, matching `skill-filesystem`'s existing limit in that it re-runs on the next catalog refresh rather than at the exact filesystem instant.

## Deferred

A skill watcher for the Claude roots, post-edit rule re-reading, additional Claude Code assets (`.claude/rules/*.md`, `.claude/commands`, `.claude/settings.json` hooks, and `.mcp.json`) are deferred and out of scope here.
