import { describe, it, expect } from 'vitest'
import { DUCK_ATTACK_SEC, DUCK_DB, DUCK_RELEASE_SEC, duckExpression, duckGainAt, voiceStretches } from '../../src/shared/ducking'
import { addSource, addTrack, createTimeline, setTrackDuck, setTrackMuted, playedByPicture, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { peaksKey } from '../../src/shared/sound'
import type { PeaksData } from '../../src/shared/types'

/**
 * Plan 50: a ducked track comes down wherever anything on the other tracks is
 * heard, by one answer the preview and the export both read.
 */

function media(id: string, durationSec: number): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.wav`,
    playablePath: `C:\\v\\${id}.wav`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 0,
    height: 0,
    fps: 0,
    codec: 'pcm',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A waveform of 100 peaks a second: loud in the stretches given, in seconds, silent elsewhere. */
function wave(durationSec: number, loud: [number, number][]): PeaksData {
  const n = durationSec * 100
  const peaks = new Int16Array(n * 2)
  for (const [a, b] of loud) {
    for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) {
      peaks[i * 2] = -16000
      peaks[i * 2 + 1] = 16000
    }
  }
  return { peaksPerSecond: 100, durationSec, peaks }
}

/** Voice on A1 for ten seconds, and music on A2 under it, ducked. */
function voiceAndMusic(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('voice', 10), media('music', 10)] }
  t = addTrack(t, 'audio', 'a2')
  const a1 = t.audioTracks[0]!.id
  t = addSource(t, { mediaId: 'voice', clipId: 'v', at: 0, onTrack: a1 })
  t = addSource(t, { mediaId: 'music', clipId: 'm', at: 0, onTrack: 'a2' })
  return setTrackDuck(t, 'a2', true)
}

const peaks = (voice: [number, number][]): Map<string, PeaksData> =>
  new Map([
    [peaksKey('voice', 0), wave(10, voice)],
    // The music is loud all the way through, and must not count as voice.
    [peaksKey('music', 0), wave(10, [[0, 10]])]
  ])

describe('where the voice is', () => {
  it('is every stretch heard on a track that does not duck, in frames', () => {
    expect(voiceStretches(voiceAndMusic(), peaks([[1, 2], [5, 7]]))).toEqual([
      { from: 30, to: 60 },
      { from: 150, to: 210 }
    ])
  })

  it('bridges a gap shorter than half a second, so the music does not pump between words', () => {
    expect(voiceStretches(voiceAndMusic(), peaks([[1, 2], [2.3, 3]]))).toEqual([{ from: 30, to: 90 }])
  })

  it('is nothing when no track ducks, and a muted track is neither voice nor ducked', () => {
    const t = voiceAndMusic()
    const a1 = t.audioTracks[0]!.id
    expect(voiceStretches(setTrackDuck(t, 'a2', false), peaks([[1, 2]]))).toEqual([])
    expect(voiceStretches(setTrackMuted(t, a1, true), peaks([[1, 2]]))).toEqual([])
    expect(voiceStretches(setTrackMuted(t, 'a2', true), peaks([[1, 2]]))).toEqual([])
  })

  it('counts a waveform not loaded yet as silence', () => {
    expect(voiceStretches(voiceAndMusic(), new Map())).toEqual([])
  })
})

describe('the ducked level at a moment', () => {
  const stretches = [{ from: 60, to: 120 }]
  const down = Math.pow(10, DUCK_DB / 20)

  it('is full well clear of the voice, and down by the duck in the middle of it', () => {
    expect(duckGainAt(stretches, 30, 0.5)).toBe(1)
    expect(duckGainAt(stretches, 30, 3)).toBeCloseTo(down, 6)
    expect(duckGainAt(stretches, 30, 6)).toBe(1)
  })

  it('is already down where the voice starts, and comes back up after it stops', () => {
    expect(duckGainAt(stretches, 30, 2)).toBeCloseTo(down, 6)
    expect(duckGainAt(stretches, 30, 2 - DUCK_ATTACK_SEC)).toBeCloseTo(1, 6)
    expect(duckGainAt(stretches, 30, 4)).toBeCloseTo(down, 6)
    expect(duckGainAt(stretches, 30, 4 + DUCK_RELEASE_SEC / 2)).toBeCloseTo((1 + down) / 2, 6)
    expect(duckGainAt(stretches, 30, 4 + DUCK_RELEASE_SEC)).toBeCloseTo(1, 6)
  })

  it('takes the lower level where the curves of two stretches overlap, rather than adding them', () => {
    const a = { from: 60, to: 90 }
    const b = { from: 95, to: 120 }
    const alone = Math.min(duckGainAt([a], 30, 3.1), duckGainAt([b], 30, 3.1))
    expect(alone).toBeGreaterThan(down)
    expect(duckGainAt([a, b], 30, 3.1)).toBeCloseTo(alone, 6)
  })
})

describe('the ducked level as ffmpeg is given it', () => {
  it('is the same curve, timed from the segment, with no spaces', () => {
    const down = Math.pow(10, DUCK_DB / 20)
    // The stretch 2 s to 4 s, seen from a segment starting at 1 s.
    expect(duckExpression([{ from: 60, to: 120 }], 30, 1, 5)).toBe(
      `1-${(1 - down).toFixed(6)}*min(clip(((t+1)-1.85)/0.15,0,1),clip((4.5-(t+1))/0.5,0,1))`
    )
  })

  it('takes the loudest duck of the stretches near the segment, and names no other', () => {
    const e = duckExpression(
      [
        { from: 60, to: 120 },
        { from: 150, to: 180 },
        { from: 900, to: 960 }
      ],
      30,
      1,
      8
    )!
    expect(e).toMatch(/^1-[\d.]+\*max\(min\(.*\),min\(.*\)\)$/)
    expect(e).not.toContain('29.85')
  })

  it('is nothing when no stretch comes near the segment', () => {
    expect(duckExpression([{ from: 60, to: 120 }], 30, 10, 20)).toBeNull()
  })
})

describe('a ducked track in the preview', () => {
  it('plays from a sound player rather than out of its picture, so its level can follow the curve', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [{ ...media('rec', 10), width: 1920, height: 1080, fps: 30, codec: 'h264' }]
    }
    t = addSource(t, { mediaId: 'rec', clipId: 'c' })
    expect(playedByPicture(t, t.audioTracks[0]!.clips[0]!)).not.toBeNull()
    t = setTrackDuck(t, t.audioTracks[0]!.id, true)
    expect(playedByPicture(t, t.audioTracks[0]!.clips[0]!)).toBeNull()
  })
})

describe('a long stretch of talking, as ffmpeg is given it', () => {
  /** How deep the brackets of an expression go. */
  const depth = (e: string): number => {
    let now = 0
    let most = 0
    for (const ch of e) {
      if (ch === '(') most = Math.max(most, ++now)
      if (ch === ')') now--
    }
    return most
  }

  it('stays shallow however many times the voice starts and stops, which ffmpeg needs past about ninety', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ from: i * 60, to: i * 60 + 30 }))
    const e = duckExpression(many, 30, 0, 800)!
    expect(e.match(/min\(clip/g)).toHaveLength(400)
    expect(depth(e)).toBeLessThan(20)
  })

  it('names only the stretches near the part of the segment the sound is in', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ from: i * 60, to: i * 60 + 30 }))
    // A segment of 100 s, and a sound in it only from 10 s to 20 s.
    const e = duckExpression(many, 30, 0, 100, { fromSec: 10, toSec: 20 })!
    expect(e.match(/min\(clip/g)!.length).toBeLessThanOrEqual(6)
  })
})
