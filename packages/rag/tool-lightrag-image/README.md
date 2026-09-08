# @deepseek-ai/dsh-tool-lightrag-image

Model-facing `lightrag_image` tool for DeepSeek Harness. It returns an image
that a LightRAG multimodal pipeline extracted from a document, so a harness
agent can include the image when answering a LightRAG-backed question.

This tool is a **DeepSeek Harness** consumer. **LightRAG itself exposes no
image-return endpoint** — it only returns the source document path and the
VLM-generated image description in its `/query` `references`. The image bytes
live as files in LightRAG's parsed-assets directory. This tool reads them over
HTTP and surfaces them as an image content block.

## How it locates the image

LightRAG stores a document's extracted images at:

```
{assetDir}/__parsed__/{sourceFile}.parsed/{basename}.blocks.assets/imageN.png
```

Given a LightRAG query `references.file_path` (e.g. `vltest2.docx`), this tool
maps it onto that convention and fetches the image over `assetBaseUrl`.

## Config

```yaml
- id: tool-lightrag-image
  name: '@deepseek-ai/dsh-tool-lightrag-image'
  config:
    assetBaseUrl: http://localhost:9622
```

`assetBaseUrl` must point at an HTTP server that serves LightRAG's `inputs` dir
(a static file server, e.g. `nginx:<mounted volume>`). The image is stored
through the attachment service (`ctx.attachments`) and only rendered when the
calling model declares image input.

## Requirements
- The harness `attachment` capability mounted (it is enabled by default in
  shipped compositions).
- The current model accepts image input.
- LightRAG's parsed-assets dir served over HTTP at `assetBaseUrl`.
