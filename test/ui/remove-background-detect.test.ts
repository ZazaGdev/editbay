import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'

/**
 * Task 32: Remove background finds the colour itself. Real files on a green
 * screen, a blue screen and black, each with a grey box standing on it, have
 * that colour taken out by the one action, which says which colour it found.
 * A picture with no plain background is left as it was, with a warning.
 * Plan 98: white, grey and orange are taken out by the same action too.
 * Each one taken out, the Output view agrees with an exported frame, as plan
 * 90's check over colour bands did when the colour was picked by hand.
 */

const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-bg-detect-'))
let app: ElectronApplication
let page: Page

const FILES = {
  green: 'color=c=0x00B140:s=640x360:r=30:d=2',
  blue: 'color=c=0x0047BB:s=640x360:r=30:d=2',
  black: 'color=c=black:s=640x360:r=30:d=2',
  // Plan 98: any other plain colour.
  white: 'color=c=0xF8F8F8:s=640x360:r=30:d=2',
  grey: 'color=c=0x808080:s=640x360:r=30:d=2',
  orange: 'color=c=0xE07020:s=640x360:r=30:d=2',
  busy: 'testsrc2=s=640x360:r=30:d=2'
} as const
type Name = keyof typeof FILES
const paths = {} as Record<Name, string>

/** The picture clip made from one of the files. */
async function clipOf(name: Name): Promise<{ id: string; removal: string | null }> {
  return page.evaluate(async (path) => {
    const p = await window.api.currentProject()
    const m = p.media.find((x) => x.originalPath === path)!
    const c = p.sequences[0]!.videoTracks.flatMap((t) => t.clips).find((x) => x.mediaId === m.id)!
    return { id: c.id, removal: c.removeBackground?.colour ?? null }
  }, paths[name])
}

/** Select the clip, and bring the playhead to its start with a press on the monitor. */
async function select(name: Name): Promise<void> {
  const { id } = await clipOf(name)
  await page.locator(`[data-testid="clip"][data-clip-id="${id}"]`).click()
  await page.waitForSelector(`[data-testid="clip"][data-clip-id="${id}"][data-selected="yes"]`)
  await page.waitForSelector('[data-testid="tool-remove-background-remove"]')
  const stage = (await page.locator('[data-testid="monitor-stage"]').boundingBox())!
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.waitForSelector(`[data-testid="monitor-stage"][data-clip="${id}"]`)
}

type Rgb = [number, number, number]
/** The background near a corner, and the grey box in the middle. */
const POINTS = [[0.1, 0.1], [0.5, 0.5]] as const
const TOLERANCE = 6
let shots = 0

async function pixels(file: string, frame: (w: number, h: number) => { x: number; y: number; w: number; h: number }): Promise<Rgb[]> {
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const [, w = '0', h = '0'] = String(probe).match(/, (\d+)x(\d+)/) ?? []
  const f = frame(Number(w), Number(h))
  const out: Rgb[] = []
  for (const [px, py] of POINTS) {
    const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${Math.round(f.x + px * f.w)}:${Math.round(f.y + py * f.h)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
    out.push([stdout[0]!, stdout[1]!, stdout[2]!])
  }
  return out
}

const apart = (a: Rgb[], b: Rgb[]): number => Math.max(...a.flatMap((p, i) => p.map((v, c) => Math.abs(v - b[i]![c]!))))

/** The playhead's frame as the Output view shows it and as an export writes it, once the view agrees or has had its time. */
async function both(): Promise<{ view: Rgb[]; file: Rgb[] }> {
  const { frame, output } = await page.evaluate(async () => ({
    frame: Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')),
    output: (await window.api.currentProject()).sequences[0]!.output
  }))
  const saved = await page.evaluate(async (r) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: r.frame, outputDir: r.dir })
  }, { frame, dir: join(root, 'frames') })
  expect(saved.error).toBeUndefined()
  const file = await pixels(saved.path!, (w, h) => ({ x: 0, y: 0, w, h }))
  const inView = async (): Promise<Rgb[]> => {
    const shot = join(root, `view-${++shots}.png`)
    await writeFile(shot, await page.locator('[data-testid="program-canvas"]').screenshot())
    return pixels(shot, (w, h) => {
      const fit = fitInBox(output.width, output.height, w, h)
      return { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
    })
  }
  let view = await inView()
  for (let i = 0; i < 20 && apart(view, file) > TOLERANCE; i++) {
    await page.waitForTimeout(150)
    view = await inView()
  }
  return { view, file }
}

const toast = (kind: string): Promise<string | null> => page.locator(`[data-kind="${kind}"]`).last().textContent(WAIT)

beforeAll(async () => {
  for (const [name, source] of Object.entries(FILES) as [Name, string][]) {
    paths[name] = join(root, `${name}.mp4`)
    await capture(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', source,
      '-vf', 'drawbox=x=240:y=120:w=160:h=120:color=0xC0C0C0:t=fill',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      paths[name]
    ])
  }
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  for (const name of Object.keys(FILES) as Name[]) {
    const before = await page.locator('[data-testid="clip"]').count()
    const [asset] = await page.evaluate((p) => window.api.importFiles([p]), paths[name])
    const card = `[data-testid="asset"][data-asset-id="${asset!.id}"]`
    await page.waitForSelector(`${card}[data-status="ready"]`, { timeout: 120_000 })
    await page.locator(`${card} [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length > n, before)
  }
  await page.click('[data-testid="view-program"]')
  await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('Remove background finds the colour itself', () => {
  for (const colour of ['green', 'blue', 'black', 'white', 'grey', 'orange'] as const) {
    // Green, blue and black keep their own keys; any other plain colour is kept as `plain` and its colour.
    const stored = colour === 'green' || colour === 'blue' || colour === 'black' ? colour : 'plain'
    it(`takes out a ${colour} background with the one action, and says it was ${colour}`, async () => {
      await select(colour)
      expect(await page.locator('[data-testid^="tool-remove-background-"]').evaluateAll((b) => b.map((x) => x.getAttribute('data-testid')))).toEqual([
        'tool-remove-background-remove',
        'tool-remove-background-none'
      ])
      await page.click('[data-testid="tool-remove-background-remove"]')
      await expect.poll(async () => (await clipOf(colour)).removal, WAIT).toBe(stored)
      expect(await toast('background-removed')).toContain(colour)
      await page.waitForSelector('[data-testid="tool-remove-background-remove"][aria-pressed="true"]')
      expect(await page.textContent('[data-testid="tool-remove-background-remove"]')).toBe(`Removed ${colour} background`)
      // Taken out on V1 alone, the background goes black and the grey box stays, the same in the view and the file.
      const out = await both()
      expect(apart(out.view, out.file)).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.max(...out.file[0]!)).toBeLessThan(40)
      expect(Math.min(...out.file[1]!)).toBeGreaterThan(150)
      await page.locator('[data-testid="remove-background-strength"]').fill('100')
      await expect.poll(() => page.getAttribute('[data-testid="remove-background-strength"]', 'data-value')).toBe('100')
      const strong = await both()
      // Turned up, a plain colour's key reaches the grey box, which sits part way
      // up its soft edge: there one level the view and the file decode apart
      // comes out as about eight of the box (plan 98).
      expect(apart(strong.view, strong.file)).toBeLessThanOrEqual(stored === 'plain' ? 12 : TOLERANCE)
      await page.click('[data-testid="tool-remove-background-none"]')
      await expect.poll(async () => (await clipOf(colour)).removal, WAIT).toBe(null)
    })
  }

  it('leaves a picture with no plain background as it was, and says it cannot remove it', async () => {
    await select('busy')
    await page.click('[data-testid="tool-remove-background-remove"]')
    expect(await toast('background-none')).toContain('cannot be removed')
    expect((await clipOf('busy')).removal).toBe(null)
  })

  it('does the same from the clip menu, under Tools', async () => {
    const { id } = await clipOf('blue')
    const box = (await page.locator(`[data-testid="clip"][data-clip-id="${id}"]`).boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.hover('[data-testid="clip-menu-tools"]')
    await page.click('[data-testid="clip-menu-tool-remove-background-remove"]')
    await expect.poll(async () => (await clipOf('blue')).removal, WAIT).toBe('blue')
  })
})
