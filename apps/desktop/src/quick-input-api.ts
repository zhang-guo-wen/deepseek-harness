/** Operations available to the isolated quick-input renderer. */

import type { DesktopLocale } from './locale.ts'

/** Private quick-input channels, installed only while its window exists. */
export const QUICK_INPUT_IPC = {
  submit: 'dsh-quick-input:submit',
  close: 'dsh-quick-input:close',
} as const

/** Exact Host path this shell posts a draft to; the Desktop Host registers the matching route. */
export const QUICK_PROMPT_PATH = '/desktop/quick-prompt'

/**
 * Deadline for one quick-prompt request, in milliseconds. Longer than the
 * route's own budget so the Host's refusal reaches the panel instead of the
 * panel giving up on a Host that is still working.
 */
export const QUICK_PROMPT_REQUEST_MS = 75_000

/**
 * Coarse submission failure the shell localizes. The Host's own diagnostics
 * never cross IPC: the renderer only picks copy for one of these reasons.
 */
export type QuickPromptFailure =
  /** The draft held no non-whitespace text. */
  | 'empty'
  /** The Host has no Session to receive the prompt. */
  | 'no-session'
  /** The Desktop Host or its quick-prompt route is not reachable. */
  | 'unavailable'
  /** The Host refused the prompt, such as an Agent that cannot accept it now. */
  | 'rejected'

/** Outcome of one quick-input submission. */
export type QuickPromptResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: QuickPromptFailure }

/** Interface the isolated preload exposes to the quick-input renderer. */
export type QuickInputApi = DesktopLocale & {
  /**
   * Submit one plain-text prompt to the most recently active Session.
   * @param text - draft exactly as typed; the Host rejects whitespace-only content.
   * @returns the outcome, without Host error details.
   */
  submit(text: string): Promise<QuickPromptResult>
  /** Hide the window; the tray toggle shows it again. */
  close(): Promise<void>
}

/** Body of one quick-prompt request to the Desktop Host. */
export interface QuickPromptRequest {
  readonly text: string
}

/** Host reply to one quick-prompt request. */
export type QuickPromptResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: QuickPromptFailure }

/** Bound the draft the renderer may submit; the Host route enforces the same limit. */
export const QUICK_PROMPT_MAX_CHARS = 16_384

/**
 * Trim and bound one submitted draft.
 * @param value - candidate draft from the renderer.
 * @returns the trimmed text, or undefined when it is not submittable.
 */
export function normalizeQuickPrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text.length > QUICK_PROMPT_MAX_CHARS) return undefined
  return text
}

/**
 * Validate the Host reply, which arrives as untyped JSON.
 * @param value - parsed response body.
 * @returns the reply; anything unrecognized reads as an unreachable Host.
 */
export function parseQuickPromptResponse(value: unknown): QuickPromptResponse {
  if (typeof value !== 'object' || value === null) return { ok: false, failure: 'unavailable' }
  const record: Record<string, unknown> = { ...value }
  if (record['ok'] === true) return { ok: true }
  const failure = record['failure']
  if (failure === 'empty' || failure === 'no-session' || failure === 'unavailable' || failure === 'rejected') {
    return { ok: false, failure }
  }
  return { ok: false, failure: 'unavailable' }
}
