import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeFile } from '../../src/main/media/probe'
import { engineReady, enginePaths } from '../../src/main/speech/engine'
import { transcribe } from '../../src/main/speech/transcribe'
import { addSource, createTimeline, listenTracks, setClipOut, type ProjectMedia } from '../../src/shared/project'
import { formatTimecode } from '../../src/shared/time'

/**
 * The real speech engine over real footage: the first minute of each file
 * the smoke suite is pointed at, with sound, captioned, and the words written
 * to the log to be checked by eye.
 *
 * The engine is the one the app downloads, in its data folder, or the one in
 * the folder EDITBAY_SPEECH_DIR names. Without it, the suite skips.
 */

const LIST_FILE = join(process.cwd(), 'test', 'smoke', 'media.local.txt')

function mediaPaths(): string[] {
  const fromEnv = process.env.EDITBAY_SMOKE_MEDIA ?? ''
  const fromFile = existsSync(LIST_FILE) ? readFileSync(LIST_FILE, 'utf8') : ''
  return [...fromEnv.split(';'), ...fromFile.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'))
}

const folder = process.env.EDITBAY_SPEECH_DIR ?? join(process.env.APPDATA ?? '', 'Editbay', 'speech')
const ready = await engineReady(folder)
const paths = mediaPaths()
const work = await mkdtemp(join(tmpdir(), 'editbay-smoke-captions-'))
const FPS = 30
/** A minute is enough to judge the words by, and keeps the suite quick. */
const MINUTE = 60 * FPS

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

describe.skipIf(!ready || paths.length === 0)('captions of real footage', () => {
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path
    it(`hears the words in ${name}`, async () => {
      const probed = await probeFile(path)
      if (!probed.audio) return
      const media: ProjectMedia = {
        id: 'real',
        originalPath: path,
        playablePath: path,
        conformed: false,
        conformReasons: [],
        durationSec: probed.durationSec,
        width: probed.video.width,
        height: probed.video.height,
        fps: probed.video.averageFps,
        codec: probed.video.codec,
        hasAudio: true,
        peaksPath: '',
        filmstripPath: ''
      }
      let t = { ...createTimeline(FPS, { width: 1080, height: 1920 }), media: [media] }
      t = addSource(t, { mediaId: 'real', clipId: 'real', at: 0, onTrack: 'v1', streams: [0] })
      t = setClipOut(t, 'real', MINUTE)
      const started = Date.now()
      const words = await transcribe({
        timeline: t,
        trackIds: listenTracks(t),
        runner: { command: enginePaths(folder).cli, prefix: [] },
        model: enginePaths(folder).model,
        dtw: enginePaths(folder).dtw,
        scratchDir: join(work, `scratch-${Date.now()}`),
        onProgress: () => undefined
      })
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`${name}: ${words.length} words in ${seconds} s\n${words.map((w) => `${formatTimecode(w.start, FPS)} ${w.text}`).join('\n')}`)
      // In order, each at least a frame long, and all inside the minute listened to.
      for (const [i, w] of words.entries()) {
        expect(w.length).toBeGreaterThanOrEqual(1)
        if (i > 0) expect(w.start).toBeGreaterThanOrEqual(words[i - 1]!.start + words[i - 1]!.length)
        expect(w.start).toBeLessThan(MINUTE + FPS)
      }
    }, 600_000)
  }
})
