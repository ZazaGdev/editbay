import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, findVideoClip, splitClip, v1Clips, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { cropsAgree, matchingPicture, withoutPicture } from '../../src/shared/on-selected'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Bugs and notes 2, note 32: a picture moved or cropped on one of several
 * selected clips, moved or cropped the same on the rest, in one edit.
 */

function media(id: string, size = { width: 1920, height: 1080 }): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    ...size,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A recording laid out as a picture in picture, split in three, then a plain clip of another. */
function pieces(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a'), media('b', { width: 1280, height: 720 })] }
  t = addClip(t, 'a', 'p')
  t = applyClipEdit(t, { kind: 'applyLayout', clipId: 'p', layout: 'pip' })
  t = splitClip(t, 100, 'p')
  t = splitClip(t, 200, v1Clips(t)[1]!.id)
  return addClip(t, 'b', 'q')
}

const layerOf = (t: Timeline, id: string): { place: unknown; crop: unknown } | undefined => {
  const c = findVideoClip(t, id)!.clip
  return c.layers[0] ? { place: c.layers[0].place, crop: c.layers[0].crop } : undefined
}

describe('a picture changed on several selected clips', () => {
  it('moves Picture 2 on every selected clip that has it, and leaves the one without it', () => {
    const t = pieces()
    const ids = v1Clips(t).map((c) => c.id)
    const [a, b, c, q] = ids
    const pic = findVideoClip(t, a!)!.clip.layers[0]!.id
    const place = { x: 0.05, y: 0.05, w: 0.4, h: 0.225 }
    const after = applyClipEdit(t, {
      kind: 'onSelected',
      edit: { kind: 'setPlace', clipId: a!, picture: pic, place, reshapeCrop: false },
      also: ids
    })
    for (const id of [a, b, c]) expect(layerOf(after, id!)!.place).toEqual(place)
    expect(findVideoClip(after, q!)!.clip.layers).toEqual([])
    expect(findVideoClip(after, q!)!.clip).toEqual(findVideoClip(t, q!)!.clip)
    expect(withoutPicture(t, a!, pic, ids)).toBe(1)
    // Only the place followed: the crops are each as they were.
    for (const id of [b, c]) expect(layerOf(after, id!)!.crop).toEqual(layerOf(t, id!)!.crop)
  })

  it('crops it the same on every one, as a share of each recording', () => {
    const t = pieces()
    const ids = v1Clips(t).map((c) => c.id)
    const [a, b] = ids
    const pic = findVideoClip(t, a!)!.clip.layers[0]!.id
    const crop = findVideoClip(t, a!)!.clip.layers[0]!.crop
    const tighter = { x: crop.x + 100, y: crop.y + 50, w: crop.w - 200, h: Math.round(((crop.w - 200) * crop.h) / crop.w / 2) * 2 }
    const after = applyClipEdit(t, { kind: 'onSelected', edit: { kind: 'setCrop', clipId: a!, rect: tighter, picture: pic }, also: ids })
    expect(layerOf(after, b!)!.crop).toEqual(layerOf(after, a!)!.crop)
    expect(cropsAgree(after, a!, pic, ids)).toEqual({ x: true, y: true, w: true, h: true })
    expect(cropsAgree(t, a!, pic, ids)).toEqual({ x: true, y: true, w: true, h: true })
  })

  it('says a number differs when the selected clips do not agree on it', () => {
    let t = pieces()
    const [a, b] = v1Clips(t).map((c) => c.id)
    const pic = findVideoClip(t, a!)!.clip.layers[0]!.id
    const crop = findVideoClip(t, b!)!.clip.layers[0]!.crop
    // Half as wide, the same shape, at the left.
    const w = Math.round(crop.w / 4) * 2
    t = applyClipEdit(t, { kind: 'setCrop', clipId: b!, rect: { x: 0, y: crop.y, w, h: Math.round((w * crop.h) / crop.w / 2) * 2 }, picture: pic })
    const agree = cropsAgree(t, a!, pic, [a!, b!])
    expect(agree.w).toBe(false)
    expect(agree.h).toBe(false)
  })

  it('finds the matching picture by id, or by its position among the further pictures', () => {
    const t = pieces()
    const [a] = v1Clips(t).map((c) => c.id)
    const from = findVideoClip(t, a!)!.clip
    const pic = from.layers[0]!.id
    const other = { ...from, id: 'o', layers: from.layers.map((l) => ({ ...l, id: 'other' })) }
    expect(matchingPicture(from, pic, from)).toBe(pic)
    expect(matchingPicture(from, pic, other)).toBe('other')
    expect(matchingPicture(from, pic, { ...other, layers: [] })).toBeNull()
    expect(matchingPicture(from, 'main', { ...other, layers: [] })).toBe('main')
  })
})
