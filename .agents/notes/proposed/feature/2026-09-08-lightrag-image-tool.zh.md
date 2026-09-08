# Agent Note: LightRAG image tool

Status: proposed

## Problem

LightRAG（HKUDS）把文档索引成知识图谱加向量库，并在开启多模态管线后，通过视觉模型提取并分析文档里的图片。它的 `/query` 响应返回答案文本（包含 VLM 对相关图片生成的描述）以及 `references` 条目，其中 `file_path` 指向**源文档**、`content` 为 `null`。LightRAG **不提供**返回文档提取图片字节的端点，且提取出的图片以**文件**存储（不在存储数据库里）。因此，一个用 LightRAG 回答问题的 DeepSeek Harness agent 无法把源文档引用的真实图片展示给用户。

## Proposal

新增一个 DeepSeek Harness 工具 `lightrag_image`，把 LightRAG 多模态管线提取出的图片作为模型可见的图片内容块返回。它不扩展 LightRAG，而是 Harness 侧对 LightRAG 资产文件的消费方。

该工具把 LightRAG 查询结果的 `references.file_path`（源文档路径，如 `vltest2.docx`）映射到 LightRAG 磁盘上的解析资产目录约定，并通过 HTTP 获取图片：

```
{assetBaseUrl}/__parsed__/{sourceFile}.parsed/{basename}.blocks.assets/imageN.png
```

取到的字节通过 attachment 服务（`ctx.attachments`）持久化，工具的 `output.render` 返回 `[{ type: 'text', ... }, { type: 'image', attachment }]`，使图片对支持视觉的模型可见、并由 Web 客户端渲染。

要用起来，必须挂载 harness 的 `attachment` 能力且调用模型声明支持图片输入（执行时都做校验，参照 `read_image` 工具），并且 LightRAG 的解析资产目录需在 `assetBaseUrl` 处通过 HTTP 暴露。实现位于 `packages/rag/tool-lightrag-image/`。

## Design

- **部署形态。** LightRAG 在 WSL 下的 Docker 容器里运行；harness 在宿主机上。另有一个静态文件服务容器（此处为 `nginx:alpine`）以只读方式挂载 LightRAG 的 `inputs` 卷，并在 `http://localhost:9622` 暴露。这是工具跨主机获取图片字节的通道。静态服务以 root 运行，以便能读取资产文件（无论属主是谁）。
- **工具。** `@deepseek-ai/dsh-tool-lightrag-image` 注册 `lightrag_image`，配置 `assetBaseUrl`，参数 `doc` 和可选 `index`，输出 `image` 内容块。`inject: ['tools', 'attachments']`。它从取到的字节嗅探媒体类型，调用 `attachments.saveImage(...)`，并返回 attachment 引用。
- **图片存储。** 图片字节是 LightRAG 解析资产目录里的文件，不在 PostgreSQL。只有 VLM 生成的描述和实体/关系条目在存储数据库里。仅备份 PostgreSQL 不会保留图片。

## Alternatives considered

- **自定义返回图片的 LightRAG 端点。** 最直接（DSH 拉一个 URL），但要改 LightRAG（一个 vendored 外部服务）及其图片资产映射，把 harness 绑定到自定义 fork。否决，改用 harness 侧工具加通用静态文件服务。
- **Harness 工具直接从挂载卷读图片文件。** 省掉 HTTP 一跳，但把工具绑死在 Docker/WSL 卷路径上，脆弱且依赖环境。否决，改用 HTTP 让工具解耦、跨主机通用。
- **LightRAG MCP server 返回图片内容块。** MCP 桥接已能暴露 MCP `image` 内容块，但 `@g99` LightRAG MCP server 的 `query_text` 只返回文本，且该 server 需要一个新工具加同样的资产获取管道。原生 harness 工具更易测试，不依赖社区 server。

## Acceptance criteria

- 给定一个含图且经 LightRAG 分析过（VLM 开启）的文档，调用 `lightrag_image(doc, index)` 的 agent 能看到图片内容块，Web 客户端能渲染。
- 不含图或 `index` 越界时明确失败并给出清晰信息。
- 当调用模型未声明图片输入或无 `attachments` 服务挂载时，工具拒绝执行。
- 新包接入并构建后，`pnpm run test` 和 `pnpm run typecheck` 通过。

## Risks

- URL 映射依赖 LightRAG 内部的 `__parsed__/.../blocks.assets` 命名约定及其 `imageN.png` 文件名；LightRAG 改名会让映射失效，直到更新工具。
- 图片资产是文件而非数据库行，不受 PostgreSQL 备份覆盖，持久性只取决于挂载的 `inputs` 卷。
- 该包是一个新单元：需 workspace 解析依赖、构建、测试；尚未接入 profile，也未经真实 agent 回合端到端校验。
- 只有文档在开启多模态管线时索引过，才会返回图片；在开启 VLM 之前索引的文档没有可分析的图片资产。
