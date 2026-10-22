import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import type { EditList } from '../../src/shared/edit-list'

/**
 * Task 1097: what the preview is heard to play, recorded, and when its
 * picture changes, for the tests of playing across cuts.
 */

const run = promisify(execFile)
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')

/**
 * A recording made by ffmpeg from `inputs` (lavfi sources, picture then
 * sound), cut by an edit list taking out `cuts`, opened in Editbay on its
 * Output view once every clip is ready.
 */
export async function openCut(
  root: string,
  inputs: string[],
  cuts: { fromSec: number; toSec: number }[]
): Promise<{ app: ElectronApplication; page: Page; clips: number }> {
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
  const clip = join(root, 'source.mp4')
  await capture(ffmpegPath, [
    '-v', 'error', ...inputs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-g', '30',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', clip
  ])
  const list: EditList = {
    version: 1,
    shape: 'landscape',
    sources: [{ id: 'main', path: clip, offsetSec: 0 }],
    main: 'main',
    sound: 'main',
    cuts: cuts.map((c) => ({ ...c, why: 'pause' as const })),
    zooms: [],
    markers: []
  }
  const listPath = join(root, 'cuts.json')
  await writeFile(listPath, JSON.stringify(list, null, 2))
  const target = join(root, 'cuts.editbay')
  await run(process.execPath, [CLI, 'build', listPath, '--out', target])
  const project = JSON.parse(await readFile(target, 'utf8'))
  const clips = project.sequences[0].videoTracks[0].clips.length as number
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`, target], cwd: process.cwd(), env: { ...process.env } as Record<string, string> })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  // Recorded, never heard: nothing is played unless the window is muted.
  const muted = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => w.webContents.isAudioMuted()))
  if (!muted) {
    await app.close()
    throw new Error('The window is not muted: the test would play out loud, so it stops here.')
  }
  await page.waitForFunction(
    (n) => {
      const all = [...document.querySelectorAll('[data-testid="clip"]')]
      return all.length >= n && all.every((c) => c.getAttribute('data-rebuilding') !== 'yes' && c.getAttribute('data-offline') !== 'yes')
    },
    clips,
    { timeout: 180_000 }
  )
  await page.click('[data-testid="view-program"]')
  return { app, page, clips }
}

/** What was heard and seen while playing. */
export interface Played {
  rate: number
  /** Every sample heard, mixed to one channel. */
  samples: number[]
  /** When the first of `samples` came out, on the page's clock, in ms. */
  firstAt: number
  /** When Play was pressed, on the same clock. */
  pressedAt: number
  /** When the middle of the picture turned bright, on the same clock. */
  flashes: number[]
  /** Whether the sound engine played it, rather than the players. */
  engine: boolean
}

/**
 * Play from the start for `seconds`, everything heard recorded as it comes
 * out. The sound engine (plan 106) is tapped where its stretches meet; the
 * players before it, through a context of the test's own. Whichever played
 * is what is returned.
 */
export async function recordPlaying(page: Page, seconds: number): Promise<Played> {
  await page.evaluate(async () => {
    type Rec = { rate: number; chunks: Float32Array[]; at: number[]; on: boolean }
    const w = window as unknown as {
      __heard: { players: Rec; engine: Rec; flashes: number[]; pressedAt: number }
      __heardTap?: { ctx: AudioContext; sum: GainNode; tapped: WeakSet<HTMLMediaElement>; connect: (this: AudioNode, ...a: unknown[]) => unknown }
    }
    const recorder = (c: AudioContext, rec: Rec): ScriptProcessorNode => {
      const tap = c.createScriptProcessor(2048, 1, 1)
      tap.channelCount = 1
      tap.channelCountMode = 'explicit'
      tap.onaudioprocess = (e) => {
        if (!rec.on) return
        rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
        // When this block is heard, on the page's clock.
        const stamp = c.getOutputTimestamp()
        rec.at.push((stamp.performanceTime ?? 0) + (e.playbackTime - (stamp.contextTime ?? 0)) * 1000)
      }
      const quiet = c.createGain()
      quiet.gain.value = 0
      tap.connect(quiet)
      quiet.connect(c.destination)
      return tap
    }
    // One context for the page, kept: a player can be tapped only once, and a
    // test tried again records on the same page (task 1388).
    if (!w.__heardTap) {
      const c = new AudioContext()
      w.__heardTap = { ctx: c, sum: c.createGain(), tapped: new WeakSet(), connect: AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown }
    }
    const kept = w.__heardTap
    const ctx = kept.ctx
    await ctx.resume()
    const players: Rec = { rate: ctx.sampleRate, chunks: [], at: [], on: false }
    const sum = kept.sum
    for (const el of document.querySelectorAll<HTMLMediaElement>('video[data-testid="track-video"], audio[data-testid="track-player"]')) {
      if (kept.tapped.has(el)) continue
      kept.tapped.add(el)
      ctx.createMediaElementSource(el).connect(sum)
    }
    sum.disconnect()
    sum.connect(recorder(ctx, players))
    const engine: Rec = { rate: 0, chunks: [], at: [], on: false }
    const tapped = new WeakSet<AudioNode>()
    const connect = kept.connect
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const target = args[0]
      if (this instanceof GainNode && target instanceof GainNode && !tapped.has(target) && target.context !== ctx) {
        tapped.add(target)
        const c = target.context as AudioContext
        engine.rate = c.sampleRate
        connect.call(target, recorder(c, engine))
      }
      return connect.apply(this, args)
    } as typeof AudioNode.prototype.connect
    // The middle of the picture, on every frame the page draws.
    const flashes: number[] = []
    let bright = false
    const canvas = document.querySelector('canvas[data-testid="program-canvas"]') as HTMLCanvasElement
    const look = (): void => {
      const d = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
      const now = d[0]! + d[1]! + d[2]! > 300
      if (now && !bright && players.on) flashes.push(performance.now())
      bright = now
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    w.__heard = { players, engine, flashes, pressedAt: 0 }
  })
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Home')
  await page.evaluate(() => {
    const h = (window as unknown as { __heard: { players: { on: boolean }; engine: { on: boolean }; pressedAt: number } }).__heard
    h.players.on = true
    h.engine.on = true
    h.pressedAt = performance.now()
  })
  await page.keyboard.press('Space')
  await page.waitForTimeout(seconds * 1000)
  await page.keyboard.press('Space')
  return page.evaluate(() => {
    type Rec = { rate: number; chunks: Float32Array[]; at: number[]; on: boolean }
    const h = (window as unknown as { __heard: { players: Rec; engine: Rec; flashes: number[]; pressedAt: number } }).__heard
    h.players.on = false
    h.engine.on = false
    const loud = (r: Rec): number => r.chunks.reduce((m, c) => Math.max(m, ...c.map(Math.abs)), 0)
    const rec = loud(h.engine) > loud(h.players) ? h.engine : h.players
    const samples: number[] = []
    for (const c of rec.chunks) for (const v of c) samples.push(v)
    return { rate: rec.rate, samples, firstAt: rec.at[0] ?? 0, pressedAt: h.pressedAt, flashes: [...h.flashes], engine: rec === h.engine }
  })
}

/** The page's clock time a sample came out at. */
export function sampleAt(p: Played, i: number): number {
  return p.firstAt + (i / p.rate) * 1000
}
