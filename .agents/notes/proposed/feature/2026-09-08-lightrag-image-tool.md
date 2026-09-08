# Agent Note: LightRAG image tool

Status: proposed

## Problem

LightRAG (HKUDS) indexes documents into a knowledge graph plus vector store and,
with the multimodal pipeline enabled, extracts and analyzes a document's images
through a vision model. Its `/query` response returns the answer text (which
includes a VLM-generated description of any relevant image) plus `references`
entries whose `file_path` names the **source document** and whose `content` is
`null`. LightRAG exposes **no endpoint** that returns a document's extracted
image bytes, and the extracted images are stored as **files** (not in the
storage database). So a DeepSeek Harness agent that answers a question from
LightRAG has no way to show the user the actual image referenced by a source
document.

## Proposal

Add a DeepSeek Harness tool, `lightrag_image`, that returns an image extracted
by a LightRAG multimodal pipeline as a model-visible image content block. It
does not extend LightRAG; it is a harness-side consumer of LightRAG's asset
files.

The tool maps a LightRAG query `references.file_path` (a source document path
such as `vltest2.docx`) onto LightRAG's on-disk parsed-assets convention and
fetches the image over HTTP:

```
{assetBaseUrl}/__parsed__/{sourceFile}.parsed/{basename}.blocks.assets/imageN.png
```

The fetched bytes are persisted through the attachment service
(`ctx.attachments`), and the tool's `output.render` returns
`[{ type: 'text', ... }, { type: 'image', attachment }]` so the image is visible
to a vision-capable model and rendered by the Web client.

To make it usable, the harness's `attachment` capability must be mounted and the
calling model must declare image input (both checked at execution, mirroring the
`read_image` tool), and LightRAG's parsed-assets directory must be served over
HTTP at `assetBaseUrl`. The implementation lives at
`packages/rag/tool-lightrag-image/`.

## Design

- **Deployment shape.** LightRAG runs in a Docker container under WSL; the
  harness runs on the host. A separate static file server container (here
  `nginx:alpine`) mounts LightRAG's `inputs` volume read-only and exposes it at
  `http://localhost:9622`. This is the channel the tool uses to fetch image
  bytes across the host boundary. The static server runs as root so it can read
  the asset files regardless of their owner.
- **Tool.** `@deepseek-ai/dsh-tool-lightrag-image` registers `lightrag_image`
  with `assetBaseUrl` config, `doc` and optional `index` parameters, and an
  `image` output block. `inject: ['tools', 'attachments']`. It sniffs the media
  type from the fetched bytes, calls `attachments.saveImage(...)`, and returns
  the attachment reference.
- **Image storage.** Image bytes are files in LightRAG's parsed-assets dir, not
  in PostgreSQL. Only the VLM-generated description and the entity/relation
  entries live in the storage database. Backing up PostgreSQL alone does not
  preserve images.

## Alternatives considered

- **Custom LightRAG endpoint that returns the image.** The most direct channel
  (DSH fetches a URL), but it means modifying LightRAG (a vendored external
  service) and its image-asset mapping. It couples the harness to a custom fork.
  Rejected in favor of a harness-side tool plus a generic static file server.
- **Harness tool that reads the image file directly from the mounted volume.**
  Avoids the HTTP hop, but ties the tool to the Docker/WSL volume path, which is
  fragile and environment-specific. Rejected in favor of HTTP so the tool stays
  decoupled and host-agnostic.
- **LightRAG MCP server returning image blocks.** The MCP bridge already
  surfaces MCP `image` content blocks, but the `@g99` LightRAG MCP server's
  `query_text` returns text only, and the server would need a new tool plus the
  same asset-fetch plumbing. A native harness tool is simpler to test and does
  not depend on the community server.

## Acceptance criteria

- Given a document with an image that LightRAG analyzed (VLM enabled), an agent
  that called `lightrag_image(doc, index)` sees the image as an image content
  block, and the Web client renders it.
- A document without an image or with an out-of-range `index` fails loudly with
  a clear message.
- The tool refuses when the calling model does not declare image input or no
  `attachments` service is mounted.
- `pnpm run test` and `pnpm run typecheck` pass for the new package once it is
  wired and built.

## Risks

- The URL mapping depends on LightRAG's internal `__parsed__/.../blocks.assets`
  naming convention and its `imageN.png` file names; a LightRAG rename breaks
  the mapping until the tool is updated.
- The image assets are files, not database rows, so they are not covered by a
  PostgreSQL backup and are only as durable as the mounted `inputs` volume.
- The package is a new unit: it needs the workspace to resolve its deps, a
  build, and tests; it is not yet wired into a profile or validated end-to-end
  in a live agent turn.
- Images are returned only when the document was indexed with the multimodal
  pipeline enabled; documents indexed before VLM was enabled have no analyzable
  image assets.
