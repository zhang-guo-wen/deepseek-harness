import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { foldSurface, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as commandBtw from '@deepseek-ai/dsh-command-btw'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

type MockScript = ConstructorParameters<typeof MockAdapter>[0]

const CONFIG = {
  maxQuestionBytes: 4096,
  maxOutputTokens: 256,
  timeoutMs: 30_000,
  provider: 'mock',
  model: 'mock',
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
  readonly adapter: MockAdapter
}

/** Build a live idle agent over a store-owned session, as an app's spine does. */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness(script: MockScript = []): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  const adapter = new MockAdapter([...script])
  ctx.llm.registerAdapter(['mock'], adapter)
  const plugin = await ctx.plugin(commandBtw, CONFIG)
  const { agent, session } = stubAgent(ctx, `command-btw-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin, adapter }
}

/** Execute `/btw` through the same registry boundary as a UI adapter. */
async function run(test: Harness, suffix = ''): Promise<{ kind: string; text?: string }> {
  const settled = await test.ctx.commands.execute(
    test.agent,
    `/btw${suffix}`,
    [],
    new AbortController().signal,
  )
  if (settled === undefined) throw new Error('btw command was not registered')
  return settled.result
}

/** The single `btw/request` log record, if any. */
function btwRequest(session: Session): Extract<SessionEvent, { type: 'btw/request' }> | undefined {
  return session.snapshotEvents().find((event): event is Extract<SessionEvent, { type: 'btw/request' }> =>
    event.type === 'btw/request')
}

describe('@deepseek-ai/dsh-command-btw registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(commandBtw.name).toBe('command-btw')
    expect(commandBtw.inject).toEqual(['commands', 'llm', 'systemPrompt'])
    expect('default' in commandBtw).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandBtw)).toBe(commandBtw)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'btw',
      description: 'by the way: answer a side question from the current context',
      input: { hint: '<question>' },
    })
    expect(test.ctx.commands.find(test.agent, 'btw')).toMatchObject({ recordInput: false })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'btw')).toBeUndefined()
  })
})

describe('/btw human command', () => {
  it('answers from the current context without entering derived history', async () => {
    const test = await harness([textResponse('It is written in Python.')])
    const result = await run(test, '  what language is this project?  ')
    expect(result).toEqual({ kind: 'success', text: 'It is written in Python.' })

    const request = btwRequest(test.session)
    expect(request?.data.question).toBe('what language is this project?')
    expect(test.adapter.requests).toHaveLength(1)
    const requestOptions = test.adapter.requests[0]
    expect(requestOptions).toBeDefined()
    expect(requestOptions?.messages.at(-1)?.role).toBe('user')
    expect(requestOptions?.tools).toBeUndefined()

    // Ephemeral: the exchange never becomes a durable model-surface message.
    for (const event of test.session.snapshotEvents()) {
      expect('surfaceOp' in event).toBe(false)
      expect(test.session.deriveEventMessage(event)).toBeNull()
    }
    expect(test.session.deriveMessages()).toEqual([])
    expect(foldSurface(test.session.snapshotEvents()).nodes).toEqual([])
  })

  it('records command bookkeeping around the authoritative btw/request event', async () => {
    const test = await harness([textResponse('Python.')])
    await run(test, ' language?')
    expect(test.session.snapshotEvents().map(event => event.type)).toEqual([
      'command/run', 'btw/request', 'command/done',
    ])
    const commandRun = test.session.snapshotEvents().find(event => event.type === 'command/run')
    expect(commandRun?.type === 'command/run' && Object.hasOwn(commandRun.data, 'args')).toBe(false)
  })

  it('rejects empty and whitespace-only input as a failed command record', async () => {
    const test = await harness()
    const expected = { kind: 'error', text: 'A question is required. Usage: /btw <question>' }
    await expect(run(test)).resolves.toEqual(expected)
    await expect(run(test, '   \n\t ')).resolves.toEqual(expected)
    expect(test.adapter.requests).toHaveLength(0)
    expect(btwRequest(test.session)).toBeUndefined()
    const done = test.session.snapshotEvents().filter(event => event.type === 'command/done')
    expect(done.map(event => event.data.kind)).toEqual(['error', 'error'])
  })

  it('rejects a question that exceeds the configured byte limit', async () => {
    const test = await harness()
    const oversized = 'x'.repeat(CONFIG.maxQuestionBytes + 1)
    await expect(run(test, ` ${oversized}`)).resolves.toEqual({
      kind: 'error',
      text: `The question exceeds the ${CONFIG.maxQuestionBytes}-byte limit.`,
    })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('maps a max-token finish to a command error', async () => {
    const stream: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    const test = await harness([stream])
    await expect(run(test, ' long answer')).rejects.toThrow('command-btw: answer reached maxOutputTokens')
  })

  it('keeps every event out of model context across a replay', async () => {
    const test = await harness([textResponse('Yes.')])
    await run(test, ' is that right?')
    const replayed = Session.create(SessionId('replay'), test.session.snapshotEvents())
    expect(replayed.deriveMessages()).toEqual([])
  })
})

describe('config validation', () => {
  it('applies library defaults when limits are omitted', () => {
    const resolved = commandBtw.resolveConfig({})
    expect(resolved.maxQuestionBytes).toBe(4096)
    expect(resolved.maxOutputTokens).toBe(256)
    expect(resolved.timeoutMs).toBe(30_000)
  })

  it('rejects unknown config keys', () => {
    expect(() => commandBtw.resolveConfig({ extra: 1 } as unknown as commandBtw.Config))
      .toThrow('unknown config key "extra"')
  })

  it('requires provider and model together', () => {
    expect(() => commandBtw.resolveConfig({ provider: 'p' }))
      .toThrow('provider and model must be supplied together')
  })

  it('rejects non-positive limits', () => {
    expect(() => commandBtw.resolveConfig({ maxOutputTokens: 0 }))
      .toThrow('maxOutputTokens must be a positive integer')
    expect(() => commandBtw.resolveConfig({ timeoutMs: -1 }))
      .toThrow('timeoutMs must be a positive integer')
  })
})
