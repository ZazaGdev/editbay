import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Task 1099: Ctrl+wheel zoom about the pointer on a cut like the owner's demo,
 * eighteen minutes of short clips on V1 and V2 and three audio tracks, still
 * jumped minutes away after enough notches. Thirty and more notches in and out
 * at several places, paused and playing: the moment under the pointer stays
 * within a pixel, wherever the view can be scrolled to keep it there.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-wheel-zoom-long-'))
const FPS = 30
const FRAMES = 18 * 60 * FPS
let app: ElectronApplication
let page: Page

type Piece = { id: string; timelineStart: number; sourceIn: number; sourceOut: number; link?: string }
type Saved = { sequences: { videoTracks: { id: string; clips: Piece[] }[]; audioTracks: { id: string; clips: Piece[] }[] }[] }

beforeAll(async () => {
  const long = join(root, 'long.mp4')
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=${FPS}:duration=${FRAMES / FPS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${FRAMES / FPS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '300', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', long
  ])
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [long])
  await page.waitForSelector(`[data-testid="asset"][data-asset-id="${asset!.id}"][data-status="ready"]`, { timeout: 180_000 })
  await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForSelector('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]')

  // Saved, cut into short pieces on every track, and opened again.
  const file = join(root, 'cut.editbay')
  await answerSaveDialog(app, file)
  await page.evaluate(() => window.api.saveProject(true))
  for (let i = 0; i < 100 && !(await stat(file).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100))
  const saved = JSON.parse(await readFile(file, 'utf8')) as Saved
  const s = saved.sequences[0]!
  const picture = s.videoTracks[0]!.clips[0]!
  const sound = s.audioTracks[0]!.clips[0]!
  let n = 0
  const piece = <T extends Piece>(like: T, from: number, to: number, link?: string): T => ({
    ...like, id: `p${n++}`, timelineStart: from, sourceIn: from, sourceOut: to, ...(link ? { link } : {})
  })
  // V1 and A1: pieces of two to eight seconds, a few frames apart.
  const v1: Piece[] = []
  const a1: Piece[] = []
  for (let at = 0, i = 0; at < FRAMES - 60; i++) {
    const to = Math.min(FRAMES, at + 60 + ((i * 37) % 180))
    v1.push(piece(picture, at, to, `l${i}`))
    a1.push(piece(sound, at, to, `l${i}`))
    at = to + (i % 3)
  }
  // V2: six pieces of three minutes, end to end, which the test reads the time from.
  const v2 = Array.from({ length: 6 }, (_, i) => {
    const c = piece(picture, i * 3 * 60 * FPS, (i + 1) * 3 * 60 * FPS)
    delete c.link
    return c
  })
  // A2 and A3: pieces of ten seconds, every twenty.
  const every = (k: number): Piece[] =>
    Array.from({ length: Math.floor(FRAMES / (20 * FPS)) }, (_, i) => {
      const c = piece(sound, i * 20 * FPS + k, i * 20 * FPS + k + 10 * FPS)
      delete c.link
      return c
    })
  s.videoTracks = [{ ...s.videoTracks[0]!, clips: v1 }, { ...s.videoTracks[0]!, id: 'v2', clips: v2 }]
  s.audioTracks = [{ ...s.audioTracks[0]!, clips: a1 }, { ...s.audioTracks[0]!, id: 'a2', clips: every(0) }, { ...s.audioTracks[0]!, id: 'a3', clips: every(5 * FPS) }]
  await writeFile(file, JSON.stringify(saved))
  await page.evaluate(() => window.api.newProject())
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0, undefined, { timeout: 10_000 })
  await page.evaluate((path) => window.api.openProject(path), file)
  await page.waitForSelector('[data-testid="track"][data-track-id="v2"] [data-testid="clip"]', { timeout: 30_000 })
}, 400_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const SCROLL = '[data-testid="timeline-scroll"]'

/** The frame under a point `x` pixels into the timeline's view, and pixels per frame, read from the V2 piece under it. */
function readAt(x: number): Promise<{ frame: number; ppf: number; left: number; max: number } | null> {
  return page.evaluate(
    ({ x, scroll }) => {
      const el = document.querySelector(scroll) as HTMLElement
      const at = el.getBoundingClientRect().left + x
      for (const c of document.querySelectorAll('[data-testid="track"][data-track-id="v2"] [data-testid="clip"]')) {
        const r = c.getBoundingClientRect()
        const length = Number(c.getAttribute('data-length-frames'))
        if (at < r.left || at > r.right) continue
        const ppf = r.width / length
        return { frame: Number(c.getAttribute('data-start')) + (at - r.left) / ppf, ppf, left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }
      }
      return null
    },
    { x, scroll: SCROLL }
  )
}

/**
 * Ctrl+wheel `notches` times at `x` in the view, over V1's clips, `pause`
 * milliseconds apart: up zooms in, down zooms out. A hand on a mouse moves it
 * a pixel or so now and then, as `shake` does. `each` is read after every notch.
 */
async function wheel(
  x: number,
  notches: number,
  dy: number,
  pause: number,
  shake = false,
  each?: (px: number) => Promise<void>,
  moved?: (px: number) => Promise<void>
): Promise<void> {
  const view = (await page.locator(SCROLL).boundingBox())!
  const v1 = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
  const y = v1.y + v1.height / 2
  await page.mouse.move(view.x + x, y)
  await page.keyboard.down('Control')
  let px = x
  for (let i = 0; i < notches; i++) {
    if (shake && i % 4 === 3) {
      px = x + (i % 8 === 3 ? 1 : 0)
      await page.mouse.move(view.x + px, y + 1)
      await page.waitForTimeout(50)
      if (moved) await moved(px)
    }
    await page.mouse.wheel(0, dy)
    if (pause > 0) await page.waitForTimeout(pause)
    if (each) await each(px)
  }
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
}

/** To a zoom step with the toolbar, scrolled so `frame` is in the middle. */
async function start(zoomSteps: number, frame: number): Promise<void> {
  for (let i = 0; i < 14; i++) await page.click('[data-testid="zoom-out"]')
  for (let i = 0; i < zoomSteps; i++) await page.click('[data-testid="zoom-in"]')
  await page.evaluate(
    ({ s, frame, frames }) => {
      const el = document.querySelector(s) as HTMLElement
      el.scrollLeft = (frame / frames) * (el.scrollWidth - 40) - el.clientWidth / 2
    },
    { s: SCROLL, frame, frames: FRAMES }
  )
  await page.waitForTimeout(300)
}

describe('Ctrl+wheel with a shaking hand, read after every notch, in a narrow window', () => {
  for (const playing of [false, true]) {
    it(`keeps the moment under the pointer, ${playing ? 'playing' : 'paused'}`, async () => {
      await page.setViewportSize({ width: 1150, height: 700 })
      try {
        for (const [x, frame] of [[120, 11 * 60 * FPS], [500, 12 * 60 * FPS], [800, 4 * 60 * FPS]] as const) {
          await start(4, frame)
          if (playing) {
            // The playhead right at the pointer, as when zooming in to see where it is.
            const view = (await page.locator(SCROLL).boundingBox())!
            await page.mouse.click(view.x + x, view.y + 8)
            await page.locator('[data-testid="timecode"]').click()
            await page.keyboard.press('Space')
            await page.waitForTimeout(300)
          }
          let held = (await readAt(x))!
          const seen: string[] = []
          const check = async (px: number): Promise<void> => {
            const now = await readAt(px)
            if (!now) return
            seen.push(`${now.frame.toFixed(0)}@${now.ppf.toFixed(2)}`)
            // Against either end the view cannot keep it: what is under the pointer then is what the next notches keep.
            const want = held.frame * now.ppf - px
            if (want < 0 || want > now.max) {
              held = now
              return
            }
            // The view scrolls by whole pixels, so a moment read off the screen
            // after the pointer moves is already up to half a pixel out.
            expect(Math.abs(now.frame - held.frame) * now.ppf, `x ${px}, ${held.frame.toFixed(1)} -> ${seen.join(' ')}`).toBeLessThanOrEqual(1.5)
          }
          // The pointer moved: what it is over now is what the next notches keep.
          const moved = async (px: number): Promise<void> => {
            held = (await readAt(px)) ?? held
          }
          try {
            for (const [notches, dy] of [[36, -100], [36, 100], [20, -100]] as const) await wheel(x, notches, dy, 40, true, check, moved)
          } finally {
            if (playing) await page.keyboard.press('Space')
          }
        }
      } finally {
        await page.setViewportSize({ width: 1440, height: 900 })
      }
    }, 300_000)
  }
})

describe('Ctrl+wheel over an eighteen-minute cut of short clips', () => {
  for (const playing of [false, true]) {
    for (const pause of [0, 150]) {
      it(`keeps the moment under the pointer, 36 notches in and 36 out at three places, ${playing ? 'playing' : 'paused'}, notches ${pause} ms apart`, async () => {
        for (const [x, frame] of [[150, 11 * 60 * FPS], [700, 12 * 60 * FPS], [1150, 4 * 60 * FPS]] as const) {
          await start(4, frame)
          if (playing) {
            // The playhead on screen and playing, as the owner's was.
            const view = (await page.locator(SCROLL).boundingBox())!
            await page.mouse.click(view.x + x - 100, view.y + 8)
            await page.locator('[data-testid="timecode"]').click()
            await page.keyboard.press('Space')
            await page.waitForTimeout(300)
          }
          let held: Awaited<ReturnType<typeof readAt>> = (await readAt(x))!
          const seen: string[] = []
          // A quick turn is read once it ends; a slow one after every notch.
          const check = async (): Promise<void> => {
            const now = await readAt(x)
            seen.push(now ? `${now.frame.toFixed(1)}@${now.ppf.toFixed(3)} scrolled ${now.left}` : 'past the end')
            // Past the end of the edit, or against either end of the view, it
            // cannot be kept: what is under the pointer then is what is kept next.
            if (!now || !held) {
              held = now
              return
            }
            const want = held.frame * now.ppf - x
            if (want < 0 || want > now.max) {
              held = now
              return
            }
            expect(Math.abs(now.frame - held.frame) * now.ppf, `x ${x}, ${held.frame.toFixed(1)} -> ${seen.join('; ')}`).toBeLessThanOrEqual(1)
          }
          // A quick turn hits no end partway, so reading it only once it ends is fair.
          const turns = pause === 0 ? ([[12, -100], [12, -100], [12, -100], [12, 100], [12, 100], [6, -100]] as const) : ([[36, -100], [36, 100], [6, -100]] as const)
          try {
            for (const [notches, dy] of turns) {
              await wheel(x, notches, dy, pause, false, pause === 0 ? undefined : check)
              if (pause === 0) await check()
            }
          } finally {
            if (playing) await page.keyboard.press('Space')
          }
        }
      }, 300_000)
    }
  }
})
