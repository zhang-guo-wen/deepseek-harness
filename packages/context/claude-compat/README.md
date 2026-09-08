---
description: "Claude Code compatibility for the DeepSeek Harness: discover .claude/skills and load CLAUDE.md rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-claude-compat

English | [中文](README.zh.md)

## Summary

Claude Code keeps skills as `<root>/.claude/skills/<name>/SKILL.md` and rules in `CLAUDE.md`. This package makes the harness read both. It registers one more skill provider on the shared registry (`dsh-skill`) so `.claude/skills` appears in the session catalog next to DSH's own roots, and it folds the project `.claude/CLAUDE.md` and the user-global `~/.claude/CLAUDE.md` into the first request as their own instructions-form context.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin alongside the skill registry; it requires `ctx.skills`. A profile `patch` or a preset composition inserts it like any other plugin.

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-claude-compat'
```

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `claude-code` | Unique provider name registered on `ctx.skills` |
| `claudeHome` | `$CLAUDE_HOME` or `~/.claude` | Claude Code home; scanned for `skills` and `CLAUDE.md` |
| `projectRootMarkers` | `['.git']` | Directory entries that identify the project root |
| `includeProjectRoot` | `true` | Scan the project `.claude/skills` root |
| `includeGlobalRoot` | `true` | Scan the user `~/.claude/skills` root |
| `includeProjectRule` | `true` | Load the project `.claude/CLAUDE.md` rule |
| `includeGlobalRule` | `true` | Load the global `~/.claude/CLAUDE.md` rule |

### Skills

| Rank | Source | Path |
|---|---|---|
| 250 | `project-claude` | `<projectRoot>/.claude/skills` |
| 550 | `user-claude` | `~/.claude/skills` |

The project root is the nearest ancestor containing `.git`; without one the current cwd is used. Candidates carry a lower rank than DSH's own project roots, so a same-name DSH skill wins a duplicate. A skill is `<root>/.claude/skills/<name>/SKILL.md` (or a flat `<name>.md`) with YAML frontmatter: required `name` and `description`, plus optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`.

### Rules

The project `.claude/CLAUDE.md` and the global `~/.claude/CLAUDE.md` are read and folded into the first request as a `user` message under the `claude-code` message-source kind. The harness's own `agent-instructions` loads only same-directory names (`AGENTS.md`, `CLAUDE.md`); this contributor adds the two Claude Code locations without touching that loader. A missing or unreadable rule file is not fatal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how discovery is organized; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The skill provider follows the `skill-filesystem` model: discovery parses frontmatter into catalog entries, while every load re-reads the file, so body edits need no cache invalidation. The instruction contributor reuses the `agent/pre-step` waterfall the way `agent-instructions` does, folding its instructions after the last admitted user message. Both use `ctx.fs` when a filesystem service is present, falling back to abortable Node I/O.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: registers the provider and the instruction listener |
| [`src/provider.ts`](src/provider.ts) | Skill provider: root resolution, discovery, and load |
| [`src/parse.ts`](src/parse.ts) | `SKILL.md` frontmatter parsing |
| [`src/instructions.ts`](src/instructions.ts) | Claude Code rule discovery and pre-step injection |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond the registry and message-source contracts. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

Skills reach the model through `dsh-tool-skill`, which renders this provider's invocable names and capped descriptions into the catalog. The Claude Code rules reach the model as an instructions-form `user` message folded into the first request of a turn.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No skill watcher yet** — the provider discovers on `list()`; dynamic add/rename/delete of `.claude/skills` entries is currently picked up only when discovery runs again (for example after another provider invalidates the catalog).
- **Rules are not reconciled after edits** — unlike `agent-instructions`, the Claude Code rule files are folded once at the first request; later edits are not re-read mid-session.
- **Project scope is the nearest `.git` ancestor** — workspaces without that marker fall back to the supplied cwd.
- **Malformed entries disappear** — a `.claude/skills` file without valid frontmatter is skipped rather than surfaced in the catalog.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
