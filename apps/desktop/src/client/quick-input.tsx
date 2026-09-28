/** Mount the local React quick-input renderer before Electron reveals the panel. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { QuickInput } from './QuickInputPage.tsx'
import type { QuickInputApi } from '../quick-input-api.ts'

declare global {
  interface Window {
    dshQuickInput: QuickInputApi
  }
}

const palette = window.matchMedia('(prefers-color-scheme: dark)')
const syncPalette = (): void => { document.body.toggleAttribute('data-ds-dark-theme', palette.matches) }
syncPalette()
palette.addEventListener('change', syncPalette)
window.addEventListener('pagehide', () => { palette.removeEventListener('change', syncPalette) }, { once: true })

const container = document.getElementById('root')
if (container === null) throw new Error('desktop quick input: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(<QuickInput api={window.dshQuickInput} />) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
