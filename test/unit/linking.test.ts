import { describe, it, expect } from 'vitest'
import {
  addClip,
  addTrack,
  addSource,
  createTimeline,
  findClip,
  linkClips,
  linkedIds,
  moveClip,
  unlinkClip,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * Plan 38: Unlink has a way back, and a selection drags as one. Entries 18
 * and 19 of the bug list.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** Two recordings on V1, each with its sound on A1, linked as they came in. */
function two(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a'), media('b')] }
  t = addClip(t, 'a', 'pa')
  t = addClip(t, 'b', 'pb')
  return t
}

const soundOf = (t: Timeline, picture: string): string => linkedIds(t, picture).find((id) => id !== picture)!

describe('linking clips', () => {
  it('puts a picture and its sound back together after Unlink', () => {
    const t = two()
    const sound = soundOf(t, 'pa')
    const apart = unlinkClip(t, 'pa')
    expect(linkedIds(apart, 'pa')).toEqual(['pa'])
    const back = linkClips(apart, ['pa', sound])
    expect(new Set(linkedIds(back, 'pa'))).toEqual(new Set(['pa', sound]))
  })

  it('joins whole groups: each clip named brings what it is linked to', () => {
    const t = two()
    const joined = linkClips(t, ['pa', 'pb'])
    expect(new Set(linkedIds(joined, 'pa'))).toEqual(new Set(['pa', soundOf(t, 'pa'), 'pb', soundOf(t, 'pb')]))
  })

  it('does nothing when what is named is one group already, or not there', () => {
    const t = two()
    expect(linkClips(t, ['pa', soundOf(t, 'pa')])).toBe(t)
    expect(linkClips(t, ['pa'])).toBe(t)
    expect(linkClips(t, ['pa', 'nothing'])).toBe(t)
  })
})

describe('moving a selection', () => {
  it('moves the rest of the selection by as much as the clip dragged', () => {
    let t = addTrack(two(), 'video', 'v2')
    t = addSource(t, { clipId: 'over', mediaId: 'b', at: 400, onTrack: 'v2', streams: [] })
    const before = findClip(t, 'over')!.clip.timelineStart
    const pa = findClip(t, 'pa')!.clip.timelineStart
    const moved = moveClip(t, 'pa', t.videoTracks[0]!.id, pa + 30, false, ['over'])
    expect(findClip(moved, 'over')!.clip.timelineStart).toBe(before + 30)
    // And the clip dragged took its own sound, as it always did.
    expect(findClip(moved, soundOf(t, 'pa'))!.clip.timelineStart).toBe(findClip(t, soundOf(t, 'pa'))!.clip.timelineStart + 30)
  })

  it('moves only the clip and its group when nothing else is with it, as before', () => {
    const t = two()
    const pb = findClip(t, 'pb')!.clip.timelineStart
    const moved = moveClip(t, 'pa', t.videoTracks[0]!.id, 1000)
    expect(v1Clips(moved).find((c) => c.id === 'pb')!.timelineStart).toBe(pb)
  })
})
