# Agent Note: harness 里的 Claude Code /btw 命令

Status: implemented

[English](2026-09-08-claude-code-btw-command.md) | 中文

## 问题

Claude Code 的 `/btw`（"by the way"）让用户能在任务运行中提问旁路问题，从会话当前上下文作答，无需工具，也不进入对话历史。harness 此前没有对应物：旁路问题要么变成普通模型回合（污染历史），要么成为固定的产品功能。

需要的是一个复用会话上下文、只读、并把交换以"对模型可见可重建但绝非持久模型表面消息"的方式记录的命令。

## 决策

新增 `packages/context/command-btw`，一个在 `ctx.commands` 上注册全局 `/btw` 命令的小型指令生产插件。handler 运行一次性 LLM 请求，请求基于会话的派生历史加上追加的问题，以及会话组装的系统提示词，不带任何工具 schema。分发前将请求记录为仅日志的 `btw/request` 会话事件，答案以命令结果文本返回。问题和答案都不作为 `user/message` 或 `assistant/message` 追加，因此 `session.deriveMessages()` 不变——该交换是临时的。

答案契约：

- `messages` 是 `session.deriveMessages()` 加上裁剪后的问题作为最后一条用户消息。
- `system` 是 `renderPrompt(await systemPrompt.assemble(assembleContextFor(agent)))` —— 会话自身组装的提示词，不带工具 schema。
- 路由在设置 `config.provider`/`config.model` 时取之，否则取会话最近一次 `request/header` 的路由。
- `btw/request` 在分发前追加，携带 `{ question, atSeq, route, system, maxTokens }`；`atSeq` 之前的历史可重建 `messages`。
- 仅文本块呈现；`max-tokens` 结束、空或超大的问题，或自相矛盾请求工具的答案都会大声失败。

该插件是函数插件（`name`/`inject`/`Config`/`apply`），`inject = ['commands', 'llm', 'systemPrompt']`。它随 `dsh-base` 交付，因此 Web 客户端开箱即可用 `/btw`。`headless`、`acp`、`json-rpc` 入口不提供命令适配器，因此 `/btw` 在那里不可用。

### 配置

`maxQuestionBytes`、`maxOutputTokens`、`timeoutMs` 是带库默认值（4096 / 256 / 30000）的数值上限。`provider` 与 `model` 可选且必须成对提供；省略时路由从会话的 `request/header` 读取。

## 考虑过的替代方案

**复用 `ctx.commands`，让 `/btw` 跑普通模型回合。** 不予采用，因为普通回合会把问题与答案追加为持久模型表面消息，破坏定义 `/btw` 的临时属性。

**不记录任何事件，依赖日志隐式承载交换。** 不予采用。命令会到达模型，因此对模型可见的输入必须保持可重建；省略事件会使命令的问题无法从日志重建。

**把 `/btw` 注册为受保护 subagent 或工具调用。** 不予采用。`/btw` 定义上就是只读的（无工具、无新上下文），给它工具访问或全新 subagent 上下文会改变其含义。

**为 `/btw` 调用给 `GenerateOptions` 新增一个 `purpose` 值。** 本次变更不采用。辅助调用无需 purpose 值即可进行；purpose 只是提供方提示，尚无提供方需要它。

## 后果

该交换是临时的，且不在 `deriveMessages()` 中，与 Claude Code 一致。问题与答案仅以命令行与答案文本呈现，因此后续请求无法基于 `/btw` 答案推理；任何需要工具或跟进的内容应走普通回合。仅日志的 `btw/request` 事件在"对模型可见即已记录"不变量下保持模型可见输入可重建，同时不重复消息历史。该命令在已交付入口中仅限 Web，且受其配置上限约束。

recorded-session snapshot 固定其临时性；该命令的单元测试覆盖 handler、配置校验，以及 max-token 与空问题错误路径。
