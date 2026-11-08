import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'
import { wakeSound } from './wake-sound'

/**
 * The column of track headers (task 2612): every header's buttons on one row,
 * a header clicked shows its track in the Inspector, and the add-track buttons
 * up in the strip beside the ruler. Captions are made with the stand-in for
 * whisper-cli, so the Captions header is there too.
 */

const fx = fixtureSet('track-headers-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-track-headers-'))
const userData = join(root, 'user-data')
const fake = join(process.cwd(), 'test', 'fixtures', 'fake-whisper.mjs')
let app: ElectronApplication
let page: Page
let shot = 0
type Colour = 'red' | 'green' | 'blue' | 'other'

beforeAll(async () => {
  const clean = await fx.redClip()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_SPEECH_FAKE: fake, EDITBAY_FAKE_WHISPER_LOG: join(root, 'heard.json') }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await wakeSound(page)
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clean)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]', WAIT)
  await page.locator('[data-testid="open-captions"]').click()
  await page.waitForSelector('[data-testid="captions-dialog"]', WAIT)
  if ((await page.locator('[data-testid="captions-scope-whole"]').count()) > 0) await page.click('[data-testid="captions-scope-whole"]')
  await page.locator('[data-testid="captions-make"]').click()
  await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', timeout: 30_000 })
  await page.waitForSelector('[data-testid="caption"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

const header = (name: string) => page.locator(`[data-testid="track-header"][data-track="${name}"]`)

/** A track's own settings as main has them. */
async function trackSaved(name: 'V1' | 'A1'): Promise<{ locked?: boolean; muted?: boolean }> {
  return page.evaluate(async (n) => {
    const s = (await window.api.currentProject()).sequences[0]!
    const t = n === 'V1' ? s.videoTracks[0]! : s.audioTracks[0]!
    return { ...(t.locked !== undefined ? { locked: t.locked } : {}), ...(t.muted !== undefined ? { muted: t.muted } : {}) }
  }, name)
}

describe('track headers', () => {
  it('puts every header\'s buttons on one row, all the same height', async () => {
    const rows = await page.locator('[data-testid="track-header"]').evaluateAll((hs) =>
      hs.map((h) => ({
        name: h.getAttribute('data-track'),
        buttons: [...h.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect()
          return { middle: Math.round(r.top + r.height / 2), height: Math.round(r.height) }
        })
      }))
    )
    expect(rows.map((r) => r.name)).toEqual(['Captions', 'V1', 'A1'])
    for (const r of rows) {
      expect(r.buttons.length, r.name ?? '').toBeGreaterThan(1)
      expect(new Set(r.buttons.map((b) => b.middle)).size, r.name ?? '').toBe(1)
      expect(new Set(r.buttons.map((b) => b.height)), r.name ?? '').toEqual(new Set([20]))
    }
  })

  it('has the add-track buttons in the strip beside the ruler, and none in a header', async () => {
    const corner = page.locator('[data-testid="ruler-corner"]')
    expect(await corner.locator('[data-testid="add-video-track"]').count()).toBe(1)
    expect(await corner.locator('[data-testid="add-audio-track"]').count()).toBe(1)
    expect(await page.locator('[data-testid="track-header"] [data-testid^="add-"]').count()).toBe(0)
    // Both fit, so the column stays its own width and the tracks' zoom is what it was.
    expect((await page.locator('[data-testid="track-headers"]').boundingBox())!.width).toBe(132)
    for (const id of ['add-video-track', 'add-audio-track']) {
      const fits = await corner.locator(`[data-testid="${id}"]`).evaluate((b) => b.scrollWidth <= b.clientWidth)
      expect(fits, id).toBe(true)
    }
    await corner.locator('[data-testid="add-video-track"]').click()
    await page.waitForSelector('[data-testid="track-header"][data-track="V2"]', WAIT)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForSelector('[data-testid="track-header"][data-track="V2"]', { state: 'detached', ...WAIT })
  })

  it('shows a video track in the Inspector when its header is clicked, with what the header sets', async () => {
    await header('V1').locator('[data-testid="track-name"]').click()
    await page.waitForSelector('[data-testid="track-panel"][data-track="V1"]', WAIT)
    expect(await header('V1').getAttribute('data-selected')).toBe('yes')
    expect(await page.locator('[data-testid="track-panel-hide"]').count()).toBe(1)
    expect(await page.locator('[data-testid="track-panel-mute"]').count()).toBe(0)
    // Clicked rather than checked: the tick follows the project, which answers a moment later.
    await page.locator('[data-testid="track-panel-lock"]').click()
    await expect.poll(() => trackSaved('V1'), WAIT).toEqual({ locked: true })
    await expect.poll(() => header('V1').locator('[data-testid="track-lock"]').getAttribute('aria-pressed'), WAIT).toBe('true')
    await page.locator('[data-testid="track-panel-lock"]').click()
    await expect.poll(async () => (await trackSaved('V1')).locked === true, WAIT).toBe(false)
  })

  it('renames a track from the Inspector', async () => {
    await page.locator('[data-testid="track-panel-name"]').fill('Camera')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="track-header"][data-track="Camera"]', WAIT)
    await page.waitForSelector('[data-testid="track-panel"][data-track="Camera"]', WAIT)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForSelector('[data-testid="track-header"][data-track="V1"]', WAIT)
  })

  it('shows an audio track with Mute, Solo and Duck, and a header button does its own job without selecting', async () => {
    await header('A1').locator('[data-testid="track-name"]').click()
    await page.waitForSelector('[data-testid="track-panel"][data-track="A1"]', WAIT)
    for (const id of ['track-panel-mute', 'track-panel-solo', 'track-panel-duck', 'track-panel-lock']) {
      expect(await page.locator(`[data-testid="${id}"]`).count(), id).toBe(1)
    }
    expect(await page.locator('[data-testid="track-panel-hide"]').count()).toBe(0)
    // V1's lock pressed: V1 locks, and A1 stays the track shown.
    await header('V1').locator('[data-testid="track-lock"]').click()
    await expect.poll(() => trackSaved('V1'), WAIT).toEqual({ locked: true })
    expect(await page.locator('[data-testid="track-panel"]').getAttribute('data-track')).toBe('A1')
    expect(await header('V1').getAttribute('data-selected')).toBe('no')
    await header('V1').locator('[data-testid="track-lock"]').click()
    await expect.poll(async () => (await trackSaved('V1')).locked === true, WAIT).toBe(false)
    // The same Mute, from the header and from the Inspector.
    await header('A1').locator('[data-testid="track-mute"]').click()
    await expect.poll(async () => page.locator('[data-testid="track-panel-mute"]').isChecked(), WAIT).toBe(true)
    await page.locator('[data-testid="track-panel-mute"]').click()
    await expect.poll(async () => (await trackSaved('A1')).muted === true, WAIT).toBe(false)
  })

  it('shows the caption track, whose button opens how captions look', async () => {
    await header('Captions').locator('[data-testid="track-name"]').click()
    await page.waitForSelector('[data-testid="track-panel"][data-track="Captions"]', WAIT)
    await page.locator('[data-testid="track-panel-caption-look"]').click()
    await page.waitForSelector('[data-testid="caption"][data-selected="yes"]', WAIT)
    // The track is let go as the caption is taken, a moment after.
    await expect.poll(() => header('Captions').getAttribute('data-selected'), WAIT).toBe('no')
    expect(await page.locator('[data-testid="track-panel"]').count()).toBe(0)
  })

  it('lets the track go when a clip is selected', async () => {
    await header('V1').locator('[data-testid="track-name"]').click()
    await page.waitForSelector('[data-testid="track-panel"]', WAIT)
    await page.locator('[data-testid="clip"]').first().click()
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
    expect(await page.locator('[data-testid="track-panel"]').count()).toBe(0)
    expect(await header('V1').getAttribute('data-selected')).toBe('no')
  })
})

/** The colour in the middle of the Output view, from a screenshot of it. */
async function middleOfOutput(): Promise<Colour> {
  const stage = page.locator('[data-testid="monitor-side"][data-side="program"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  const size = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const m = String(size).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(1080, 1920, box.width, box.height)
  return colourOf(file, Math.round((fit.offsetX + fit.width / 2) * scale), Math.round((fit.offsetY + fit.height / 2) * scale))
}

/** The colour of one pixel of a picture or a video's first second. */
async function colourOf(file: string, x: number, y: number, at?: number): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', ...(at !== undefined ? ['-ss', String(at)] : []), '-i', file, '-frames:v', '1',
    '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 170 && g < 80 && b < 80) return 'red'
  if (g > 90 && r < 80 && b < 80) return 'green'
  if (b > 170 && r < 80 && g < 80) return 'blue'
  return 'other'
}

/** Every video track's id, V1 first. */
async function videoOrder(): Promise<string[]> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks.map((r) => r.id))
}

/** A header pressed in its middle and dragged to `y` on the page, a few steps at a time. */
async function dragHeader(name: string, y: number, beforeLetGo?: () => Promise<void>): Promise<void> {
  const box = (await header(name).locator('[data-testid="track-name"]').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, y, { steps: 8 })
  await beforeLetGo?.()
  await page.mouse.up()
}

describe('dragging a track header (task 2613)', () => {
  it('stacks green on V2 over red on V1 to begin with', async () => {
    const [green] = await page.evaluate((p) => window.api.importFiles([p]), await fx.greenClip())
    await page.waitForSelector(`[data-testid="asset"][data-asset-id="${green!.id}"][data-status="ready"]`, { timeout: 180_000 })
    await page.click('[data-testid="add-video-track"]')
    const v2 = '[data-testid="track"][data-kind="video"][data-index="1"]'
    await page.waitForSelector(v2, WAIT)
    const lane = (await page.locator(v2).boundingBox())!
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${green!.id}"]`, v2, { targetPosition: { x: 1, y: lane.height / 2 } })
    await page.waitForSelector(`${v2} [data-testid="clip"]`, WAIT)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await expect.poll(middleOfOutput, WAIT).toBe('green')
  })

  it('moves V1 above V2 with its clip, so red is drawn over green, without selecting it', async () => {
    const before = await videoOrder()
    const top = (await header('V2').boundingBox())!
    await dragHeader('V1', top.y + 4, async () => {
      expect(await page.locator('[data-testid="track-landing"]').count()).toBe(1)
      expect(await header('V1').getAttribute('data-dragging')).toBe('yes')
    })
    await expect.poll(videoOrder, WAIT).toEqual([before[1], before[0]])
    expect(await page.locator('[data-testid="track-landing"]').count()).toBe(0)
    // The red clip's track is on top now, and called V2 as the top of two is.
    await expect.poll(() => page.locator(`[data-testid="track-header"][data-track-id="${before[0]}"]`).getAttribute('data-track'), WAIT).toBe('V2')
    expect(await page.locator(`[data-testid="track-header"][data-track-id="${before[0]}"]`).getAttribute('data-selected')).toBe('no')
    await expect.poll(middleOfOutput, WAIT).toBe('red')
  })

  it('exports the new order', async () => {
    const out = join(root, 'exports')
    const result = await page.evaluate(async (dir) => {
      const p = await window.api.currentProject()
      return window.api.startExport({ sequenceId: p.sequences[0]!.id, mode: 'join', outputDir: dir, filenamePattern: '{project}', existing: 'replace' })
    }, out)
    expect(result.ok).toBe(true)
    expect(await colourOf(result.outputs[0]!, 540, 960, 1)).toBe('red')
  }, 120_000)

  it('puts the order back with one undo', async () => {
    const now = await videoOrder()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(videoOrder, WAIT).toEqual([now[1], now[0]])
    await expect.poll(middleOfOutput, WAIT).toBe('green')
  })

  it('leaves a header pressed and let go where it was as a click, and Escape calls a drag off', async () => {
    const order = await videoOrder()
    const box = (await header('V1').locator('[data-testid="track-name"]').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-testid="track-panel"][data-track="V1"]', WAIT)
    const top = (await header('V2').boundingBox())!
    await dragHeader('V1', top.y + 4, async () => {
      await page.keyboard.press('Escape')
      expect(await page.locator('[data-testid="track-landing"]').count()).toBe(0)
    })
    await page.waitForTimeout(300)
    expect(await videoOrder()).toEqual(order)
  })
})

/** The headers from the top of the column down. */
async function headerOrder(): Promise<string[]> {
  return page.locator('[data-testid="track-header"]').evaluateAll((hs) => hs.map((h) => h.getAttribute('data-track') ?? ''))
}

/** How many video tracks the captions are drawn over, as main has it: absent while on top. */
async function captionsAbove(): Promise<number | undefined> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.captions.above)
}

async function exportedMiddle(): Promise<Colour> {
  const out = join(root, `exports-${++shot}`)
  const result = await page.evaluate(async (dir) => {
    const p = await window.api.currentProject()
    return window.api.startExport({ sequenceId: p.sequences[0]!.id, mode: 'join', outputDir: dir, filenamePattern: '{project}', existing: 'replace' })
  }, out)
  expect(result.ok).toBe(true)
  return colourOf(result.outputs[0]!, 540, 960, 1)
}

describe('dragging the caption track (task 2621)', () => {
  it('draws a caption, all blue, over green on V2 to begin with', async () => {
    // Letters and box one blue, in the middle of the frame, so the middle is blue wherever the caption is drawn.
    await page.evaluate(async () => {
      const p = await window.api.currentProject()
      const style = { box: true, boxColour: '#0000FF', boxOpacity: 1, wordColour: '#0000FF', highlight: '#0000FF', outline: 0, height: 0.5, size: 0.12 }
      const { docId } = await window.api.session()
      await window.api.applyEdit(docId, { sequenceId: p.sequences[0]!.id, kind: 'setCaptionStyle', style } as never)
    })
    // Made behind the window's back, so the window is loaded again to take it.
    await page.reload()
    await page.waitForSelector('[data-testid="caption"]', WAIT)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(middleOfOutput, WAIT).toBe('blue')
    expect(await headerOrder()).toEqual(['Captions', 'V2', 'V1', 'A1'])
  })

  it('moves Captions below V2, so V2 is drawn over the captions', async () => {
    const v1 = (await header('V1').boundingBox())!
    await dragHeader('Captions', v1.y + 3, async () => {
      expect(await page.locator('[data-testid="track-landing"]').count()).toBe(1)
    })
    await expect.poll(captionsAbove, WAIT).toBe(1)
    await expect.poll(headerOrder, WAIT).toEqual(['V2', 'Captions', 'V1', 'A1'])
    await expect.poll(middleOfOutput, WAIT).toBe('green')
  })

  it('still draws the captions over V1 there, as V2 hidden shows', async () => {
    await header('V2').locator('[data-testid="track-hide"]').click()
    await expect.poll(middleOfOutput, WAIT).toBe('blue')
    // Shown again by undoing the hide, so the next undo is the drag's.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(middleOfOutput, WAIT).toBe('green')
  })

  it('exports V2 over the captions', async () => {
    expect(await exportedMiddle()).toBe('green')
  }, 120_000)

  it('puts Captions back on top with one undo, in the preview and the export', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(captionsAbove, WAIT).toBeUndefined()
    await expect.poll(headerOrder, WAIT).toEqual(['Captions', 'V2', 'V1', 'A1'])
    await expect.poll(middleOfOutput, WAIT).toBe('blue')
    expect(await exportedMiddle()).toBe('blue')
  }, 120_000)
})
