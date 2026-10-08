import { describe, it, expect } from 'vitest'
import { addClip, addSource, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'
import {
  DEFAULT_SILENCE_SETTINGS,
  PAUSE_JUDGEMENTS,
  judgementOf,
  whatYouGetBack,
  type SilenceSettings
} from '../../src/shared/silences'

/**
 * Plan 21, step 1: Remove silences says what you get back, and offers three
 * named ways to judge a pause instead of three decibel figures with nothing
 * to hear them against.
 */

function media(id: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
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

/** Ten seconds of talking on V1, with its sound. */
function cut(): Timeline {
  const t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 10)]
  }
  return addClip(t, 'talk', 'p1')
}

describe('the three ways to judge a pause', () => {
  it('offers exactly three, each with a whole set of numbers behind it', () => {
    expect(PAUSE_JUDGEMENTS.map((j) => j.id)).toEqual(['careful', 'normal', 'tight'])
    for (const j of PAUSE_JUDGEMENTS) {
      expect(j.name).not.toBe('')
      expect(j.what).not.toBe('')
      expect(j.settings.levelDb).toBeLessThan(0)
      expect(j.settings.shortestSec).toBeGreaterThan(0)
      expect(j.settings.leaveSec).toBeGreaterThanOrEqual(0)
    }
  })

  it('gets tighter from one to the next, which is what the names promise', () => {
    const [careful, normal, tight] = PAUSE_JUDGEMENTS as [typeof PAUSE_JUDGEMENTS[0], typeof PAUSE_JUDGEMENTS[0], typeof PAUSE_JUDGEMENTS[0]]
    // Louder counts as quiet, a shorter run counts as a pause, less is left.
    expect(careful.settings.levelDb).toBeLessThan(normal.settings.levelDb)
    expect(normal.settings.levelDb).toBeLessThan(tight.settings.levelDb)
    expect(careful.settings.shortestSec).toBeGreaterThan(normal.settings.shortestSec)
    expect(normal.settings.shortestSec).toBeGreaterThan(tight.settings.shortestSec)
    expect(careful.settings.leaveSec).toBeGreaterThan(normal.settings.leaveSec)
    expect(normal.settings.leaveSec).toBeGreaterThan(tight.settings.leaveSec)
  })

  it('has Normal as the settings the app already starts with', () => {
    expect(PAUSE_JUDGEMENTS.find((j) => j.id === 'normal')?.settings).toEqual(DEFAULT_SILENCE_SETTINGS)
    expect(judgementOf(DEFAULT_SILENCE_SETTINGS)).toBe('normal')
  })

  it('names the one a set of numbers is', () => {
    for (const j of PAUSE_JUDGEMENTS) expect(judgementOf(j.settings)).toBe(j.id)
  })

  it('names none for numbers typed by hand', () => {
    const typed: SilenceSettings = { ...DEFAULT_SILENCE_SETTINGS, levelDb: -38 }
    expect(judgementOf(typed)).toBe(null)
  })
})

describe('what you get back', () => {
  it('says how long it is now, how long it would be, and the difference', () => {
    const t = cut()
    const got = whatYouGetBack(t, [{ from: 30, to: 60 }, { from: 90, to: 120 }])
    expect(got.now).toBe(300)
    expect(got.saved).toBe(60)
    expect(got.after).toBe(240)
  })

  it('says nothing is saved when nothing is being taken', () => {
    const got = whatYouGetBack(cut(), [])
    expect(got.saved).toBe(0)
    expect(got.after).toBe(got.now)
  })

  it('counts the music under the talking in how long it is now', () => {
    let t = cut()
    t = { ...t, media: [...t.media, media('song', 30, { hasVideo: false, width: 0, height: 0 })] }
    t = addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
    // The song runs past the picture, so the sequence is as long as the song.
    expect(whatYouGetBack(t, []).now).toBe(900)
  })

  it('never says the sequence would be shorter than nothing', () => {
    const got = whatYouGetBack(cut(), [{ from: 0, to: 100_000 }])
    expect(got.after).toBe(0)
    expect(got.saved).toBe(got.now)
  })
})
