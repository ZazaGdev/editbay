import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeFile } from '../../src/main/media/probe'
import { decodePeaks, extractPeaks } from '../../src/main/media/waveform'
import { addSource, allClips, createTimeline, findClip, linkedIds, timelineDuration, v1End, type ProjectMedia } from '../../src/shared/project'
import { DEFAULT_SILENCE_SETTINGS, defaultListenTracks, findPauses, removeStretches } from '../../src/shared/silences'
import { peaksKey } from '../../src/shared/sound'

/**
 * Remove silences against real footage: the pauses found in each recording's
 * first audio stream at the default settings, their count and length written
 * to the log for a person to look over, and taking them all out checked to
 * leave the sequence whole and in step. The files come from the same list as
 * the rest of the smoke suite; with none, it skips.
 */

const LIST_FILE = join(process.cwd(), 'test', 'smoke', 'media.local.txt')

function mediaPaths(): string[] {
  const fromEnv = process.env.EDITBAY_SMOKE_MEDIA ?? ''
  const fromFile = existsSync(LIST_FILE) ? readFileSync(LIST_FILE, 'utf8') : ''
  return [...fromEnv.split(';'), ...fromFile.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'))
}

const paths = mediaPaths()
const dir = await mkdtemp(join(tmpdir(), 'editbay-smoke-silences-'))

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe.skipIf(paths.length === 0)('removing silences from real footage', () => {
  paths.forEach((path, i) => {
    const name = path.split(/[\\/]/).pop() ?? path
    it(`finds the pauses in ${name}, and takes them out leaving it whole`, async () => {
      const probe = await probeFile(path)
      if (!probe.audio) {
        console.log(`  ${name}: no sound, nothing to look for`)
        return
      }
      const peaksPath = join(dir, `${i}.peaks`)
      await extractPeaks(path, peaksPath, probe.durationSec, true)
      const m: ProjectMedia = {
        id: `m${i}`,
        originalPath: path,
        playablePath: path,
        conformed: false,
        conformReasons: [],
        durationSec: probe.durationSec,
        width: probe.video.width,
        height: probe.video.height,
        fps: probe.video.averageFps,
        codec: probe.video.codec,
        hasAudio: true,
        peaksPath,
        filmstripPath: '',
        audioTracks: probe.audioTracks
      }
      const fps = 30
      let t = { ...createTimeline(fps, { width: 1080, height: 1920 }), media: [m] }
      t = addSource(t, { mediaId: m.id, clipId: 'A', at: 0, onTrack: 'v1' })
      const peaks = new Map([[peaksKey(m.id, 0), decodePeaks(await readFile(peaksPath))]])

      const found = findPauses(t, peaks, new Set(defaultListenTracks(t)), DEFAULT_SILENCE_SETTINGS)
      const frames = found.pauses.reduce((sum, p) => sum + (p.to - p.from), 0)
      const longest = found.pauses.reduce((most, p) => Math.max(most, p.to - p.from), 0)
      console.log(
        `  ${name}: ${found.pauses.length} pauses in ${probe.durationSec.toFixed(1)} s, ` +
          `${(frames / fps).toFixed(1)} s to take out, the longest ${(longest / fps).toFixed(1)} s` +
          (found.pauses.length > 0 ? `, the first at ${(found.pauses[0]!.from / fps).toFixed(1)} s` : '')
      )
      expect(found.waiting).toBe(false)

      const out = removeStretches(t, found.pauses)
      expect(timelineDuration(out)).toBe(timelineDuration(t) - frames)
      expect(timelineDuration(out)).toBe(v1End(out))
      for (const c of allClips(out)) {
        for (const id of linkedIds(out, c.id)) {
          const o = findClip(out, id)!.clip
          expect(o.timelineStart - o.sourceIn).toBe(c.timelineStart - c.sourceIn)
        }
      }
    }, 300_000)
  })
})
