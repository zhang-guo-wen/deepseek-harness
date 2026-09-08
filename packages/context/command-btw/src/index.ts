/**
 * Human-facing `/btw` ("by the way") command: an ephemeral side question
 * answered from the current session context.
 *
 * The handler runs one model request over the session log's derived history
 * plus the session's own assembled system prompt, with NO tool schemas, and
 * never publishes the question or the answer into the durable model surface.
 * The question and the exact request are recorded as a log-only `btw/request`
 * event so the model-visible input stays reconstructable, while
 * `session.deriveMessages()` is left unchanged — the exchange is ephemeral,
 * mirroring Claude Code's `/btw`.
 *
 * @module @deepseek-ai/dsh-command-btw
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { FinishReason } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { deadline } from '@deepseek-ai/dsh-timeout'

export const name = 'command-btw'
export const inject = ['commands', 'llm', 'systemPrompt']

const USAGE = 'Usage: /btw <question>'

/** Capability-owned timeout reason code for a `/btw` request. */
export const BTW_TIMEOUT_CODE = 'BTW_TIMEOUT'

/** Deployment policy for one `/btw` answer. */
export interface Config {
  /** Maximum UTF-8 bytes in the appended side question. */
  maxQuestionBytes?: number
  /** Auxiliary generation output-token cap. */
  maxOutputTokens?: number
  /** End-to-end request deadline in milliseconds. */
  timeoutMs?: number
  /** Optional explicit provider route; must be paired with `model`. */
  provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  model?: string
}

/** Validated immutable deployment policy. */
export interface ResolvedConfig {
  /** Maximum UTF-8 bytes in the appended side question. */
  maxQuestionBytes: number
  /** Auxiliary generation output-token cap. */
  maxOutputTokens: number
  /** End-to-end request deadline in milliseconds. */
  timeoutMs: number
  /** Optional explicit provider route; must be paired with `model`. */
  provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  model?: string
}

/** Library defaults for the optional numeric limits. */
const DEFAULT_MAX_QUESTION_BYTES = 4096
const DEFAULT_MAX_OUTPUT_TOKENS = 256
const DEFAULT_TIMEOUT_MS = 30_000

/** Loader field schemas with library defaults. */
export const ConfigFields = {
  maxQuestionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_QUESTION_BYTES),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  provider: z.string(),
  model: z.string(),
}

/** Loader schema for the `/btw` plugin. */
export const Config: z<Config> = z.object(ConfigFields)

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'maxQuestionBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

/** The exact model-visible request recorded before one `/btw` dispatch. */
export interface BtwRequestEventData {
  /** The trimmed side question. */
  question: string
  /** Log offset the request snapshotted at; prior events rebuild the history. */
  atSeq: SessionLogOffset
  /** Exact auxiliary LLM route used for the answer. */
  route: { provider: string; model: string }
  /** Exact assembled system prompt for the session. */
  system: string
  /** Exact auxiliary output-token cap. */
  maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Log-only pre-dispatch record of one `/btw` model request. The history is
     * the session log up to `atSeq`; the question is `question`. The answer is
     * later carried by the paired `command/done` text. Neither the question nor
     * the answer is a durable model-surface message, so this event is the
     * reconstructable record of what reached the model.
     */
    'btw/request': BtwRequestEventData
  }
}

/**
 * Validate and detach required `/btw` configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with library defaults and optional route absence preserved.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const candidate: unknown = config
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('command-btw: configuration is required')
  }
  const value = candidate as Config
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`command-btw: unknown config key "${key}"`)
  }
  // Apply library defaults, then validate the limits explicitly; the provider
  // /model pairing check follows because neither field is individually required.
  const maxQuestionBytes = value.maxQuestionBytes ?? DEFAULT_MAX_QUESTION_BYTES
  const maxOutputTokens = value.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const timeoutMs = value.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(maxQuestionBytes) || maxQuestionBytes <= 0) {
    throw new Error('command-btw: maxQuestionBytes must be a positive integer')
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('command-btw: maxOutputTokens must be a positive integer')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('command-btw: timeoutMs must be a positive integer')
  }
  const hasProvider = value.provider !== undefined
  const hasModel = value.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('command-btw: provider and model must be supplied together')
  }
  if (hasProvider
    && (typeof value.provider !== 'string' || value.provider.length === 0
      || typeof value.model !== 'string' || value.model.length === 0)) {
    throw new Error('command-btw: provider and model overrides must be non-empty strings')
  }
  return Object.freeze({
    maxQuestionBytes,
    maxOutputTokens,
    timeoutMs,
    ...value.provider === undefined ? {} : { provider: value.provider },
    ...value.model === undefined ? {} : { model: value.model },
  })
}

/** Translate a terminal finish reason into a `/btw` answer failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('command-btw: answer reached maxOutputTokens')
    case 'tool-calls':
      return new Error('command-btw: answer unexpectedly requested a tool')
    default:
      return new Error(`command-btw: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Resolve the explicit pair or the exact route captured from `request/header`. */
function resolveRoute(
  config: ResolvedConfig,
  session: Session,
): { provider: string; model: string } {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const header = session.requestHeader()
  if (header === undefined) {
    throw new Error('command-btw: no logged request route is available; configure provider and model together')
  }
  const route = (header.config as { provider?: unknown; model?: unknown } | undefined)
  if (route === undefined || typeof route.provider !== 'string' || typeof route.model !== 'string') {
    throw new Error('command-btw: the logged request route is incomplete; configure provider and model together')
  }
  return { provider: route.provider, model: route.model }
}

/**
 * Answer one `/btw` question from the current session context.
 *
 * The request reuses the session's derived history and its assembled system
 * prompt but attaches no tool schemas, so the answer is read-only. The
 * question and the request are recorded as a log-only `btw/request` event;
 * neither is published as a durable model-surface message, so
 * `session.deriveMessages()` is unchanged. The answer returns to the caller as
 * the command result text.
 * @param ctx - context exposing the LLM, system-prompt, and command services.
 * @param config - validated deployment policy.
 * @param invocation - receiving agent, raw command input, and UI cancellation.
 * @returns the settled command result.
 */
async function answerBtw(
  ctx: Context,
  config: ResolvedConfig,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const question = invocation.rawInput.trim()
  if (question.length === 0) {
    return { kind: 'error', text: `A question is required. ${USAGE}` }
  }
  if (Buffer.byteLength(question, 'utf8') > config.maxQuestionBytes) {
    return { kind: 'error', text: `The question exceeds the ${config.maxQuestionBytes}-byte limit.` }
  }
  const session = invocation.agent.session
  const history = session.deriveMessages()
  const questionMessage = createUserMessage({
    content: [{ type: 'text', text: question }],
    source: { kind: 'plugin', plugin: 'command-btw', form: 'notice', summary: question },
  })
  const messages: Message[] = [...history, questionMessage]
  const atSeq = session.seq
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(invocation.agent, invocation.signal))
  invocation.signal.throwIfAborted()
  const system = renderPrompt(assembly)
  const route = resolveRoute(config, session)
  using callDeadline = deadline(invocation.signal, config.timeoutMs, BTW_TIMEOUT_CODE)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    system,
    messages,
    maxTokens: config.maxOutputTokens,
    sessionId: session.id,
    signal: callDeadline.signal,
  }
  invocation.agent.session.append('btw/request', {
    question,
    atSeq,
    route,
    system,
    maxTokens: config.maxOutputTokens,
  } satisfies SessionEventMap['btw/request'])
  callDeadline.signal.throwIfAborted()
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  callDeadline.signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) {
    throw new Error('command-btw: answer must contain text only')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
  if (text.trim().length === 0) throw new Error('command-btw: answer produced no text')
  return { kind: 'success', text }
}

/** Register the global `/btw` command for every composed command adapter. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.commands.register({
    name: 'btw',
    description: 'by the way: answer a side question from the current context',
    input: { hint: '<question>' },
    recordInput: false,
    handler: invocation => answerBtw(ctx, resolved, invocation),
  })
}
