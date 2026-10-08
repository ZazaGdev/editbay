import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, setCaptionWords, setCaptions, setCaptionsWithin, stretchedTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { captionEnd, captionsWithin, mergeStretches, wordsBack, type TimedWord } from '../../src/shared/captions'

/** Plan 78: captions made for part of a sequence. */

function media(id: string, durationSec: number): ProjectMedia {
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
    filmstripPath: ''
  }
}

const word = (text: string, start: number, length = 8): TimedWord => ({ text, start, length })

/** Two clips of talking on V1 with their sound, 0 to 300 and 300 to 600, captioned one word a time. */
function talking(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10), media('b', 10)] }
  t = addClip(addClip(t, 'a', 'one'), 'b', 'two')
  t = { ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 1 } } }
  return setCaptions(t, [word('first.', 30), word('second.', 250), word('third.', 330), word('fourth.', 500)], [])
}

const texts = (t: Timeline): string[] => t.captions.clips.map((c) => c.words.map((w) => w.text).join(' '))

describe('stretches', () => {
  it('are put in order and joined where they touch or overlap', () => {
    expect(mergeStretches([{ from: 300, to: 400 }, { from: 0, to: 100 }, { from: 100, to: 150 }, { from: 390, to: 450 }, { from: 500, to: 500 }])).toEqual([
      { from: 0, to: 150 },
      { from: 300, to: 450 }
    ])
  })

  it('give back the words heard on them played one after another, at their own frames', () => {
    const stretches = [{ from: 100, to: 200 }, { from: 400, to: 450 }]
    // At 10 into the joined sound, at 120 into it (20 into the second), and one past the end.
    expect(wordsBack([word('a', 10), word('b', 120, 40), word('c', 160)], stretches)).toEqual([
      { text: 'a', start: 110, length: 8 },
      // Cut short where its stretch ends.
      { text: 'b', start: 420, length: 30 }
    ])
  })

  it('play only the sound over them, moved up one after another', () => {
    const t = stretchedTimeline(talking(), [{ from: 250, to: 350 }])
    const clips = t.audioTracks[0]!.clips
    expect(clips.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut - c.sourceIn])).toEqual([
      [0, 250, 50],
      [50, 0, 50]
    ])
  })
})

describe('captions made for part of a sequence', () => {
  it('replace only the captions starting in the stretch, and leave the rest, fixed by hand or not', () => {
    let t = talking()
    const first = t.captions.clips[0]!
    t = setCaptionWords(t, first.id, 'FIXED.')
    const after = setCaptionsWithin(t, [word('new.', 320)], [], [{ from: 300, to: 600 }])
    expect(texts(after)).toEqual(['FIXED.', 'second.', 'new.'])
    expect(captionsWithin(t.captions.clips, [{ from: 300, to: 600 }]).length).toBe(2)
  })

  it('leave out new words said before the caption kept just before, and end before the next kept one', () => {
    const t = talking()
    // A stretch from 200 to 320 replaces "second." (at 250), and keeps "first." (30) and "third." (330).
    const after = setCaptionsWithin(t, [word('early', 200, 10), word('late', 310, 40)], [], [{ from: 200, to: 320 }])
    const late = after.captions.clips.find((c) => c.words[0]!.text === 'late')!
    expect(captionEnd(late)).toBeLessThanOrEqual(330)
    expect(texts(after)).toEqual(['first.', 'early', 'late', 'third.', 'fourth.'])
    // Nothing overlaps.
    const clips = after.captions.clips
    for (let i = 1; i < clips.length; i++) expect(clips[i]!.timelineStart).toBeGreaterThanOrEqual(captionEnd(clips[i - 1]!))
  })

  it('are grouped in each stretch on its own', () => {
    let t = talking()
    t = { ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 5 } } }
    const after = setCaptionsWithin(t, [word('one', 100), word('two', 110), word('three', 400), word('four', 410)], [], [
      { from: 90, to: 120 },
      { from: 395, to: 420 }
    ])
    expect(texts(after)).toContain('one two')
    expect(texts(after)).toContain('three four')
  })
})
