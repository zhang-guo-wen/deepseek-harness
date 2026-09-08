---
description: "DeepSeek Harness 的 Claude Code 兼容：发现 .claude/skills 并加载 CLAUDE.md 规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-claude-compat

English | [中文](README.zh.md)

## 概要

Claude Code 把技能放在 `<root>/.claude/skills/<name>/SKILL.md`，把规则放在 `CLAUDE.md`。本包让 Harness 两者都能读：在共享的技能注册表（`dsh-skill`）上再注册一个技能 provider，使 `.claude/skills` 进入会话目录；并把项目 `.claude/CLAUDE.md` 与用户全局 `~/.claude/CLAUDE.md` 折叠进首次请求，作为独立的 instructions-form 上下文。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)
- [开发说明](#开发说明)

-----

<a id="使用本包"></a>
## 使用本包

与技能注册表一起挂载；需要 `ctx.skills`。用 profile 的 `patch` 或预设组合像其他插件一样插入即可。

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-claude-compat'
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `providerName` | `claude-code` | 注册在 `ctx.skills` 上的唯一 provider 名 |
| `claudeHome` | `$CLAUDE_HOME` 或 `~/.claude` | Claude Code 目录；扫描其 `skills` 与 `CLAUDE.md` |
| `projectRootMarkers` | `['.git']` | 识别项目根的目录条目 |
| `includeProjectRoot` | `true` | 扫描项目 `.claude/skills` 根 |
| `includeGlobalRoot` | `true` | 扫描用户 `~/.claude/skills` 根 |
| `includeProjectRule` | `true` | 加载项目 `.claude/CLAUDE.md` 规则 |
| `includeGlobalRule` | `true` | 加载全局 `~/.claude/CLAUDE.md` 规则 |

### 技能

| 等级 | 来源 | 路径 |
|---|---|---|
| 250 | `project-claude` | `<projectRoot>/.claude/skills` |
| 550 | `user-claude` | `~/.claude/skills` |

项目根为最近的、含 `.git` 的祖先目录；没有则用当前 cwd。本 provider 的候选等级低于 DSH 自身项目根，因此同名 DSH 技能优先。技能为 `<root>/.claude/skills/<name>/SKILL.md`（或平级 `<name>.md`），带 YAML frontmatter：必填 `name` 与 `description`，可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。

### 规则

项目 `.claude/CLAUDE.md` 与全局 `~/.claude/CLAUDE.md` 会被读取，并作为 `user` 消息（`claude-code` message-source kind）折叠进首次请求。Harness 自身的 `agent-instructions` 只加载同目录文件名（`AGENTS.md`、`CLAUDE.md`）；本贡献者新增这两个 Claude Code 位置而不改动那个加载器。规则文件缺失或不可读不是致命错误。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明发现的组织方式；可观察行为见[使用本包](#使用本包)。

### 设计概念

技能 provider 沿用 `skill-filesystem` 模型：发现时解析 frontmatter 成目录条目，每次加载重新读取文件，因此正文编辑无需缓存失效。指令贡献者复用 `agent-instructions` 的 `agent/pre-step` waterfall，把指令折叠在最后一个已接收用户消息之后。两者在存在文件系统服务时优先使用 `ctx.fs`，否则回退到可中断的 Node I/O。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：注册 provider 与指令监听器 |
| [`src/provider.ts`](src/provider.ts) | 技能 provider：根解析、发现与加载 |
| [`src/parse.ts`](src/parse.ts) | `SKILL.md` frontmatter 解析 |
| [`src/instructions.ts`](src/instructions.ts) | Claude Code 规则发现与 pre-step 注入 |
| — | 未发布 run-time invariant 伴生；本包在注册表与消息源契约之外没有独立事件序列或可变数据关系。 |

</details>

-----

<a id="模型体验"></a>
## 模型体验

技能通过 `dsh-tool-skill` 到达模型，渲染本 provider 的可调用名与截断描述进目录。Claude Code 规则以 instructions-form 的 `user` 消息折叠进回合的首次请求。

## 已知限制与待办

<a id="已知限制与待办"></a>

- **暂无技能 watch** — provider 在 `list()` 时发现；`.claude/skills` 条目的动态增删改只有再次发现（如另一 provider 失效目录时）才会被拾取。
- **规则编辑后不重调和** — 与 `agent-instructions` 不同，Claude Code 规则文件只在首次请求折叠一次；之后的编辑不会在会话中重读。
- **项目范围是最接近的 `.git` 祖先** — 无该标记的工作区回退到传入的 cwd。
- **畸形条目静默消失** — 无有效 frontmatter 的 `.claude/skills` 文件被跳过，不会出现在目录里。

<a id="开发说明"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
