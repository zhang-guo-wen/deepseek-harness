# Agent Note: Claude Code command compatibility plugin

Status: proposed

English | [中文](2026-09-08-claude-code-command-compatibility.zh.md)

## Problem

Anthropic Claude Code exposes five command surfaces that are pleasant to use and that Harness currently has no direct equivalent for: `/btw <question>`, `! <command>`, `/batch <instruction>`, `/loop [interval] [cmd|prompt]`, and `/cron`.

Each of these has a distinct mechanism, and each lands on a different Harness extension point. `/btw` is an ephemeral question that must reuse the current context, use no tools, and never enter the conversation history. `!` is a terminal-command prefix, not a slash command. `/batch` is parallel agent orchestration. `/loop` is an in-session recurring scheduler. `/cron` is a durable cross-session scheduler. Porting them by hand into one plugin, or by teaching the agent loop to understand their strings, would put the wrong behavior in the wrong layer.

The right design keeps Harness' own dispatch rules: slash commands go through the human-command registry, terminal execution goes through the shell seam, background and recurring work goes through the jobs registry, and model-visible input stays reconstructable from the session log.

## Proposal

Add a family of small command-producing plugins, one per surface, plus one host executor for the `!` prefix and one shared schedule/job helper. Group them behind an installable bundle layer so they activate together.

| Command | Claude Code behavior | Harness port |
|---|---|---|
| `/btw <question>` | Ephemeral side question; reuses current context; no tools; single response; never enters history | P0 |
| `! <command>` | Terminal command run directly | P0 |
| `/batch <instruction>` | Large parallel change via worktree agents | P1 |
| `/loop [interval] [cmd\|prompt]` | In-session recurring scheduler | P1 |
| `/cron` | Durable cross-session scheduled tasks | P1 |

### Package layout

```
packages/commands/command-btw/     # /btw
packages/commands/command-batch/   # /batch
packages/commands/command-loop/    # /loop
packages/commands/command-cron/    # /cron
packages/interaction/bang-exec/    # host bang executor
packages/context/loop-schedule/    # shared loop/cron helper
packages/client/ui-bang/           # client bang trigger source
packages/bundle/claude-commands/   # grouping bundle layer
```

Each command package is a function plugin (`name`/`inject`/`Config`/`apply`), matching the existing `command-goal`, `command-compact`, and `command-feedback` producers. `packages/bundle/claude-commands/` stacks them into one profile layer, mirroring how `dsh-base` composes those existing command producers.

### `/btw` — ephemeral context-reusing question

Register on `ctx.commands` via `ctx.inject(['commands'], …)`. The handler runs one one-shot `ctx.llm.stream()` call that mirrors the session's own context without becoming a model turn:

- `messages = [...agent.session.deriveMessages(), createUserMessage([question])]` reuses the exact current history, so the request prefix matches the conversation and reuses its prompt cache.
- `system` is assembled from `ctx.systemPrompt` for the session, but no tool schemas are attached. That absence is the faithfulness point: `/btw` is read-only.
- The route comes from `config.provider`/`model` or the session's logged `request/header` route.
- The handler uses `invocation.signal` and a bounded `timeoutMs`/`maxTokens`.

History stays clean: the question is not appended as `user/message`, and the answer is not appended as `assistant/message`, so `session.deriveMessages()` is unchanged. Claude Code calls this ephemeral; Harness keeps it so by never surfacing the exchange.

The request still reaches the model, so it must be reconstructable. Add a log-only, non-surface session event `btw/request` carrying `{ question, messageSeqs, route, system, messages, maxTokens }`, following the `session/title-llm-request` pattern. The answer surfaces through the `command/done` text plus a client overlay card. One response only; no follow-up.

### `! <command>` — terminal command prefix

`!` is not a slash command. The client `TriggerChar` union (`'/' | '@'`) and the `ui-input-trigger` detect/core tier both hardcode the slash and at-sign characters, so:

- Client `packages/client/ui-bang` extends `TriggerChar` to `'/' | '@' | '!'`, teaches `core/detect.ts` `boundaryOk` and the conversation input tier logic about `!`, and registers a `!` source whose `matchEnter` calls a host RPC and returns a `PickOutcome` that renders the output as a terminal card.
- Host `packages/interaction/bang-exec` exposes a `Remote` method `shell.runCommand(agent, line, signal)` that parses the command after `!`, calls `ctx.shell.resolve` then `ctx.shell.run`, returns the canonical `ShellRunResult` (the same mapping as `tool-bash`), and never touches the model.

The result renders as a message card in terminal style. It is not a model history entry.

### `/batch <instruction>` — parallel subagent orchestration

The handler runs a staged pipeline over the subagent and workflow seams:

1. A scout subagent (`ctx.subagent`, provider `spawn`) reads the instruction and the repo and proposes 5-30 independent work units.
2. An approval gate via `ctx.user-questions` or the existing permission/approval presets runs before any spawn, matching Claude Code's approval step.
3. Each unit spawns a parallel subagent through `ctx.subagent` (the `tool-subagent` background/continuable mode, or a `ctx.workflow` fan-out against subagent workers).
4. Per-unit results fold into one summary in the `command/done` text; unit outputs render as subagent cards.

Worktree isolation is the one genuinely infrastructure-dependent part of Claude Code (`git worktree`, a distinct branch per agent). Harness has no worktree primitive. The v1 scope is to run units as parallel in-shell subagents in the shared working tree and document no worktree isolation as a limitation; a later opt-in `ctx.worktree` provider (creating a `git worktree` per unit under `$DSH_HOME/worktrees`) can layer on.

### `/loop [interval] [cmd|prompt]` — in-session recurring scheduler

The handler registers a background job on `ctx.jobs` with a new `loop` `JobKind`:

- Each tick, `agent.followup(createUserMessage([target]))` queues a fresh independent turn, so each iteration is its own context and never balloons.
- The target can be a prompt (a model turn) or a nested `/command` (re-dispatch through `ctx.commands.execute`).
- `ctx.timer.interval` drives the cadence; `{ interval: '5m' }` parses to milliseconds with `s`/`m`/`h`/`d` units.
- The job is cancellable through `job_kill`/`job_read` and ties to the owning session, so agent disposal cancels it.

This is in-session and process-local through `ctx.jobs`, so it does not resume across a session restart, matching Claude Code's in-session loop. Each iteration is a normal model turn and is logged normally; the loop control stays job-side.

### `/cron` — durable cross-session scheduled tasks

A durable schedule store uses the existing `storage-domain` keyed by session id: `{ id, cronExpr|interval, target, enabled, owner, nextRunAt }`. A writer validates at write time; a crontab-expression parser supports the standard five fields.

A small runner plugin mounts `ctx.timer` and, on each minute tick, scans for `nextRunAt <= now`, fires the target (a model turn like `/loop`, or a nested command), advances `nextRunAt`, and records a `cron/run` log-only event.

Unlike `/loop`, this is durable and survives a session restart, and a cross-session task fires into its owning session. `nextRunAt` drift/overlap, max concurrency, and whether `/cron` is a cron-syntax scheduler or a `/schedule`-style wizard are open choices; the default is cron syntax plus `interval` sugar.

## Cross-cutting invariants

- Model-visible and logged: `/btw`, `/loop`, and `/cron` targets reach the model, so each needs its session events (`btw/request`, ordinary turn events, `cron/run`) and `/btw` must not pollute `deriveMessages()`.
- Slash commands register on `ctx.commands` and their whole lifecycle flows through `command/run` plus `command/done`; registrations are effects and dispose cleanly after reload.
- `!` is not a slash command, so it extends the client trigger union, the detect/core tier, and adds a host `Remote` method. There is no `ctx.commands` path for it.
- Background work (loop, cron, batch workers) goes through `ctx.jobs` so it is `job_kill`-able and owner-fenced.
- Safety: `!`, loop, and cron use the same sandbox/approval policy as the `bash` tool. `!` defaults to the session's standing `ctx.sandboxPolicy`; escalation reuses `approveEscalation`. Config gates whether `/batch` parallel spawns and `/cron` long-running schedules are allowed at all.
- Commands carry only unstructured text input, so `/batch`, `/loop`, and `/cron` parse their own grammar from `rawInput`, which is command-owned parsing per the `dsh-commands` known limitations.

## Alternatives considered

**Implement one `/claude` umbrella command that re-parses the whole line.** Rejected because the five surfaces cannot share an argument grammar; `/btw` takes a question, `/loop` takes an interval plus a target, `/cron` takes a schedule, and `!` is not a slash command at all.

**Teach the agent loop to recognize these strings.** Rejected. The loop owns request construction and cancellation; routing human commands through it would make model-visible control flow depend on the loop and break the command-plane contract.

**Reuse `ctx.commands` for `!`.** Rejected. The registry parser only matches `/[a-z][a-z0-9_-]*/`, so a leading `!` cannot name a command. `!` needs its own input-trigger source and host `Remote`.

**Implement `/loop` and `/cron` as one scheduler.** Rejected. `/loop` is in-session and resumable only within the process, while `/cron` is durable and cross-session; the store, trigger, and lifecycle differ enough to keep them separate behind a shared helper.

**Build a git-worktree provider for `/batch` in v1.** Deferred because Harness has no worktree primitive and no consumer yet makes that cost pay; the in-shell parallel path is the minimal faithful port.

## Acceptance criteria

- `/btw` answers from the current context, uses no tools, is a single response, and leaves `session.deriveMessages()` unchanged; a keyless recorded-session snapshot shows the answer renders and the history is untouched.
- `!` runs a foreground shell command and renders a terminal card while creating no user or assistant message, and the client accepts a leading `!` as a trigger.
- `/batch` decomposes an instruction, gates on approval, and runs units in parallel, folding a single summary; each unit output renders as a subagent card.
- `/loop` schedules a target on an interval and each iteration is an independent logged model turn; the job is `job_kill`-able and owner-fenced and the handler disposes cleanly on reload.
- `/cron` persists a schedule, fires on the expression, advances `nextRunAt`, survives a session restart, and records a `cron/run` event.
- Every command has unit tests on its grammar plus a real-composition test that boots a test `cordis.yml` through the Loader, not a hand-built `ctx.plugin(...)` suite.
- The bundle layer activates all surfaces together, and unloads all commands, jobs, sources, and stores through the owning fiber without changing durable transcript.

## Risks

An Agent Note is a proposal, and the surfaces differ in confidence. `/btw` and `!` are the most mechanical and the least likely to change. `/batch` without worktree isolation may produce conflicting edits when units touch the same files, so the approval gate and per-unit summary need to be explicit about overlap.

`/loop` and `/cron` both fire model turns on their own; without a concurrency cap and a cancel path they can flood a session with autonomous requests.

`/cron` needs a crontab-expression dependency or a hand-rolled parser, which is a small but real new dependency or piece of owned code. The drift and overlap policy for `nextRunAt` is not yet settled and can cause missed or doubled runs if left implicit.

The client `!` change touches shared `ui-input-trigger` core (`TriggerChar`, `boundaryOk`, the tier logic), so it is a cross-package edit rather than an isolated feature, and must keep the existing `/` and `@` behavior intact.
