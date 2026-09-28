/**
 * Cookie-guarded Host route behind the Electron quick-input panel: one
 * `POST` body carries one draft, and the route submits it to the most recently
 * active top-level Session.
 *
 * Trust has one home here, like every other Desktop Host route. The
 * composition's `connection` service answers the Host/Origin fence and browser
 * authentication first (`requestRejection`), and the body is validated at the
 * wire: an `application/json` media type, a bounded size, a string field.
 *
 * The route calls `ctx.sessionController` in process rather than speaking the
 * Typert RPC channel. `@Remote` only records metadata, so the direct call runs
 * the same implementation the browser reaches, without binding the shell to
 * the client's wire envelope.
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'

/** Exact path the Electron shell posts a quick-input draft to. */
export const DESKTOP_QUICK_PROMPT_PATH = '/desktop/quick-prompt'

/** Drafts are one short paragraph; anything larger on this route is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** Longest draft the route admits; the shell refuses to send more than this. */
const MAX_TEXT_CHARS = 16_384

/** Deadline shared by the Session list read and prompt admission, in milliseconds. */
const QUICK_PROMPT_DEADLINE_MS = 60_000

/** Host reply body; the shell localizes these reasons and never sees Host diagnostics. */
type QuickPromptReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: 'no-session' | 'rejected' }

/** JSON response (no-store: the answer is a live fact about the current Session). */
function sendJson(res: ServerResponse, status: number, payload: QuickPromptReply): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 for the route's one supported method. */
function sendMethodNotAllowed(res: ServerResponse): void {
  res.statusCode = 405
  res.setHeader('allow', 'POST')
  res.end()
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  // http server streams without setEncoding always yield Buffer chunks.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder so the refusal is a readable response, not a socket cut.
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * Validate one quick-prompt body at the wire: a JSON object with a bounded string draft.
 * @param text - raw request body.
 * @returns the trimmed draft, or undefined when the body is unusable.
 */
function parseQuickPromptBody(text: string): string | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the undefined case.
    return undefined
  }
  if (typeof body !== 'object' || body === null) return undefined
  const { text: draft } = body as { text?: unknown }
  if (typeof draft !== 'string') return undefined
  const trimmed = draft.trim()
  if (trimmed === '' || trimmed.length > MAX_TEXT_CHARS) return undefined
  return trimmed
}

/**
 * Choose the Session a quick-input draft belongs to.
 *
 * `list()` returns rows newest activity first, and a subagent child shares its
 * parent's column, so those are never the target. A Session with no turn yet is
 * only a fallback: opening one must not divert a draft from the work in progress.
 * @param items - Session summaries in the list's own order.
 * @returns the newest top-level Session that already has a turn, else the newest top-level Session.
 */
function selectQuickPromptTarget(items: readonly SessionSummary[]): SessionSummary | undefined {
  const topLevel = items.filter(item => item.origin !== 'subagent' && item.parentSessionId === undefined)
  return topLevel.find(item => !item.blank) ?? topLevel[0]
}

/** Map a refused admission onto the shell's coarse reasons. */
function failureOf(error: unknown): 'no-session' | 'rejected' {
  const code = error instanceof Error && 'code' in error ? String(Reflect.get(error, 'code')) : ''
  return code === 'session/not-found' ? 'no-session' : 'rejected'
}

/**
 * Register the quick-prompt route on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal removes the route.
 * @returns the route disposer, so a caller can withdraw it before shutdown.
 */
export function installDesktopQuickPromptRoute(ctx: Context): () => void {
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DESKTOP_QUICK_PROMPT_PATH,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res)
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { ok: false, failure: 'rejected' })
        return
      }
      const raw = await readBoundedBody(req)
      if (raw === null) {
        sendJson(res, 413, { ok: false, failure: 'rejected' })
        return
      }
      const text = parseQuickPromptBody(raw)
      if (text === undefined) {
        sendJson(res, 400, { ok: false, failure: 'rejected' })
        return
      }
      const sessions = ctx.get('sessionController')
      if (sessions === undefined) {
        sendJson(res, 503, { ok: false, failure: 'rejected' })
        return
      }
      const signal = AbortSignal.timeout(QUICK_PROMPT_DEADLINE_MS)
      let target: SessionSummary | undefined
      try {
        target = selectQuickPromptTarget((await sessions.list({}, signal)).items)
      } catch {
        sendJson(res, 503, { ok: false, failure: 'rejected' })
        return
      }
      if (target === undefined) {
        sendJson(res, 409, { ok: false, failure: 'no-session' })
        return
      }
      try {
        await sessions.prompt({
          // A fresh identity per request: the controller treats a repeated
          // requestId as the same message and admits nothing.
          requestId: brandString<SessionRequestId>(randomUUID()),
          sessionId: target.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, signal)
      } catch (error) {
        sendJson(res, 409, { ok: false, failure: failureOf(error) })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), 'desktop-host: quick-prompt route')
}
