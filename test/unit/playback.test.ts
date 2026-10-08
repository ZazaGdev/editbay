import { describe, it, expect } from 'vitest'
import { nextAfterRemoved, playheadInto, positionAt, trimToPlayhead, trimToPlayheadRefusal, trimToPlayheadWords } from '../../src/shared/playback'
import {
  createTimeline,
  addClip,
  addSource,
  addTrack,
  closeUpClip,
  findClip,
  removeClip,
  trimToFrame,
  v1Clips,
  type Timeline,
  type ProjectMedia
} from '../../src/shared/project'

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

/** 30fps, two clips on V1: 10 seconds (300 frames) then 4 seconds (120), each with its sound on A1. */
function project(): Timeline {
  const p = createTimeline(30, { width: 1080, height: 1920 })
  return addClip(addClip({ ...p, media: [media('a', 10), media('b', 4)] }, 'a'), 'b')
}

/**
 * V1's clip `index` with its head trimmed to `frame` of its recording, keeping
 * its start: I on V1, which closes up, as every trim on V1 did before V1 had gaps.
 */
function headTrimmed(p: Timeline, index: number, frame: number): Timeline {
  const c = v1Clips(p)[index]!
  return trimToFrame(p, c.id, 'start', c.timelineStart + frame - c.sourceIn)
}

/** `project()` with a picture of b on V2 from 60 to 180, brought without its sound. */
function withCutaway(): Timeline {
  const p = addTrack(project(), 'video', 'v2')
  return addSource(p, { mediaId: 'b', clipId: 'p1', at: 60, onTrack: 'v2', streams: [] })
}

describe('positionAt', () => {
  it('maps a timeline frame onto a source time', () => {
    const at = positionAt(project(), 90)
    expect(at?.clip.mediaId).toBe('a')
    expect(at?.sourceFrame).toBe(90)
    expect(at?.sourceSec).toBeCloseTo(3)
    expect(at?.framesRemaining).toBe(210)
  })

  it('accounts for a trimmed head', () => {
    const p = headTrimmed(project(), 0, 60)
    // Timeline frame 10 is 10 frames into a clip that starts 60 frames in.
    const at = positionAt(p, 10)
    expect(at?.sourceFrame).toBe(70)
    expect(at?.sourceSec).toBeCloseTo(70 / 30)
  })

  it('maps into the second clip using its own source range', () => {
    const p = headTrimmed(project(), 1, 30)
    const at = positionAt(p, 300 + 15)
    expect(at?.clip.mediaId).toBe('b')
    expect(at?.sourceFrame).toBe(45)
    expect(at?.framesRemaining).toBe(75)
  })

  it('carries the media so the caller does not have to look it up', () => {
    expect(positionAt(project(), 0)?.media.id).toBe('a')
  })

  it('reports which clip it landed in', () => {
    const p = project()
    expect(positionAt(p, 0)?.clip.id).toBe(v1Clips(p)[0]!.id)
    expect(positionAt(p, 300)?.clip.id).toBe(v1Clips(p)[1]!.id)
  })

  it('finds nothing outside the timeline', () => {
    expect(positionAt(project(), 420)).toBeNull()
    expect(positionAt(project(), -1)).toBeNull()
  })

  it('finds nothing on an empty timeline', () => {
    expect(positionAt(createTimeline(30, { width: 1080, height: 1920 }), 0)).toBeNull()
  })

  it('finds nothing when the media has gone missing', () => {
    const p = project()
    expect(positionAt({ ...p, media: [] }, 0)).toBeNull()
  })

  it('reports one frame remaining on the last frame of a clip', () => {
    expect(positionAt(project(), 299)?.framesRemaining).toBe(1)
  })

  it('takes the clip on the lowest video track under the frame, V1\'s when it has one there', () => {
    const p = withCutaway()
    const at = positionAt(p, 90)
    expect(at?.clip.id).toBe(v1Clips(p)[0]!.id)
    expect(at?.sourceFrame).toBe(90)
  })

  it('takes a picture on a higher track over a gap in V1, and nothing where only sound is', () => {
    const cutaway = withCutaway()
    // V1's first clip taken away on its own leaves a gap on V1 and its sound on A1.
    const p = removeClip(cutaway, v1Clips(cutaway)[0]!.id, true)
    const at = positionAt(p, 90)
    expect(at?.clip.id).toBe('p1')
    expect(at?.media.id).toBe('b')
    expect(at?.sourceFrame).toBe(30)
    expect(at?.framesRemaining).toBe(90)
    const sound = p.audioTracks[0]!.clips[0]!
    expect([sound.timelineStart, sound.sourceOut]).toEqual([0, 300])
    expect(positionAt(p, 200)).toBeNull()
    expect(positionAt(p, 300)?.clip.id).toBe(v1Clips(p)[0]!.id)
  })
})

describe('trimToPlayhead', () => {
  it('makes the frame under the playhead the clip\'s first frame', () => {
    const p = project()
    expect(trimToPlayhead(p, 90, 'start')).toEqual({ kind: 'trimToFrame', clipId: v1Clips(p)[0]!.id, edge: 'start', frame: 90 })
  })

  it('makes the frame under the playhead the first one after the clip ends', () => {
    const edit = trimToPlayhead(project(), 90, 'end')
    expect(edit?.kind).toBe('trimToFrame')
    expect(edit && 'edge' in edit ? edit.edge : '').toBe('end')
    expect(edit && 'frame' in edit ? edit.frame : -1).toBe(90)
  })

  it('works on a later clip using its own source range', () => {
    const p = headTrimmed(project(), 1, 30)
    const id = v1Clips(p)[1]!.id
    // Timeline 310 is 10 frames into the second clip, which starts 30 frames in.
    const edit = trimToPlayhead(p, 310, 'start')
    expect(edit).toEqual({ kind: 'trimToFrame', clipId: id, edge: 'start', frame: 310 })
    expect(v1Clips(trimToFrame(p, id, 'start', 310))[1]!.sourceIn).toBe(40)
  })

  it('targets the clip under the playhead', () => {
    const p = project()
    const edit = trimToPlayhead(p, 350, 'end')
    expect(edit && 'clipId' in edit ? edit.clipId : '').toBe(v1Clips(p)[1]!.id)
  })

  it('does nothing when the start is already there', () => {
    expect(trimToPlayhead(project(), 0, 'start')).toBeNull()
    expect(trimToPlayhead(project(), 300, 'start')).toBeNull()
  })

  it('does nothing when trimming the end would leave no clip', () => {
    // On a clip's first frame, ending it there would make it empty.
    expect(trimToPlayhead(project(), 0, 'end')).toBeNull()
    expect(trimToPlayhead(project(), 300, 'end')).toBeNull()
  })

  it('does nothing off the end of the timeline', () => {
    expect(trimToPlayhead(project(), 420, 'start')).toBeNull()
    expect(trimToPlayhead(project(), 420, 'end')).toBeNull()
  })

  it('takes the selected clip when it is under the playhead, on any track', () => {
    const p = withCutaway()
    expect(trimToPlayhead(p, 90, 'end', 'p1')).toEqual({ kind: 'trimToFrame', clipId: 'p1', edge: 'end', frame: 90 })
    const sound = p.audioTracks[0]!.clips[0]!.id
    expect(trimToPlayhead(p, 90, 'start', sound)).toEqual({ kind: 'trimToFrame', clipId: sound, edge: 'start', frame: 90 })
  })

  it('otherwise takes what S would cut there: the lowest video track\'s clip, then the audio track nearest the top', () => {
    const cutaway = withCutaway()
    const [a, b] = v1Clips(cutaway)
    // b is selected but is not under the playhead, so V1's clip there is trimmed, not the picture over it.
    expect(trimToPlayhead(cutaway, 90, 'start', b!.id)).toEqual({ kind: 'trimToFrame', clipId: a!.id, edge: 'start', frame: 90 })
    expect(trimToPlayhead(cutaway, 90, 'start')).toEqual({ kind: 'trimToFrame', clipId: a!.id, edge: 'start', frame: 90 })
    // With a taken away on its own, the picture on V2 is the lowest there, and past it A1's sound.
    const gap = removeClip(cutaway, a!.id, true)
    expect(trimToPlayhead(gap, 90, 'start')).toEqual({ kind: 'trimToFrame', clipId: 'p1', edge: 'start', frame: 90 })
    const sound = gap.audioTracks[0]!.clips[0]!.id
    expect(trimToPlayhead(gap, 200, 'end')).toEqual({ kind: 'trimToFrame', clipId: sound, edge: 'end', frame: 200 })
  })

  it('does nothing on the first frame of the clip it would take', () => {
    const cutaway = withCutaway()
    const [a, b] = v1Clips(cutaway)
    expect(trimToPlayhead(cutaway, 300, 'start', b!.id)).toBeNull()
    // With a and its sound gone, only the picture on V2 is at 60, and 60 is its first frame.
    const gap = removeClip(cutaway, a!.id)
    expect(trimToPlayhead(gap, 60, 'start', 'p1')).toBeNull()
    expect(trimToPlayhead(gap, 60, 'end')).toBeNull()
  })

  it('carries a clip selected on its own through to the edit', () => {
    const p = withCutaway()
    expect(trimToPlayhead(p, 90, 'start', 'p1', true)).toEqual({ kind: 'trimToFrame', clipId: 'p1', edge: 'start', frame: 90, alone: true })
  })
})

describe('playheadInto', () => {
  it('leaves the playhead where it is when it is already in the clip', () => {
    const [a] = v1Clips(project())
    expect(playheadInto(a!, 0)).toBe(0)
    expect(playheadInto(a!, 150)).toBe(150)
    // Its last frame is still in it; the frame after is the next clip's.
    expect(playheadInto(a!, 299)).toBe(299)
  })

  it('goes to the first frame of the clip from anywhere else', () => {
    const [, b] = v1Clips(project())
    expect(playheadInto(b!, 0)).toBe(300)
    expect(playheadInto(b!, 299)).toBe(300)
    expect(playheadInto(b!, 420)).toBe(300)
  })

  it('takes the clip pressed, not its group: a sound clip that starts before its picture', () => {
    const p = project()
    const sound = p.audioTracks[0]!.clips[0]!
    const early = { ...sound, timelineStart: 0, sourceIn: 60 }
    expect(playheadInto(early, 150)).toBe(150)
    expect(playheadInto(early, 260)).toBe(0)
  })
})

describe('nextAfterRemoved', () => {
  it('names the next clip on the same track', () => {
    const p = project()
    const [a, b] = v1Clips(p)
    expect(nextAfterRemoved(p, a!.id)).toBe(b!.id)
  })

  it('names the one before when nothing follows', () => {
    const p = project()
    const [a, b] = v1Clips(p)
    expect(nextAfterRemoved(p, b!.id)).toBe(a!.id)
  })

  it('names nothing when the track had only that clip', () => {
    const p = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10)] }, 'a')
    expect(nextAfterRemoved(p, v1Clips(p)[0]!.id)).toBeNull()
  })

  it('never names a clip going with it: a linked sound clip is not the answer', () => {
    const p = project()
    const [a, b] = v1Clips(p)
    // a's sound goes with a, so the picture after it is what is left selected.
    expect(nextAfterRemoved(p, a!.id)).toBe(b!.id)
    // The same clip taken on its own leaves its sound, which is still on another track.
    expect(nextAfterRemoved(p, a!.id, true)).toBe(b!.id)
  })

  it('stays on the track of the clip removed', () => {
    const p = withCutaway()
    const sounds = p.audioTracks[0]!.clips
    expect(nextAfterRemoved(p, sounds[0]!.id, true)).toBe(sounds[1]!.id)
    // The picture on V2 is the only clip there.
    expect(nextAfterRemoved(p, 'p1')).toBeNull()
  })

  it('names nothing for a clip that is not there', () => {
    expect(nextAfterRemoved(project(), 'gone')).toBeNull()
  })

  it('names a clip the removal leaves behind, whether it left a gap or closed up', () => {
    const p = project()
    const [a, b] = v1Clips(p)
    const next = nextAfterRemoved(p, a!.id)
    expect(next).toBe(b!.id)
    // Closing up moves it to where the one taken away began, but it is the same clip.
    expect(findClip(removeClip(p, a!.id), next!)?.clip.timelineStart).toBe(300)
    expect(findClip(closeUpClip(p, a!.id), next!)?.clip.timelineStart).toBe(0)
  })

  it('never names a clip going with it, even one on the same track', () => {
    const p = project()
    const [a, b] = v1Clips(p)
    // Both V1 clips made one group, as a recording's two streams on one audio track are.
    const track = p.videoTracks[0]!
    const linked: Timeline = { ...p, videoTracks: [{ ...track, clips: track.clips.map((c) => ({ ...c, link: 'g1' })) }] }
    expect(nextAfterRemoved(linked, a!.id)).toBeNull()
    expect(nextAfterRemoved(linked, a!.id, true)).toBe(b!.id)
  })
})

describe('what I and O say', () => {
  it('says the playhead is on a cut, where Up and Down leave it, when there is nothing to trim', () => {
    expect(trimToPlayheadRefusal(project(), 300, 'start')).toMatch(/first frame of this clip, so there is nothing before it/)
    expect(trimToPlayheadRefusal(project(), 0, 'end')).toMatch(/first frame of this clip, so trimming its end here would leave nothing/)
  })

  it('says there is no clip there past the end of the sequence', () => {
    expect(trimToPlayheadRefusal(project(), 420, 'start')).toBe('There is no clip under the playhead to trim.')
  })

  it('says how much a trim on V1 took, since the clip keeps its start and can look unchanged', () => {
    const p = project()
    expect(trimToPlayheadWords(p, trimToPlayhead(p, 345, 'start')!)).toBe('Trimmed 1.5 s off the start of this clip, and closed up behind it.')
    expect(trimToPlayheadWords(p, trimToPlayhead(p, 330, 'end')!)).toBe('Trimmed 3.0 s off the end of this clip, and closed up behind it.')
  })

  it('says so for a trim off V1 too, which closes up its own track, and nothing for one alone, which leaves a gap you can see', () => {
    const p = withCutaway()
    const cutaway = p.videoTracks[1]!.clips[0]!.id
    expect(trimToPlayheadWords(p, trimToPlayhead(p, 90, 'start', cutaway)!)).toContain('closed up')
    expect(trimToPlayheadWords(p, trimToPlayhead(p, 90, 'start', cutaway, true)!)).toBeNull()
  })
})
