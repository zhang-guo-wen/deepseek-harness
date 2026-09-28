/** Quick-input presentation: one draft, one submission, and localized failure copy. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { QuickInputApi, QuickPromptFailure } from '../quick-input-api.ts'

/** Message key carrying the copy for one submission failure. */
const FAILURE_MESSAGE = {
  empty: 'quickInputEmpty',
  'no-session': 'quickInputNoSession',
  unavailable: 'quickInputUnavailable',
  rejected: 'quickInputRejected',
} as const satisfies Record<QuickPromptFailure, keyof QuickInputApi['messages']>

/**
 * Render the floating composer. The panel never shows Conversation content: a
 * successful submission clears the draft and hides the window, while a refusal
 * keeps the draft and prints the localized reason.
 * @param props.api - isolated preload API carrying copy and the two actions.
 * @returns the draggable panel with its draft field and send control.
 */
export function QuickInput({ api }: { api: QuickInputApi }) {
  const { messages: m } = api
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<QuickPromptFailure | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)

  // Showing the panel focuses its window; taking the caret here keeps the
  // renderer free of any reveal channel from the main process.
  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.quickInputTitle
    const focusField = (): void => { field.current?.focus() }
    focusField()
    window.addEventListener('focus', focusField)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', focusField)
    }
  }, [api, m.quickInputTitle])

  const submit = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await api.submit(draft)
      if (!mounted.current) return
      if (result.ok) {
        setDraft('')
        return
      }
      setFailure(result.failure)
    } catch (_closedChannel: unknown) {
      // A hidden or disposed panel rejects in flight; there is nothing to report.
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }, [api, draft])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void api.close()
      return
    }
    // Enter sends; Shift+Enter keeps the newline the draft already inserted.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void submit()
  }

  const disabled = busy || draft.trim() === ''
  return (
    <div className="panel">
      <div className="titlebar" />
      <form className="composer" onSubmit={onSubmit}>
        <textarea
          ref={field}
          className="draft"
          rows={2}
          value={draft}
          placeholder={m.quickInputPlaceholder}
          aria-label={m.quickInputPlaceholder}
          spellCheck={false}
          onChange={(event) => { setDraft(event.target.value); setFailure(undefined) }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="send" disabled={disabled} aria-label={m.quickInputSend}>
          {m.quickInputSend}
        </button>
      </form>
      <p className="notice" role="status">
        {failure === undefined ? '' : m[FAILURE_MESSAGE[failure]]}
      </p>
    </div>
  )
}
