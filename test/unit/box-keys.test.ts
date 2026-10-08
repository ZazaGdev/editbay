import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, findVideoClip, setPlace, setZoomKey, settleZoomKeys, splitClip, type ProjectMedia, type Timeline } from '../../src/shared/project'
import {
  boxAtKeys,
  boxMoves,
  cleanBoxKeys,
  freeCorner,
  moveBoxKey,
  moveOutOfTheWay,
  pinBoxWith,
  removeBoxKey,
  setBoxEase,
  setBoxKey
} from '../../src/shared/box-keys'
import { keysInClip } from '../../src/shared/zoom-edit'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { createProject, withTimeline, FIRST_SEQUENCE_ID } from '../../src/shared/project'

/** Plan 97: a picture's box moving over time. */

const CORNER = { x: 0.62, y: 0.66, w: 0.32, h: 0.18 }

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
    hasAudio: false,
    filmstripPath: ''
  } as unknown as ProjectMedia
}

/** A clip on V1 of a vertical sequence, its main picture as a small box in the lower right. */
function boxed(): Timeline {
  const t = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }, 'a', 'c')
  return setPlace(t, 'c', 'main', CORNER, true)
}

const keysOf = (t: Timeline): NonNullable<ReturnType<typeof findVideoClip>>['clip']['transform']['boxKeys'] => findVideoClip(t, 'c')!.clip.transform.boxKeys

describe('where a box is on a frame', () => {
  const a = { at: 10, place: { x: 0, y: 0, w: 0.2, h: 0.2 } }
  const b = { at: 20, place: { x: 0.5, y: 0.4, w: 0.4, h: 0.2 }, opacity: 0 }

  it('is its own place with no keyframes, and the nearest keyframe outside them', () => {
    expect(boxAtKeys(CORNER, undefined, 5)).toEqual({ place: CORNER, opacity: 1 })
    expect(boxAtKeys(CORNER, [a, b], 0)).toEqual({ place: a.place, opacity: 1 })
    expect(boxAtKeys(CORNER, [a, b], 30)).toEqual({ place: b.place, opacity: 0 })
  })

  it('moves between two by their ease, smooth unless told', () => {
    const half = boxAtKeys(CORNER, [a, b], 15)
    expect(half.place.x).toBeCloseTo(0.25, 9)
    expect(half.opacity).toBeCloseTo(0.5, 9)
    const early = boxAtKeys(CORNER, [a, b], 12)
    // Smooth starts slowly: less than a straight line would be.
    expect(early.place.x).toBeLessThan(0.5 * 0.2)
    expect(boxAtKeys(CORNER, [{ ...a, ease: 'linear' }, b], 12).place.x).toBeCloseTo(0.1, 9)
    expect(boxAtKeys(CORNER, [{ ...a, ease: 'hold' }, b], 19).place.x).toBe(0)
  })

  it('moves only when two keyframes differ', () => {
    expect(boxMoves([a])).toBe(false)
    expect(boxMoves([a, { ...a, at: 30 }])).toBe(false)
    expect(boxMoves([a, b])).toBe(true)
    expect(boxMoves([a, { ...a, at: 30, opacity: 0.5 }])).toBe(true)
  })
})

describe('box keyframes as a file keeps them', () => {
  it('drops what makes no sense, keeps one to a frame, sorted, and full opacity left out', () => {
    expect(cleanBoxKeys(undefined)).toBeUndefined()
    expect(cleanBoxKeys([{ at: 'x' }, { at: 3, place: { x: 0, y: 0, w: 0, h: 1 } }])).toBeUndefined()
    expect(
      cleanBoxKeys([
        { at: 20.4, place: CORNER, opacity: 2 },
        { at: 5, place: CORNER, opacity: 0.25, ease: 'linear' },
        { at: 5, place: { ...CORNER, x: 0 }, ease: 'smooth' }
      ])
    ).toEqual([
      { at: 5, place: { ...CORNER, x: 0 } },
      { at: 20, place: CORNER }
    ])
  })

  it('are saved and read back', () => {
    const t = setBoxKey(setBoxKey(boxed(), 'c', 10, CORNER), 'c', 40, { ...CORNER, x: 0.04 }, 0.5)
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project.sequences[0]!.videoTracks[0]!.clips[0]!
    expect(back.transform.boxKeys).toEqual(keysOf(t))
  })
})

describe('the edits', () => {
  it('pins, moves, eases and takes off a keyframe, inside the clip', () => {
    let t = setBoxKey(boxed(), 'c', 10, CORNER)
    t = setBoxKey(t, 'c', 9999, { ...CORNER, x: 0 })
    expect(keysOf(t)!.map((k) => k.at)).toEqual([10, 299])
    t = setBoxEase(t, 'c', 10, 'linear')
    t = setBoxKey(t, 'c', 10, { ...CORNER, y: 0.1 })
    // A keyframe changed keeps its ease.
    expect(keysOf(t)![0]).toEqual({ at: 10, place: { ...CORNER, y: 0.1 }, ease: 'linear' })
    t = moveBoxKey(t, 'c', 299, 50)
    expect(keysOf(t)!.map((k) => k.at)).toEqual([10, 50])
    t = removeBoxKey(removeBoxKey(t, 'c', 10), 'c', 50)
    expect(keysOf(t)).toBeUndefined()
  })

  it('keeps those a trim or a split can still use, as zoom keyframes are kept', () => {
    let t = setBoxKey(setBoxKey(setBoxKey(boxed(), 'c', 10, CORNER), 'c', 100, { ...CORNER, x: 0 }), 'c', 200, CORNER)
    t = settleZoomKeys(splitClip(t, 150), t)
    const first = t.videoTracks[0]!.clips[0]!
    const second = t.videoTracks[0]!.clips[1]!
    expect(first.transform.boxKeys!.map((k) => k.at)).toEqual([10, 100, 200])
    expect(second.transform.boxKeys!.map((k) => k.at)).toEqual([100, 200])
  })

  it('pins a small box where it is with a zoom keyframe, and a picture filling the frame not at all', () => {
    const t = pinBoxWith(setZoomKey(boxed(), 'c', 30, { x: 0, y: 0, w: 960, h: 540 }), 'c', 30)
    expect(keysOf(t)).toEqual([{ at: 30, place: CORNER }])
    const full = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }, 'a', 'c')
    expect(keysOf(pinBoxWith(full, 'c', 30))).toBeUndefined()
  })

  it('shows its keyframes as diamonds beside the zoom ones', () => {
    const t = setBoxKey(setZoomKey(boxed(), 'c', 30, { x: 0, y: 0, w: 960, h: 540 }), 'c', 60, CORNER)
    expect(keysInClip(findVideoClip(t, 'c')!.clip).map((k) => k.at)).toEqual([30, 60])
  })
})

describe('moving it out of the way', () => {
  it('slides to the corner beside it in a quarter of a second, holds, and comes back', () => {
    const t = moveOutOfTheWay(boxed(), 'c', 30, 90, 'slide')
    const keys = keysOf(t)!
    expect(keys.map((k) => k.at)).toEqual([30, 38, 82, 90])
    expect(keys[0]!.place).toEqual(CORNER)
    expect(keys[3]!.place).toEqual(CORNER)
    // Beside it: the lower left, as far in from the left as it was from the right.
    expect(keys[1]!.place.x).toBeCloseTo(1 - CORNER.x - CORNER.w, 9)
    expect(keys[1]!.place.y).toBeCloseTo(CORNER.y, 9)
    expect(keys[2]!.place).toEqual(keys[1]!.place)
  })

  it('fades out where it is instead, and keeps the keyframes outside the stretch', () => {
    let t = setBoxKey(setBoxKey(boxed(), 'c', 5, CORNER), 'c', 200, CORNER)
    t = setBoxKey(t, 'c', 60, { ...CORNER, x: 0.1 })
    t = moveOutOfTheWay(t, 'c', 40, 80, 'fade')
    const keys = keysOf(t)!
    expect(keys.map((k) => k.at)).toEqual([5, 40, 48, 72, 80, 200])
    expect(keys.map((k) => k.opacity ?? 1)).toEqual([1, 1, 0, 0, 1, 1])
    // It comes back to where it was at the end of the stretch, which the one at 60 was moving it from.
    expect(keys[4]!.place.x).toBeCloseTo(boxAtKeys(CORNER, [{ at: 5, place: CORNER }, { at: 60, place: { ...CORNER, x: 0.1 } }, { at: 200, place: CORNER }], 80).place.x, 9)
  })

  it('goes to another corner when the one beside it is taken', () => {
    const lowerLeft = { x: 0.04, y: 0.66, w: 0.32, h: 0.18 }
    const to = freeCorner(CORNER, [lowerLeft], 1080, 1920)
    expect(to.y).toBeLessThan(0.5)
  })

  it('does nothing over less than three frames', () => {
    expect(keysOf(moveOutOfTheWay(boxed(), 'c', 30, 31, 'slide'))).toBeUndefined()
  })
})
