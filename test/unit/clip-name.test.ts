import { describe, it, expect } from 'vitest'
import { addClip, addSource, addTrack, allClips, createTimeline, groupOnV1, groupsOnV1, linkClips, splitClip, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { clipLabel, clipLabels, cutNumber, sourceName, whatTrackCarries } from '../../src/shared/clip-name'

/**
 * Plan 20, step 2: what a clip is called on the timeline. Three cuts of one
 * take look identical today, and the name alone does not say which is which.
 */

function media(id: string, name: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${name}`,
    playablePath: `C:\\v\\${name}`,
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

/** One take on V1 with its sound, and a song under it. */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 'studio.mkv', 10), media('song', 'bed.wav', 20, SOUND), media('cam', 'facecam.mp4', 10)]
  }
  t = addClip(t, 'talk', 'p1')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

/** The ids of the clips on V1, in the order they run. */
function v1(t: Timeline): string[] {
  return [...t.videoTracks[0]!.clips].sort((a, b) => a.timelineStart - b.timelineStart).map((c) => c.id)
}

describe('the name of a source', () => {
  it('is the file, not the folders it sits in', () => {
    expect(sourceName('C:\\v\\studio.mkv')).toBe('studio.mkv')
    expect(sourceName('/home/x/studio.mkv')).toBe('studio.mkv')
    expect(sourceName('studio.mkv')).toBe('studio.mkv')
  })
})

describe('which cut of its recording a clip is', () => {
  it('says nothing when the recording is on the track once', () => {
    const t = cut()
    expect(cutNumber(t, v1(t)[0]!)).toBe(null)
    expect(clipLabel(t, v1(t)[0]!)).toBe('studio.mkv')
  })

  it('numbers them along the track once there are two or more', () => {
    let t = cut()
    t = splitClip(t, 60)
    t = splitClip(t, 90)
    const ids = v1(t)
    expect(ids.length).toBe(3)
    expect(ids.map((id) => cutNumber(t, id))).toEqual([1, 2, 3])
    expect(clipLabel(t, ids[2]!)).toBe('studio.mkv \u00b7 cut 3')
  })

  it('numbers by where a clip runs, not by when it was made', () => {
    let t = cut()
    // Cut the back half off first, then the front: the new clip is in the middle.
    t = splitClip(t, 90)
    t = splitClip(t, 30)
    const ids = v1(t)
    expect(ids.map((id) => cutNumber(t, id))).toEqual([1, 2, 3])
  })

  it('counts each track on its own, so a cutaway of the same take is not muddled in', () => {
    let t = cut()
    t = splitClip(t, 60)
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'talk', clipId: 'over', at: 0, onTrack: 'v2' })
    // The one on V2 is the only clip of that source there.
    expect(cutNumber(t, 'over')).toBe(null)
    expect(clipLabel(t, 'over')).toBe('studio.mkv')
    // The two on V1 are still 1 and 2.
    expect(v1(t).map((id) => cutNumber(t, id))).toEqual([1, 2])
  })

  it('leaves a different recording out of the count', () => {
    let t = cut()
    t = splitClip(t, 60)
    // The song is on its own track and its own source: it is not a cut of the take.
    expect(cutNumber(t, 'music')).toBe(null)
    expect(clipLabel(t, 'music')).toBe('bed.wav')
  })

  it('says which stream a sound clip plays when its recording has several', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [media('obs', 'obs.mkv', 10, { audioTracks: 2 })]
    }
    t = addClip(t, 'obs', 'p1')
    const second = t.audioTracks.flatMap((r) => r.clips).find((c) => c.track === 1)!
    expect(clipLabel(t, second.id)).toContain('obs.mkv')
    expect(clipLabel(t, second.id)).not.toBe('obs.mkv')
  })

  it('says nothing at all for a clip that is not there', () => {
    const t = cut()
    expect(cutNumber(t, 'gone')).toBe(null)
    expect(clipLabel(t, 'gone')).toBe('')
  })
})

describe('what a track carries', () => {
  it('names the recording when every clip on it comes from one', () => {
    let t = cut()
    t = splitClip(t, 60)
    expect(whatTrackCarries(t, t.videoTracks[0]!.id)).toBe('studio.mkv')
  })

  it('says what kind of track it is when its clips disagree', () => {
    let t = cut()
    const v1Id = t.videoTracks[0]!.id
    t = addSource(t, { mediaId: 'cam', clipId: 'other', at: 600, onTrack: v1Id })
    expect(t.videoTracks[0]!.clips.length).toBe(2)
    expect(whatTrackCarries(t, v1Id)).toBe('picture')
  })

  it('says what kind of track it is while it is empty', () => {
    let t = cut()
    t = addTrack(t, 'audio', 'a9')
    expect(whatTrackCarries(t, 'a9')).toBe('sound')
    t = addTrack(t, 'video', 'v9')
    expect(whatTrackCarries(t, 'v9')).toBe('picture')
  })

  it('says something rather than throwing for a track that is not there', () => {
    expect(whatTrackCarries(cut(), 'gone')).toBe('sound')
  })
})

/**
 * Plan 49: the timeline works out every clip's name and whether it closes up
 * the sequence once per timeline rather than once per clip per render. The
 * one-pass answers must be the per-clip answers exactly, on a sequence with
 * the shapes that go wrong: cuts of one take, a cutaway of it on V2, a sound
 * of several streams, a linked pair and a clip linked from off V1.
 */
describe('every clip at once', () => {
  function busy(): Timeline {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [media('talk', 'studio.mkv', 10), media('song', 'bed.wav', 20, SOUND), media('obs', 'obs.mkv', 10, { audioTracks: 2 })]
    }
    t = addClip(t, 'talk', 'p1')
    t = splitClip(t, 90)
    t = splitClip(t, 30)
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'talk', clipId: 'over', at: 0, onTrack: 'v2' })
    t = addSource(t, { mediaId: 'talk', clipId: 'over2', at: 200, onTrack: 'v2' })
    t = addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
    t = addSource(t, { mediaId: 'obs', clipId: 'screen', at: 400 })
    // A clip on V2 linked to the song: neither is on V1.
    t = linkClips(t, ['over2', 'music'])
    return t
  }

  it('names each clip as clipLabel does', () => {
    const t = busy()
    const labels = clipLabels(t)
    const ids = allClips(t).map((c) => c.id)
    expect(ids.length).toBeGreaterThan(8)
    for (const id of ids) expect(labels.get(id)).toBe(clipLabel(t, id))
    // And it is not saying the same thing for all of them.
    expect(new Set(labels.values()).size).toBeGreaterThan(4)
  })

  it('knows which clips close up the sequence, as groupOnV1 does', () => {
    const t = busy()
    const on = groupsOnV1(t)
    for (const c of allClips(t)) expect(on.has(c.id)).toBe(groupOnV1(t, c.id))
    // The pair on V1 does, the linked cutaway and song do not.
    expect(on.has('over2')).toBe(false)
    expect(on.has('music')).toBe(false)
    expect([...on].some((id) => t.audioTracks.some((r) => r.clips.some((c) => c.id === id)))).toBe(true)
  })
})
