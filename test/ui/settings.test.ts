import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 36: every preference in one Settings window, and the on or off ones
 * switched straight from the palette, which shows their state and stays open.
 * Plan 46: its sections under tabs, and a search over all of them.
 */

const fx = fixtureSet('ui-settings')
const root = await mkdtemp(join(tmpdir(), 'editbay-settings-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
let cleanPath: string

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function blur(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

async function closeSettings(): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
}

async function openSettings(tab: string): Promise<void> {
  await page.click('[data-testid="open-settings"]')
  await page.click(`[data-testid="settings-tab"][data-tab="${tab}"]`)
  await page.waitForSelector(`[data-testid="settings-pane"][data-tab="${tab}"]`)
}

async function openPalette(): Promise<void> {
  await blur()
  await page.keyboard.press('Control+k')
  await page.waitForSelector('[data-testid="command-palette"]')
}

const stateOf = (id: string): Promise<string | null> =>
  page.getAttribute(`[data-testid="command"][data-command="${id}"] [data-testid="command-state"]`, 'data-on')

describe('the Settings window', () => {
  it('opens from the top bar, from Ctrl+comma and from the palette', async () => {
    await page.click('[data-testid="open-settings"]')
    await page.waitForSelector('[data-testid="settings"]')
    await closeSettings()

    await blur()
    await page.keyboard.press('Control+Comma')
    await page.waitForSelector('[data-testid="settings"]')
    await closeSettings()

    await openPalette()
    await page.fill('[data-testid="command-search"]', 'preferences')
    expect(await page.getAttribute('[data-testid="command"]', 'data-command')).toBe('showSettings')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForSelector('[data-testid="settings"]')
    await closeSettings()
  })

  it('shows one tab of sections at a time, chosen from the sidebar', async () => {
    await page.click('[data-testid="open-settings"]')
    const tabs = await page.locator('[data-testid="settings-tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')))
    expect(tabs).toEqual(['General', 'Timeline', 'Monitor', 'Sources', 'Voice over', 'Export', 'Styles', 'Keys'])
    const sectionsIn = async (tab: string): Promise<(string | null)[]> => {
      await page.click(`[data-testid="settings-tab"][data-tab="${tab}"]`)
      await page.waitForSelector(`[data-testid="settings-pane"][data-tab="${tab}"]`)
      return page.locator('[data-testid="settings-section"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')))
    }
    expect(await sectionsIn('General')).toEqual(['Saving', 'Theme'])
    expect(await sectionsIn('Timeline')).toEqual(['Timeline', 'Transitions', 'Remove silences'])
    expect(await sectionsIn('Monitor')).toEqual(['Monitor'])
    expect(await sectionsIn('Sources')).toEqual(['Source bin', 'Recordings', 'Assets', 'Media cache'])
    // How much room the media cache takes, once worked out (audit 2026-10-01).
    await expect.poll(() => page.textContent('[data-testid="setting-cache-size"]')).toMatch(/^\d+(\.\d)? (KB|MB|GB) on this computer$/)
    expect(await sectionsIn('Voice over')).toEqual(['Voice over'])
    expect(await sectionsIn('Export')).toEqual(['Export'])
    expect(await sectionsIn('Styles')).toEqual(['Saved styles'])
    expect(await sectionsIn('Keys')).toEqual(['Keys'])
    await closeSettings()
    // It opens again on the tab it was left on.
    await page.click('[data-testid="open-settings"]')
    expect(await page.getAttribute('[data-testid="settings-pane"]', 'data-tab')).toBe('Keys')
    await closeSettings()
  })

  it('finds a setting in any tab from the search, and opens its tab on it', async () => {
    await openSettings('General')
    await page.fill('[data-testid="settings-search"]', 'hotkeys')
    await page.waitForSelector('[data-testid="settings-results"]')
    // The results cover the sidebar as well as the pane.
    const results = (await page.locator('[data-testid="settings-results"]').boundingBox())!
    const nav = (await page.locator('[data-testid="settings-tab"]').first().boundingBox())!
    expect(results.x).toBeLessThanOrEqual(nav.x)
    expect(await page.getAttribute('[data-testid="settings-result"]', 'data-setting')).toBe('setting-shortcuts')

    // Every word has to match, and a search that finds nothing says so.
    await page.fill('[data-testid="settings-search"]', 'transition sound')
    expect(await page.locator('[data-testid="settings-result"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))).toEqual([
      'setting-transition-sound'
    ])
    await page.fill('[data-testid="settings-search"]', 'zzzz')
    await page.waitForSelector('[data-testid="settings-none"]')

    // The arrows choose, and Enter opens it on its own tab, lit.
    await page.fill('[data-testid="settings-search"]', 'recordings folder')
    await page.press('[data-testid="settings-search"]', 'ArrowDown')
    expect(await page.getAttribute('[data-testid="settings-result"][aria-selected="true"]', 'data-setting')).toBe('setting-recordings-choose')
    await page.press('[data-testid="settings-search"]', 'Enter')
    await page.waitForSelector('[data-testid="settings-results"]', { state: 'detached' })
    expect(await page.getAttribute('[data-testid="settings-pane"]', 'data-tab')).toBe('Sources')
    expect(await page.inputValue('[data-testid="settings-search"]')).toBe('')
    await page.waitForSelector('[data-setting="setting-recordings-choose"].ui-setting--found')

    // A click opens one too.
    await page.fill('[data-testid="settings-search"]', 'safe zones')
    await page.click('[data-testid="settings-result"]')
    expect(await page.getAttribute('[data-testid="settings-pane"]', 'data-tab')).toBe('Monitor')
    expect(await page.locator('[data-testid="setting-safe-zone"]').isVisible()).toBe(true)

    // Escape empties the search first, and closes the window only after.
    await page.fill('[data-testid="settings-search"]', 'export')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings-results"]', { state: 'detached' })
    expect(await page.locator('[data-testid="settings"]').count()).toBe(1)
    await closeSettings()
  })

  it('leads every entry in the search to a control that is there', async () => {
    await page.click('[data-testid="open-settings"]')
    await page.fill('[data-testid="settings-search"]', 'e')
    const everything = await page
      .locator('[data-testid="settings-result"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-setting') ?? ''))
    expect(everything.length).toBeGreaterThan(20)
    for (const id of everything) {
      await page.fill('[data-testid="settings-search"]', 'e')
      await page.click(`[data-testid="settings-result"][data-setting="${id}"]`)
      await page.waitForSelector(`[data-testid="settings-pane"] [data-setting="${id}"] [data-testid="${id}"]`, { state: 'attached' })
    }
    await closeSettings()
  })

  it("changes the app's settings where they are kept, the same ones the other places change", async () => {
    await openSettings('General')
    // On from the start, so this turns it off.
    expect(await page.locator('[data-testid="setting-save-automatically"]').isChecked()).toBe(true)
    await page.locator('[data-testid="setting-save-automatically"]').uncheck()
    await page.click('[data-testid="settings-tab"][data-tab="Voice over"]')
    await page.locator('[data-testid="setting-mute-while-recording"]').check()
    await page.click('[data-testid="settings-tab"][data-tab="Timeline"]')
    await page.selectOption('[data-testid="setting-transition-picture"]', 'toBlack')
    await page.fill('[data-testid="setting-transition-length"]', '0.5')
    await page.press('[data-testid="setting-transition-length"]', 'Enter')
    await expect
      .poll(async () => JSON.parse((await readFile(join(userData, 'settings.json'))).toString()) as Record<string, unknown>, { timeout: 5000 })
      .toMatchObject({ saveAutomatically: false, muteWhileRecording: true, transitionPictureKind: 'toBlack', transitionSeconds: 0.5 })
    await closeSettings()

    // The save menu shows the same setting, since it is one setting.
    await page.click('[data-testid="save-menu"]')
    expect(await page.locator('[data-testid="save-automatically"]').isChecked()).toBe(false)
    await page.keyboard.press('Escape')

    // And the window shows what is kept when it opens again.
    await openSettings('Timeline')
    expect(await page.inputValue('[data-testid="setting-transition-length"]')).toBe('0.5')
    await page.click('[data-testid="settings-tab"][data-tab="General"]')
    expect(await page.locator('[data-testid="setting-save-automatically"]').isChecked()).toBe(false)
    await page.locator('[data-testid="setting-save-automatically"]').check()
    await closeSettings()
  })

  it('keeps the monitor and Remove silences settings in the window, where their own controls read them', async () => {
    await openSettings('Monitor')
    await page.selectOption('[data-testid="setting-safe-zone"]', 'shorts')
    await page.locator('[data-testid="setting-side-by-side"]').uncheck()
    await page.click('[data-testid="settings-tab"][data-tab="Timeline"]')
    await page.fill('[data-testid="setting-silence-level"]', '-45')
    await page.press('[data-testid="setting-silence-level"]', 'Enter')
    await page.fill('[data-testid="setting-silence-leave"]', '0.4')
    await page.press('[data-testid="setting-silence-leave"]', 'Enter')
    await closeSettings()
    const stored = (): Promise<Record<string, unknown>> =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem('editbay.window') ?? '{}') as Record<string, unknown>)
    await expect.poll(stored, { timeout: 5000 }).toMatchObject({
      safeZone: 'shorts',
      sideBySide: false,
      silence: { levelDb: -45, leaveSec: 0.4 }
    })

    // Put back, and a number out of range is held to what the panel allows.
    await openSettings('Monitor')
    await page.locator('[data-testid="setting-side-by-side"]').check()
    await page.selectOption('[data-testid="setting-safe-zone"]', 'all')
    await page.click('[data-testid="settings-tab"][data-tab="Timeline"]')
    await page.fill('[data-testid="setting-silence-level"]', '-500')
    await page.press('[data-testid="setting-silence-level"]', 'Enter')
    await expect.poll(async () => page.inputValue('[data-testid="setting-silence-level"]'), { timeout: 5000 }).toBe('-80')
    await closeSettings()
  })

  it('turns the guides and their lines on and off, as G and the Guides menu do', async () => {
    const stored = (): Promise<Record<string, unknown>> =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem('editbay.window') ?? '{}') as Record<string, unknown>)
    await openSettings('Monitor')
    await page.locator('[data-testid="setting-guides"]').check()
    await page.locator('[data-testid="setting-thirds"]').uncheck()
    await expect.poll(stored, { timeout: 5000 }).toMatchObject({ guides: true, thirds: false })
    await page.locator('[data-testid="setting-guides"]').uncheck()
    await page.locator('[data-testid="setting-thirds"]').check()
    await expect.poll(stored, { timeout: 5000 }).toMatchObject({ guides: false, thirds: true })
    await closeSettings()
  })

  it("keeps how exports go with the app's settings", async () => {
    await openSettings('Export')
    await page.selectOption('[data-testid="setting-export-mode"]', 'batch')
    await page.selectOption('[data-testid="setting-export-existing"]', 'keepBoth')
    await page.fill('[data-testid="setting-export-pattern"]', '{clip}_{index}')
    await page.press('[data-testid="setting-export-pattern"]', 'Enter')
    await page.locator('[data-testid="setting-show-after-export"]').check()
    await expect
      .poll(async () => JSON.parse((await readFile(join(userData, 'settings.json'))).toString()) as Record<string, unknown>, { timeout: 5000 })
      .toMatchObject({ exportMode: 'batch', exportExisting: 'keepBoth', exportPattern: '{clip}_{index}', showAfterExport: true })
    // Put back, so nothing else in this file is changed by it.
    await page.selectOption('[data-testid="setting-export-mode"]', 'join')
    await page.selectOption('[data-testid="setting-export-existing"]', 'ask')
    await page.fill('[data-testid="setting-export-pattern"]', '')
    await page.press('[data-testid="setting-export-pattern"]', 'Enter')
    await page.locator('[data-testid="setting-show-after-export"]').uncheck()
    await expect
      .poll(async () => JSON.parse((await readFile(join(userData, 'settings.json'))).toString()) as Record<string, unknown>, { timeout: 5000 })
      .toMatchObject({ exportMode: 'join', exportExisting: 'ask', exportPattern: '{project}_{index}_{clip}', showAfterExport: false })
    await closeSettings()
  })

  it('opens the shortcuts from its Keys section', async () => {
    await openSettings('Keys')
    await page.click('[data-testid="setting-shortcuts"]')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
    await page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
  })

  it('hides the ALL strip, and keeps it hidden after a reload', async () => {
    await openSettings('Timeline')
    await page.locator('[data-testid="setting-overview"]').uncheck()
    await closeSettings()
    await page.reload()
    await page.waitForSelector('main')
    await discardUnsavedWork(app)
    await openSettings('Timeline')
    expect(await page.locator('[data-testid="setting-overview"]').isChecked()).toBe(false)
    await page.locator('[data-testid="setting-overview"]').check()
    await closeSettings()
  })
})

describe('notes behind a "?" (task 64)', () => {
  it('says the autosave and media cache notes on hover, not on the page', async () => {
    await openSettings('General')
    expect(await page.textContent('[data-testid="settings-pane"]')).not.toContain('saved once')
    expect(await page.getAttribute('[data-testid="settings-section"][data-section="Saving"] [data-testid="settings-help"]', 'title')).toContain('saved once')
    await page.click('[data-testid="settings-tab"][data-tab="Sources"]')
    expect(await page.textContent('[data-testid="settings-pane"]')).not.toContain('two months')
    expect(await page.getAttribute('[data-testid="settings-section"][data-section="Media cache"] [data-testid="settings-help"]', 'data-tutorial')).toBe('070-disk-space')
    await closeSettings()
  })
})

describe('the theme (task 66)', () => {
  const accentNow = (): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-base').trim())
  it('is chosen in Settings, loads the window again in it, and goes back to the classic look', async () => {
    expect(await accentNow()).toBe('#4C8DF5')
    await openSettings('General')
    await page.locator('[data-testid="setting-theme"]').selectOption('teal')
    await expect.poll(accentNow, { timeout: 15_000 }).toBe('#14BFA6')
    await page.waitForSelector('main')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas').trim())).toBe('#04060A')
    await openSettings('General')
    await page.locator('[data-testid="setting-theme"]').selectOption('electric')
    await expect.poll(accentNow, { timeout: 15_000 }).toBe('#3370FF')
    await page.waitForSelector('main')
    await openSettings('General')
    await page.locator('[data-testid="setting-theme"]').selectOption('current')
    await expect.poll(accentNow, { timeout: 15_000 }).toBe('#4C8DF5')
    await page.waitForSelector('main')
  })
})

describe('saved styles (task 54)', () => {
  it('renames and forgets saved caption, text and shape styles', async () => {
    await page.evaluate(() =>
      window.api.setAppSettings({
        savedTextStyles: [{ id: 'text-1', name: 'Title card', style: {} as never }],
        savedShapes: [{ id: 'shape-1', name: 'Red arrow', style: { kind: 'line', stroke: '#ff0000', strokeWidth: 8, endHead: true } as never }]
      })
    )
    // The window reads the shapes as it opens: a reload brings in the ones just set.
    await page.reload()
    await page.waitForSelector('main')
    await openSettings('Styles')
    const row = (kind: string, name: string): string => `[data-testid="saved-style"][data-kind="${kind}"][data-name="${name}"]`
    await page.waitForSelector(row('text', 'Title card'))
    await page.waitForSelector(row('shape', 'Red arrow'))
    expect(await page.textContent('[data-testid="saved-style-list"][data-kind="caption"]')).toContain('None saved yet.')

    await page.fill(`${row('text', 'Title card')} [data-testid="saved-style-name"]`, 'Lower third')
    await page.press(`${row('text', 'Title card')} [data-testid="saved-style-name"]`, 'Enter')
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).savedTextStyles.map((s) => s.name)).toEqual(['Lower third'])

    await page.click(`${row('shape', 'Red arrow')} [data-testid="saved-style-remove"]`)
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).savedShapes.length).toBe(0)
    await page.click(`${row('text', 'Lower third')} [data-testid="saved-style-remove"]`)
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).savedTextStyles.length).toBe(0)
    await closeSettings()
  })
})

describe('switches in the palette', () => {
  it('shows each one on or off, flips it on Enter, and stays open for the next', async () => {
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'all strip')
    expect(await page.getAttribute('[data-testid="command"]', 'data-command')).toBe('overview')
    expect(await stateOf('overview')).toBe('yes')

    await page.press('[data-testid="command-search"]', 'Enter')
    await expect.poll(() => stateOf('overview'), { timeout: 5000 }).toBe('no')
    // Still open, and still showing the same row.
    expect(await page.locator('[data-testid="command-palette"]').count()).toBe(1)

    // A second one straight after, without opening it again.
    await page.fill('[data-testid="command-search"]', 'save automatically')
    expect(await stateOf('saveAutomatically')).toBe('yes')
    await page.press('[data-testid="command-search"]', 'Enter')
    await expect.poll(() => stateOf('saveAutomatically'), { timeout: 5000 }).toBe('no')

    // Both back, and an action still closes it.
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.fill('[data-testid="command-search"]', 'all strip')
    await page.press('[data-testid="command-search"]', 'Enter')
    await expect.poll(() => stateOf('overview'), { timeout: 5000 }).toBe('yes')
    await page.fill('[data-testid="command-search"]', 'keyboard shortcuts')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
    await page.keyboard.press('Escape')
  })
})

describe('skimming the timeline', () => {
  it('shows the frame under the pointer, and does not once it is turned off', async () => {
    await blur()
    await page.keyboard.press('Control+n')
    await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForSelector('[data-testid="clip"][data-kind="video"]')
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    const skim = (): Promise<string | null> => page.getAttribute('[data-testid="monitor-stage"]', 'data-skim')

    await page.mouse.move(clip.x + clip.width * 0.6, clip.y + clip.height / 2)
    await expect.poll(skim, { timeout: 5000 }).not.toBe('')
    await page.mouse.move(clip.x + clip.width * 0.6, clip.y - 200)
    await expect.poll(skim, { timeout: 5000 }).toBe('')

    await openPalette()
    await page.fill('[data-testid="command-search"]', 'frame under the pointer')
    await page.press('[data-testid="command-search"]', 'Enter')
    await expect.poll(() => stateOf('skim'), { timeout: 5000 }).toBe('no')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })

    await page.mouse.move(clip.x + clip.width * 0.4, clip.y + clip.height / 2)
    await page.mouse.move(clip.x + clip.width * 0.6, clip.y + clip.height / 2)
    await page.waitForTimeout(300)
    expect(await skim()).toBe('')
  })
})
