import { describe, it, expect } from 'vitest'
import {
  addSource,
  addTrack,
  allClips,
  closeUpBlockers,
  closeUpClip,
  closeUpClipBlockers,
  closeUpGap,
  createTimeline,
  findClip,
  gapCanClose,
  linkedIds,
  rearrangeClip,
  rippleTrim,
  rippleTrimBlockers,
  timelineDuration,
  trimToFrame,
  trimToFrameBlockers,
  v1End,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { spanEnd } from '../../src/shared/tracks'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Closing up never pushes a clip out of step. Every edit that takes time out
 * of the sequence from V1 (Shift+Delete, I and O, a Ctrl trim or drag, and
 * closing a gap) moves what comes after it earlier. A clip left whole across
 * the stretch, such as a voice over, can be in the way of one moving up on the
 * same track, such as a recording's microphone stream; the track would push
 * that one along past it, out of step with its picture, and the sequence
 * would end later than its last picture, in black. Such an edit is refused.
 */

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
 * V1: A (0 to 300) and X (300 to 400), phone clips with one stream each, then
 * B (400 to 700), an OBS recording with two, its microphone stream B.2 on a
 * second audio track. On that track, a voice over recorded over A runs from
 * 150 to 390, across the start of X.
 */
function voiceOverBesideMic(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 10), media('x', 10), media('b', 10, { audioTracks: 2 }), media('vo', 240 / 30, SOUND)]
  }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  t = addSource(t, { mediaId: 'x', clipId: 'X', at: 300, onTrack: 'v1' })
  t = rippleTrimTo(t, 'X', 100)
  t = addSource(t, { mediaId: 'b', clipId: 'B', at: 400, onTrack: 'v1' })
  const mic = findClip(t, 'B.2')!
  return addSource(t, { mediaId: 'vo', clipId: 'VO', at: 150, onTrack: mic.kind === 'audio' ? mic.track.id : '' })
}

/** X cut to `length` frames without touching anything else: it is last on V1 when this is called. */
function rippleTrimTo(t: Timeline, clipId: string, length: number): Timeline {
  return rippleTrim(t, clipId, 'end', length)
}

/** Every clip linked to another shows the same frame of their recording at the same moment. */
function expectGroupsInStep(t: Timeline): void {
  for (const c of allClips(t)) {
    for (const id of linkedIds(t, c.id)) {
      const o = findClip(t, id)!.clip
      if (o.mediaId === c.mediaId) expect(o.timelineStart - o.sourceIn, `${id} against ${c.id}`).toBe(c.timelineStart - c.sourceIn)
    }
  }
}

describe('closing up with a clip in the way', () => {
  it('has the scene it means: B.2 on the voice over\'s track, the voice over running across the start of X', () => {
    const t = voiceOverBesideMic()
    const vo = findClip(t, 'VO')!
    const mic = findClip(t, 'B.2')!
    expect(vo.kind === 'audio' && mic.kind === 'audio' && vo.track.id === mic.track.id).toBe(true)
    expect([vo.clip.timelineStart, spanEnd(vo.clip)]).toEqual([150, 390])
    expect([findClip(t, 'X')!.clip.timelineStart, spanEnd(findClip(t, 'X')!.clip)]).toEqual([300, 400])
    expect(timelineDuration(t)).toBe(700)
  })

  it('refuses Shift+Delete on X, which would push B.2 along past the voice over, and says what is in the way', () => {
    const t = voiceOverBesideMic()
    expect(closeUpClipBlockers(t, 'X').map((c) => c.id)).toEqual(['B.2'])
    expect(closeUpClip(t, 'X')).toBe(t)
  })

  it('refuses I and O on V1 that would close up past the voice over', () => {
    const t = voiceOverBesideMic()
    // O at 320: X's last 80 frames come out, and B moves up to 320.
    expect(trimToFrameBlockers(t, 'X', 'end', 320).map((c) => c.id)).toEqual(['B.2'])
    expect(trimToFrame(t, 'X', 'end', 320)).toBe(t)
    expect(trimToFrame(t, 'X', 'start', 380)).toBe(t)
  })

  it('trims X\'s end plainly, leaving a gap, when a drag that would close up past the voice over is held back (plan 82)', () => {
    const t = voiceOverBesideMic()
    const x = findClip(t, 'X')!.clip
    const after = applyClipEdit(t, { kind: 'setClipOut', clipId: 'X', frame: x.sourceIn + 20, closeUp: true })
    const trimmed = findClip(after, 'X')!.clip
    expect(trimmed.sourceOut - trimmed.sourceIn).toBe(20)
    // Nothing after it moved: B is where it was, in step with its microphone.
    expect(findClip(after, 'B')!.clip.timelineStart).toBe(findClip(t, 'B')!.clip.timelineStart)
    expectGroupsInStep(after)
  })

  it('refuses a Ctrl trim of X\'s end that would close up past the voice over', () => {
    const t = voiceOverBesideMic()
    expect(rippleTrim(t, 'X', 'end', 20)).toBe(t)
  })

  it('refuses a Ctrl drag taking X out of V1 that would close up past the voice over', () => {
    const t = voiceOverBesideMic()
    expect(rearrangeClip(t, 'X', 'v1', 900)).toBe(t)
  })

  it('refuses to close a gap when that would push a linked clip along past one left whole across it', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [media('a', 10), media('b', 10, { audioTracks: 2 }), media('vo', 250 / 30, SOUND)]
    }
    // V1: A 0 to 300, a gap to 400, B from 400; the voice over runs from 150 to the gap's end.
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 400, onTrack: 'v1' })
    const mic = findClip(t, 'B.2')!
    t = addSource(t, { mediaId: 'vo', clipId: 'VO', at: 150, onTrack: mic.kind === 'audio' ? mic.track.id : '' })
    const gap = { trackId: 'v1', from: 300, to: 400 }
    expect(closeUpBlockers(t, 300, 100).map((c) => c.id)).toEqual(['B.2'])
    expect(gapCanClose(t, gap)).toBe(false)
    expect(closeUpGap(t, gap)).toBe(t)
  })

  it('still closes up when nothing is in the way, the groups in step and the sequence ending at its last picture', () => {
    let t = voiceOverBesideMic()
    // Without the voice over, X comes out cleanly.
    t = { ...t, audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => c.id !== 'VO') })) }
    const out = closeUpClip(t, 'X')
    expect(out).not.toBe(t)
    expect(findClip(out, 'B')!.clip.timelineStart).toBe(300)
    expect(findClip(out, 'B.2')!.clip.timelineStart).toBe(300)
    expectGroupsInStep(out)
    expect(timelineDuration(out)).toBe(v1End(out))
  })

  it('still closes up when two overlays of their own inside the stretch land together, as it always has', () => {
    let t = voiceOverBesideMic()
    t = { ...t, audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => c.id !== 'VO') })) }
    t = { ...t, media: [...t.media, media('o', 1, { hasAudio: false })] }
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'o', clipId: 'O1', at: 310, onTrack: 'v2' })
    t = addSource(t, { mediaId: 'o', clipId: 'O2', at: 350, onTrack: 'v2' })
    // Both start inside X and move to 300; the second goes on after the first, linked to nothing.
    const out = closeUpClip(t, 'X')
    expect(out).not.toBe(t)
    expect(findClip(out, 'O1')!.clip.timelineStart).toBe(300)
    expect(findClip(out, 'O2')!.clip.timelineStart).toBe(330)
  })
})

describe('what is in the way of an edge drag on V1 (audit 2026-10-01)', () => {
  it('is nothing when the edge goes out, which never closes anything up', () => {
    const t = voiceOverBesideMic()
    expect(rippleTrimBlockers(t, 'X', 'end', 200)).toEqual([])
    expect(rippleTrimBlockers(t, 'B', 'start', 0)).toEqual([])
  })

  it('names what the edit itself would refuse for, and nothing when it would go ahead', () => {
    const t = voiceOverBesideMic()
    // X shorter at its end: B moves up under the voice over, which stays, beside B's own mic stream.
    const blockers = rippleTrimBlockers(t, 'X', 'end', 50)
    expect(blockers.length).toBeGreaterThan(0)
    expect(rippleTrim(t, 'X', 'end', 50)).toBe(t)
    // A shorter at its end: nothing follows that cannot.
    expect(rippleTrimBlockers(t, 'A', 'end', 250).length === 0).toBe(rippleTrim(t, 'A', 'end', 250) !== t)
  })
})
