# Agent Note: Desktop quick-input panel

Status: implemented

[English](2026-09-28-desktop-quick-input-panel.md) | 中文

## Problem

从应用窗口之外够到正在运行的任务需要切换窗口：主窗口是唯一能提交 prompt 的界面，因此在其他应用中工作的人必须先把它切到前台、找到输入框、再切回去。另一个候选方案是隐藏界面的其余部分、只留一个悬浮输入框，但框架的每一部分——两侧栏、会话界面，以及其他插件注册进去的元素——都属于 Web 客户端的 slot 组合，把它剥到只剩一层会在每次切换时卸载侧栏和右栏。

## Decision

快捷输入面板是桌面壳自己拥有的独立 Electron 窗口，`packages/client` 不做任何改动。

`DesktopQuickInput`（`apps/desktop/src/quick-input-window.ts`）在首次显示时创建一个无边框、透明、置顶的窗口，并在本次运行的剩余时间里保留它，因此隐藏的面板会保留草稿。它只暴露两个通道——`dsh-quick-input:submit` 和 `dsh-quick-input:close`——每个都校验调用方是面板自己的主 frame。面板渲染层（`apps/desktop/src/client/QuickInputPage.tsx`）是独立的 Vite IIFE 包，运行在自己的沙箱 preload 之后，形态与欢迎窗口已经确立的一致：一个文本域、一个发送控件、本地化文案，没有对话。

提交由主进程执行。`apps/desktop/src/main.ts` 中的 `submitQuickPrompt` 带着壳已经持有的 cookie，把 `{ text }` POST 到已认证 Host 的 `POST /desktop/quick-prompt`，并把应答映射成面板本地化的四种原因。面板渲染进程从不到达 Host，壳也从不使用 Web 客户端的 RPC 通道。

`installDesktopQuickPromptRoute`（`apps/desktop-host/src/quick-prompt.ts`）在私有 Desktop Host 中提供该路由。它在读取请求体之前先应用 `ctx.connection.requestRejection`，只接受带 `application/json` 请求体的 `POST`，请求体上限 64 KiB、草稿上限 16,384 字符，并在进程内调用 `ctx.sessionController.prompt`。`@Remote` 只记录元数据、不改动方法体，因此这次直接调用运行的正是浏览器所到达的实现，同时不把壳绑死在客户端的 wire 信封上。

目标是 `ctx.sessionController.list` 中第一行既非子代理、也非空白的会话，没有时退回第一行顶层会话。`list()` 按活跃时间由新到旧返回，因此第一行符合条件的即最近活跃的会话。代码为 `session/not-found` 的拒绝变成 `no-session`，其他拒绝变成 `rejected`。

所有平台都能从应用菜单够到该面板，Windows 还可以从托盘够到，托盘把它的状态渲染为勾选标记。如果没有面板之外的控制入口，一个置顶且期望获得焦点的窗口在用户不再看着它之后就无法够到。

## Alternatives considered

**隐藏框架其余部分、保留会话界面。** 这会保留每个插件注册的元素以及会话自身的状态，但它需要在 `AppFrame` 内部提供 solo 呈现，而且侧栏和右栏——终端、文档预览、浏览器 guest——会在每次切换时卸载。

**加载第二个 Web 客户端窗口，并用注入的 CSS 隐藏它的窗口装饰。** 这样无需改动客户端，但 WebSocket 的 cookie 注入和启动失败守卫都只作用于主窗口，而且注入的选择器会依赖客户端渲染出的标记。

**让面板直接使用 RPC 通道。** 信封由客户端自己的 schema 生成，因此该 schema 一旦移动，壳就会静默失效。

**让 Host 从它自己的最近活跃信息流里选择会话。** 该路由改为每次请求时读取列表，这样 `list()` 的排序始终是"最近活跃"的唯一定义，路由本身不持有状态。

**在面板里显示回复。** 那需要会话的流式渲染器，而这正是本决策要避开的客户端工作。

## Consequences

- 草稿无需把应用切到前台就能到达当前任务，并且主窗口的文档不受影响。
- 面板不显示回复、不显示对话，因此壳与客户端不共享渲染代码，除 `user-rpc` 外没有任何消息进入会话日志。
- Desktop Host 上的这个路由是 RPC 通道之外第二个稳定的会话提交入口。它的契约只有三个字段宽，并在进程边界两侧都做了校验。
- 该面板向打包应用新增了 `lib/quick-input/**`、`renderer/quick-input.*` 和 `lib/preload-quick-input.cjs`。
- 托盘图标仍然只在 Windows 上提供；其他平台的应用菜单命令是入口。
- Host 上没有任何会话时，面板会提示没有打开的任务。它从不创建会话，并且保留草稿，使重试不必重新输入。
