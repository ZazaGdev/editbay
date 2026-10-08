import { describe, it, expect } from 'vitest'
import {
  addClip,
  closeUpClip,
  createProject,
  createTimeline,
  findClip,
  simpleKeys,
  splitClip,
  v1Clips,
  withTimeline,
  FIRST_SEQUENCE_ID,
  type Clip,
  type ProjectMedia,
  type Rect,
  type Timeline
} from '../../src/shared/project'
import { cropAtKeys } from '../../src/shared/crop-geometry'
import { groupClips, groupedIds, groupPieces, groupRefusal, innerEdge, standIn, ungroupClips } from '../../src/shared/groups'
import { applyClipEdit } from '../../src/main/project/session'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { firstTimeline } from '../project-helpers'

/**
 * Plan 80 (bugs and notes 2, note 29): neighbouring pieces made one clip,
 * keeping the cuts: selected and moved as one, and framed and zoomed as one,
 * so a zoom runs across the cuts without a jump.
 */

function media(id: string, durationSec: number, size = { width: 1920, height: 1080 }): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    ...size,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** One 10 second recording on V1, its sound on A1, cut at 100 and 200 with the middle taken out: two pieces, 0-100 and 200-300 of it. */
function pieces(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10), media('b', 10, { width: 1280, height: 720 })] }
  t = addClip(t, 'a', 'p')
  t = splitClip(t, 100, 'p')
  t = splitClip(t, 200, v1Clips(t)[1]!.id)
  t = closeUpClip(t, v1Clips(t)[1]!.id)
  return t
}

const ids = (t: Timeline): string[] => v1Clips(t).map((c) => c.id)

/** The two pieces grouped as one. */
function grouped(): Timeline {
  const t = pieces()
  return groupClips(t, ids(t), 'g')
}

/** What a picture piece shows on a frame of the sequence. */
function shownAt(c: Clip, frame: number): Rect {
  return cropAtKeys(c.transform.crop, c.transform.keys, c.sourceIn + (frame - c.timelineStart))
}

/** The picture on each frame of the sequence, from whichever piece is there. */
function shown(t: Timeline): Rect[] {
  const clips = v1Clips(t)
  const end = Math.max(...clips.map((c) => c.timelineStart + c.sourceOut - c.sourceIn))
  const out: Rect[] = []
  for (let f = 0; f < end; f++) {
    const c = clips.find((x) => f >= x.timelineStart && f < x.timelineStart + x.sourceOut - x.sourceIn)!
    out.push(shownAt(c, f))
  }
  return out
}

describe('grouping pieces into one clip', () => {
  it('groups two neighbours, their sound with them, and selects them all as one', () => {
    const t = pieces()
    const [a, b] = ids(t)
    expect(groupRefusal(t, [a!])).toMatch(/two or more/)
    const g = groupClips(t, [a!, b!], 'g')
    expect(v1Clips(g).map((c) => c.group)).toEqual(['g', 'g'])
    expect(g.audioTracks[0]!.clips.map((c) => c.group)).toEqual(['g', 'g'])
    expect(new Set(groupedIds(g, a!))).toEqual(new Set([...ids(g), ...g.audioTracks[0]!.clips.map((c) => c.id)]))
    expect(groupPieces(g, g.audioTracks[0]!.clips[1]!.id).map((c) => c.id)).toEqual([a, b])
    // Its only handles are its two ends.
    expect(innerEdge(g, a!, 'start')).toBe(false)
    expect(innerEdge(g, a!, 'end')).toBe(true)
    expect(innerEdge(g, b!, 'start')).toBe(true)
    expect(innerEdge(g, b!, 'end')).toBe(false)
    expect(groupRefusal(g, [a!, b!])).toMatch(/one group already/)
  })

  it('refuses clips that are not side by side on one track', () => {
    let t = pieces()
    t = addClip(t, 'b', 'q')
    const [a, , q] = ids(t)
    expect(groupRefusal(t, [a!, q!])).toMatch(/right next to each other/)
  })

  it('runs a Simple zoom over the whole group, with no jump at the cut', () => {
    const t = grouped()
    const [, b] = ids(t)
    const start = { x: 0, y: 0, w: 608, h: 1080 }
    const end = { x: 656, y: 270, w: 304, h: 540 }
    // Made on the second piece, as the Inspector would with it selected.
    let z = applyClipEdit(t, { kind: 'useSimpleZoom', clipId: b! })
    z = applyClipEdit(z, { kind: 'setSimpleZoom', clipId: b!, change: { start, end, ease: 'linear' } })
    const want = simpleKeys(start, end, 'linear', 0, 200)
    const frames = shown(z)
    expect(frames).toHaveLength(200)
    for (const f of [0, 50, 99, 100, 101, 150, 199]) {
      const expected = cropAtKeys(start, want, f)
      expect(Math.abs(frames[f]!.x - expected.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(frames[f]!.w - expected.w)).toBeLessThanOrEqual(1)
    }
    // No jump at the cut: a frame's worth of movement, as on any other frame.
    expect(Math.abs(frames[100]!.x - frames[99]!.x)).toBeLessThanOrEqual(Math.abs(frames[99]!.x - frames[98]!.x) + 1)
    // The stand in the Inspector reads is one clip, the length of the group, with that zoom.
    const one = standIn(z, b!)!
    expect(one.sourceOut - one.sourceIn).toBe(200)
    expect(one.transform.simple).toBe('linear')
  })

  it('stretches a Simple zoom over the group when its end is trimmed, still ending on End', () => {
    const t = grouped()
    const [a, b] = ids(t)
    const start = { x: 0, y: 0, w: 608, h: 1080 }
    const end = { x: 656, y: 270, w: 304, h: 540 }
    let z = applyClipEdit(t, { kind: 'useSimpleZoom', clipId: a! })
    z = applyClipEdit(z, { kind: 'setSimpleZoom', clipId: a!, change: { start, end, ease: 'linear' } })
    const second = findClip(z, b!)!.clip
    z = applyClipEdit(z, { kind: 'setClipOut', clipId: b!, frame: second.sourceOut - 40 })
    const frames = shown(z)
    expect(frames).toHaveLength(160)
    expect(frames[159]).toEqual(end)
    expect(frames[0]).toEqual(start)
  })

  it('crops every piece at once, from any of them', () => {
    const t = grouped()
    const [, b] = ids(t)
    const rect = { x: 200, y: 100, w: 400, h: 710 }
    const c = applyClipEdit(t, { kind: 'setCrop', clipId: b!, rect })
    const [x, y] = v1Clips(c)
    expect(x!.transform.crop).toEqual(y!.transform.crop)
    expect(x!.transform.crop.w).toBe(y!.transform.crop.w)
  })

  it('gives the pieces back on ungroup, each showing what it did', () => {
    const t = grouped()
    const [a] = ids(t)
    let z = applyClipEdit(t, { kind: 'useSimpleZoom', clipId: a! })
    z = applyClipEdit(z, { kind: 'setSimpleZoom', clipId: a!, change: { start: { x: 0, y: 0, w: 608, h: 1080 }, end: { x: 656, y: 270, w: 304, h: 540 } } })
    const before = shown(z)
    const u = ungroupClips(z, [a!])
    expect(v1Clips(u).every((c) => c.group === undefined && c.groupFrame === undefined)).toBe(true)
    expect(u.audioTracks[0]!.clips.every((c) => c.group === undefined)).toBe(true)
    expect(shown(u)).toEqual(before)
  })

  it('keeps what each piece showed when it is made, when they showed different pictures', () => {
    let t = pieces()
    const [a, b] = ids(t)
    t = applyClipEdit(t, { kind: 'setCrop', clipId: b!, rect: { x: 400, y: 0, w: 608, h: 1080 } })
    const before = shown(t)
    const g = groupClips(t, [a!, b!], 'g')
    expect(shown(g)).toEqual(before)
  })

  it('does not trim at a cut inside it, only at its ends', () => {
    const t = grouped()
    const [a, b] = ids(t)
    const first = findClip(t, a!)!.clip
    expect(applyClipEdit(t, { kind: 'setClipOut', clipId: a!, frame: first.sourceOut - 10 })).toBe(t)
    expect(applyClipEdit(t, { kind: 'setClipIn', clipId: b!, frame: findClip(t, b!)!.clip.sourceIn + 10 })).toBe(t)
    expect(applyClipEdit(t, { kind: 'setClipIn', clipId: a!, frame: first.sourceIn + 10 })).not.toBe(t)
  })

  it('is no group once only one piece is left in it', () => {
    const t = grouped()
    const [, b] = ids(t)
    const after = applyClipEdit(t, { kind: 'removeClip', clipId: b!, alone: true })
    expect(v1Clips(after).map((c) => c.group)).toEqual([undefined])
  })

  it('maps the crop onto a piece of a recording of another size', () => {
    let t = pieces()
    t = addClip(t, 'b', 'q')
    const [, b, q] = ids(t)
    const g = groupClips(t, [b!, q!], 'g')
    const rect = { x: 480, y: 0, w: 608, h: 1080 }
    const c = applyClipEdit(g, { kind: 'setCrop', clipId: b!, rect })
    const piece = findClip(c, q!)!.clip as Clip
    // The same place in a 1280 by 720 recording, the same shape.
    expect(piece.transform.crop.h).toBe(720)
    expect(Math.abs(piece.transform.crop.w / piece.transform.crop.h - 608 / 1080)).toBeLessThan(0.01)
    expect(Math.abs(piece.transform.crop.x + piece.transform.crop.w / 2 - ((480 + 304) * 1280) / 1920)).toBeLessThanOrEqual(2)
  })

  it('keeps its group through saving and opening', () => {
    const t = grouped()
    const p = { ...withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t) }
    const back = firstTimeline(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project)
    expect(v1Clips(back).map((c) => c.group)).toEqual(['g', 'g'])
    expect(v1Clips(back)[0]!.groupFrame).toEqual(v1Clips(t)[0]!.groupFrame)
    expect(back.audioTracks[0]!.clips.map((c) => c.group)).toEqual(['g', 'g'])
  })
})
