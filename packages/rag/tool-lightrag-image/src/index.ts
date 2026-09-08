/**
 * Model-facing `lightrag_image` tool: fetch an image extracted by a LightRAG
 * multimodal pipeline (stored under its parsed assets dir) and return it as an
 * image content block. This package is the DSH-side consumer of LightRAG's
 * asset files; LightRAG itself exposes no image-return endpoint.
 *
 * It is NOT part of LightRAG. It is a DeepSeek Harness tool that reads an image
 * asset discovered by mapping a LightRAG document reference (the `file_path`
 * from a query result) onto LightRAG's on-disk parsed-assets convention:
 *
 *   {assetBaseUrl}/__parsed__/{sourceFile}.parsed/{basename}.blocks.assets/imageN.png
 *
 * @module @deepseek-ai/dsh-tool-lightrag-image
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Plugin config: where LightRAG's parsed-asset files are served over HTTP, and a cap. */
export interface Config {
  /** HTTP base URL that serves LightRAG's inputs dir (nginx mounting the volume). */
  assetBaseUrl: string
  /** Per-image byte cap; larger images are refused at the attachment store. */
  maxImageBytes?: number
}

export const name = 'tool-lightrag-image'

export const inject = ['tools', 'attachments']

export const Config = z.object({
  assetBaseUrl: z.string().required(),
  maxImageBytes: z.number().optional(),
})

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const

function matchBytes(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.byteLength < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

function matchAscii(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/** Sniff a supported image media type from file-signature bytes. */
function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (matchBytes(data, 0, PNG_SIGNATURE)) return 'image/png'
  if (matchBytes(data, 0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (matchAscii(data, 0, 'GIF87a') || matchAscii(data, 0, 'GIF89a')) return 'image/gif'
  if (matchAscii(data, 0, 'RIFF') && matchAscii(data, 8, 'WEBP')) return 'image/webp'
  return undefined
}

function basenameWithoutExt(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Map a LightRAG document reference (`sourceFile`, e.g. `vltest2.docx`) onto the
 * HTTP URL of one extracted image asset, following LightRAG's parsed-assets dir
 * convention. `index` is zero-based (`image1.png` at 0).
 */
function imageAssetUrl(assetBaseUrl: string, sourceFile: string, index: number): string {
  const base = basenameWithoutExt(sourceFile)
  const dir = `${assetBaseUrl.replace(/\/$/, '')}/__parsed__/${encodeURIComponent(sourceFile)}.parsed/${encodeURIComponent(base)}.blocks.assets`
  return `${dir}/image${index + 1}.png`
}

/** The structured outcome returned by the tool (attachment ref is re-derived for the image block). */
interface LightragImageValue {
  path: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function imageRefFromValue(image: LightragImageValue['image']): ImageAttachmentRef {
  return {
    attachmentId: image.attachmentId as never,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/** Require the calling route's model to declare image input, like `read_image`. */
async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('lightrag_image: the current model route could not be resolved')
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error('lightrag_image: the current model does not declare image input; switch to an image-capable model to return images')
  }
}

/**
 * Register the `lightrag_image` tool. Registration is effect-scoped: disposing
 * the plugin fiber unregisters it.
 */
export function apply(ctx: Context, config: Config): void {
  const base = config.assetBaseUrl.replace(/\/$/, '')
  ctx.tools.register(defineTool({
    name: 'lightrag_image',
    description: 'Return an image that LightRAG extracted from a document, as an image for the caller to view. '
      + 'Pass the document reference (the `file_path` from a LightRAG query `references` entry) and a zero-based image index. '
      + 'Requires the current model to accept image input.',
    parameters: {
      doc: { type: 'string', required: true, description: 'LightRAG document reference (e.g. "vltest2.docx") from a query result file_path.' },
      index: { type: 'number', description: 'Zero-based image index within that document. Default 0.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value: LightragImageValue) => {
        const blocks: ContentBlock[] = [
          { type: 'text', text: `<path>${value.path}</path>\n<type>image</type>` },
          { type: 'image', attachment: imageRefFromValue(value.image) },
        ]
        return blocks
      },
      presentationMeta: (_args, value: LightragImageValue) => ({ path: value.path }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.doc.trim().length === 0) throw new Error('doc must be a non-empty string')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('lightrag_image: no attachment service is mounted')
      await assertImageCapableRoute(ctx, exec)

      const index = args.index ?? 0
      const url = imageAssetUrl(base, args.doc, index)
      const response = await fetch(url, { signal: exec.signal })
      if (!response.ok) {
        throw new Error(`lightrag_image: failed to fetch ${url}: HTTP ${response.status}`)
      }
      const data = new Uint8Array(await response.arrayBuffer())
      const mediaType = sniffImageMediaType(data)
      if (mediaType === undefined) {
        throw new Error(`lightrag_image: ${url} does not decode as a supported PNG/JPEG/WebP/GIF image`)
      }
      const ref = await attachments.saveImage({
        data,
        mediaType,
        name: `image${index + 1}.png`,
        ...config.maxImageBytes === undefined ? {} : { maxBytes: config.maxImageBytes },
      })
      const value: LightragImageValue = {
        path: url,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
      return value
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `LightRAG image ${args.doc}`,
        kind: 'read',
        locations: [{ path: args.doc }],
      }
    },
  }))
}
