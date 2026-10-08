import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 20: what the timeline tells you while you work. Step 1 is the strip
 * that shows the whole edit and the Fit that puts it on screen.
 */

const fx = fixtureSet('ui-timeline-feedback')
const root = await mkdtemp(join(tmpdir(), 'editbay-tlfeedback-'))
let app: ElectronApplication
let page: Page
const WAIT = { timeout: 10_000 }

/** Three copies of the clip on V1, so there is more edit than fits on screen. */
beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let i = 0; i < 3; i++) await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 3)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** What the strip says it is showing, in frames. */
async function boxed(): Promise<{ from: number; to: number; frames: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="overview"]')
    return {
      from: Number(el?.getAttribute('data-from') ?? 0),
      to: Number(el?.getAttribute('data-to') ?? 0),
      frames: Number(el?.getAttribute('data-frames') ?? 0)
    }
  })
}

function scrollLeft(): Promise<number> {
  return page.evaluate(() => document.querySelector('[data-testid="timeline-scroll"]')?.scrollLeft ?? 0)
}

function playhead(): Promise<number> {
  return page.evaluate(() => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') ?? -1))
}

/** Zoom in until the edit is wider than the window shows it. */
async function zoomInUntilItScrolls(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const room = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-scroll"]')
      return el ? el.scrollWidth - el.clientWidth : 0
    })
    if (room > 300) return
    await page.keyboard.press('Equal')
    await page.waitForTimeout(60)
  }
}

describe('the strip that shows the whole edit', () => {
  it('is there, with a block for every clip on every track', async () => {
    await page.waitForSelector('[data-testid="overview"]')
    // Three pictures and their three sounds.
    expect(await page.locator('[data-testid="overview-block"][data-kind="video"]').count()).toBe(3)
    expect(await page.locator('[data-testid="overview-block"][data-kind="audio"]').count()).toBe(3)
  })

  it('covers the whole edit once the Fit button has put it all on screen', async () => {
    // Arranged zoomed in, so the button has something to undo.
    await zoomInUntilItScrolls()
    await page.waitForTimeout(120)
    expect((await boxed()).to - (await boxed()).from).toBeLessThan((await boxed()).frames * 0.9)

    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(150)
    const seen = await boxed()
    expect(seen.frames).toBeGreaterThan(0)
    expect(seen.from).toBeLessThan(1)
    // Within a frame of the end: Fit puts all of it on screen.
    expect(seen.to).toBeGreaterThan(seen.frames - 2)
  })

  it('narrows its box and follows the timeline when it is scrolled', async () => {
    await zoomInUntilItScrolls()
    await page.waitForTimeout(150)
    const zoomedIn = await boxed()
    expect(zoomedIn.to - zoomedIn.from).toBeLessThan(zoomedIn.frames * 0.9)

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-scroll"]')
      if (el) el.scrollLeft = el.scrollWidth - el.clientWidth
    })
    await page.waitForTimeout(150)
    const scrolled = await boxed()
    expect(scrolled.from).toBeGreaterThan(zoomedIn.from)
  })

  it('moves nothing when it is pressed off the box, and a drag of the box leaves the playhead alone', async () => {
    await zoomInUntilItScrolls()
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-scroll"]')
      if (el) el.scrollLeft = 0
    })
    await page.waitForTimeout(150)
    const was = await playhead()
    expect(was).toBeGreaterThanOrEqual(0)

    const strip = (await page.locator('[data-testid="overview"]').boundingBox())!
    const y = strip.y + strip.height / 2
    // Three quarters along the whole edit, well off the box: nothing moves.
    await page.mouse.click(strip.x + strip.width * 0.75, y)
    await page.waitForTimeout(150)
    expect(await scrollLeft()).toBe(0)

    // The box dragged there does move it.
    const box = (await page.locator('[data-testid="overview-box"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(strip.x + strip.width * 0.75, y, { steps: 10 })
    await page.mouse.up()
    await expect.poll(scrollLeft, { timeout: 5000 }).toBeGreaterThan(0)
    // Where you are looking, not where you are.
    expect(await playhead()).toBe(was)
  })

  it('drags its box with the pointer rather than behind it, and moves nothing on a hover', async () => {
    await zoomInUntilItScrolls()
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-scroll"]')
      if (el) el.scrollLeft = 0
    })
    await page.waitForTimeout(150)

    const strip = (await page.locator('[data-testid="overview"]').boundingBox())!
    const y = strip.y + strip.height / 2
    const boxX = (): Promise<number> =>
      page.evaluate(() => document.querySelector('[data-testid="overview-box"]')!.getBoundingClientRect().x)

    // A pointer crossing the strip with nothing held down moves nothing at all.
    const still = await scrollLeft()
    for (let i = 1; i <= 8; i++) await page.mouse.move(strip.x + 80 + i * 40, y)
    await page.waitForTimeout(150)
    expect(await scrollLeft()).toBe(still)

    // Taken by the box and dragged: it keeps the grip it was picked up by, so
    // it goes as far as the pointer went rather than a fraction of it.
    const from = await boxX()
    await page.mouse.move(from + 8, y)
    await page.mouse.down()
    await page.waitForTimeout(80)
    await page.mouse.move(from + 8 + 120, y, { steps: 10 })
    await page.waitForTimeout(80)
    const moved = (await boxX()) - from
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(moved).toBeGreaterThan(105)
    expect(moved).toBeLessThan(135)
    // And it stays where the drag left it once the pointer moves off.
    await page.mouse.move(strip.x + 20, strip.y - 40)
    await page.waitForTimeout(150)
    expect((await boxX()) - from).toBeCloseTo(moved, 0)
  })
})

describe('Fit', () => {
  it('puts the whole edit on screen from the key as well as the button', async () => {
    await zoomInUntilItScrolls()
    await page.waitForTimeout(120)
    const zoomedIn = await boxed()
    expect(zoomedIn.to - zoomedIn.from).toBeLessThan(zoomedIn.frames * 0.9)

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Shift+F')
    await page.waitForTimeout(150)
    const fitted = await boxed()
    expect(fitted.to - fitted.from).toBeGreaterThan(fitted.frames * 0.95)
    expect(await scrollLeft()).toBe(0)
  })
})

describe('a clip says what it is', () => {
  it('carries its source name and which cut of it, so three of one take differ', async () => {
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForSelector('[data-testid="clip-name"]')
    const names = await page
      .locator('[data-testid="clip"][data-kind="video"] [data-testid="clip-name"]')
      .allTextContents()
    expect(names.length).toBe(3)
    for (const n of names) expect(n).toContain('clean.mp4')
    // The same recording three times: each says which cut it is.
    expect(new Set(names).size).toBe(3)
    expect(names.some((n) => n.includes('cut 1'))).toBe(true)
    expect(names.some((n) => n.includes('cut 3'))).toBe(true)
  })
})

describe('a track says what it carries', () => {
  it('names the recording on it, and its kind once they disagree', async () => {
    const v1 = page.locator('[data-testid="track-header"][data-track="V1"] [data-testid="track-carries"]')
    expect(await v1.textContent()).toBe('clean.mp4')
    // An empty track has nothing to name, so it says what kind it is.
    const before = await page.locator('[data-testid="track-header"]').count()
    await page.click('[data-testid="add-audio-track"]')
    await page.waitForFunction((was) => document.querySelectorAll('[data-testid="track-header"]').length === was + 1, before)
    const added = page.locator('[data-testid="track-header"]').last().locator('[data-testid="track-carries"]')
    expect(await added.textContent()).toBe('sound')
    await page.locator('[data-testid="track-header"]').last().locator('[data-testid="track-menu-open"]').click()
    await page.waitForSelector('[data-testid="track-menu"]')
    await page.click('[data-testid="track-remove"]')
  })
})

describe('mute, solo and lock', () => {
  it('mutes a track from its header, and says it holds for the export too', async () => {
    const a1 = page.locator('[data-testid="track-header"][data-track="A1"] [data-testid="track-mute"]')
    expect(await a1.getAttribute('aria-pressed')).toBe('false')
    await a1.click()
    await expect.poll(() => a1.getAttribute('aria-pressed'), WAIT).toBe('true')
    expect(await a1.getAttribute('title')).toContain('export')
    await a1.click()
    await expect.poll(() => a1.getAttribute('aria-pressed'), WAIT).toBe('false')
  })

  it('solos a track, and says it is never saved and never exported', async () => {
    const solo = page.locator('[data-testid="track-header"][data-track="A1"] [data-testid="track-solo"]')
    await solo.click()
    await expect.poll(() => solo.getAttribute('aria-pressed'), WAIT).toBe('true')
    expect(await solo.getAttribute('title')).toContain('never exported')
    await solo.click()
    await expect.poll(() => solo.getAttribute('aria-pressed'), WAIT).toBe('false')
  })

  it('has no mute or solo on a video track, which carries no sound of its own', async () => {
    const v1 = page.locator('[data-testid="track-header"][data-track="V1"]')
    expect(await v1.locator('[data-testid="track-mute"]').count()).toBe(0)
    expect(await v1.locator('[data-testid="track-solo"]').count()).toBe(0)
    expect(await v1.locator('[data-testid="track-lock"]').count()).toBe(1)
  })

  it('refuses an edit on a locked track, and takes it again once it is unlocked', async () => {
    const lock = page.locator('[data-testid="track-header"][data-track="V1"] [data-testid="track-lock"]')
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(120)

    const clipsNow = (): Promise<number> =>
      page.locator('[data-testid="clip"][data-kind="video"]').count()
    const before = await clipsNow()

    await lock.click()
    await expect.poll(() => lock.getAttribute('aria-pressed'), WAIT).toBe('true')

    // Select a clip and press Delete: the locked track keeps every clip it had.
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.keyboard.press('Delete')
    // A refusal fades by itself rather than waiting to be pressed: nothing
    // was lost and nothing is being asked.
    await page.waitForSelector('[data-testid="toast"][data-kind="notice"]', { timeout: 10_000 })
    expect(await page.textContent('[data-testid="toast"][data-kind="notice"]')).toContain('V1 is locked')
    expect(await clipsNow()).toBe(before)

    // Unlocked, the same Delete goes through.
    await lock.click()
    await expect.poll(() => lock.getAttribute('aria-pressed'), WAIT).toBe('false')
    await page.keyboard.press('Delete')
    await expect.poll(clipsNow, WAIT).toBe(before - 1)
    await page.keyboard.press('Control+z')
    await expect.poll(clipsNow, WAIT).toBe(before)
  })

  it('makes a toggle that is on look nothing like one that is off', async () => {
    const lock = page.locator('[data-testid="track-header"][data-track="V1"] [data-testid="track-lock"]')
    /** Its fill, its border, its glyph colour, and the shape drawn inside it. */
    const look = (): Promise<{ fill: string; border: string; ink: string; shape: string }> =>
      lock.evaluate((el) => {
        const drawn = getComputedStyle(el)
        return {
          fill: drawn.backgroundColor,
          border: drawn.borderTopColor,
          ink: drawn.color,
          shape: el.querySelector('svg')?.innerHTML ?? ''
        }
      })

    const off = await look()
    await lock.click()
    await expect.poll(() => lock.getAttribute('aria-pressed'), WAIT).toBe('true')
    // Read with the pointer off it, so what is measured is the on state and
    // not the hover the click left behind. The colours cross over 90ms, so the
    // fill is polled rather than read once: a read on the first frame of the
    // transition sees the colour it is leaving.
    await page.mouse.move(0, 0)
    // On is the accent's own fill, a change of hue and not only brightness,
    // which entry 20 made the one on look for every control. The glyph is
    // white on it, for contrast, so the fill and border carry the state.
    // Polled to its end: a read part way through the crossing sees a colour
    // between the two, which is neither.
    const blueness = async (): Promise<number> => {
      const [r, , b] = ((await look()).fill.match(/\d+/g) ?? []).map(Number)
      return b! - r!
    }
    await expect.poll(blueness, WAIT).toBeGreaterThan(40)
    const on = await look()
    expect(on.border).not.toBe(off.border)
    // And the padlock closes, so the answer is not carried by colour alone.
    expect(on.shape).not.toBe(off.shape)

    await lock.click()
    await expect.poll(() => lock.getAttribute('aria-pressed'), WAIT).toBe('false')
    await page.mouse.move(0, 0)
  })
})

describe('what a drag tells you', () => {
  it('shows the frame a trim would land on, and how far it has moved', async () => {
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(150)
    // The handle itself, not a guess at where the clip's edge is: a box read
    // while the fit is still settling puts the guess on the next clip.
    const first = page.locator('[data-testid="clip"][data-kind="video"]').first()
    const handle = (await first.locator('[data-testid="trim-end"]').boundingBox())!
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 24, y, { steps: 6 })
    await page.waitForSelector('[data-testid="edge-frame"]', { timeout: 10_000 })
    const moved = Number(await page.getAttribute('[data-testid="edge-frame"]', 'data-moved'))
    expect(moved).toBeLessThan(0)
    expect(await page.textContent('[data-testid="edge-frame"]')).toContain('frames')
    await page.mouse.up()
    // It goes as soon as the drag lets go.
    await expect.poll(() => page.locator('[data-testid="edge-frame"]').count(), WAIT).toBe(0)
    await page.keyboard.press('Control+z')
  })

  it('draws a line at what a drag snapped to, and takes it away when it lets go', async () => {
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(150)
    const clips = page.locator('[data-testid="clip"][data-kind="video"]')
    const second = (await clips.nth(1).boundingBox())!
    const y = second.y + second.height / 2
    // Dragged past the threshold but still inside the snap distance of its own
    // start, which is what it catches.
    await page.mouse.move(second.x + second.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(second.x + second.width / 2 + 7, y, { steps: 5 })
    await page.waitForSelector('[data-testid="snap-guide"]', { timeout: 10_000 })
    expect(Number(await page.getAttribute('[data-testid="snap-guide"]', 'data-frame'))).toBeGreaterThan(0)
    await page.mouse.up()
    await expect.poll(() => page.locator('[data-testid="snap-guide"]').count(), WAIT).toBe(0)
  })

  it('says how far a clip being dragged would move', async () => {
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(150)
    const clips = page.locator('[data-testid="clip"][data-kind="video"]')
    const third = (await clips.nth(2).boundingBox())!
    const y = third.y + third.height / 2
    await page.mouse.move(third.x + third.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(third.x + third.width / 2 + 40, y, { steps: 6 })
    await page.waitForSelector('[data-testid="drop-outline"]', { timeout: 10_000 })
    const moved = Number(await page.getAttribute('[data-testid="drop-outline"]', 'data-moved'))
    expect(Math.abs(moved)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.keyboard.press('Control+z')
  })
})

describe('a menu on a clip', () => {
  it('opens on a right click, names the clip, and closes on Escape without changing anything', async () => {
    await page.click('[data-testid="timeline-fit"]')
    await page.waitForTimeout(150)
    const before = await page.locator('[data-testid="clip"][data-kind="video"]').count()
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu"]')
    expect(await page.textContent('[data-testid="clip-menu"]')).toContain('clean.mp4')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached' })
    expect(await page.locator('[data-testid="clip"][data-kind="video"]').count()).toBe(before)
  })

  it('leaves out what cannot be done just now, and keeps the rest one step away (bugs and notes 2, note 21)', async () => {
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu"]')
    // Nothing copied: no Paste, and no Paste the framing in Framing, which Copy the framing is in.
    expect(await page.locator('[data-testid="clip-menu-paste"]').count()).toBe(0)
    await page.hover('[data-testid="clip-menu-framing"]')
    await page.waitForSelector('[data-testid="clip-menu-copy-framing"]')
    expect(await page.locator('[data-testid="clip-menu-paste-framing"]').count()).toBe(0)
    // A short menu: nothing greyed but Split, whose place is fixed.
    const greyed = await page.locator('[data-testid="clip-menu"] button:disabled').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    // The mark swatches are not items: "no mark" is off on a clip that has none.
    expect(greyed.filter((id) => id !== 'clip-menu-split' && id?.startsWith('clip-menu-'))).toEqual([])
    // Copy the framing, and Paste the framing is there the next time.
    await page.click('[data-testid="clip-menu-copy-framing"]')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached' })
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.click('[data-testid="clip-menu-framing"]')
    await page.waitForSelector('[data-testid="clip-menu-paste-framing"]')
    // The keyboard works the submenus: left comes back out.
    await page.focus('[data-testid="clip-menu-copy-framing"]')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => page.locator('[data-testid="clip-menu-paste-framing"]').count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached' })
  })


  it('runs an edit from the menu, which one undo takes back', async () => {
    await page.keyboard.press('Home')
    const before = await page.locator('[data-testid="clip"][data-kind="video"]').count()
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu"]')
    await page.click('[data-testid="clip-menu-delete"]')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached' })
    await expect.poll(() => page.locator('[data-testid="clip"][data-kind="video"]').count(), WAIT).toBe(before - 1)
    await page.keyboard.press('Control+z')
    await expect.poll(() => page.locator('[data-testid="clip"][data-kind="video"]').count(), WAIT).toBe(before)
  })
})
