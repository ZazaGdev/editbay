import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { probeFile } from '../../src/main/media/probe'
import { targetFrameRate } from '../../src/main/media/conform'
import {
  FIRST_SEQUENCE_ID,
  addSource,
  createProject,
  editSequence,
  setClipIn,
  setClipOut,
  timelineOf,
  upsertMedia,
  v1End,
  type Project,
  type ProjectMedia
} from '../../src/shared/project'
import { defaultWorkspace } from '../../src/shared/workspace'
import { joinProjectFile } from '../../src/shared/project-file'

/**
 * Plan 74, step 1: a project written outside the app, whose sources are all
 * marked conformed with cache files that are not there, opens in Editbay and
 * every source goes through the app's own import, as after the cache is
 * cleared. The command line tool's `build` writes projects this way, so this
 * is the route everything it makes depends on.
 *
 * The frames a clip is cut at are the recording's seconds at the project
 * rate. A recording with variable timing is conformed on import, and the
 * frames written before it was conformed must still show the same moments.
 */

const fx = fixtureSet('written-project')
const root = await mkdtemp(join(tmpdir(), 'editbay-written-'))
const FPS = 30
let clean: string
let vfr: string
let obs: string

beforeAll(async () => {
  ;[clean, vfr, obs] = [await fx.cleanClip(), await fx.vfrClip(), await fx.obsClip()]
}, 180_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function launch(userData: string, project: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, project],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
}

async function closeAndWait(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await closed
}

/** A source as a tool that never imported it would describe it: probed, and conformed into a cache that is not there. */
async function unimported(id: string, path: string, gone: string): Promise<ProjectMedia> {
  const p = await probeFile(path)
  return {
    id,
    originalPath: path,
    playablePath: join(gone, id, 'conformed.mp4'),
    conformed: true,
    conformReasons: [],
    durationSec: p.durationSec,
    width: p.video.width,
    height: p.video.height,
    fps: targetFrameRate(p),
    codec: p.video.codec,
    hasAudio: p.audio !== null,
    peaksPath: join(gone, id, 'peaks.bin'),
    filmstripPath: join(gone, id, 'filmstrip.jpg'),
    audioTracks: p.audioTracks
  }
}

/** One frame of a file at a time, small and grey, for comparing two files' pictures. */
async function frameAt(path: string, sec: number): Promise<Buffer> {
  const { stdout } = await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', sec.toFixed(3), '-i', path,
    // The brightness plane as it is: turned to grey instead, ffmpeg 9 converts
    // by what the file says of its colours, and the converted file says BT.709
    // where the original says nothing (plan 89).
    '-frames:v', '1', '-vf', 'scale=64:36,format=yuv420p,extractplanes=y', '-f', 'rawvideo', '-'
  ])
  return stdout
}

function difference(a: Buffer, b: Buffer): number {
  let sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / Math.max(1, Math.min(a.length, b.length))
}

describe('a project written outside the app', () => {
  it('opens, imports every source through the app, and keeps the clips on the same moments', async () => {
    const files = await mkdtemp(join(root, 'files-'))
    const gone = join(files, 'no-such-cache')
    const media = [await unimported('clean', clean, gone), await unimported('vfr', vfr, gone), await unimported('obs', obs, gone)]

    let project: Project = createProject('written', FPS, { width: 1920, height: 1080 }, 'landscape')
    for (const m of media) project = upsertMedia(project, m)
    // Each source on V1 after the last, its sound linked on A1, then trimmed to a
    // stretch inside it: the VFR one to 1 s to 5 s of its own clock.
    const cuts: Record<string, [number, number]> = { clean: [15, 105], vfr: [30, 150], obs: [30, 75] }
    for (const m of media) {
      project = editSequence(project, FIRST_SEQUENCE_ID, (t) => addSource(t, { mediaId: m.id, clipId: m.id, at: v1End(t), streams: [0] }))
      const [from, to] = cuts[m.id]!
      project = editSequence(project, FIRST_SEQUENCE_ID, (t) => setClipOut(setClipIn(t, m.id, from), m.id, to))
    }
    const written = timelineOf(project, FIRST_SEQUENCE_ID).videoTracks[0]!.clips.map((c) => ({ id: c.id, sourceIn: c.sourceIn, sourceOut: c.sourceOut }))
    expect(written).toEqual([
      { id: 'clean', sourceIn: 15, sourceOut: 105 },
      { id: 'vfr', sourceIn: 30, sourceOut: 150 },
      { id: 'obs', sourceIn: 30, sourceOut: 75 }
    ])
    const target = join(files, 'written.editbay')
    await writeFile(target, joinProjectFile(project, defaultWorkspace()))
    for (const m of media) expect(existsSync(m.playablePath)).toBe(false)

    const { app, page } = await launch(join(files, 'user-data'), target)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3)
    // Every source rebuilt, and none left offline.
    await page.waitForFunction(
      () => {
        const clips = [...document.querySelectorAll('[data-testid="clip"]')]
        return clips.length === 3 && clips.every((c) => c.getAttribute('data-rebuilding') === 'no' && c.getAttribute('data-offline') === 'no')
      },
      undefined,
      { timeout: 180_000 }
    )
    expect(await page.locator('[data-testid="missing-media"]').count()).toBe(0)

    const opened = await page.evaluate(() => window.api.currentProject())
    const byId = new Map(opened.media.map((m) => [m.id, m]))
    // Each one now plays from a file that is there, made by the app's import.
    for (const m of media) {
      const now = byId.get(m.id)!
      expect(existsSync(now.playablePath)).toBe(true)
      expect(existsSync(now.peaksPath)).toBe(true)
      expect(existsSync(now.filmstripPath)).toBe(true)
      expect(now.playablePath).not.toBe(m.playablePath)
    }
    // Only the variable one needed converting; the others play as they are.
    expect(byId.get('vfr')!.conformed).toBe(true)
    expect(byId.get('clean')!.conformed).toBe(false)
    expect(byId.get('obs')!.conformed).toBe(false)
    // The OBS one's second track was copied, as a real import does.
    expect(byId.get('obs')!.trackFiles).toHaveLength(1)

    // The cut is exactly as written: no clip was pulled in by a shorter conformed file.
    const after = opened.sequences[0]!.videoTracks[0]!.clips.map((c) => ({ id: c.id, sourceIn: c.sourceIn, sourceOut: c.sourceOut }))
    expect(after).toEqual(written)
    const sound = opened.sequences[0]!.audioTracks[0]!.clips.map((c) => ({ id: c.mediaId, sourceIn: c.sourceIn, sourceOut: c.sourceOut }))
    expect(sound).toEqual([
      { id: 'clean', sourceIn: 15, sourceOut: 105 },
      { id: 'obs', sourceIn: 30, sourceOut: 75 }
    ])

    // The VFR source's frames mean the same moments in the converted file as
    // in the original: the picture at each clip edge matches the original's at
    // that second, and clearly differs from the original's half a second off.
    const conformed = byId.get('vfr')!.playablePath
    for (const frame of [30, 90, 149]) {
      const sec = frame / FPS
      const same = difference(await frameAt(vfr, sec), await frameAt(conformed, sec))
      const shifted = difference(await frameAt(vfr, sec), await frameAt(conformed, sec + 0.5))
      expect(same).toBeLessThan(4)
      expect(shifted).toBeGreaterThan(same * 3)
    }

    // And the cut plays, through the converted clip and past it.
    const vfrStart = opened.sequences[0]!.videoTracks[0]!.clips[1]!.timelineStart
    await page.keyboard.press('Space')
    await page.waitForFunction(
      (f) => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > f,
      vfrStart + 30,
      { timeout: 20_000 }
    )
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('yes')
    await page.keyboard.press('Space')

    // Opening changed the sources, which is a change to save, as after a cleared cache.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await closeAndWait(app)
  }, 400_000)
})
