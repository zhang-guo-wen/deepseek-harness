# Agent Note: Claude Code 技能与规则兼容

Status: implemented

[English](2026-09-07-claude-code-compat.md) | 中文

## 问题

相邻产品把面向 agent 的资源放在各自专属目录。Claude Code 把技能放在 `.claude/skills/<name>/SKILL.md`，把规则放在 `CLAUDE.md`（项目级为 `<projectRoot>/.claude/CLAUDE.md`，用户全局为 `~/.claude/CLAUDE.md`）。Harness 已通过 `agent-instructions` 加载同目录平级的 `CLAUDE.md`，但不扫描 `.claude/skills`，也刻意不加载 `.claude/CLAUDE.md` 目录规则（该 note 明确 defer）。已维护 Claude Code 资产的团队希望 Harness 直接复用它们，而不必转成 DSH 专属根。

## 决策

在 `packages/context/` 下新增 `@deepseek-ai/dsh-claude-compat`，一个可选插件，读取这两块 Claude Code 表面而不改动已交付的 `agent-instructions` 加载器（其只认同目录候选的边界与对 `.claude/CLAUDE.md` 的 defer 保持不变）。

### 技能

插件在 `ctx.skills` 上再注册一个技能 provider（名 `claude-code`），与 `skill-filesystem` 相同。扫描 `<projectRoot>/.claude/skills`（等级 250，来源 `project-claude`）与 `~/.claude/skills`（等级 550，来源 `user-claude`），项目根通过向上走到配置标记（默认 `.git`）获得。解析同一前端语法（`name`、`description`、可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`），使 Claude 技能遵守相同调用控制。候选与其它 provider 合并，因此同名的 DSH 项目技能（等级更高，即更小数值）胜出。存在 `ctx.fs` 时优先使用，否则回退到可中断的 Node I/O；发现与加载分离，正文编辑无需缓存失效。

### 规则

与技能不同，指令文件没有注册表缝。插件把 `.claude/CLAUDE.md` 与 `~/.claude/CLAUDE.md` 作为增量 instructions-form 上下文贡献，而非改动 `agent-instructions`。它监听 `agent/pre-step`，读取两文件，并折叠进进入决策中最后一个已接收用户消息之后，复用 `agent-instructions` 相同的 `agent/pre-step` waterfall。文件缺失或不可读不是致命错误。

### 作用域规则

`.claude/rules/**`（项目）与 `~/.claude/rules/**`（用户）下的规则以第二种可合并 source kind `claude-rule` 折叠。规则的 YAML frontmatter 可携带 `paths:` glob 列表；无 `paths`（或空列表）的规则始终生效，像 `CLAUDE.md` 一样在首次请求折叠；带 `paths` 的规则是路径作用域的，在 `read` 到匹配某个 glob 的文件后，折叠进随后的请求。glob 相对项目根路径用 `picomatch` 匹配。

路径作用域触发监听 `tools/result` 中成功的 `read`，把匹配的作用域规则在 agent 会话上标记为激活；下一次 `agent/pre-step` 折叠它们。`agent/pre-step` 每回合触发一次，而工具续接步骤不携带新 claim 的消息，因此规则贡献者会把新激活的作用域规则折叠进空进入决策（始终生效的规则仍以非空进入步骤为门槛，避免注入到没有用户提示的回合）。每条规则每次会话至多折叠一次，用按会话的 `WeakMap` 跟踪。

为避免两个加载器互管对方消息，注入的上下文携带新的可合并消息源 `claude-code`（`form: 'instructions'`）。`agent-instructions` 以 `kind === 'agent-instructions'` 过滤其 inbox，因此其 `syncInbox` 永远看不到或移除这些消息，新 kind 作为 `user` 消息被记录与回放。

### MCP 组合写作

本插件拥有 `claudeCompatMcp` Typert Remote。其请求对象区分全局 Loader 组合与用户所有的 agent 预设、Loader 行 id 与 MCP `serverName`，并区分传输规范与显示描述。描述保留在 `context-injection.mcpDescriptions`；`mcp-client` 行只包含连接字段。浏览器设置页把这些操作暴露为「新增 / 编辑 / 启用–禁用」控件，全部经由同一个 Remote 路由。

预设的增、改、禁用通过可选的 `agentPresets` 服务解析预设，拒绝 shipped 预设，校验 Loader 行列表方言，并以加锁的原子 YAML 重写提交。直接且无 patch 的全局 Include 通过 `ctx.loader.update` 或其 Include 子树写入，使活动 Loader 生命周期跟随持久行。分层 profile 根会被拒绝，因为 Include 写回会把 bundle 与用户 patch 层压平。已提交的预设修改只影响新的 standing mount；已经挂载的预设保持当前 generation。

## 备选方案

**扩展 `agent-instructions` 接受嵌套候选（`instructionFileCandidates` 含 `.claude/CLAUDE.md`）。** 否决。其候选过滤刻意丢弃含分隔符的条目，其单测钉死了该行为，且 workspace-context note 明确把目录规则系统 defer 到各自的优先级与信任设计。放宽边界是在对抗一个已交付、已测试的决策。

**复用 `agent-instructions` 的 `agent-instructions` source kind 注入规则。** 否决。那个加载器会把 inbox 中该 kind 的任何消息当作自己的 workspace 上下文，去调和或移除。

**像 `agent-instructions` 那样复用 agent `inbox` 以在回合中投递作用域规则。** 对始终生效路径否决，但 `inbox` 加 `pre-step` 正是 `agent-instructions` 做调和所用的形状。作用域规则贡献者改为直接折叠进 `agent/pre-step` 决策；因为循环在每次模型请求（包括工具续接）前都会发出 `agent/pre-step`，把新激活的作用域规则折叠进续接的进入决策即可到达下一次请求，无需 inbox。source kind 隔离让两个加载器互不相扰。

**手写新的指令文件系统加载管线。** 否决。重复渲染、预算与调和机制只增加表面；两个 Claude 规则文件在首次请求只折叠一次，且在此增量中刻意不做编辑后重调和。

## 后果

挂载该插件后，会话会在 DSH 根之外看到 `.claude/skills`，并得到折叠进首次请求的两条 Claude 规则文件。改动是增量且可选：通过 profile `patch` 或预设组合挂载，需要 `ctx.skills`，因此没有技能注册表的树仍照常启动。

规则与作用域规则贡献者以独立 source kind（`claude-code`、`claude-rule`）作为 `user` 消息到达模型，因此像其它上下文一样可持久、可回放。因为编辑后不重调和，Claude 规则文件在会话中途的外部改动要等下一次回合的首次请求才重读，符合该 note 无 watchdog 的模型。作用域规则仅以 `read` 触发（与 Claude Code 一致），因此作用域到某个 agent 写而非读的文件上的规则可能不激活。`.claude/skills` 发现同样不监听，与 `skill-filesystem` 现有限制一致——在下一次目录刷新时重跑，而非在文件系统变化瞬间。

## Deferred

Claude 根目录的技能 watch、编辑后规则重读，以及其余 Claude Code 资产（`.claude/commands`、`.claude/settings.json` hooks、`.mcp.json`）在这里都属 defer，不在范围内。
