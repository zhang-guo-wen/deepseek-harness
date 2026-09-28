/** Localized copy and the two write-only actions of the quick-input window. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { QUICK_INPUT_IPC, type QuickInputApi, type QuickPromptResult } from './quick-input-api.ts'

const prefix = '--dsh-quick-input-locale='
const locale = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (locale === undefined) throw new Error('desktop quick input: missing window locale')

const api: QuickInputApi = {
  ...resolveDesktopLocale(locale),
  submit: (text: string) => ipcRenderer.invoke(QUICK_INPUT_IPC.submit, text) as Promise<QuickPromptResult>,
  close: () => ipcRenderer.invoke(QUICK_INPUT_IPC.close) as Promise<void>,
}
contextBridge.exposeInMainWorld('dshQuickInput', api)
