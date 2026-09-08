# Agent Note: Claude Code 指令兼容插件

Status: proposed

[English](2026-09-08-claude-code-command-compatibility.md) | 中文

## 问题

Anthropic Claude Code 暴露了五种使用起来很顺手、而 Harness 目前没有直接对应物的指令界面：`/btw <问题>`、`! <命令>`、`/batch <指令>`、`/loop [间隔] [命令|提示词]` 和 `/cron`。

这五种机制的形态各不相同，每一种都落在 Harness 不同的扩展点上。`/btw` 是临时提问，必须复用当前上下文、不使用任何工具、且绝不进入对话历史。`!` 是终端命令前缀，不是斜杠指令。`/batch` 是并行 agent 编排。`/loop` 是会话内循环调度器。`/cron` 是持久化的跨会话调度器。把它们硬塞进一个插件，或教 agent 循环去理解这些字符串，都会把错误的行为放在错误的层里。

正确的设计沿用 Harness 自身的分发规则：斜杠指令走人类指令注册表；终端执行走 shell seam；后台与循环工作走 jobs 注册表；对模型可见的输入始终能由会话日志重建。

## 提案

新增一族小型指令生产插件，每种界面一个，外加 `!` 前缀的主机端执行器和一个共享的调度/任务辅助模块。用一个可安装的 bundle 层把它们组合在一起，以便同时激活。

| 指令 | Claude Code 行为 | Harness 移植优先级 |
|---|---|---|
| `/btw <问题>` | 临时旁路提问；复用当前上下文；无工具；单次回答；绝不进入历史 | P0 |
| `! <命令>` | 直接运行终端命令 | P0 |
| `/batch <指令>` | 通过 worktree agent 进行大规模并行改动 | P1 |
| `/loop [间隔] [命令\|提示词]` | 会话内循环调度器 | P1 |
| `/cron` | 持久化的跨会话定时任务 | P1 |

### 包结构

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

每个指令包是函数插件（`name`/`inject`/`Config`/`apply`），与现有的 `command-goal`、`command-compact`、`command-feedback` 生产者一致。`packages/bundle/claude-commands/` 把它们堆叠成一个 profile 层，仿照 `dsh-base` 组合这些现有指令生产者的方式。

### `/btw` —— 临时、复用上下文的问题

通过 `ctx.inject(['commands'], …)` 注册到 `ctx.commands`。handler 运行一次 `ctx.llm.stream()` 调用，镜像会话自身上下文，但不变成模型回合：

- `messages = [...agent.session.deriveMessages(), createUserMessage([问题])]` 复用当前历史，使请求前缀与对话一致并复用其 prompt cache。
- `system` 从 `ctx.systemPrompt` 按会话装配，但不附加任何工具 schema。这种缺失正是语义一致点：`/btw` 是只读的。
- 路由取 `config.provider`/`model`，或会话日志中记录的 `request/header` 路由。
- handler 使用 `invocation.signal`，并限定 `timeoutMs`/`maxTokens`。

历史保持干净：问题**不**追加为 `user/message`，答案也**不**追加为 `assistant/message`，因此 `session.deriveMessages()` 不变。Claude Code 称其为临时；Harness 通过绝不将此对话对外呈现来保持一致。

请求仍会到达模型，因此必须可重建。新增一个仅日志、非 surface 的会话事件 `btw/request`，携带 `{ question, messageSeqs, route, system, messages, maxTokens }`，沿用 `session/title-llm-request` 模式。答案通过 `command/done` 文本加客户端 overlay 卡片呈现。仅一次回答，不跟进。

### `! <命令>` —— 终端命令前缀

`!` 不是斜杠指令。客户端 `TriggerChar` 联合类型（`'/' | '@'`）以及 `ui-input-trigger` 的 detect/core tier 都硬编码了斜杠和 at 符号，因此：

- 客户端 `packages/client/ui-bang` 把 `TriggerChar` 扩为 `'/' | '@' | '!'`，让 `core/detect.ts` 的 `boundaryOk` 和会话输入 tier 逻辑认识 `!`，并注册一个 `!` source；其 `matchEnter` 调用某个主机端 RPC 并返回 `PickOutcome`，把输出渲染成终端卡片。
- 主机端 `packages/interaction/bang-exec` 暴露一个 `Remote` 方法 `shell.runCommand(agent, line, signal)`：解析 `!` 后面的命令，调用 `ctx.shell.resolve` 再 `ctx.shell.run`，返回 canonical `ShellRunResult`（与 `tool-bash` 相同的映射），并且绝不触碰模型。

结果以终端样式渲染成消息卡片，不是模型历史条目。

### `/batch <指令>` —— 并行 subagent 编排

handler 在 subagent 与 workflow seam 上按阶段运行：

1. 侦察 subagent（`ctx.subagent`，provider `spawn`）读取指令与仓库，提出 5-30 个独立工作单元。
2. 启动前经 `ctx.user-questions` 或现有 permission/approval 预设执行批准门，对应 Claude Code 的批准步骤。
3. 每个单元通过 `ctx.subagent` 并行启动一个 subagent（`tool-subagent` 的 background/continuable 模式，或 `ctx.workflow` 对 subagent worker 的扇出）。
4. 各单元结果折叠到 `command/done` 文本中的一个摘要；单元输出渲染为 subagent 卡片。

Worktree 隔离是 Claude Code 中唯一真正依赖基础设施的部分（`git worktree`，每个 agent 一个独立分支）。Harness 没有 worktree 原语。v1 范围是把单元作为共享工作树中的并行 in-shell subagent 运行，并把"无 worktree 隔离"文档化为限制；后续可加一个可选 `ctx.worktree` provider（在 `$DSH_HOME/worktrees` 下为每个单元建 `git worktree`）在上层实现。

### `/loop [间隔] [命令|提示词]` —— 会话内循环调度器

handler 在 `ctx.jobs` 上注册一个后台任务，使用新的 `loop` `JobKind`：

- 每个 tick，`agent.followup(createUserMessage([目标]))` 排队一个新的独立回合，因此每次迭代都是独立上下文，不会膨胀。
- 目标可以是提示词（模型回合），或嵌套 `/command`（通过 `ctx.commands.execute` 重新分发）。
- `ctx.timer.interval` 驱动节奏；`{ interval: '5m' }` 解析为毫秒，支持 `s`/`m`/`h`/`d` 单位。
- 任务可通过 `job_kill`/`job_read` 取消，并绑定所属会话，因此 agent 销毁会取消它。

这是会话内、进程内的行为，通过 `ctx.jobs`，所以不会跨会话重启恢复，与 Claude Code 的会话内 loop 一致。每次迭代都是正常模型回合并被正常记录；loop 的控制留在任务侧。

### `/cron` —— 持久化的跨会话定时任务

持久化调度存储使用现有 `storage-domain`，按 session id 键控：`{ id, cronExpr|interval, target, enabled, owner, nextRunAt }`。写入时校验；crontab 表达式解析器支持标准五字段。

一个小的运行器插件挂 `ctx.timer`，在每分钟 tick 扫描 `nextRunAt <= now`，触发目标（模型回合，同 `/loop`；或嵌套命令），推进 `nextRunAt`，并记录 `cron/run` 仅日志事件。

与 `/loop` 不同，它的是持久化的且能跨会话重启存活，跨会话任务触发到所属会话。`nextRunAt` 漂移/重叠、最大并发数，以及 `/cron` 是 cron 语法调度器还是 `/schedule` 风格向导，都是待定选择；默认为 cron 语法加 `interval` 糖。

## 跨切面不变量

- 对模型可见且已记录：`/btw`、`/loop`、`/cron` 的目标会到达模型，因此各自需要对应的会话事件（`btw/request`、普通回合事件、`cron/run`），且 `/btw` 不得污染 `deriveMessages()`。
- 斜杠指令注册到 `ctx.commands`，整个生命周期流经 `command/run` 加 `command/done`；注册是 effect，重载后干净 dispose。
- `!` 不是斜杠指令，因此扩展客户端触发联合类型、detect/core tier，并新增主机端 `Remote` 方法。没有针对它的 `ctx.commands` 路径。
- 后台工作（loop、cron、batch worker）走 `ctx.jobs`，从而可 `job_kill` 且按 owner 隔离。
- 安全：`!`、loop、cron 使用与 `bash` 工具相同的沙箱/批准策略。`!` 默认取会话的 standing `ctx.sandboxPolicy`；升级路径复用 `approveEscalation`。配置门控是否允许 `/batch` 并行启动、`/cron` 长期调度。
- 指令只携带非结构化文本输入，因此 `/batch`、`/loop`、`/cron` 从 `rawInput` 解析自己的语法，这属于 command-owned 解析，符合 `dsh-commands` 的已知限制。

## 考虑过的替代方案

**实现一个 `/claude` 统括指令，重新解析整行。** 不予采用，因为五种界面无法共享同一套参数语法；`/btw` 接受问题，`/loop` 接受间隔加目标，`/cron` 接受调度，而 `!` 根本不是斜杠指令。

**教 agent 循环识别这些字符串。** 不予采用。循环负责请求构造与取消；把人类指令路由到循环里，会让对模型可见的控制流依赖循环，并破坏指令平面约定。

**为 `!` 复用 `ctx.commands`。** 不予采用。注册表解析器只匹配 `/[a-z][a-z0-9_-]*/`，前导 `!` 无法命名指令。`!` 需要自己的输入触发源和主机端 `Remote`。

**把 `/loop` 和 `/cron` 实现成一个调度器。** 不予采用。`/loop` 是会话内、仅在进程内可恢复，而 `/cron` 是持久化、跨会话；存储、触发与生命周期差异足够大，应在共享辅助模块背后保持分离。

**v1 就为 `/batch` 建 git-worktree provider。** 暂缓。因为 Harness 没有 worktree 原语，也还没有消费方让这一成本值得支付；in-shell 并行路径是最小忠实移植。

## 验收标准

- `/btw` 从当前上下文作答，不使用工具，是单次回答，并保持 `session.deriveMessages()` 不变；无 key 的 recorded-session snapshot 显示答案渲染且历史未动。
- `!` 运行前台 shell 命令并渲染终端卡片，同时不产生任何 user 或 assistant 消息，且客户端把前导 `!` 识别为触发。
- `/batch` 分解指令、经批准门、并行运行单元，并折叠成一个摘要；每个单元输出渲染为 subagent 卡片。
- `/loop` 按间隔调度目标，每次迭代是独立且被记录的模型回合；任务可 `job_kill`、按 owner 隔离，且 handler 在重载后干净 dispose。
- `/cron` 持久化调度、按表达式触发、推进 `nextRunAt`、能跨会话重启存活，并记录 `cron/run` 事件。
- 每个指令都有其语法的单元测试，外加一个真实组合测试，通过 Loader 启动测试 `cordis.yml`，而非手工 `ctx.plugin(...)` 套件。
- bundle 层同时激活所有界面，并通过所属 fiber 卸载全部指令、任务、source 与 store，而不改变持久 transcript。

## 风险

这是提案，各界面的把握并不相同。`/btw` 和 `!` 最机械、最不易变。`/batch` 在无 worktree 隔离的情况下，当单元触碰同一文件时可能产生冲突编辑，因此批准门和各单元摘要需要明确说明重叠。

`/loop` 和 `/cron` 都会自行触发模型回合；若无并发上限和取消路径，它们可能用自主请求淹没一个会话。

`/cron` 需要 crontab 表达式依赖，或手写解析器，这是一个虽小但真实的新依赖或自有代码。`nextRunAt` 的漂移与重叠策略尚未定案；若保持隐式，可能导致漏跑或重复跑。

客户端 `!` 改动触及共享 `ui-input-trigger` 核心（`TriggerChar`、`boundaryOk`、tier 逻辑），因此是跨包改动而非孤立功能，必须保持现有 `/` 和 `@` 行为不变。
