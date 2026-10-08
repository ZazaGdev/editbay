import { describe, it, expect } from 'vitest'
import { groupStretches, joinStretchWords, repeatedPhrase, soundWithin, suspectOf, speechStretches, windowCut, windowTimeline, type SpokenAt } from '../../src/shared/steady-transcript'

/**
 * Plan 75. A long recording transcribed a stretch at a time, between long
 * pauses, so whisper cannot get stuck repeating itself across them, and a
 * stretch where it still did is reported rather than passed off as speech.
 */

const w = (text: string, startSec: number, endSec: number): SpokenAt => ({ text, startSec, endSec })

describe('the stretches with sound', () => {
  it('are what lies between the pauses, inside the part asked for', () => {
    expect(
      speechStretches(
        [
          { fromSec: 0, toSec: 3 },
          { fromSec: 10, toSec: 14 },
          { fromSec: 30, toSec: 40 }
        ],
        0,
        40
      )
    ).toEqual([
      { fromSec: 3, toSec: 10 },
      { fromSec: 14, toSec: 30 }
    ])
  })

  it('run to the edges of the part asked for, cut there', () => {
    expect(speechStretches([{ fromSec: 10, toSec: 14 }], 5, 20)).toEqual([
      { fromSec: 5, toSec: 10 },
      { fromSec: 14, toSec: 20 }
    ])
    expect(speechStretches([{ fromSec: 0, toSec: 8 }], 5, 20)).toEqual([{ fromSec: 8, toSec: 20 }])
  })

  it('are the whole part when there is no pause, and nothing when it is all pause', () => {
    expect(speechStretches([], 0, 12)).toEqual([{ fromSec: 0, toSec: 12 }])
    expect(speechStretches([{ fromSec: 0, toSec: 12 }], 2, 10)).toEqual([])
  })
})

describe('grouping stretches into windows', () => {
  const at = (pairs: number[][]): { fromSec: number; toSec: number }[] => pairs.map(([fromSec, toSec]) => ({ fromSec: fromSec!, toSec: toSec! }))

  it('takes the next stretch, pause and all, while the window stays within the longest', () => {
    expect(groupStretches(at([[0, 50], [53, 100], [104, 170], [175, 200], [210, 230]]), 180)).toEqual(at([[0, 170], [175, 230]]))
  })

  it('never takes in a long pause, however short the window so far', () => {
    expect(groupStretches(at([[0, 170], [1000, 1010]]), 180)).toEqual(at([[0, 170], [1000, 1010]]))
  })

  it('never splits a stretch, so a window is longer than the longest only when one stretch is', () => {
    expect(groupStretches(at([[0, 170], [172, 400], [402, 410]]), 180)).toEqual(at([[0, 170], [172, 400], [402, 410]]))
    expect(groupStretches(at([[0, 500]]), 180)).toEqual(at([[0, 500]]))
  })

  it('is nothing for no stretches, and the stretches themselves for windows of no length', () => {
    expect(groupStretches([], 180)).toEqual([])
    expect(groupStretches(at([[0, 5], [8, 9]]), 0)).toEqual(at([[0, 5], [8, 9]]))
  })
})

describe('a window cut and heard on its own', () => {
  it('is cut on whole frames, and its words are moved back by exactly where it was cut', () => {
    const cut = windowCut({ fromSec: 12.344, toSec: 15.006 }, 100)
    expect(cut).toEqual({ startSec: 12.34, lengthSec: 2.67 })
    const heard = [w('so', 0.5, 0.7)]
    expect(joinStretchWords([{ fromSec: cut.startSec, words: heard }])).toEqual([w('so', 12.84, 13.04)])
  })

  it('is never cut empty', () => {
    expect(windowCut({ fromSec: 3, toSec: 3.001 }, 100)).toEqual({ startSec: 3, lengthSec: 0.01 })
  })

  it("is heard whole on A1 from the timeline's start, from the file it was cut to", () => {
    const t = windowTimeline('C:\\temp\\window-3.wav', 2.67, 100)
    expect(t.videoTracks.every((r) => r.clips.length === 0)).toBe(true)
    expect(t.audioTracks[0]!.clips.map((c) => [c.track, c.sourceIn, c.sourceOut, c.timelineStart, c.gain, c.muted])).toEqual([[0, 0, 267, 0, 1, false]])
    expect(t.media.map((m) => m.playablePath)).toEqual(['C:\\temp\\window-3.wav'])
  })
})

describe('joining the words of each stretch', () => {
  it('puts each stretch\'s words back on the recording\'s clock, in order', () => {
    expect(
      joinStretchWords([
        { fromSec: 3, words: [w('so', 0.1, 0.3), w('this', 0.3, 0.6)] },
        { fromSec: 14, words: [w('is', 0, 0.2)] }
      ])
    ).toEqual([w('so', 3.1, 3.3), w('this', 3.3, 3.6), w('is', 14, 14.2)])
  })

  it('keeps times to the hundredth', () => {
    expect(joinStretchWords([{ fromSec: 0.1, words: [w('a', 0.2, 0.3)] }])).toEqual([w('a', 0.3, 0.4)])
  })
})

describe('a phrase repeated over and over', () => {
  const words = (text: string): string[] => text.split(' ')

  it('is found when one of up to six words comes more than four times in a row', () => {
    expect(repeatedPhrase(words('and then to find a way to find a way to find a way to find a way to find a way'))).toEqual({
      phrase: 'to find a way',
      times: 5
    })
    expect(repeatedPhrase(words('no no no no no'))).toEqual({ phrase: 'no', times: 5 })
  })

  it('ignores case and punctuation, as whisper writes the same words differently', () => {
    expect(repeatedPhrase(words('To find a way. to find a way, To find a way to find a way to find a way!'))).toEqual({ phrase: 'to find a way', times: 5 })
  })

  it('is not found four times, nor for a phrase of seven words', () => {
    expect(repeatedPhrase(words('to find a way to find a way to find a way to find a way'))).toBeNull()
    expect(repeatedPhrase(words('a b c d e f g a b c d e f g a b c d e f g a b c d e f g a b c d e f g'))).toBeNull()
  })

  it('is not found in ordinary talking', () => {
    expect(repeatedPhrase(words('so this is the editor and this is the timeline and that is the export'))).toBeNull()
  })

  it('reports the longest run when there are several', () => {
    expect(repeatedPhrase(words('yes yes yes yes yes then go go go go go go go'))).toEqual({ phrase: 'go', times: 7 })
  })
})

describe('what a heard stretch is suspected of', () => {
  const said = (text: string): string[] => text.split(' ')

  it('is a short sound when a stretch under half a second gave words: whisper invents a sign-off on a click', () => {
    expect(suspectOf({ fromSec: 1430.8, toSec: 1431.15 }, said('Thank you for watching!'))).toEqual([
      { fromSec: 1430.8, toSec: 1431.15, reason: 'short sound', words: 'Thank you for watching!' }
    ])
  })

  it('is nothing for a short stretch that gave no words, or a longer one that gave ordinary talking', () => {
    expect(suspectOf({ fromSec: 10, toSec: 10.3 }, [])).toEqual([])
    expect(suspectOf({ fromSec: 10, toSec: 10.5 }, said('so this is it'))).toEqual([])
  })

  it('is a repeat when one phrase comes over and over, as before', () => {
    expect(suspectOf({ fromSec: 0, toSec: 30 }, said('to find a way to find a way to find a way to find a way to find a way'))).toEqual([
      { fromSec: 0, toSec: 30, reason: 'repeat', phrase: 'to find a way', times: 5 }
    ])
  })

  it('can be both', () => {
    expect(suspectOf({ fromSec: 0, toSec: 0.4 }, said('no no no no no')).map((x) => x.reason)).toEqual(['repeat', 'short sound'])
  })

  it('keeps seconds to the hundredth', () => {
    expect(suspectOf({ fromSec: 1.23456, toSec: 1.5 }, said('hi'))).toEqual([{ fromSec: 1.23, toSec: 1.5, reason: 'short sound', words: 'hi' }])
  })

  it('is a short sound when a longer stretch holds under half a second of sound, as a click with quiet after it does', () => {
    // 01-42-47, track 3: a click at 1.07 s to 1.3 s, quiet from 0.1 s, in a stretch from 0 s to 1.69 s.
    const quiet = [
      { fromSec: 0.1, toSec: 1.07 },
      { fromSec: 1.3, toSec: 4.43 }
    ]
    const span = { fromSec: 0, toSec: 1.69 }
    expect(soundWithin(span, quiet)).toBeCloseTo(0.33, 5)
    expect(suspectOf(span, said('Thank you.'), soundWithin(span, quiet))).toEqual([{ fromSec: 0, toSec: 1.69, reason: 'short sound', words: 'Thank you.' }])
  })
})

describe('the sound within a span', () => {
  it('is its length less the quiet inside it, counting only the part of a quiet stretch that overlaps', () => {
    expect(soundWithin({ fromSec: 10, toSec: 20 }, [{ fromSec: 5, toSec: 12 }, { fromSec: 14, toSec: 15 }, { fromSec: 19, toSec: 30 }])).toBeCloseTo(6, 5)
    expect(soundWithin({ fromSec: 10, toSec: 20 }, [])).toBe(10)
    expect(soundWithin({ fromSec: 10, toSec: 20 }, [{ fromSec: 0, toSec: 30 }])).toBe(0)
  })
})
