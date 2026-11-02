import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 92: Inspector sections beside the timeline. A section's heading drags
 * to a strip at either end of the timeline, or its menu puts it there. The
 * Inspector keeps every section behind a picker, and one put beside the
 * timeline is ticked off there until ticked back on. The menu opens on a
 * right-click on the heading, or by the keyboard; a heading has no button for it. Every divider drags, and
 * all of it is still there after a restart.
 */

const fx = fixtureSet('ui-sections')
const root = await mkdtemp(join(tmpdir(), 'editbay-sections-'))
let app: ElectronApplication
let page: Page
let userData: string

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

async function selectClip(): Promise<void> {
  const box = await page.locator('[data-testid="clip"]').first().boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
}

async function resize(width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0]
      w?.unmaximize()
      w?.setContentSize(size.width, size.height)
    },
    { width, height }
  )
  await page.waitForFunction((w) => Math.abs(window.innerWidth - w) <= 2, width, { timeout: 5000 })
}

const inInspector = (name: string): string => `[data-testid="inspector-column"] [data-inspector-group][data-group="${name}"]`
const inDock = (side: 'left' | 'right', name: string): string => `[data-testid="section-dock-${side}"] [data-testid="section-cell"][data-section="${name}"]`
const sectionsOf = async (side: 'left' | 'right'): Promise<string[]> => {
  if ((await page.locator(`[data-testid="section-dock-${side}"][data-folded="no"]`).count()) === 0) return []
  const v = await page.getAttribute(`[data-testid="section-dock-${side}"]`, 'data-sections')
  return v ? v.split('|') : []
}

/** A section's menu, opened by a right-click on its heading. */
async function menu(name: string, item: string, where = '[data-testid="inspector-column"]'): Promise<void> {
  await page.locator(`${where} [data-section-heading="${name}"]:visible`).first().click({ button: 'right' })
  await page.locator(`[data-testid="section-menu"] [data-testid="${item}"]`).click()
  await page.waitForSelector('[data-testid="section-menu"]', { state: 'detached' })
}

async function pick(name: string, testid = 'section-pick'): Promise<void> {
  await page.locator('[data-testid="section-picker"]').click()
  await page.locator(`[data-testid="section-picker-menu"] [data-testid="${testid}"][data-section="${name}"]`).click()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="section-picker-menu"]', { state: 'detached' })
}

async function dragBy(selector: string, dx: number, dy: number): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 })
  await page.mouse.up()
}

/** A section's heading picked up and let go over the target, which may only appear once the drag has begun. */
async function dragSection(heading: string, target: string): Promise<void> {
  const handle = page.locator(heading).first()
  await handle.scrollIntoViewIfNeeded()
  const from = (await handle.boundingBox())!
  await page.mouse.move(from.x + 12, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 20, { steps: 4 })
  const to = page.locator(target).first()
  await to.waitFor()
  const box = (await to.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
}

const widthOf = async (selector: string): Promise<number> => (await page.locator(selector).boundingBox())!.width

/**
 * Each test's own starting layout, so none leans on the one before it: every
 * section taken away from beside the timeline, all ticked on, both sides at
 * their usual width, then these put on each side in order.
 */
async function arrange(want: { left?: string[]; right?: string[] }): Promise<void> {
  if ((await page.locator('[data-testid="section-dock-tuck"][data-tucked="yes"]').count()) > 0) {
    await page.locator('[data-testid="section-dock-tuck"]').click()
  }
  for (const side of ['left', 'right'] as const) {
    if ((await page.locator(`[data-testid="section-dock-${side}"][data-folded="yes"]`).count()) > 0) {
      await page.locator(`[data-testid="section-dock-${side}-open"]`).click()
    }
    for (const name of await sectionsOf(side)) await menu(name, 'section-take-away', `[data-testid="section-dock-${side}"]`)
  }
  if ((await page.locator('[data-testid="clip"][data-selected="yes"]').count()) === 0) await selectClip()
  if ((await page.locator('[data-testid="inspector-show-all"]').count()) > 0) await page.locator('[data-testid="inspector-show-all"]').click()
  for (const side of ['left', 'right'] as const) {
    for (const name of want[side] ?? []) await menu(name, side === 'left' ? 'section-put-left' : 'section-put-right')
    if ((want[side] ?? []).length > 0) await page.locator(`[data-testid="section-dock-divider-${side}"]`).dblclick()
  }
}

beforeAll(async () => {
  const clip = await fx.cleanClip()
  userData = join(root, 'user-data')
  await launch()
  await resize(1600, 900)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
  await selectClip()
  await page.waitForSelector(inInspector('Sound'))
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('putting a section beside the timeline', () => {
  it('shows no docks and no strips until a section is moved', async () => {
    await arrange({})
    expect(await page.locator('[data-testid^="section-dock-"]').count()).toBe(0)
    expect(await page.locator('[data-testid^="section-strip-"]').count()).toBe(0)
    expect(await page.textContent('[data-testid="section-picker"]')).toContain('All sections')
  })

  it('drags a heading to the strip on the right, which ticks it off in the Inspector', async () => {
    await arrange({})
    await dragSection(`${inInspector('Sound')} [data-testid="inspector-group-heading"]`, '[data-testid="section-strip-right"]')
    await page.waitForSelector(inDock('right', 'Sound'))
    expect(await sectionsOf('right')).toEqual(['Sound'])
    expect(await page.locator(inInspector('Sound')).count()).toBe(0)
    expect(await page.locator('[data-testid^="section-strip-"]').count()).toBe(0)
    expect(await page.textContent('[data-testid="inspector-hidden-note"]')).toContain('Sound is hidden here')
  })

  it('edits the same clip from beside the timeline, and both copies agree once it is ticked back on', async () => {
    await arrange({ right: ['Sound'] })
    await page.locator(`${inDock('right', 'Sound')} [data-testid="linked-sound-level"]`).first().fill('40')
    await pick('Sound')
    await page.waitForSelector(inInspector('Sound'))
    expect(await page.locator(`${inInspector('Sound')} [data-testid="linked-sound-level"]`).first().getAttribute('data-value')).toBe('40')
    expect(await page.locator(`${inDock('right', 'Sound')} [data-testid="linked-sound-level"]`).first().getAttribute('data-value')).toBe('40')
  })

  it('opens the menu by a right-click on a heading, with no three dots button on any heading', async () => {
    await arrange({ right: ['Sound'] })
    expect(await page.locator('[data-testid="section-menu-open"]').count()).toBe(0)
    expect(await page.locator('[data-inspector-group] [data-testid="inspector-group-heading"] button').count()).toBe(await page.locator('[data-inspector-group]').count())
    await page.locator(`${inInspector('Look')} [data-section-heading="Look"]`).click({ button: 'right' })
    const items = await page.locator('[data-testid="section-menu"] button').evaluateAll((b) => b.map((x) => x.getAttribute('data-testid')))
    expect(items).toEqual(['section-put-left', 'section-put-right'])
    await page.keyboard.press('Escape')
    await page.locator(`${inDock('right', 'Sound')} [data-section-heading="Sound"]:visible`).click({ button: 'right' })
    expect(await page.locator('[data-testid="section-menu"] [data-testid="section-take-away"]').count()).toBe(1)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="section-menu"]', { state: 'detached' })
  })

  it('opens the menu from the keyboard on a focused heading, with Shift+F10 or the menu key', async () => {
    await arrange({})
    const toggle = page.locator(`${inInspector('Look')} [data-testid="inspector-group-toggle"]`)
    for (const key of ['Shift+F10', 'ContextMenu']) {
      await toggle.focus()
      await page.keyboard.press(key)
      await page.waitForSelector('[data-testid="section-menu"]')
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-testid="section-menu"]', { state: 'detached' })
    }
    await toggle.focus()
    await page.keyboard.press('Shift+F10')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForSelector(inDock('right', 'Look'))
  })

  it('puts sections on either side from their menu, in order, and moves them up and down', async () => {
    await arrange({ right: ['Sound'] })
    await menu('Look', 'section-put-right')
    await menu('Blur', 'section-put-right')
    expect(await sectionsOf('right')).toEqual(['Sound', 'Look', 'Blur'])
    await menu('Blur', 'section-up', '[data-testid="section-dock-right"]')
    expect(await sectionsOf('right')).toEqual(['Sound', 'Blur', 'Look'])
    await menu('Look', 'section-put-left', '[data-testid="section-dock-right"]')
    expect(await sectionsOf('left')).toEqual(['Look'])
    expect(await sectionsOf('right')).toEqual(['Sound', 'Blur'])
    // Changing sides leaves its tick as it was: still off in the Inspector.
    expect(await page.locator(inInspector('Look')).count()).toBe(0)
  })

  it('takes a section away from beside the timeline, ticking it back on, by its menu or by dropping it on the Inspector', async () => {
    await arrange({ left: ['Look'], right: ['Sound', 'Blur'] })
    await menu('Look', 'section-take-away', '[data-testid="section-dock-left"]')
    expect(await page.locator('[data-testid="section-dock-left"]').count()).toBe(0)
    await page.waitForSelector(inInspector('Look'))
    await dragSection(`${inDock('right', 'Blur')} [data-testid="inspector-group-heading"]`, '[data-testid="inspector-column"]')
    await page.waitForSelector(inInspector('Blur'))
    expect(await sectionsOf('right')).toEqual(['Sound'])
  })

  it('stands in for a section the selection has no use for, keeping its place', async () => {
    await arrange({ right: ['Sound'] })
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]', { state: 'detached' })
    expect(await page.isVisible(`${inDock('right', 'Sound')} [data-testid="section-cell-empty"]`)).toBe(true)
    await selectClip()
    await page.waitForSelector(`${inDock('right', 'Sound')} [data-inspector-group]`)
    expect(await page.isVisible(`${inDock('right', 'Sound')} [data-testid="section-cell-empty"]`)).toBe(false)
  })
})

describe('the Inspector with every section folded', () => {
  it('draws no line between its sections', async () => {
    await arrange({})
    const toggles = page.locator('[data-testid="inspector-column"] [data-inspector-group][data-folded="no"] [data-testid="inspector-group-toggle"]')
    while ((await toggles.count()) > 0) await toggles.first().click()
    // No child of a section is a thin strip with a colour of its own: the line that sat under each heading.
    const lines = await page.locator('[data-testid="inspector-column"] [data-inspector-group]').evaluateAll((groups) =>
      groups.flatMap((g) =>
        Array.from(g.querySelectorAll('*')).filter((el) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderBottomWidth) > 0 || parseFloat(cs.borderTopWidth) > 0
          return r.height > 0 && r.height <= 2 && r.width > 40 && painted
        })
      )
    )
    expect(lines.length).toBe(0)
    if (process.env.EDITBAY_SHOT) await page.locator('[data-testid="inspector-column"]').screenshot({ path: process.env.EDITBAY_SHOT })
    const folded = page.locator('[data-testid="inspector-column"] [data-inspector-group][data-folded="yes"] [data-testid="inspector-group-toggle"]')
    while ((await folded.count()) > 0) await folded.first().click()
  })
})

describe("the Inspector's picker", () => {
  it('ticks a section off and on', async () => {
    await arrange({})
    await pick('Look')
    expect(await page.locator(inInspector('Look')).count()).toBe(0)
    await pick('Look')
    await page.waitForSelector(inInspector('Look'))
  })

  it('shows only one section, and Show all brings the rest back', async () => {
    await arrange({})
    await pick('Crop', 'section-only')
    await page.waitForSelector(inInspector('Crop'))
    expect(await page.locator('[data-testid="inspector-column"] [data-inspector-group]').count()).toBe(1)
    await page.locator('[data-testid="inspector-show-all"]').click()
    await page.waitForSelector(inInspector('Sound'))
    expect(await page.locator('[data-testid="inspector-hidden-note"]').count()).toBe(0)
  })
})

describe('sizes beside the timeline', () => {
  it("drags a side's width, and a double click puts it back", async () => {
    await arrange({ right: ['Sound'] })
    const dock = '[data-testid="section-dock-right"]'
    const before = await widthOf(dock)
    await dragBy('[data-testid="section-dock-divider-right"]', -80, 0)
    await page.waitForFunction((w) => (document.querySelector('[data-testid="section-dock-right"]')?.getBoundingClientRect().width ?? 0) > w + 60, before)
    await page.locator('[data-testid="section-dock-divider-right"]').dblclick()
    await page.waitForFunction((w) => Math.abs((document.querySelector('[data-testid="section-dock-right"]')?.getBoundingClientRect().width ?? 0) - w) < 2, before)
  })

  it('shares a side between its sections by the divider between them', async () => {
    await arrange({ right: ['Sound', 'Look'] })
    const cells = page.locator('[data-testid="section-dock-right"] [data-testid="section-cell"]')
    const heights = async (): Promise<number[]> => [(await cells.nth(0).boundingBox())!.height, (await cells.nth(1).boundingBox())!.height]
    const [a0, b0] = await heights()
    await dragBy('[data-testid="section-share-divider"]', 0, 30)
    const [a1, b1] = await heights()
    expect(a1!).toBeGreaterThan(a0! + 20)
    expect(b1!).toBeLessThan(b0! - 20)
  })

  it('folds a section beside the timeline without folding it in the Inspector, and the other way round (task 61)', async () => {
    for (const name of ['Sound', 'Look']) {
      await arrange({ right: [name] })
      // Ticked back on, so the Inspector shows it too.
      await pick(name)
      const dock = `${inDock('right', name)} [data-inspector-group][data-group="${name}"]`
      const inspector = inInspector(name)
      await page.waitForSelector(`${inspector}[data-folded="no"]`)
      await page.locator(`${dock} [data-testid="inspector-group-toggle"]`).click()
      await page.waitForSelector(`${dock}[data-folded="yes"]`)
      expect(await page.getAttribute(inspector, 'data-folded')).toBe('no')
      await page.locator(`${dock} [data-testid="inspector-group-toggle"]`).click()
      await page.waitForSelector(`${dock}[data-folded="no"]`)

      await page.locator(`${inspector} [data-testid="inspector-group-toggle"]`).click()
      await page.waitForSelector(`${inspector}[data-folded="yes"]`)
      expect(await page.getAttribute(dock, 'data-folded')).toBe('no')
      await page.locator(`${inspector} [data-testid="inspector-group-toggle"]`).click()
      await page.waitForSelector(`${inspector}[data-folded="no"]`)
    }
  })

  it('leaves no divider beside a folded section, which keeps only its heading’s height', async () => {
    await arrange({ right: ['Sound', 'Look'] })
    await page.locator(`${inDock('right', 'Sound')} [data-testid="inspector-group-toggle"]`).click()
    expect(await page.locator('[data-testid="section-dock-right"] [data-testid="section-share-divider"]').count()).toBe(0)
    expect((await page.locator(inDock('right', 'Sound')).boundingBox())!.height).toBeLessThan(60)
    await page.locator(`${inDock('right', 'Sound')} [data-testid="inspector-group-toggle"]`).click()
    await page.waitForSelector('[data-testid="section-dock-right"] [data-testid="section-share-divider"]')
  })

  it('stops widening a side where the timeline would get less than its least, folding neither side', async () => {
    await arrange({ left: ['Blur'], right: ['Sound'] })
    await resize(1100, 700)
    await dragBy('[data-testid="section-dock-divider-right"]', -400, 0)
    expect(await page.getAttribute('[data-testid="section-dock-right"]', 'data-folded')).toBe('no')
    expect(await page.getAttribute('[data-testid="section-dock-left"]', 'data-folded')).toBe('no')
    expect(await widthOf('[data-testid="timeline-panel"]')).toBeGreaterThanOrEqual(470)
    await resize(1600, 900)
  })

  it('keeps the old dividers working: the Inspector still drags wider', async () => {
    await arrange({})
    const before = await widthOf('[data-testid="inspector-column"]')
    await dragBy('[data-testid="inspector-divider"]', -40, 0)
    await page.waitForFunction((w) => (document.querySelector('[data-testid="inspector-column"]')?.getBoundingClientRect().width ?? 0) > w + 30, before)
  })

  it('folds a side to a rail when the window is too narrow for it and the timeline, and opens it from the rail', async () => {
    await arrange({ left: ['Blur'], right: ['Sound'] })
    // At its normal width each side leaves the timeline room even at the smallest window; widened, the right one does not.
    await dragBy('[data-testid="section-dock-divider-right"]', -200, 0)
    await resize(1100, 700)
    await page.waitForSelector('[data-testid="section-dock-right"][data-folded="yes"]')
    expect(await page.getAttribute('[data-testid="section-dock-left"]', 'data-folded')).toBe('no')
    await page.locator('[data-testid="section-dock-right-open"]').click()
    await page.waitForSelector('[data-testid="section-dock-right"][data-folded="no"]')
    await resize(1600, 900)
    await page.waitForSelector('[data-testid="section-dock-right"][data-folded="no"]')
  })
})

describe('folding the right side down under the Inspector (task 1137)', () => {
  it('folds to a bar under the Inspector, which takes the column, and opens again', async () => {
    await arrange({ right: ['Sound'] })
    const column = '[data-testid="inspector-column"]'
    const before = (await page.locator(column).boundingBox())!
    const dock = (await page.locator('[data-testid="section-dock-right"]').boundingBox())!
    await page.locator('[data-testid="section-dock-tuck"]').click()
    await page.waitForSelector('[data-testid="section-dock-tuck"][data-tucked="yes"]')
    expect(await page.locator('[data-testid="section-dock-right"]').count()).toBe(0)
    const after = (await page.locator(column).boundingBox())!
    const bar = (await page.locator('[data-testid="section-dock-tuck"]').boundingBox())!
    // Taller by most of the dock's height, and the bar thin, under it, at the foot of the window's panels.
    expect(after.height).toBeGreaterThan(before.height + dock.height - 60)
    expect(bar.height).toBeLessThan(30)
    expect(bar.y).toBeGreaterThan(after.y + after.height)
    expect(Math.abs(bar.y + bar.height - (dock.y + dock.height))).toBeLessThan(4)
    expect(await page.textContent('[data-testid="section-dock-tuck"]')).toContain('Sound')
    // The timeline stops short of the Inspector instead of running under it.
    const timeline = (await page.locator('[data-testid="timeline-row"]').boundingBox())!
    expect(timeline.x + timeline.width).toBeLessThanOrEqual(after.x)
    await page.locator('[data-testid="section-dock-tuck"]').click()
    await page.waitForSelector(inDock('right', 'Sound'))
    expect(Math.abs((await page.locator(column).boundingBox())!.height - before.height)).toBeLessThan(2)
  })
})

describe('the picker (task 52)', () => {
  it('greys the sections the selected clip has none of, and still ticks them', async () => {
    await arrange({})
    await page.locator('[data-testid="section-picker"]').click()
    const row = (name: string): string => `[data-testid="section-picker-menu"] [data-testid="section-pick"][data-section="${name}"]`
    expect(await page.getAttribute(row('Sound'), 'data-applies')).toBe('yes')
    expect(await page.getAttribute(row('Text'), 'data-applies')).toBe('no')
    expect(await page.textContent(row('Text'))).toContain('not for this clip')
    expect(await page.textContent(row('Sound'))).not.toContain('not for this clip')
    await page.locator(row('Text')).click()
    await page.waitForSelector(`${row('Text')}[data-on="no"]`)
    await page.locator(row('Text')).click()
    await page.waitForSelector(`${row('Text')}[data-on="yes"]`)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="section-picker-menu"]', { state: 'detached' })
  })
})

describe('after a restart', () => {
  it('has every section where it was left', async () => {
    await arrange({ left: ['Blur'], right: ['Sound', 'Look'] })
    const before = { left: await sectionsOf('left'), right: await sectionsOf('right') }
    expect(before.left.length + before.right.length).toBeGreaterThan(0)
    await app.close()
    await launch()
    await page.waitForSelector('[data-testid="section-dock-right"]')
    expect({ left: await sectionsOf('left'), right: await sectionsOf('right') }).toEqual(before)
  })
})
