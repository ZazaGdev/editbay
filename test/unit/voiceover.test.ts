import { describe, it, expect } from 'vitest'
import { posix, win32 } from 'node:path'
import { formatElapsed, lineUp, takeName, takesFolder } from '../../src/shared/voiceover'

describe('a take\'s name and folder', () => {
  it('is named after the local time it began', () => {
    expect(takeName(new Date(2026, 8, 22, 14, 3, 5))).toBe('Voice over 2026-09-22 14-03-05.wav')
    expect(takeName(new Date(2026, 0, 2, 9, 0, 0))).toBe('Voice over 2026-01-02 09-00-00.wav')
  })

  it('goes beside a saved project, and under Documents before the project has a file', () => {
    expect(takesFolder('D:\\Videos\\holiday.editbay', 'C:\\Users\\X\\Documents', win32)).toBe('D:\\Videos\\Voice overs')
    expect(takesFolder(null, 'C:\\Users\\X\\Documents', win32)).toBe('C:\\Users\\X\\Documents\\Editbay\\Voice overs')
    expect(takesFolder('/home/x/a.editbay', '/home/x/Documents', posix)).toBe('/home/x/Voice overs')
  })
})

describe('lining a take up with the frame where recording began', () => {
  const base = { sampleRate: 48000, firstCaptured: 10, startedAt: 10.5, inputLatency: 0, outputLatency: 0 }

  it('drops what was captured before playback began', () => {
    expect(lineUp(base)).toEqual({ drop: 24000, pad: 0 })
  })

  it('drops the microphone\'s delay and the one output latency between the audio clock and the speakers', () => {
    // Worked by hand: playback heard 0.5 s after capture began, 10 ms into the
    // microphone, and the audio clock 20 ms ahead of the speakers: 0.53 s at 48 kHz.
    expect(lineUp({ ...base, inputLatency: 0.01, outputLatency: 0.02 })).toEqual({ drop: 25440, pad: 0 })
  })

  it('puts silence first when capture began after that moment, and drops nothing', () => {
    expect(lineUp({ ...base, firstCaptured: 10.6 })).toEqual({ drop: 0, pad: 4800 })
  })

  it('takes a delay reported as less than nothing as none', () => {
    expect(lineUp({ ...base, inputLatency: -1, outputLatency: -1 })).toEqual(lineUp(base))
  })
})

describe('the time a take has run', () => {
  it('shows minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7.9)).toBe('0:07')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(760)).toBe('12:40')
    expect(formatElapsed(-3)).toBe('0:00')
  })
})
