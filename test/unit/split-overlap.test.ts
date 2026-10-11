import { describe, it, expect } from 'vitest'
import {
  addSource,
  closeUpClip,
  createTimeline,
  joinClips,
  joinRefusal,
  linkedIds,
  moveClip,
  splitClip,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * S pressed where one shot's sound overlaps the next (audit 2026-10-08, fix
 * first 1). The clip linked to the one cut that starts after the frame is not
 * cut, but it is what plays with the second piece, so it must be linked to
 * that piece and not to the sliver before the frame.
 */

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

/**
 * Shot P (a, 0 to 100) and shot Q (b, 100 to 200) on V1, each with its sound
 * on A1. `pSoundEnd` and `qSoundStart` move the sounds' shared edge: an L-cut
 * runs P's sound on under Q, a J-cut starts Q's sound under P.
 */
function shots(pSoundEnd: number, qSoundStart: number): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }), media: [media('a', 10), media('b', 10)] }
  t = addSource(t, { mediaId: 'a', clipId: 'P', at: 0, onTrack: 'v1' })
  t = addSource(t, { mediaId: 'b', clipId: 'Q', at: 400, onTrack: 'v1' })
  const pSound = t.audioTracks[0]!.clips.find((c) => c.mediaId === 'a')!
  const qSound = t.audioTracks[0]!.clips.find((c) => c.mediaId === 'b')!
  const p = t.videoTracks[0]!.clips.find((c) => c.id === 'P')!
  const q = t.videoTracks[0]!.clips.find((c) => c.id === 'Q')!
  return {
    ...t,
    videoTracks: [{ ...t.videoTracks[0]!, clips: [{ ...p, sourceIn: 0, sourceOut: 100, timelineStart: 0 }, { ...q, sourceIn: 100, sourceOut: 200, timelineStart: 100 }] }],
    audioTracks: [
      {
        ...t.audioTracks[0]!,
        clips: [
          { ...pSound, id: 'PS', sourceIn: 0, sourceOut: pSoundEnd, timelineStart: 0 },
          { ...qSound, id: 'QS', sourceIn: qSoundStart, sourceOut: 200, timelineStart: qSoundStart }
        ]
      }
    ]
  }
}

/** The V1 clip starting at `frame`. */
function pictureAt(t: Timeline, frame: number): string {
  return t.videoTracks[0]!.clips.find((c) => c.timelineStart === frame)!.id
}

describe('S inside an overlap of one shot sound with the next', () => {
  it('links the second piece of the picture to its sound in an L-cut', () => {
    const s = splitClip(shots(120, 120), 110)
    const second = pictureAt(s, 110)
    expect(linkedIds(s, second).sort()).toEqual([second, 'QS'].sort())
    expect(linkedIds(s, pictureAt(s, 100))).not.toContain('QS')
  })

  it('leaves the sound in place when the sliver before the cut is closed up', () => {
    const s = splitClip(shots(120, 120), 110)
    const closed = closeUpClip(s, pictureAt(s, 100))
    expect(closed.audioTracks[0]!.clips.map((c) => c.id)).toContain('QS')
  })

  it('links the picture to the second piece of the sound in a J-cut, the sound selected', () => {
    const s = splitClip(shots(80, 80), 90, 'QS')
    const secondSound = s.audioTracks[0]!.clips.find((c) => c.timelineStart === 90)!.id
    expect(linkedIds(s, 'Q').sort()).toEqual(['Q', secondSound].sort())
    expect(linkedIds(s, 'QS')).not.toContain('Q')
  })
})

describe('joining back the two pieces S left inside an overlap (audit 2026-10-10, fix first 3)', () => {
  /** Where a clip starts and ends on the timeline. */
  const span = (t: Timeline, id: string): [number, number] => {
    const c = [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)].find((x) => x.id === id)!
    return [c.timelineStart, c.timelineStart + c.sourceOut - c.sourceIn]
  }

  it('joins the pictures in an L-cut, keeping the picture and its sound one group that drags together', () => {
    const s = splitClip(shots(120, 120), 110)
    const [first, second] = [pictureAt(s, 100), pictureAt(s, 110)]
    expect(joinRefusal(s, first, second)).toBeNull()
    const joined = joinClips(s, [first, second])
    expect(joined.videoTracks[0]!.clips).toHaveLength(2)
    expect(span(joined, first)).toEqual([100, 200])
    expect(linkedIds(joined, first).sort()).toEqual([first, 'QS'].sort())
    const moved = moveClip(joined, first, joined.videoTracks[0]!.id, 300)
    expect(span(moved, first)).toEqual([300, 400])
    expect(span(moved, 'QS')).toEqual([320, 400])
  })

  it('keeps them one group when the picture is joined selected alone with Alt', () => {
    const s = splitClip(shots(120, 120), 110)
    const [first, second] = [pictureAt(s, 100), pictureAt(s, 110)]
    const joined = joinClips(s, [first, second], true)
    expect(linkedIds(joined, first).sort()).toEqual([first, 'QS'].sort())
  })

  it('joins the sounds in a J-cut, keeping the sound and its picture one group', () => {
    const s = splitClip(shots(80, 80), 90, 'QS')
    const secondSound = s.audioTracks[0]!.clips.find((c) => c.timelineStart === 90)!.id
    expect(joinRefusal(s, 'QS', secondSound)).toBeNull()
    const joined = joinClips(s, ['QS', secondSound])
    expect(span(joined, 'QS')).toEqual([80, 200])
    expect(linkedIds(joined, 'Q').sort()).toEqual(['Q', 'QS'].sort())
  })

  it('still refuses when a linked clip is cut at the same frame but does not carry on', () => {
    const s = splitClip(shots(100, 100), 150)
    const [first, second] = [pictureAt(s, 100), pictureAt(s, 150)]
    const sounds = s.audioTracks[0]!.clips.filter((c) => c.mediaId === 'b')
    const trimmed = { ...s, audioTracks: [{ ...s.audioTracks[0]!, clips: s.audioTracks[0]!.clips.map((c) => (c.id === sounds[1]!.id ? { ...c, sourceIn: c.sourceIn + 5 } : c)) }] }
    expect(joinRefusal(trimmed, first, second)).not.toBeNull()
  })
})
