import { describe, it, expect } from 'vitest'
import { framesToSeconds, secondsToFrames, framesToFfmpegTime, formatTimecode, parseTimecode } from '../../src/shared/time'

describe('secondsToFrames', () => {
  it('converts whole seconds at common rates', () => {
    expect(secondsToFrames(1, 24)).toBe(24)
    expect(secondsToFrames(1, 25)).toBe(25)
    expect(secondsToFrames(1, 30)).toBe(30)
    expect(secondsToFrames(1, 50)).toBe(50)
    expect(secondsToFrames(1, 60)).toBe(60)
  })

  it('rounds to the nearest frame rather than truncating', () => {
    expect(secondsToFrames(0.49 / 30, 30)).toBe(0)
    expect(secondsToFrames(0.51 / 30, 30)).toBe(1)
    expect(secondsToFrames(1.9999, 30)).toBe(60)
  })

  it('handles fractional frame rates from downloaded footage', () => {
    expect(secondsToFrames(1, 30000 / 1001)).toBe(30)
    expect(secondsToFrames(10, 30000 / 1001)).toBe(300)
  })

  it('is stable across a round trip', () => {
    for (const fps of [24, 25, 30, 50, 60, 30000 / 1001]) {
      for (const frames of [0, 1, 29, 30, 1000, 86399]) {
        expect(secondsToFrames(framesToSeconds(frames, fps), fps)).toBe(frames)
      }
    }
  })

  it('rejects a non-positive frame rate', () => {
    expect(() => secondsToFrames(1, 0)).toThrow(/frame rate/i)
  })
})

describe('framesToFfmpegTime', () => {
  it('writes enough decimals to survive a 60fps frame boundary', () => {
    expect(framesToFfmpegTime(1, 30)).toBe('0.033333')
    expect(framesToFfmpegTime(0, 30)).toBe('0.000000')
    expect(framesToFfmpegTime(90, 30)).toBe('3.000000')
  })
})

describe('formatTimecode', () => {
  it('writes hours, minutes, seconds and frames', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(29, 30)).toBe('00:00:00:29')
    expect(formatTimecode(30, 30)).toBe('00:00:01:00')
    expect(formatTimecode(30 * 61, 30)).toBe('00:01:01:00')
    expect(formatTimecode(30 * 3661 + 7, 30)).toBe('01:01:01:07')
  })

  it('never shows a frame number equal to the frame rate', () => {
    expect(formatTimecode(secondsToFrames(0.9999, 25), 25)).toBe('00:00:01:00')
  })
})

describe('parseTimecode', () => {
  it('reads seconds, with or without an s, and parts of one', () => {
    expect(parseTimecode('83', 30)).toBe(83 * 30)
    expect(parseTimecode('83s', 30)).toBe(83 * 30)
    expect(parseTimecode('1.5s', 30)).toBe(45)
    expect(parseTimecode(' 2 s ', 30)).toBe(60)
  })

  it('reads a frame count', () => {
    expect(parseTimecode('120f', 30)).toBe(120)
    expect(parseTimecode('7 F', 30)).toBe(7)
  })

  it('reads minutes and seconds, then frames after them', () => {
    expect(parseTimecode('1:23', 30)).toBe(83 * 30)
    expect(parseTimecode('1:23:10', 30)).toBe(83 * 30 + 10)
    expect(parseTimecode('90:00', 30)).toBe(90 * 60 * 30)
  })

  it('reads the timecode as the window shows it, and gives back what it shows', () => {
    expect(parseTimecode('01:01:01:07', 30)).toBe(30 * 3661 + 7)
    for (const frames of [0, 29, 1830, 30 * 3661 + 7]) {
      expect(parseTimecode(formatTimecode(frames, 30), 30)).toBe(frames)
    }
  })

  it('counts whole frames at the rate rounded, as the timecode does', () => {
    expect(parseTimecode('00:00:01:00', 29.97)).toBe(30)
    expect(parseTimecode('1s', 29.97)).toBe(30)
  })

  it('refuses what is not a time', () => {
    for (const bad of ['', 'abc', '1:2:3:4:5', '1:60', '1:00:30', '1::2', '-3', '1:-2', '2:61:00:00']) {
      expect(parseTimecode(bad, 30), bad).toBeNull()
    }
  })
})
