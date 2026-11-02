import { describe, it, expect } from 'vitest'
import { addSource, addTrack, allClips, closeUpClipBlockers, createTimeline, gapCanClose, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { spanEnd } from '../../src/shared/tracks'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Task 1460: in the owner's rough cut 101, a word taken out of V1 and A1 left
 * an 11-frame gap that would not close. Further on, a time-lapse of 4x pieces
 * each overlapped the one before it by a frame, a piece of 34 frames taking
 * 9 frames of the timeline but laid 8 after the last. Closing the gap moved
 * them all up as one, and settling the tracks then pushed each along by its
 * overlap, apart from the music under them, so the gap was refused as putting
 * clips out of step. An overlap the track already had is left as it was.
 */

const media: ProjectMedia = {
  id: 'r',
  originalPath: 'C:\\v\\r.mp4',
  playablePath: 'C:\\v\\r.mp4',
  conformed: false,
  conformReasons: [],
  durationSec: 100,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  hasAudio: true,
  peaksPath: '',
  filmstripPath: ''
}

type Piece = { id: string; at: number; from: number; to: number; speed?: number }

/**
 * V1 and A1: P1, the word S (11 frames), P2, then two 4x pieces F1 and F2,
 * F2 laid a frame inside F1's end, then P3. Music on A2 under the time-lapse.
 */
function roughCut(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }), media: [media] }
  t = addSource(t, { mediaId: 'r', clipId: 'T', at: 0, onTrack: 'v1' })
  t = addTrack(t, 'audio', 'a2')
  const picture = t.videoTracks[0]!.clips[0]!
  const sound = t.audioTracks[0]!.clips[0]!
  const pieces: Piece[] = [
    { id: 'P1', at: 0, from: 0, to: 100 },
    { id: 'S', at: 100, from: 100, to: 111 },
    { id: 'P2', at: 111, from: 111, to: 200 },
    { id: 'F1', at: 200, from: 1000, to: 1034, speed: 4 },
    { id: 'F2', at: 208, from: 1034, to: 1122, speed: 4 },
    { id: 'P3', at: 230, from: 2000, to: 2070 }
  ]
  const lay = <T extends typeof picture | typeof sound>(like: T, p: Piece, id: string): T => ({
    ...like, id, link: p.id, timelineStart: p.at, sourceIn: p.from, sourceOut: p.to, ...(p.speed ? { speed: p.speed } : {})
  })
  const music = { ...sound, id: 'M', timelineStart: 200, sourceIn: 2500, sourceOut: 2530 }
  delete (music as { link?: string }).link
  return {
    ...t,
    videoTracks: [{ ...t.videoTracks[0]!, clips: pieces.map((p) => lay(picture, p, p.id)) }],
    audioTracks: [
      { ...t.audioTracks[0]!, clips: pieces.map((p) => lay(sound, p, `${p.id}.a`)) },
      { ...t.audioTracks[1]!, clips: [music] }
    ]
  }
}

function where(t: Timeline): Record<string, [number, number]> {
  return Object.fromEntries(allClips(t).map((c) => [c.id, [c.timelineStart, spanEnd(c)]]))
}

describe('closing a gap before clips that already overlap', () => {
  it('has the scene it means: F2 a frame inside F1 on both tracks', () => {
    const at = where(roughCut())
    expect(at['F1']).toEqual([200, 209])
    expect(at['F2']).toEqual([208, 230])
    expect(at['F2.a']).toEqual([208, 230])
  })

  it('closes the gap the word leaves, moving everything after it up by exactly the gap', () => {
    const cut = applyClipEdit(roughCut(), { kind: 'removeClip', clipId: 'S' })
    const before = where(cut)
    expect(before['S']).toBeUndefined()
    expect(before['S.a']).toBeUndefined()
    for (const trackId of ['v1', 'a1']) expect(gapCanClose(cut, { trackId, from: 100, to: 111 })).toBe(true)

    const closed = applyClipEdit(cut, { kind: 'closeUpGap', gap: { trackId: 'v1', from: 100, to: 111 } })
    const after = where(closed)
    for (const [id, [start, end]] of Object.entries(before)) {
      expect(after[id], id).toEqual(start < 100 ? [start, end] : [start - 11, end - 11])
    }
  })

  it('takes the word out closing up too, with Shift+Delete', () => {
    const t = roughCut()
    expect(closeUpClipBlockers(t, 'S')).toEqual([])
    const after = where(applyClipEdit(t, { kind: 'closeUpClip', clipId: 'S' }))
    expect(after['P2']).toEqual([100, 189])
    expect(after['F1']).toEqual([189, 198])
    expect(after['F2']).toEqual([197, 219])
    expect(after['F2.a']).toEqual([197, 219])
    expect(after['M']).toEqual([189, 219])
    expect(after['P3']).toEqual([219, 289])
  })
})
