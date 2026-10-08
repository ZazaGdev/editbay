import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Plan 60, stages 2 and 3: zoom with keyframes from the Inspector's Zoom
 * group, the diamonds on the timeline, the keys, the presets and the eases.
 *
 * The owner's Check, scripted: a talking head clip, no split. Playhead to
 * 2 s, press the diamond; to 2.5 s, Scale 130; to 4 s, press the diamond;
 * to 4.5 s, Scale 100. The preview at 3 s is zoomed and at 5 s is not, the
 * clip shows four diamonds, and an export shows the same two frames.
 *
 * The clip is black with a green box over its middle half, in a vertical
 * frame: a fifth of the way down the frame is black at 100%, and green once
 * the picture is 130% in, since the box then reaches further up.
 */

const fx = fixtureSet('ui-zoom')
const root = await mkdtemp(join(tmpdir(), 'editbay-zoom-'))
const exportDir = join(root, 'out')
let app: ElectronApplication
let page: Page
let targetPath: string
let shot = 0
const WAIT = { timeout: 15_000 }
/** Where down the frame the zoom is read: black at 100%, green at 130%. */
const PROBE = { x: 0.5, y: 0.22 }

beforeAll(async () => {
  targetPath = await fx.targetClip()
  await mkdir(exportDir, { recursive: true })
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, exportDir)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Colour = 'green' | 'black' | 'other'

function colourOf(r: number, g: number, b: number): Colour {
  if (g > 70 && r < 60 && b < 60) return 'green'
  if (r < 40 && g < 40 && b < 40) return 'black'
  return 'other'
}

/**
 * A new project with the target clip on V1, selected, the whole edit on
 * screen, in the Output view, and the Zoom group on Keyframes unless asked
 * for Simple, where a new clip starts.
 */
async function fresh(mode: 'simple' | 'keys' = 'keys'): Promise<void> {
  await closeExport(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), targetPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.waitForSelector('[data-testid="zoom-group"]')
  await page.keyboard.press('Shift+F')
  if ((await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')) !== 'program') await page.click('[data-testid="view-program"]')
  expect(await page.getAttribute('[data-testid="zoom-group"]', 'data-mode')).toBe('simple')
  if (mode === 'keys') {
    await page.click('[data-testid="zoom-mode-keys"]')
    await page.waitForSelector('[data-testid="zoom-group"][data-mode="keys"]')
  }
}

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

/** The playhead to a frame, with the keys: Home, a second at a time, then a frame at a time. */
async function goTo(frame: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Home')
  for (let i = 0; i < Math.floor(frame / 30); i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < frame % 30; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(playhead, WAIT).toBe(frame)
}

async function typeInto(testid: string, value: string): Promise<void> {
  const box = page.locator(`[data-testid="${testid}"]`)
  await box.fill(value)
  await box.press('Enter')
}

async function keys(): Promise<{ at: number; crop: { x: number; y: number; w: number; h: number }; ease?: string }[]> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.transform.keys ?? [])
}

/** The colour at a point of the output frame, as the Output view draws it now. */
async function previewColour(fx0: number, fy0: number): Promise<Colour> {
  // With both views side by side, the Output view's own side of the monitor.
  const side = page.locator('[data-testid="monitor-side"][data-focused="yes"]')
  const stage = (await side.count()) > 0 ? side : page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  if (process.env.KEEP_SHOTS) await writeFile(join(process.env.KEEP_SHOTS, `zoom-${shot}.png`), await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const m = String(probe).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(1080, 1920, box.width, box.height)
  const x = Math.round((fit.offsetX + fx0 * fit.width) * scale)
  const y = Math.round((fit.offsetY + fy0 * fit.height) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return colourOf(stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0)
}

/** The colour at a point of an exported file's frame at `sec`. */
async function exportedColour(file: string, sec: number, fx0: number, fy0: number): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', String(sec), '-i', file, '-frames:v', '1',
    '-vf', `crop=1:1:${Math.round(fx0 * 1080)}:${Math.round(fy0 * 1920)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  return colourOf(stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0)
}

/** How far down the middle of a frame the green box starts, as a share of its height. */
function greenTop(rgb: Buffer): number {
  const rows = rgb.length / 3
  for (let i = 0; i < rows; i++) if (colourOf(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!) === 'green') return i / rows
  return 1
}

/** Where the green box starts down the middle of the output frame, as the Output view draws it now. */
async function previewGreenTop(): Promise<number> {
  const side = page.locator('[data-testid="monitor-side"][data-focused="yes"]')
  const stage = (await side.count()) > 0 ? side : page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const m = String(probe).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(1080, 1920, box.width, box.height)
  const x = Math.round((fit.offsetX + 0.5 * fit.width) * scale)
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-i', file,
    '-vf', `crop=1:${Math.round(fit.height * scale)}:${x}:${Math.round(fit.offsetY * scale)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  return greenTop(stdout)
}

/** Where the green box starts down the middle of an exported file's frame at `sec`. */
async function exportedGreenTop(file: string, sec: number): Promise<number> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', String(sec), '-i', file, '-frames:v', '1', '-vf', 'crop=1:1920:540:0,format=rgb24', '-f', 'rawvideo', 'pipe:1'
  ])
  return greenTop(stdout)
}

describe('the Zoom group', () => {
  it('moves smoothly from one keyframe to the next a second later, in the preview and the export, and jumps only when told to (task 97)', async () => {
    await fresh()
    await goTo(60)
    await page.click('[data-testid="zoom-key"]')
    await goTo(90)
    await typeInto('zoom-scale', '130')
    await expect.poll(async () => (await keys()).map((k) => [k.at, k.ease ?? 'smooth']), WAIT).toEqual([[60, 'smooth'], [90, 'smooth']])

    // Half way, the box's edge is half way between where it is on either keyframe.
    const tops: number[] = []
    for (const f of [60, 75, 90]) {
      await goTo(f)
      await page.waitForTimeout(300)
      tops.push(await previewGreenTop())
    }
    expect(tops[2]!).toBeLessThan(tops[0]! - 0.03)
    expect(tops[1]!).toBeLessThan(tops[0]! - 0.01)
    expect(tops[1]!).toBeGreaterThan(tops[2]! + 0.01)

    // The way there is shown between the two, and Jump holds the first until the second.
    await goTo(75)
    await expect.poll(() => page.getAttribute('[data-testid="zoom-ease-row"]', 'data-ease'), WAIT).toBe('smooth')
    await page.selectOption('[data-testid="zoom-ease-select"]', 'hold')
    await expect.poll(async () => (await keys())[0]!.ease, WAIT).toBe('hold')
    await page.waitForTimeout(300)
    expect(Math.abs((await previewGreenTop()) - tops[0]!)).toBeLessThan(0.01)
    await page.selectOption('[data-testid="zoom-ease-select"]', 'smooth')
    await expect.poll(async () => (await keys())[0]!.ease ?? 'smooth', WAIT).toBe('smooth')

    // The export: the same move, a frame at 2 s, 2.5 s and 3 s.
    await rm(exportDir, { recursive: true, force: true })
    await mkdir(exportDir, { recursive: true })
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.selectOption('[data-testid="export-mode"]', 'join')
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
    await closeExport(page)
    const made = (await readdir(exportDir)).filter((f) => f.endsWith('.mp4'))
    expect(made).toHaveLength(1)
    const file = join(exportDir, made[0]!)
    const out = [await exportedGreenTop(file, 2), await exportedGreenTop(file, 2.5), await exportedGreenTop(file, 3)]
    expect(out[2]!).toBeLessThan(out[0]! - 0.03)
    expect(out[1]!).toBeLessThan(out[0]! - 0.01)
    expect(out[1]!).toBeGreaterThan(out[2]! + 0.01)
    await rm(exportDir, { recursive: true, force: true })
    await mkdir(exportDir, { recursive: true })
  }, 300_000)

  it('stands in for the old Move row, Start and End', async () => {
    await fresh()
    expect(await page.locator('[data-testid="zoom-section"]').count()).toBe(1)
    for (const gone of ['clip-move', 'move-cut', 'move-slow', 'move-none']) {
      expect(await page.locator(`[data-testid="${gone}"]`).count()).toBe(0)
    }
    expect(await page.locator('[data-testid="picture"][data-picture-id="zoom"]').count()).toBe(0)
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('100')
  })

  it("does the owner's Check: in at 2.5 s, out at 4.5 s, seen in the preview, on the timeline and in the export", async () => {
    await fresh()
    await goTo(60)
    await page.click('[data-testid="zoom-key"]')
    await expect.poll(async () => (await keys()).length, WAIT).toBe(1)
    await expect.poll(() => page.getAttribute('[data-testid="zoom-key"]', 'data-on'), WAIT).toBe('yes')

    await goTo(75)
    await expect.poll(() => page.getAttribute('[data-testid="zoom-key"]', 'data-on'), WAIT).toBe('no')
    await typeInto('zoom-scale', '130')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([60, 75])

    await goTo(120)
    // After the last keyframe the picture holds it: 130%, pinned here by the diamond.
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('130')
    await page.click('[data-testid="zoom-key"]')
    await expect.poll(async () => (await keys()).length, WAIT).toBe(3)

    await goTo(135)
    await typeInto('zoom-scale', '100')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([60, 75, 120, 135])
    const set = await keys()
    expect(set[1]!.crop.w).toBeLessThan(set[0]!.crop.w)
    expect(set[3]!.crop.w).toBe(set[0]!.crop.w)

    // Four diamonds on the clip, and four on the strip.
    await expect.poll(() => page.locator('[data-testid="clip-keyframe"]').count(), WAIT).toBe(4)
    expect(await page.locator('[data-testid="zoom-strip-key"]').count()).toBe(4)

    // The preview: zoomed at 3 s, not at 5 s.
    await goTo(90)
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('130')
    await expect.poll(() => previewColour(PROBE.x, PROBE.y), WAIT).toBe('green')
    await goTo(150)
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('100')
    await expect.poll(() => previewColour(PROBE.x, PROBE.y), WAIT).toBe('black')

    // The export: the same two frames.
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.selectOption('[data-testid="export-mode"]', 'join')
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
    await closeExport(page)
    const made = (await readdir(exportDir)).filter((f) => f.endsWith('.mp4'))
    expect(made).toHaveLength(1)
    const file = join(exportDir, made[0]!)
    expect(await exportedColour(file, 3, PROBE.x, PROBE.y)).toBe('green')
    expect(await exportedColour(file, 5, PROBE.x, PROBE.y)).toBe('black')
  }, 300_000)

  it('makes the Crop numbers and the crop box edit the keyframe at the playhead', async () => {
    await fresh()
    await goTo(30)
    await page.click('[data-testid="zoom-key"]')
    await expect.poll(async () => (await keys()).length, WAIT).toBe(1)
    await goTo(90)
    const before = (await keys())[0]!.crop
    await typeInto('crop-x', String(before.x - 40))
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 90])
    const [first, second] = await keys()
    expect(first!.crop).toEqual(before)
    expect(second!.crop.x).toBe(before.x - 40)
    // The crop box in the Source view shows the playhead's crop.
    await page.click('[data-testid="view-source"]')
    await expect
      .poll(() => page.getAttribute('[data-testid="crop-rect"]', 'data-crop'), WAIT)
      .toBe(`${second!.crop.x},${second!.crop.y},${second!.crop.w},${second!.crop.h}`)
    await page.click('[data-testid="view-program"]')
  })

  it('goes between keyframes with the arrows and the keys, and adds one with Alt+K', async () => {
    await fresh()
    await goTo(30)
    await page.keyboard.press('Alt+KeyK')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30])
    await goTo(90)
    await page.keyboard.press('Alt+KeyK')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 90])

    await goTo(60)
    await page.keyboard.press('Alt+BracketRight')
    await expect.poll(playhead, WAIT).toBe(90)
    expect(await page.isDisabled('[data-testid="zoom-next"]')).toBe(true)
    await page.click('[data-testid="zoom-previous"]')
    await expect.poll(playhead, WAIT).toBe(30)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Alt+BracketRight')
    await expect.poll(playhead, WAIT).toBe(90)
    await page.keyboard.press('Alt+BracketLeft')
    await expect.poll(playhead, WAIT).toBe(30)

    // Pressed again on a keyframe, it goes.
    await page.keyboard.press('Alt+KeyK')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([90])

    // A diamond on the timeline takes the playhead to it.
    await goTo(0)
    await page.locator('[data-testid="clip-keyframe"]').first().click()
    await expect.poll(playhead, WAIT).toBe(90)
  })
})

describe('the strip', () => {
  it('moves a keyframe dragged along it, gives it an ease from its menu, and takes it off with Delete', async () => {
    await fresh()
    await goTo(30)
    await page.click('[data-testid="zoom-key"]')
    await goTo(60)
    await typeInto('zoom-scale', '120')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 60])

    const strip = (await page.locator('[data-testid="zoom-strip"]').boundingBox())!
    const diamond = (await page.locator('[data-testid="zoom-strip-key"][data-at="60"]').boundingBox())!
    const x = diamond.x + diamond.width / 2
    const y = diamond.y + diamond.height / 2
    // To half way along the 210 frame clip: frame 105.
    const to = strip.x + strip.width * (105.5 / 210)
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + ((to - x) * i) / 6, y)
    await page.mouse.up()
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 105])
    await expect.poll(playhead, WAIT).toBe(105)

    // Its ease, in plain words, with Premiere's name in the tooltip.
    await page.locator('[data-testid="zoom-strip-key"][data-at="30"]').click({ button: 'right' })
    await page.waitForSelector('[data-testid="zoom-key-menu"]')
    const labels = (await page.locator('[data-testid="zoom-ease"]').allTextContents()).map((t) => t.replace(/✓/g, '').trim())
    expect(labels).toEqual(['Smooth', 'Steady', 'Starts slowly', 'Ends slowly', 'Jump'])
    expect(await page.getAttribute('[data-testid="zoom-ease"]:has-text("Steady")', 'title')).toContain('Premiere calls this Linear')
    await page.locator('[data-testid="zoom-ease"]:has-text("Jump")').click()
    await expect.poll(async () => (await keys())[0]!.ease, WAIT).toBe('hold')

    await page.locator('[data-testid="zoom-strip-key"][data-at="105"]').click()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30])
    // Delete took the keyframe, not the clip.
    expect(await page.locator('[data-testid="clip"]').count()).toBe(1)

    await page.locator('[data-testid="zoom-strip-key"][data-at="30"]').click({ button: 'right' })
    await page.locator('[data-testid="zoom-keys-clear"]').click()
    await expect.poll(async () => (await keys()).length, WAIT).toBe(0)
  })
})

describe('the diamonds on the clip (bugs and notes 2, note 15)', () => {
  it('move a keyframe dragged along the clip, and only go to one clicked', async () => {
    await fresh()
    await goTo(30)
    await page.click('[data-testid="zoom-key"]')
    await goTo(60)
    await typeInto('zoom-scale', '120')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 60])

    const clip = (await page.locator('[data-testid="clip"]').first().boundingBox())!
    const diamond = (await page.locator('[data-testid="clip-keyframe"][data-at="60"]').boundingBox())!
    const x = diamond.x + diamond.width / 2
    const y = diamond.y + diamond.height / 2
    // To half way along the 210 frame clip: frame 105.
    const to = clip.x + clip.width * (105.5 / 210)
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + ((to - x) * i) / 6, y)
    await page.mouse.up()
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 105])
    await expect.poll(playhead, WAIT).toBe(105)
    // The clip itself stayed where it was.
    expect((await page.locator('[data-testid="clip"]').first().boundingBox())!.x).toBe(clip.x)

    // A click without moving only goes there.
    await page.locator('[data-testid="clip-keyframe"][data-at="30"]').click()
    await expect.poll(playhead, WAIT).toBe(30)
    expect((await keys()).map((k) => k.at)).toEqual([30, 105])
  })

  it('takes a press beside a diamond, shows the time while it goes, snaps, stays on the clip, and undoes (task 96)', async () => {
    await fresh()
    await goTo(30)
    await page.click('[data-testid="zoom-key"]')
    await goTo(209)
    await typeInto('zoom-scale', '120')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 209])
    const clip = (await page.locator('[data-testid="clip"]').first().boundingBox())!
    const frameX = (f: number): number => clip.x + clip.width * ((f + 0.5) / 210)
    const y = clip.y + clip.height - 9

    // The keyframe on the clip's last frame, pressed 7 pixels to its left: the
    // keyframe moves, not the clip, and its time shows while it goes.
    const last = (await page.locator('[data-testid="clip-keyframe"][data-at="209"]').boundingBox())!
    const x = last.x + last.width / 2 - 7
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + ((frameX(150) - x) * i) / 6, y)
    await expect.poll(() => page.locator('[data-testid="clip-keyframe-time"]').count(), WAIT).toBe(1)
    await page.mouse.up()
    expect(await page.locator('[data-testid="clip-keyframe-time"]').count()).toBe(0)
    await expect.poll(async () => (await keys())[1]!.at, WAIT).toBeLessThan(160)
    const moved = (await keys())[1]!.at
    expect(moved).toBeGreaterThan(140)
    expect((await page.locator('[data-testid="clip"]').first().boundingBox())!.x).toBe(clip.x)

    /** Drag the diamond of the keyframe at `at` to a point across the timeline. */
    const dragKey = async (at: number, toX: number): Promise<void> => {
      const box = (await page.locator(`[data-testid="clip-keyframe"][data-at="${at}"]`).boundingBox())!
      const from = box.x + box.width / 2
      await page.mouse.move(from, y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(from + ((toX - from) * i) / 6, y)
      await page.mouse.up()
    }
    // A few pixels short of the clip's start, it snaps onto it.
    await dragKey(30, clip.x + 5)
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([0, moved])
    // Dragged past the clip's end, it stops on its last frame.
    await dragKey(moved, clip.x + clip.width + 80)
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([0, 209])

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([0, moved])
  })
})

describe('the presets', () => {
  it('punch in, zoom in, and zoom in and out, each of ordinary keyframes', async () => {
    await fresh()
    await goTo(60)
    await page.click('[data-testid="zoom-punch"]')
    await expect.poll(async () => (await keys()).map((k) => [k.at, k.ease ?? 'smooth']), WAIT).toEqual([
      [59, 'hold'],
      [60, 'smooth']
    ])
    // 150% unless another amount is chosen (bugs and notes 2, note 14).
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('150')
    await page.keyboard.press('Enter')
    // Its two keyframes a frame apart are one mark on the clip, not none (bugs and notes 2, note 15).
    await expect.poll(() => page.getAttribute('[data-testid="clip-keyframe"]', 'data-count'), WAIT).toBe('2')
    expect(await page.locator('[data-testid="clip-keyframe"]').count()).toBe(1)

    await fresh()
    await goTo(60)
    await page.click('[data-testid="zoom-in"]')
    // Over a second at Normal (task 97).
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([60, 90])

    // Across In to Out when they are marked.
    await fresh()
    await goTo(30)
    await page.keyboard.press('Shift+KeyI')
    await goTo(150)
    await page.keyboard.press('Shift+KeyO')
    await page.click('[data-testid="zoom-in-out"]')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 60, 120, 150])

    // Three seconds from the playhead otherwise: a second in, a second held, a second out.
    await fresh()
    await goTo(30)
    await page.click('[data-testid="zoom-in-out"]')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([30, 60, 90, 120])
  })

  // Bugs and notes 2, note 14 (plan 75).
  it('goes as far in as chosen, as quickly as chosen, and both are kept', async () => {
    await fresh()
    await page.click('[data-testid="zoom-amount-200"]')
    await page.click('[data-testid="zoom-speed-slow"]')
    await goTo(60)
    await page.click('[data-testid="zoom-in"]')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([60, 120])
    await page.keyboard.press('Enter')
    await goTo(120)
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('200')
    const kept = await page.evaluate(() => window.localStorage.getItem('editbay.window') ?? '')
    expect(kept).toContain('"zoomAmount":200')
    expect(kept).toContain('"zoomSpeed":"slow"')
    await page.click('[data-testid="zoom-amount-150"]')
    await page.click('[data-testid="zoom-speed-normal"]')
  })

  it('closes in on the point clicked right after, in the same undo step', async () => {
    await fresh()
    await goTo(60)
    await page.click('[data-testid="zoom-punch"]')
    await page.waitForSelector('[data-testid="zoom-aiming"]', WAIT)
    const middle = (await keys()).at(-1)!.crop
    // A click on the Output view, a quarter of the way in from the frame's left.
    const layer = page.locator('[data-testid="aim-layer"][data-side="program"]')
    const box = (await layer.boundingBox())!
    const fit = fitInBox(1080, 1920, box.width, box.height)
    await page.mouse.click(box.x + fit.offsetX + fit.width * 0.25, box.y + fit.offsetY + fit.height * 0.5)
    await expect.poll(async () => (await keys()).at(-1)!.crop.x, WAIT).toBeLessThan(middle.x)
    await page.waitForSelector('[data-testid="aim-target"]', WAIT)
    expect((await keys()).length).toBe(2)
    // Enter: done aiming, and the views take presses as ever.
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('[data-testid="aim-layer"]').count(), WAIT).toBe(0)
    // One undo takes the zoom and its aim back together.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await keys()).length, WAIT).toBe(0)
  })

  it('says when the picture is past its own pixels', async () => {
    await fresh()
    // 640x360 in a 1080x1920 frame is drawn larger than it was recorded, zoom or not.
    await page.waitForSelector('[data-testid="zoom-softer"]', WAIT)
    expect(await page.textContent('[data-testid="zoom-softer"]')).toBe("Past the recording's own pixels, so softer.")
  })
})

/**
 * Plan 65: a Simple zoom. Start on the clip's first frame and End on its
 * last, framed from the Zoom group's two cards, stretched by a trim, and the
 * switch to keyframes and back.
 */
describe('a Simple zoom', () => {
  const simple = async (): Promise<string | undefined> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.transform.simple)
  const mode = (): Promise<string | null> => page.getAttribute('[data-testid="zoom-group"]', 'data-mode')

  it('starts still, and moves once End is framed closer: Start on the first frame, End on the last', async () => {
    await fresh('simple')
    expect(await page.locator('[data-testid="zoom-still-note"]').count()).toBe(1)
    expect(await keys()).toEqual([])
    await page.click('[data-testid="zoom-end"]')
    await expect.poll(playhead, WAIT).toBe(209)
    expect(await page.getAttribute('[data-testid="zoom-end"]', 'aria-pressed')).toBe('true')
    await typeInto('zoom-scale', '130')
    await expect.poll(simple, WAIT).toBe('smooth')
    expect((await keys()).map((k) => k.at)).toEqual([0, 209])
    await expect.poll(() => page.locator('[data-testid="zoom-still-note"]').count(), WAIT).toBe(0)
    // Its Start and End as two diamonds on the clip's ends (bugs and notes 2, note 15).
    await expect.poll(() => page.locator('[data-testid="clip-keyframe"]').count(), WAIT).toBe(2)
    expect(await page.locator('[data-testid="clip-keyframe"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-simple')))).toEqual(['start', 'end'])
    await expect.poll(() => previewColour(PROBE.x, PROBE.y), WAIT).toBe('green')
    await page.click('[data-testid="zoom-start"]')
    await expect.poll(playhead, WAIT).toBe(0)
    await expect.poll(() => page.inputValue('[data-testid="zoom-scale"]'), WAIT).toBe('100')
    await expect.poll(() => previewColour(PROBE.x, PROBE.y), WAIT).toBe('black')
  })

  it('names the box Start or End on the Source view, with the other dashed', async () => {
    await page.click('[data-testid="view-source"]')
    await expect.poll(() => page.textContent('[data-testid="crop-label"]'), WAIT).toBe('Start')
    expect(await page.getAttribute('[data-testid="crop-partner"]', 'data-label')).toBe('End')
    await page.click('[data-testid="zoom-end"]')
    await expect.poll(() => page.textContent('[data-testid="crop-label"]'), WAIT).toBe('End')
    expect(await page.getAttribute('[data-testid="crop-partner"]', 'data-label')).toBe('Start')
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'zoom-simple.png') })
    await page.click('[data-testid="view-program"]')
  })

  it('moves End, and only End, when its box is dragged or its crop reset', async () => {
    await page.click('[data-testid="view-source"]')
    await page.click('[data-testid="zoom-end"]')
    await expect.poll(() => page.textContent('[data-testid="crop-label"]'), WAIT).toBe('End')
    const was = await keys()
    const box = (await page.locator('[data-testid="crop-rect"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 - 6 * i, box.y + box.height / 2)
    await page.mouse.up()
    await expect.poll(async () => (await keys())[1]!.crop.x, WAIT).toBeLessThan(was[1]!.crop.x)
    expect((await keys())[0]!.crop).toEqual(was[0]!.crop)

    // Reset crop: End back to the whole height, Start as it was, so the clip stays still.
    await page.click('[data-testid="crop-reset"]')
    await expect.poll(simple, WAIT).toBeUndefined()
    const after = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.transform.crop)
    expect(after).toEqual(was[0]!.crop)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await keys())[1]!.crop, WAIT).toEqual(was[1]!.crop)
    await page.click('[data-testid="view-program"]')
  })

  it('stretches to fit a trim, and exports with Start on the first frame and End on the last', async () => {
    await goTo(150)
    await page.keyboard.press('o')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([0, 149])
    expect(await simple()).toBe('smooth')

    for (const f of (await readdir(exportDir)).filter((x) => x.endsWith('.mp4'))) await rm(join(exportDir, f))
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.selectOption('[data-testid="export-mode"]', 'join')
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
    await closeExport(page)
    const made = (await readdir(exportDir)).filter((f) => f.endsWith('.mp4'))
    expect(made).toHaveLength(1)
    const file = join(exportDir, made[0]!)
    expect(await exportedColour(file, 0, PROBE.x, PROBE.y)).toBe('black')
    expect(await exportedColour(file, 148 / 30, PROBE.x, PROBE.y)).toBe('green')
  })

  it('cuts halfway, swaps into a zoom out, and stops moving with No move', async () => {
    await page.click('[data-testid="zoom-ease-cut"]')
    await expect.poll(simple, WAIT).toBe('cut')
    expect((await keys()).map((k) => [k.at, k.ease ?? 'smooth'])).toEqual([
      [0, 'hold'],
      [75, 'smooth']
    ])
    const before = await keys()
    await page.click('[data-testid="zoom-swap"]')
    await expect.poll(async () => (await keys())[0]!.crop.w, WAIT).toBe(before[1]!.crop.w)
    await page.click('[data-testid="zoom-still"]')
    await expect.poll(simple, WAIT).toBeUndefined()
    expect(await keys()).toEqual([])
    await expect.poll(() => page.locator('[data-testid="zoom-still-note"]').count(), WAIT).toBe(1)
  })

  it('goes to keyframes on the same frames, back with no question, and asks when keyframes in between would go', async () => {
    await page.click('[data-testid="zoom-simple-in"]')
    await expect.poll(simple, WAIT).toBe('smooth')
    const was = await keys()
    await page.click('[data-testid="zoom-more"]')
    await expect.poll(mode, WAIT).toBe('keys')
    expect(await simple()).toBeUndefined()
    expect(await keys()).toEqual(was)

    await page.click('[data-testid="zoom-mode-simple"]')
    await expect.poll(mode, WAIT).toBe('simple')
    expect(await page.locator('[data-testid="zoom-to-simple"]').count()).toBe(0)
    await expect.poll(simple, WAIT).toBe('smooth')

    await page.click('[data-testid="zoom-mode-keys"]')
    await expect.poll(mode, WAIT).toBe('keys')
    await goTo(60)
    await page.click('[data-testid="zoom-key"]')
    await expect.poll(async () => (await keys()).length, WAIT).toBe(3)
    await page.click('[data-testid="zoom-mode-simple"]')
    await page.waitForSelector('[data-testid="zoom-to-simple"]')
    await page.click('[data-testid="zoom-to-simple-no"]')
    expect(await mode()).toBe('keys')
    expect((await keys()).length).toBe(3)
    await page.click('[data-testid="zoom-mode-simple"]')
    await page.click('[data-testid="zoom-to-simple-yes"]')
    await expect.poll(mode, WAIT).toBe('simple')
    await expect.poll(async () => (await keys()).map((k) => k.at), WAIT).toEqual([0, 149])
  })
})
