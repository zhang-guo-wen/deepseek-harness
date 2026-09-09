# Agent Note: Claude Code /btw command in the harness

Status: implemented

English | [中文](2026-09-08-claude-code-btw-command.zh.md)

## Problem

Claude Code's `/btw` ("by the way") lets a user ask a side question while a task is running. The question should not disturb the ongoing work and the answer should not enter the parent conversation's history. The harness had no equivalent: a side question either had to become a normal model turn (polluting history) or a fixed product feature.

The desired behavior is to answer the question as its own sub-task — a session the user can open and continue — while the parent session records only that the side question was started and shows no answer text.

## Decision

Add `packages/context/command-btw`, a small command-producing plugin that registers a global `/btw` command on `ctx.commands`. The handler does not answer the question itself. It forks a continuable child subagent on `ctx.subagents` using the configured fork provider (default `fork`), which seeds the child with the parent session's completed-turn prefix, and delivers the question as the child's initial prompt. It records a log-only `btw/spawn` session event carrying the child id and returns a short acknowledgement. Neither the question nor the answer becomes a `user/message` or `assistant/message` of the parent, so `session.deriveMessages()` of the parent is unchanged.

The fork contract:

- The handler requires a balanced parent history: it refuses while `turnBoundary.openTurnStartSeq` is non-null (an open turn) or `turnBoundary.lastTurn` is 0 (no completed turn). This guarantees the child always inherits a complete, closed prefix.
- It confirms the provider is registered (`ctx.subagents.getProvider`) and continuable-capable (`prepareContinuable` present).
- `ctx.subagents.startContinuable({ provider, label, request: { label, prompt, parent }, signal })` returns `{ childId, messageId }`.
- `btw/spawn` is appended after inbox acceptance and carries `{ question, childId }`.

The plugin is a function plugin (`name`/`inject`/`Config`/`apply`) with `inject = ['commands', 'sessionProjections', 'subagents']`. It ships in `dsh-base`, so the Web client exposes `/btw` out of the box. `headless`, `acp`, and `json-rpc` entry points provide no command adapter, so `/btw` is unavailable there.

### Config

`maxQuestionBytes` (default 4096) is the question byte cap; `provider` (default `fork`) names the `ctx.subagents` fork provider.

## Alternatives considered

**Answer the question in the parent session with one LLM call.** Rejected because the user asked for the side question to be its own forkable sub-task, not an inline answer in the parent conversation.

**Answer the question in the parent session with a normal model turn.** Rejected because a normal turn appends the question and the answer as durable model-surface messages, polluting the parent's history.

**Do not record any event, relying on the log to hold the fork implicitly.** Rejected. The fork is a real action against `ctx.subagents`, so the `btw/spawn` event records the child id and the question, keeping the action reconstructable.

**Always allow a fork even with an open or empty history.** Rejected because a child seeded with an incomplete prefix would not be a valid session.

## Consequences

The side question becomes a separate sub-task session the user can open and continue; the parent records only `btw/spawn`, `command/run`, and `command/done`, all log-only. The answer and any follow-up conversation live in the child, so the parent's model never sees the exchange and its `deriveMessages()` is unchanged, and the parent's request cache is not invalidated. The child reuses the parent's completed-turn prefix, so its first request is eligible for prompt-cache reuse. The command is Web-only among shipped entry points, requires a continuable fork provider, and requires a balanced parent history, so it cannot be used mid-task.

The command's unit tests cover the handler, config validation, the empty/oversized-question error paths, the open-turn refusal, the no-completed-turn refusal, and the fork that records `btw/spawn` with the child id.
