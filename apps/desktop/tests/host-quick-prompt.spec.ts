import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPromptRequest, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_QUICK_PROMPT_PATH, installDesktopQuickPromptRoute } from '../../desktop-host/src/quick-prompt.ts'
import { QUICK_PROMPT_PATH } from '../src/quick-input-api.ts'

/** One registered route, as the installer hands it to the web server. */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Reply body the route promises the Electron shell. */
interface ReplyBody {
  readonly ok: boolean
  readonly failure?: string
}

const TOP_LEVEL = SessionId('quick-prompt-top-level')
const BLANK = SessionId('quick-prompt-blank')
const SUBAGENT = SessionId('quick-prompt-subagent')

let ctx: Context
let route: CapturedRoute
let summaries: SessionSummary[]
let prompts: SessionPromptRequest[]
let rejectWith: Error | undefined
let requestRejection: number | undefined
let registerCalls: number

/** Just enough of the web server to capture the one route under test. */
function webServerDouble(): Context['webServer'] {
  return {
    register: (registered: CapturedRoute) => {
      registerCalls += 1
      route = registered
      return () => {}
    },
  } as unknown as Context['webServer']
}

/** Session summaries newest first, exactly as `sessionController.list` returns them. */
function summary(sessionId: SessionId, updatedAt: number, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { agentAvailable: true, sessionId, updatedAt, running: false, blank: false, ...extra }
}

function bench(withSessionController = true): void {
  ctx = new Context()
  summaries = []
  prompts = []
  rejectWith = undefined
  requestRejection = undefined
  registerCalls = 0
  ctx.provide('webServer', webServerDouble())
  ctx.provide('connection', {
    requestRejection: () => requestRejection,
  } as unknown as Context['connection'])
  if (withSessionController) {
    ctx.provide('sessionController', {
      list: async () => ({ items: summaries }),
      prompt: async (request: SessionPromptRequest) => {
        prompts.push(request)
        if (rejectWith !== undefined) throw rejectWith
        return { accepted: true as const }
      },
    } as unknown as Context['sessionController'])
  }
  installDesktopQuickPromptRoute(ctx)
}

/** Drive the captured handler with one request and read back its status and JSON body. */
async function post(options: {
  method?: string
  contentType?: string | undefined
  body?: string
} = {}): Promise<{ status: number; body: ReplyBody | undefined }> {
  const raw = options.body ?? ''
  const request = Readable.from([Buffer.from(raw)]) as unknown as IncomingMessage
  Reflect.set(request, 'method', options.method ?? 'POST')
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType
  Reflect.set(request, 'headers', contentType === 'absent' ? {} : { 'content-type': contentType })
  let settled = 0
  let payload = ''
  const response = {
    statusCode: 0,
    setHeader: () => {},
    end: (chunk?: string) => { settled = 1; payload = chunk ?? '' },
  } as unknown as ServerResponse
  await route.handler(request, response)
  expect(settled).toBe(1)
  const status = (response as { statusCode: number }).statusCode
  return { status, body: payload === '' ? undefined : JSON.parse(payload) }
}

beforeEach(() => { bench() })
afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop Host quick-prompt route', () => {
  it('registers the path the Electron shell posts to', () => {
    expect(registerCalls).toBe(1)
    expect(route.kind).toBe('exact')
    expect(route.path).toBe(DESKTOP_QUICK_PROMPT_PATH)
    expect(QUICK_PROMPT_PATH).toBe(DESKTOP_QUICK_PROMPT_PATH)
  })

  it.each([401, 403])('refuses before reading a body when admission answers %i', async (rejection) => {
    requestRejection = rejection
    const response = await post({ body: JSON.stringify({ text: 'hello' }) })
    expect(response.status).toBe(rejection)
    expect(response.body).toBeUndefined()
    expect(prompts).toHaveLength(0)
  })

  it('rejects every method but POST', async () => {
    const response = await post({ method: 'GET' })
    expect(response.status).toBe(405)
    expect(response.body).toBeUndefined()
  })

  it('requires an application/json body', async () => {
    expect((await post({ contentType: 'text/plain', body: 'hello' })).body).toEqual({ ok: false, failure: 'rejected' })
    expect((await post({ contentType: 'absent' })).body).toEqual({ ok: false, failure: 'rejected' })
  })

  it.each([
    ['malformed JSON', '{not json'],
    ['a non-object body', '"just a string"'],
    ['a non-string field', JSON.stringify({ text: 7 })],
    ['a whitespace-only draft', JSON.stringify({ text: '   \n\t ' })],
    ['an over-long draft', JSON.stringify({ text: 'x'.repeat(20_000) })],
  ])('refuses %s', async (_label, body) => {
    const response = await post({ body })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, failure: 'rejected' })
    expect(prompts).toHaveLength(0)
  })

  it('refuses a body past the size ceiling without parsing it', async () => {
    const response = await post({ body: JSON.stringify({ text: 'x'.repeat(100_000) }) })
    expect(response.status).toBe(413)
    expect(prompts).toHaveLength(0)
  })

  it('reports no eligible Session when the list is empty', async () => {
    const response = await post({ body: JSON.stringify({ text: 'hello' }) })
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ ok: false, failure: 'no-session' })
  })

  it('skips newer subagent and blank rows for the newest Session holding work', async () => {
    summaries = [
      summary(SUBAGENT, 900, { origin: 'subagent', parentSessionId: TOP_LEVEL }),
      summary(BLANK, 800, { blank: true, agentAvailable: false }),
      summary(TOP_LEVEL, 100),
    ]
    const response = await post({ body: JSON.stringify({ text: '  ship it  ' }) })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({
      sessionId: TOP_LEVEL,
      mode: 'queue',
      content: [{ type: 'text', text: 'ship it' }],
    })
  })

  it('falls back to the newest blank Session when nothing holds a turn yet', async () => {
    summaries = [summary(BLANK, 800, { blank: true, agentAvailable: false })]
    expect((await post({ body: JSON.stringify({ text: 'first' }) })).body).toEqual({ ok: true })
    expect(prompts[0]).toMatchObject({ sessionId: BLANK })
  })

  it('mints a fresh request identity for every submission', async () => {
    summaries = [summary(TOP_LEVEL, 100)]
    await post({ body: JSON.stringify({ text: 'one' }) })
    await post({ body: JSON.stringify({ text: 'two' }) })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]?.requestId).not.toBe(prompts[1]?.requestId)
  })

  it.each([
    ['session/not-found', 'no-session'],
    ['session/agent-busy', 'rejected'],
    ['gateway/internal', 'rejected'],
  ])('maps a %s refusal onto %s', async (code, failure) => {
    summaries = [summary(TOP_LEVEL, 100)]
    rejectWith = Object.assign(new Error('refused'), { code })
    const response = await post({ body: JSON.stringify({ text: 'hello' }) })
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ ok: false, failure })
  })

  it('reports a rejectable refusal when the Session service is not mounted', async () => {
    await ctx.fiber.dispose()
    bench(false)
    const response = await post({ body: JSON.stringify({ text: 'hello' }) })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ ok: false, failure: 'rejected' })
  })

  it('withdraws the route when its effect is disposed', async () => {
    const dispose = vi.fn(() => {})
    const server = { register: () => dispose } as unknown as Context['webServer']
    const empty = new Context()
    try {
      empty.provide('webServer', server)
      empty.provide('connection', { requestRejection: () => undefined } as unknown as Context['connection'])
      installDesktopQuickPromptRoute(empty)
      await empty.fiber.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally { await empty.fiber.dispose() }
  })
})
