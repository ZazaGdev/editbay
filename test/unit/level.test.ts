import { describe, it, expect } from 'vitest'
import { addClip, addSource, addTrack, createTimeline, playedByPicture, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { formatLevelDb, levelAt, levelDb, peaksKey } from '../../src/shared/sound'
import { peakAtSecond } from '../../src/shared/peaks'
import type { PeaksData } from '../../src/shared/types'

/**
 * Plan 23: how loud the sequence is at the playhead, read from the waveforms
 * the timeline already draws from. Pure, so the arithmetic behind the meter is
 * tested without a window.
 */

const FULL = 32768

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

const SOUND = { hasVideo: false, width: 0, height: 0 }

/**
 * A waveform one bucket a second, each second as loud as `levels` says, from
 * 0 to 1. Stored as the real thing is, a min and a max for each bucket.
 */
function waveform(levels: number[]): PeaksData {
  const peaks = new Int16Array(levels.length * 2)
  levels.forEach((level, i) => {
    peaks[i * 2] = Math.round(-level * FULL)
    peaks[i * 2 + 1] = Math.round(level * FULL)
  })
  return { peaksPerSecond: 1, durationSec: levels.length, peaks }
}

/** A talking head on V1 with its sound on A1, and music under it on A2. */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 10), media('song', 10, SOUND)]
  }
  t = addClip(t, 'talk', 'p1')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

/** The sound clip of a group, by the id of the clip it came in with. */
function soundOf(t: Timeline, clipId: string): { trackIndex: number; index: number } {
  for (const [trackIndex, track] of t.audioTracks.entries()) {
    const index = track.clips.findIndex((c) => c.id === clipId)
    if (index >= 0) return { trackIndex, index }
  }
  throw new Error(`no sound clip ${clipId}`)
}

/** The same timeline with one change made to one of its sound clips. */
function withSound(t: Timeline, clipId: string, change: { gain?: number; muted?: boolean }): Timeline {
  const { trackIndex, index } = soundOf(t, clipId)
  const tracks = t.audioTracks.map((track, i) => {
    if (i !== trackIndex) return track
    return { ...track, clips: track.clips.map((c, j) => (j === index ? { ...c, ...change } : c)) }
  })
  return { ...t, audioTracks: tracks }
}

/** The ids of the sound clips there are, in the order the tracks hold them. */
function soundIds(t: Timeline): string[] {
  return t.audioTracks.flatMap((track) => track.clips.map((c) => c.id))
}

describe('one bucket of a waveform', () => {
  it('reads the loudest sample in the bucket the second falls in', () => {
    const data = waveform([0.2, 0.8, 0.4])
    expect(peakAtSecond(data.peaks, 1, 0)).toBeCloseTo(0.2, 2)
    expect(peakAtSecond(data.peaks, 1, 1.5)).toBeCloseTo(0.8, 2)
    expect(peakAtSecond(data.peaks, 1, 2.9)).toBeCloseTo(0.4, 2)
  })

  it('reads a bucket whose loudest sample is below the line', () => {
    // A half cycle can be all negative: the meter cares how far from zero it is.
    const peaks = new Int16Array([-Math.round(0.9 * FULL), 0])
    expect(peakAtSecond(peaks, 1, 0)).toBeCloseTo(0.9, 2)
  })

  it('is silent outside the data rather than an error', () => {
    const data = waveform([0.5])
    expect(peakAtSecond(data.peaks, 1, 9)).toBe(0)
    expect(peakAtSecond(data.peaks, 1, -1)).toBe(0)
    expect(peakAtSecond(data.peaks, 0, 0)).toBe(0)
    expect(peakAtSecond(new Int16Array(), 1, 0)).toBe(0)
  })
})

describe('how loud the sequence is at a frame', () => {
  it('reads the clip under the frame, at its own place in the recording', () => {
    const t = cut()
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.1, 0.9, 0.3])]])
    // 30 fps, one bucket a second: frame 45 is a second and a half in.
    expect(levelAt(t, peaks, 45)).toBeCloseTo(0.9, 2)
    expect(levelAt(t, peaks, 5)).toBeCloseTo(0.1, 2)
  })

  it('counts the clip gain, so a quiet take turned up reads as it will export', () => {
    const t = withSound(cut(), soundIds(cut())[0]!, { gain: 2 })
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.4])]])
    expect(levelAt(t, peaks, 0)).toBeCloseTo(0.8, 2)
  })

  it('leaves out what is muted, and what is turned all the way down', () => {
    const ids = soundIds(cut())
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.6])]])
    expect(levelAt(withSound(cut(), ids[0]!, { muted: true }), peaks, 0)).toBe(null)
    expect(levelAt(withSound(cut(), ids[0]!, { gain: 0 }), peaks, 0)).toBe(null)
  })

  it('takes the loudest of the tracks heard at once, not their sum', () => {
    const t = cut()
    const peaks = new Map([
      [peaksKey('talk', 0), waveform([0.5])],
      [peaksKey('song', 0), waveform([0.3])]
    ])
    // Adding them would say 0.8 and read as nearly clipping where it is not.
    expect(levelAt(t, peaks, 0)).toBeCloseTo(0.5, 2)
  })

  it('says nothing at all where nothing is heard, rather than saying silence', () => {
    const t = cut()
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.5])]])
    // Past the end of everything on every track.
    expect(levelAt(t, peaks, 100_000)).toBe(null)
  })

  it('says nothing while the waveform of what is heard has not loaded', () => {
    const t = cut()
    expect(levelAt(t, new Map(), 0)).toBe(null)
    // One of the two in: what it can read is better than nothing.
    const some = new Map([[peaksKey('song', 0), waveform([0.3])]])
    expect(levelAt(t, some, 0)).toBeCloseTo(0.3, 2)
  })

  it('reads a second stream of a recording from its own waveform, once it is heard', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [media('obs', 10, { audioTracks: 2 })]
    }
    t = addClip(t, 'obs', 'p1')
    const peaks = new Map([
      [peaksKey('obs', 0), waveform([0.2])],
      [peaksKey('obs', 1), waveform([0.7])]
    ])
    // A recording's streams after the first come in muted, so the loud one is
    // not counted until it is turned on.
    const second = t.audioTracks.flatMap((r) => r.clips).find((c) => c.track === 1)!
    expect(second.muted).toBe(true)
    expect(levelAt(t, peaks, 0)).toBeCloseTo(0.2, 2)
    expect(levelAt(withSound(t, second.id, { muted: false }), peaks, 0)).toBeCloseTo(0.7, 2)
  })

  it('counts a picture whose own sound is heard, though its picture plays it', () => {
    const t = cut()
    const sound = t.audioTracks[0]!.clips[0]!
    // The preview plays this one from the picture's player, not its own.
    expect(playedByPicture(t, sound)).not.toBe(null)
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.55])]])
    expect(levelAt(t, peaks, 0)).toBeCloseTo(0.55, 2)
  })

  it('follows a clip moved along the timeline, not the frame number', () => {
    let t = cut()
    t = addTrack(t, 'audio', 'a3')
    const moved = t.audioTracks[0]!.clips.map((c) => ({ ...c, timelineStart: c.timelineStart + 60 }))
    t = { ...t, audioTracks: [{ ...t.audioTracks[0]!, clips: moved }, ...t.audioTracks.slice(1)] }
    const peaks = new Map([[peaksKey('talk', 0), waveform([0.1, 0.95])]])
    // Two seconds in on the timeline is one second into the recording.
    expect(levelAt(t, peaks, 90)).toBeCloseTo(0.95, 2)
  })
})

describe('reading a level in decibels', () => {
  it('puts full scale at zero, and the familiar points where they belong', () => {
    expect(levelDb(1)).toBeCloseTo(0, 6)
    expect(levelDb(0.5)).toBeCloseTo(-6.02, 2)
    expect(levelDb(0.1)).toBeCloseTo(-20, 6)
    expect(levelDb(0.01)).toBeCloseTo(-40, 6)
  })

  it('has no number for silence, and never reads above full scale', () => {
    expect(levelDb(0)).toBe(-Infinity)
    expect(levelDb(-1)).toBe(-Infinity)
    expect(levelDb(2)).toBeCloseTo(0, 6)
  })

  it('writes a tenth of a decibel near the top and whole ones below it', () => {
    expect(formatLevelDb(1)).toBe('0.0 dB')
    expect(formatLevelDb(0.5)).toBe('-6.0 dB')
    // Past ten down it is noise, and the extra figure only jitters.
    expect(formatLevelDb(0.1)).toBe('-20 dB')
    expect(formatLevelDb(0.01)).toBe('-40 dB')
  })

  it('tells nothing to say from silence, which a meter must not confuse', () => {
    expect(formatLevelDb(null)).toBe('--')
    expect(formatLevelDb(0)).toBe('-∞ dB')
  })
})
