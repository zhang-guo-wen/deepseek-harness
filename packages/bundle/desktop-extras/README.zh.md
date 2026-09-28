---
description: "把桌面应用的第三方插件作为一个可开关的 profile 层分发。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-extras

[English](README.md) | 中文

## 概述

此可选 Bundle 向 profile 插入六个第三方插件：Claude Code 兼容、MCP 服务器管理、记忆目录、CJK 网页字体美化、HTML 设计审查与 git worktree 隔离。随包模板默认关闭它，新的桌面 profile 会选择它。在插件管理页启用“桌面扩展”，或运行下方 `dsh plugin` 命令。每个条目保留各自的配置、下载与网络行为。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件管理页启用“桌面扩展”，或在 profile 中声明该层：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-desktop-extras
dsh plugin --profile <name> remove @deepseek-ai/dsh-desktop-extras
```

该命令会从 registry 把包安装进 profile，因此在此版本发布前返回 404。在已随包分发该包的发行版中，只需把该层列入 `dsh.profile.bundles`，无需 registry 副本。移除该层会禁用全部六个条目并保留已安装的包。profile 补丁可按 id 覆盖或禁用任一条目，因为 profile 补丁在所有 Bundle 层之后应用。

### 你将获得

- `claude-compat` — Claude Code 兼容：技能发现、记忆文件加载、作用域规则与设置开关。
- `mcp-manager` — MCP 服务器管理：编写组合条目、选择服务器加载时机，并按会话过滤其工具。
- `memory` — 带 `MEMORY.md` 索引与主题文件的记忆目录、memory 工具与设置页。
- `ui-beautify` — 按需下载开源 CJK 网页字体，并让 Web GUI 选择正文字体。
- `web-design` — 在侧栏中预览与编辑 HTML 元素。
- `worktree` — 创建 git worktree、将其注册为独立项目，并在其中启动会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

静态 `cordis.patch.yml` 在 profile 根上插入六个条目，各自带稳定 id。每个条目保留该包自己的配置、peer 与客户端 bundle；该层不新增服务。可选 Bundle 准入让包随安装分发、但不在任何 profile 模板中被选择，因此插件管理器以关闭状态提供它，`OPTIONAL_BUNDLES` 记录该准入。该层没有自己的运行时状态，因此不发布不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[桌面应用](../../../apps/desktop/README.zh.md)、[随包可选 Bundle](../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.zh.md)、[包地图](../../README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为该层只插入第三方条目，每个被插入的包拥有自己的模型可见行为。

#### KV 缓存影响

没有自身影响；提示或工具 schema 的变化由被插入的包拥有。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 这六个包是按范围（`^1.0.0`）固定的第三方依赖。它们的测试与发布验证由各自项目负责，因此不兼容的版本需要在这里更新范围。
- 该层不自带 MCP 服务器与凭据。`mcp-manager` 负责编写条目，但服务器仍需在 profile 补丁中提供自己的命令或 URL。
- 新的桌面 profile 会选择该层，因此桌面应用启动时六个插件均已启用。随包模板保持不变；Web 或 CLI profile 需要显式启用该层。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
