import { wordsOf } from '../../src/shared/captions'
import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  createProject,
  createTimeline,
  duplicateSequence,
  editSequence,
  followSpeech,
  listenTracks,
  setCaptions,
  setCaptionsHeard,
  splitClip,
  timelineDuration,
  timelineOf,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { captionEnd, type TimedWord } from '../../src/shared/captions'
import { applyClipEdit } from '../../src/main/project/session'
import type { ClipEdit } from '../../src/shared/types'
import { S1 } from '../project-helpers'

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
    peaksPath: `C:\\c\\${id}\\peaks.bin`,
    filmstripPath: `C:\\c\\${id}\\filmstrip.jpg`,
    ...overrides
  }
}

function word(text: string, start: number, length = 8): TimedWord {
  return { text, start, length }
}

/** One word a caption, as the style puts it. */
function oneAtATime(t: Timeline): Timeline {
  return { ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 1 } } }
}

/**
 * Three pieces of talking on V1, each with its sound on A1: p1 (a, 0 to 300),
 * p2 (b, 300 to 420) and p3 (b, 420 to 540), a song under it all on A2, and a
 * picture on V2 over 100 to 220. Captions, one word at a time: "first" at 30,
 * "left" at 290 and "right" at 302 either side of the first cut, "second" at
 * 330 and "third" at 450.
 */
function talking(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 10), media('b', 4), media('song', 20, { hasVideo: false }), media('pic', 4, { hasAudio: false }), media('in', 2)]
  }
  t = addClip(t, 'a', 'p1')
  t = addClip(t, 'b', 'p2')
  t = addClip(t, 'b', 'p3')
  t = addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
  t = addSource(t, { mediaId: 'pic', clipId: 'over', at: 100, onTrack: 'v2', streams: [] })
  return setCaptions(oneAtATime(t), [word('first', 30), word('left', 290), word('right', 302), word('second', 330), word('third', 450)], [])
}

/** An edit as the app applies it: the clips changed, and the captions following the speech. */
function edit(t: Timeline, e: ClipEdit): Timeline {
  return applyClipEdit(t, e)
}

/** Each caption as its text and where it starts and ends. */
function captions(t: Timeline): [string, number, number][] {
  return t.captions.clips.map((c) => [c.words.map((w) => w.text).join(' '), c.timelineStart, captionEnd(c)])
}

describe('captions following the speech through edits on V1', () => {
  it('go with a clip taken out with Shift+Delete, and the later ones move back with the talking', () => {
    // "left" ran on to "right", as captions a moment apart do, and ends now where the talking it was said over does.
    expect(captions(edit(talking(), { kind: 'closeUpClip', clipId: 'p2' }))).toEqual([
      ['first', 30, 38],
      ['left', 290, 302],
      ['third', 330, 338]
    ])
  })

  it('go with a clip deleted, leaving the rest where they are', () => {
    expect(captions(edit(talking(), { kind: 'removeClip', clipId: 'p2' }))).toEqual([
      ['first', 30, 38],
      ['left', 290, 302],
      ['third', 450, 458]
    ])
  })

  it('stay when a clip\'s picture alone is deleted, since its sound is still heard', () => {
    const t = talking()
    expect(captions(edit(t, { kind: 'removeClip', clipId: 'p2', alone: true }))).toEqual(captions(t))
  })

  it('go with the gap a deleted clip left, when it is closed up', () => {
    const gone = edit(talking(), { kind: 'removeClip', clipId: 'p2' })
    expect(captions(edit(gone, { kind: 'closeUpGap', gap: { trackId: 'v1', from: 300, to: 420 } }))).toEqual([
      ['first', 30, 38],
      ['left', 290, 302],
      ['third', 330, 338]
    ])
  })

  it('go with what I trims away on V1, the rest moving with the talking', () => {
    // I at 35 on p1: its first 35 frames go, and the word said at 30 with them.
    expect(captions(edit(talking(), { kind: 'trimToFrame', clipId: 'p1', edge: 'start', frame: 35 })).map(([text, from]) => [text, from])).toEqual([
      ['left', 255],
      ['right', 267],
      ['second', 295],
      ['third', 415]
    ])
  })

  it('move on for a clip put in with Ctrl, the words either side of it going each way', () => {
    let t = talking()
    t = setCaptions({ ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 3 } } }, [word('left', 290), word('right', 302)], [])
    expect(captions(t)).toEqual([['left right', 290, 310]])
    expect(captions(edit(t, { kind: 'addSource', mediaId: 'in', clipId: 'x', at: 300, onTrack: 'v1', insert: true }))).toEqual([
      ['left', 290, 298],
      ['right', 362, 370]
    ])
  })

  it('follow a trim with Ctrl on V1', () => {
    // p2's head 20 frames later: its first 20 frames go, with the word said at 302.
    expect(captions(edit(talking(), { kind: 'setClipIn', clipId: 'p2', frame: 20, closeUp: true })).map(([text, from]) => [text, from])).toEqual([
      ['first', 30],
      ['left', 290],
      ['second', 310],
      ['third', 430]
    ])
  })

  it('go with a clip moved with Ctrl on V1', () => {
    // p3 to the start: it goes in at 0, so p1 and p2 move on 120 frames.
    expect(captions(edit(talking(), { kind: 'moveClip', clipId: 'p3', trackId: 'v1', start: 0, insert: true }))).toEqual([
      ['third', 30, 38],
      ['first', 150, 158],
      ['left', 410, 422],
      ['right', 422, 430],
      ['second', 450, 458]
    ])
  })

  it('go with a clip dragged along V1 with its sound, and give way where it lands', () => {
    // p2 to 40 frames later: its words go with it, and "third", on p3, loses the stretch p2 now covers.
    expect(captions(edit(talking(), { kind: 'moveClip', clipId: 'p2', trackId: 'v1', start: 340 }))).toEqual([
      ['first', 30, 38],
      ['left', 290, 302],
      ['right', 342, 350],
      ['second', 370, 378]
    ])
  })

  it('go with a clip cut in two, whichever piece they are in', () => {
    const cut = splitClip(talking(), 60, 'p1')
    expect(captions(followSpeech(talking(), cut))).toEqual(captions(talking()))
    const later = edit(cut, { kind: 'moveClip', clipId: cut.videoTracks[0]!.clips[1]!.id, trackId: 'v1', start: 700 })
    expect(captions(later).find(([text]) => text === 'left')).toEqual(['left', 290 + 640, 302 + 640])
  })

  it('stay with a clip cut in two and joined back, whichever piece they were in', () => {
    const cut = edit(talking(), { kind: 'split', clipId: 'p1', frame: 60 })
    const pieces = cut.videoTracks[0]!.clips.map((c) => c.id)
    expect(pieces).toHaveLength(4)
    const joined = edit(cut, { kind: 'joinClips', clipIds: [pieces[0]!, pieces[1]!] })
    expect(joined.videoTracks[0]!.clips).toHaveLength(3)
    expect(captions(joined)).toEqual(captions(talking()))
  })

  it('stay with what Join brings back, and keep the rest with the talking', () => {
    // A stretch of p1 taken out with Shift+Delete, then joined back: every word comes back to where it was.
    let t = talking()
    t = edit(t, { kind: 'split', clipId: 'p1', frame: 60 })
    t = edit(t, { kind: 'split', clipId: t.videoTracks[0]!.clips[1]!.id, frame: 120 })
    const [first, middle, rest] = t.videoTracks[0]!.clips.map((c) => c.id)
    t = edit(t, { kind: 'closeUpClip', clipId: middle! })
    t = edit(t, { kind: 'joinClips', clipIds: [first!, rest!], bringBack: true })
    expect(t.videoTracks[0]!.clips).toHaveLength(3)
    expect(captions(t)).toEqual(captions(talking()))
  })

  it('stay with a sound clip that is muted', () => {
    const t = talking()
    expect(captions(edit(t, { kind: 'setClipAudio', clipId: 'p2.1', gain: 1, muted: true }))).toEqual(captions(t))
  })

  it('stay with a sound clip set to play another of its recording\'s streams', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('obs', 10, { audioTracks: 2 })] }
    t = addClip(t, 'obs', 'rec')
    t = setCaptions(oneAtATime(t), [word('hello', 30)], [])
    const other = edit(t, { kind: 'setSoundTrack', clipId: 'rec.1', track: 1 })
    expect(other.audioTracks[0]!.clips[0]!.track).toBe(1)
    expect(captions(other)).toEqual(captions(t))
  })
})

describe('captions following the speech through edits elsewhere', () => {
  it('stay when an overlay is taken out with Shift+Delete, since the talking under it stays', () => {
    const t = talking()
    const after = edit(t, { kind: 'closeUpClip', clipId: 'over' })
    expect(after.videoTracks[0]!.clips.map((c) => c.timelineStart)).toEqual([0, 300, 420])
    expect(captions(after)).toEqual(captions(t))
  })

  it('stay with the talking when a gap on the music track closes up across it', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('talk', 20), media('song', 30, { hasVideo: false })] }
    t = addClip(t, 'talk', 'p1')
    t = addSource(t, { mediaId: 'song', clipId: 'm1', at: 0 })
    t = splitClip(t, 200, 'm1')
    t = splitClip(t, 260, t.audioTracks[1]!.clips[1]!.id)
    t = edit(t, { kind: 'removeClip', clipId: t.audioTracks[1]!.clips[1]!.id })
    t = setCaptions(oneAtATime(t), [word('one', 100), word('two', 220), word('three', 300)], [])
    const closed = edit(t, { kind: 'closeUpGap', gap: { trackId: t.audioTracks[1]!.id, from: 200, to: 260 } })
    expect(closed.audioTracks[1]!.clips[1]!.timelineStart).toBe(200)
    expect(captions(closed)).toEqual(captions(t))
  })

  it("keep a voice over's captions on it when a clip goes in with Ctrl across the take", () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [
        media('broll', 10, { hasAudio: false }),
        media('ins', 2, { hasAudio: false }),
        media('vo', 8, { hasVideo: false, originalPath: 'D:\\p\\Voice overs\\Voice over 2026-09-22 14-03-05.wav' })
      ]
    }
    t = addClip(t, 'broll', 'b1')
    t = addSource(t, { mediaId: 'vo', clipId: 'vo', at: 30 })
    t = setCaptions(oneAtATime(t), [word('one', 60), word('two', 200), word('three', 250)], [])
    const put = edit(t, { kind: 'addSource', mediaId: 'ins', clipId: 'in', at: 150, onTrack: 'v1', insert: true })
    expect(put.videoTracks[0]!.clips.map((c) => c.timelineStart)).toEqual([0, 150, 210])
    expect(captions(put)).toEqual(captions(t))
  })

  it('stay put for an edit that moves no sound or picture under them', () => {
    const t = talking()
    const v2 = t.videoTracks[1]!.id
    expect(captions(edit(t, { kind: 'moveClip', clipId: 'over', trackId: v2, start: 400 }))).toEqual(captions(t))
  })

  it('follow the picture under a word where no sound is', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('quiet', 10, { hasAudio: false }), media('b', 4)] }
    t = addClip(t, 'b', 'first')
    t = addClip(t, 'quiet', 'q')
    t = setCaptions(oneAtATime(t), [word('shown', 200)], [])
    expect(captions(edit(t, { kind: 'closeUpClip', clipId: 'first' }))).toEqual([['shown', 80, 88]])
  })
})

describe('making captions', () => {
  it('groups the words as the style says, in place of every caption there was, as made', () => {
    let t = talking()
    t = { ...t, captions: { ...t.captions, edited: true, style: { ...t.captions.style, wordsPerCaption: 2 } } }
    const made = setCaptions(t, [word('one', 0), word('two', 10), word('three', 20)], ['a1'])
    expect(captions(made)).toEqual([
      ['one two', 0, 20],
      ['three', 20, 28]
    ])
    expect(made.captions.edited).toBe(false)
    expect(made.captions.listenTo).toEqual(['a1'])
  })

  it('keeps only the tracks listened to that are there', () => {
    expect(setCaptions(talking(), [word('one', 0)], ['a1', 'gone']).captions.listenTo).toEqual(['a1'])
  })

  it('leaves out words it cannot place', () => {
    const made = setCaptions(talking(), [word('', 0), word('ok', Number.NaN), word(' fine ', 12.4, 7.6)], [])
    expect(made.captions.clips.flatMap((c) => c.words)).toEqual([{ text: 'fine', start: 0, length: 8 }])
    expect(made.captions.clips[0]!.timelineStart).toBe(12)
  })

  it('never makes a caption that runs past the last clip, so the sequence does not grow', () => {
    const t = talking()
    expect(timelineDuration(t)).toBe(600)
    const made = setCaptions(t, [word('bye', 595, 20), word('late', 700, 20)], [])
    expect(captions(made)).toEqual([['bye', 595, 600]])
    expect(timelineDuration(made)).toBe(600)
  })
})

describe('making captions in the background, while the sequence is edited', () => {
  const heardWords = [word('first', 30), word('left', 290), word('right', 302), word('second', 330), word('third', 450)]
  /** The sequence as it was when the listening began, with no captions yet. */
  const heard = (): Timeline => setCaptions(talking(), [], [])

  it('puts the words where they were heard when nothing was edited meanwhile', () => {
    const t = heard()
    expect(captions(setCaptionsHeard(t, t, heardWords, ['a1']))).toEqual(captions(setCaptions(t, heardWords, ['a1'])))
  })

  it('carries the words with their footage when a clip was taken out meanwhile, and drops the ones said over it', () => {
    const before = heard()
    const now = edit(before, { kind: 'closeUpClip', clipId: 'p2' })
    const made = setCaptionsHeard(now, before, heardWords, ['a1'])
    expect(captions(made)).toEqual([
      ['first', 30, 38],
      ['left', 290, 302],
      ['third', 330, 338]
    ])
    expect(made.captions.listenTo).toEqual(['a1'])
    expect(made.captions.edited).toBe(false)
    // The clips are the ones there are now, not the ones heard.
    expect(made.videoTracks).toEqual(now.videoTracks)
  })

  it('replaces the captions made by hand meanwhile', () => {
    const before = heard()
    const now = setCaptions(before, [word('typed', 10)], [])
    expect(captions(setCaptionsHeard(now, before, [word('said', 100)], [])).map((c) => c[0])).toEqual(['said'])
  })
})

describe('the tracks listened to', () => {
  /** Talking on V1 with its sound on A1, a song on A2, and a voice over take on A3. */
  function withVoiceOver(): Timeline {
    let t = talking()
    t = { ...t, media: [...t.media, media('take', 5, { hasVideo: false, originalPath: 'D:\\Shorts\\Voice overs\\Voice over 2026-09-22 14-03-05 (2).wav' })] }
    return addSource(t, { mediaId: 'take', clipId: 'vo', at: 60 })
  }

  it("are the talking head's own sound and the voice over takes, not the music, until chosen", () => {
    const t = withVoiceOver()
    const vo = t.audioTracks.find((r) => r.clips.some((c) => c.id === 'vo'))!.id
    expect(listenTracks(t)).toEqual(['a1', vo])
  })

  it('are the ones chosen last time, once chosen', () => {
    const t = withVoiceOver()
    const song = t.audioTracks.find((r) => r.clips.some((c) => c.id === 'music'))!.id
    expect(listenTracks(setCaptions(t, [], [song]))).toEqual([song])
  })

  it("go back to the talking head's own sound when the ones chosen have all gone", () => {
    const t = talking()
    expect(listenTracks({ ...t, captions: { ...t.captions, listenTo: ['gone'] } })).toEqual(['a1'])
  })
})

describe('captions in a copy of a sequence', () => {
  it('are copied, with ids of their own', () => {
    let p = createProject('x', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', 10)] }
    p = editSequence(p, S1, (t) => setCaptions(addClip(t, 'a'), [word('hello', 0), word('there', 10)], []))
    const copy = duplicateSequence(p, S1, 'copy')
    const from = timelineOf(copy, S1).captions.clips
    const to = timelineOf(copy, 'copy').captions.clips
    expect(to.map((c) => c.words)).toEqual(from.map((c) => c.words))
    expect(to.some((c) => from.some((f) => f.id === c.id))).toBe(false)
  })
})

describe('editing captions by hand', () => {
  /** "one two three" over 100 to 134, and "four five" from 200, three words a caption. */
  function two(): Timeline {
    const t = talking()
    return setCaptions(
      { ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 3 } } },
      [word('one', 100, 10), word('two', 112, 10), word('three', 124, 10), word('four', 200, 10), word('five', 212, 10)],
      []
    )
  }
  /** An edit to the first of those captions, made on them. */
  function onFirst(e: (id: string) => ClipEdit): Timeline {
    const t = two()
    return edit(t, e(t.captions.clips[0]!.id))
  }

  it('moves a caption where it is dragged, not back to its words, and marks the captions changed by hand', () => {
    const t = onFirst((id) => ({ kind: 'moveCaption', captionId: id, start: 150 }))
    expect(captions(t)).toEqual([
      ['one two three', 150, 184],
      ['four five', 200, 222]
    ])
    expect(t.captions.edited).toBe(true)
  })

  it('stops a moved caption against the one next to it, so no words next door are lost, as the owner chose', () => {
    // Asked for 190, it goes as far as 166, where it ends at the start of "four five".
    expect(captions(onFirst((id) => ({ kind: 'moveCaption', captionId: id, start: 190 })))).toEqual([
      ['one two three', 166, 200],
      ['four five', 200, 222]
    ])
    expect(captions(onFirst((id) => ({ kind: 'moveCaption', captionId: id, start: -40 })))[0]).toEqual(['one two three', 0, 34])
  })

  it('stops a caption at the end of the clips, moved or trimmed, so none adds black to the end', () => {
    const t = two()
    const last = t.captions.clips[1]!.id
    // The song under everything ends at 600.
    expect(captions(edit(t, { kind: 'moveCaption', captionId: last, start: 900 }))[1]).toEqual(['four five', 578, 600])
    expect(captions(edit(t, { kind: 'trimCaption', captionId: last, edge: 'end', frame: 900 }))[1]).toEqual(['four five', 200, 600])
  })

  it('trims a caption, its words keeping their share, and stops at the next caption and at a frame a word', () => {
    const t = onFirst((id) => ({ kind: 'trimCaption', captionId: id, edge: 'end', frame: 117 }))
    expect(t.captions.clips[0]!.words.map((w) => [w.start, w.length])).toEqual([
      [0, 5],
      [6, 5],
      [12, 5]
    ])
    expect(captions(onFirst((id) => ({ kind: 'trimCaption', captionId: id, edge: 'end', frame: 400 })))[0]).toEqual(['one two three', 100, 200])
    expect(captions(onFirst((id) => ({ kind: 'trimCaption', captionId: id, edge: 'start', frame: 133 })))[0]).toEqual(['one two three', 131, 134])
    // The second's head stops where the first ends.
    const both = two()
    expect(captions(edit(both, { kind: 'trimCaption', captionId: both.captions.clips[1]!.id, edge: 'start', frame: 50 }))[1]).toEqual(['four five', 134, 222])
  })

  it('splits a caption at a frame, and takes one away', () => {
    const split = onFirst((id) => ({ kind: 'splitCaption', captionId: id, frame: 118 }))
    expect(captions(split)).toEqual([
      ['one two', 100, 124],
      ['three', 124, 134],
      ['four five', 200, 222]
    ])
    expect(captions(onFirst((id) => ({ kind: 'removeCaption', captionId: id })))).toEqual([['four five', 200, 222]])
  })

  it('takes a caption\'s words as typed, and takes the caption away when nothing is', () => {
    const typed = onFirst((id) => ({ kind: 'setCaptionWords', captionId: id, text: 'one too three' }))
    expect(captions(typed)[0]).toEqual(['one too three', 100, 134])
    expect(typed.captions.edited).toBe(true)
    expect(captions(onFirst((id) => ({ kind: 'setCaptionWords', captionId: id, text: '  ' })))).toEqual([['four five', 200, 222]])
    // The same words again change nothing, and nothing is changed by hand.
    expect(onFirst((id) => ({ kind: 'setCaptionWords', captionId: id, text: 'one  two three ' })).captions.edited).toBe(false)
  })

  it('fits more words typed than a caption has frames for into the room before the next, or takes none', () => {
    let t = talking()
    t = setCaptions({ ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 3 } } }, [word('so', 100, 1), word('i', 101, 1), word('think.', 102, 1), word('That', 104, 3)], [])
    // "so i think.", 100 to 103, and "That" from 103 (run on to it). The full stop keeps them apart.
    expect(captions(t)).toEqual([
      ['so i think.', 100, 104],
      ['That', 104, 107]
    ])
    const more = edit(t, { kind: 'setCaptionWords', captionId: t.captions.clips[0]!.id, text: 'so i do think.' })
    expect(captions(more)).toEqual([
      ['so i do think.', 100, 104],
      ['That', 104, 107]
    ])
    // Five words in four frames cannot be: nothing changes.
    expect(edit(t, { kind: 'setCaptionWords', captionId: t.captions.clips[0]!.id, text: 'so i do really think.' })).toBe(t)
  })

  it('groups the same words again for another number of words at a time, without calling it changed by hand', () => {
    const t = edit(two(), { kind: 'setCaptionStyle', style: { wordsPerCaption: 2 } })
    expect(captions(t)).toEqual([
      ['one two', 100, 124],
      ['three', 124, 134],
      ['four five', 200, 222]
    ])
    expect(t.captions.edited).toBe(false)
    expect(t.captions.style.wordsPerCaption).toBe(2)
  })

  it('groups them again by the rule, keeping a word fixed by hand and undoing a split made by hand', () => {
    const said = [word('we', 100), word('are', 110), word('going', 120), word('to', 130), word('fix', 140), word('it', 150), word('now.', 160)]
    let t = talking()
    t = setCaptions({ ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 3 } } }, said, [])
    const made = captions(t)
    // Split by hand, and a word fixed.
    t = edit(t, { kind: 'splitCaption', captionId: t.captions.clips[0]!.id, frame: 110 })
    t = edit(t, { kind: 'setCaptionWords', captionId: t.captions.clips.at(-1)!.id, text: made.at(-1)![0].replace('now.', 'today.') })
    expect(captions(t).length).toBe(made.length + 1)
    const again = edit(t, { kind: 'regroupCaptions' })
    // The same groups as when they were made, the split gone, the fixed word kept.
    expect(captions(again).map(([, from, to]) => [from, to])).toEqual(made.map(([, from, to]) => [from, to]))
    expect(captions(again).at(-1)![0]).toContain('today.')
    expect(wordsOf(again.captions.clips)).toEqual(wordsOf(t.captions.clips))
  })

  it('does nothing to a sequence with no captions', () => {
    const t = talking()
    const none = { ...t, captions: { ...t.captions, clips: [] } }
    expect(edit(none, { kind: 'regroupCaptions' })).toBe(none)
  })

  it('moves one caption on its own, and gives it back to the style', () => {
    const t = talking()
    const [first, second] = t.captions.clips
    const moved = edit(t, { kind: 'placeCaption', captionId: first!.id, at: { x: 0.2, y: 0.3 } })
    expect(moved.captions.clips[0]!.at).toEqual({ x: 0.2, y: 0.3 })
    expect(moved.captions.clips.find((c) => c.id === second!.id)!.at).toBeUndefined()
    expect(moved.captions.edited).toBe(true)
    const back = edit(moved, { kind: 'placeCaption', captionId: first!.id, at: null })
    expect('at' in back.captions.clips[0]!).toBe(false)
  })

  it('relocates the ones that follow the style, and the hand placed ones only when asked', () => {
    let t = talking()
    const hand = t.captions.clips[0]!.id
    t = edit(t, { kind: 'placeCaption', captionId: hand, at: { x: 0.2, y: 0.3 } })
    const kept = edit(t, { kind: 'relocateCaptions', at: { x: 0.5, y: 0.1 }, includeHand: false })
    expect(kept.captions.style).toMatchObject({ across: 0.5, height: 0.1 })
    expect(kept.captions.clips.find((c) => c.id === hand)!.at).toEqual({ x: 0.2, y: 0.3 })
    const all = edit(t, { kind: 'relocateCaptions', at: { x: 0.5, y: 0.1 }, includeHand: true })
    expect(all.captions.clips.every((c) => c.at === undefined)).toBe(true)
  })

  it('keeps where a caption was put by hand when the words are grouped again', () => {
    let t = talking()
    t = edit(t, { kind: 'placeCaption', captionId: t.captions.clips[0]!.id, at: { x: 0.2, y: 0.3 } })
    const again = edit(t, { kind: 'regroupCaptions' })
    expect(again.captions.clips[0]!.at).toEqual({ x: 0.2, y: 0.3 })
    expect(again.captions.clips.slice(1).every((c) => c.at === undefined)).toBe(true)
  })

  it('keeps a setting of how they look that it cannot use as it was', () => {
    const t = edit(two(), { kind: 'setCaptionStyle', style: { size: 5, highlight: 'red', capitals: false } })
    expect(t.captions.style).toMatchObject({ size: 0.07, highlight: '#FFD400', capitals: false })
  })
})
