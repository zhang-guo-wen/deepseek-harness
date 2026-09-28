/** Keyless Web review of the standalone design plugin through a real profile and Files tab. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const PLUGIN = fileURLToPath(new URL('../../../dsh-web-design', import.meta.url))
const SNAPSHOT = fileURLToPath(new URL('../../../snapshots/web/web-design-review', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const EXPECTED = join(SNAPSHOT, 'ui.expected.md')
const SHOT = fileURLToPath(new URL('../../../.artifacts/screenshots/web-design-review-editor.png', import.meta.url))
const PICKER = fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url))
const HTML = [
  '<!doctype html><html><head><style>',
  '#account-switch{display:flex;gap:8px;margin:12px 0}',
  '#account-switch .seg-item{position:relative;display:flex;align-items:center;justify-content:center;width:108px;height:44px;border:1px solid #ddd}',
  '#account-switch .seg-item input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}',
  '</style></head><body>',
  '<main id="review-card" style="padding: 24px; min-height: 180px">',
  '<h1 id="hero-title">Original heading</h1>',
  '<p id="summary">Tasks: <strong id="task-count">0</strong></p>',
  '<button id="increment" type="button" onclick="document.getElementById(\'task-count\').textContent = String(Number(document.getElementById(\'task-count\').textContent) + 1)">Increment</button>',
  '<div id="account-switch" role="radiogroup" aria-label="Account type" data-mode="email" data-changes="0">',
  '<label class="seg-item"><input type="radio" name="acct" value="email" checked><span>邮箱</span></label>',
  '<label class="seg-item"><input type="radio" name="acct" value="phone"><span>手机号</span></label>',
  '</div>',
  '<p id="signup-foot">还没有账号？<a href="/signup">免费注册</a></p>',
  '<section id="removable-block" style="padding: 12px"><span>Remove this section</span></section>',
  '</main>',
  "<script>document.getElementById('account-switch').addEventListener('change', function(event) { this.dataset.mode = event.target.value; this.dataset.changes = String(Number(this.dataset.changes || 0) + 1) })</script>",
  '</body></html>\n',
].join('')
const FILE = 'design-review.html'

/** Run one fixed npm command in the standalone package on Windows and POSIX. */
async function runPluginNpm(command: 'ci' | 'build'): Promise<void> {
  const args = command === 'ci' ? ['ci'] : ['run', 'build']
  const windows = process.platform === 'win32'
  const child = spawn(windows ? `npm ${args.join(' ')}` : 'npm', windows ? [] : args, {
    cwd: PLUGIN,
    shell: windows,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 240_000,
  })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`dsh-web-design npm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

it.skipIf(webSnapshotMode() === 'record')('keeps preview interactions live and writes only precise saved edits', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })

  if (!existsSync(join(PLUGIN, 'node_modules', 'rolldown'))) await runPluginNpm('ci')
  await runPluginNpm('build')
  const browser = await chromium.launch()
  resources.browser = browser
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE,
    compareReplaySession: 'read-only',
    paceMs: 5,
    extraInstallAnchors: [join(PLUGIN, 'package.json')],
    extraOverlayPath: [PICKER, join(PLUGIN, 'cordis.patch.yml')],
  })
  resources.scaffold = scaffold
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-design-review'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)

  const settled = scaffold.whenTurnSettled()
  const composer = page.locator('[data-composer-input]').first()
  await composer.fill('Reply with the single word LIGHTHOUSE and stop.')
  await composer.press('Enter')
  const sessionId = await settled
  await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
  const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
  if (cwd === undefined) throw new Error('review Session has no workspace cwd')
  const file = join(cwd, FILE)
  await writeFile(file, HTML)

  const column = page.locator('[data-rightbar-col]')
  await page.locator('[data-sidebar-right-expand]').click()
  await column.locator('[data-sidebar-right-guide-entry="files"]').click()
  await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
  await column.locator('[data-files-reload]').click()
  const filesTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
  await filesTab.click()
  await column.locator('[data-files-entry="file"]').getByRole('button', { name: FILE, exact: true }).click()
  const preview = column.locator('[data-textpreview-url]')
  await expect.poll(async () => (await preview.getAttribute('data-textpreview-url'))?.endsWith(`/${FILE}`)).toBe(true)
  const surface = preview.locator('[data-html-design-surface]')
  const frame = surface.locator('[data-html-design-preview]')
  const saveFile = surface.getByRole('button', { name: 'Save to file' })
  await frame.waitFor({ state: 'visible' })
  const heading = surface.frameLocator('[data-html-design-preview]').getByRole('heading', { name: 'Original heading' })
  const action = surface.frameLocator('[data-html-design-preview]').getByRole('button', { name: 'Increment' })
  const count = surface.frameLocator('[data-html-design-preview]').locator('#task-count')
  const card = surface.frameLocator('[data-html-design-preview]').locator('#review-card')
  const switcher = surface.frameLocator('[data-html-design-preview]').locator('#account-switch')
  const emailOption = switcher.locator('.seg-item').first()
  const phoneOption = switcher.locator('.seg-item').last()
  const emailText = emailOption.locator('span')
  const phoneText = phoneOption.locator('span')
  const phoneRadio = phoneOption.locator('input')
  const signupFoot = surface.frameLocator('[data-html-design-preview]').locator('#signup-foot')
  const signupLink = signupFoot.locator('a')
  const clickOption = async (option: Locator, double = false): Promise<void> => {
    const bounds = await option.boundingBox()
    if (bounds === null) throw new Error('account switch option has no bounds')
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    if (double) await page.mouse.dblclick(x, y)
    else await page.mouse.click(x, y)
  }
  await heading.waitFor()
  const modes = surface.getByRole('group', { name: 'Preview tools' })
  expect(await modes.getByRole('button').count()).toBe(2)
  expect(await modes.getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('true')
  expect(await modes.getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('false')
  expect(await surface.getByText('Saved', { exact: true }).count()).toBe(1)
  await expect.poll(() => saveFile.isDisabled()).toBe(true)
  await action.click()
  await expect.poll(() => count.innerText()).toBe('1')
  await clickOption(phoneOption)
  await expect.poll(() => switcher.getAttribute('data-mode')).toBe('phone')
  expect(await switcher.getAttribute('data-changes')).toBe('1')
  expect(await phoneRadio.isChecked()).toBe(true)
  await clickOption(emailOption)
  await expect.poll(() => switcher.getAttribute('data-mode')).toBe('email')
  expect(await switcher.getAttribute('data-changes')).toBe('2')
  expect(await phoneRadio.isChecked()).toBe(false)
  const originalFrame = await frame.elementHandle()
  if (originalFrame === null) throw new Error('design preview iframe is unavailable')
  const dragSelected = async (dx: number, dy: number): Promise<void> => {
    const handle = surface.frameLocator('[data-html-design-preview]').locator('[data-dsh-design-drag-handle]')
    await handle.waitFor({ state: 'visible' })
    const bounds = await handle.boundingBox()
    if (bounds === null) throw new Error('selected element has no drag handle bounds')
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 5 })
    await page.mouse.up()
  }
  expect(await page.getByRole('dialog', { name: 'Edit element' }).count()).toBe(0)

  await surface.getByRole('button', { name: 'Edit', exact: true }).click()
  expect(await modes.getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('false')
  expect(await modes.getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('true')
  const editor = page.getByRole('dialog', { name: 'Edit element' })
  await clickOption(phoneOption)
  expect(await switcher.getAttribute('data-mode')).toBe('email')
  expect(await switcher.getAttribute('data-changes')).toBe('2')
  await expect.poll(() => frame.getAttribute('data-frame-mode-ready')).toBe('true')
  const selectedBox = surface.frameLocator('[data-html-design-preview]').locator('[data-dsh-design-box]')
  await clickOption(phoneOption)
  expect(await editor.count()).toBe(0)
  expect(await switcher.getAttribute('data-mode')).toBe('email')
  expect(await switcher.getAttribute('data-changes')).toBe('2')
  expect(await phoneRadio.isChecked()).toBe(false)
  expect(await emailOption.locator('input').isChecked()).toBe(true)
  await selectedBox.waitFor({ state: 'visible' })
  const selectionBounds = await selectedBox.boundingBox()
  const textBounds = await phoneText.boundingBox()
  const optionBounds = await phoneOption.boundingBox()
  if (selectionBounds === null || textBounds === null || optionBounds === null) throw new Error('account switch selection has no bounds')
  expect(Math.abs(selectionBounds.x - textBounds.x)).toBeLessThan(3)
  expect(Math.abs(selectionBounds.width - textBounds.width)).toBeLessThan(5)
  expect(selectionBounds.width).toBeLessThan(optionBounds.width - 20)
  await page.mouse.click(optionBounds.x + 6, optionBounds.y + optionBounds.height / 2)
  const labelSelectionBounds = await selectedBox.boundingBox()
  if (labelSelectionBounds === null) throw new Error('account switch label selection has no bounds')
  expect(Math.abs(labelSelectionBounds.x - optionBounds.x)).toBeLessThan(3)
  expect(Math.abs(labelSelectionBounds.width - optionBounds.width)).toBeLessThan(5)
  expect(await editor.count()).toBe(0)
  expect(await switcher.getAttribute('data-mode')).toBe('email')
  expect(await switcher.getAttribute('data-changes')).toBe('2')
  await clickOption(phoneOption, true)
  await editor.waitFor()
  expect(await switcher.getAttribute('data-mode')).toBe('email')
  expect(await switcher.getAttribute('data-changes')).toBe('2')
  expect(await phoneRadio.isChecked()).toBe(false)
  expect(await emailOption.locator('input').isChecked()).toBe(true)
  expect(await editor.getByText('SPAN', { exact: true }).isVisible()).toBe(true)
  expect(await editor.getByText('Selector', { exact: true }).isVisible()).toBe(true)
  const phoneInput = editor.getByRole('textbox', { name: 'Text content' })
  expect(await phoneInput.inputValue()).toBe('手机号')
  await phoneInput.fill('draft phone text')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
  await editor.getByRole('button', { name: 'Copy' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('div#account-switch > label:nth-of-type(2) > span')
  expect(await phoneInput.inputValue()).toBe('draft phone text')
  await editor.getByRole('button', { name: 'Parent' }).click()
  await expect.poll(() => editor.getByText('LABEL', { exact: true }).count()).toBe(1)
  expect(await editor.getByRole('textbox', { name: 'Text content' }).count()).toBe(0)
  await editor.getByRole('button', { name: 'Parent' }).click()
  await expect.poll(() => editor.getByText('div#account-switch', { exact: true }).count()).toBe(1)
  expect(await editor.getByText('DIV', { exact: true }).isVisible()).toBe(true)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  expect(await phoneText.innerText()).toBe('手机号')

  await action.click()
  expect(await editor.count()).toBe(0)
  await action.dblclick()
  await editor.waitFor()
  expect(await count.innerText()).toBe('1')
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)

  await card.click({ position: { x: 5, y: 5 } })
  expect(await editor.count()).toBe(0)
  await card.dblclick({ position: { x: 5, y: 5 } })
  await editor.waitFor()
  expect(await editor.getByRole('textbox', { name: 'Text content' }).count()).toBe(0)
  expect(await editor.getByText('Double-click the exact text element instead.', { exact: false }).isVisible()).toBe(true)
  expect(await editor.getByRole('button', { name: 'Copy' }).count()).toBe(1)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)

  await count.click()
  expect(await editor.count()).toBe(0)
  await count.dblclick()
  await editor.waitFor()
  const countInput = editor.getByRole('textbox', { name: 'Text content' })
  expect(await countInput.inputValue()).toBe('1')
  await countInput.fill('7')
  expect(await count.innerText()).toBe('1')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  await expect.poll(() => surface.getByText('Unsaved', { exact: true }).count()).toBe(1)
  expect(await saveFile.isDisabled()).toBe(true)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  expect(await count.innerText()).toBe('1')
  await expect.poll(() => surface.getByText('Saved', { exact: true }).count()).toBe(1)

  await signupFoot.dblclick({ position: { x: 5, y: 5 } })
  await editor.waitFor()
  expect(await editor.getByText('P', { exact: true }).isVisible()).toBe(true)
  const signupInput = editor.getByRole('textbox', { name: 'Text content' })
  expect(await signupInput.inputValue()).toBe('还没有账号？')
  await signupInput.fill('已经有账号？')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(() => signupFoot.innerText()).toBe('已经有账号？免费注册')
  expect(await signupLink.innerText()).toBe('免费注册')
  expect(await signupLink.getAttribute('href')).toBe('/signup')
  expect(await readFile(file, 'utf8')).toBe(HTML)

  await clickOption(phoneOption, true)
  await editor.waitFor()
  await editor.getByRole('textbox', { name: 'Text content' }).fill('手机登录')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(() => phoneText.innerText()).toBe('手机登录')
  expect(await emailText.innerText()).toBe('邮箱')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  await expect.poll(() => surface.getByText('Unsaved', { exact: true }).count()).toBe(1)

  await count.dblclick()
  await editor.waitFor()
  await editor.getByRole('textbox', { name: 'Text content' }).fill('7')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(() => count.innerText()).toBe('7')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  await expect.poll(() => surface.getByText('Unsaved', { exact: true }).count()).toBe(1)

  await count.dblclick()
  await editor.waitFor()
  const inlineBefore = await count.boundingBox()
  if (inlineBefore === null) throw new Error('inline text element has no bounds')
  const inlineStyleBefore = await count.evaluate((node) => {
    const style = (node as HTMLElement).style
    return { position: style.position, left: style.left, top: style.top }
  })
  await dragSelected(18, 12)
  await expect.poll(async () => (await count.boundingBox())?.x).toBeGreaterThan(inlineBefore.x + 10)
  await expect.poll(async () => (await count.boundingBox())?.y).toBeGreaterThan(inlineBefore.y + 7)
  expect(await readFile(file, 'utf8')).toBe(HTML)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(async () => Math.abs(((await count.boundingBox())?.x ?? 0) - inlineBefore.x) < 1).toBe(true)
  await expect.poll(async () => Math.abs(((await count.boundingBox())?.y ?? 0) - inlineBefore.y) < 1).toBe(true)
  expect(await count.evaluate((node) => {
    const style = (node as HTMLElement).style
    return { position: style.position, left: style.left, top: style.top }
  })).toEqual(inlineStyleBefore)
  expect(await readFile(file, 'utf8')).toBe(HTML)

  await count.dblclick()
  await editor.waitFor()
  await dragSelected(14, 8)
  await expect.poll(async () => (await count.boundingBox())?.x).toBeGreaterThan(inlineBefore.x + 8)
  const inlineStyle = await count.evaluate((node) => {
    const style = (node as HTMLElement).style
    return { position: style.position, left: style.left, top: style.top }
  })
  expect(inlineStyle.position).toBe('relative')
  expect(inlineStyle.left).not.toBe('')
  expect(inlineStyle.top).not.toBe('')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  const sidecar = `${file}.design.json`
  await expect.poll(async () => await readFile(sidecar, 'utf8')).toContain('"position": "relative"')
  expect(await readFile(file, 'utf8')).toBe(HTML)

  await heading.dblclick()
  await editor.waitFor()
  expect(await frame.isVisible()).toBe(true)
  expect(await heading.isVisible()).toBe(true)
  expect(['left', 'right']).toContain(await editor.getAttribute('data-placement'))
  const frameBounds = await frame.boundingBox()
  const dialogBounds = await editor.boundingBox()
  if (frameBounds === null || dialogBounds === null) throw new Error('design preview and dialog must have bounds')
  expect(dialogBounds.x + dialogBounds.width <= frameBounds.x || dialogBounds.x >= frameBounds.x + frameBounds.width).toBe(true)
  await mkdir(dirname(SHOT), { recursive: true })
  await page.screenshot({ path: SHOT, fullPage: true })
  const editorSnapshot = (await editor.ariaSnapshot())
    .replace(/^  - definition: .+$/mu, '  - definition: <measured>')
  await editor.getByRole('textbox', { name: 'Text content' }).fill('Cancelled heading')
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  expect(await heading.innerText()).toBe('Original heading')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  expect(await originalFrame.evaluate(node => node.isConnected)).toBe(true)
  expect(await frame.isVisible()).toBe(true)

  await heading.dblclick()
  await editor.waitFor()
  await editor.getByRole('textbox', { name: 'Text content' }).fill('Saved heading')
  await editor.getByRole('textbox', { name: 'Font size' }).fill('48px')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  const savedHeading = surface.frameLocator('[data-html-design-preview]').getByRole('heading', { name: 'Saved heading' })
  await savedHeading.waitFor()
  await expect.poll(() => savedHeading.evaluate(node => getComputedStyle(node).fontSize)).toBe('48px')
  expect(await originalFrame.evaluate(node => node.isConnected)).toBe(true)
  expect(await frame.isVisible()).toBe(true)
  expect(await readFile(file, 'utf8')).toBe(HTML)

  await expect.poll(async () => await readFile(sidecar, 'utf8')).toContain('"font-size": "48px"')
  await savedHeading.dblclick()
  await editor.waitFor()
  await dragSelected(18, 16)
  await expect.poll(() => savedHeading.evaluate(node => (node as HTMLElement).style.getPropertyValue('translate'))).not.toBe('')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  expect(await readFile(sidecar, 'utf8')).not.toContain('"translate"')
  expect(await surface.getByText('Unsaved', { exact: true }).count()).toBe(1)
  await expect.poll(() => saveFile.isDisabled()).toBe(true)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(() => savedHeading.evaluate(node => getComputedStyle(node).translate)).toBe('none')
  expect(await readFile(file, 'utf8')).toBe(HTML)
  expect(await readFile(sidecar, 'utf8')).not.toContain('"translate"')

  await savedHeading.dblclick()
  await editor.waitFor()
  await dragSelected(24, 12)
  const movedTranslate = await savedHeading.evaluate(node => (node as HTMLElement).style.getPropertyValue('translate'))
  expect(movedTranslate).toMatch(/24px 12px/u)
  expect(await readFile(file, 'utf8')).toBe(HTML)
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(async () => await readFile(sidecar, 'utf8')).toContain('"translate"')

  await expect.poll(() => surface.getByText('Saving…', { exact: true }).count()).toBe(0)
  await expect.poll(() => saveFile.isDisabled()).toBe(false)
  await saveFile.click()
  try {
    await expect.poll(async () => await readFile(file, 'utf8'), { timeout: 10_000 }).toContain(`translate: ${movedTranslate}`)
  } catch (cause) {
    throw new Error(`Save to file left the source unchanged; notices=${JSON.stringify(await surface.locator('[role="status"], [role="alert"]').allTextContents())}; sidecar=${await readFile(sidecar, 'utf8')}`, { cause })
  }
  const savedFile = await readFile(file, 'utf8')
  expect(savedFile).toContain('Saved heading')
  expect(savedFile).toContain('<span>邮箱</span>')
  expect(savedFile).toContain('<span>手机登录</span>')
  expect(savedFile).toContain('<p id="signup-foot">已经有账号？<a href="/signup">免费注册</a></p>')
  expect(savedFile).toContain(`<strong id="task-count" style="position: relative; left: ${inlineStyle.left}; top: ${inlineStyle.top}">7</strong>`)
  expect(savedFile).toContain(`style="font-size: 48px; translate: ${movedTranslate}"`)
  expect(savedFile).not.toMatch(/<(?:main|p|strong|button)\b[^>]*translate:/u)
  expect(savedFile).not.toMatch(/<(?:main|h1|p|button)\b[^>]*\b(?:left|top):/u)
  await expect.poll(() => surface.getByText('Saved', { exact: true }).count()).toBe(1)
  await modes.getByRole('button', { name: 'Preview' }).click()
  expect(await modes.getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('true')
  await action.click()
  await expect.poll(() => count.innerText()).toBe('8')
  expect(await editor.count()).toBe(0)
  expect(await readFile(file, 'utf8')).toBe(savedFile)

  await modes.getByRole('button', { name: 'Edit' }).click()
  const removable = surface.frameLocator('[data-html-design-preview]').locator('#removable-block')
  await removable.dblclick({ position: { x: 4, y: 4 } })
  await editor.waitFor()
  expect(await editor.getByText('SECTION', { exact: true }).isVisible()).toBe(true)
  expect(await editor.getByText('section#removable-block', { exact: true }).isVisible()).toBe(true)
  await editor.getByRole('button', { name: 'Delete element' }).click()
  await expect.poll(() => editor.count()).toBe(0)
  await expect.poll(() => removable.count()).toBe(0)
  expect(await savedHeading.isVisible()).toBe(true)
  await expect.poll(() => surface.getByText('Unsaved', { exact: true }).count()).toBe(1)
  expect(await readFile(file, 'utf8')).toBe(savedFile)
  await surface.getByRole('button', { name: 'Undo deletion' }).click()
  await removable.waitFor({ state: 'visible' })
  await surface.frameLocator('[data-html-design-preview]').locator('[data-dsh-design-box]').waitFor({ state: 'attached' })
  await expect.poll(() => surface.getByText('Saved', { exact: true }).count()).toBe(1)
  expect(await readFile(file, 'utf8')).toBe(savedFile)
  await removable.dblclick({ position: { x: 4, y: 4 } })
  await editor.waitFor()
  await editor.getByRole('button', { name: 'Delete element' }).click()
  await expect.poll(() => removable.count()).toBe(0)
  await surface.getByRole('button', { name: 'Reload' }).click()
  await expect.poll(() => removable.count()).toBe(0)
  await expect.poll(() => saveFile.isDisabled()).toBe(false)
  await saveFile.click()
  await expect.poll(async () => await readFile(file, 'utf8')).not.toContain('removable-block')
  const deletedFile = await readFile(file, 'utf8')
  expect(deletedFile).toContain('Saved heading')
  expect(deletedFile).toContain('id="increment"')
  await expect.poll(() => surface.getByText('Saved', { exact: true }).count()).toBe(1)
  await modes.getByRole('button', { name: 'Preview' }).click()
  const countBeforeDeletedPreviewClick = Number(await count.innerText())
  await action.click()
  await expect.poll(() => count.innerText()).toBe(String(countBeforeDeletedPreviewClick + 1))
  expect(await readFile(file, 'utf8')).toBe(deletedFile)
  expect(tripwire.pageErrors).toEqual([])

  await compareOrRefreshGolden(EXPECTED, [
    '# Web design review',
    '',
    '## Edit dialog',
    '',
    editorSnapshot.trim(),
    '',
    '## Interaction',
    '',
    '- Initial page: Original heading',
    '- Edit dialog at rest: closed',
    '- Modes: only Preview and Edit; the selected mode is pressed',
    '- Status: Saved at rest, Unsaved for a draft, Saved after its cancellation',
    '- Preview button: increments the count to 1',
    '- Preview account switch: clicking the transparent radio controls changes the mode and emits one change per selection',
    '- Rapid switch to Edit: an immediate click cannot activate the preview radio before the frame applies Edit mode',
    '- Edit account switch single click: selects the exact visible text span without switching mode or opening the dialog',
    '- Edit account switch padding click: selects the label instead of its visible text span',
    '- Edit account switch double click: opens the span editor; saving changes only the phone label preview to 手机登录',
    '- Edit popup Parent: moves from the phone span to its label and then the containing switch div',
    '- Edit button single click: selects the button without incrementing the count or opening the dialog; double click opens it',
    '- Parent card double click: aggregate text cannot be edited',
    '- Exact child text double click: Cancel retains 1; Save changes only the count preview to 7',
    '- Mixed footer text: double click edits only the direct text; the signup link and its URL remain intact in preview',
    '- Inline text drag: the strong element moves in the browser; Cancel restores its original bounds',
    '- Inline text drag save: the sidecar records position, left, and top; source remains unchanged',
    '- Dialog save: Unsaved until Save to file succeeds',
    '- Cancel: original page and source retained',
    '- Dialog save: preview shows Saved heading at 48px; source unchanged',
    '- Preview iframe: retained across cancel and save',
    '- Drag draft: target moves in preview; source and sidecar retain their prior values',
    '- Drag cancel: target returns to its original position',
    '- Drag save: sidecar records the target translate; source remains unchanged',
    '- Save to file: footer text and phone label text, strong position, left, and top plus heading translate written only to their targets; the signup link remains intact; status returns to Saved',
    '- Return to Preview: button increments the count to 8 and opens no editor',
    '- Delete section: its exact block disappears only from preview, the source stays unchanged, and status shows Unsaved',
    '- Undo deletion: the block returns and the status becomes Saved without changing the source',
    '- Reload: the pending section deletion remains visible',
    '- Save deletion: only the section is removed from source; heading and button remain; status returns to Saved',
    '- Return to Preview after deletion: button still increments the count',
  ].join('\n'), webSnapshotMode())
  await assertFixtureInventory(SNAPSHOT, ['ui.expected.md'])
}, 300_000)
