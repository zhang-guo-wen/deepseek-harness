# Agent Note: Claude Code /btw command in the harness

Status: implemented

English | [中文](2026-09-08-claude-code-btw-command.zh.md)

## Problem

Claude Code's `/btw` ("by the way") lets a user ask a side question while a task is running, answered from the session's current context, with no tools and without entering the conversation history. The harness had no equivalent: a side question either had to become a normal model turn (polluting history) or a fixed product feature.

The need was a command that reuses the session's context, is read-only, and records its exchange in a way that is model-visible-reconstructable but never a durable model-surface message.

## Decision

Add `packages/context/command-btw`, a small command-producing plugin that registers a global `/btw` command on `ctx.commands`. The handler runs one one-shot LLM request over the session's derived history plus the appended question and the session's assembled system prompt, with no tool schemas. It records the request as a log-only `btw/request` session event before dispatch, and returns the answer as the command result text. Neither the question nor the answer is appended as a `user/message` or `assistant/message`, so `session.deriveMessages()` is unchanged — the exchange is ephemeral.

The answer server contract:

- `messages` are `session.deriveMessages()` plus the trimmed question as the final user message.
- `system` is `renderPrompt(await systemPrompt.assemble(assembleContextFor(agent)))` — the session's own assembled prompt, without tool schemas.
- The route is `config.provider`/`config.model` when set, otherwise the session's last `request/header` route.
- `btw/request` is appended before dispatch and carries `{ question, atSeq, route, system, maxTokens }`; the history up to `atSeq` reconstructs `messages`.
- Only text blocks surface; a `max-tokens` finish, an empty/oversized question, or an answer that requests a tool fails loud.

The plugin is a function plugin (`name`/`inject`/`Config`/`apply`) with `inject = ['commands', 'llm', 'systemPrompt']`. It ships in `dsh-base`, so the Web client exposes `/btw` out of the box. `headless`, `acp`, and `json-rpc` entry points provide no command adapter, so `/btw` is unavailable there.

### Config

`maxQuestionBytes`, `maxOutputTokens`, and `timeoutMs` are the numeric limits with library defaults (4096 / 256 / 30000). `provider` and `model` are optional and must be supplied together; when omitted the route is read from the session's `request/header`.

## Alternatives considered

**Reuse `ctx.commands` and let `/btw` run a normal model turn.** Rejected because a normal turn appends the question and the answer as durable model-surface messages, violating the ephemeral property that defines `/btw`.

**Do not record any event, relying on the log to hold the exchange implicitly.** Rejected. The command reaches the model, so the model-visible input must stay reconstructable; omitting the event would make the command's question un-reconstructable from the log.

**Register `/btw` as a guarded subagent or a tool call.** Rejected. `/btw` is read-only by definition (no tools, no new context), so handing it tool access or a fresh subagent context would change its meaning.

**Add a new `purpose` value to `GenerateOptions` for the `/btw` call.** Rejected for this change. The auxiliary call can proceed without a purpose value; a purpose is only a provider hint, and no provider needs one yet.

## Consequences

The exchange is ephemeral and absent from `deriveMessages()`, matching Claude Code. The question and answer surface only as command rows and an answer text, so a later request cannot reason over a `/btw` answer; anything needing tools or a follow-up belongs in a normal turn. The log-only `btw/request` event keeps the model-visible input reconstructable under the model-visible-means-logged invariant without duplicating message history. The command is Web-only among shipped entry points and is answer-bounded by its config limits.

A recorded-session snapshot pins the ephemerality; the command's unit tests cover the handler, config validation, and the max-token and empty-question error paths.
