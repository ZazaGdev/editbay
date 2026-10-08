import { describe, it, expect } from 'vitest'
import { addSource, allClips, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { removeStretches } from '../../src/shared/silences'
import type { Transition } from '../../src/shared/transitions'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Every edit that leaves two clips where there was one gives each piece only
 * its own end: the first keeps the transition in, the last the transition out,
 * and no new cut gets one. A copy of the whole clip on both sides put a dip to
 * black at every pause Remove silences took out.
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

const fade: Transition = { kind: 'dip', length: 15, before: 0 }

/** Recording `a` on V1 from 0 with its sound on A1, ten seconds, faded in and out, and a two second `b` beside. */
function faded(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10), media('b', 2)] }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  const withFades = <T extends object>(c: T): T => ({ ...c, transitionIn: fade, transitionOut: fade })
  return {
    ...t,
    videoTracks: t.videoTracks.map((r) => ({ ...r, clips: r.clips.map(withFades) })),
    audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.map(withFades) }))
  }
}

/** Each track's clips in order, as which of the two ends' transitions each has. */
function ends(t: Timeline): string[][] {
  return [...t.videoTracks, ...t.audioTracks]
    .filter((r) => r.clips.length > 0)
    .map((r) =>
      [...r.clips]
        .sort((a, b) => a.timelineStart - b.timelineStart)
        .map((c) => `${c.mediaId}:${c.transitionIn ? 'in' : '-'}/${c.transitionOut ? 'out' : '-'}`)
    )
}

describe('the pieces of a clip cut by an edit', () => {
  it('keep only their own ends when Remove silences takes pauses out', () => {
    const t = removeStretches(faded(), [
      { from: 60, to: 90 },
      { from: 150, to: 180 }
    ])
    expect(allClips(t)).toHaveLength(6)
    expect(ends(t)).toEqual([
      ['a:in/-', 'a:-/-', 'a:-/out'],
      ['a:in/-', 'a:-/-', 'a:-/out']
    ])
  })

  it('keep only their own ends when a clip goes in with Ctrl across the middle', () => {
    const t = applyClipEdit(faded(), { kind: 'addSource', mediaId: 'b', clipId: 'B', at: 100, onTrack: 'v1', insert: true })
    expect(ends(t)).toEqual([
      ['a:in/-', 'b:-/-', 'a:-/out'],
      ['a:in/-', 'b:-/-', 'a:-/out']
    ])
  })

  it('keep only their own ends when a clip is put over the middle', () => {
    // Its sound goes on a track of its own; the sound under it is cut where the picture was, keeping each end's fade.
    const t = addSource(faded(), { mediaId: 'b', clipId: 'B', at: 100, onTrack: 'v1' })
    expect(ends(t)[0]).toEqual(['a:in/-', 'b:-/-', 'a:-/out'])
    expect(ends(t)[1]).toEqual(['a:in/-', 'a:-/-', 'a:-/out'])
  })

  it('keep the fade of the end that is left when a clip is only trimmed by one put over it', () => {
    const t = addSource(faded(), { mediaId: 'b', clipId: 'B', at: 250, onTrack: 'v1' })
    expect(ends(t)[0]).toEqual(['a:in/out', 'b:-/-'])
  })
})
