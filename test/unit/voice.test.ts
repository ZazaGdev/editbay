import { describe, it, expect } from 'vitest'
import {
  addSource,
  createProject,
  createTimeline,
  enhancedFile,
  findClip,
  playedByPicture,
  playedCopy,
  setClipAudio,
  setClipDenoise,
  setClipVoice,
  wantingVoiceCopy,
  type Project,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from '../../src/shared/project'
import { MAX_VOICE_LIFT_DB, voiceLift, voiceRecipe } from '../../src/shared/voice'
import { previewSoundFile } from '../../src/shared/sound'
import { planRender, trackCopiesRead } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { withUsablePaths } from '../../src/shared/source-paths'

/**
 * Plan 56: Enhance voice on a sound clip plays its track through a voice
 * chain, from a copy made once, in the preview and the export alike.
 */

const CLEANED = 'C:\\cache\\k\\cleaned-1.m4a'
const VOICE = 'C:\\cache\\k\\voice-1-v1-normal.m4a'
const VOICE_CLEAN = 'C:\\cache\\k\\voice-1-v1-clean-normal.m4a'

function recording(overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id: 'rec',
    originalPath: 'C:\\v\\rec.mp4',
    playablePath: 'C:\\v\\rec.mp4',
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

function cut(m = recording()): Timeline {
  const t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [m] }
  return addSource(t, { mediaId: 'rec', clipId: 'c' })
}

const soundOf = (t: Timeline): SoundClip => t.audioTracks[0]!.clips[0]!

function projectOf(t: Timeline): Project {
  const p = createProject('x', 30, { width: 1080, height: 1920 })
  return { ...p, media: t.media, sequences: [{ ...p.sequences[0]!, videoTracks: t.videoTracks, audioTracks: t.audioTracks }] }
}

describe('the recipe and the level', () => {
  it('names a copy by its version, strength and whether it is made from the cleaned copy', () => {
    expect(voiceRecipe('normal', false)).toBe('v1-normal')
    expect(voiceRecipe('strong', true)).toBe('v1-clean-strong')
  })

  it('puts back what the chain took, never more than the cap, never a cut, and nothing for silence', () => {
    expect(voiceLift(-20, -24.2)).toBe(4.2)
    expect(voiceLift(-10, -40)).toBe(MAX_VOICE_LIFT_DB)
    expect(voiceLift(-20, -18)).toBe(0)
    expect(voiceLift(-60, -70)).toBe(0)
    expect(voiceLift(null, -20)).toBe(0)
    expect(voiceLift(-20, Number.NaN)).toBe(0)
  })
})

describe('Enhance voice on a sound clip', () => {
  it('is a strength or absent, on that clip alone, and never on a picture', () => {
    const t = cut()
    const s = soundOf(t)
    const on = setClipVoice(t, s.id, 'strong')
    expect((findClip(on, s.id)!.clip as SoundClip).voice).toBe('strong')
    expect('voice' in (findClip(setClipVoice(on, s.id, null), s.id)!.clip as SoundClip)).toBe(false)
    expect(setClipVoice(t, 'c', 'normal')).toEqual(t)
  })

  it('plays from a player of its own, since it plays another file', () => {
    const t = cut()
    const on = setClipVoice(t, soundOf(t).id, 'normal')
    expect(playedByPicture(on, soundOf(on))).toBeNull()
  })

  it('asks for a copy once, not while muted, and waits for the cleaned copy it is made from', () => {
    let t = setClipVoice(cut(), soundOf(cut()).id, 'normal')
    expect(wantingVoiceCopy(projectOf(t)).map((w) => [w.track, w.strength, w.clean])).toEqual([[0, 'normal', false]])
    expect(wantingVoiceCopy(projectOf(setClipAudio(t, soundOf(t).id, { gain: 1, muted: true })))).toEqual([])
    t = { ...t, media: [{ ...t.media[0]!, enhanced: [{ track: 0, recipe: 'v1-normal', path: VOICE }] }] }
    expect(wantingVoiceCopy(projectOf(t))).toEqual([])
    // With Clean up noise too it is another copy, made only once the cleaned one is there.
    t = setClipDenoise(t, soundOf(t).id, true)
    expect(wantingVoiceCopy(projectOf(t))).toEqual([])
    t = { ...t, media: [{ ...t.media[0]!, cleaned: [{ track: 0, path: CLEANED }] }] }
    expect(wantingVoiceCopy(projectOf(t)).map((w) => [w.strength, w.clean])).toEqual([['normal', true]])
  })

  it('plays the best copy there is: enhanced, else cleaned, else the track', () => {
    const m = recording({
      cleaned: [{ track: 0, path: CLEANED }],
      enhanced: [{ track: 0, recipe: 'v1-normal', path: VOICE }]
    })
    expect(playedCopy(m, { track: 0, voice: 'normal' })).toBe(VOICE)
    // Asked with Clean up noise on, the copy made from the cleaned one is not there yet: the cleaned copy plays.
    expect(playedCopy(m, { track: 0, voice: 'normal', denoise: true })).toBe(CLEANED)
    expect(playedCopy(m, { track: 0, voice: 'strong' })).toBeNull()
    expect(playedCopy(m, { track: 0 })).toBeNull()
    expect(enhancedFile(m, 0, 'v1-normal')).toBe(VOICE)
    expect(previewSoundFile(m, 0, false, 'normal')).toEqual({ path: VOICE, offsetSec: 0 })
    const both = { ...m, enhanced: [...m.enhanced!, { track: 0, recipe: 'v1-clean-normal', path: VOICE_CLEAN }] }
    expect(previewSoundFile(both, 0, true, 'normal')).toEqual({ path: VOICE_CLEAN, offsetSec: 0 })
  })

  it('is exported from the enhanced copy, and the export checks it is there', () => {
    let t = cut(recording({ enhanced: [{ track: 0, recipe: 'v1-normal', path: VOICE }] }))
    t = setClipVoice(t, soundOf(t).id, 'normal')
    const plan = planRender({
      timeline: t,
      names: { project: 'p', sequence: 's', joined: 'p' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: 'D:\\out',
      scratchDir: 'D:\\out\\.s',
      filenamePattern: '{project}'
    })
    const args = plan.segments[0]!.args
    expect(args.filter((_, i) => args[i - 1] === '-i')).toContain(VOICE)
    const read = trackCopiesRead(t, 'join').find((c) => c.path === VOICE)
    expect(read?.label).toMatch(/enhanced voice/)
  })
})

describe('Enhance voice in a saved project', () => {
  it('keeps a strength it knows and drops anything else', () => {
    const t = setClipVoice(cut(), soundOf(cut()).id, 'light')
    const p = projectOf(t)
    const text = joinProjectFile(p, defaultWorkspace())
    const kept = splitProjectFile(text).project
    const sound = (x: Project): SoundClip => x.sequences[0]!.audioTracks[0]!.clips[0]!
    expect(sound(kept).voice).toBe('light')
    expect(text).toContain('"voice": "light"')
    const bad = splitProjectFile(text.replace('"voice": "light"', '"voice": "loud"')).project
    expect('voice' in sound(bad)).toBe(false)
  })

  it('forgets an enhanced copy anywhere but the cache', () => {
    const rules = { allowed: new Set<string>(), cacheDir: 'C:\\cache', offlineDir: 'C:\\offline' }
    const inCache = recording({ enhanced: [{ track: 0, recipe: 'v1-normal', path: VOICE }] })
    expect(withUsablePaths(inCache, rules).enhanced).toEqual(inCache.enhanced)
    const outside = recording({ enhanced: [{ track: 0, recipe: 'v1-normal', path: 'D:\\elsewhere\\voice.m4a' }] })
    expect(withUsablePaths(outside, rules).enhanced).toBeUndefined()
  })
})
