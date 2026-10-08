import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * The editing half of docs/smoke-checklist.md, driven through the real app.
 *
 * This launches the built Electron application and clicks it, so it covers the
 * wiring that unit tests cannot: IPC round trips, React state, pointer
 * interaction and the keyboard. Run `npm run build` first, or use
 * `npm run test:ui`, which builds.
 *
 * File dialogs are native and cannot be driven, so opening and saving by dialog
 * stay on the manual checklist. Everything else here is automated.
 */

const CLIP = '[data-testid="clip"]'
const ASSET = '[data-testid="asset"]'
/** Vertically inside a clip on a video track, between its trim handles. */
const CLIP_BODY_Y = 20

const fx = fixtureSet('ui')
let app: ElectronApplication
let page: Page
let userData: string
let exportDir: string
let cleanPath: string
let silentPath: string

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  silentPath = await fx.silentClip()
  userData = await mkdtemp(join(tmpdir(), 'editbay-ui-'))
  exportDir = await mkdtemp(join(tmpdir(), 'editbay-ui-export-'))

  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(userData, { recursive: true, force: true })
  await rm(exportDir, { recursive: true, force: true })
  await fx.cleanup()
})

/** Import through the app's own API, because a native file dialog cannot be driven. */
async function importIntoApp(paths: string[]): Promise<void> {
  await page.evaluate((p) => window.api.importFiles(p), paths)
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length >= count,
    paths.length,
    { timeout: 180_000 }
  )
}

async function clipCount(): Promise<number> {
  return page.locator(CLIP).count()
}

async function clipLengths(): Promise<number[]> {
  return page.locator(CLIP).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-length-frames'))))
}

async function mediaOrder(): Promise<string[]> {
  return page.locator(CLIP).evaluateAll((els) => els.map((e) => e.getAttribute('data-media-id') ?? ''))
}

async function clipStarts(): Promise<number[]> {
  return page.locator(CLIP).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-start'))))
}

async function waitForClips(n: number): Promise<void> {
  await page.waitForFunction((want) => document.querySelectorAll('[data-testid="clip"]').length === want, n, {
    timeout: 10_000
  })
}

/**
 * Put a recording on the timeline, named rather than counted: the bin puts the
 * newest first, so which card is where depends on the order things came in.
 */
async function addAssetToTimeline(name: 'clean.mp4' | 'silent.mp4'): Promise<void> {
  const before = await clipCount()
  await page.locator(`${ASSET}:has(div[title$="${name}"]) [data-testid="add-to-timeline"]`).click()
  await waitForClips(before + 1)
}

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

async function totalFrames(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-total'))
}

/**
 * Start every group from the same two-clip timeline, so tests do not depend on
 * order. This goes through the app's own new-project path rather than the IPC
 * call behind it, because that path is also what clears the undo history.
 */
async function resetTimeline(): Promise<void> {
  await closeExport(page)
  // A new project starts on the shape chosen last, and offers the framing used last: these tests start from Vertical, unframed.
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'vertical', lastFraming: null }))
  await page.keyboard.press('Control+n')
  await waitForClips(0)
  await importIntoApp([cleanPath, silentPath])
  await addAssetToTimeline('clean.mp4')
  await addAssetToTimeline('silent.mp4')
  await page.keyboard.press('Home')
}

/**
 * Drag with real pointer events, in steps, because the handlers react to each
 * move. With `exact`, Alt is held so nothing snaps: the drag goes to exact frames.
 */
async function dragBy(x: number, y: number, dx: number, exact = false): Promise<void> {
  if (exact) await page.keyboard.down('Alt')
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y)
  await page.mouse.up()
  if (exact) await page.keyboard.up('Alt')
}

async function selectFirstClip(): Promise<void> {
  const box = await page.locator(CLIP).first().boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + CLIP_BODY_Y)
}

describe('the editor window', () => {
  it('opens and reports a usable ffmpeg', async () => {
    expect(await page.title()).toMatch(/Editbay$/)
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="ffmpeg-status"]')?.textContent ?? '').includes('ffmpeg version'),
      undefined,
      { timeout: 30_000 }
    )
    const status = await page.textContent('[data-testid="ffmpeg-status"]')
    expect(status).toMatch(/ffmpeg version/i)
    expect(status).not.toMatch(/unusable/i)
  })

  it('shows imported files in the source bin', async () => {
    await importIntoApp([cleanPath, silentPath])
    expect(await page.locator(ASSET).count()).toBe(2)
    expect(await page.locator(`${ASSET}[data-status="ready"]`).count()).toBe(2)
  })
})

describe('building a timeline', () => {
  beforeEach(async () => {
    // Through the same path Ctrl+N takes, waited for: New keeps the work it
    // replaces first (plan 84), and files imported before it lands are cleared by it.
    await page.evaluate(() => window.api.newProject())
    await waitForClips(0)
    await importIntoApp([cleanPath, silentPath])
  })

  it('adds a clip at its full length', async () => {
    await addAssetToTimeline('clean.mp4')
    expect(await clipCount()).toBe(1)
    // The clean fixture is 4 seconds at 30fps.
    expect((await clipLengths())[0]).toBe(120)
  })

  it('adds a second clip after the first', async () => {
    await addAssetToTimeline('clean.mp4')
    await addAssetToTimeline('silent.mp4')
    expect(await clipCount()).toBe(2)
    // 4 seconds plus 3 seconds.
    expect(await totalFrames()).toBe(120 + 90)
  })

  it('selects a clip when it is clicked, and shows it in the inspector', async () => {
    await addAssetToTimeline('clean.mp4')
    await selectFirstClip()
    expect(await page.getAttribute(CLIP, 'data-selected')).toBe('yes')
    expect(await page.getAttribute('[data-testid="clip-length"]', 'data-frames')).toBe('120')
  })
})

describe('trimming', () => {
  beforeEach(resetTimeline)

  it('shortens a clip when its end handle is dragged left', async () => {
    const clip = page.locator(CLIP).first()
    await selectFirstClip()
    const before = (await clipLengths())[0] ?? 0

    const box = await clip.locator('[data-testid="trim-end"]').boundingBox()
    expect(box).not.toBeNull()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -40)

    // Wait for the edit to land rather than reading once: each trim step is an
    // IPC round trip, and a single read can arrive a frame early.
    await page.waitForFunction(
      (was) => Number(document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames')) < was,
      before,
      { timeout: 5000 }
    )
    expect((await clipLengths())[0] ?? 0).toBeGreaterThan(0)
  })

  it('leaves a gap when a clip is shortened, which a click and Delete close up', async () => {
    // V1 is the 4 second clip from 0 to 120 and the 3 second one from 120 to 210.
    const clip = page.locator(CLIP).first()
    const box = await clip.locator('[data-testid="trim-end"]').boundingBox()
    // 20 pixels at 0.4 per frame is 50 frames.
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -20, true)
    await page.waitForFunction(() => document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames') === '70', undefined, {
      timeout: 5000
    })
    // The clip after it stays where it was, so the sequence is as long as before.
    expect(await clipStarts()).toEqual([0, 120])
    expect(await totalFrames()).toBe(210)

    // A click in the gap selects it; Delete takes its time out of the sequence.
    const v1 = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
    await page.mouse.click(v1.x + 95 * 0.4, v1.y + v1.height / 2)
    await page.waitForSelector('[data-testid="selected-gap"][data-from="70"][data-to="120"]', { timeout: 5000 })
    // An undo fills it again, and it is not selected any more; nor once the trim is back.
    await page.keyboard.press('Control+z')
    await page.waitForSelector('[data-testid="selected-gap"]', { state: 'detached', timeout: 5000 })
    await page.keyboard.press('Control+y')
    await page.waitForFunction(() => document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames') === '70', undefined, {
      timeout: 5000
    })
    expect(await page.locator('[data-testid="selected-gap"]').count()).toBe(0)
    await page.mouse.click(v1.x + 95 * 0.4, v1.y + v1.height / 2)
    await page.waitForSelector('[data-testid="selected-gap"][data-from="70"][data-to="120"]', { timeout: 5000 })
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-total') === '160', undefined, {
      timeout: 5000
    })
    expect(await clipStarts()).toEqual([0, 70])
  })

  it('refuses to trim a clip out of existence', async () => {
    const clip = page.locator(CLIP).first()
    const box = await clip.locator('[data-testid="trim-end"]').boundingBox()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -2000)
    expect((await clipLengths())[0] ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('leaves a clip trimmed to nothing still selectable', async () => {
    const clip = page.locator(CLIP).first()
    const box = await clip.locator('[data-testid="trim-end"]').boundingBox()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -2000)
    // The handles must not have swallowed the whole clip.
    await selectFirstClip()
    expect(await page.getAttribute(CLIP, 'data-selected')).toBe('yes')
  })

  it('refuses to trim past the end of the source', async () => {
    const clip = page.locator(CLIP).first()
    const box = await clip.locator('[data-testid="trim-end"]').boundingBox()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, 3000)
    // The source is 4 seconds, so 120 frames is the ceiling.
    expect((await clipLengths())[0] ?? 0).toBeLessThanOrEqual(120)
  })
})

describe('the playhead', () => {
  beforeEach(resetTimeline)

  it('moves one frame at a time', async () => {
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    expect(await playhead()).toBe(2)
    await page.keyboard.press('ArrowLeft')
    expect(await playhead()).toBe(1)
  })

  it('jumps a second at a time with shift', async () => {
    await page.keyboard.press('Shift+ArrowRight')
    expect(await playhead()).toBe(30)
  })

  it('never leaves the timeline', async () => {
    await page.keyboard.press('ArrowLeft')
    expect(await playhead()).toBe(0)
    await page.keyboard.press('End')
    const total = await totalFrames()
    await page.keyboard.press('ArrowRight')
    expect(await playhead()).toBe(total)
  })

  it('scrubs when the ruler is dragged', async () => {
    const box = await page.locator('main').boundingBox()
    expect(box).not.toBeNull()
    const before = await playhead()
    // Click partway along the ruler, over the clips.
    const clipBox = await page.locator(CLIP).first().boundingBox()
    const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
    await page.mouse.click(clipBox!.x + 20, ruler.y + ruler.height / 2)
    expect(await playhead()).not.toBe(before)
    // The empty lane between the ruler and the clips moves it too.
    const lane = (await page.locator('[data-testid="new-track-lane"][data-kind="video"]').boundingBox())!
    await page.mouse.click(clipBox!.x + 40, lane.y + lane.height / 2)
    expect(await playhead()).toBe(100)
  })
})

describe('splitting and deleting', () => {
  beforeEach(resetTimeline)

  it('splits the clip under the playhead', async () => {
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('s')
    await waitForClips(3)
    const lengths = await clipLengths()
    expect(lengths[0]).toBe(30)
    expect(lengths[1]).toBe(90)
  })

  it('does not split on a clip boundary', async () => {
    const before = await clipCount()
    await page.keyboard.press('s')
    await page.waitForTimeout(250)
    expect(await clipCount()).toBe(before)
  })

  it('deletes the selected clip leaving a gap, and Shift+Delete closes up', async () => {
    await selectFirstClip()
    const total = await totalFrames()
    await page.keyboard.press('Delete')
    await waitForClips(1)
    // The 4 second clip went and left its gap: the 3 second one is where it was.
    expect(await totalFrames()).toBe(total)
    expect((await clipLengths())[0]).toBe(90)
    expect(await clipStarts()).toEqual([120])
    // Its sound went with it.
    expect(await page.locator('[data-testid="sound-clip"]').count()).toBe(0)

    await page.keyboard.press('Control+z')
    await waitForClips(2)
    await selectFirstClip()
    await page.keyboard.press('Shift+Delete')
    await waitForClips(1)
    // Closed up: the 3 second clip now starts the sequence.
    expect(await clipStarts()).toEqual([0])
    expect(await totalFrames()).toBe(90)
  })

  it('puts the playhead on the join Shift+Delete leaves, not on whatever slid up under it', async () => {
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    // Parked past the end: the time it was on no longer means the same frame.
    await page.keyboard.press('End')
    expect(await playhead()).toBe(210)
    await page.keyboard.press('Shift+Delete')
    await waitForClips(1)
    expect(await playhead()).toBe(120)
  })
})

describe('joining split clips', () => {
  beforeEach(resetTimeline)

  const soundCount = (): Promise<number> => page.locator('[data-testid="sound-clip"]').count()
  async function splitFirstAt(frames: number): Promise<void> {
    await selectFirstClip()
    await page.keyboard.press('Home')
    for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight')
    const before = await clipCount()
    await page.keyboard.press('s')
    await waitForClips(before + 1)
  }

  it('joins a split back from the right-click menu, its sound with it, and one undo splits it again', async () => {
    const sounds = await soundCount()
    await splitFirstAt(60)
    const pieces = await clipLengths()
    expect(pieces).toHaveLength(3)
    expect(pieces[0]! + pieces[1]!).toBe(120)
    const first = (await page.locator(CLIP).first().boundingBox())!
    await page.mouse.click(first.x + first.width / 2, first.y + CLIP_BODY_Y, { button: 'right' })
    // In the menu's Join (bugs and notes 2, note 21).
    await page.click('[data-testid="clip-menu-join"]')
    await page.click('[data-testid="clip-menu-join-next"]')
    await waitForClips(2)
    expect(await clipLengths()).toEqual([120, 90])
    await expect.poll(soundCount).toBe(sounds)
    await page.keyboard.press('Control+z')
    await waitForClips(3)
    expect(await clipLengths()).toEqual(pieces)
  })

  it('joins at the selected clip’s edge nearest the playhead with Ctrl+J', async () => {
    await splitFirstAt(60)
    await selectFirstClip()
    await page.keyboard.press('Control+j')
    await waitForClips(2)
    expect(await clipLengths()).toEqual([120, 90])
  })

  it('asks before a join that brings back a stretch taken out, and puts it back when told to', async () => {
    await splitFirstAt(30)
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    await page.keyboard.press('End')
    await page.keyboard.press('Home')
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('s')
    await waitForClips(4)
    // The middle piece, 30 to 60, taken out closing up.
    const middle = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(middle.x + middle.width / 2, middle.y + CLIP_BODY_Y)
    await page.keyboard.press('Shift+Delete')
    await waitForClips(3)
    const cut = await clipLengths()
    // Ctrl+J asks, saying how much comes back; Cancel changes nothing.
    await selectFirstClip()
    await page.keyboard.press('End')
    await page.keyboard.press('Control+j')
    await page.waitForSelector('[data-testid="join-ask"]')
    expect(await page.textContent('[data-testid="join-ask"]')).toContain('brings back 1.0 s')
    await page.click('[data-testid="join-ask-cancel"]')
    await page.waitForSelector('[data-testid="join-ask"]', { state: 'detached' })
    expect(await clipLengths()).toEqual(cut)
    // The right click's Join says it too, and asks the same.
    const first = (await page.locator(CLIP).first().boundingBox())!
    await page.mouse.click(first.x + first.width / 2, first.y + CLIP_BODY_Y, { button: 'right' })
    await page.click('[data-testid="clip-menu-join"]')
    expect(await page.textContent('[data-testid="clip-menu-join-next"]')).toContain('bringing back 1.0 s')
    await page.click('[data-testid="clip-menu-join-next"]')
    await page.click('[data-testid="join-ask-join"]')
    await waitForClips(2)
    // The stretch is back: the first clip is whole again, and the sequence as long as before the cut.
    expect(await clipLengths()).toEqual([120, 90])
    await page.keyboard.press('Control+z')
    await waitForClips(3)
    expect(await clipLengths()).toEqual(cut)
  })
})

describe('grouping pieces into one clip (bugs and notes 2, note 29)', () => {
  beforeEach(resetTimeline)

  /** The first recording cut at 30 and 60, the middle taken out: two pieces with a cut between them, then the second recording. */
  async function twoPieces(): Promise<void> {
    await selectFirstClip()
    await page.keyboard.press('Home')
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('s')
    await waitForClips(3)
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    await page.keyboard.press('s')
    await waitForClips(4)
    const middle = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(middle.x + middle.width / 2, middle.y + CLIP_BODY_Y)
    await page.keyboard.press('Shift+Delete')
    await waitForClips(3)
  }
  const groups = (): Promise<string[]> => page.locator(CLIP).evaluateAll((els) => els.map((e) => e.getAttribute('data-group') ?? ''))
  const selectedCount = (): Promise<number> => page.locator(`${CLIP}[data-selected="yes"]`).count()

  it('groups two pieces with Ctrl+G into one block, selected and moved as one, and Ctrl+Shift+G gives them back', async () => {
    await twoPieces()
    const lengths = await clipLengths()
    // The two pieces picked, then grouped.
    const a = (await page.locator(CLIP).nth(0).boundingBox())!
    const b = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(a.x + a.width / 2, a.y + CLIP_BODY_Y)
    await page.keyboard.down('Shift')
    await page.mouse.click(b.x + b.width / 2, b.y + CLIP_BODY_Y)
    await page.keyboard.up('Shift')
    await page.keyboard.press('Control+g')
    await expect.poll(async () => (await groups()).filter((g) => g !== '').length).toBe(2)
    const [g1, g2, g3] = await groups()
    expect(g1).toBe(g2)
    expect(g3).toBe('')
    // The cut inside is marked, and is not a handle.
    expect(await page.locator(`${CLIP} [data-testid="group-cut"]`).count()).toBe(1)
    expect(await page.locator(`${CLIP}`).nth(0).locator('[data-testid="trim-end"]').count()).toBe(0)
    expect(await page.locator(`${CLIP}`).nth(1).locator('[data-testid="trim-start"]').count()).toBe(0)
    // One click on either piece selects the whole group.
    await page.keyboard.press('Escape')
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    await expect.poll(selectedCount).toBe(2)
    // Ungrouped, the pieces are as they were.
    await page.keyboard.press('Control+Shift+g')
    await expect.poll(async () => (await groups()).every((g) => g === '')).toBe(true)
    expect(await clipLengths()).toEqual(lengths)
  })

  it('offers Group in the right click Join, and a zoom on it runs across the cut', async () => {
    await twoPieces()
    const a = (await page.locator(CLIP).nth(0).boundingBox())!
    const b = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(a.x + a.width / 2, a.y + CLIP_BODY_Y)
    await page.keyboard.down('Shift')
    await page.mouse.click(b.x + b.width / 2, b.y + CLIP_BODY_Y)
    await page.keyboard.up('Shift')
    await page.mouse.click(a.x + a.width / 2, a.y + CLIP_BODY_Y, { button: 'right' })
    await page.click('[data-testid="clip-menu-join"]')
    await page.click('[data-testid="clip-menu-group"]')
    await expect.poll(async () => (await groups()).filter((g) => g !== '').length).toBe(2)
    // A zoom made from the second piece spans both: the first piece moves as well.
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    await page.keyboard.press('Home')
    const clips = (): Promise<{ keys: number }[]> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => ({ keys: c.transform.keys?.length ?? 0 })))
    await page.click('[data-testid="zoom-simple-in"]')
    // Both pieces move: the zoom's keyframes are on each of them.
    await expect.poll(async () => (await clips()).slice(0, 2).every((c) => c.keys > 0), { timeout: 5000 }).toBe(true)
    expect((await clips())[2]!.keys).toBe(0)
  })
})

describe('dragging an edge on V1 (plan 82)', () => {
  beforeEach(resetTimeline)

  /** The first recording cut at 30 and 60, the middle taken out and closed up. */
  async function middleOut(): Promise<void> {
    await selectFirstClip()
    await page.keyboard.press('Home')
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('s')
    await waitForClips(3)
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    const second = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + CLIP_BODY_Y)
    await page.keyboard.press('s')
    await waitForClips(4)
    const middle = (await page.locator(CLIP).nth(1).boundingBox())!
    await page.mouse.click(middle.x + middle.width / 2, middle.y + CLIP_BODY_Y)
    await page.keyboard.press('Shift+Delete')
    await waitForClips(3)
  }
  async function dragEnd(index: number, byPx: number, ctrl = false): Promise<void> {
    const handle = (await page.locator(CLIP).nth(index).locator('[data-testid="trim-end"]').boundingBox())!
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    if (ctrl) await page.keyboard.down('Control')
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (byPx * i) / 6, y)
    // Alt off: no snapping pulling the edge about.
    await page.mouse.up()
    if (ctrl) await page.keyboard.up('Control')
  }

  it('brings the footage cut away back and moves the rest later, and one undo puts it back', async () => {
    await middleOut()
    const lengths = await clipLengths()
    const starts = await clipStarts()
    expect(lengths[0]).toBe(30)
    await dragEnd(0, 60)
    await expect.poll(async () => (await clipLengths())[0]!).toBeGreaterThan(30)
    const grown = (await clipLengths())[0]! - 30
    // Everything after it moved later by as much, rather than being covered.
    expect((await clipStarts())[1]).toBe(starts[1]! + grown)
    expect((await clipLengths()).slice(1)).toEqual(lengths.slice(1))
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(clipLengths).toEqual(lengths)
    expect(await clipStarts()).toEqual(starts)
  })

  it('stops at the next clip with Ctrl held, as a plain trim', async () => {
    await middleOut()
    const lengths = await clipLengths()
    await dragEnd(0, 60, true)
    await page.waitForTimeout(300)
    expect(await clipLengths()).toEqual(lengths)
  })
})

describe('undo and redo', () => {
  beforeEach(resetTimeline)

  it('takes back a delete and puts it back again', async () => {
    await selectFirstClip()
    await page.keyboard.press('Delete')
    await waitForClips(1)

    await page.keyboard.press('Control+z')
    await waitForClips(2)

    await page.keyboard.press('Control+y')
    await waitForClips(1)
  })

  it('survives a long chain of edits', async () => {
    // Every key the window gets, what had focus, and where the playhead was: for the report below.
    await page.evaluate(() => {
      const w = window as unknown as { keyLog: string[] }
      w.keyLog = []
      const head = (): string => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') ?? '?'
      window.addEventListener(
        'keydown',
        (e) => w.keyLog.push(`${e.code}@${(e.target as Element | null)?.tagName ?? '?'} head ${head()} t ${Math.round(performance.now())}`),
        true
      )
      new MutationObserver(() => w.keyLog.push(`head -> ${head()} t ${Math.round(performance.now())}`)).observe(
        document.querySelector('[data-testid="timecode"]')!,
        { attributes: true, attributeFilter: ['data-playhead'] }
      )
    })
    const start = await clipLengths()
    expect(start).toEqual([120, 90])

    // Split the first clip three times, a second apart. Each split waits for
    // the playhead to land first: a key pressed before the window has drawn
    // the last one acts on where the playhead was.
    await page.waitForFunction(() => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === '0')
    for (const [i, expected] of [3, 4, 5].entries()) {
      await page.keyboard.press('Shift+ArrowRight')
      await page
        .waitForFunction(
          (f) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(f),
          30 * (i + 1)
        )
        .catch(async (err: unknown) => {
          // This has failed now and then in full runs and never alone: say what the window held.
          console.log(
            'Shift+ArrowRight missed at step',
            i,
            JSON.stringify(
              await page.evaluate(() => ({
                playhead: document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead'),
                total: document.querySelector('[data-testid="timecode"]')?.getAttribute('data-total'),
                clips: document.querySelectorAll('[data-testid="clip"]').length,
                focused: document.activeElement?.outerHTML.slice(0, 200),
                dialogs: document.querySelectorAll('[role="dialog"]').length,
                keys: (window as unknown as { keyLog?: string[] }).keyLog
              }))
            )
          )
          throw err
        })
      await page.keyboard.press('s')
      await waitForClips(expected)
    }

    for (const expected of [4, 3, 2]) {
      await page.keyboard.press('Control+z')
      await waitForClips(expected)
    }
    expect(await clipLengths()).toEqual(start)
  })

  it('keeps going back past the clips being added, and comes forward again', async () => {
    const start = await clipLengths()
    expect(start).toHaveLength(2)

    // Undo is not limited to the current timeline: it walks back through
    // everything done since the project was created, including adding clips.
    await page.keyboard.press('Control+z')
    await waitForClips(1)
    await page.keyboard.press('Control+z')
    await waitForClips(0)

    // Undoing past the beginning does nothing rather than breaking.
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(250)
    expect(await clipCount()).toBe(0)

    await page.keyboard.press('Control+y')
    await waitForClips(1)
    await page.keyboard.press('Control+y')
    await waitForClips(2)
    expect(await clipLengths()).toEqual(start)
  })
})

describe('moving clips on V1', () => {
  beforeEach(resetTimeline)

  it('moves a clip along V1 when dragged, leaving a gap where it was', async () => {
    const box = await page.locator(CLIP).nth(1).boundingBox()
    expect(box).not.toBeNull()
    // 40 pixels at 0.4 per frame is 100 frames.
    await dragBy(box!.x + box!.width / 2, box!.y + CLIP_BODY_Y, 40, true)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]')[1]?.getAttribute('data-start') === '220', undefined, {
      timeout: 5000
    })
    expect(await clipStarts()).toEqual([0, 220])
    expect(await totalFrames()).toBe(310)
  })

  it('covers what it lands on', async () => {
    const before = await mediaOrder()
    const box = await page.locator(CLIP).nth(1).boundingBox()
    // Back 60 frames, over the last 60 of the first clip.
    await dragBy(box!.x + box!.width / 2, box!.y + CLIP_BODY_Y, -24, true)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]')[1]?.getAttribute('data-start') === '60', undefined, {
      timeout: 5000
    })
    expect(await clipLengths()).toEqual([60, 90])
    expect(await mediaOrder()).toEqual(before)
  })

  it('stays where it is when only nudged', async () => {
    const before = await clipStarts()
    const box = await page.locator(CLIP).first().boundingBox()
    await dragBy(box!.x + box!.width / 2, box!.y + CLIP_BODY_Y, 3)
    await page.waitForTimeout(300)
    expect(await clipStarts()).toEqual(before)
  })
})

async function cropRect(): Promise<{ x: number; y: number; w: number; h: number }> {
  const raw = (await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')) ?? '0,0,0,0'
  const [x, y, w, h] = raw.split(',').map(Number)
  return { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 }
}

describe('the monitor', () => {
  beforeEach(resetTimeline)

  it('shows a picture when a clip is under the playhead', async () => {
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-has-picture')).toBe('yes')
  })

  it('shows nothing past the end of the timeline', async () => {
    await page.keyboard.press('End')
    await page.waitForTimeout(200)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-has-picture')).toBe('no')
  })

  it('switches between the source and the cropped output', async () => {
    // One view at a time, rather than both side by side as a vertical sequence starts.
    await page.locator('[data-testid="side-by-side"]').click()
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="no"]')
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('source')
    await page.locator('[data-testid="view-program"]').click()
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('program')
    // The crop rectangle is a source view tool; it has no place over the output.
    expect(await page.locator('[data-testid="crop-rect"]').count()).toBe(0)
    await page.locator('[data-testid="view-source"]').click()
    expect(await page.locator('[data-testid="crop-rect"]').count()).toBe(1)
    await page.locator('[data-testid="side-by-side"]').click()
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]')
  })

  it('keeps the crop rectangle on the Source side when both views are side by side', async () => {
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]')
    expect(await page.locator('[data-testid="monitor-side"][data-side="source"] [data-testid="crop-rect"]').count()).toBe(1)
    expect(await page.locator('[data-testid="monitor-side"][data-side="program"] [data-testid="crop-rect"]').count()).toBe(0)
  })
})

describe('playback', () => {
  beforeEach(resetTimeline)

  it('advances the playhead when space is pressed, and stops on the second press', async () => {
    expect(await playhead()).toBe(0)
    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 5,
      undefined,
      { timeout: 10_000 }
    )
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('yes')

    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const stopped = await playhead()
    await page.waitForTimeout(500)
    expect(await playhead()).toBe(stopped)
  })

  it('runs through a cut rather than stopping at it', async () => {
    // The first clip is 4 seconds, so four one-second jumps land exactly on the
    // cut. Step back one frame to start just before it.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
    expect(await playhead()).toBe(120)
    await page.keyboard.press('ArrowLeft')
    expect(await playhead()).toBe(119)

    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 125,
      undefined,
      { timeout: 15_000 }
    )
    await page.keyboard.press('Space')
  })

  it('stops when an arrow key is pressed', async () => {
    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 3,
      undefined,
      { timeout: 10_000 }
    )
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('no')
    const stopped = await playhead()
    await page.waitForTimeout(400)
    expect(await playhead()).toBe(stopped)
  })
})

describe('cropping', () => {
  beforeEach(async () => {
    await resetTimeline()
    await selectFirstClip()
    await page.locator('[data-testid="crop-reset"]').click()
    await page.waitForTimeout(200)
  })

  it('resets to the largest rectangle of the output shape', async () => {
    const crop = await cropRect()
    // The clean fixture is 640x360 and the output is 9:16.
    expect(crop.h).toBe(360)
    expect(crop.w / crop.h).toBeCloseTo(1080 / 1920, 2)
    expect(crop.x).toBeGreaterThan(0)
  })

  it('moves when the rectangle is dragged', async () => {
    const before = await cropRect()
    const box = await page.locator('[data-testid="crop-rect"]').boundingBox()
    expect(box).not.toBeNull()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -60)
    await page.waitForTimeout(200)

    const after = await cropRect()
    expect(after.x).toBeLessThan(before.x)
    expect(after.w).toBe(before.w)
    expect(after.h).toBe(before.h)
  })

  it('never leaves the frame', async () => {
    const box = await page.locator('[data-testid="crop-rect"]').boundingBox()
    await dragBy(box!.x + box!.width / 2, box!.y + box!.height / 2, -4000)
    await page.waitForTimeout(200)
    expect((await cropRect()).x).toBe(0)
  })

  it('keeps the output shape when a corner is dragged with the lock on', async () => {
    expect(await page.isChecked('[data-testid="aspect-lock"]')).toBe(true)
    const handle = await page.locator('[data-testid="crop-se"]').boundingBox()
    expect(handle).not.toBeNull()
    await dragBy(handle!.x + 6, handle!.y + 6, -40)
    await page.waitForTimeout(200)

    const after = await cropRect()
    expect(after.w / after.h).toBeCloseTo(1080 / 1920, 1)
  })

  it('lets the shape go when the lock is off', async () => {
    await page.locator('[data-testid="aspect-lock"]').uncheck()
    const before = await cropRect()
    const handle = await page.locator('[data-testid="crop-se"]').boundingBox()
    await dragBy(handle!.x + 6, handle!.y + 6, -60)
    await page.waitForTimeout(200)

    const after = await cropRect()
    expect(after.w).toBeLessThan(before.w)
    expect(after.h).toBe(before.h)
    await page.locator('[data-testid="aspect-lock"]').check()
  })

  it('survives moving to another clip and back', async () => {
    const before = await cropRect()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)
    expect(await cropRect()).not.toEqual(before)

    await page.keyboard.press('Home')
    await page.waitForTimeout(200)
    expect(await cropRect()).toEqual(before)
  })

  it('is remembered in the document, not just on screen', async () => {
    const shown = await cropRect()
    const stored = await page.evaluate(async () => {
      const p = await window.api.currentProject()
      const c = p.sequences[0]?.videoTracks[0]?.clips[0]?.transform.crop
      return c ? `${c.x},${c.y},${c.w},${c.h}` : ''
    })
    expect(stored).toBe(`${shown.x},${shown.y},${shown.w},${shown.h}`)
  })
})

describe('exporting', () => {
  beforeEach(resetTimeline)

  it('starts with a folder to export to, so it is never refused for want of one', async () => {
    await openExport(page)
    // The default arrives from main a moment after the dialog opens.
    await page.waitForFunction(() => {
      const title = document.querySelector('[data-testid="export-folder"]')?.getAttribute('title')
      return !!title && title !== 'Choose a folder'
    })
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
  })

  it('offers the shapes and hides the join option for the handoff preset', async () => {
    // The shape is a project edit now, so it lands after an IPC round trip.
    await page.selectOption('[data-testid="export-preset"]', 'handoff')
    await openExport(page)
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="export-mode"]') as HTMLSelectElement | null)?.disabled === true,
      undefined,
      { timeout: 5000 }
    )
    expect(await page.inputValue('[data-testid="export-mode"]')).toBe('batch')
    await closeExport(page)

    await page.selectOption('[data-testid="export-preset"]', 'vertical')
    await openExport(page)
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="export-mode"]') as HTMLSelectElement | null)?.disabled === false,
      undefined,
      { timeout: 5000 }
    )
  })

  it('shows the filename pattern only when it is used', async () => {
    await openExport(page)
    await page.selectOption('[data-testid="export-mode"]', 'join')
    expect(await page.locator('[data-testid="export-pattern"]').count()).toBe(0)
    await page.selectOption('[data-testid="export-mode"]', 'batch')
    expect(await page.locator('[data-testid="export-pattern"]').count()).toBe(1)
  })

  it('renders a real file, reaching full progress', async () => {
    // A native folder dialog cannot be clicked, so answer it from the main
    // process. Everything after this is the real path: the real IPC handler,
    // the real plan and the real ffmpeg.
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, exportDir)

    await page.selectOption('[data-testid="export-preset"]', 'vertical')
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.selectOption('[data-testid="export-mode"]', 'join')
    // Enabled once main has said what it would write.
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)

    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
    expect(await page.getAttribute('[data-testid="export-done"]', 'data-count')).toBe('1')
    expect(await page.locator('[data-testid="export-error"]').count()).toBe(0)
  })
})

async function shapeOf(): Promise<number> {
  const c = await cropRect()
  return c.w / c.h
}

describe('the output shape', () => {
  beforeEach(resetTimeline)

  it('starts a new clip cropped to the shape, not the whole frame', async () => {
    // The first fixture is 640x360 landscape; the project starts vertical.
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')
    expect(await shapeOf()).toBeCloseTo(1080 / 1920, 1)
  })

  it('opens its list inside the window, where a window capture records it, and works it by mouse and by keys', async () => {
    // A press opens the app's own list, not the one Windows draws in a window of its own.
    await page.locator('[data-testid="export-preset"]').click()
    const list = page.locator('[data-testid="select-list"][data-for="export-preset"]')
    await list.waitFor({ timeout: 5000 })
    // Drawn in the window, under the box, with the shape in use ticked.
    const box = (await page.locator('[data-testid="export-preset"]').boundingBox())!
    const at = (await list.boundingBox())!
    expect(at.y).toBeGreaterThanOrEqual(box.y + box.height - 1)
    expect(await list.locator('[data-value="vertical"]').getAttribute('aria-selected')).toBe('true')
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? tmpdir(), 'select-list.png') })
    // Escape closes it and changes nothing.
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached', timeout: 5000 })
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')

    // A click on a choice takes it.
    await page.locator('[data-testid="export-preset"]').click()
    await list.locator('[data-value="square"]').click()
    await list.waitFor({ state: 'detached', timeout: 5000 })
    await expect.poll(() => page.inputValue('[data-testid="export-preset"]'), { timeout: 5000 }).toBe('square')

    // From the keyboard: Space opens it, the arrows move, Enter takes it, and Space never plays meanwhile.
    await page.locator('[data-testid="export-preset"]').focus()
    await page.keyboard.press('Space')
    await list.waitFor({ timeout: 5000 })
    const active = async (): Promise<string | null> => list.locator('[data-active="yes"]').getAttribute('data-value')
    expect(await active()).toBe('square')
    await page.keyboard.press('ArrowUp')
    const up = await active()
    expect(up).not.toBe('square')
    await page.keyboard.press('Enter')
    await list.waitFor({ state: 'detached', timeout: 5000 })
    await expect.poll(() => page.inputValue('[data-testid="export-preset"]'), { timeout: 5000 }).toBe(up)
    expect(await page.getAttribute('[data-testid="play"]', 'data-playing').catch(() => null)).not.toBe('yes')

    // A press outside closes it.
    await page.locator('[data-testid="export-preset"]').click()
    await list.waitFor({ timeout: 5000 })
    await page.mouse.click(5, 5)
    await list.waitFor({ state: 'detached', timeout: 5000 })
    await page.selectOption('[data-testid="export-preset"]', 'vertical')
  })

  it('reshapes the crop box when the export shape changes', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForFunction(() => {
      const raw = document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') ?? ''
      const [, , w, h] = raw.split(',').map(Number)
      return w !== undefined && h !== undefined && h > 0 && Math.abs(w / h - 1) < 0.05
    }, undefined, { timeout: 5000 })
    expect(await shapeOf()).toBeCloseTo(1, 1)

    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.waitForTimeout(300)
    expect(await shapeOf()).toBeCloseTo(16 / 9, 1)
  })

  it('makes Reset crop follow the chosen shape', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForTimeout(300)
    await selectFirstClip()
    // Knock the crop off shape, then reset it.
    await page.locator('[data-testid="aspect-lock"]').uncheck()
    const handle = await page.locator('[data-testid="crop-se"]').boundingBox()
    await dragBy(handle!.x + 6, handle!.y + 6, -60)
    await page.waitForTimeout(200)
    expect(await shapeOf()).not.toBeCloseTo(1, 1)

    await page.locator('[data-testid="crop-reset"]').click()
    await page.waitForTimeout(300)
    expect(await shapeOf()).toBeCloseTo(1, 1)
    await page.locator('[data-testid="aspect-lock"]').check()
  })

  it('reshapes every clip, not just the one on screen', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForTimeout(300)
    const crops = await page.evaluate(async () => {
      const p = await window.api.currentProject()
      return (p.sequences[0]?.videoTracks[0]?.clips ?? []).map((c) => c.transform.crop.w / c.transform.crop.h)
    })
    expect(crops).toHaveLength(2)
    for (const aspect of crops) expect(aspect).toBeCloseTo(1, 1)
  })

  it('can be undone in one step, putting every crop back', async () => {
    const before = await shapeOf()
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForTimeout(300)
    expect(await shapeOf()).toBeCloseTo(1, 1)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    expect(await shapeOf()).toBeCloseTo(before, 2)
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')
  })

  it('turns the lock off for the handoff preset, which has no fixed shape', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'handoff')
    await page.waitForTimeout(300)
    // The lock sits in the Inspector's Crop group, so a clip has to be chosen for it to be there at all.
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    expect(await page.isDisabled('[data-testid="aspect-lock"]')).toBe(true)
  })
})

describe('markers', () => {
  beforeEach(resetTimeline)

  /** Every marker of the sequence, by frame, as the project holds them. */
  const markers = (): Promise<{ frame: number; name: string }[]> =>
    page.evaluate(async () =>
      (await window.api.currentProject()).sequences[0]!.markers.map((m) => ({ frame: m.frame, name: m.name }))
    )

  it('drops one at the playhead with M, and draws a flag for it', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('m')
    await expect.poll(markers).toEqual([{ frame: 0, name: '' }])

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    // Polled, not read once: the edit goes to main and comes back, so a read
    // taken in the same breath as the keypress sometimes sees one marker.
    await expect.poll(async () => (await markers()).length).toBe(2)
    const two = await markers()
    expect(two[1]!.frame).toBeGreaterThan(0)
    await expect.poll(() => page.locator('[data-testid="marker"]').count()).toBe(2)
  })

  it('leaves a frame that already has one alone', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('m')
    await expect.poll(async () => (await markers()).length).toBe(1)
    await page.keyboard.press('m')
    await page.waitForTimeout(200)
    expect(await markers()).toHaveLength(1)
  })

  it('jumps to the next and previous marker, and stands still when there is none', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    const first = await playhead()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    const second = await playhead()
    await expect.poll(async () => (await markers()).length).toBe(2)

    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(playhead).toBe(first)
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(playhead).toBe(second)
    // Past the last one there is nowhere to go, and it stays rather than jumping to the end.
    await page.keyboard.press('Shift+ArrowDown')
    await page.waitForTimeout(150)
    expect(await playhead()).toBe(second)

    await page.keyboard.press('Shift+ArrowUp')
    await expect.poll(playhead).toBe(first)
    await page.keyboard.press('Shift+ArrowUp')
    await page.waitForTimeout(150)
    expect(await playhead()).toBe(first)
  })

  it('takes the playhead to a marker whose flag is pressed, without scrubbing the ruler', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    const at = await playhead()
    await page.keyboard.press('Home')
    await expect.poll(playhead).toBe(0)

    await page.locator('[data-testid="marker"]').first().click()
    await expect.poll(playhead).toBe(at)
  })

  it('is named from its menu, and the name sticks', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    await expect.poll(async () => (await markers()).length).toBe(1)

    const flag = page.locator('[data-testid="marker"]').first()
    const box = (await flag.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="marker-menu"]')
    await page.click('[data-testid="marker-menu-rename"]')

    await page.fill('[data-testid="marker-rename"]', 'the good bit')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await markers())[0]!.name).toBe('the good bit')
    await expect.poll(() => page.locator('[data-testid="marker-name"]').count()).toBe(1)
  })

  it('takes a colour, and gives it back', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('m')
    await expect.poll(async () => (await markers()).length).toBe(1)
    const colour = (): Promise<string | undefined> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.markers[0]!.colour)

    const flag = page.locator('[data-testid="marker"]').first()
    let box = (await flag.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="marker-menu"]')
    await page.click('[data-testid="marker-menu"] [data-testid="mark-amber"]')
    await expect.poll(colour).toBe('amber')

    box = (await flag.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="marker-menu"]')
    await page.click('[data-testid="marker-menu"] [data-testid="mark-none"]')
    await expect.poll(colour).toBeUndefined()
  })

  it('is dragged along the ruler, in one undo step, and removed from its menu', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('m')
    await expect.poll(async () => (await markers()).length).toBe(1)
    const was = (await markers())[0]!.frame

    const box = (await page.locator('[data-testid="marker"]').first().boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 2 + i * 16, y)
    await page.mouse.up()
    await expect.poll(async () => (await markers())[0]!.frame).toBeGreaterThan(was)

    // One drag, one undo.
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await markers())[0]!.frame).toBe(was)
    // And the ruler shows it back there, which is where it is pressed next.
    await expect.poll(() => page.getAttribute('[data-testid="marker"]', 'data-frame')).toBe(String(was))

    const at = (await page.locator('[data-testid="marker"]').first().boundingBox())!
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="marker-menu"]')
    await page.click('[data-testid="marker-menu-remove"]')
    await expect.poll(async () => (await markers()).length).toBe(0)
  })

  it('undoes, like any other edit', async () => {
    await page.keyboard.press('Home')
    await page.keyboard.press('m')
    await expect.poll(async () => (await markers()).length).toBe(1)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await markers()).length).toBe(0)
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await markers()).length).toBe(1)
  })
})

describe('scrubbing', () => {
  beforeEach(resetTimeline)

  it('has a time bar tall enough to be an obvious target', async () => {
    const box = await page.locator('[data-testid="ruler"]').boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(32)
  })

  it('moves the playhead when the time bar is dragged', async () => {
    const box = await page.locator('[data-testid="ruler"]').boundingBox()
    await page.mouse.move(box!.x + 10, box!.y + box!.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(box!.x + 10 + i * 20, box!.y + box!.height / 2)
    const during = await playhead()
    await page.mouse.up()
    expect(during).toBeGreaterThan(0)
  })

  it('hears the sound under the playhead while it is dragged, and leaves nothing playing', async () => {
    /** Whether any player in the preview is running: a paused one plays no sound. */
    const sounding = (): Promise<boolean> =>
      page.evaluate(() =>
        [...document.querySelectorAll('video, audio')].some((el) => !(el as HTMLMediaElement).paused)
      )
    // A burst is under a tenth of a second, which is shorter than the round
    // trip to ask whether one is playing. Listened for in the page instead, so
    // the answer is whether one ever started rather than whether one happened
    // to still be going when it was asked.
    await page.evaluate(() => {
      const w = window as unknown as { heardWhileDragging: boolean }
      w.heardWhileDragging = false
      for (const el of document.querySelectorAll('video, audio')) {
        el.addEventListener('play', () => (w.heardWhileDragging = true))
      }
    })
    const heard = (): Promise<boolean> =>
      page.evaluate(() => (window as unknown as { heardWhileDragging: boolean }).heardWhileDragging)

    const box = (await page.locator('[data-testid="ruler"]').boundingBox())!
    const y = box.y + box.height / 2
    expect(await sounding()).toBe(false)
    expect(await heard()).toBe(false)

    await page.mouse.move(box.x + 20, y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 20 + i * 20, y)
    const during = await playhead()
    expect(await heard()).toBe(true)
    await page.mouse.up()

    // Letting go stops it, and leaves the playhead exactly where the drag put it.
    await expect.poll(sounding, { timeout: 5_000 }).toBe(false)
    expect(await playhead()).toBe(during)
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('no')
  })

  it('shows a playhead handle that follows the playhead', async () => {
    const head = page.locator('[data-testid="playhead-head"]')
    const at0 = (await head.boundingBox())!.x
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(150)
    const at30 = (await head.boundingBox())!.x
    expect(at30).toBeGreaterThan(at0)
  })

  it('shows where a click would land while hovering', async () => {
    const box = await page.locator('[data-testid="ruler"]').boundingBox()
    await page.mouse.move(box!.x + 80, box!.y + box!.height / 2)
    await page.waitForTimeout(100)
    expect(await page.locator('[data-testid="ruler-hover"]').count()).toBe(1)
    await page.mouse.move(box!.x + 80, box!.y - 40)
    await page.waitForTimeout(100)
    expect(await page.locator('[data-testid="ruler-hover"]').count()).toBe(0)
  })

  it('moves the playhead when empty track is clicked', async () => {
    const lastClip = await page.locator(CLIP).last().boundingBox()
    // Just past the end of the last clip, on empty track.
    await page.mouse.click(lastClip!.x + lastClip!.width + 30, lastClip!.y + 30)
    expect(await playhead()).toBe(await totalFrames())
  })
})

async function openShortcuts(): Promise<void> {
  await page.locator('[data-testid="open-shortcuts"]').click()
  await page.waitForSelector('[data-testid="shortcuts-dialog"]')
}

async function closeShortcuts(): Promise<void> {
  await page.locator('[data-testid="shortcuts-close"]').click()
  await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
}

async function combosOf(actionId: string): Promise<string[]> {
  const raw = (await page.getAttribute(`[data-testid="shortcut-${actionId}"]`, 'data-combos')) ?? ''
  return raw.split(' ').filter(Boolean)
}

/** Put every shortcut back, so no test leaks a binding into the next. */
async function resetAllShortcuts(): Promise<void> {
  await openShortcuts()
  if (!(await page.isDisabled('[data-testid="shortcuts-reset-all"]'))) {
    await page.locator('[data-testid="shortcuts-reset-all"]').click()
  }
  await closeShortcuts()
}

async function waitForCombo(actionId: string, combo: string): Promise<void> {
  await page.waitForFunction(
    ([id, c]) =>
      (document.querySelector(`[data-testid="shortcut-${id}"]`)?.getAttribute('data-combos') ?? '')
        .split(' ')
        .includes(c as string),
    [actionId, combo],
    { timeout: 5000 }
  )
}

describe('custom shortcuts', () => {
  beforeEach(resetTimeline)
  afterEach(resetAllShortcuts)

  it('opens from its button and from Ctrl+/', async () => {
    await openShortcuts()
    await closeShortcuts()
    await page.keyboard.press('Control+Slash')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
  })

  it('lists every action with its current key', async () => {
    await openShortcuts()
    expect(await combosOf('split')).toEqual(['KeyS'])
    expect(await combosOf('playPause')).toEqual(['Space'])
    expect(await combosOf('deleteClip')).toEqual(['Delete', 'Backspace'])
    await closeShortcuts()
  })

  it('makes a newly added key do the action', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.waitForSelector('[data-testid="shortcut-recording"]')
    await page.keyboard.press('KeyX')
    await waitForCombo('split', 'KeyX')
    expect(await combosOf('split')).toEqual(['KeyS', 'KeyX'])
    await closeShortcuts()

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('KeyX')
    await waitForClips(3)
  })

  it('takes a modifier combination for an action that already has a plain key', async () => {
    // Entry 5 on the bug list said an action with a single key would not take a
    // combination. It does, and this is what holds that: Play or pause keeps
    // Space and gains Shift+Q, and the combination then does the action.
    await openShortcuts()
    expect(await combosOf('playPause')).toEqual(['Space'])
    await page.locator('[data-testid="shortcut-add-playPause"]').click()
    await page.waitForSelector('[data-testid="shortcut-recording"]')
    await page.keyboard.press('Shift+KeyQ')
    await waitForCombo('playPause', 'Shift+KeyQ')
    expect(await combosOf('playPause')).toEqual(['Space', 'Shift+KeyQ'])

    // Three and four key combinations too, and on the same action.
    await page.locator('[data-testid="shortcut-add-playPause"]').click()
    await page.waitForSelector('[data-testid="shortcut-recording"]')
    await page.keyboard.press('Control+Alt+Shift+KeyQ')
    await waitForCombo('playPause', 'Ctrl+Alt+Shift+KeyQ')
    await closeShortcuts()

    await page.keyboard.press('Shift+KeyQ')
    await expect
      .poll(() => page.getAttribute('[data-testid="play-pause"]', 'data-playing'), { timeout: 10_000 })
      .toBe('yes')
    await page.keyboard.press('Shift+KeyQ')
    await expect
      .poll(() => page.getAttribute('[data-testid="play-pause"]', 'data-playing'), { timeout: 10_000 })
      .toBe('no')

    await openShortcuts()
    await page.locator('[data-testid="shortcuts-reset-all"]').click()
    await closeShortcuts()
  })

  it('stops a removed key from doing anything', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-remove-split-KeyS"]').click()
    expect(await combosOf('split')).toEqual([])
    await closeShortcuts()

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('KeyS')
    await page.waitForTimeout(300)
    expect(await clipCount()).toBe(2)
  })

  it('asks before taking a key from another action, and leaves it if you give up', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.keyboard.press('Space')
    await page.waitForSelector('[data-testid="shortcuts-conflict"]')
    // Recording took Space for itself: it must not also have started playback.
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('no')

    // Asked on the row being recorded, not in a bar somewhere else in the window.
    const row = (await page.locator('[data-testid="shortcut-split"]').boundingBox())!
    const asked = (await page.locator('[data-testid="shortcuts-conflict"]').boundingBox())!
    expect(asked.y).toBeGreaterThanOrEqual(row.y - 2)
    expect(asked.y + asked.height).toBeLessThanOrEqual(row.y + row.height + 2)

    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="shortcuts-conflict"]', { state: 'detached' })
    expect(await combosOf('split')).toEqual(['KeyS'])
    expect(await combosOf('playPause')).toEqual(['Space'])
    await closeShortcuts()
  })

  it('goes on listening while it asks, so another key can be tried instead', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.keyboard.press('Space')
    await page.waitForSelector('[data-testid="shortcuts-conflict"]')

    // A free combination pressed while the question is up is simply taken.
    await page.keyboard.press('Control+Alt+KeyQ')
    await waitForCombo('split', 'Ctrl+Alt+KeyQ')
    expect(await combosOf('split')).toEqual(['KeyS', 'Ctrl+Alt+KeyQ'])
    expect(await combosOf('playPause')).toEqual(['Space'])
    expect(await page.locator('[data-testid="shortcuts-conflict"]').count()).toBe(0)

    await page.locator('[data-testid="shortcuts-reset-all"]').click()
    await closeShortcuts()
  })

  it('moves the key when Enter answers the question', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.keyboard.press('Space')
    await page.waitForSelector('[data-testid="shortcuts-conflict"]')
    await page.keyboard.press('Enter')
    await waitForCombo('split', 'Space')
    expect(await combosOf('playPause')).not.toContain('Space')

    await page.locator('[data-testid="shortcuts-reset-all"]').click()
    await closeShortcuts()
  })

  it('moves the key when you say yes, so it means one thing', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.keyboard.press('Space')
    await page.waitForSelector('[data-testid="shortcuts-conflict"]')
    await page.locator('[data-testid="shortcuts-conflict-move"]').click()
    await waitForCombo('split', 'Space')
    expect(await combosOf('playPause')).not.toContain('Space')
    await closeShortcuts()

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Space')
    await waitForClips(3)
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('no')
  })

  it('puts a changed action back with Reset', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-remove-split-KeyS"]').click()
    expect(await combosOf('split')).toEqual([])
    await page.locator('[data-testid="shortcut-reset-split"]').click()
    expect(await combosOf('split')).toEqual(['KeyS'])
    expect(await page.isDisabled('[data-testid="shortcut-reset-split"]')).toBe(true)
    await closeShortcuts()
  })

  it('saves your changes to disk', async () => {
    await openShortcuts()
    await page.locator('[data-testid="shortcut-add-split"]').click()
    await page.keyboard.press('KeyX')
    await waitForCombo('split', 'KeyX')
    await page.waitForTimeout(300)
    await closeShortcuts()

    const saved = await page.evaluate(() => window.api.loadKeymap())
    expect(saved.split).toEqual(['KeyS', 'KeyX'])
  })

  it('works whatever keyboard layout is active', async () => {
    // What a Georgian layout sends for the S key: the physical key is KeyS, but
    // the character typed is a Georgian letter. Matching on the character, as
    // the app used to, meant S silently stopped splitting.
    await page.keyboard.press('Shift+ArrowRight')
    await page.evaluate((character) => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: character, code: 'KeyS', bubbles: true, cancelable: true })
      )
    }, 'ს')
    await waitForClips(3)
  })

  it('trims the clip under the playhead with I and O', async () => {
    // The first clip is 120 frames. One second in, I cuts the first 30 off.
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('KeyI')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames') === '90',
      undefined,
      { timeout: 5000 }
    )
    // The clip still starts at zero and now opens on the frame that was under
    // the playhead, so the playhead is parked there.
    expect(await playhead()).toBe(0)
    // It looks just as it did, so it says what it took.
    await page.waitForSelector('[data-testid="toast"]:has-text("Trimmed 1.0 s off the start of this clip")', { timeout: 5000 })
    // Parked on the clip's first frame, I has nothing to take, and says so rather than doing nothing.
    await page.keyboard.press('KeyI')
    await page.waitForSelector('[data-testid="toast"]:has-text("nothing before it to trim")', { timeout: 5000 })
    expect(await page.getAttribute('[data-testid="clip"] >> nth=0', 'data-length-frames')).toBe('90')

    // Another second in, O ends the clip there.
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('KeyO')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames') === '30',
      undefined,
      { timeout: 5000 }
    )
  })

  it('zooms the timeline with = and -', async () => {
    const before = Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom'))
    await page.keyboard.press('Equal')
    expect(Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom'))).toBe(before + 1)
    await page.keyboard.press('Minus')
    expect(Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom'))).toBe(before)
  })

  it('switches between the source and the output with V', async () => {
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('source')
    await page.keyboard.press('KeyV')
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('program')
    await page.keyboard.press('KeyV')
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('source')
  })

  it('leaves typing alone, so a shortcut never eats a letter in a text box', async () => {
    // A second sequence, so there are tabs with names to type into.
    await page.click('[data-testid="sequence-duplicate"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 2)
    await page.locator('[data-testid="sequence-tab"]').first().dblclick()
    const box = page.locator('[data-testid="sequence-name-input"]')
    await box.fill('')
    await box.pressSequentially('sv')
    expect(await box.inputValue()).toBe('sv')
    // S did not split and V did not switch the view while typing.
    expect(await clipCount()).toBe(2)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('source')
    // Escape abandons the rename rather than reaching the editor.
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="sequence-name-input"]', { state: 'detached' })
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 0)
  })
})
