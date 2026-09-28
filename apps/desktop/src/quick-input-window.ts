/** Frameless always-on-top quick-input panel: one draft, one submission, no Conversation rendering. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { QUICK_INPUT_IPC, normalizeQuickPrompt, type QuickPromptResult } from './quick-input-api.ts'

/** Panel size in CSS pixels: a titlebar drag strip plus the draft field. */
const QUICK_INPUT_WIDTH = 560
const QUICK_INPUT_HEIGHT = 132
/** Distance from the work-area top where the panel opens, as a fraction of its height. */
const QUICK_INPUT_TOP_RATIO = 0.22

/** Main-process capabilities the quick-input panel needs; all Host access stays here. */
export interface DesktopQuickInputOptions {
  readonly locale: () => DesktopLocale
  /** Submit one normalized draft to the Desktop Host. */
  readonly submit: (text: string) => Promise<QuickPromptResult>
  /** Return focus to the primary window after the panel hides. */
  readonly restoreFocus: () => void
}

/**
 * Reject IPC that does not come from this panel's own main frame.
 * @param event - Invoke event to check.
 * @param window - Panel that owns the channels, absent before its first show or after disposal.
 */
function assertSender(event: IpcMainInvokeEvent, window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('desktop quick input: rejected IPC from an unowned renderer')
  }
}

/**
 * Desktop-owned quick-input panel. The window is created on first show and kept
 * for the rest of the run, so a hidden panel keeps its draft and reopens without
 * a reload. It renders no Conversation: the Host route owns the submission.
 */
export class DesktopQuickInput {
  private window: BrowserWindow | undefined

  /** @param options - locale reader, Host submission, and focus restoration. */
  constructor(private readonly options: DesktopQuickInputOptions) {
    ipcMain.handle(QUICK_INPUT_IPC.submit, (event, text: unknown) => this.onSubmit(event, text))
    ipcMain.handle(QUICK_INPUT_IPC.close, (event) => {
      assertSender(event, this.window)
      this.hide()
    })
  }

  /** Whether the panel is on screen; the tray menu renders this as its checked state. */
  get visible(): boolean {
    const window = this.window
    return window !== undefined && !window.isDestroyed() && window.isVisible()
  }

  /** Show and focus the panel, or hide it when it is already on screen. */
  toggle(): void {
    if (this.visible) this.hide()
    else this.show()
  }

  /** Show the panel centered on the display holding the pointer. */
  show(): void {
    const window = this.ensure()
    this.position(window)
    window.show()
    window.focus()
  }

  /** Hide the panel and return focus to the primary window. */
  hide(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    window.hide()
    this.options.restoreFocus()
  }

  /** Destroy the panel and release its channels; the process is ending. */
  dispose(): void {
    ipcMain.removeHandler(QUICK_INPUT_IPC.submit)
    ipcMain.removeHandler(QUICK_INPUT_IPC.close)
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private async onSubmit(event: IpcMainInvokeEvent, text: unknown): Promise<QuickPromptResult> {
    assertSender(event, this.window)
    const draft = normalizeQuickPrompt(text)
    if (draft === undefined) return { ok: false, failure: 'empty' }
    const result = await this.options.submit(draft)
    // A sent prompt leaves the field empty for the next one; a refusal keeps the
    // draft so the user can retry without retyping it.
    if (result.ok) this.hide()
    return result
  }

  private position(window: BrowserWindow): void {
    const { x, y, width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    window.setBounds({
      x: Math.round(x + (width - QUICK_INPUT_WIDTH) / 2),
      y: Math.round(y + height * QUICK_INPUT_TOP_RATIO),
      width: QUICK_INPUT_WIDTH,
      height: QUICK_INPUT_HEIGHT,
    })
  }

  private ensure(): BrowserWindow {
    const existing = this.window
    if (existing !== undefined && !existing.isDestroyed()) return existing
    const window = new BrowserWindow({
      width: QUICK_INPUT_WIDTH,
      height: QUICK_INPUT_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      title: this.options.locale().messages.quickInputTitle,
      ...(process.platform === 'darwin'
        ? { vibrancy: 'menu' as const, visualEffectState: 'active' as const }
        : {}),
      webPreferences: {
        preload: fileURLToPath(new URL('./preload-quick-input.cjs', import.meta.url)),
        additionalArguments: [`--dsh-quick-input-locale=${this.options.locale().id}`],
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.window = window
    window.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    void window.loadFile(join(app.getAppPath(), 'renderer', 'quick-input.html')).catch((error: unknown) => {
      console.warn('desktop quick input: could not load its document', error)
    })
    return window
  }
}
