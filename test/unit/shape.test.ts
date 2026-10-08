import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_SHAPES,
  bodyWithin,
  cleanSavedShapes,
  cleanShapeStyle,
  linePoints,
  lineThrough,
  nextShapeName,
  pictureAround,
  pictureSize,
  removeShape,
  resizedShape,
  saveShape,
  drawOnFrames,
  outlineLength,
  shapeFromDrag,
  shapeFromPath,
  simplifyPath,
  shapeKey,
  shapeMargin,
  shapeName,
  type ShapeStyle
} from '../../src/shared/shape'
import { textKey, DEFAULT_TEXT } from '../../src/shared/text'
import { copyClips, pasteClips } from '../../src/shared/clipboard'
import { addClip, addShapeTo, animationFrame, createProject, editSequence, findClip, findVideoClip, framePath, setShapeOn, timelineOf, type Project, type ProjectMedia } from '../../src/shared/project'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { S1 } from '../project-helpers'

/** Plan 83: shapes over the picture, drawn by the window as a text is. */

const built = (id: string): ShapeStyle => BUILT_IN_SHAPES.find((s) => s.id === id)!.style
const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 0)
  expect(a.y).toBeCloseTo(b.y, 0)
}

describe('a shape drawn by a drag', () => {
  it('is an arrow from where the drag began to where it ended', () => {
    const { style, body } = shapeFromDrag(built('arrow'), { x: 300, y: 600 }, { x: 700, y: 1000 })
    expect(body).toEqual({ x: 300, y: 600, w: 400, h: 400 })
    const pts = linePoints(style, body)
    near(pts.from, { x: 300, y: 600 })
    near(pts.to, { x: 700, y: 1000 })
    expect(pts.bend).toBeNull()
    expect(shapeName(style)).toBe('Arrow')
  })

  it('bends a curved arrow to one side, with the whole curve inside its body', () => {
    const { style, body } = shapeFromDrag(built('curved-arrow'), { x: 100, y: 100 }, { x: 500, y: 100 }, 0.25)
    const pts = linePoints(style, body)
    expect(pts.bend).not.toBeNull()
    // Pulled off the line by a quarter of its length, and the body taller to hold it.
    expect(Math.abs(pts.bend!.y - 100)).toBeCloseTo(100, 0)
    expect(body.h).toBeCloseTo(100, 0)
    expect(shapeName(style)).toBe('Curved arrow')
  })

  it('is a box with the two points as its corners, whichever way it was dragged', () => {
    const { style, body } = shapeFromDrag(built('box'), { x: 500, y: 500 }, { x: 100, y: 200 })
    expect(body).toEqual({ x: 100, y: 200, w: 400, h: 300 })
    expect([style.width, style.height]).toEqual([400, 300])
  })

  it('is a usable size from a click with no drag', () => {
    const box = shapeFromDrag(built('circle'), { x: 540, y: 960 }, { x: 541, y: 961 })
    expect([box.style.width, box.style.height]).toEqual([300, 300])
    const arrow = shapeFromDrag(built('arrow'), { x: 540, y: 960 }, { x: 540, y: 960 })
    near(linePoints(arrow.style, arrow.body).to, { x: 540, y: 960 })
  })

  it('never has a body thinner than 2, even for a level line', () => {
    const { style } = lineThrough(built('line'), { x: 0, y: 50 }, { x: 300, y: 50 }, null)
    expect(style.height).toBe(2)
  })
})

describe("a shape's picture", () => {
  it('has room round its body for its outline, arrowheads and shadow, and the body sits in its middle', () => {
    const arrow = cleanShapeStyle({ ...built('arrow'), strokeWidth: 10, width: 400, height: 400 })
    const m = shapeMargin(arrow)
    expect(m).toBeGreaterThan(20)
    const size = pictureSize(arrow)
    expect(size.width).toBeGreaterThanOrEqual(400 + 2 * m)
    expect(size.width % 2).toBe(0)
    const body = { x: 300, y: 600, w: 400, h: 400 }
    const picture = pictureAround(arrow, body)
    near({ x: picture.x + picture.w / 2, y: picture.y + picture.h / 2 }, { x: 500, y: 800 })
    const back = bodyWithin(arrow, picture)
    expect(back.x).toBeCloseTo(300, 5)
    expect(back.w).toBeCloseTo(400, 5)
  })

  it('grows its body, not its outline, when its box is made larger', () => {
    const box = cleanShapeStyle({ ...built('box'), width: 300, height: 200 })
    const size = pictureSize(box)
    const larger = resizedShape(box, size.width + 100, size.height + 50)
    expect([larger.width, larger.height]).toEqual([400, 250])
    expect(larger.strokeWidth).toBe(box.strokeWidth)
  })

  it('is kept under a name of its own, never one a text could have', () => {
    const a = built('arrow')
    expect(shapeKey(a)).toMatch(/^[0-9a-f]{16}$/)
    expect(shapeKey(a)).toBe(shapeKey({ ...a }))
    expect(shapeKey(a)).not.toBe(shapeKey({ ...a, strokeWidth: 12 }))
    expect(shapeKey(a)).not.toBe(textKey(DEFAULT_TEXT))
  })

  it('is made safe when read back damaged', () => {
    const s = cleanShapeStyle({ kind: 'spiral', stroke: 'red', strokeWidth: 900, width: -3, from: { x: 4 } })
    expect(s.kind).toBe('box')
    expect(s.stroke).toBe('#ff3b30')
    expect(s.strokeWidth).toBe(60)
    expect(s.width).toBe(2)
    // Arrowheads and fill belong to lines and boxes only.
    expect(cleanShapeStyle({ kind: 'box', endHead: true }).endHead).toBe(false)
    expect(cleanShapeStyle({ kind: 'line', fill: '#ffffff' }).fill).toBeNull()
  })
})

describe('your own shape styles', () => {
  it('are saved under a name, replaced by one of the same name, and removed', () => {
    let list = saveShape([], 'Red arrow', built('arrow'), 'a')
    list = saveShape(list, '  red   ARROW ', { ...built('arrow'), strokeWidth: 20 }, 'b')
    expect(list).toHaveLength(1)
    expect(list[0]!.style.strokeWidth).toBe(20)
    list = saveShape(list, 'Yellow box', built('highlight'), 'c')
    expect(list.map((s) => s.name)).toEqual(['Red arrow', 'Yellow box'])
    expect(removeShape(list, 'a').map((s) => s.name)).toEqual(['Yellow box'])
  })

  it('are offered a name by their kind, numbered past those taken', () => {
    const list = saveShape([], 'My arrow', built('arrow'), 'a')
    expect(nextShapeName(list, built('arrow'))).toBe('My arrow 2')
    expect(nextShapeName(list, built('circle'))).toBe('My circle')
  })

  it('drop what is damaged when read from the settings', () => {
    expect(cleanSavedShapes([{ id: 'a', name: 'Ok', style: built('box') }, { id: 'a', name: 'Twin' }, { name: 'No id' }, 'x']).map((s) => s.name)).toEqual(['Ok'])
    expect(cleanSavedShapes('lots')).toEqual([])
  })
})

function recording(id: string): ProjectMedia {
  return {
    id, originalPath: `C:/v/${id}.mp4`, playablePath: `C:/v/${id}.mp4`, conformed: false, conformReasons: [],
    durationSec: 10, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, peaksPath: '', filmstripPath: ''
  }
}

describe('a shape on the timeline', () => {
  const drawnFor = (style: ShapeStyle) => {
    const size = pictureSize(style)
    return { path: `C:/cache/text/${shapeKey(style)}.png`, width: size.width, height: size.height }
  }
  const withArrow = (): Project => {
    const p = editSequence({ ...createProject('t', 30, { width: 1080, height: 1920 }), media: [recording('rec')] }, S1, (t) => addClip(t, 'rec', 'r'))
    const { style, body } = shapeFromDrag(built('arrow'), { x: 300, y: 600 }, { x: 700, y: 1000 })
    const pic = pictureAround(style, body)
    const place = { x: pic.x / 1080, y: pic.y / 1920, w: pic.w / 1080, h: pic.h / 1920 }
    return addShapeTo(p, S1, { mediaId: 'arrow', clipId: 'a', at: 30, style, drawn: drawnFor(style), place })
  }

  it('lands above V1 at the playhead, five seconds long, where it was drawn', () => {
    const p = withArrow()
    const found = findVideoClip(timelineOf(p, S1), 'a')!
    expect(found.index).toBe(1)
    expect(found.clip.timelineStart).toBe(30)
    expect(found.clip.sourceOut - found.clip.sourceIn).toBe(150)
    const place = found.clip.transform.place
    expect((place.x + place.w / 2) * 1080).toBeCloseTo(500, 0)
    expect((place.y + place.h / 2) * 1920).toBeCloseTo(800, 0)
    expect(p.media.find((m) => m.id === 'arrow')!.codec).toBe('shape')
  })

  it('stays centred where it was when its outline is made wider, and goes exactly where told when its ends move', () => {
    let p = withArrow()
    const m = p.media.find((x) => x.id === 'arrow')!
    const wider = { ...m.shape!, strokeWidth: 30 }
    p = setShapeOn(p, 'arrow', wider, drawnFor(wider))
    const place = findVideoClip(timelineOf(p, S1), 'a')!.clip.transform.place
    expect((place.x + place.w / 2) * 1080).toBeCloseTo(500, 0)
    expect(place.w * 1080).toBeCloseTo(pictureSize(cleanShapeStyle(wider)).width, 0)
    const there = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
    p = setShapeOn(p, 'arrow', wider, drawnFor(wider), { clipId: 'a', place: there })
    expect(findVideoClip(timelineOf(p, S1), 'a')!.clip.transform.place).toMatchObject(there)
  })

  it('is its own shape when pasted, so changing the copy leaves the first as it was', () => {
    const p = withArrow()
    const copied = copyClips(timelineOf(p, S1), ['a'])!
    const { project: after, placed } = pasteClips(p, S1, copied, 400, () => `n${Math.random()}`)
    const pasted = findClip(timelineOf(after, S1), placed[0]!)!.clip
    expect(pasted.mediaId).not.toBe('arrow')
    expect(after.media.find((m) => m.id === pasted.mediaId)!.shape).toEqual(after.media.find((m) => m.id === 'arrow')!.shape)
  })

  it('is read back from a saved project, a damaged one still drawable', () => {
    const p = withArrow()
    const saved = JSON.parse(joinProjectFile(p, defaultWorkspace()))
    const read = splitProjectFile(JSON.stringify(saved)).project
    expect(read.media.find((m) => m.id === 'arrow')!.shape).toEqual(p.media.find((m) => m.id === 'arrow')!.shape)
    saved.media.find((m: { id: string }) => m.id === 'arrow').shape = { kind: 'line', stroke: 42 }
    const damaged = splitProjectFile(JSON.stringify(saved)).project.media.find((m) => m.id === 'arrow')!
    expect(damaged.shape!.kind).toBe('line')
    expect(damaged.shape!.stroke).toBe('#ff3b30')
  })
})

describe('drawing by hand and drawing on (plan 88)', () => {
  const pen = BUILT_IN_SHAPES.find((s) => s.id === 'pen')!.style
  const highlighter = BUILT_IN_SHAPES.find((s) => s.id === 'highlighter')!.style

  it('makes a pen stroke of the path the pointer took, simplified, inside its body', () => {
    const path = Array.from({ length: 200 }, (_, i) => ({ x: 100 + i, y: 300 + Math.round(40 * Math.sin(i / 20)) }))
    const made = shapeFromPath(pen, path)
    expect(made.style.kind).toBe('pen')
    expect(made.body.x).toBe(100)
    expect(made.style.points!.length).toBeLessThan(200)
    expect(made.style.points!.length).toBeGreaterThan(5)
    for (const p of made.style.points!) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
    }
    // A straight run keeps only its ends.
    expect(simplifyPath([{ x: 0, y: 0 }, { x: 5, y: 0.2 }, { x: 10, y: 0 }], 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }])
  })

  it('keeps a pen stroke, its see-through outline and its draw on through a save, and leaves out what is not there', () => {
    const kept = cleanShapeStyle({ ...highlighter, points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }], drawOn: 1 })
    expect(kept).toMatchObject({ kind: 'pen', strokeOpacity: 0.45, drawOn: 1, fill: null, startHead: false })
    expect(kept.points).toHaveLength(2)
    // A box keeps none of them, so its picture keeps the name it had.
    const box = cleanShapeStyle({ kind: 'box' })
    expect('points' in box || 'strokeOpacity' in box || 'drawOn' in box).toBe(false)
    expect(cleanShapeStyle({ ...pen, points: 'no', drawOn: 99 })).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], drawOn: 10 })
    expect(shapeName(kept)).toBe('Highlighter')
    expect(shapeName(cleanShapeStyle(pen))).toBe('Pen')
  })

  it('measures an outline to draw part of it, and draws one on at 30 pictures a second', () => {
    expect(outlineLength(cleanShapeStyle({ kind: 'line', width: 300, height: 400, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }))).toBeCloseTo(500, 6)
    expect(outlineLength(cleanShapeStyle({ kind: 'box', width: 100, height: 50 }))).toBe(300)
    expect(outlineLength(cleanShapeStyle({ kind: 'ellipse', width: 100, height: 100 }))).toBeCloseTo(Math.PI * 100, 3)
    expect(drawOnFrames({})).toBe(1)
    expect(drawOnFrames({ drawOn: 1 })).toBe(30)
  })

  it('is a run of pictures played once, its last held, when drawn on', () => {
    let p: Project = createProject('t', 30, { width: 1080, height: 1920 })
    p = addShapeTo(p, S1, {
      mediaId: 's',
      clipId: 'c',
      at: 0,
      style: { ...pen, drawOn: 1 },
      drawn: { path: 'C:/cache/text/0123456789abcdef-0001.png', width: 100, height: 60, frames: 30, frameRate: 30 },
      place: { x: 0.1, y: 0.1, w: 0.1, h: 0.03 }
    })
    const m = p.media[0]!
    expect([m.frames, m.frameRate, m.once]).toEqual([30, 30, true])
    // Counted from where its clip lands in the picture's long stretch.
    const from = findVideoClip(timelineOf(p, S1), 'c')!.clip.sourceIn
    expect(animationFrame(m, from + 15, 30)).toBe(15)
    expect(animationFrame(m, from + 29, 30)).toBe(29)
    // Held, rather than starting again.
    expect(animationFrame(m, from + 31, 30)).toBe(29)
    expect(animationFrame(m, from + 300, 30)).toBe(29)
    expect(framePath(m, 29)).toBe('C:/cache/text/0123456789abcdef-0030.png')
  })
})
