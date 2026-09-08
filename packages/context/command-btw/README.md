---
description: "A `/btw` command that answers an ephemeral side question from the current session context, for users and maintainers choosing, composing, or debugging context-reused command answers."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-btw

English | [中文](README.zh.md)

## Summary

`dsh-command-btw` lets a user ask Claude Code's "by the way" side question in the harness: type `/btw` plus a question, and the harness answers it from the current session context. The answer is **read-only** — the assistant reads the session's existing history and system prompt but gets no tools — and it is **ephemeral**: neither the question nor the answer enters the conversation as a durable model-facing message. The question and the assembled request are recorded as a log-only `btw/request` event so the exchange stays reconstructable, while `session.deriveMessages()` is left unchanged. The command ships with the Web client and needs configuration only to cap the answer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users can ask a side question from the Web client out of the box: the `/btw` command ships with the standard `dsh` base, needs no configuration once mounted, and works in any conversation. A custom app gets the same command by mounting the command registry, the LLM service, the system-prompt service, and this plugin together.

### The `/btw` command

Type `/btw` followed by a question and send it. The assistant answers using the session's current history and system prompt, without calling any tool:

| Input | Result |
|---|---|
| `/btw what language is this project?` | Answer the question from the current context. |
| `/btw` | A usage error: `A question is required. Usage: /btw <question>`. Whitespace-only input counts as empty. |
| A question longer than `maxQuestionBytes` | An error naming the byte limit. |

Surrounding whitespace is trimmed, but the question is otherwise kept exactly as typed and recorded verbatim in the log-only `btw/request` event.

The command's defaults are deployment policy:

| Config field | Type | Default | Meaning |
|---|---|---|---|
| `maxQuestionBytes` | positive integer | — | Maximum UTF-8 bytes in the side question. |
| `maxOutputTokens` | positive integer | — | Auxiliary-generation output-token cap. |
| `timeoutMs` | positive integer | — | End-to-end request deadline in milliseconds. |
| `provider` | string | — | Explicit provider route; must be paired with `model`. |
| `model` | string | — | Explicit model id; must be paired with `provider`. |

The config fields have no library defaults, so a composition that mounts this plugin supplies all three numeric limits. When `provider` and `model` are omitted, the command reuses the route recorded by the session's last `request/header` event.

### Composing the command

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: llm
  name: '@deepseek-ai/dsh-llm'
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
- id: command-btw
  name: '@deepseek-ai/dsh-command-btw'
  config:
    maxQuestionBytes: 4096
    maxOutputTokens: 256
    timeoutMs: 30000
```

The Web client ships the command. Headless mode, ACP automation, and JSON-RPC provide no slash commands, so `/btw` is unavailable there.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The question is answered by a one-shot LLM call that mirrors the session's own context. It derives `messages` from `session.deriveMessages()` plus the appended question, and `system` from the session's assembled system prompt (`renderPrompt`), but it attaches no tool schemas — the read-only property that makes `/btw` a side question rather than a tool-driven turn. The request is logged as a `btw/request` event before dispatch, and the answer returns to the caller as the command result text.

### How a question is answered

The handler validates the question, builds the request, records `btw/request`, and streams the answer through a `BlockAssembler`. It rejects an empty or oversized question, a `max-tokens` finish, and an answer that paradoxically requests a tool. Only text blocks are surfaced; no `user/message` or `assistant/message` is appended, so the exchange is absent from `deriveMessages()` and the ordered surface.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `btw/request` event declaration, `answerBtw` handler, `/btw` command registration, config validation |
| — | No runtime invariant companion is published; each `btw/request` is an independent log-only record with no cross-event or mutable-data relationship. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They cover the command registry, the LLM auxiliary-call pattern, and the session-history projection this command reuses.

- [dsh-commands](../../interaction/commands/README.md) — the registry that discovers the global command and its `recordInput` semantics.
- [dsh-session-title-llm](../../session/session-title-llm/README.md) — the same log-only auxiliary model-request pattern (`session/title-llm-request`) this command mirrors.
- [Session projection subsystem](../../../docs/subsystems/session.md) — how `deriveMessages()` folds the ordered surface and excludes log-only events.
- [Context group map](../README.md) — where a context-reused command sits next to the request-context plugins.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/btw` side question

#### What the model sees

One auxiliary request reusing the session's history and system prompt. The request's `messages` are the session's derived history plus the side question as the final user message, and `system` is the session's assembled prompt; no tool schemas are attached. The exchange is not a durable model-facing message: the question is recorded only in `btw/request`, and the answer only in the `command/done` text, so a later `request/header` or `deriveMessages()` does not include either.

#### Token effect

Auxiliary only. The answer costs one additional model call over the reused history; because the request prefix matches the conversation, it is eligible for prompt-cache reuse. No later turn's token count changes.

#### KV Cache effect

Reuses the session's request prefix. The isolated auxiliary call does not invalidate the conversation's cache for later turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where `/btw` is a poor fit or behaves differently than a user might expect. They are current package constraints, not a task backlog.

- **No tools and no follow-up** — the answer is a single context-reusing response. A question that needs file reads, search, or a follow-up exchange belongs in a normal model turn.
- **Not part of the conversation history** — the exchange appears on the surface only as command rows and an answer text; a subsequent request does not contain it, so the model cannot reason over a `/btw` answer later.
- **One-shot answer only** — the command always surfaces the answer as the command result text, not a separate assistant message, so large answers may be clipped by the client's command-row rendering.
- **Web only among the shipped entry points** — headless mode, ACP automation, and JSON-RPC provide no command adapter, so `/btw` is unavailable there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Shipped behavior, limits, and rationale live in the sections above and the package code.

- The `btw/request` event carries `atSeq` and the assembled `system`/`route`, which is what a replay needs to reconstruct the exact request without storing duplicate history.
- The answer text is pinned by [`tests/command-btw.spec.ts`](tests/command-btw.spec.ts); changing the answer copy or the usage error changes user-visible output.

</details>
