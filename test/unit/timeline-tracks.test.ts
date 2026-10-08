import { describe, it, expect } from 'vitest'
import { captionTargets } from '../../src/shared/tracks'
import {
  closeUpStarts,
  closedUpStart,
  gapAt,
  gapClosable,
  hasRoom,
  headLimit,
  placeCovering,
  nearestShift,
  settleTrack,
  snapFrame,
  snapMove,
  snapTargets,
  snapTrim,
  spanEnd,
  trimTargets,
  tailLimit,
  withStarts,
  type Span
} from '../../src/shared/tracks'
import {
  addClip,
  addSource,
  addTrack,
  closeUpClip,
  createProject,
  createTimeline,
  duplicateSequence,
  editSequence,
  findSoundClip,
  moveClip,
  placeSource,
  removeClip,
  removeTrack,
  setClipIn,
  setClipOut,
  setSoundTrack,
  splitClip,
  timelineOf,
  trimToFrame,
  upsertTimelineMedia,
  v1Clips,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from '../../src/shared/project'

function span(id: string, timelineStart: number, length: number, sourceIn = 0, mediaId = 'm', link?: string): Span {
  return { id, mediaId, sourceIn, sourceOut: sourceIn + length, timelineStart, ...(link !== undefined ? { link } : {}) }
}

/** Clips laid end to end from the timeline's start. */
function v1(...clips: { id: string; length: number; sourceIn?: number; mediaId?: string }[]): Span[] {
  let at = 0
  return clips.map((c) => {
    const s = span(c.id, at, c.length, c.sourceIn ?? 0, c.mediaId ?? c.id)
    at += c.length
    return s
  })
}

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

/**
 * V1 holding a (300 frames) then b (120 frames) with Add to timeline, their
 * sound on A1, and a 20 second song to put on the tracks.
 */
function base(): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  const withMedia = { ...t, media: [media('a', 10), media('b', 4), media('song', 20, { hasVideo: false })] }
  return addClip(addClip(withMedia, 'a'), 'b')
}

/** The song dropped at `at`, on the track named, or where there is room. */
function song(t: Timeline, clipId: string, at: number, onTrack?: string): Timeline {
  return addSource(t, { clipId, mediaId: 'song', at, ...(onTrack !== undefined ? { onTrack } : {}) })
}

function soundAt(t: Timeline, clipId: string): SoundClip {
  const found = findSoundClip(t, clipId)
  if (!found) throw new Error(`no sound clip ${clipId}`)
  return found.clip
}

describe('room on a track', () => {
  const track = [span('x', 100, 50), span('y', 200, 50)]

  it('is where nothing is, up to the edges of what is there', () => {
    expect(hasRoom(track, 0, 100)).toBe(true)
    expect(hasRoom(track, 150, 50)).toBe(true)
    expect(hasRoom(track, 149, 2)).toBe(false)
    expect(hasRoom(track, 240, 5)).toBe(false)
    expect(hasRoom(track, 110, 10, new Set(['x']))).toBe(true)
  })
})

describe('a clip dropped over others on its track', () => {
  const ids = ['n1', 'n2']
  const fresh = (): (() => string) => {
    let i = 0
    return () => ids[i++]!
  }

  it('removes one it covers completely', () => {
    const out = placeCovering([span('x', 100, 50)], span('new', 90, 80), fresh())
    expect(out.map((c) => c.id)).toEqual(['new'])
  })

  it('trims the part it covers off one it overlaps', () => {
    const out = placeCovering([span('x', 100, 50), span('y', 200, 50)], span('new', 130, 90), fresh())
    expect(out).toEqual([
      { ...span('x', 100, 30) },
      span('new', 130, 90),
      { ...span('y', 220, 30, 20) }
    ])
  })

  it('cuts one it lands in the middle of in two around it, the second piece a new clip', () => {
    const out = placeCovering([span('x', 100, 100)], span('new', 130, 20), fresh())
    expect(out).toEqual([span('x', 100, 30), span('new', 130, 20), { ...span('x', 150, 50, 50), id: 'n1' }])
  })

  it('leaves alone what it does not touch, and itself when it was already on the track', () => {
    const out = placeCovering([span('x', 0, 10), span('new', 50, 10)], span('new', 20, 10), fresh())
    expect(out).toEqual([span('x', 0, 10), span('new', 20, 10)])
  })
})

describe('how far a clip on a track can be trimmed', () => {
  it('stops its head at the clip before it, the timeline\'s start and its recording\'s start', () => {
    const track = [span('x', 0, 50), span('c', 100, 50, 80)]
    expect(headLimit(track, track[1]!)).toBe(50)
    expect(headLimit([span('c', 100, 50, 30)], span('c', 100, 50, 30))).toBe(70)
    expect(headLimit([span('c', 10, 50, 30)], span('c', 10, 50, 30))).toBe(0)
  })

  it('stops its tail at the clip after it and its recording\'s end', () => {
    const track = [span('c', 100, 50), span('y', 170, 10)]
    expect(tailLimit(track, track[0]!, 1000)).toBe(170)
    expect(tailLimit([span('c', 100, 50, 10)], span('c', 100, 50, 10), 80)).toBe(170)
  })
})

describe('settling a track', () => {
  it('moves a later clip right when two would overlap afterwards, never changing a length', () => {
    const settled = settleTrack([span('x', 0, 50), span('y', 30, 20), span('z', 90, 10)])
    expect(settled.map((c) => [c.timelineStart, spanEnd(c)])).toEqual([
      [0, 50],
      [50, 70],
      [90, 100]
    ])
  })

  it('puts each clip where it is told, never before the timeline\'s start, then settles the track', () => {
    const track = { id: 'V2', clips: [span('x', 0, 50), span('y', 100, 50), span('z', 300, 10)] }
    expect(withStarts(track, new Map([['y', 30]])).clips.map((c) => [c.id, c.timelineStart])).toEqual([
      ['x', 0],
      ['y', 50],
      ['z', 300]
    ])
    expect(withStarts({ id: 'V2', clips: [span('x', 20, 10)] }, new Map([['x', -5]])).clips[0]!.timelineStart).toBe(0)
    expect(withStarts(track, new Map()).clips).toEqual(track.clips)
  })
})

describe('closing up a stretch', () => {
  it('moves what starts after it earlier by its length, what starts inside it to its start, and leaves what starts before it', () => {
    // The stretch from 100 to 140.
    expect(closedUpStart(50, 100, 40)).toBe(50)
    expect(closedUpStart(99, 100, 40)).toBe(99)
    expect(closedUpStart(100, 100, 40)).toBe(100)
    expect(closedUpStart(120, 100, 40)).toBe(100)
    expect(closedUpStart(139, 100, 40)).toBe(100)
    expect(closedUpStart(140, 100, 40)).toBe(100)
    expect(closedUpStart(200, 100, 40)).toBe(160)
  })

  it('moves a linked group as one, by where its earliest clip goes', () => {
    // The stretch from 100 to 150.
    const clips = [
      span('pic', 120, 50, 0, 'm', 'g'),
      span('snd', 160, 50, 0, 'm', 'g'),
      span('lone', 160, 50),
      span('under', 50, 200, 0, 'm', 'h'),
      span('late', 300, 10, 0, 'm', 'h')
    ]
    const starts = closeUpStarts(clips, 100, 50, new Set())
    // pic starts inside and goes to 100, 20 earlier, so snd goes 20 earlier too, not 50 as lone does.
    // under starts before, so its group stays, late included.
    expect(Object.fromEntries(starts)).toEqual({ pic: 100, snd: 140, lone: 110, under: 50, late: 300 })
  })

  it('leaves out the clips named, which do not hold their group back', () => {
    const clips = [span('kept', 0, 100, 0, 'm', 'g'), span('snd', 200, 50, 0, 'm', 'g'), span('other', 300, 10)]
    const starts = closeUpStarts(clips, 100, 50, new Set(['kept']))
    expect(Object.fromEntries(starts)).toEqual({ snd: 150, other: 250 })
  })
})

describe('gaps', () => {
  const track = [span('x', 100, 50), span('y', 200, 50)]

  it('are the empty stretch between the clips either side, or before the first', () => {
    expect(gapAt(track, 170)).toEqual({ from: 150, to: 200 })
    expect(gapAt(track, 150)).toEqual({ from: 150, to: 200 })
    expect(gapAt(track, 199)).toEqual({ from: 150, to: 200 })
    expect(gapAt(track, 30)).toEqual({ from: 0, to: 100 })
  })

  it('are nothing on a clip or past the last one', () => {
    expect(gapAt(track, 100)).toBeNull()
    expect(gapAt(track, 149)).toBeNull()
    expect(gapAt(track, 250)).toBeNull()
    expect(gapAt(track, 400)).toBeNull()
    expect(gapAt([], 0)).toBeNull()
  })

  it('close only when nothing on another track starts, ends or lies inside them', () => {
    // The gap from 100 to 200.
    expect(gapClosable([span('before', 0, 100), span('after', 200, 50)], 100, 200)).toBe(true)
    expect(gapClosable([span('starts', 150, 100)], 100, 200)).toBe(false)
    expect(gapClosable([span('ends', 50, 100)], 100, 200)).toBe(false)
    expect(gapClosable([span('inside', 120, 20)], 100, 200)).toBe(false)
  })

  it('close with a clip running right across them, like music under the whole cut', () => {
    expect(gapClosable([span('music', 50, 200)], 100, 200)).toBe(true)
    expect(gapClosable([span('music', 50, 200), span('starts', 150, 100)], 100, 200)).toBe(false)
  })
})

describe('snapping', () => {
  const tracksOf = [v1({ id: 'a', length: 100 }, { id: 'b', length: 50 }), [span('x', 200, 30)]]

  it('offers every clip edge on every track and the playhead, but not the clips being dragged', () => {
    expect(snapTargets(tracksOf, 75)).toEqual([0, 75, 100, 150, 200, 230])
    expect(snapTargets(tracksOf, 75, new Set(['x']))).toEqual([0, 75, 100, 150])
    // A linked group dragged together offers none of its own edges.
    expect(snapTargets(tracksOf, 75, new Set(['b', 'x']))).toEqual([0, 75, 100])
  })

  it('moves an edge onto the nearest target within reach, and leaves it alone otherwise', () => {
    const targets = [0, 100, 150]
    expect(snapFrame(96, targets, 5)).toBe(100)
    expect(snapFrame(104, targets, 5)).toBe(100)
    expect(snapFrame(94, targets, 5)).toBe(94)
    expect(snapFrame(126, targets, 30)).toBe(150)
  })

  it('keeps a moved clip whose edge is exactly on a target there', () => {
    // Its start is on 100; its end, 5 from 395, must not pull it off.
    expect(snapMove(100, 300, [0, 100, 395], 20)).toBe(100)
    expect(snapMove(99, 300, [0, 100, 395], 20)).toBe(100)
    expect(nearestShift(100, [100], 20)).toBe(0)
    expect(nearestShift(50, [100], 20)).toBeNull()
  })

  it('lets a trim that closes up by a few frames through, rather than snapping back to where it began', () => {
    const clips = v1({ id: 'a', length: 300 }, { id: 'b', length: 300 })
    const a = clips[0]!
    const closing = { closesUp: true, moving: new Set(['a']) }
    // A's end is B's start: neither is somewhere to snap to while A's end moves.
    const tail = trimTargets([clips], a, 'end', 0, closing)
    expect(tail).not.toContain(300)
    expect(tail).not.toContain(600)
    // A 10 frame trim of the tail, at a zoom where 8 pixels are 20 frames.
    expect(snapTrim({ closesUp: true, edge: 'end', frame: 290, startAt: 0, inAt: 0, outAt: 300, targets: tail, within: 20 })).toBe(290)
    // And of the head, which moves A's end the other way.
    const head = trimTargets([clips], a, 'start', 0, closing)
    expect(snapTrim({ closesUp: true, edge: 'start', frame: 10, startAt: 0, inAt: 0, outAt: 300, targets: head, within: 20 })).toBe(10)
  })

  it('snaps a trim that closes up to what stays put: the playhead, and what starts before the part that moves', () => {
    const clips = v1({ id: 'a', length: 100 }, { id: 'b', length: 300 })
    const b = clips[1]!
    const track = [span('early', 50, 20), span('over', 200, 40), span('late', 500, 10)]
    const closing = { closesUp: true, moving: new Set(['b']) }
    // For a tail trim of b, what starts before b's end stays put; for a head trim, only what starts before b.
    expect(trimTargets([clips, track], b, 'end', 250, closing)).toEqual([0, 50, 70, 100, 200, 240, 250])
    expect(trimTargets([clips, track], b, 'start', 250, closing)).toEqual([0, 50, 70, 100, 250])
    // b's end, now at 400, lands on the playhead at 250 when trimmed to 255.
    expect(snapTrim({ closesUp: true, edge: 'end', frame: 155, startAt: 100, inAt: 0, outAt: 300, targets: [250], within: 20 })).toBe(150)
    expect(snapTrim({ closesUp: true, edge: 'start', frame: 145, startAt: 100, inAt: 0, outAt: 300, targets: [250], within: 20 })).toBe(150)
  })

  it('lets a clip\'s edge leave a neighbour it touches', () => {
    // After a split, the next piece starts exactly where this one ends.
    const track = [span('x', 100, 50), span('y', 150, 50)]
    const targets = trimTargets([track], track[0]!, 'end', 0, { closesUp: false, moving: new Set(['x']) })
    expect(targets).not.toContain(150)
    expect(snapTrim({ closesUp: false, edge: 'end', frame: 45, startAt: 100, inAt: 0, outAt: 50, targets, within: 20 })).toBe(45)
  })

  it('leaves out the edges of the clips linked to the one trimmed, which move with it', () => {
    const pic = span('pic', 100, 50, 0, 'm', 'g')
    const snd = span('snd', 100, 50, 0, 'm', 'g')
    const tracks = [[pic], [snd, span('other', 300, 10)]]
    expect(trimTargets(tracks, pic, 'end', 0, { closesUp: false, moving: new Set(['pic', 'snd']) })).toEqual([0, 300, 310])
    // Trimmed alone, its sound's edges stay put, so they can be snapped to.
    expect(trimTargets(tracks, pic, 'end', 0, { closesUp: false, moving: new Set(['pic']) })).toEqual([0, 100, 300, 310])
  })

  it('snaps a moved clip by whichever of its edges is closer to a target', () => {
    const targets = [0, 100, 150]
    // Its start is 3 from 100; its end, at 143, is 7 from 150.
    expect(snapMove(97, 46, targets, 8)).toBe(100)
    // Its end, at 148, is 2 from 150; its start 5 from 100.
    expect(snapMove(105, 43, targets, 8)).toBe(107)
    expect(snapMove(60, 10, targets, 8)).toBe(60)
    // Never before the timeline's start.
    expect(snapMove(2, 10, [0], 8)).toBe(0)
  })
})

describe('sound on an audio track', () => {
  it('lands where it is dropped, on a new track below the last when none has room', () => {
    // A1 holds V1's sound up to 420.
    const t = song(base(), 's1', 45)
    expect(t.audioTracks).toHaveLength(2)
    expect(t.audioTracks[1]!.clips.map((c) => c.id)).toEqual(['s1'])
    expect(soundAt(t, 's1')).toMatchObject({ timelineStart: 45, sourceIn: 0, sourceOut: 600, track: 0, gain: 1 })
  })

  it('goes on the first track with room for all of it, from A1 down, and makes a new track when none has', () => {
    let t = song(base(), 's1', 0)
    t = song(t, 's2', 700)
    expect(t.audioTracks).toHaveLength(2)
    t = song(t, 's3', 100)
    expect(t.audioTracks).toHaveLength(3)
    expect(['s1', 's2', 's3'].map((id) => findSoundClip(t, id)!.index)).toEqual([1, 0, 2])
  })

  it('goes on the track it was dropped on, covering what is there, rather than the first with room', () => {
    let t = addTrack(addTrack(base(), 'audio', 'A2'), 'audio', 'A3')
    t = song(t, 's1', 0, 'A2')
    // Dropped on A2 at 100, over the song: it goes there and cuts the song.
    t = song(t, 's2', 100, 'A2')
    expect(t.audioTracks[1]!.clips.map((c) => [c.id, c.timelineStart, c.sourceOut - c.sourceIn])).toEqual([
      ['s1', 0, 100],
      ['s2', 100, 600]
    ])
    expect(t.audioTracks[2]!.clips).toEqual([])
    // A track that is not there is no track: it goes where there is room.
    const elsewhere = song(t, 's3', 0, 'gone')
    expect(elsewhere.audioTracks[2]!.clips.map((c) => c.id)).toEqual(['s3'])
  })

  it('is refused once all 16 tracks are full there', () => {
    let t = base()
    for (let i = 1; i < 16; i++) t = song(t, `s${i}`, 0)
    expect(t.audioTracks).toHaveLength(16)
    expect(placeSource(t, { clipId: 'late', mediaId: 'song', at: 0 }).refused).toBe(
      'No room for all of its sound: a sequence has at most 16 audio tracks.'
    )
    expect(song(t, 'late', 0)).toBe(t)
  })

  it('never puts a sound file on V1, even with Add to timeline, which puts it at V1\'s end', () => {
    const t = addClip(base(), 'song', 'sf')
    expect(v1Clips(t)).toHaveLength(2)
    expect(soundAt(t, 'sf').timelineStart).toBe(420)
  })

  it('moves along its track and to another, covering what it lands on', () => {
    let t = addTrack(addTrack(base(), 'audio', 'A2'), 'audio', 'A3')
    t = song(t, 's1', 0, 'A2')
    t = song(t, 's2', 0)
    expect(t.audioTracks[2]!.clips.map((c) => c.id)).toEqual(['s2'])
    t = moveClip(t, 's2', 'A2', 300)
    expect(t.audioTracks[2]!.clips).toEqual([])
    expect(t.audioTracks[1]!.clips.map((c) => [c.id, c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      ['s1', 0, 0, 300],
      ['s2', 300, 0, 600]
    ])
  })

  it('trims against its neighbours and its recording, keeping its tail in place when the head moves', () => {
    let t = song(addTrack(base(), 'audio', 'A2'), 's1', 0, 'A2')
    t = moveClip(t, 's1', 'A2', 0)
    t = setClipOut(t, 's1', 200)
    t = song(t, 's2', 300)
    expect(findSoundClip(t, 's2')!.track.id).toBe('A2')
    t = setClipIn(t, 's2', 250)
    // Back to the song's start, which is where it began, at 300.
    t = setClipIn(t, 's2', 0)
    expect(soundAt(t, 's2')).toMatchObject({ timelineStart: 300, sourceIn: 0 })
    t = moveClip(t, 's2', 'A2', 400)
    t = setClipIn(t, 's2', -500)
    expect(soundAt(t, 's2')).toMatchObject({ timelineStart: 400, sourceIn: 0 })
    t = setClipIn(t, 's2', 100)
    expect(soundAt(t, 's2')).toMatchObject({ timelineStart: 500, sourceIn: 100, sourceOut: 600 })
    t = setClipIn(t, 's2', 50)
    expect(soundAt(t, 's2')).toMatchObject({ timelineStart: 450, sourceIn: 50 })
    // Its tail stops at the end of the song.
    t = setClipOut(t, 's2', 9999)
    expect(soundAt(t, 's2').sourceOut).toBe(600)
    // And the first clip's tail at the second clip's head.
    t = setClipOut(t, 's1', 590)
    expect(soundAt(t, 's1').sourceOut).toBe(450)
  })

  it('leaves a gap when removed, and a track goes only when empty', () => {
    let t = song(addTrack(base(), 'audio', 'A2'), 's1', 0, 'A2')
    expect(removeTrack(t, 'A2')).toBe(t)
    t = removeClip(t, 's1')
    expect(v1Clips(t)).toHaveLength(2)
    expect(t.audioTracks[1]!.clips).toEqual([])
    expect(removeTrack(t, 'A2').audioTracks.map((r) => r.id)).toEqual(['a1'])
  })

  it('splits at the playhead when it is the clip named, and V1 otherwise', () => {
    let t = song(addTrack(base(), 'audio', 'A2'), 's1', 0, 'A2')
    t = splitClip(t, 90, 's1')
    expect(t.audioTracks[1]!.clips.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 90],
      [90, 90, 600]
    ])
    expect(v1Clips(t)).toHaveLength(2)
    t = splitClip(t, 60)
    expect(v1Clips(t)).toHaveLength(3)
  })

  it('plays a stream the recording has, and no other', () => {
    const t0 = { ...base(), media: [...base().media, media('obs', 10, { audioTracks: 3 })] }
    let t = addSource(t0, { clipId: 'o', mediaId: 'obs', at: 500, onTrack: 'v1', streams: [0] })
    t = setSoundTrack(t, 'o.1', 2)
    expect(soundAt(t, 'o.1').track).toBe(2)
    t = setSoundTrack(t, 'o.1', 9)
    expect(soundAt(t, 'o.1').track).toBe(2)
  })

  it('stays where it is when a V1 clip before it is trimmed, moved or removed, and moves earlier by what is taken out when the sequence closes up', () => {
    // A voice over starting 30 frames into b.
    const t = song(addTrack(base(), 'audio', 'A2'), 'vo', 330, 'A2')
    const [a, b] = [v1Clips(t)[0]!.id, v1Clips(t)[1]!.id]
    // Every track is free: a trim, a move or a Delete on V1 leaves it where it is.
    expect(soundAt(setClipIn(t, a, 100), 'vo').timelineStart).toBe(330)
    expect(soundAt(moveClip(t, b, 'v1', 0), 'vo').timelineStart).toBe(330)
    expect(soundAt(removeClip(t, a), 'vo').timelineStart).toBe(330)
    // I at frame 100 of a, and Shift+Delete on a, take that much out of the sequence.
    expect(soundAt(trimToFrame(t, a, 'start', 100), 'vo').timelineStart).toBe(230)
    expect(soundAt(closeUpClip(t, a), 'vo').timelineStart).toBe(30)
  })

  it('plays the first stream when its source comes back without the stream it played', () => {
    const t0 = { ...base(), media: [...base().media, media('obs', 10, { audioTracks: 3, trackFiles: [
      { path: 'C:\\c\\t2.m4a', peaksPath: 'C:\\c\\p2.bin' },
      { path: 'C:\\c\\t3.m4a', peaksPath: 'C:\\c\\p3.bin' }
    ] })] }
    const t = setSoundTrack(addSource(t0, { clipId: 'o', mediaId: 'obs', at: 500, onTrack: 'v1', streams: [0] }), 'o.1', 2)
    expect(soundAt(t, 'o.1').track).toBe(2)
    const oneTrack = upsertTimelineMedia(t, media('obs', 10, { audioTracks: 1 }))
    expect(soundAt(oneTrack, 'o.1').track).toBe(0)
  })

  it('is pulled inside a source that comes back shorter', () => {
    const t = song(base(), 's1', 0)
    const shorter = upsertTimelineMedia(t, media('song', 5, { hasVideo: false }))
    expect(soundAt(shorter, 's1').sourceOut).toBe(150)
  })

  it('is copied with its track, as new clips, when the sequence is duplicated', () => {
    const p0 = createProject('p', 30, { width: 1080, height: 1920 })
    const p1 = { ...p0, media: base().media }
    const p = editSequence(p1, 'sequence-1', (t) => song(t, 's1', 0))
    const copy = duplicateSequence(p, 'sequence-1', 'copy')
    const tracks = timelineOf(copy, 'copy').audioTracks
    expect(tracks.map((r) => r.id)).toEqual(['a1'])
    expect(tracks[0]!.clips[0]!.id).not.toBe('s1')
    expect(tracks[0]!.clips[0]!.timelineStart).toBe(0)
  })
})

describe('what a caption snaps to', () => {
  const captions = [
    { id: 'a', timelineStart: 100, length: 30 },
    { id: 'b', timelineStart: 130, length: 30 }
  ]

  it("is every clip's edges, the other captions' and the playhead", () => {
    const clips = [[{ id: 'x', mediaId: 'm', sourceIn: 0, sourceOut: 50, timelineStart: 10 }]]
    expect(captionTargets(clips, captions, 70, 'a')).toEqual([0, 10, 60, 70, 130, 160])
  })

  it("never a trimmed edge's own frame, which a touching caption shares, or a trim of a few frames would snap back", () => {
    expect(captionTargets([], captions, 0, 'a', 130)).not.toContain(130)
    expect(captionTargets([], captions, 0, 'a')).toContain(130)
  })
})
