import { describe, it, expect } from 'vitest'
import {
  addSource,
  addTrack,
  cleanedFile,
  createTimeline,
  createProject,
  findClip,
  playedByPicture,
  setClipDenoise,
  setClipAudio,
  wantingCleanCopy,
  type Project,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from '../../src/shared/project'
import { previewSoundFile } from '../../src/shared/sound'
import { planRender, trackCopiesRead } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'

/**
 * Plan 51: Clean up noise on a sound clip plays its track's cleaned copy, in
 * the preview and the export, once the copy is made.
 */

function recording(overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id: 'rec',
    originalPath: 'C:\v\rec.mp4',
    playablePath: 'C:\v\rec.mp4',
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    ...overrides
  }
}

/** A recording on V1, with its sound on A1. */
function cut(m = recording()): Timeline {
  const t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [m] }
  return addSource(t, { mediaId: 'rec', clipId: 'c' })
}

const soundOf = (t: Timeline): SoundClip => t.audioTracks[0]!.clips[0]!

function projectOf(t: Timeline): Project {
  const p = createProject('x', 30, { width: 1080, height: 1920 })
  return { ...p, media: t.media, sequences: [{ ...p.sequences[0]!, videoTracks: t.videoTracks, audioTracks: t.audioTracks }] }
}

describe('Clean up noise on a sound clip', () => {
  it('is on or absent, on that clip alone, and never on a picture', () => {
    const t = cut()
    const s = soundOf(t)
    const on = setClipDenoise(t, s.id, true)
    expect((findClip(on, s.id)!.clip as SoundClip).denoise).toBe(true)
    expect('denoise' in (findClip(setClipDenoise(on, s.id, false), s.id)!.clip as SoundClip)).toBe(false)
    expect(setClipDenoise(t, 'c', true)).toEqual(t)
  })

  it('plays from a player of its own, since it plays another file', () => {
    const t = cut()
    expect(playedByPicture(t, soundOf(t))).not.toBeNull()
    const on = setClipDenoise(t, soundOf(t).id, true)
    expect(playedByPicture(on, soundOf(on))).toBeNull()
  })

  it('asks for a cleaned copy of the track it plays, once, until there is one, and not while muted', () => {
    let t = setClipDenoise(cut(), soundOf(cut()).id, true)
    expect(wantingCleanCopy(projectOf(t)).map((w) => [w.media.id, w.track])).toEqual([['rec', 0]])
    expect(wantingCleanCopy(projectOf(setClipAudio(t, soundOf(t).id, { gain: 1, muted: true })))).toEqual([])
    t = { ...t, media: [{ ...t.media[0]!, cleaned: [{ track: 0, path: 'C:\cache\k\cleaned-1.m4a' }] }] }
    expect(wantingCleanCopy(projectOf(t))).toEqual([])
    expect(cleanedFile(t.media[0]!, 0)).toBe('C:\cache\k\cleaned-1.m4a')
  })

  it('is heard from the cleaned copy in the preview once it is there, and as recorded until then', () => {
    const m = recording({ soundCopy: 'C:\cache\k\track-1.m4a', startSec: 0.02 })
    expect(previewSoundFile(m, 0, true)).toEqual({ path: 'C:\cache\k\track-1.m4a', offsetSec: 0 })
    const cleaned = { ...m, cleaned: [{ track: 0, path: 'C:\cache\k\cleaned-1.m4a' }] }
    expect(previewSoundFile(cleaned, 0, true)).toEqual({ path: 'C:\cache\k\cleaned-1.m4a', offsetSec: 0 })
    expect(previewSoundFile(cleaned, 0, false)).toEqual({ path: 'C:\cache\k\track-1.m4a', offsetSec: 0 })
  })

  it('is exported from the cleaned copy, never out of the picture\'s own recording, and the export checks it is there', () => {
    const m = recording({ cleaned: [{ track: 0, path: 'C:\cache\k\cleaned-1.m4a' }] })
    let t = cut(m)
    t = setClipDenoise(t, soundOf(t).id, true)
    const plan = planRender({
      timeline: t,
      names: { project: 'p', sequence: 's', joined: 'p' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: 'D:\out',
      scratchDir: 'D:\out\.s',
      filenamePattern: '{project}'
    })
    const args = plan.segments[0]!.args
    expect(args.filter((_, i) => args[i - 1] === '-i')).toContain('C:\cache\k\cleaned-1.m4a')
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('[0:a:0]')
    expect(trackCopiesRead(t, 'join').map((c) => c.path)).toContain('C:\cache\k\cleaned-1.m4a')
  })
})

describe('a cleaned copy on another track', () => {
  it('is its own, by track', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [recording()] }
    t = addTrack(t, 'audio', 'a2')
    const m = { ...recording(), cleaned: [{ track: 1, path: 'C:\cache\k\cleaned-2.m4a' }] }
    expect(cleanedFile(m, 1)).toBe('C:\cache\k\cleaned-2.m4a')
    expect(cleanedFile(m, 0)).toBeNull()
  })
})
