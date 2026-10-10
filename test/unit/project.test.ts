import { describe, it, expect } from 'vitest'
import {
  cleanProjectName,
  createProject,
  upsertMedia,
  MAX_PROJECT_NAME,
  addClip,
  addSource,
  addTransition,
  fillNewCuts,
  setTransition,
  setTransitionKind,
  removeTransition,
  shownSpansOf,
  transitionsOf,
  placeSource,
  removeClip,
  moveClip,
  plannedMove,
  splitClip,
  splitEverything,
  setClipIn,
  setClipOut,
  trimStart,
  trimEnd,
  trimToFrame,
  trimToFrameBlockers,
  closeUpClip,
  closeUpGap,
  gapCanClose,
  gapPartsGroup,
  unlinkClip,
  addTrack,
  removeTrack,
  duplicateSequence,
  editSequence,
  setCrop,
  setClipAudio,
  setSoundTrack,
  applySoundToSource,
  timelineDuration,
  v1Clips,
  v1End,
  allClips,
  findClip,
  findSoundClip,
  findVideoClip,
  linkedIds,
  pictureAt,
  mediaDurationFrames,
  clipLength,
  SCHEMA_VERSION,
  targetAspect,
  setShape,
  createTimeline,
  clipToCut,
  upsertTimelineMedia,
  timelineOf,
  FIRST_SEQUENCE_ID,
  type Clip,
  type Gap,
  type SoundClip,
  type Timeline,
  type ProjectMedia
} from '../../src/shared/project'
import { spanEnd, type Span, type TrackOf } from '../../src/shared/tracks'
import { trimToPlayhead } from '../../src/shared/playback'

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

/** A 30fps timeline with two sources: 10 seconds (300 frames) and 4 seconds (120). */
function base(): Timeline {
  const p = createTimeline(30, { width: 1080, height: 1920 })
  return { ...p, media: [media('a', 10), media('b', 4)] }
}

/** Both sources added to V1 with Add to timeline, each with its sound linked to it on A1. */
function withTwoClips(): Timeline {
  return addClip(addClip(base(), 'a'), 'b')
}

/**
 * A 30fps vertical timeline with nothing on it yet, and these sources:
 * - obs, a 10 second OBS recording (300 frames) with three streams, each copied;
 * - a, 10 seconds with one stream, and b, 4 seconds (120 frames) with one;
 * - song, a 20 second sound file (600 frames) with two streams, and beep, a 4 second one;
 * - quiet, a 4 second recording with no sound.
 */
function sources(): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  return {
    ...t,
    media: [
      media('obs', 10, {
        audioTracks: 3,
        trackFiles: [
          { path: 'C:\\c\\obs\\track-2.m4a', peaksPath: 'C:\\c\\obs\\track-2.bin' },
          { path: 'C:\\c\\obs\\track-3.m4a', peaksPath: 'C:\\c\\obs\\track-3.bin' }
        ]
      }),
      media('a', 10),
      media('b', 4),
      media('song', 20, { hasVideo: false, audioTracks: 2 }),
      media('beep', 4, { hasVideo: false }),
      media('quiet', 4, { hasAudio: false })
    ]
  }
}

/** The OBS recording dropped on V1 at 0 as c1: its picture, and its three streams on A1 to A3, linked. */
function group(): Timeline {
  return addSource(sources(), { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1' })
}

/**
 * Three clips on V1 with Add to timeline, each with its sound on A1: p1 (a, 0 to
 * 300), p2 (b, 300 to 420) and p3 (b, 420 to 540). Music under all of it on A2
 * (song, 0 to 600).
 */
function cut(): Timeline {
  let t = sources()
  t = addClip(t, 'a', 'p1')
  t = addClip(t, 'b', 'p2')
  t = addClip(t, 'b', 'p3')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

/** Every track by its label, V1 up and A1 down, and each clip on it as its id, start and end. */
function shape(t: Timeline): Record<string, [string, number, number][]> {
  const out: Record<string, [string, number, number][]> = {}
  const each = (c: Span): [string, number, number] => [c.id, c.timelineStart, spanEnd(c)]
  t.videoTracks.forEach((r, i) => (out[`V${i + 1}`] = r.clips.map(each)))
  t.audioTracks.forEach((r, i) => (out[`A${i + 1}`] = r.clips.map(each)))
  return out
}

/** Where a clip is: its track's label, its start, and its in and out in its recording. */
function placed(t: Timeline, clipId: string): [string, number, number, number] | null {
  const f = findClip(t, clipId)
  if (!f) return null
  return [`${f.kind === 'video' ? 'V' : 'A'}${f.index + 1}`, f.clip.timelineStart, f.clip.sourceIn, f.clip.sourceOut]
}

function soundOf(t: Timeline, clipId: string): SoundClip {
  const found = findSoundClip(t, clipId)
  if (!found) throw new Error(`no sound clip ${clipId}`)
  return found.clip
}

function videoOf(t: Timeline, clipId: string): Clip {
  const found = findVideoClip(t, clipId)
  if (!found) throw new Error(`no video clip ${clipId}`)
  return found.clip
}

/** Every invariant the timeline must never violate, whatever the edit. */
function assertInvariants(p: Timeline): void {
  const ids: string[] = []
  let last = 0
  for (const track of [...p.videoTracks, ...p.audioTracks] as TrackOf<Span>[]) {
    // In time order, never overlapping on one track, gaps allowed.
    let end = 0
    for (const c of track.clips) {
      expect(c.sourceIn).toBeGreaterThanOrEqual(0)
      expect(c.sourceOut).toBeGreaterThan(c.sourceIn)
      const m = p.media.find((x) => x.id === c.mediaId)
      expect(m).toBeDefined()
      expect(c.sourceOut).toBeLessThanOrEqual(mediaDurationFrames(m!, p.fps))
      expect(c.timelineStart).toBeGreaterThanOrEqual(end)
      end = spanEnd(c)
      last = Math.max(last, end)
      ids.push(c.id)
    }
  }
  expect(timelineDuration(p)).toBe(last)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('naming the project yourself', () => {
  it('tidies the spaces and holds the length', () => {
    expect(cleanProjectName('  Holiday   cut  ')).toBe('Holiday cut')
    expect(cleanProjectName('a'.repeat(MAX_PROJECT_NAME + 20))).toHaveLength(MAX_PROJECT_NAME)
  })

  it('gives back nothing for a name that is not one, so the project keeps what it had', () => {
    expect(cleanProjectName('')).toBeNull()
    expect(cleanProjectName('   ')).toBeNull()
    expect(cleanProjectName(undefined)).toBeNull()
    expect(cleanProjectName(7)).toBeNull()
  })

  it('leaves a colon alone, since the export sanitises what it writes', () => {
    expect(cleanProjectName('Episode 3: the long one')).toBe('Episode 3: the long one')
  })
})

describe('createProject', () => {
  it('starts with one empty sequence at the requested settings', () => {
    const p = createProject('test', 30, { width: 1080, height: 1920 })
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    expect(p.fps).toBe(30)
    expect(p.media).toEqual([])
    expect(p.sequences).toHaveLength(1)
    expect(p.sequences[0]).toMatchObject({
      id: FIRST_SEQUENCE_ID,
      name: 'Vertical',
      output: { width: 1080, height: 1920 },
      videoTracks: [{ id: 'v1', clips: [] }],
      audioTracks: [{ id: 'a1', clips: [] }]
    })
    expect(timelineDuration(timelineOf(p, FIRST_SEQUENCE_ID))).toBe(0)
  })
})

describe('where the sequence ends', () => {
  it('is where V1 ends when nothing on another track runs past it', () => {
    const t = withTwoClips()
    expect(timelineDuration(t)).toBe(420)
    const under = addSource({ ...t, media: [...t.media, media('song', 4, { hasVideo: false })] }, { clipId: 's1', mediaId: 'song', at: 0 })
    expect(timelineDuration(under)).toBe(420)
  })

  it('is the end of the last clip on any track, muted or not, however far past V1', () => {
    const t = withTwoClips()
    const song = addSource({ ...t, media: [...t.media, media('song', 20, { hasVideo: false })] }, { clipId: 's1', mediaId: 'song', at: 400 })
    expect(v1End(song)).toBe(420)
    expect(timelineDuration(song)).toBe(1000)
    expect(timelineDuration(setClipAudio(song, 's1', { gain: 1, muted: true }))).toBe(1000)
  })

  it('counts a picture on another video track too', () => {
    const t = addSource(addTrack(withTwoClips(), 'video', 'V2'), { clipId: 'p1', mediaId: 'b', at: 500, onTrack: 'V2', streams: [] })
    expect(timelineDuration(t)).toBe(620)
  })

  it('is the last clip on an audio track when V1 is empty', () => {
    const t = addSource({ ...base(), media: [media('song', 2, { hasVideo: false })] }, { clipId: 's1', mediaId: 'song', at: 30 })
    expect(v1End(t)).toBe(0)
    expect(timelineDuration(t)).toBe(90)
  })
})

describe('mediaDurationFrames', () => {
  it('converts the asset length into project frames', () => {
    expect(mediaDurationFrames(media('a', 10), 30)).toBe(300)
    expect(mediaDurationFrames(media('a', 10), 60)).toBe(600)
    expect(mediaDurationFrames(media('a', 4.5), 30)).toBe(135)
  })

  it('never reports a source as zero frames long', () => {
    expect(mediaDurationFrames(media('a', 0), 30)).toBe(1)
    expect(mediaDurationFrames(media('a', 0.001), 30)).toBe(1)
  })
})

describe('addClip', () => {
  it('adds the whole source at the end', () => {
    const p = addClip(base(), 'a')
    expect(v1Clips(p)).toHaveLength(1)
    expect(v1Clips(p)[0]?.sourceIn).toBe(0)
    expect(v1Clips(p)[0]?.sourceOut).toBe(300)
    expect(v1Clips(p)[0]?.timelineStart).toBe(0)
    assertInvariants(p)
  })

  it('butts the second clip against the first', () => {
    const p = withTwoClips()
    expect(v1Clips(p)[1]?.timelineStart).toBe(300)
    expect(timelineDuration(p)).toBe(420)
    assertInvariants(p)
  })

  it('gives every clip its own identity, even from the same source', () => {
    const p = addClip(addClip(base(), 'a'), 'a')
    expect(v1Clips(p)[0]?.id).not.toBe(v1Clips(p)[1]?.id)
    assertInvariants(p)
  })

  it('starts on the largest box of the project shape, centred', () => {
    // A 1920x1080 source on the default vertical project: a full height 9:16 slice.
    const p = addClip(base(), 'a')
    expect(v1Clips(p)[0]?.transform.crop).toEqual({ x: 656, y: 0, w: 608, h: 1080 })
  })

  it('refuses a source the project does not have, and changes nothing', () => {
    const t = base()
    expect(addClip(t, 'nope')).toBe(t)
    expect(placeSource(t, { mediaId: 'nope', clipId: 'x' })).toEqual({ timeline: t, refused: 'That source is not in the project.' })
  })

  it('does not mutate the project it was given', () => {
    const before = base()
    const snapshot = JSON.stringify(before)
    addClip(before, 'a')
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('removeClip', () => {
  it('leaves a gap on V1, and takes the sound linked to it too', () => {
    const p0 = withTwoClips()
    const p = removeClip(p0, v1Clips(p0)[0]!.id)
    expect(v1Clips(p)).toHaveLength(1)
    expect(v1Clips(p)[0]?.timelineStart).toBe(300)
    expect(p.audioTracks[0]!.clips.map((c) => c.timelineStart)).toEqual([300])
    assertInvariants(p)
  })

  it('closes the gap when it closes up, as Shift+Delete does', () => {
    const p0 = withTwoClips()
    const p = closeUpClip(p0, v1Clips(p0)[0]!.id)
    expect(v1Clips(p)).toHaveLength(1)
    expect(v1Clips(p)[0]?.timelineStart).toBe(0)
    expect(p.audioTracks[0]!.clips.map((c) => c.timelineStart)).toEqual([0])
    assertInvariants(p)
  })

  it('ignores a clip that is not there', () => {
    expect(v1Clips(removeClip(withTwoClips(), 'ghost'))).toHaveLength(2)
  })
})

describe('moveClip', () => {
  it('moves a clip in time on V1, covering what it lands on, and its sound with it', () => {
    const p0 = withTwoClips()
    const [a, b] = [v1Clips(p0)[0]!, v1Clips(p0)[1]!]
    const p = moveClip(p0, b.id, 'v1', 0)
    expect(v1Clips(p).map((c) => [c.id, c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [b.id, 0, 0, 120],
      [a.id, 120, 120, 300]
    ])
    expect(p.audioTracks[0]!.clips.map((c) => [c.mediaId, c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      ['b', 0, 0, 120],
      ['a', 120, 120, 300]
    ])
    assertInvariants(p)
  })

  it('never moves a clip before the timeline\'s start', () => {
    const p0 = withTwoClips()
    const b = v1Clips(p0)[1]!
    expect(moveClip(p0, b.id, 'v1', -50)).toEqual(moveClip(p0, b.id, 'v1', 0))
  })

  it('moving a clip to where it already is changes nothing', () => {
    const p0 = withTwoClips()
    expect(moveClip(p0, v1Clips(p0)[0]!.id, 'v1', 0)).toEqual(p0)
  })

  it('ignores a clip that is not there, and a track of the other kind', () => {
    const p0 = withTwoClips()
    expect(moveClip(p0, 'ghost', 'v1', 0)).toBe(p0)
    expect(moveClip(p0, v1Clips(p0)[0]!.id, 'a1', 0)).toBe(p0)
  })
})

describe('setClipIn and setClipOut', () => {
  it('trims the head, leaving a gap before it rather than pulling what comes after', () => {
    const p0 = withTwoClips()
    const p = setClipIn(p0, v1Clips(p0)[0]!.id, 60)
    expect(v1Clips(p)[0]?.sourceIn).toBe(60)
    expect(v1Clips(p)[0]?.timelineStart).toBe(60)
    expect(clipLength(v1Clips(p)[0]!)).toBe(240)
    expect(v1Clips(p)[1]?.timelineStart).toBe(300)
    // Its sound is trimmed with it.
    expect(p.audioTracks[0]!.clips[0]).toMatchObject({ sourceIn: 60, timelineStart: 60 })
    assertInvariants(p)
  })

  it('trims the tail', () => {
    const p0 = withTwoClips()
    const p = setClipOut(p0, v1Clips(p0)[0]!.id, 200)
    expect(clipLength(v1Clips(p)[0]!)).toBe(200)
    expect(v1Clips(p)[1]?.timelineStart).toBe(300)
    assertInvariants(p)
  })

  it('will not let the head pass the tail', () => {
    const p0 = withTwoClips()
    const p = setClipIn(p0, v1Clips(p0)[0]!.id, 9999)
    expect(v1Clips(p)[0]?.sourceIn).toBe(299)
    expect(v1Clips(p)[0]?.sourceOut).toBe(300)
    assertInvariants(p)
  })

  it('will not let the tail pass the head', () => {
    const p0 = withTwoClips()
    const p = setClipOut(p0, v1Clips(p0)[0]!.id, -50)
    expect(clipLength(v1Clips(p)[0]!)).toBe(1)
    assertInvariants(p)
  })

  it('clamps the tail to the end of the source', () => {
    const p0 = withTwoClips()
    const p = setClipOut(p0, v1Clips(p0)[0]!.id, 100000)
    expect(v1Clips(p)[0]?.sourceOut).toBe(300)
    assertInvariants(p)
  })

  it('clamps the head to the start of the source', () => {
    const p0 = withTwoClips()
    const trimmed = setClipIn(p0, v1Clips(p0)[0]!.id, 100)
    const p = setClipIn(trimmed, v1Clips(trimmed)[0]!.id, -100)
    expect(v1Clips(p)[0]?.sourceIn).toBe(0)
    assertInvariants(p)
  })

  it('ignores a clip that is not there', () => {
    expect(v1Clips(setClipIn(withTwoClips(), 'ghost', 10))[0]?.sourceIn).toBe(0)
  })
})

describe('trimStart and trimEnd', () => {
  it('move an edge by a delta', () => {
    const p0 = withTwoClips()
    expect(v1Clips(trimStart(p0, v1Clips(p0)[0]!.id, 30))[0]?.sourceIn).toBe(30)
    expect(v1Clips(trimEnd(p0, v1Clips(p0)[0]!.id, -30))[0]?.sourceOut).toBe(270)
  })

  it('stop at the edge rather than going past it', () => {
    const p0 = withTwoClips()
    expect(v1Clips(trimEnd(p0, v1Clips(p0)[0]!.id, 5000))[0]?.sourceOut).toBe(300)
    expect(v1Clips(trimStart(p0, v1Clips(p0)[0]!.id, -5000))[0]?.sourceIn).toBe(0)
  })
})

describe('splitClip', () => {
  it('cuts the clip under the playhead into two', () => {
    const p = splitClip(withTwoClips(), 100)
    expect(v1Clips(p)).toHaveLength(3)
    expect(v1Clips(p)[0]?.sourceOut).toBe(100)
    expect(v1Clips(p)[1]?.sourceIn).toBe(100)
    expect(v1Clips(p)[1]?.sourceOut).toBe(300)
    expect(v1Clips(p)[1]?.timelineStart).toBe(100)
    assertInvariants(p)
  })

  it('splits a later clip using its own source range, not the timeline position', () => {
    const p0 = withTwoClips()
    const trimmed = setClipIn(p0, v1Clips(p0)[1]!.id, 30)
    // The trim leaves b starting at 330 now, 20 frames into it is 350.
    const p = splitClip(trimmed, 330 + 20)
    expect(v1Clips(p)).toHaveLength(3)
    expect(v1Clips(p)[1]?.sourceIn).toBe(30)
    expect(v1Clips(p)[1]?.sourceOut).toBe(50)
    expect(v1Clips(p)[2]?.sourceIn).toBe(50)
    expect(v1Clips(p)[2]?.sourceOut).toBe(120)
    assertInvariants(p)
  })

  it('carries the crop, and the sound\'s volume and mute, onto both halves', () => {
    let p = withTwoClips()
    const id = v1Clips(p)[0]!.id
    p = setCrop(p, id, { x: 10, y: 20, w: 200, h: 400 })
    p = setClipAudio(p, p.audioTracks[0]!.clips[0]!.id, { gain: 0.5, muted: true })
    p = splitClip(p, 100)
    expect(v1Clips(p)[0]?.transform.crop).toEqual({ x: 10, y: 20, w: 200, h: 400 })
    expect(v1Clips(p)[1]?.transform.crop).toEqual({ x: 10, y: 20, w: 200, h: 400 })
    expect(p.audioTracks[0]!.clips[1]).toMatchObject({ gain: 0.5, muted: true, track: 0, sourceIn: 100 })
    assertInvariants(p)
  })

  it('does nothing on a clip boundary, because that would make a zero length clip', () => {
    const p0 = withTwoClips()
    expect(v1Clips(splitClip(p0, 0))).toHaveLength(2)
    expect(v1Clips(splitClip(p0, 300))).toHaveLength(2)
  })

  it('does nothing past the end of the timeline', () => {
    expect(v1Clips(splitClip(withTwoClips(), 5000))).toHaveLength(2)
    expect(v1Clips(splitClip(withTwoClips(), -5))).toHaveLength(2)
  })

  it('gives the new half its own identity', () => {
    const p = splitClip(withTwoClips(), 100)
    expect(v1Clips(p)[0]?.id).not.toBe(v1Clips(p)[1]?.id)
  })
})

describe('pictureAt', () => {
  it('finds the clip under a position', () => {
    const p = withTwoClips()
    expect(pictureAt(p, 0)?.mediaId).toBe('a')
    expect(pictureAt(p, 299)?.mediaId).toBe('a')
    expect(pictureAt(p, 300)?.mediaId).toBe('b')
    expect(pictureAt(p, 419)?.mediaId).toBe('b')
  })

  it('finds nothing outside the timeline', () => {
    expect(pictureAt(withTwoClips(), 420)).toBeUndefined()
    expect(pictureAt(withTwoClips(), -1)).toBeUndefined()
  })

  it('finds V1\'s picture where it has one, and the lowest other track\'s where it has none', () => {
    const t = addSource(addTrack(withTwoClips(), 'video', 'V2'), { mediaId: 'a', clipId: 'up', at: 400, onTrack: 'V2', streams: [] })
    expect(pictureAt(t, 410)?.id).toBe(v1Clips(t)[1]!.id)
    expect(pictureAt(t, 450)?.id).toBe('up')
  })
})

describe('setCrop', () => {
  it('snaps to even pixels, because H.264 needs them', () => {
    const p0 = withTwoClips()
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 3, y: 5, w: 101, h: 203 })
    expect(v1Clips(p)[0]?.transform.crop).toEqual({ x: 4, y: 6, w: 102, h: 204 })
  })

  it('keeps the rectangle inside the source frame', () => {
    const p0 = withTwoClips()
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 1900, y: 1000, w: 800, h: 800 })
    const crop = v1Clips(p)[0]!.transform.crop
    expect(crop.x + crop.w).toBeLessThanOrEqual(1920)
    expect(crop.y + crop.h).toBeLessThanOrEqual(1080)
  })

  it('refuses to produce a crop with no area', () => {
    const p0 = withTwoClips()
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 0, y: 0, w: 0, h: 0 })
    expect(v1Clips(p)[0]!.transform.crop.w).toBeGreaterThan(0)
    expect(v1Clips(p)[0]!.transform.crop.h).toBeGreaterThan(0)
  })

  it('refuses a crop larger than the source', () => {
    const p0 = withTwoClips()
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 0, y: 0, w: 99999, h: 99999 })
    expect(v1Clips(p)[0]!.transform.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })
})

describe('which of its recording\'s streams a sound clip plays', () => {
  /** The OBS recording added to V1 as c1 and cut in two at 150, then b added as d1. */
  function obsCut(): Timeline {
    return addClip(splitClip(addClip(sources(), 'obs', 'c1'), 150), 'b', 'd1')
  }

  it('keeps its stream when its volume changes, and its volume when its stream changes', () => {
    const t = obsCut()
    const louder = setClipAudio(t, 'c1.2', { gain: 2, muted: false })
    expect(soundOf(louder, 'c1.2')).toMatchObject({ track: 1, gain: 2, muted: false })
    const other = setSoundTrack(louder, 'c1.2', 2)
    expect(soundOf(other, 'c1.2')).toMatchObject({ track: 2, gain: 2, muted: false })
  })

  it('carries its stream and volume onto both halves of a split', () => {
    let t = addClip(sources(), 'obs', 'c1')
    t = setClipAudio(t, 'c1.3', { gain: 1.5, muted: false })
    t = splitClip(t, 60)
    expect(t.audioTracks[2]!.clips.map((c) => [c.track, c.gain, c.muted])).toEqual([
      [2, 1.5, false],
      [2, 1.5, false]
    ])
  })

  it('plays the first stream rather than nothing when its source comes back with fewer', () => {
    const t = obsCut()
    const streams = (x: Timeline): number[][] =>
      x.audioTracks.map((r) => r.clips.filter((c) => c.mediaId === 'obs').map((c) => c.track))
    expect(streams(t)).toEqual([[0, 0], [1, 1], [2, 2]])
    // The same recording again changes nothing.
    expect(streams(upsertTimelineMedia(t, sources().media[0]!))).toEqual([[0, 0], [1, 1], [2, 2]])
    const oneTrack = upsertTimelineMedia(t, media('obs', 10, { audioTracks: 1 }))
    expect(streams(oneTrack)).toEqual([[0, 0], [0, 0], [0, 0]])
  })

  it('leaves the first stream of a recording that comes back with no sound as it is, and still pulls its clips inside it', () => {
    const t = obsCut()
    const silent = media('obs', 10, { hasAudio: false, audioTracks: 0 })
    const once = upsertTimelineMedia(t, silent)
    expect(soundOf(once, 'c1.1').track).toBe(0)
    // And a shorter one still pulls its clips inside it.
    const shorter = upsertTimelineMedia(t, { ...silent, durationSec: 2 })
    expect(v1Clips(shorter)[0]!.sourceOut).toBe(60)
    expect(soundOf(shorter, 'c1.1').sourceOut).toBe(60)
  })

  it('gives every other sound clip of the same recording and stream the same Heard and volume', () => {
    let t = obsCut()
    t = setClipAudio(t, 'c1.1', { gain: 1, muted: true })
    t = setClipAudio(t, 'c1.3', { gain: 2, muted: false })
    const settings = (x: Timeline): [number, number, boolean][][] =>
      x.audioTracks.map((r) => r.clips.filter((c) => c.mediaId === 'obs').map((c): [number, number, boolean] => [c.track, c.gain, c.muted]))
    // The second piece's sound as it came in: the first stream heard, the others muted.
    expect(settings(t)).toEqual([
      [[0, 1, true], [0, 1, false]],
      [[1, 1, true], [1, 1, true]],
      [[2, 2, false], [2, 1, true]]
    ])
    // From the picture, whose linked sound clips are the model.
    const all = applySoundToSource(t, 'c1')
    expect(settings(all)).toEqual([
      [[0, 1, true], [0, 1, true]],
      [[1, 1, true], [1, 1, true]],
      [[2, 2, false], [2, 2, false]]
    ])
    // The sound of another recording is untouched.
    expect(soundOf(all, 'd1.1')).toMatchObject({ gain: 1, muted: false })
  })
})

describe('setClipAudio', () => {
  it('sets gain and mute', () => {
    const p0 = withTwoClips()
    const s = p0.audioTracks[0]!.clips[0]!
    const p = setClipAudio(p0, s.id, { gain: 0.25, muted: true })
    expect(soundOf(p, s.id)).toMatchObject({ gain: 0.25, muted: true, track: 0 })
  })

  it('clamps an absurd gain', () => {
    const p0 = withTwoClips()
    const s = p0.audioTracks[0]!.clips[0]!
    expect(soundOf(setClipAudio(p0, s.id, { gain: -5, muted: false }), s.id).gain).toBe(0)
    expect(soundOf(setClipAudio(p0, s.id, { gain: 100, muted: false }), s.id).gain).toBe(4)
  })

  it('changes nothing on a video clip, which has no sound of its own', () => {
    const p0 = withTwoClips()
    expect(setClipAudio(p0, v1Clips(p0)[0]!.id, { gain: 0.25, muted: true })).toBe(p0)
  })
})

describe('upsertMedia', () => {
  it('adds a source that is not there yet', () => {
    const p = upsertTimelineMedia(base(), media('c', 7))
    expect(p.media).toHaveLength(3)
  })

  it('keeps when a source came in when it is described again without a date', () => {
    const dated = upsertMedia({ ...createProject('t', 30, { width: 1080, height: 1920 }), media: [] }, { ...media('a', 20), addedAt: 1_000 })
    const again = upsertMedia(dated, media('a', 20))
    expect(again.media[0]!.addedAt).toBe(1_000)
  })

  it('replaces a source in place', () => {
    const p = upsertTimelineMedia(base(), { ...media('a', 20), codec: 'hevc' })
    expect(p.media).toHaveLength(2)
    expect(p.media.find((m) => m.id === 'a')?.codec).toBe('hevc')
  })

  it('pulls clips back inside a source that got shorter', () => {
    // This is the relink and re-conform case. A replaced file can be shorter
    // than the one the clips were cut against, and a clip pointing past the end
    // of its media would break every later assumption in the app.
    const p0 = withTwoClips()
    const trimmed = setClipIn(p0, v1Clips(p0)[0]!.id, 200)
    expect(v1Clips(trimmed)[0]?.sourceIn).toBe(200)
    expect(v1Clips(trimmed)[0]?.sourceOut).toBe(300)

    const p = upsertTimelineMedia(trimmed, media('a', 3)) // 3 seconds, 90 frames
    expect(v1Clips(p)[0]!.sourceOut).toBeLessThanOrEqual(90)
    expect(v1Clips(p)[0]!.sourceIn).toBeLessThan(v1Clips(p)[0]!.sourceOut)
    assertInvariants(p)
  })

  it('leaves clips alone when the replacement is the same length', () => {
    const p0 = withTwoClips()
    const p = upsertTimelineMedia(p0, media('a', 10))
    expect(v1Clips(p)[0]?.sourceIn).toBe(v1Clips(p0)[0]?.sourceIn)
    expect(v1Clips(p)[0]?.sourceOut).toBe(v1Clips(p0)[0]?.sourceOut)
    assertInvariants(p)
  })
})

describe('the output shape', () => {
  it('defaults to vertical', () => {
    const p = timelineOf(createProject('t', 30, { width: 1080, height: 1920 }), FIRST_SEQUENCE_ID)
    expect(p.presetId).toBe('vertical')
    expect(targetAspect(p)).toBeCloseTo(1080 / 1920)
  })

  it('has no fixed shape for the handoff preset, which keeps each crop as drawn', () => {
    const p = setShape(base(), 'handoff')
    expect(targetAspect(p)).toBeNull()
  })

  it('starts a new clip on the largest box of the project shape, not the whole frame', () => {
    // A landscape source on a vertical project. Starting on the whole frame
    // exported as a small letterboxed strip until you remembered to reframe it.
    const p = addClip(base(), 'a')
    const crop = v1Clips(p)[0]!.transform.crop
    expect(crop.h).toBe(1080)
    expect(crop.w).toBe(608)
    expect(crop.x).toBe(656)
  })

  it('starts a new clip on the whole frame when there is no fixed shape', () => {
    const p = addClip(setShape(base(), 'handoff'), 'a')
    expect(v1Clips(p)[0]!.transform.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('reshapes every clip when the shape changes', () => {
    const p = setShape(withTwoClips(), 'square')
    expect(p.presetId).toBe('square')
    expect(p.output).toEqual({ width: 1080, height: 1080 })
    for (const c of v1Clips(p)) {
      expect(c.transform.crop.w / c.transform.crop.h).toBeCloseTo(1, 1)
    }
    assertInvariants(p)
  })

  it('keeps each clip framed on the same point when reshaping', () => {
    let p = withTwoClips()
    const id = v1Clips(p)[0]!.id
    // Far enough from the edge that the square fits around the same centre.
    p = setCrop(p, id, { x: 600, y: 0, w: 608, h: 1080 })
    const before = v1Clips(p)[0]!.transform.crop
    const after = v1Clips(setShape(p, 'square'))[0]!.transform.crop
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2, -1)
  })

  it('leaves crops alone when switching to the handoff preset', () => {
    let p = withTwoClips()
    p = setCrop(p, v1Clips(p)[0]!.id, { x: 100, y: 100, w: 300, h: 200 })
    const before = v1Clips(p)[0]!.transform.crop
    expect(v1Clips(setShape(p, 'handoff'))[0]!.transform.crop).toEqual(before)
  })

  it('does not touch trims when reshaping', () => {
    let p = withTwoClips()
    p = setClipIn(p, v1Clips(p)[0]!.id, 40)
    const after = setShape(p, 'landscape')
    expect(v1Clips(after)[0]?.sourceIn).toBe(40)
    expect(timelineDuration(after)).toBe(timelineDuration(p))
  })

  it('refuses a shape that does not exist', () => {
    expect(() => setShape(base(), 'nope')).toThrow(/unknown preset/i)
  })
})

describe('a source put on the timeline', () => {
  it('brings in only the streams passed, the first heard and the rest muted, all linked', () => {
    // The window found stream 1 silent, so only streams 2 and 3 come in.
    const t = addSource(sources(), { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1', streams: [2, 1] })
    expect(shape(t)).toEqual({ V1: [['c1', 0, 300]], A1: [['c1.2', 0, 300]], A2: [['c1.3', 0, 300]] })
    expect(soundOf(t, 'c1.2')).toMatchObject({ mediaId: 'obs', track: 1, sourceIn: 0, sourceOut: 300, gain: 1, muted: false })
    expect(soundOf(t, 'c1.3')).toMatchObject({ mediaId: 'obs', track: 2, sourceIn: 0, sourceOut: 300, gain: 1, muted: true })
    expect(allClips(t).map((c) => c.link)).toEqual(['c1', 'c1', 'c1'])
    expect(linkedIds(t, 'c1.3')).toEqual(['c1', 'c1.2', 'c1.3'])
    assertInvariants(t)
  })

  it('brings in every stream when none are named, on tracks named from the clip', () => {
    const t = group()
    expect(shape(t)).toEqual({ V1: [['c1', 0, 300]], A1: [['c1.1', 0, 300]], A2: [['c1.2', 0, 300]], A3: [['c1.3', 0, 300]] })
    expect(allClips(t).filter((c): c is SoundClip => 'track' in c).map((c) => [c.track, c.muted])).toEqual([
      [0, false],
      [1, true],
      [2, true]
    ])
    expect(t.audioTracks.map((r) => r.id)).toEqual(['a1', 'c1.a2', 'c1.a3'])
  })

  it('brings in one sound for a recording whose stream count is unknown', () => {
    const t = addClip(sources(), 'a', 'k')
    expect(shape(t)).toEqual({ V1: [['k', 0, 300]], A1: [['k.1', 0, 300]] })
    expect(soundOf(t, 'k.1')).toMatchObject({ track: 0, muted: false, link: 'k' })
    expect(videoOf(t, 'k').link).toBe('k')
  })

  it('puts each sound on the first audio track from A1 down with room for all of it, not one another sound of the drop took', () => {
    let t = addTrack(addTrack(sources(), 'audio', 'A2'), 'audio', 'A3')
    t = addSource(t, { mediaId: 'song', clipId: 's1', at: 0, onTrack: 'a1' })
    t = addSource(t, { mediaId: 'song', clipId: 's2', at: 1000, onTrack: 'A3' })
    t = addSource(t, { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1' })
    expect(shape(t)).toEqual({
      V1: [['c1', 0, 300]],
      A1: [['s1', 0, 600]],
      A2: [['c1.1', 0, 300]],
      A3: [['c1.2', 0, 300], ['s2', 1000, 1600]],
      A4: [['c1.3', 0, 300]]
    })
    assertInvariants(t)
  })

  it('makes the next tracks when every one there is in use at that time', () => {
    // A1 to A3 hold the first recording; the second one's two streams make A4 and A5.
    let t = addTrack(group(), 'video', 'V2')
    t = addSource(t, { mediaId: 'obs', clipId: 'c2', at: 100, onTrack: 'V2', streams: [0, 1] })
    expect(placed(t, 'c2')).toEqual(['V2', 100, 0, 300])
    expect(t.audioTracks.map((r) => r.clips.map((c) => c.id))).toEqual([['c1.1'], ['c1.2'], ['c1.3'], ['c2.1'], ['c2.2']])
    assertInvariants(t)
  })

  it('dropped on a video track, puts the picture there, covering what is there, and the sound where there is room', () => {
    let t = addSource(sources(), { mediaId: 'a', clipId: 'x', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'y', at: 100, onTrack: 'v1' })
    // The sound under it is cut where the picture was, so each side keeps its own link (audit 2026-10-01).
    expect(shape(t)).toEqual({
      V1: [['x', 0, 100], ['y', 100, 220], [expect.any(String), 220, 300]],
      A1: [['x.1', 0, 100], [expect.any(String), 100, 220], [expect.any(String), 220, 300]],
      A2: [['y.1', 100, 220]]
    })
    expect(t.videoTracks[0]!.clips[2]).toMatchObject({ mediaId: 'a', sourceIn: 220, sourceOut: 300 })
    const [head, , tail] = t.videoTracks[0]!.clips
    const [headSound, underneath, tailSound] = t.audioTracks[0]!.clips
    expect(linkedIds(t, head!.id).sort()).toEqual([head!.id, headSound!.id].sort())
    expect(linkedIds(t, tail!.id).sort()).toEqual([tail!.id, tailSound!.id].sort())
    // The sound under the new picture plays on, on its own.
    expect(underneath!.link).toBeUndefined()
    assertInvariants(t)
  })

  it('dropped on an audio track, puts its first sound there, covering what is there, and the picture on a new video track on top when none has room', () => {
    let t = addSource(sources(), { mediaId: 'a', clipId: 'x', at: 0, onTrack: 'v1' })
    t = addTrack(t, 'audio', 'A2')
    t = addSource(t, { mediaId: 'obs', clipId: 'c1', at: 100, onTrack: 'a1' })
    expect(shape(t)).toEqual({
      V1: [['x', 0, 300]],
      V2: [['c1', 100, 400]],
      A1: [['x.1', 0, 100], ['c1.1', 100, 400]],
      A2: [['c1.2', 100, 400]],
      A3: [['c1.3', 100, 400]]
    })
    expect(t.videoTracks[1]!.id).toBe('c1.v2')
    assertInvariants(t)
  })

  it('dropped on an audio track, puts the picture on the first video track from V1 up with room for it', () => {
    let t = addSource(sources(), { mediaId: 'a', clipId: 'x', at: 0, onTrack: 'v1' })
    t = addTrack(t, 'video', 'V2')
    t = addSource(t, { mediaId: 'b', clipId: 'y', at: 300, onTrack: 'a1' })
    expect(shape(t)).toEqual({ V1: [['x', 0, 300], ['y', 300, 420]], V2: [], A1: [['x.1', 0, 300], ['y.1', 300, 420]] })
    t = addSource(t, { mediaId: 'b', clipId: 'z', at: 200, onTrack: 'a1' })
    expect(placed(t, 'z')).toEqual(['V2', 200, 0, 120])
  })

  it('with Add to timeline, puts the picture on V1 straight after its last clip and the sound on the first free audio tracks', () => {
    let t = addSource(sources(), { mediaId: 'a', clipId: 'x', at: 0, onTrack: 'v1' })
    // A gap on V1 from 300 to 500, and a picture on V2 running past V1's end.
    t = addSource(t, { mediaId: 'b', clipId: 'y', at: 500, onTrack: 'v1' })
    t = addSource(addTrack(t, 'video', 'V2'), { mediaId: 'b', clipId: 'z', at: 900, onTrack: 'V2', streams: [] })
    t = addClip(t, 'obs', 'c1')
    expect(placed(t, 'c1')).toEqual(['V1', 620, 0, 300])
    expect(placed(t, 'c1.1')).toEqual(['A1', 620, 0, 300])
    expect(placed(t, 'c1.2')).toEqual(['A2', 620, 0, 300])
    expect(placed(t, 'c1.3')).toEqual(['A3', 620, 0, 300])
    assertInvariants(t)
  })

  it('puts a sound file in as one clip of its first stream, on the audio track it is dropped on, or the first free one', () => {
    const t = addTrack(sources(), 'audio', 'A2')
    const onV1 = addSource(t, { mediaId: 'song', clipId: 's1', at: 30, onTrack: 'v1' })
    expect(shape(onV1)).toEqual({ V1: [], A1: [['s1', 30, 630]], A2: [] })
    expect(soundOf(onV1, 's1')).toMatchObject({ track: 0, sourceIn: 0, sourceOut: 600, gain: 1, muted: false })
    expect(soundOf(onV1, 's1').link).toBeUndefined()
    const onA2 = addSource(t, { mediaId: 'song', clipId: 's1', at: 30, onTrack: 'A2', streams: [0, 1] })
    expect(shape(onA2)).toEqual({ V1: [], A1: [], A2: [['s1', 30, 630]] })
    expect(soundOf(onA2, 's1').track).toBe(0)
    // Add to timeline puts it at the end of V1, on the first free audio track.
    const added = addClip(addClip(sources(), 'b', 'y'), 'song', 's2')
    expect(shape(added)).toEqual({ V1: [['y', 0, 120]], A1: [['y.1', 0, 120], ['s2', 120, 720]] })
  })

  it('puts a recording with no sound in as its picture alone, linked to nothing', () => {
    const t = addClip(sources(), 'quiet', 'q')
    expect(shape(t)).toEqual({ V1: [['q', 0, 120]], A1: [] })
    expect(videoOf(t, 'q').link).toBeUndefined()
    // As it does one whose streams were all found silent.
    const silent = addSource(sources(), { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1', streams: [] })
    expect(shape(silent)).toEqual({ V1: [['c1', 0, 300]], A1: [] })
    expect(videoOf(silent, 'c1').link).toBeUndefined()
  })

  it('refuses a drop that would need more than 16 audio tracks, with its reason, and changes nothing', () => {
    let t = sources()
    for (let i = 2; i <= 14; i++) t = addTrack(t, 'audio', `A${i}`)
    for (const [i, id] of t.audioTracks.map((r) => r.id).entries()) {
      t = addSource(t, { mediaId: 'song', clipId: `s${i}`, at: 0, onTrack: id })
    }
    // Fourteen tracks full at 0: three streams need three more, and a sequence has room for two.
    const refused = placeSource(t, { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1' })
    expect(refused.refused).toBe('No room for all of its sound: a sequence has at most 16 audio tracks.')
    expect(refused.timeline).toBe(t)
    expect(addSource(t, { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1' })).toBe(t)
    // Two streams fit, and so do all three where the tracks have room.
    const two = placeSource(t, { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'v1', streams: [0, 1] })
    expect(two.refused).toBeNull()
    expect(two.timeline.audioTracks).toHaveLength(16)
    expect(placeSource(t, { mediaId: 'obs', clipId: 'c1', at: 600, onTrack: 'v1' }).refused).toBeNull()
  })

  it('refuses a drop that would need more than 8 video tracks, with its reason, and changes nothing', () => {
    let t = sources()
    for (let i = 2; i <= 8; i++) t = addTrack(t, 'video', `V${i}`)
    for (const id of t.videoTracks.map((r) => r.id)) {
      t = addSource(t, { mediaId: 'b', clipId: `p-${id}`, at: 0, onTrack: id, streams: [] })
    }
    const refused = placeSource(t, { mediaId: 'obs', clipId: 'c1', at: 0, onTrack: 'a1' })
    expect(refused.refused).toBe('No room for its picture: a sequence has at most 8 video tracks.')
    expect(refused.timeline).toBe(t)
    expect(placeSource(t, { mediaId: 'obs', clipId: 'c1', at: 120, onTrack: 'a1' }).refused).toBeNull()
  })

  it('refuses a clip id already taken', () => {
    const t = addClip(sources(), 'b', 'y')
    expect(placeSource(t, { mediaId: 'obs', clipId: 'y', at: 500 })).toEqual({ timeline: t, refused: 'That clip is already on the timeline.' })
    expect(placeSource(t, { mediaId: 'obs', clipId: 'y.1', at: 500 }).refused).toBe('That clip is already on the timeline.')
    expect(addSource(t, { mediaId: 'obs', clipId: 'y', at: 500 })).toBe(t)
  })
})

describe('linked clips', () => {
  it('move together by the same time, the others of its kind by as many tracks, the other kind staying on its tracks', () => {
    const up = moveClip(addTrack(group(), 'video', 'V2'), 'c1', 'V2', 100)
    expect(shape(up)).toEqual({
      V1: [],
      V2: [['c1', 100, 400]],
      A1: [['c1.1', 100, 400]],
      A2: [['c1.2', 100, 400]],
      A3: [['c1.3', 100, 400]]
    })
    // A sound dragged down a track takes the other sounds down one too, adding a track past the last.
    const g = group()
    const down = moveClip(g, 'c1.2', g.audioTracks[2]!.id, 50)
    expect(shape(down)).toEqual({
      V1: [['c1', 50, 350]],
      A1: [],
      A2: [['c1.1', 50, 350]],
      A3: [['c1.2', 50, 350]],
      A4: [['c1.3', 50, 350]]
    })
    assertInvariants(down)
  })

  it('go no higher than the first track, and no earlier than the timeline\'s start', () => {
    const g = group()
    expect(shape(moveClip(g, 'c1.3', 'a1', 50))).toEqual({
      V1: [['c1', 50, 350]],
      A1: [['c1.1', 50, 350]],
      A2: [['c1.2', 50, 350]],
      A3: [['c1.3', 50, 350]]
    })
    expect(plannedMove(g, 'c1', 'v1', -40).map((l) => l.start)).toEqual([0, 0, 0, 0])
  })

  it('each cover what they land on', () => {
    let t = addSource(group(), { mediaId: 'a', clipId: 'x', at: 400, onTrack: 'v1' })
    t = moveClip(t, 'c1', 'v1', 300)
    expect(shape(t)).toEqual({
      V1: [['c1', 300, 600], ['x', 600, 700]],
      A1: [['c1.1', 300, 600], ['x.1', 600, 700]],
      A2: [['c1.2', 300, 600]],
      A3: [['c1.3', 300, 600]]
    })
    expect(videoOf(t, 'x')).toMatchObject({ sourceIn: 200, sourceOut: 300 })
    expect(soundOf(t, 'x.1')).toMatchObject({ sourceIn: 200, sourceOut: 300 })
    assertInvariants(t)
  })

  it('move one on its own when it is moved alone, and it stays linked, moving with them from where it is', () => {
    const g = group()
    const t = moveClip(g, 'c1.2', g.audioTracks[1]!.id, 90, true)
    expect(shape(t)).toEqual({ V1: [['c1', 0, 300]], A1: [['c1.1', 0, 300]], A2: [['c1.2', 90, 390]], A3: [['c1.3', 0, 300]] })
    expect(soundOf(t, 'c1.2').link).toBe('c1')
    expect(placed(moveClip(t, 'c1', 'v1', 10), 'c1.2')).toEqual(['A2', 100, 0, 300])
  })

  it('trim the same edge of each by the same amount, from where each is', () => {
    const g = group()
    const apart = moveClip(g, 'c1.3', g.audioTracks[2]!.id, 100, true)
    const head = setClipIn(apart, 'c1', 30)
    expect(placed(head, 'c1')).toEqual(['V1', 30, 30, 300])
    expect(placed(head, 'c1.1')).toEqual(['A1', 30, 30, 300])
    expect(placed(head, 'c1.2')).toEqual(['A2', 30, 30, 300])
    expect(placed(head, 'c1.3')).toEqual(['A3', 130, 30, 300])
    const tail = setClipOut(head, 'c1.2', 250)
    expect(['c1', 'c1.1', 'c1.2', 'c1.3'].map((id) => findClip(tail, id)!.clip.sourceOut)).toEqual([250, 250, 250, 250])
    // One trimmed on its own trims on its own.
    const alone = setClipIn(apart, 'c1', 30, true)
    expect(['c1', 'c1.1', 'c1.2', 'c1.3'].map((id) => findClip(alone, id)!.clip.sourceIn)).toEqual([30, 0, 0, 0])
  })

  it('stop a head trim together at the first limit any of them meets, and give back exactly what it took when dragged back', () => {
    let t0 = addSource(sources(), { mediaId: 'obs', clipId: 'c1', at: 100, onTrack: 'v1' })
    t0 = setClipIn(t0, 'c1', 60)
    // A beep on A2 up to frame 120; c1.2 starts at 160 there.
    t0 = addSource(t0, { mediaId: 'beep', clipId: 'bp', at: 0, onTrack: t0.audioTracks[1]!.id })
    const out = setClipIn(t0, 'c1', 0)
    // c1.2's head meets the beep 40 frames back, so every head stops there.
    expect(['c1', 'c1.1', 'c1.2', 'c1.3'].map((id) => placed(out, id)!.slice(1))).toEqual([
      [120, 20, 300],
      [120, 20, 300],
      [120, 20, 300],
      [120, 20, 300]
    ])
    expect(setClipIn(out, 'c1', 60)).toEqual(t0)
  })

  it('stop a tail trim together at the first limit any of them meets, and give back exactly what it took when dragged back', () => {
    let t0 = setClipOut(group(), 'c1', 200)
    // A beep on A1 from frame 250; c1.1 ends at 200 there.
    t0 = addSource(t0, { mediaId: 'beep', clipId: 'bp', at: 250, onTrack: 'a1' })
    const out = setClipOut(t0, 'c1.3', 300)
    expect(['c1', 'c1.1', 'c1.2', 'c1.3'].map((id) => findClip(out, id)!.clip.sourceOut)).toEqual([250, 250, 250, 250])
    expect(setClipOut(out, 'c1.3', 200)).toEqual(t0)
  })

  it('are each cut by a split under the frame, the first pieces keeping their link and the second pieces sharing a new one', () => {
    const g = group()
    // c1.3 moved on its own to start at 200, so it is not under frame 150, but it plays with the second pieces.
    const t = splitClip(moveClip(g, 'c1.3', g.audioTracks[2]!.id, 200, true), 150)
    expect(shape(t)).toEqual({
      V1: [['c1', 0, 150], [expect.any(String), 150, 300]],
      A1: [['c1.1', 0, 150], [expect.any(String), 150, 300]],
      A2: [['c1.2', 0, 150], [expect.any(String), 150, 300]],
      A3: [['c1.3', 200, 500]]
    })
    expect(['c1', 'c1.1', 'c1.2'].map((id) => findClip(t, id)!.clip.link)).toEqual(['c1', 'c1', 'c1'])
    const seconds = [t.videoTracks[0]!.clips[1]!, t.audioTracks[0]!.clips[1]!, t.audioTracks[1]!.clips[1]!, t.audioTracks[2]!.clips[0]!]
    const link = seconds[0]!.link
    expect(link).toBeDefined()
    expect(link).not.toBe('c1')
    expect(seconds.map((c) => c.link)).toEqual([link, link, link, link])
    expect(seconds.slice(0, 3).map((c) => [c.sourceIn, c.sourceOut])).toEqual([[150, 300], [150, 300], [150, 300]])
    expect(linkedIds(t, seconds[1]!.id)).toHaveLength(4)
    assertInvariants(t)
  })

  it('are all cut when S names any of them, and only the one named when it is cut alone', () => {
    const fromSound = splitClip(group(), 150, 'c1.2')
    expect(allClips(fromSound)).toHaveLength(8)
    const alone = splitClip(group(), 150, 'c1.2', true)
    expect(shape(alone)).toEqual({
      V1: [['c1', 0, 300]],
      A1: [['c1.1', 0, 300]],
      A2: [['c1.2', 0, 150], [expect.any(String), 150, 300]],
      A3: [['c1.3', 0, 300]]
    })
    expect(soundOf(alone, 'c1.2').link).toBe('c1')
    expect(alone.audioTracks[1]!.clips[1]!.link).toBeUndefined()
  })

  it('are all removed together, leaving a gap, and one on its own is removed on its own', () => {
    const t = addClip(group(), 'b', 'y')
    expect(shape(removeClip(t, 'c1.2'))).toEqual({ V1: [['y', 300, 420]], A1: [['y.1', 300, 420]], A2: [], A3: [] })
    expect(shape(removeClip(t, 'c1.2', true))).toEqual({
      V1: [['c1', 0, 300], ['y', 300, 420]],
      A1: [['c1.1', 0, 300], ['y.1', 300, 420]],
      A2: [],
      A3: [['c1.3', 0, 300]]
    })
  })
})

describe('closing up', () => {
  it('takes out the stretch a group covered: everything after it on every track moves earlier, and music under it stays', () => {
    const t = closeUpClip(cut(), 'p2')
    expect(shape(t)).toEqual({
      V1: [['p1', 0, 300], ['p3', 300, 420]],
      A1: [['p1.1', 0, 300], ['p3.1', 300, 420]],
      A2: [['music', 0, 600]]
    })
    assertInvariants(t)
  })

  it('always takes the whole group, even from one of its clips given alone', () => {
    expect(closeUpClip(cut(), 'p2.1')).toEqual(closeUpClip(cut(), 'p2'))
    expect(findClip(closeUpClip(cut(), 'p2.1'), 'p2')).toBeNull()
  })

  it('takes out what the group covers on V1, not a sound of it moved on past its picture', () => {
    let t = moveClip(cut(), 'p2.1', 'a1', 540, true)
    t = addSource(addTrack(t, 'video', 'V2'), { mediaId: 'b', clipId: 'cw', at: 700, onTrack: 'V2', streams: [] })
    // From 300 to 420, the picture: 120 frames, as V1 closes up, so the cutaway keeps its place
    // over the picture after. Taking out to the sound's end, 660, moved it 240 frames too far
    // (audit 2026-10-10).
    t = closeUpClip(t, 'p2')
    expect(placed(t, 'cw')).toEqual(['V2', 580, 0, 120])
    expect(placed(t, 'p3')).toEqual(['V1', 300, 0, 120])
  })

  it('moves a clip starting inside the stretch on another track to its start', () => {
    let t = addTrack(cut(), 'video', 'V2')
    // A cutaway over p2, from 330 to 450.
    t = addSource(t, { mediaId: 'b', clipId: 'cw', at: 330, onTrack: 'V2', streams: [] })
    t = closeUpClip(t, 'p2')
    expect(placed(t, 'cw')).toEqual(['V2', 300, 0, 120])
    expect(placed(t, 'music')).toEqual(['A2', 0, 0, 600])
  })

  it('moves a linked group as one, by where its earliest clip goes', () => {
    let t = addTrack(cut(), 'video', 'V2')
    // A picture inside p2's stretch, at 400, and its sound moved on its own to 450, after it.
    t = addSource(t, { mediaId: 'b', clipId: 'g', at: 400, onTrack: 'V2', streams: [0] })
    t = moveClip(t, 'g.1', findSoundClip(t, 'g.1')!.track.id, 450, true)
    t = closeUpClip(t, 'p2')
    // The picture goes to the stretch's start, 100 earlier, and its sound 100 earlier too, not 120.
    expect(placed(t, 'g')).toEqual(['V2', 300, 0, 120])
    expect(placed(t, 'g.1')![1]).toBe(350)
  })

  it('moves a clip later when it would overlap the one before it on its track', () => {
    let t = addTrack(cut(), 'video', 'V2')
    // q starts before the stretch and stays; r starts inside it and would go to 300, over q.
    t = addSource(t, { mediaId: 'b', clipId: 'q', at: 250, onTrack: 'V2', streams: [] })
    t = addSource(t, { mediaId: 'b', clipId: 'r', at: 380, onTrack: 'V2', streams: [] })
    t = closeUpClip(t, 'p2')
    expect(shape(t).V2).toEqual([
      ['q', 250, 370],
      ['r', 370, 490]
    ])
    assertInvariants(t)
  })
})

describe('a gap', () => {
  /** p1 (b, 0 to 120) and p2 (b, 200 to 320) on V1, their sounds on A1 the same: a gap from 120 to 200 on both. */
  function gapped(): Timeline {
    const t = addSource(sources(), { mediaId: 'b', clipId: 'p1', at: 0, onTrack: 'v1' })
    return addSource(t, { mediaId: 'b', clipId: 'p2', at: 200, onTrack: 'v1' })
  }
  const gap: Gap = { trackId: 'v1', from: 120, to: 200 }

  it('closes when nothing on another track is in it, taking its time out of the sequence', () => {
    const t = gapped()
    expect(gapCanClose(t, gap)).toBe(true)
    expect(gapCanClose(t, { trackId: 'a1', from: 120, to: 200 })).toBe(true)
    expect(shape(closeUpGap(t, gap))).toEqual({
      V1: [['p1', 0, 120], ['p2', 120, 240]],
      A1: [['p1.1', 0, 120], ['p2.1', 120, 240]]
    })
  })

  it('closes with a clip running right across it, which stays where it is', () => {
    const t = addSource(gapped(), { mediaId: 'song', clipId: 'music', at: 0 })
    expect(placed(t, 'music')).toEqual(['A2', 0, 0, 600])
    expect(gapCanClose(t, gap)).toBe(true)
    const closed = closeUpGap(t, gap)
    expect(placed(closed, 'music')).toEqual(['A2', 0, 0, 600])
    expect(placed(closed, 'p2')).toEqual(['V1', 120, 0, 120])
  })

  it('stays when something on another track starts, ends or lies inside it', () => {
    const over = (at: number, length = 120): Timeline => {
      const t = addSource(addTrack(gapped(), 'video', 'V2'), { mediaId: 'b', clipId: 'x', at, onTrack: 'V2', streams: [] })
      return setClipOut(t, 'x', length)
    }
    const blocked = [over(150), over(60), over(130, 40), moveClip(gapped(), 'p2.1', 'a1', 180, true)]
    for (const t of blocked) {
      expect(gapCanClose(t, gap)).toBe(false)
      expect(closeUpGap(t, gap)).toBe(t)
    }
  })

  it('is no gap where its own track has a clip, on a track that is not there, or with no length', () => {
    const t = gapped()
    expect(gapCanClose(t, { trackId: 'v1', from: 100, to: 200 })).toBe(false)
    // A picture on V2 alone, from 130 to 250: nothing on another track is in the way from 150 to 190, but it is.
    const onV2 = addSource(addTrack(t, 'video', 'V2'), { mediaId: 'b', clipId: 'x', at: 130, onTrack: 'V2', streams: [] })
    expect(gapCanClose(onV2, { trackId: 'V2', from: 150, to: 190 })).toBe(false)
    expect(gapCanClose(t, { trackId: 'nope', from: 120, to: 200 })).toBe(false)
    expect(gapCanClose(t, { trackId: 'v1', from: 200, to: 120 })).toBe(false)
    expect(closeUpGap(t, { trackId: 'v1', from: 100, to: 200 })).toBe(t)
  })
})

describe('trimToFrame, as I and O do', () => {
  it('on V1 trims the start to the frame, the clip keeping its start and everything after moving earlier', () => {
    const t = trimToFrame(cut(), 'p2', 'start', 330)
    expect(placed(t, 'p2')).toEqual(['V1', 300, 30, 120])
    // Its sound loses the same frames.
    expect(placed(t, 'p2.1')).toEqual(['A1', 300, 30, 120])
    expect(placed(t, 'p3')).toEqual(['V1', 390, 0, 120])
    expect(placed(t, 'p3.1')).toEqual(['A1', 390, 0, 120])
    expect(placed(t, 'music')).toEqual(['A2', 0, 0, 600])
    assertInvariants(t)
    // With the old test's numbers: I at frame 60 of the first clip pulls the next one to 240.
    const two = withTwoClips()
    const first = trimToFrame(two, v1Clips(two)[0]!.id, 'start', 60)
    expect(v1Clips(first).map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 60, 300],
      [240, 0, 120]
    ])
  })

  it('on V1 trims the end to the frame, everything after moving earlier', () => {
    const t = trimToFrame(cut(), 'p2', 'end', 400)
    expect(placed(t, 'p2')).toEqual(['V1', 300, 0, 100])
    expect(placed(t, 'p2.1')).toEqual(['A1', 300, 0, 100])
    expect(placed(t, 'p3')).toEqual(['V1', 400, 0, 120])
    expect(placed(t, 'p3.1')).toEqual(['A1', 400, 0, 120])
    assertInvariants(t)
  })

  it('on V1 always takes the clips linked to it, even when it is given alone', () => {
    expect(trimToFrame(cut(), 'p2', 'start', 330, true)).toEqual(trimToFrame(cut(), 'p2', 'start', 330))
  })

  it('on another track, linked to nothing on V1, closes up its own tracks only, and leaves a gap when alone', () => {
    let t = addTrack(cut(), 'video', 'V2')
    t = addSource(t, { mediaId: 'b', clipId: 'g', at: 330, onTrack: 'V2', streams: [0] })
    t = addSource(t, { mediaId: 'b', clipId: 'h', at: 500, onTrack: 'V2', streams: [] })
    const head = trimToFrame(t, 'g', 'start', 360)
    // Keeps its start and begins with the frame at the playhead; its sound on A3 with it.
    expect(placed(head, 'g')).toEqual(['V2', 330, 30, 120])
    expect(placed(head, 'g.1')).toEqual(['A3', 330, 30, 120])
    // What follows on V2 closes up; V1 underneath does not move.
    expect(placed(head, 'h')).toEqual(['V2', 470, 0, 120])
    expect(placed(head, 'p3')).toEqual(['V1', 420, 0, 120])
    const tail = trimToFrame(t, 'g', 'end', 400)
    expect(placed(tail, 'g')).toEqual(['V2', 330, 0, 70])
    expect(placed(tail, 'g.1')).toEqual(['A3', 330, 0, 70])
    expect(placed(tail, 'h')).toEqual(['V2', 450, 0, 120])
    expect(placed(tail, 'p3')).toEqual(['V1', 420, 0, 120])
    const alone = trimToFrame(t, 'g', 'start', 360, true)
    expect(placed(alone, 'g')).toEqual(['V2', 360, 30, 120])
    expect(placed(alone, 'g.1')).toEqual(['A3', 330, 0, 120])
    expect(placed(alone, 'h')).toEqual(['V2', 500, 0, 120])
  })

  it('is refused on another track when closing up would move a clip away from one linked to it', () => {
    let t = addTrack(cut(), 'video', 'V2')
    t = addSource(t, { mediaId: 'b', clipId: 'g', at: 330, onTrack: 'V2', streams: [] })
    // A picture on V2 after it, linked to a sound on A2 that is not on g's tracks.
    t = addSource(t, { mediaId: 'b', clipId: 'h', at: 500, onTrack: 'V2', streams: [0] })
    expect(trimToFrame(t, 'g', 'start', 360)).toBe(t)
    expect(trimToFrameBlockers(t, 'g', 'start', 360).map((c) => c.id)).toContain('h')
  })

  it('closes up from the sound half of a recording exactly as from its picture on V1, and the same for O', () => {
    expect(trimToFrame(cut(), 'p2.1', 'start', 330)).toEqual(trimToFrame(cut(), 'p2', 'start', 330))
    expect(trimToFrame(cut(), 'p2.1', 'end', 400)).toEqual(trimToFrame(cut(), 'p2', 'end', 400))
    expect(placed(trimToFrame(cut(), 'p2.1', 'start', 330), 'p3')).toEqual(['V1', 390, 0, 120])
  })

  it('trims only the sound half, leaving a gap, when it was selected alone', () => {
    const alone = trimToFrame(cut(), 'p2.1', 'start', 330, true)
    expect(placed(alone, 'p2.1')).toEqual(['A1', 330, 30, 120])
    expect(placed(alone, 'p2')).toEqual(['V1', 300, 0, 120])
    expect(placed(alone, 'p3')).toEqual(['V1', 420, 0, 120])
  })

  it('does nothing on a clip\'s first frame, after its end, or outside it', () => {
    const t = cut()
    expect(trimToFrame(t, 'p2', 'start', 300)).toBe(t)
    expect(trimToFrame(t, 'p2', 'end', 420)).toBe(t)
    expect(trimToFrame(t, 'p2', 'start', 100)).toBe(t)
    expect(trimToFrame(t, 'ghost', 'start', 330)).toBe(t)
  })
})

describe('unlinking', () => {
  it('separates every clip of the group for good', () => {
    const t = unlinkClip(group(), 'c1.2')
    expect(allClips(t).map((c) => 'link' in c)).toEqual([false, false, false, false])
    expect(linkedIds(t, 'c1')).toEqual(['c1'])
    // Moving the picture now leaves the sound where it is.
    expect(shape(moveClip(t, 'c1', 'v1', 100))).toEqual({
      V1: [['c1', 100, 400]],
      A1: [['c1.1', 0, 300]],
      A2: [['c1.2', 0, 300]],
      A3: [['c1.3', 0, 300]]
    })
  })

  it('leaves the other groups linked, and a clip linked to nothing as it is', () => {
    const t = unlinkClip(addClip(group(), 'b', 'y'), 'c1')
    expect(linkedIds(t, 'y')).toEqual(['y', 'y.1'])
    const q = addClip(sources(), 'quiet', 'q')
    expect(unlinkClip(q, 'q')).toBe(q)
  })
})

describe('adding and removing tracks', () => {
  it('adds a video track on top and an audio track at the bottom, up to 8 and 16', () => {
    let t = sources()
    for (let i = 2; i <= 9; i++) t = addTrack(t, 'video', `V${i}`)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'])
    for (let i = 2; i <= 17; i++) t = addTrack(t, 'audio', `A${i}`)
    expect(t.audioTracks).toHaveLength(16)
    expect(t.audioTracks[15]!.id).toBe('A16')
    expect(t.audioTracks.every((r) => r.clips.length === 0)).toBe(true)
  })

  it('adds no track with an id another track has', () => {
    const t = sources()
    expect(addTrack(t, 'audio', 'v1')).toBe(t)
    expect(addTrack(t, 'video', 'a1')).toBe(t)
  })

  it('removes only an empty track, and never V1 or A1', () => {
    const t = addTrack(addTrack(sources(), 'video', 'V2'), 'audio', 'A2')
    expect(removeTrack(t, 'v1')).toBe(t)
    expect(removeTrack(t, 'a1')).toBe(t)
    expect(removeTrack(t, 'nope')).toBe(t)
    const used = addSource(t, { mediaId: 'song', clipId: 's', at: 0, onTrack: 'A2' })
    expect(removeTrack(used, 'A2')).toBe(used)
    expect(removeTrack(t, 'V2').videoTracks.map((r) => r.id)).toEqual(['v1'])
    expect(removeTrack(t, 'A2').audioTracks.map((r) => r.id)).toEqual(['a1'])
  })
})

describe('duplicating a sequence with linked clips', () => {
  it('gives every clip a new id, and every group a new link its clips share', () => {
    const p0 = createProject('p', 30, { width: 1080, height: 1920 })
    const p1 = { ...p0, media: sources().media }
    const p = editSequence(p1, FIRST_SEQUENCE_ID, (t) => addClip(addClip(addClip(t, 'obs', 'c1'), 'b', 'y'), 'quiet', 'q'))
    const before = allClips(timelineOf(p, FIRST_SEQUENCE_ID))
    const after = allClips(timelineOf(duplicateSequence(p, FIRST_SEQUENCE_ID, 'copy'), 'copy'))
    expect(before).toHaveLength(7)
    expect(after).toHaveLength(7)
    expect(new Set(after.map((c) => c.id)).size).toBe(7)
    const links = new Map<string, string>()
    before.forEach((c, i) => {
      const d = after[i]!
      expect(d.id).not.toBe(c.id)
      // The same clip in the same place, apart from its id and link.
      expect({ ...d, id: c.id, link: c.link }).toEqual({ ...c, link: c.link })
      if (c.link === undefined) {
        expect(d.link).toBeUndefined()
        return
      }
      expect(d.link).toBeDefined()
      expect(d.link).not.toBe(c.link)
      if (!links.has(c.link)) links.set(c.link, d.link!)
      expect(d.link).toBe(links.get(c.link))
    })
    expect(links.size).toBe(2)
    expect(new Set(links.values()).size).toBe(2)
  })
})

describe('fixes found while building step 2', () => {
  /** A recording with three streams, each after the first copied on its own. */
  const obs = (copies: number): ProjectMedia =>
    media('obs', 10, {
      audioTracks: 3,
      trackFiles: Array.from({ length: copies }, (_, i) => ({ path: `C:\c\obs\track-${i + 2}.m4a`, peaksPath: `C:\c\obs\peaks-${i + 2}.bin` }))
    })

  it('keeps a sound clip on its stream while that stream\'s copy is only missing, as while the cache is rebuilt', () => {
    const t = addSource({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [obs(2)] }, { mediaId: 'obs', clipId: 'o' })
    const streams = (x: Timeline): number[] => x.audioTracks.flatMap((r) => r.clips.map((c) => c.track))
    expect(streams(t)).toEqual([0, 1, 2])
    // The copies gone for now, the recording still has three streams.
    expect(streams(upsertTimelineMedia(t, obs(0)))).toEqual([0, 1, 2])
    // Relinked to a file with one stream: those it no longer has play the first.
    expect(streams(upsertTimelineMedia(t, { ...obs(0), audioTracks: 1 }))).toEqual([0, 0, 0])
  })

  it('leaves V1 alone when S or I is pressed on the first frame of a selected picture on V2 over it', () => {
    let t = withTwoClips()
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'b', clipId: 'p', at: 60, onTrack: 'v2', streams: [] })
    // The selected picture starts on the playhead: a cut there would do nothing.
    expect(clipToCut(t, 60, 'p')).toBeNull()
    expect(splitClip(t, 60, 'p')).toBe(t)
    // With nothing selected, S finds V1's clip there.
    expect(clipToCut(t, 60, null)).toBe(v1Clips(t)[0]!.id)
  })
})

describe('fixes from the review of step 2', () => {
  it('cuts the clip under the playhead with its sound when S is pressed with another clip selected on its own', () => {
    const t = cut()
    const soundOf = (id: string): string => linkedIds(t, id).find((x) => x !== id)!
    // p1's sound selected alone, the playhead in p2: S cuts p2 and its sound together.
    const after = splitClip(t, 350, soundOf('p1'), true)
    const seconds = allClips(after).filter((c) => c.timelineStart === 350)
    expect(seconds).toHaveLength(2)
    expect(seconds[0]!.link).toBeDefined()
    expect(seconds[0]!.link).toBe(seconds[1]!.link)
    // I and O the same: the edit for p2 takes its sound with it.
    expect(trimToPlayhead(t, 350, 'end', soundOf('p1'), true)).toEqual({ kind: 'trimToFrame', clipId: 'p2', edge: 'end', frame: 350 })
    // The clip selected alone is still cut on its own when it is the one under the playhead.
    expect(allClips(splitClip(t, 350, soundOf('p2'), true)).filter((c) => c.timelineStart === 350)).toHaveLength(1)
    expect(trimToPlayhead(t, 350, 'end', soundOf('p2'), true)).toMatchObject({ clipId: soundOf('p2'), alone: true })
  })

  it('keeps a gap whose closing would part a linked group, the sound of the picture after it starting in front of it', () => {
    // p3's picture moved on its own to 450: a gap on V1 from 420 to 450, its sound still from 420.
    const t = moveClip(cut(), 'p3', 'v1', 450, true)
    const gap = { trackId: 'v1', from: 420, to: 450 }
    expect(gapPartsGroup(t, gap)).toBe(true)
    expect(gapCanClose(t, gap)).toBe(false)
    expect(closeUpGap(t, gap)).toBe(t)
    // A gap with nothing linked across it still closes.
    const plain = removeClip(cut(), 'p2')
    const hole = { trackId: 'v1', from: 300, to: 420 }
    expect(gapPartsGroup(plain, hole)).toBe(false)
    expect(gapCanClose(plain, hole)).toBe(true)
  })
})

describe('transitions on a cut', () => {
  /** p1 from 0 to 300 and p2 from 300 to 420 on V1, each with its sound on A1. */
  function twoCuts(): Timeline {
    return addClip(addClip(sources(), 'a', 'p1'), 'b', 'p2')
  }

  it('puts one on the incoming clip and fades its sound with it', () => {
    const t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    expect(videoOf(t, 'p2').transitionIn).toEqual({ kind: 'dissolve', length: 30, before: 15 })
    expect(soundOf(t, 'p2.1').transitionIn).toEqual({ kind: 'even', length: 30, before: 15 })
  })

  it('gives the sound its own curve, because a wipe means nothing to a sound', () => {
    const t = addTransition(twoCuts(), 'p2', 'in', { kind: 'wipeLeft', length: 30 })
    expect(videoOf(t, 'p2').transitionIn?.kind).toBe('wipeLeft')
    expect(soundOf(t, 'p2.1').transitionIn?.kind).toBe('even')
  })

  it('leaves the sound alone when the picture is taken on its own', () => {
    const t = addTransition(twoCuts(), 'p2', 'in', { length: 30, alone: true })
    expect(videoOf(t, 'p2').transitionIn).toBeDefined()
    expect(soundOf(t, 'p2.1').transitionIn).toBeUndefined()
  })

  it('stretches both clips, and leaves what is stored on them alone', () => {
    const t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    const shown = shownSpansOf(t)
    expect(shown.get('p1')).toEqual({ from: 0, to: 315 })
    expect(shown.get('p2')).toEqual({ from: 285, to: 420 })
    expect(videoOf(t, 'p1').sourceOut).toBe(300)
    expect(videoOf(t, 'p2').timelineStart).toBe(300)
  })

  it('drags to a new length on the picture and its sound together', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = setTransition(t, 'p2', 'in', { length: 60, before: 45 })
    expect(videoOf(t, 'p2').transitionIn).toEqual({ kind: 'dissolve', length: 60, before: 45 })
    expect(soundOf(t, 'p2.1').transitionIn).toEqual({ kind: 'even', length: 60, before: 45 })
  })

  it('does not bring back a sound fade that was taken off on purpose', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = removeTransition(t, 'p2.1', 'in', true)
    t = setTransition(t, 'p2', 'in', { length: 60, before: 30 })
    expect(soundOf(t, 'p2.1').transitionIn).toBeUndefined()
    expect(videoOf(t, 'p2').transitionIn?.length).toBe(60)
  })

  it('changes the kind of the one asked and leaves the linked fade its curve', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = setTransitionKind(t, 'p2', 'in', 'toWhite')
    expect(videoOf(t, 'p2').transitionIn?.kind).toBe('toWhite')
    expect(soundOf(t, 'p2.1').transitionIn?.kind).toBe('even')
  })

  it('refuses a kind of the wrong sort rather than storing it', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = setTransitionKind(t, 'p2.1', 'in', 'wipeLeft')
    expect(soundOf(t, 'p2.1').transitionIn?.kind).toBe('even')
  })

  it('takes one off the picture and its sound at once', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = removeTransition(t, 'p2', 'in')
    expect(videoOf(t, 'p2').transitionIn).toBeUndefined()
    expect(soundOf(t, 'p2.1').transitionIn).toBeUndefined()
    expect(shownSpansOf(t).get('p1')).toEqual({ from: 0, to: 300 })
  })

  it('makes the sequence longer for a fade hanging off the last clip, and not for one at a cut', () => {
    const inside = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    expect(timelineDuration(inside)).toBe(420)
    const hanging = addTransition(twoCuts(), 'p2', 'out', { kind: 'toBlack', length: 30 })
    expect(timelineDuration(hanging)).toBe(435)
  })

  it('leaves the transition with the clip it is stored on when that clip moves away', () => {
    let t = addTransition(twoCuts(), 'p2', 'in', { length: 30 })
    t = moveClip(t, 'p2', 'v1', 600)
    const [video] = transitionsOf(t)
    expect(video?.windows[0]).toMatchObject({ clipId: 'p2', kind: 'toBlack', fromClipId: null })
  })
})

describe('splitting a clip with transitions on its ends', () => {
  /** p1 from 0 to 300 and p2 from 300 to 420, p2 with a transition in from p1 and a fade out at its end. */
  function transitioned(): Timeline {
    let t = addClip(addClip(sources(), 'a', 'p1'), 'b', 'p2')
    t = addTransition(t, 'p2', 'in', { length: 30 })
    return addTransition(t, 'p2', 'out', { length: 30 })
  }

  /** Each piece of the recording cut from p2, picture then sound, with the ends that carry a transition. */
  function ends(t: Timeline): { at: number; ins: boolean; outs: boolean }[] {
    const all = [...t.videoTracks[0]!.clips, ...t.audioTracks[0]!.clips].filter((c) => c.timelineStart >= 300)
    return all.map((c) => ({ at: c.timelineStart, ins: c.transitionIn !== undefined, outs: c.transitionOut !== undefined }))
  }

  const expected = [
    { at: 300, ins: true, outs: false },
    { at: 360, ins: false, outs: true },
    { at: 300, ins: true, outs: false },
    { at: 360, ins: false, outs: true }
  ]

  it('keeps the transition at the start on the first piece and the one at the end on the second, and puts none on the new cut', () => {
    expect(ends(splitClip(transitioned(), 360))).toEqual(expected)
  })

  it('does the same when every track is split', () => {
    expect(ends(splitEverything(transitioned(), 360))).toEqual(expected)
  })
})

describe('a transition on every cut as it is made', () => {
  /** p1 from 0 to 300 and p2 from 300 to 420 on V1, each with its sound on A1. */
  function twoCuts(): Timeline {
    return addClip(addClip(sources(), 'a', 'p1'), 'b', 'p2')
  }

  /**
   * p1 (a) from 0 to 300, p2 (b) from 300 to 420, then p3 (a again) moved on
   * to 500, leaving a gap from 420 to 500. Each with its sound on A1.
   */
  function gapAfterP2(): Timeline {
    return moveClip(addClip(twoCuts(), 'a', 'p3'), 'p3', 'v1', 500)
  }

  it('puts one on the cut closing up a gap makes, and on its sound', () => {
    const before = gapAfterP2()
    const after = fillNewCuts(before, closeUpGap(before, { trackId: 'v1', from: 420, to: 500 }), { length: 30 })
    expect(videoOf(after, 'p3').timelineStart).toBe(420)
    expect(videoOf(after, 'p3').transitionIn).toMatchObject({ length: 30 })
    // Its sound was cut at the same frame and is faded with it.
    const sound = after.audioTracks[0]!.clips.find((c) => c.timelineStart === 420)!
    expect(sound.transitionIn).toMatchObject({ kind: 'even', length: 30 })
  })

  it('puts none on a plain split, where the footage carries straight on, nor on its sound', () => {
    const before = twoCuts()
    const after = fillNewCuts(before, splitClip(before, 150), { length: 30 })
    expect(videoOf(after, clipsAt(after, 150)!).transitionIn).toBeUndefined()
    const sound = after.audioTracks[0]!.clips.find((c) => c.timelineStart === 150)!
    expect(sound.transitionIn).toBeUndefined()
  })

  it('leaves the cuts that were already there alone', () => {
    const before = gapAfterP2()
    const after = fillNewCuts(before, closeUpGap(before, { trackId: 'v1', from: 420, to: 500 }), { length: 30 })
    // The cut at 300 was there before and is untouched.
    expect(videoOf(after, 'p2').transitionIn).toBeUndefined()
  })

  it('does not put back one that was taken off', () => {
    let t = twoCuts()
    t = addTransition(t, 'p2', 'in', { length: 30 })
    t = removeTransition(t, 'p2', 'in')
    // Another edit somewhere else entirely.
    const after = fillNewCuts(t, setClipAudio(t, 'p1.1', { gain: 0.5, muted: false }), { length: 30 })
    expect(videoOf(after, 'p2').transitionIn).toBeUndefined()
  })

  it('puts one on every cut a whole run of them makes, and each only once', () => {
    // Two gaps, 300 to 400 and 520 to 600, closed up one after the other in one edit.
    const before = moveClip(moveClip(addClip(twoCuts(), 'a', 'p3'), 'p3', 'v1', 600), 'p2', 'v1', 400)
    const once = closeUpGap(before, { trackId: 'v1', from: 300, to: 400 })
    const after = fillNewCuts(before, closeUpGap(once, { trackId: 'v1', from: 420, to: 500 }), { length: 30 })
    const withOne = v1Clips(after).filter((c) => c.transitionIn !== undefined)
    expect(withOne.map((c) => c.timelineStart)).toEqual([300, 420])
  })
})

/** The id of the V1 clip that starts at a frame. */
function clipsAt(t: Timeline, frame: number): string | undefined {
  return v1Clips(t).find((c) => c.timelineStart === frame)?.id
}
