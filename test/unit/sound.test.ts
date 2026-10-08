import { describe, it, expect } from 'vitest'
import { gainFromPercent, isSilentPeaks, loudestPeaks, peaksKey, previewScale, previewVolume, syncAction, MAX_GAIN, SEEK_DRIFT_SEC } from '../../src/shared/sound'
import { addClip, addSource, addTrack, createTimeline, setClipAudio, type ProjectMedia, type Timeline } from '../../src/shared/project'
import type { PeaksData } from '../../src/shared/types'

function media(id: string, audioTracks = 1): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mkv`,
    playablePath: `C:\\v\\${id}.mkv`,
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
    audioTracks
  }
}

/** Each source added to the end of V1, as `c1`, `c2` and on, with its sound clips `c1.1`, `c1.2` and on. */
function timelineOf(...m: ProjectMedia[]): Timeline {
  const base = createTimeline(30, { width: 1080, height: 1920 })
  return m.reduce((p, x, i) => addClip({ ...p, media: [...p.media, x] }, x.id, `c${i + 1}`), base)
}

function peaks(values: number[], durationSec = 1): PeaksData {
  return { peaksPerSecond: 100, durationSec, peaks: Int16Array.from(values) }
}

describe('the preview keeping the balance', () => {
  it('plays everything as it is when nothing is set above 100%', () => {
    expect(previewScale(timelineOf(media('a'), media('b')))).toBe(1)
  })

  it('plays everything quieter by the same factor when something is louder than 100%', () => {
    const t0 = timelineOf(media('obs', 3), media('b'))
    // The loudest is the recording's second stream, on A2, heard at 300%.
    const t = setClipAudio(t0, 'c1.2', { gain: 3, muted: false })
    expect(previewScale(t)).toBeCloseTo(1 / 3)
    expect(previewVolume(3, previewScale(t))).toBeCloseTo(1)
    expect(previewVolume(1, previewScale(t))).toBeCloseTo(1 / 3)
  })

  it('does not count a muted clip', () => {
    const t0 = timelineOf(media('a'))
    expect(previewScale(setClipAudio(t0, 'c1.1', { gain: 4, muted: true }))).toBe(1)
  })

  it('reads the loudest heard sound clip on any audio track, a muted one set louder not counting', () => {
    // The recording's second and third streams arrive muted on A2 and A3.
    let t = timelineOf(media('obs', 3))
    t = setClipAudio(t, 'c1.3', { gain: 4, muted: true })
    expect(previewScale(t)).toBe(1)
    // A song on A4, well away from V1, at 250%.
    t = addTrack({ ...t, media: [...t.media, { ...media('song'), hasVideo: false }] }, 'audio', 'a4')
    t = addSource(t, { clipId: 's1', mediaId: 'song', at: 900, onTrack: 'a4' })
    t = setClipAudio(t, 's1', { gain: 2.5, muted: false })
    expect(previewScale(t)).toBeCloseTo(0.4)
    expect(previewScale(setClipAudio(t, 's1', { gain: 2.5, muted: true }))).toBe(1)
  })

  it('never hands an element a volume outside 0 to 1', () => {
    expect(previewVolume(3, 1)).toBe(1)
    expect(previewVolume(-1, 1)).toBe(0)
  })
})

describe('telling a silent track', () => {
  it('knows a flat waveform, and one with sound in it', () => {
    expect(isSilentPeaks(peaks([0, 0, -3, 5, 0, 0]))).toBe(true)
    expect(isSilentPeaks(peaks([0, 0, -900, 1200, 0, 0]))).toBe(false)
    expect(isSilentPeaks(peaks([]))).toBe(true)
  })
})

describe('holding a player in step', () => {
  it('keeps a player that is close enough swinging gently either side, rather than back at its normal speed', () => {
    // Turning the browser's pitch keeping off and on again puts a player 20 to 40 ms out.
    expect(syncAction(0.002, 1)).toEqual({ seek: false, rate: 0.99 })
    expect(syncAction(-0.004, 1)).toEqual({ seek: false, rate: 1.01 })
    expect(syncAction(0.002, 1.01)).toEqual({ seek: false, rate: 1.01 })
    expect(syncAction(-0.002, 0.99)).toEqual({ seek: false, rate: 0.99 })
    // Coming in fast, it drops to the gentle speed on its side.
    expect(syncAction(-0.002, 1.05)).toEqual({ seek: false, rate: 1.01 })
  })

  it('never hands a playing player exactly its normal speed', () => {
    for (let ms = -240; ms <= 240; ms += 0.5) {
      for (const rate of [1, 0.99, 1.01, 1.08]) expect(syncAction(ms / 1000, rate).rate).not.toBe(1)
    }
  })

  it('slows a player that is ahead and speeds up one that is behind', () => {
    expect(syncAction(0.02).rate).toBeLessThan(1)
    expect(syncAction(-0.02).rate).toBeGreaterThan(1)
    expect(syncAction(0.02).seek).toBe(false)
  })

  it('always changes speed by at least a step once it is out, and never by more than 8%', () => {
    expect(syncAction(0.006).rate).toBe(0.98)
    expect(syncAction(0.001 + 0.005).rate).toBeLessThan(1)
    expect(syncAction(-0.006).rate).toBe(1.02)
    expect(syncAction(0.2).rate).toBe(0.92)
    expect(syncAction(-0.2).rate).toBe(1.08)
  })

  it('moves a player that is a long way out, or nowhere at all', () => {
    expect(syncAction(SEEK_DRIFT_SEC + 0.01)).toEqual({ seek: true, rate: 1 })
    expect(syncAction(-1)).toEqual({ seek: true, rate: 1 })
    expect(syncAction(Number.NaN)).toEqual({ seek: true, rate: 1 })
  })

  it('eases a player around the speed the sequence plays at, not around 1', () => {
    // At 2x: behind, a little faster than 2; ahead, a little slower; never more than 8% either way.
    expect(syncAction(-0.02, 2, 2).rate).toBeGreaterThan(2)
    expect(syncAction(-0.02, 2, 2).rate).toBeLessThanOrEqual(2 * 1.08)
    expect(syncAction(0.02, 2, 2).rate).toBeLessThan(2)
    expect(syncAction(0.2, 2, 2).rate).toBeCloseTo(2 * 0.92, 9)
    // Close: a step of 1% of the speed either side, kept once there.
    expect(syncAction(0.002, 2, 2).rate).toBeCloseTo(1.98, 9)
    expect(syncAction(-0.002, 2.02, 2).rate).toBe(2.02)
    // A long way out, it seeks and plays on at the speed.
    expect(syncAction(-1, 2, 2)).toEqual({ seek: true, rate: 2 })
    expect(syncAction(-1, 1.5, 1.5)).toEqual({ seek: true, rate: 1.5 })
  })
})

describe('loudestPeaks', () => {
  const quietMic = peaks([-20, 20, -30, 30])
  const loudGame = peaks([-9000, 9000, -12000, 12000])

  it('draws the game rather than a first track that is nearly silent', () => {
    const map = new Map([
      [peaksKey('m1', 0), quietMic],
      [peaksKey('m1', 1), loudGame]
    ])
    expect(loudestPeaks(map, 'm1')).toBe(loudGame)
  })

  it('leaves the first stream chosen when nothing is louder', () => {
    const first = peaks([-500, 500])
    const same = peaks([-500, 500])
    const map = new Map([
      [peaksKey('m1', 0), first],
      [peaksKey('m1', 1), same]
    ])
    expect(loudestPeaks(map, 'm1')).toBe(first)
  })

  it('reads only this recording, never another loaded beside it', () => {
    const mine = peaks([-100, 100])
    const map = new Map([
      [peaksKey('m1', 0), mine],
      [peaksKey('m2', 0), loudGame],
      [peaksKey('m2', 1), loudGame]
    ])
    expect(loudestPeaks(map, 'm1')).toBe(mine)
  })

  it('says nothing has loaded rather than picking a waveform that is not there', () => {
    expect(loudestPeaks(new Map(), 'm1')).toBeUndefined()
    expect(loudestPeaks(new Map([[peaksKey('m2', 0), loudGame]]), 'm1')).toBeUndefined()
  })

  it('still answers when every stream of it is silent', () => {
    const silent = peaks([0, 0])
    const map = new Map([
      [peaksKey('m1', 0), silent],
      [peaksKey('m1', 1), peaks([0, 0])]
    ])
    expect(loudestPeaks(map, 'm1')).toBe(silent)
  })
})

describe('gainFromPercent', () => {
  it('reads a figure typed into the box', () => {
    expect(gainFromPercent('250')).toBe(2.5)
    expect(gainFromPercent('100')).toBe(1)
    expect(gainFromPercent('0')).toBe(0)
  })

  it('reads a figure with the per cent sign the box draws', () => {
    expect(gainFromPercent('250%')).toBe(2.5)
    expect(gainFromPercent(' 250 % ')).toBe(2.5)
  })

  it('reads a fraction of a per cent, which the slider cannot reach', () => {
    expect(gainFromPercent('87.5')).toBe(0.875)
  })

  it('brings a figure past the ends back to them', () => {
    expect(gainFromPercent('900')).toBe(MAX_GAIN)
    expect(gainFromPercent('-50')).toBe(0)
  })

  it('says nothing rather than silence for a box being typed in', () => {
    expect(gainFromPercent('')).toBeNull()
    expect(gainFromPercent('   ')).toBeNull()
    expect(gainFromPercent('%')).toBeNull()
  })

  it('says nothing for what is not a figure at all', () => {
    expect(gainFromPercent('loud')).toBeNull()
    expect(gainFromPercent('12abc')).toBeNull()
    expect(gainFromPercent('1e')).toBeNull()
  })
})

describe('previewVolume and the monitor', () => {
  it('turns the whole preview down by what the monitor is set to', () => {
    expect(previewVolume(1, 1, 0.5)).toBeCloseTo(0.5, 5)
    expect(previewVolume(0.5, 1, 0.5)).toBeCloseTo(0.25, 5)
    expect(previewVolume(1, 1, 0)).toBe(0)
  })

  it('leaves the preview alone when it is not asked for', () => {
    expect(previewVolume(0.8, 1)).toBeCloseTo(0.8, 5)
    expect(previewVolume(0.8, 1, 1)).toBeCloseTo(0.8, 5)
  })

  it('keeps the balance between clips, which is the one the export uses', () => {
    // Three clips at 300%, 100% and 50%, scaled to fit what an element takes,
    // then heard at a half. The ratios between them do not move.
    const scale = 1 / 3
    const heard = [3, 1, 0.5].map((g) => previewVolume(g, scale, 0.5))
    expect(heard[0]! / heard[1]!).toBeCloseTo(3, 5)
    expect(heard[1]! / heard[2]!).toBeCloseTo(2, 5)
  })

  it('never hands an element a volume it cannot take, whatever the monitor says', () => {
    expect(previewVolume(4, 1, 1)).toBe(1)
    expect(previewVolume(4, 1, 2)).toBe(1)
    expect(previewVolume(1, 1, -1)).toBe(0)
  })
})
