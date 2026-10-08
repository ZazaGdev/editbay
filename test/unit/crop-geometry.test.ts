import { describe, it, expect } from 'vitest'
import {
  stretchCrop,
  fitInBox,
  sourceToDisplay,
  displayToSource,
  programLayout,
  largestRectOfAspect,
  moveCrop,
  cropAtEdge,
  linesUnder,
  boxLines,
  joinLines,
  nearestLine,
  safeLines,
  sidesUnder,
  resizeCrop,
  refitCrop,
  MIN_CROP,
  snapBox,
  frameLines,
  type Handle
} from '../../src/shared/crop-geometry'

const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']

describe('fitInBox', () => {
  it('letterboxes a wide source into a square box', () => {
    const fit = fitInBox(1920, 1080, 400, 400)
    expect(fit.scale).toBeCloseTo(400 / 1920)
    expect(fit.width).toBeCloseTo(400)
    expect(fit.height).toBeCloseTo(225)
    expect(fit.offsetX).toBeCloseTo(0)
    expect(fit.offsetY).toBeCloseTo(87.5)
  })

  it('pillarboxes a tall source into a wide box', () => {
    const fit = fitInBox(1080, 1920, 800, 400)
    expect(fit.height).toBeCloseTo(400)
    expect(fit.width).toBeCloseTo(225)
    expect(fit.offsetX).toBeCloseTo(287.5)
    expect(fit.offsetY).toBeCloseTo(0)
  })

  it('survives a degenerate source or box', () => {
    expect(fitInBox(0, 0, 400, 400).scale).toBe(0)
    expect(fitInBox(1920, 1080, 0, 0).scale).toBe(0)
  })
})

describe('sourceToDisplay and displayToSource', () => {
  const fit = fitInBox(1920, 1080, 400, 400)

  it('round trip', () => {
    const rect = { x: 480, y: 0, w: 960, h: 1080 }
    const back = displayToSource(sourceToDisplay(rect, fit), fit)
    expect(back.x).toBeCloseTo(rect.x)
    expect(back.y).toBeCloseTo(rect.y)
    expect(back.w).toBeCloseTo(rect.w)
    expect(back.h).toBeCloseTo(rect.h)
  })

  it('puts the source origin at the letterbox offset', () => {
    const d = sourceToDisplay({ x: 0, y: 0, w: 1920, h: 1080 }, fit)
    expect(d.x).toBeCloseTo(fit.offsetX)
    expect(d.y).toBeCloseTo(fit.offsetY)
    expect(d.w).toBeCloseTo(fit.width)
    expect(d.h).toBeCloseTo(fit.height)
  })

  it('does not divide by zero on a degenerate fit', () => {
    const bad = fitInBox(0, 0, 100, 100)
    expect(displayToSource({ x: 10, y: 10, w: 10, h: 10 }, bad)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('programLayout', () => {
  it('scales the crop to fill the box and positions the video behind it', () => {
    // A 608x1080 vertical slice out of a 1920x1080 frame, shown in a 300x533 box.
    const l = programLayout({ x: 656, y: 0, w: 608, h: 1080 }, 1920, 1080, 300, 533)
    expect(l.cropWidth).toBeCloseTo(300, 0)
    expect(l.cropHeight).toBeCloseTo(533, 0)
    // The video is scaled by the same factor as the crop.
    expect(l.videoWidth / 1920).toBeCloseTo(l.cropWidth / 608, 4)
    // And shifted so the crop's left edge lands at the box's left edge.
    expect(l.videoLeft).toBeCloseTo(-656 * (l.cropWidth / 608), 1)
    expect(l.videoTop).toBeCloseTo(0, 1)
  })

  it('centres a crop that does not fill the box', () => {
    const l = programLayout({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000, 400, 200)
    expect(l.cropHeight).toBeCloseTo(200)
    expect(l.cropWidth).toBeCloseTo(200)
    expect(l.offsetX).toBeCloseTo(100)
    expect(l.offsetY).toBeCloseTo(0)
  })

  it('survives a zero sized crop', () => {
    expect(programLayout({ x: 0, y: 0, w: 0, h: 0 }, 100, 100, 200, 200).videoWidth).toBe(0)
  })
})

describe('largestRectOfAspect', () => {
  it('takes a vertical slice out of a landscape frame', () => {
    const r = largestRectOfAspect(1920, 1080, 1080 / 1920)
    expect(r.h).toBe(1080)
    expect(r.w).toBe(608)
    expect(r.x).toBe(656)
    expect(r.y).toBe(0)
  })

  it('takes a horizontal band out of a portrait frame', () => {
    const r = largestRectOfAspect(1080, 1920, 16 / 9)
    expect(r.w).toBe(1080)
    expect(r.h).toBe(608)
  })

  it('returns the whole frame when the aspects match', () => {
    expect(largestRectOfAspect(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('always returns even numbers', () => {
    const r = largestRectOfAspect(1001, 999, 9 / 16)
    expect(r.w % 2).toBe(0)
    expect(r.h % 2).toBe(0)
    expect(r.x % 2).toBe(0)
    expect(r.y % 2).toBe(0)
  })

  it('never leaves the frame', () => {
    for (const aspect of [9 / 16, 1, 16 / 9, 0.1, 10]) {
      const r = largestRectOfAspect(1920, 1080, aspect)
      expect(r.x + r.w).toBeLessThanOrEqual(1920)
      expect(r.y + r.h).toBeLessThanOrEqual(1080)
      expect(r.w).toBeGreaterThan(0)
      expect(r.h).toBeGreaterThan(0)
    }
  })
})

describe('moveCrop', () => {
  const bounds = { w: 1920, h: 1080 }
  const rect = { x: 100, y: 100, w: 400, h: 400 }

  it('moves by the delta', () => {
    expect(moveCrop(rect, 50, -50, bounds)).toEqual({ x: 150, y: 50, w: 400, h: 400 })
  })

  it('stops at the edges rather than leaving the frame', () => {
    expect(moveCrop(rect, -9999, -9999, bounds)).toEqual({ x: 0, y: 0, w: 400, h: 400 })
    const far = moveCrop(rect, 9999, 9999, bounds)
    expect(far.x + far.w).toBe(1920)
    expect(far.y + far.h).toBe(1080)
  })

  it('snaps to even pixels', () => {
    const r = moveCrop(rect, 3, 5, bounds)
    expect(r.x % 2).toBe(0)
    expect(r.y % 2).toBe(0)
  })

  it('leaves the size alone', () => {
    const r = moveCrop(rect, 33, 47, bounds)
    expect(r.w).toBe(rect.w)
    expect(r.h).toBe(rect.h)
  })
})

describe('resizeCrop', () => {
  const bounds = { w: 1920, h: 1080 }
  const rect = { x: 400, y: 200, w: 600, h: 400 }

  it('grows from the south east corner, keeping the top left fixed', () => {
    const r = resizeCrop(rect, 'se', 100, 50, null, bounds)
    expect(r.x).toBe(400)
    expect(r.y).toBe(200)
    expect(r.w).toBe(700)
    expect(r.h).toBe(450)
  })

  it('grows from the north west corner, keeping the bottom right fixed', () => {
    const r = resizeCrop(rect, 'nw', -100, -50, null, bounds)
    expect(r.x + r.w).toBe(1000)
    expect(r.y + r.h).toBe(600)
    expect(r.w).toBe(700)
    expect(r.h).toBe(450)
  })

  it('handles the other two corners', () => {
    const ne = resizeCrop(rect, 'ne', 100, -50, null, bounds)
    expect(ne.x).toBe(400)
    expect(ne.y + ne.h).toBe(600)
    expect(ne.w).toBe(700)

    const sw = resizeCrop(rect, 'sw', -100, 50, null, bounds)
    expect(sw.x + sw.w).toBe(1000)
    expect(sw.y).toBe(200)
    expect(sw.h).toBe(450)
  })

  it('never leaves the frame', () => {
    for (const handle of HANDLES) {
      for (const [dx, dy] of [
        [9999, 9999],
        [-9999, -9999],
        [9999, -9999],
        [-9999, 9999]
      ]) {
        const r = resizeCrop(rect, handle, dx!, dy!, null, bounds)
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(bounds.w)
        expect(r.y + r.h).toBeLessThanOrEqual(bounds.h)
      }
    }
  })

  it('never collapses below the minimum', () => {
    for (const handle of HANDLES) {
      const r = resizeCrop(rect, handle, -9999, -9999, null, bounds)
      expect(r.w).toBeGreaterThanOrEqual(MIN_CROP)
      expect(r.h).toBeGreaterThanOrEqual(MIN_CROP)
    }
  })

  it('holds the aspect when it is locked', () => {
    const aspect = 9 / 16
    expect(resizeCrop(rect, 'se', 200, 0, aspect, bounds)).toSatisfy((r: typeof rect) => {
      return Math.abs(r.w / r.h - aspect) < 0.02
    })
  })

  it('holds the aspect dragging the other way', () => {
    const aspect = 9 / 16
    const r = resizeCrop(rect, 'se', 0, 200, aspect, bounds)
    expect(r.w / r.h).toBeCloseTo(aspect, 1)
  })

  it('holds the aspect from every corner', () => {
    const aspect = 9 / 16
    for (const handle of HANDLES) {
      const r = resizeCrop(rect, handle, 120, 120, aspect, bounds)
      expect(r.w / r.h).toBeCloseTo(aspect, 1)
    }
  })

  it('keeps the aspect even when the drag would leave the frame', () => {
    const aspect = 9 / 16
    const r = resizeCrop({ x: 0, y: 0, w: 400, h: 700 }, 'se', 9999, 9999, aspect, bounds)
    expect(r.w / r.h).toBeCloseTo(aspect, 1)
    expect(r.x + r.w).toBeLessThanOrEqual(bounds.w)
    expect(r.y + r.h).toBeLessThanOrEqual(bounds.h)
  })

  it('always returns even numbers', () => {
    for (const handle of HANDLES) {
      const r = resizeCrop(rect, handle, 33, 47, null, bounds)
      expect(r.w % 2).toBe(0)
      expect(r.h % 2).toBe(0)
      expect(r.x % 2).toBe(0)
      expect(r.y % 2).toBe(0)
    }
  })

  it('does nothing for a zero drag', () => {
    expect(resizeCrop(rect, 'se', 0, 0, null, bounds)).toEqual(rect)
  })
})

describe('refitCrop', () => {
  const src = { w: 1920, h: 1080 }

  it('keeps the centre of what you framed', () => {
    const crop = { x: 400, y: 0, w: 608, h: 1080 } // vertical slice centred at x=704
    const r = refitCrop(crop, src.w, src.h, 1)
    expect(r.x + r.w / 2).toBeCloseTo(704, -1)
  })

  it('keeps the zoom when the new shape fits at the same height', () => {
    // 9:16 slice, full height, going to square: stays full height.
    const r = refitCrop({ x: 656, y: 0, w: 608, h: 1080 }, src.w, src.h, 1)
    expect(r.h).toBe(1080)
    expect(r.w).toBe(1080)
  })

  it('takes the new shape exactly', () => {
    for (const aspect of [9 / 16, 1, 16 / 9, 4 / 5]) {
      const r = refitCrop({ x: 600, y: 200, w: 400, h: 400 }, src.w, src.h, aspect)
      expect(r.w / r.h).toBeCloseTo(aspect, 1)
    }
  })

  it('shrinks rather than leaving the frame when the new shape is too wide', () => {
    // Full height vertical slice to landscape: cannot stay 1080 tall.
    const r = refitCrop({ x: 656, y: 0, w: 608, h: 1080 }, src.w, src.h, 16 / 9)
    expect(r.w).toBeLessThanOrEqual(1920)
    expect(r.h).toBeLessThanOrEqual(1080)
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1)
  })

  it('slides back inside when the centre is near an edge', () => {
    const r = refitCrop({ x: 1800, y: 0, w: 120, h: 1080 }, src.w, src.h, 1)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(1920)
    expect(r.y + r.h).toBeLessThanOrEqual(1080)
  })

  it('always returns even numbers', () => {
    const r = refitCrop({ x: 333, y: 77, w: 501, h: 403 }, src.w, src.h, 9 / 16)
    for (const n of [r.x, r.y, r.w, r.h]) expect(n % 2).toBe(0)
  })

  it('leaves the crop alone when there is no target shape', () => {
    const crop = { x: 10, y: 20, w: 300, h: 200 }
    expect(refitCrop(crop, src.w, src.h, null)).toEqual(crop)
  })
})

describe('snapBox', () => {
  const lines = frameLines(1080, 1920)

  it('lines a box up with a centre line when its centre is near it', () => {
    const r = snapBox({ x: 335, y: 100, w: 400, h: 300 }, lines, 8)
    expect(r.x + r.w / 2).toBe(540)
  })

  it('lines a box up with an edge by whichever of its own edges is nearer', () => {
    expect(snapBox({ x: 5, y: 500, w: 200, h: 200 }, lines, 8).x).toBe(0)
    expect(snapBox({ x: 874, y: 500, w: 200, h: 200 }, lines, 8).x).toBe(880)
  })

  it('leaves a box alone when no line is near', () => {
    expect(snapBox({ x: 100, y: 500, w: 200, h: 200 }, lines, 8)).toEqual({ x: 100, y: 500, w: 200, h: 200 })
  })

  it('snaps each axis on its own', () => {
    const r = snapBox({ x: 100, y: 857, w: 200, h: 200 }, lines, 8)
    expect(r.x).toBe(100)
    expect(r.y + r.h / 2).toBe(960)
  })

  it('takes the nearest line when two are near', () => {
    // Right edge 3 from 1080, left edge 6 from 540: the right edge wins.
    const edges = { edgesX: [540, 1080], centresX: [], edgesY: [], centresY: [] }
    expect(snapBox({ x: 534, y: 0, w: 543, h: 10 }, edges, 8).x).toBe(537)
  })

  it('lines up edges only with edge lines, and the centre only with centre lines', () => {
    const lines = { edgesX: [1000], centresX: [500], edgesY: [], centresY: [] }
    // Its centre is at 1002, near the edge line: not caught.
    expect(snapBox({ x: 902, y: 0, w: 200, h: 10 }, lines, 8).x).toBe(902)
    // Its left edge is at 497, near the centre line: not caught.
    expect(snapBox({ x: 497, y: 0, w: 200, h: 10 }, lines, 8).x).toBe(497)
    // Its right edge near the edge line, and its centre near the centre line: both caught.
    expect(snapBox({ x: 796, y: 0, w: 200, h: 10 }, lines, 8).x).toBe(800)
    expect(snapBox({ x: 403, y: 0, w: 200, h: 10 }, lines, 8).x).toBe(400)
  })

  it('lets a place in a frame meet the middle with an edge, as the halves of a split do', () => {
    expect(snapBox({ x: 543, y: 0, w: 300, h: 10 }, lines, 8).x).toBe(540)
  })

  it('never changes the size', () => {
    const r = snapBox({ x: 3, y: 3, w: 333, h: 777 }, lines, 8)
    expect([r.w, r.h]).toEqual([333, 777])
  })
})

describe('dragging a side of the crop', () => {
  const bounds = { w: 1920, h: 1080 }
  const crop = { x: 100, y: 100, w: 800, h: 600 }

  it('changes the height alone, keeping the opposite side where it was', () => {
    expect(stretchCrop(crop, 's', 100, bounds)).toEqual({ x: 100, y: 100, w: 800, h: 700 })
    expect(stretchCrop(crop, 'n', 50, bounds)).toEqual({ x: 100, y: 150, w: 800, h: 550 })
  })

  it('changes the width alone the same way', () => {
    expect(stretchCrop(crop, 'e', -200, bounds)).toEqual({ x: 100, y: 100, w: 600, h: 600 })
    expect(stretchCrop(crop, 'w', -100, bounds)).toEqual({ x: 0, y: 100, w: 900, h: 600 })
  })

  it('stays inside the recording, on even pixels, and never shrinks past the least a crop may be', () => {
    expect(stretchCrop(crop, 'e', 5000, bounds).w).toBe(1820)
    expect(stretchCrop(crop, 'n', -5000, bounds)).toMatchObject({ y: 0, h: 700 })
    expect(stretchCrop(crop, 's', -5000, bounds).h).toBe(16)
    expect(stretchCrop(crop, 'e', 33, bounds).w % 2).toBe(0)
  })
})

describe('cropAtEdge', () => {
  const wide = { w: 3840, h: 1080 }
  const rightHalf = { x: 1920, y: 0, w: 1920, h: 1080 }

  it('takes the X typed past the edge, and makes the crop narrower to fit', () => {
    expect(cropAtEdge(rightHalf, 'x', 2000, wide, null)).toEqual({ x: 2000, y: 0, w: 1840, h: 1080 })
  })

  it('takes an X that fits as it is, leaving the size alone', () => {
    expect(cropAtEdge(rightHalf, 'x', 1800, wide, null)).toEqual({ x: 1800, y: 0, w: 1920, h: 1080 })
  })

  it('keeps the shape when locked, shrinking the height with the width', () => {
    const r = cropAtEdge({ x: 0, y: 0, w: 608, h: 1080 }, 'x', 3440, wide, 608 / 1080)
    expect(r.x).toBe(3440)
    expect(r.w).toBe(400)
    expect(Math.abs(r.w / r.h - 608 / 1080)).toBeLessThan(0.01)
  })

  it('does the same for Y and the height', () => {
    expect(cropAtEdge({ x: 0, y: 0, w: 1920, h: 1080 }, 'y', 100, { w: 1920, h: 1080 }, null)).toEqual({ x: 0, y: 100, w: 1920, h: 980 })
  })

  it('keeps an edge inside the recording, to the even pixel', () => {
    expect(cropAtEdge(rightHalf, 'x', 5000, wide, null).x).toBe(3838)
    expect(cropAtEdge(rightHalf, 'x', -40, wide, null).x).toBe(0)
    expect(cropAtEdge(rightHalf, 'x', 1801, wide, null).x % 2).toBe(0)
  })
})

describe('the lines a snapped box shows', () => {
  it('names the frame centre a box is centred on, and nothing when it is on no line', () => {
    const lines = frameLines(1080, 1920)
    expect(linesUnder({ x: 440, y: 900, w: 200, h: 120 }, lines)).toEqual({ x: [540], y: [960] })
    expect(linesUnder({ x: 10, y: 20, w: 200, h: 120 }, lines)).toEqual({ x: [], y: [] })
    // An edge on the frame's edge.
    expect(linesUnder({ x: 0, y: 20, w: 200, h: 120 }, lines).x).toEqual([0])
  })

  it('lines one box up with another on screen, and with the thirds', () => {
    const lines = joinLines(frameLines(1080, 1920), boxLines([{ x: 100, y: 300, w: 400, h: 100 }], 1080, 1920))
    // Dragged near the other box's left edge: snaps to it and shows it.
    const snapped = snapBox({ x: 104, y: 800, w: 200, h: 100 }, lines, 8)
    expect(snapped.x).toBe(100)
    expect(linesUnder(snapped, lines).x).toContain(100)
    // The first third.
    expect(linesUnder({ x: 260, y: 800, w: 200, h: 100 }, lines).x).toContain(360)
  })
})

describe('the lines a resized box snaps to', () => {
  it('finds the nearest line within reach, and none past it', () => {
    expect(nearestLine(353, [0, 360, 540], 8)).toBe(360)
    expect(nearestLine(340, [0, 360, 540], 8)).toBeNull()
    expect(nearestLine(537, [360, 540, 545], 8)).toBe(540)
  })

  it('names only the lines the moved sides are on, not a side held still', () => {
    const lines = frameLines(1080, 1920)
    // The left side sits on the frame's edge, but only the right side was dragged, onto the middle.
    expect(sidesUnder([540], [], lines)).toEqual({ x: [540], y: [] })
    expect(sidesUnder([541], [], lines).x).toEqual([540])
    expect(sidesUnder([600], [], lines)).toEqual({ x: [], y: [] })
  })

  it('lines a side up with the title safe area', () => {
    const lines = joinLines(frameLines(1080, 1920), safeLines({ x: 108, y: 192, w: 864, h: 1536 }))
    expect(nearestLine(112, lines.edgesX, 8)).toBe(108)
    expect(nearestLine(1725, lines.edgesY, 8)).toBe(1728)
    // Its middle is the frame's, so it adds no centre lines of its own.
    expect(safeLines({ x: 108, y: 192, w: 864, h: 1536 }).centresX).toEqual([])
  })
})
