# Agent Note: harness 里的 Claude Code /btw 命令

Status: implemented

[English](2026-09-08-claude-code-btw-command.md) | 中文

## 问题

Claude Code 的 `/btw`（"by the way"）让用户能在任务运行中提出旁路问题。问题不应打扰进行中的工作，答案也不应进入父会话的历史。harness 此前没有对应物：旁路问题要么变成普通模型回合（污染历史），要么成为固定的产品功能。

期望的行为是把问题作为自己的子任务来回答——一个用户可以打开并继续的会话——而父会话只记录旁路问题已启动，不显示答案文本。

## 决策

新增 `packages/context/command-btw`，一个在 `ctx.commands` 上注册全局 `/btw` 命令的小型指令生产插件。handler 本身不回答问题。它在 `ctx.subagents` 上用配置的分叉提供方（默认 `fork`）分叉一个可继续对话的子代理，该提供方用父会话已完成的回合前缀作为 seed 播种子代理，并把问题作为子代理的初始提示词投递。它记录一个携带子 id 的仅日志 `btw/spawn` 会话事件，并返回简短确认。问题和答案都不会成为父会话的 `user/message` 或 `assistant/message`，因此父会话的 `session.deriveMessages()` 不变。

分叉契约：

- handler 要求父会话历史平衡：当 `turnBoundary.openTurnStartSeq` 非空（有打开回合）或 `turnBoundary.lastTurn` 为 0（无已完成回合）时拒绝。这保证子代理总能继承一个完整、闭合的前缀。
- 它确认提供方已注册（`ctx.subagents.getProvider`）且支持可继续子代理（存在 `prepareContinuable`）。
- `ctx.subagents.startContinuable({ provider, label, request: { label, prompt, parent }, signal })` 返回 `{ childId, messageId }`。
- `btw/spawn` 在 inbox 接受后追加，携带 `{ question, childId }`。

该插件是函数插件（`name`/`inject`/`Config`/`apply`），`inject = ['commands', 'sessionProjections', 'subagents']`。它随 `dsh-base` 交付，因此 Web 客户端开箱即可用 `/btw`。`headless`、`acp`、`json-rpc` 入口不提供命令适配器，因此 `/btw` 在那里不可用。

### 配置

`maxQuestionBytes`（默认 4096）是问题字节上限；`provider`（默认 `fork`）命名 `ctx.subagents` 的分叉提供方。

## 考虑过的替代方案

**在父会话中用一次 LLM 调用回答问题。** 不予采用，因为用户要求旁路问题作为自己的、可分叉的子任务，而非父会话中的内联答案。

**在父会话中用普通模型回合回答问题。** 不予采用，因为普通回合会将问题与答案追加为持久模型表面消息，污染父会话历史。

**不记录任何事件，依赖日志隐式承载分叉。** 不予采用。分叉是对 `ctx.subagents` 的真实操作，因此 `btw/spawn` 事件记录子 id 与问题，使该操作保持可重建。

**总是允许分叉，即使历史为空或打开。** 不予采用，因为用不完整前缀播种的子代理不会是合法会话。

## 后果

旁路问题成为用户可打开并继续的独立子任务会话；父会话只记录 `btw/spawn`、`command/run` 与 `command/done`，均为仅日志。答案与任何后续对话都在子会话中，因此父会话模型看不到该交换，其 `deriveMessages()` 不变，父会话的请求缓存也不被失效。子代理复用父会话的已完成回合前缀，因此其首个请求符合提示词缓存复用条件。该命令在已交付入口中仅限 Web，需要可继续分叉提供方，并要求父会话历史平衡，因此无法在任务进行中使用。

命令的单元测试覆盖 handler、配置校验、空/超大问题错误路径、打开回合拒绝、无已完成回合拒绝，以及记录 `btw/spawn` 与子 id 的分叉。
