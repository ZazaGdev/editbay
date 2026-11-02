import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'
import type { EditListV2 } from '../../src/shared/edit-list'
import type { Project } from '../../src/shared/project'

/**
 * Task 1188: what an editing agent writes into an edit list, built by
 * `npm run cli -- build`, opened in Editbay and exported. A Short of an OBS
 * canvas, screen left and camera right, with its voice on the left only:
 * both halves stacked (split), a full-camera hook, the camera graded warm,
 * a quick punch-in (easeSec), a sound effect, a song under it, a stretch of
 * voice raised 6 dB, and the left channel played on both sides. The Output
 * view shows what the export writes, and the exported sound has each in it.
 */

const run = promisify(execFile)
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-cli-agent-'))
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')
const shots = process.env.EDITBAY_SHOTS ?? root
let app: ElectronApplication
let page: Page

type Rgb = [number, number, number]
const RED: Rgb = [255, 0, 0]
const GREY: Rgb = [128, 128, 128]

beforeAll(async () => {
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
}, 180_000)

afterAll(async () => {
  if (app) await discardUnsavedWork(app).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function ffmpeg(args: string[]): Promise<void> {
  await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
}

/** One pixel of a picture file, at shares of the part of it `frame` gives. */
async function pixel(file: string, at: [number, number], frame: (w: number, h: number) => { x: number; y: number; w: number; h: number }): Promise<Rgb> {
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const [, w = '0', h = '0'] = String(probe).match(/, (\d+)x(\d+)/) ?? []
  const f = frame(Number(w), Number(h))
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${Math.round(f.x + at[0] * f.w)}:${Math.round(f.y + at[1] * f.h)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0]!, stdout[1]!, stdout[2]!]
}

const near = (a: Rgb, b: Rgb, by = 24): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= by)
/** Grey through the Warm look: red up, blue down. */
const warmed = (c: Rgb): boolean => c[0] - c[2] > 20 && c[1] > 90 && c[1] < 170

async function seek(frame: number): Promise<void> {
  await page.click('[data-testid="monitor-timecode"]')
  await page.fill('[data-testid="timecode-input"]', `${frame}f`)
  await page.press('[data-testid="timecode-input"]', 'Enter')
  await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(frame))
}

/** The colour at each point on `frame`, as an exported frame writes it and as the Output view shows it once it agrees. */
async function colours(frame: number, points: [number, number][], name: string): Promise<{ file: Rgb[]; view: Rgb[] }> {
  await seek(frame)
  const output = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.output)
  const saved = await page.evaluate(async (r) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: r.frame, outputDir: r.dir })
  }, { frame, dir: join(root, 'frames') })
  expect(saved.error).toBeUndefined()
  const file: Rgb[] = []
  for (const p of points) file.push(await pixel(saved.path!, p, (w, h) => ({ x: 0, y: 0, w, h })))
  const shot = join(shots, name)
  let view: Rgb[] = []
  for (let i = 0; i < 20; i++) {
    await writeFile(shot, await page.locator('[data-testid="program-canvas"]').screenshot())
    view = []
    for (const p of points) {
      view.push(
        await pixel(shot, p, (w, h) => {
          const fit = fitInBox(output.width, output.height, w, h)
          return { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
        })
      )
    }
    if (view.every((c, k) => near(c, file[k]!))) break
    await page.waitForTimeout(150)
  }
  return { file, view }
}

/** How loud each side of a file is from `from` for `length` seconds, in dB RMS, through a band round `hz` when given. */
async function loudness(file: string, from: number, length: number, hz?: number): Promise<number[]> {
  const band = hz ? `bandpass=f=${hz}:width_type=q:w=8,` : ''
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-ss', String(from), '-t', String(length), '-i', file, '-map', '0:a:0', '-af', `${band}astats=measure_overall=none:measure_perchannel=RMS_level`, '-f', 'null', '-'])
  return [...stderr.toString().matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -200 : Number(m[1])))
}

describe("the edit agent's additions, built from an edit list", () => {
  it('opens in Editbay and exports each of them as the Output view shows it', async () => {
    const fx = join(root, 'fx')
    await mkdir(fx, { recursive: true })
    // Six seconds of an OBS canvas, 1920x540: the screen red on the left, the camera grey on the right,
    // and a 440 Hz voice on the left channel only.
    const obs = join(fx, 'obs.mp4')
    await ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=red:s=960x540:r=30:d=6',
      '-f', 'lavfi', '-i', 'color=c=0x808080:s=960x540:r=30:d=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
      '-filter_complex', '[0:v][1:v]hstack=inputs=2,format=yuv420p[v];[2:a]pan=stereo|c0=c0|c1=0*c0[a]',
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', obs
    ])
    // A 1 kHz pop, 0.3 s, and a 330 Hz song.
    const pop = join(fx, 'pop.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.3', '-ac', '2', pop])
    const song = join(fx, 'song.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=10', '-ac', '2', song])

    const list: EditListV2 = {
      version: 2,
      shape: 'vertical',
      reels: [
        {
          sources: [{ id: 'obs', path: obs, offsetSec: 0 }],
          main: 'obs',
          sound: 'obs',
          soundChannel: 'left',
          view: 'split',
          cuts: [],
          zooms: [{ fromSec: 3, toSec: 3.8, rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, how: 'smooth', easeSec: 0.2, why: 'Punch-in: the app name' }],
          markers: [],
          shots: [{ fromSec: 0, toSec: 1, view: 'right', why: 'the hook' }],
          grade: { source: 'obs', view: 'right', look: 'warm' },
          sounds: [{ path: pop, fromSec: 2, why: 'pop' }],
          gains: [{ fromSec: 4, toSec: 5, gainDb: 6, why: 'quiet stretch' }]
        }
      ],
      music: [{ path: song, gainDb: -12, fadeOutSec: 0.5 }]
    }
    const listPath = join(root, 'short.json')
    await writeFile(listPath, JSON.stringify(list, null, 2))
    const target = join(root, 'short.editbay')
    const { stdout } = await run(process.execPath, [CLI, 'build', listPath, '--out', target])
    const built = JSON.parse(stdout) as { ok: boolean; sounds: { atSec: number; toSec: number; gainDb: number }[] }
    expect(built.ok).toBe(true)
    expect(built.sounds.map((s) => [s.atSec, s.toSec, Math.round(s.gainDb)])).toEqual([
      [0, 6, -12],
      [2, 2.3, 0]
    ])

    app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`, target], cwd: process.cwd(), env: { ...process.env } as Record<string, string> })
    page = await app.firstWindow()
    await page.waitForSelector('main')
    // Every clip in, the sound-only ones too, and nothing missing.
    await page.waitForFunction(
      () => {
        const clips = [...document.querySelectorAll('[data-testid="clip"]')]
        return clips.length > 0 && clips.every((c) => c.getAttribute('data-rebuilding') === 'no' && c.getAttribute('data-offline') === 'no')
      },
      undefined,
      { timeout: 180_000 }
    )
    expect(await page.locator('[data-testid="missing-media"]').count()).toBe(0)
    const project = (await page.evaluate(() => window.api.currentProject())) as Project
    const s = project.sequences[0]!
    // The punch-in pushes in over 6 frames, not 15.
    const zoomed = s.videoTracks[0]!.clips.find((c) => (c.transform.keys ?? []).length > 0)!
    expect(zoomed.transform.keys!.map((k) => k.at)).toEqual([90, 96, 108, 114])
    // The voice on both sides, every piece of it; the stretch raised.
    const a1 = s.audioTracks[0]!.clips
    expect(a1.every((c) => c.channel === 'left')).toBe(true)
    expect(a1.find((c) => c.timelineStart === 120)!.gain).toBeCloseTo(2, 2)

    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]')
    const TOP: [number, number] = [0.5, 0.25]
    const BOTTOM: [number, number] = [0.5, 0.75]

    // The hook: the camera alone, filling the frame, graded warm.
    const hook = await colours(15, [TOP, BOTTOM], 'agent-hook.png')
    for (const c of [...hook.file, ...hook.view]) expect(warmed(c), String(c)).toBe(true)
    for (const [k, c] of hook.view.entries()) expect(near(c, hook.file[k]!), `${c} against ${hook.file[k]}`).toBe(true)

    // Split: the screen above, as recorded, and the camera below, graded as in the hook.
    const split = await colours(45, [TOP, BOTTOM], 'agent-split.png')
    for (const got of [split.file, split.view]) {
      expect(near(got[0]!, RED), String(got[0])).toBe(true)
      expect(warmed(got[1]!), String(got[1])).toBe(true)
      expect(near(got[1]!, GREY, 10), String(got[1])).toBe(false)
    }
    for (const [k, c] of split.view.entries()) expect(near(c, split.file[k]!), `${c} against ${split.file[k]}`).toBe(true)

    // The whole Short exported: the sound.
    const exported = await page.evaluate(
      async (r) => {
        const p = await window.api.currentProject()
        return window.api.startExport({ sequenceId: p.sequences[0]!.id, mode: 'join', outputDir: r.dir, filenamePattern: '{project}', existing: 'replace' })
      },
      { dir: join(root, 'exports') }
    )
    expect(exported.ok).toBe(true)
    const file = exported.outputs[0]!
    // The voice on both sides, as loud on the right as on the left.
    const [left, right] = await loudness(file, 0.3, 1.4, 440)
    expect(left!).toBeGreaterThan(-35)
    expect(Math.abs(left! - right!)).toBeLessThan(1)
    // The pop at 2 s and not before it.
    const [popAt] = await loudness(file, 2.05, 0.2, 1000)
    const [popBefore] = await loudness(file, 1.0, 0.2, 1000)
    expect(popAt! - popBefore!).toBeGreaterThan(20)
    // The song under it all.
    const [songAt] = await loudness(file, 1.0, 0.8, 330)
    expect(songAt!).toBeGreaterThan(-45)
    // The voice 6 dB up from 4 s to 5 s.
    const [before] = await loudness(file, 3.2, 0.6, 440)
    const [raised] = await loudness(file, 4.2, 0.6, 440)
    expect(raised! - before!).toBeGreaterThan(5)
    expect(raised! - before!).toBeLessThan(7)
  }, 500_000)
})
