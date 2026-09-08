---
description: "一个 /btw 命令，从当前会话上下文回答临时旁路问题，供选择、组合或调试上下文复用命令回答的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-btw

[English](README.md) | 中文

## 摘要

`dsh-command-btw` 让用户在 harness 里使用 Claude Code 的 "by the way" 旁路提问：输入 `/btw` 加一个问题，harness 就用当前会话上下文回答。答案是**只读**的 —— 助手读取会话现有历史与系统提示词，但不获得任何工具；并且它是**临时的** —— 问题和答案都不会作为持久的、面向模型的对话消息进入会话。问题和组装后的请求被记录为仅日志的 `btw/request` 事件，使该交换保持可重建，同时 `session.deriveMessages()` 保持不变。该命令随 Web 客户端提供，只需配置上限即可。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用户可以直接从 Web 客户端提问旁路问题：`/btw` 命令随标准 `dsh` base 提供，挂载后无需配置即可在任意对话中使用。自定义应用要获得同一命令，需一起挂载命令注册表、LLM 服务、系统提示词服务与本插件。

### `/btw` 命令

输入 `/btw` 加一个问题并发送。助手使用会话的当前历史与系统提示词作答，不调用任何工具：

| 输入 | 结果 |
|---|---|
| `/btw what language is this project?` | 从当前上下文回答问题。 |
| `/btw` | 用法错误：`A question is required. Usage: /btw <question>`。仅空白的输入计为空。 |
| 超过 `maxQuestionBytes` 的问题 | 一个指出字节上限的错误。 |

周围的空白会被裁剪，但问题本身会原样保留，并逐字记录到仅日志的 `btw/request` 事件中。

命令的默认值是部署策略：

| 配置字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `maxQuestionBytes` | 正整数 | — | 旁路问题的最大 UTF-8 字节数。 |
| `maxOutputTokens` | 正整数 | — | 辅助生成的输出 token 上限。 |
| `timeoutMs` | 正整数 | — | 端到端请求的毫秒截止时间。 |
| `provider` | 字符串 | — | 显式提供方路由；必须与 `model` 成对出现。 |
| `model` | 字符串 | — | 显式模型 id；必须与 `provider` 成对出现。 |

配置字段没有库默认值，因此挂载本插件的组合需提供全部三个数值上限。当省略 `provider` 与 `model` 时，命令复用会话最近一次 `request/header` 事件记录的路由。

### 组合该命令

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

Web 客户端自带该命令。headless 模式、ACP 自动化和 JSON-RPC 不提供斜杠命令，因此 `/btw` 在那里不可用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

### 设计概念

该问题由一次性的 LLM 调用作答，镜像会话自身的上下文。它从 `session.deriveMessages()` 加上追加的问题得出 `messages`，从会话组装的系统提示词（`renderPrompt`）得出 `system`，但不附加任何工具 schema —— 这一只读属性使 `/btw` 成为旁路问题而非工具驱动的回合。请求在分发前记录为 `btw/request` 事件，答案以命令结果文本返回给调用方。

### 如何回答问题

handler 校验问题、构建请求、记录 `btw/request`，并通过 `BlockAssembler` 将答案流式输出。它会拒绝空或超大字的问题、`max-tokens` 结束，以及自相矛盾地请求工具的答案。仅文本块会呈现；不追加任何 `user/message` 或 `assistant/message`，因此该交换不在 `deriveMessages()` 与有序 surface 中。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`btw/request` 事件声明、`answerBtw` handler、`/btw` 命令注册、配置校验 |
| — | 未发布运行时不变量伴随文件；每个 `btw/request` 都是独立的仅日志记录，没有跨事件或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够时，阅读以下页面。它们涵盖本命令复用的命令注册表、LLM 辅助调用模式与会话历史投影。

- [dsh-commands](../../interaction/commands/README.zh.md) —— 发现全局命令及其 `recordInput` 语义的注册表。
- [dsh-session-title-llm](../../session/session-title-llm/README.zh.md) —— 本命令镜像的同一仅日志辅助模型请求模式（`session/title-llm-request`）。
- [会话投影子系统](../../../docs/subsystems/session.zh.md) —— `deriveMessages()` 如何折叠有序 surface 并排除仅日志事件。
- [context 组地图](../README.zh.md) —— 上下文复用命令在请求上下文插件旁的定位。

-----

<a id="model-experience"></a>
## 模型体验

### 人类 `/btw` 旁路问题

#### 模型看到什么

一个复用会话历史与系统提示词的辅助请求。请求的 `messages` 是会话的派生历史加上作为最后一条用户消息的旁路问题，`system` 是会话组装的提示词；不附加任何工具 schema。该交换不是持久的模型可见消息：问题仅记录在 `btw/request`，答案仅记录在 `command/done` 文本，因此后续的 `request/header` 或 `deriveMessages()` 都不包含它们。

#### Token 影响

仅辅助性质。答案在复用历史之上多花费一次模型调用；由于请求前缀与对话匹配，它符合提示词缓存复用的条件。后续回合的 token 数不变。

#### KV 缓存影响

复用会话的请求前缀。这个独立的辅助调用不会使对话后续回合的缓存失效。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了 `/btw` 不适用或行为与用户预期不同的地方。它们是当前包的约束，而非任务积压。

- **无工具、无跟进** —— 答案是单个复用上下文的响应。需要文件读取、搜索或跟进交换的问题应走正常模型回合。
- **不属于对话历史** —— 该交换仅在 surface 上以命令行与答案文本出现；后续请求不包含它，因此模型之后无法基于 `/btw` 答案推理。
- **仅一次性解答** —— 命令总是以命令结果文本呈现答案，而非单独的助手指令消息，因此大答案可能被客户端命令行的渲染裁剪。
- **已提供的入口点中仅 Web** —— headless 模式、ACP 自动化与 JSON-RPC 不提供命令适配器，因此 `/btw` 在那里不可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

本开发备注是维护者的工作上下文；它明确不具权威性。已发布的行为、限制与理由见上文各节与包代码。

- `btw/request` 事件携带 `atSeq` 与组装的 `system`/`route`，这是回放重建精确请求所需而又不重复存储历史的部分。
- 答案文本由 [`tests/command-btw.spec.ts`](tests/command-btw.spec.ts) 固定；更改答案文案或用法错误会改变用户可见输出。

</details>
