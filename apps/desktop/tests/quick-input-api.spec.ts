import { describe, expect, it } from 'vitest'
import {
  QUICK_PROMPT_MAX_CHARS, normalizeQuickPrompt, parseQuickPromptResponse,
} from '../src/quick-input-api.ts'

describe('quick-input wire helpers', () => {
  it.each([
    ['a plain draft', 'hello', 'hello'],
    ['a padded draft', '  ship it  ', 'ship it'],
    ['an inner newline', 'one\ntwo', 'one\ntwo'],
  ])('keeps %s', (_label, input, expected) => {
    expect(normalizeQuickPrompt(input)).toBe(expected)
  })

  it.each([
    ['a non-string', 7],
    ['an empty draft', ''],
    ['a whitespace-only draft', ' \n\t '],
    ['a draft past the ceiling', 'x'.repeat(QUICK_PROMPT_MAX_CHARS + 1)],
  ])('refuses %s', (_label, input) => {
    expect(normalizeQuickPrompt(input)).toBeUndefined()
  })

  it('accepts a draft exactly at the ceiling', () => {
    expect(normalizeQuickPrompt('x'.repeat(QUICK_PROMPT_MAX_CHARS))).toHaveLength(QUICK_PROMPT_MAX_CHARS)
  })

  it.each(['empty', 'no-session', 'unavailable', 'rejected'] as const)('passes through the %s refusal', (failure) => {
    expect(parseQuickPromptResponse({ ok: false, failure })).toEqual({ ok: false, failure })
  })

  it('accepts an acceptance', () => {
    expect(parseQuickPromptResponse({ ok: true })).toEqual({ ok: true })
  })

  it.each([
    ['a non-object body', 'denied'],
    ['a null body', null],
    ['an unknown failure', { ok: false, failure: 'exploded' }],
    ['a body carrying no recognisable failure', { status: 'nope' }],
  ])('reads %s as an unreachable Host', (_label, input) => {
    expect(parseQuickPromptResponse(input)).toEqual({ ok: false, failure: 'unavailable' })
  })
})
