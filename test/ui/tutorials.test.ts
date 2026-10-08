import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 28: the tutorials window. Tabs, and one search across every one of
 * them.
 *
 * The case worth having is the last one: someone with a tab open searches for
 * something that lives in another category, and has to get it. That is the
 * moment the tabs and the search could quietly disagree.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-tutorials-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function open(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('F1')
  await page.waitForSelector('[data-testid="tutorials"]')
}

async function close(): Promise<void> {
  if ((await page.locator('[data-testid="tutorials"]').count()) === 0) return
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })
}

async function type(text: string): Promise<void> {
  await page.locator('[data-testid="tutorial-search"]').fill(text)
}

describe('opening the tutorials', () => {
  it('opens on F1 with the search box already focused, so it can be used by typing', async () => {
    await open()
    expect(await page.locator('[data-testid="tutorial-search"]').count()).toBe(1)
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null
    )
    expect(focused).toBe('tutorial-search')
    await close()
  })

  it('opens from the button in the top bar as well', async () => {
    await page.locator('[data-testid="open-tutorials"]').click()
    await page.waitForSelector('[data-testid="tutorials"]')
    await close()
  })

  it('closes on its own X, which is the one control the window offers for it', async () => {
    await open()
    await page.locator('[data-testid="tutorials-close"]').click()
    await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })
  })

  it('shows entries, and one of them open, before anything is typed', async () => {
    await open()
    expect(await page.locator('[data-testid="tutorial-row"]').count()).toBeGreaterThan(0)
    expect(await page.locator('[data-testid="tutorial-body"]').getAttribute('data-tutorial')).toBeTruthy()
    await close()
  })
})

describe('the tabs', () => {
  it('draws one per category', async () => {
    await open()
    expect(await page.locator('[data-testid="tutorial-tab"]').count()).toBe(8)
    await close()
  })

  it('changes which entries are listed', async () => {
    await open()
    const first = await page.locator('[data-testid="tutorial-row"]').first().getAttribute('data-tutorial')
    await page.locator('[data-testid="tutorial-tab"][data-tab="Export"]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-row"]')?.getAttribute('data-category') === 'Export'
    )
    const now = await page.locator('[data-testid="tutorial-row"]').first().getAttribute('data-tutorial')
    expect(now).not.toBe(first)
    await close()
  })
})

describe('searching', () => {
  it('finds an entry in a category that is not the open tab, which is the whole point', async () => {
    await open()
    // Sit on Framing, then search for something that lives in Cutting.
    await page.locator('[data-testid="tutorial-tab"][data-tab="Framing"]').click()
    await type('silences')
    await page.waitForSelector('[data-testid="tutorial-row"][data-category="Cutting"]')
    const cats = await page.locator('[data-testid="tutorial-row"]').evaluateAll((rows) =>
      rows.map((r) => r.getAttribute('data-category'))
    )
    expect(cats).toContain('Cutting')
    await close()
  })

  it('moves to the All tab, so the cross-category result is the one you see', async () => {
    await open()
    await page.locator('[data-testid="tutorial-tab"][data-tab="Sound"]').click()
    await type('captions')
    await page.waitForSelector('[data-testid="tutorial-tab"][data-tab="All"][aria-pressed="true"]')
    await close()
  })

  it('puts a count on each tab while a search is running', async () => {
    await open()
    await type('captions')
    await page.waitForSelector('[data-testid="tutorial-tab"][data-tab="All"]')
    const all = await page.locator('[data-testid="tutorial-tab"][data-tab="All"]').getAttribute('data-count')
    expect(Number(all)).toBeGreaterThan(0)
    await close()
  })

  it('says so, and offers somewhere to start, when nothing matches', async () => {
    await open()
    await type('zzzzqqqq')
    await page.waitForSelector('[data-testid="tutorial-none"]')
    expect(await page.locator('[data-testid="tutorial-starting-point"]').count()).toBe(3)
    await close()
  })

  it('opens a starting point when one is pressed', async () => {
    await open()
    await type('zzzzqqqq')
    await page.waitForSelector('[data-testid="tutorial-none"]')
    await page.locator('[data-testid="tutorial-starting-point"]').first().click()
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="tutorial-search"]') as HTMLInputElement | null)?.value === ''
    )
    expect(await page.locator('[data-testid="tutorial-body"]').getAttribute('data-tutorial')).toBeTruthy()
    await close()
  })
})

describe('using it from the keyboard', () => {
  it('walks the list with the arrows and opens with the pointer left alone', async () => {
    await open()
    const first = await page.locator('[data-testid="tutorial-body"]').getAttribute('data-tutorial')
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      (was) => document.querySelector('[data-testid="tutorial-body"]')?.getAttribute('data-tutorial') !== was,
      first
    )
    const second = await page.locator('[data-testid="tutorial-body"]').getAttribute('data-tutorial')
    expect(second).not.toBe(first)

    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(
      (was) => document.querySelector('[data-testid="tutorial-body"]')?.getAttribute('data-tutorial') === was,
      first
    )
    await close()
  })

  it('clears a search on Escape, and closes only when there is nothing left to clear', async () => {
    await open()
    await type('captions')
    await page.waitForSelector('[data-testid="tutorial-tab"][data-tab="All"]')

    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="tutorial-search"]') as HTMLInputElement | null)?.value === ''
    )
    // Still open, which is the point: one Escape must not throw away both the
    // search and the window.
    expect(await page.locator('[data-testid="tutorials"]').count()).toBe(1)

    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })
  })
})

describe('an entry', () => {
  it('draws its body, including the keys inside it as keys', async () => {
    await open()
    await type('keys worth learning')
    await page.waitForSelector('[data-testid="tutorial-row"]')
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="tutorial-body"]')?.textContent ?? '').length > 100
    )
    await page.locator('[data-testid="tutorial-view"][data-view="details"]').click()
    await page.waitForSelector('[data-testid="tutorial-details"]')
    expect(await page.locator('[data-testid="tutorial-body"] .ui-kbd').count()).toBeGreaterThan(0)
    await close()
  })

  // Plan 101: an entry opens on its steps, the prose a tab away.
  async function openAssetsFolder(): Promise<void> {
    await open()
    await page.locator('[data-testid="tutorial-tab"][data-tab="Layers"]').click()
    await page.locator('[data-testid="tutorial-row"][data-tutorial="318-effects"]').click()
    await page.waitForSelector('[data-testid="tutorial-body"][data-tutorial="318-effects"]')
  }

  it('opens on its numbered steps, with the details one tab away', async () => {
    await openAssetsFolder()
    expect(await page.locator('[data-testid="tutorial-step"]').count()).toBe(3)
    expect(await page.locator('[data-testid="tutorial-details"]').count()).toBe(0)
    expect(await page.locator('[data-testid="tutorial-step"] [data-testid="tutorial-chip"]').count()).toBeGreaterThan(0)

    await page.locator('[data-testid="tutorial-view"][data-view="details"]').click()
    await page.waitForSelector('[data-testid="tutorial-details"]')
    expect(await page.locator('[data-testid="tutorial-step"]').count()).toBe(0)
    await close()
  })

  it('ticks a step off, and keeps the tick when the window is opened again', async () => {
    await openAssetsFolder()
    await page.locator('[data-testid="tutorial-step-tick"]').first().click()
    expect(await page.locator('[data-testid="tutorial-step"]').first().getAttribute('data-done')).toBe('true')
    await close()

    await openAssetsFolder()
    expect(await page.locator('[data-testid="tutorial-step"]').first().getAttribute('data-done')).toBe('true')
    await page.locator('[data-testid="tutorial-step-tick"]').first().click()
    expect(await page.locator('[data-testid="tutorial-step"]').first().getAttribute('data-done')).toBe('false')
    await close()
  })

  it('Show me steps the window aside, rings the control and says what to do, and a click brings it back', async () => {
    await openAssetsFolder()
    // Step 2 points at Settings in the top bar, with words for what to do inside it.
    await page.locator('[data-testid="tutorial-step"]').nth(1).locator('[data-testid="tutorial-show-me"]').click()
    await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })

    const ring = (await page.locator('[data-testid="show-me-ring"]').boundingBox())!
    const settings = (await page.locator('[data-testid="open-settings"]').boundingBox())!
    expect(ring.x).toBeLessThan(settings.x)
    expect(ring.x + ring.width).toBeGreaterThan(settings.x + settings.width)
    expect(await page.locator('[data-testid="show-me-callout"]').textContent()).toContain(
      'Open Settings, then Sources, then Assets'
    )
    // Calm and readable on the dark theme: both lines clear 4.5:1 on the callout (task 83).
    const contrasts = await page.locator('[data-testid="show-me-callout"]').evaluate((el) => {
      const rgb = (c: string): number[] => c.match(/\d+/g)!.slice(0, 3).map(Number)
      const lum = (c: number[]): number => {
        const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const ratio = (a: string, b: string): number => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p)
        return (x! + 0.05) / (y! + 0.05)
      }
      const bg = getComputedStyle(el).backgroundColor
      return [ratio(getComputedStyle(el).color, bg), ratio(getComputedStyle(el.lastElementChild!).color, bg)]
    })
    for (const c of contrasts) expect(c).toBeGreaterThanOrEqual(4.5)

    await page.locator('[data-testid="show-me"]').click({ position: { x: 5, y: 300 } })
    await page.waitForSelector('[data-testid="tutorials"]')
    expect(await page.locator('[data-testid="show-me"]').count()).toBe(0)
    // Back where it was, and nothing behind it was clicked: Settings did not open.
    expect(await page.locator('[data-testid="tutorial-body"]').getAttribute('data-tutorial')).toBe('318-effects')
    expect(await page.locator('[data-testid="settings"]').count()).toBe(0)
    await close()
  })

  it('Escape during Show me brings the tutorial back rather than closing it', async () => {
    await openAssetsFolder()
    await page.locator('[data-testid="tutorial-show-me"]').nth(1).click()
    await page.waitForSelector('[data-testid="show-me"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="tutorials"]')
    await close()
  })
})
