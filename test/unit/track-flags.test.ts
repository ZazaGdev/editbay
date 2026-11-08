import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  addTrack,
  allClips,
  createTimeline,
  setTrackHidden,
  setTrackLocked,
  setTrackMuted,
  setTrackName,
  trackLabel,
  moveTrack,
  removeTrack,
  captionsAbove,
  createProject,
  withTimeline,
  CAPTION_TRACK_ID,
  FIRST_SEQUENCE_ID,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { setCaptions } from '../../src/shared/timeline-captions'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { MAX_TRACK_NAME, cleanTrackName, isHidden, isLocked, isMuted, lockedTrackChanged } from '../../src/shared/tracks'
import { applyClipEdit } from '../../src/main/project/session'
import type { ClipEdit } from '../../src/shared/types'

/**
 * Plan 20, step 3: a track that is not heard, and a track that cannot be
 * changed. Mute is a decision about the edit, so it is saved and exported.
 * Lock is a decision about the edit too, and it has to be asked by every edit
 * there is: one it misses makes a lock that says the work is safe when it is
 * not.
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

/** A take on V1 with its sound on A1, and music on A2. */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 10), media('song', 20, SOUND)]
  }
  t = addClip(t, 'talk', 'p1')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

function trackOfClip(t: Timeline, clipId: string): string {
  const track = [...t.videoTracks, ...t.audioTracks].find((r) => r.clips.some((c) => c.id === clipId))
  if (!track) throw new Error(`no track holds ${clipId}`)
  return track.id
}

describe('a track that is not heard', () => {
  it('carries the flag only when it is set, so an old file reads the same as a new one', () => {
    const t = cut()
    expect(isMuted(t.audioTracks[0])).toBe(false)
    expect('muted' in t.audioTracks[0]!).toBe(false)
    const muted = setTrackMuted(t, t.audioTracks[0]!.id, true)
    expect(isMuted(muted.audioTracks[0])).toBe(true)
  })

  it('is heard again when it is unmuted', () => {
    const t = setTrackMuted(cut(), 'a1', true)
    expect(isMuted(setTrackMuted(t, 'a1', false).audioTracks[0])).toBe(false)
  })

  it('leaves every other track alone', () => {
    const t = cut()
    const muted = setTrackMuted(t, t.audioTracks[1]!.id, true)
    expect(isMuted(muted.audioTracks[0])).toBe(false)
    expect(isMuted(muted.audioTracks[1])).toBe(true)
    expect(allClips(muted).length).toBe(allClips(t).length)
  })

  it('does nothing at all for a track that is not there', () => {
    const t = cut()
    expect(setTrackMuted(t, 'gone', true)).toEqual(t)
  })
})

describe('a track that cannot be changed', () => {
  it('refuses an edit that would move one of its clips', () => {
    const t = setTrackLocked(cut(), 'v1', true)
    const moved = applyClipEdit(t, { kind: 'moveClip', clipId: 'p1', trackId: 'v1', start: 60 })
    expect(moved).toEqual(t)
  })

  it('lets an edit through that changes another track', () => {
    const t = setTrackLocked(cut(), 'v1', true)
    const changed = applyClipEdit(t, { kind: 'setClipAudio', clipId: 'music', gain: 0.5, muted: false })
    expect(changed).not.toEqual(t)
  })

  it('can always be unlocked, which is the one edit it does not refuse', () => {
    const t = setTrackLocked(cut(), 'v1', true)
    const free = applyClipEdit(t, { kind: 'setTrackLocked', trackId: 'v1', locked: false })
    expect(isLocked(free.videoTracks[0])).toBe(false)
  })

  it('is asked by every kind of edit there is, not most of them', () => {
    // One of each kind that could touch a track's clips, run against a locked
    // V1 and a locked A1. Each has to leave the locked track exactly as it was.
    const base = cut()
    const v1 = trackOfClip(base, 'p1')
    const a1 = trackOfClip(base, 'music')
    const edits: ClipEdit[] = [
      { kind: 'addSource', mediaId: 'talk', clipId: 'n', at: 0, onTrack: v1 },
      { kind: 'removeClip', clipId: 'p1' },
      { kind: 'closeUpClip', clipId: 'p1' },
      { kind: 'removeClips', clipIds: ['p1'] },
      { kind: 'moveClip', clipId: 'p1', trackId: v1, start: 30 },
      { kind: 'setClipIn', clipId: 'p1', frame: 10 },
      { kind: 'setClipOut', clipId: 'p1', frame: 100 },
      { kind: 'split', frame: 60 },
      { kind: 'splitAll', frame: 60 },
      { kind: 'removeRange', from: 10, to: 40 },
      { kind: 'removeRange', from: 10, to: 40, closeUp: true },
      { kind: 'removeStretches', stretches: [{ from: 10, to: 40 }] },
      { kind: 'trimToFrame', clipId: 'p1', edge: 'start', frame: 20 },
      { kind: 'removeClip', clipId: 'music' },
      { kind: 'closeUpGap', gap: { trackId: a1, from: 600, to: 700 } }
    ]

    for (const track of [v1, a1]) {
      const locked = setTrackLocked(base, track, true)
      const before = [...locked.videoTracks, ...locked.audioTracks].find((r) => r.id === track)!.clips
      for (const edit of edits) {
        const after = applyClipEdit(locked, edit)
        const now = [...after.videoTracks, ...after.audioTracks].find((r) => r.id === track)?.clips ?? []
        expect(
          now.map((c) => `${c.id}:${c.timelineStart}:${c.sourceIn}:${c.sourceOut}`),
          `${edit.kind} changed the locked ${track}`
        ).toEqual(before.map((c) => `${c.id}:${c.timelineStart}:${c.sourceIn}:${c.sourceOut}`))
      }
    }
  })

  it('refuses an edit that changes anything about one of its clips, not only where it is (audit 2026-10-19)', () => {
    // The take's sound on a locked A1, its picture free on V1. Each of these
    // went through: the lock looked only at where a clip sits in time.
    const base = cut()
    const sound = base.audioTracks[0]!.clips[0]!.id
    const locked = setTrackLocked(base, 'a1', true)
    const before = locked.audioTracks[0]!.clips
    const edits: ClipEdit[] = [
      { kind: 'addTransition', clipId: 'p1', side: 'in', length: 20 },
      { kind: 'setFade', clipId: sound, side: 'in', length: 20 },
      { kind: 'setClipAudio', clipId: sound, gain: 0.2, muted: true },
      { kind: 'unlink', clipId: 'p1' },
      { kind: 'setClipMark', clipId: 'p1', mark: 'red' },
      { kind: 'setClipDenoise', clipId: sound, on: true }
    ]
    for (const edit of edits) {
      const after = applyClipEdit(locked, edit)
      expect(after.audioTracks[0]!.clips, `${edit.kind} changed the locked A1`).toEqual(before)
    }
  })
})

describe('what counts as changing a locked track', () => {
  it('sees a clip added, taken away, moved or trimmed', () => {
    const t = setTrackLocked(cut(), 'v1', true)
    const withNothing = { ...t, videoTracks: [{ ...t.videoTracks[0]!, clips: [] }], audioTracks: t.audioTracks }
    expect(lockedTrackChanged(t, withNothing)).toBe('v1')
    const moved = {
      ...t,
      videoTracks: [{ ...t.videoTracks[0]!, clips: t.videoTracks[0]!.clips.map((c) => ({ ...c, timelineStart: 99 })) }]
    }
    expect(lockedTrackChanged(t, moved)).toBe('v1')
  })

  it('sees a locked track that has gone altogether', () => {
    let t = cut()
    t = addTrack(t, 'video', 'v2')
    t = setTrackLocked(t, 'v2', true)
    const without = { ...t, videoTracks: t.videoTracks.filter((r) => r.id !== 'v2') }
    expect(lockedTrackChanged(t, without)).toBe('v2')
  })

  it('says nothing when only an unlocked track changed', () => {
    const t = setTrackLocked(cut(), 'v1', true)
    const quieter = {
      ...t,
      audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, gain: 0.5 })) }))
    }
    expect(lockedTrackChanged(t, quieter)).toBe(null)
  })

  it('says nothing when nothing is locked at all', () => {
    const t = cut()
    const changed = { ...t, videoTracks: [{ ...t.videoTracks[0]!, clips: [] }] }
    expect(lockedTrackChanged(t, changed)).toBe(null)
  })
})

describe('a track you have called something', () => {
  it('is its number until it is named', () => {
    const t = cut()
    expect(trackLabel(t, 'v1')).toBe('V1')
    expect(trackLabel(t, t.audioTracks[1]!.id)).toBe('A2')
    expect('name' in t.videoTracks[0]!).toBe(false)
  })

  it('is what you called it once it is named', () => {
    const named = setTrackName(cut(), 'v1', 'Facecam')
    expect(trackLabel(named, 'v1')).toBe('Facecam')
    expect(named.videoTracks[0]!.name).toBe('Facecam')
  })

  it('goes back to its number when the name is cleared', () => {
    const t = setTrackName(cut(), 'v1', 'Facecam')
    const bare = setTrackName(t, 'v1', '   ')
    expect(trackLabel(bare, 'v1')).toBe('V1')
    expect(bare.videoTracks[0]!.name).toBeUndefined()
  })

  it('tidies the spaces and holds the length', () => {
    expect(cleanTrackName('  Game   capture  ')).toBe('Game capture')
    expect(cleanTrackName('')).toBeUndefined()
    expect(cleanTrackName(42)).toBeUndefined()
    expect(cleanTrackName('x'.repeat(MAX_TRACK_NAME + 10))?.length).toBe(MAX_TRACK_NAME)
  })

  it('leaves every other track alone, and does nothing for one that is not there', () => {
    const t = cut()
    const named = setTrackName(t, 'a1', 'Mic')
    expect(trackLabel(named, 'a1')).toBe('Mic')
    expect(trackLabel(named, 'v1')).toBe('V1')
    expect(setTrackName(t, 'gone', 'Mic')).toEqual(t)
  })

  it('is what a name it cannot draw comes back as: nothing at all', () => {
    expect(trackLabel(cut(), 'gone')).toBe('')
  })
})

describe('a picture track that is not drawn', () => {
  it('carries the flag only when it is set, so an old file reads the same as a new one', () => {
    const t = cut()
    expect(isHidden(t.videoTracks[0])).toBe(false)
    expect('hidden' in t.videoTracks[0]!).toBe(false)
    expect(isHidden(setTrackHidden(t, 'v1', true).videoTracks[0])).toBe(true)
  })

  it('is drawn again when it is shown', () => {
    const t = setTrackHidden(cut(), 'v1', true)
    expect(isHidden(setTrackHidden(t, 'v1', false).videoTracks[0])).toBe(false)
  })

  it('keeps its clips: hiding a track is not emptying it', () => {
    const t = cut()
    const gone = setTrackHidden(t, 'v1', true)
    expect(allClips(gone).length).toBe(allClips(t).length)
  })

  it('does nothing at all for a track that is not there', () => {
    const t = cut()
    expect(setTrackHidden(t, 'gone', true)).toEqual(t)
  })
})

describe('a track moved among the tracks of its kind (task 2613)', () => {
  /** V1 to V3, each with a clip of its own, and the top one named. */
  function stacked(): Timeline {
    let t = addTrack(addTrack(cut(), 'video', 'v2'), 'video', 'v3')
    t = setTrackName(t, 'v3', 'Facecam')
    t = addSource(t, { mediaId: 'talk', clipId: 'on2', at: 0, onTrack: 'v2' })
    return addSource(t, { mediaId: 'talk', clipId: 'on3', at: 0, onTrack: 'v3' })
  }

  it('takes its clips with it, and the tracks between close up', () => {
    const t = moveTrack(stacked(), 'v3', 0)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v3', 'v1', 'v2'])
    expect(trackOfClip(t, 'on3')).toBe('v3')
    expect(trackOfClip(t, 'on2')).toBe('v2')
  })

  it('keeps a name, and a track without one takes the number of its new place', () => {
    const t = moveTrack(stacked(), 'v1', 2)
    expect(t.videoTracks.map((r) => trackLabel(t, r.id))).toEqual(['V1', 'Facecam', 'V3'])
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v2', 'v3', 'v1'])
  })

  it('stays among its own kind, and a place past either end is the end', () => {
    const t = addTrack(cut(), 'audio', 'a3')
    const [a1, a2] = t.audioTracks.map((r) => r.id)
    const moved = moveTrack(t, 'a3', -4)
    expect(moved.audioTracks.map((r) => r.id)).toEqual(['a3', a1, a2])
    expect(moved.videoTracks).toBe(t.videoTracks)
    expect(moveTrack(t, a1!, 99).audioTracks.map((r) => r.id)).toEqual([a2, 'a3', a1])
  })

  it('changes nothing when it lands where it was, or the track is not there', () => {
    const t = stacked()
    expect(moveTrack(t, 'v2', 1)).toBe(t)
    expect(moveTrack(t, 'gone', 0)).toBe(t)
  })

  it('moves a locked track, whose clips stay as they were', () => {
    const t = setTrackLocked(stacked(), 'v3', true)
    expect(applyClipEdit(t, { kind: 'moveTrack', trackId: 'v3', to: 0 }).videoTracks[0]!.id).toBe('v3')
  })
})

describe('the caption track among the video tracks (task 2621)', () => {
  /** V1, V2 and V3 with a clip on each of the upper two, and a caption. */
  function captioned(): Timeline {
    let t = addTrack(addTrack(cut(), 'video', 'v2'), 'video', 'v3')
    t = addSource(t, { mediaId: 'talk', clipId: 'on2', at: 0, onTrack: 'v2' })
    t = addSource(t, { mediaId: 'talk', clipId: 'on3', at: 0, onTrack: 'v3' })
    return setCaptions(t, [{ text: 'hello', start: 0, length: 10 }], [])
  }
  /** The video tracks from V1 up with the captions at their place among them. */
  const order = (t: Timeline): string[] => {
    const ids = t.videoTracks.map((r) => r.id)
    ids.splice(captionsAbove(t), 0, CAPTION_TRACK_ID)
    return ids
  }

  it('starts over every video track, with nothing saved for it', () => {
    const t = captioned()
    expect(order(t)).toEqual(['v1', 'v2', 'v3', CAPTION_TRACK_ID])
    expect('above' in t.captions).toBe(false)
  })

  it('moves down among the video tracks, which keep their order, and back to the top', () => {
    const start = captioned()
    const t = applyClipEdit(start, { kind: 'moveTrack', trackId: CAPTION_TRACK_ID, to: 1 })
    expect(order(t)).toEqual(['v1', CAPTION_TRACK_ID, 'v2', 'v3'])
    expect(t.captions.clips).toBe(start.captions.clips)
    const back = moveTrack(t, CAPTION_TRACK_ID, 99)
    expect(order(back)).toEqual(['v1', 'v2', 'v3', CAPTION_TRACK_ID])
    expect('above' in back.captions).toBe(false)
  })

  it('counts its place when a video track is dragged past it', () => {
    const t = moveTrack(captioned(), CAPTION_TRACK_ID, 1)
    // V3 dragged to the bottom: the captions are now over V3 and V1.
    expect(order(moveTrack(t, 'v3', 0))).toEqual(['v3', 'v1', CAPTION_TRACK_ID, 'v2'])
    // V1 dragged to the top, over the captions and both others.
    expect(order(moveTrack(t, 'v1', 3))).toEqual([CAPTION_TRACK_ID, 'v2', 'v3', 'v1'])
  })

  it('is over one fewer when an empty track under it is taken away', () => {
    let t = addTrack(captioned(), 'video', 'v4')
    t = moveTrack(t, 'v4', 1)
    t = moveTrack(t, CAPTION_TRACK_ID, 3)
    expect(order(t)).toEqual(['v1', 'v4', 'v2', CAPTION_TRACK_ID, 'v3'])
    expect(order(removeTrack(t, 'v4'))).toEqual(['v1', 'v2', CAPTION_TRACK_ID, 'v3'])
  })

  it('is saved with the project and read back', () => {
    const t = moveTrack(captioned(), CAPTION_TRACK_ID, 1)
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project.sequences[0]!.captions.above).toBe(1)
  })
})
