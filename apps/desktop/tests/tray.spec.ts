import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { DesktopTray } from '../src/tray.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const trays: FakeTray[] = []
  class FakeTray extends EventEmitter {
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly image: unknown) { super(); trays.push(this) }
  }
  const menus: MenuItemConstructorOptions[][] = []
  return {
    trays, FakeTray, menus,
    createFromPath: vi.fn((path: string) => ({ path })),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => { menus.push(template); return { template } }),
  }
})
vi.mock('electron', () => ({
  Tray: native.FakeTray,
  nativeImage: { createFromPath: native.createFromPath },
  Menu: { buildFromTemplate: native.buildFromTemplate },
}))

afterEach(() => { native.trays.length = 0; native.menus.length = 0; vi.clearAllMocks() })

function setup(locale = 'en') {
  let current = resolveDesktopLocale(locale)
  let quickInputVisible = false
  const open = vi.fn()
  const quit = vi.fn()
  const toggleQuickInput = vi.fn(() => { quickInputVisible = !quickInputVisible })
  const tray = new DesktopTray({
    iconPath: 'C:/app/resources/tray.ico',
    locale: () => current,
    open,
    toggleQuickInput,
    quickInputVisible: () => quickInputVisible,
    quit,
  })
  return {
    tray, open, quit, toggleQuickInput, native: native.trays[0]!,
    setLocale: (next: string) => { current = resolveDesktopLocale(next) },
    setQuickInputVisible: (next: boolean) => { quickInputVisible = next },
  }
}

function labels(menu: MenuItemConstructorOptions[]): (string | undefined)[] {
  return menu.map(item => item.type === 'separator' ? 'separator' : item.label)
}

function click(menu: MenuItemConstructorOptions[], index: number): void {
  (menu[index] as { click: () => void }).click()
}

it('shows the application icon with its name as the tooltip and an Open / Quick Input / Quit menu', () => {
  const f = setup()
  expect(native.createFromPath).toHaveBeenCalledWith('C:/app/resources/tray.ico')
  expect(f.native.image).toEqual({ path: 'C:/app/resources/tray.ico' })
  expect(f.native.setToolTip).toHaveBeenCalledWith('DeepSeek Harness')
  expect(labels(native.menus[0]!)).toEqual(['Open DeepSeek Harness', 'Quick Input', 'separator', 'Quit DeepSeek Harness'])
  expect(f.native.setContextMenu).toHaveBeenCalledWith({ template: native.menus[0] })
})

it('opens the window on a single click and routes menu entries to their actions', () => {
  const f = setup()
  f.native.emit('click')
  expect(f.open).toHaveBeenCalledOnce()
  const menu = native.menus[0]!
  click(menu, 0)
  click(menu, 3)
  expect(f.open).toHaveBeenCalledTimes(2)
  expect(f.quit).toHaveBeenCalledOnce()
  expect(f.toggleQuickInput).not.toHaveBeenCalled()
})

it('toggles the quick-input panel and renders its state as the check mark', () => {
  const f = setup()
  expect((native.menus[0]![1] as { checked: boolean }).checked).toBe(false)
  click(native.menus[0]!, 1)
  expect(f.toggleQuickInput).toHaveBeenCalledOnce()
  // The menu is rebuilt so the entry reflects the panel the click just toggled.
  expect(native.menus).toHaveLength(2)
  expect((native.menus[1]![1] as { checked: boolean }).checked).toBe(true)
  f.setQuickInputVisible(false)
  f.tray.relabel()
  expect((native.menus[2]![1] as { checked: boolean }).checked).toBe(false)
})

it('relabels the menu in the current locale and ignores relabel after disposal', () => {
  const f = setup()
  f.setLocale('zh')
  f.tray.relabel()
  expect(labels(native.menus[1]!)).toEqual(['打开 DeepSeek Harness', '快捷输入', 'separator', '退出 DeepSeek Harness'])
  f.tray.dispose()
  f.tray.dispose()
  expect(f.native.destroy).toHaveBeenCalledOnce()
  f.tray.relabel()
  expect(native.menus).toHaveLength(2)
})
