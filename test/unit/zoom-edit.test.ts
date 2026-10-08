import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, findVideoClip, setZoomKeys, type Clip, type ProjectMedia, type Timeline } from '../../src/shared/project'
import {
  EASE_NAMES,
  cropAtPlayhead,
  keyAtPlayhead,
  cropEdit,
  keyDraggedTo,
  keyMarks,
  neighbourKey,
  pastOwnPixels,
  scaleOf,
  sourceFrameAt,
  toggleKeyEdit,
  withCentre,
  withScale
} from '../../src/shared/zoom-edit'
import { EASES } from '../../src/shared/project'
import { ACTIONS, resolveKeymap } from '../../src/shared/keymap'

/**
 * Plan 60, stages 2 and 3: what the Zoom group, the crop box and the keys
 * work out from a clip and the playhead, and the edit each sends.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
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

/** A ten second recording on V1 of a vertical sequence from frame 30, its first second trimmed off. */
function one(): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  const added = addClip({ ...t, media: [media('a')] }, 'a', 'c')
  return {
    ...added,
    videoTracks: added.videoTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, sourceIn: 30, timelineStart: 30 })) }))
  }
}

const clip = (t: Timeline): Clip => findVideoClip(t, 'c')!.clip

describe('the frame under the playhead', () => {
  it('is the frame of the recording there, held inside the clip', () => {
    const c = clip(one())
    expect(sourceFrameAt(c, 30)).toBe(30)
    expect(sourceFrameAt(c, 90)).toBe(90)
    expect(sourceFrameAt(c, 0)).toBe(30)
    expect(sourceFrameAt(c, 10_000)).toBe(c.sourceOut - 1)
  })
})

describe('an edit of the main crop at the playhead', () => {
  it('frames the whole clip while it has no keyframes', () => {
    const c = clip(one())
    const rect = { x: 700, y: 0, w: 606, h: 1080 }
    expect(cropEdit(c, 60, rect)).toEqual({ kind: 'setCrop', clipId: 'c', rect, picture: 'main' })
  })

  it('changes the keyframe on the frame under the playhead once it has some', () => {
    const t = setZoomKeys(one(), 'c', [{ at: 60, crop: clip(one()).transform.crop }])
    const rect = { x: 700, y: 0, w: 606, h: 1080 }
    expect(cropEdit(clip(t), 100, rect)).toEqual({ kind: 'setZoomKey', clipId: 'c', at: 100, crop: rect })
  })
})

describe('the diamond', () => {
  it('pins the framing at the playhead, and takes it off again', () => {
    const t = one()
    const add = toggleKeyEdit(clip(t), 60)
    expect(add).toEqual({ kind: 'setZoomKey', clipId: 'c', at: 60, crop: clip(t).transform.crop })
    const keyed = setZoomKeys(t, 'c', [{ at: 60, crop: clip(t).transform.crop }])
    expect(keyAtPlayhead(clip(keyed), 60)).toBeTruthy()
    expect(toggleKeyEdit(clip(keyed), 60)).toEqual({ kind: 'removeZoomKey', clipId: 'c', at: 60 })
  })

  it('does nothing with the playhead off the clip', () => {
    expect(toggleKeyEdit(clip(one()), 10)).toBeNull()
  })

  it('pins what the picture shows there, between two keyframes', () => {
    const start = clip(one()).transform.crop
    const closer = { x: 686, y: 54, w: 548, h: 972 }
    const t = setZoomKeys(one(), 'c', [
      { at: 60, crop: start },
      { at: 90, crop: closer, ease: 'linear' }
    ])
    const edit = toggleKeyEdit(clip(t), 75)
    expect(edit).toMatchObject({ kind: 'setZoomKey', at: 75 })
    expect(edit && 'crop' in edit ? edit.crop : null).toEqual(cropAtPlayhead(clip(t), 75))
  })
})

describe('the arrows', () => {
  it('go to the keyframe before and after the playhead, as frames of the sequence', () => {
    const start = clip(one()).transform.crop
    // Frames 60 and 120 of the recording, on a clip that starts at its frame 30 on frame 30: frames 60 and 120 of the sequence too.
    const t = setZoomKeys(one(), 'c', [
      { at: 60, crop: start },
      { at: 120, crop: start }
    ])
    const c = clip(t)
    expect(neighbourKey(c, 30, 'previous')).toBeNull()
    expect(neighbourKey(c, 30, 'next')).toBe(60)
    expect(neighbourKey(c, 60, 'next')).toBe(120)
    expect(neighbourKey(c, 90, 'previous')).toBe(60)
    expect(neighbourKey(c, 120, 'next')).toBeNull()
  })
})

describe('Scale and Position', () => {
  const full = { x: 656, y: 0, w: 608, h: 1080 }

  it('reads 100% for the largest crop of its shape, and 200% for half as wide', () => {
    expect(scaleOf(full, 1920, 1080)).toBeCloseTo(100, 0)
    expect(scaleOf({ x: 808, y: 270, w: 304, h: 540 }, 1920, 1080)).toBeCloseTo(200, 0)
  })

  it('builds the crop around the same centre, stopping at 100% and 400%', () => {
    const at130 = withScale(full, 130, 1920, 1080)
    expect(scaleOf(at130, 1920, 1080)).toBeCloseTo(130, 0)
    expect(at130.x + at130.w / 2).toBeCloseTo(960, 0)
    expect(at130.y + at130.h / 2).toBeCloseTo(540, 0)
    expect(scaleOf(withScale(full, 50, 1920, 1080), 1920, 1080)).toBeCloseTo(100, 0)
    expect(scaleOf(withScale(full, 1000, 1920, 1080), 1920, 1080)).toBeCloseTo(400, 0)
  })

  it('moves the centre, kept inside the recording', () => {
    const small = withScale(full, 200, 1920, 1080)
    const moved = withCentre(small, 400, 300, 1920, 1080)
    expect(moved.x + moved.w / 2).toBeCloseTo(400, 0)
    expect(moved.y + moved.h / 2).toBeCloseTo(300, 0)
    const edge = withCentre(small, 10, 10, 1920, 1080)
    expect(edge.x).toBe(0)
    expect(edge.y).toBe(0)
  })

  it('says a crop is past its own pixels when its place is wider in the frame than it is', () => {
    const place = { x: 0, y: 0, w: 1, h: 1 }
    expect(pastOwnPixels({ x: 0, y: 0, w: 1080, h: 1920 }, place, 1080)).toBe(false)
    expect(pastOwnPixels({ x: 0, y: 0, w: 830, h: 1476 }, place, 1080)).toBe(true)
  })
})

describe('the words and the keys', () => {
  it('names every ease once, in plain words, with what Premiere calls it', () => {
    expect(EASE_NAMES.map((n) => n.ease).sort()).toEqual([...EASES].sort())
    expect(EASE_NAMES.map((n) => n.label)).toEqual(['Smooth', 'Steady', 'Starts slowly', 'Ends slowly', 'Jump'])
    for (const n of EASE_NAMES) expect(n.title).toMatch(/Premiere calls this/)
  })

  it('puts the keyframe actions on Alt+K and Alt with the brackets', () => {
    const map = resolveKeymap({})
    expect(map.toggleZoomKey).toEqual(['Alt+KeyK'])
    expect(map.previousZoomKey).toEqual(['Alt+BracketLeft'])
    expect(map.nextZoomKey).toEqual(['Alt+BracketRight'])
    expect(ACTIONS.filter((a) => a.defaults.some((d) => ['Alt+KeyK', 'Alt+BracketLeft', 'Alt+BracketRight'].includes(d)))).toHaveLength(3)
  })
})

describe('the zoom marked on a clip on the timeline (bugs and notes 2, note 15)', () => {
  it('merges keyframes closer on screen than a diamond into one mark, counting them', () => {
    expect(keyMarks([10, 11, 40, 100], 1, 9)).toEqual([
      { at: 10, count: 2 },
      { at: 40, count: 1 },
      { at: 100, count: 1 }
    ])
    // Zoomed in far enough, every one is its own.
    expect(keyMarks([10, 11], 10, 9)).toEqual([
      { at: 10, count: 1 },
      { at: 11, count: 1 }
    ])
  })

  it('moves a dragged keyframe by the frames dragged over, never off the clip', () => {
    const c = { sourceIn: 100, sourceOut: 200 }
    expect(keyDraggedTo(c, 150, 24, 2)).toBe(162)
    expect(keyDraggedTo(c, 150, -11, 2)).toBe(145)
    expect(keyDraggedTo(c, 150, -500, 2)).toBe(100)
    expect(keyDraggedTo(c, 150, 500, 2)).toBe(199)
  })
})
