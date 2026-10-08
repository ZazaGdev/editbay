import { describe, it, expect } from 'vitest'
import { fitInBox } from '../../src/shared/crop-geometry'
import { MAX_OUTPUT_ZOOM, MAX_SOURCE_ZOOM, panBy, zoomAt, zoomedFit } from '../../src/shared/source-zoom'

/**
 * Plan 17 step 1: zooming the Source view about the pointer, panning it, and
 * where the zoomed picture sits in the view.
 */

/** A 3840x1080 OBS canvas fitted into an 800x450 view: 800 wide, 225 high, 112.5 down. */
const SOURCE = { w: 3840, h: 1080 }
const VIEW = { width: 800, height: 450 }
const FIT = fitInBox(SOURCE.w, SOURCE.h, VIEW.width, VIEW.height)

/** The source pixel under a point of the view, for a placement. */
function under(f: ReturnType<typeof zoomedFit>, x: number, y: number): [number, number] {
  return [(x - f.offsetX) / f.scale, (y - f.offsetY) / f.scale]
}

describe('where the zoomed picture sits', () => {
  it('is the fitted picture with no zoom, or a zoom of 1', () => {
    expect(zoomedFit(FIT, VIEW, SOURCE, null)).toEqual(FIT)
    expect(zoomedFit(FIT, VIEW, SOURCE, { scale: 1, cx: 100, cy: 100 })).toEqual(FIT)
  })

  it('scales the picture about the pixel asked for, which lands in the middle of the view', () => {
    const f = zoomedFit(FIT, VIEW, SOURCE, { scale: 4, cx: 1920, cy: 540 })
    expect(f.scale).toBeCloseTo(FIT.scale * 4, 9)
    expect(f.width).toBeCloseTo(3200, 6)
    const [x, y] = under(f, 400, 225)
    expect(x).toBeCloseTo(1920, 6)
    expect(y).toBeCloseTo(540, 6)
  })

  it('leaves no empty space inside the view on a side where the picture is bigger than it', () => {
    // Asked to centre the top left corner: the picture's corner stays at the view's corner instead.
    const f = zoomedFit(FIT, VIEW, SOURCE, { scale: 4, cx: 0, cy: 0 })
    expect(f.offsetX).toBe(0)
    expect(f.offsetY).toBe(0)
    const g = zoomedFit(FIT, VIEW, SOURCE, { scale: 4, cx: 3840, cy: 1080 })
    expect(g.offsetX + g.width).toBeCloseTo(800, 6)
    expect(g.offsetY + g.height).toBeCloseTo(450, 6)
  })

  it('centres the picture on a side where it is still smaller than the view', () => {
    // At 1.5 times it is 337.5 high in a view 450 high.
    const f = zoomedFit(FIT, VIEW, SOURCE, { scale: 1.5, cx: 1920, cy: 0 })
    expect(f.height).toBeCloseTo(337.5, 6)
    expect(f.offsetY).toBeCloseTo((450 - 337.5) / 2, 6)
  })

  it('never goes past the most zoom there is', () => {
    expect(zoomedFit(FIT, VIEW, SOURCE, { scale: 50, cx: 1920, cy: 540 }).scale).toBeCloseTo(FIT.scale * MAX_SOURCE_ZOOM, 9)
  })
})

describe('zooming about the pointer', () => {
  it('keeps the source pixel under the pointer where it was', () => {
    // At 4 times the picture is bigger than the view both ways, so nothing is centred.
    const pointer = { x: 200, y: 180 }
    const before = under(FIT, pointer.x, pointer.y)
    const zoom = zoomAt(FIT, VIEW, SOURCE, null, pointer, 4)
    expect(zoom?.scale).toBe(4)
    const after = under(zoomedFit(FIT, VIEW, SOURCE, zoom), pointer.x, pointer.y)
    expect(after[0]).toBeCloseTo(before[0], 6)
    expect(after[1]).toBeCloseTo(before[1], 6)
    // And again, from a zoom already taken.
    const more = zoomAt(FIT, VIEW, SOURCE, zoom, pointer, 1.25)
    const again = under(zoomedFit(FIT, VIEW, SOURCE, more), pointer.x, pointer.y)
    expect(more?.scale).toBe(5)
    expect(again[0]).toBeCloseTo(before[0], 6)
    expect(again[1]).toBeCloseTo(before[1], 6)
  })

  it('keeps the pixel under the pointer across the view while the picture is still shorter than the view, and centres it up and down', () => {
    const pointer = { x: 200, y: 180 }
    const before = under(FIT, pointer.x, pointer.y)
    const f = zoomedFit(FIT, VIEW, SOURCE, zoomAt(FIT, VIEW, SOURCE, null, pointer, 1.5))
    expect(under(f, pointer.x, pointer.y)[0]).toBeCloseTo(before[0], 6)
    expect(f.offsetY).toBeCloseTo((450 - f.height) / 2, 6)
  })

  it('stops at the most zoom there is', () => {
    expect(zoomAt(FIT, VIEW, SOURCE, { scale: 7, cx: 1920, cy: 540 }, { x: 400, y: 225 }, 1.25)?.scale).toBe(MAX_SOURCE_ZOOM)
  })

  it('is no zoom at all once back at 1 or below', () => {
    expect(zoomAt(FIT, VIEW, SOURCE, { scale: 1.25, cx: 1920, cy: 540 }, { x: 400, y: 225 }, 0.8)).toBeNull()
    expect(zoomAt(FIT, VIEW, SOURCE, null, { x: 400, y: 225 }, 0.8)).toBeNull()
  })

  it('does nothing for a picture that has no size yet', () => {
    const none = fitInBox(0, 0, 800, 450)
    expect(zoomAt(none, VIEW, { w: 0, h: 0 }, null, { x: 1, y: 1 }, 2)).toBeNull()
  })
})

describe('panning', () => {
  it('moves the picture with the pointer', () => {
    const zoom = { scale: 4, cx: 1920, cy: 540 }
    const before = zoomedFit(FIT, VIEW, SOURCE, zoom)
    const after = zoomedFit(FIT, VIEW, SOURCE, panBy(FIT, VIEW, SOURCE, zoom, 30, -20))
    expect(after.offsetX - before.offsetX).toBeCloseTo(30, 6)
    expect(after.offsetY - before.offsetY).toBeCloseTo(-20, 6)
  })

  it('stops at the picture\'s edge, and moves back at once from there', () => {
    const zoom = { scale: 4, cx: 1920, cy: 540 }
    const far = panBy(FIT, VIEW, SOURCE, zoom, 100000, 0)
    expect(zoomedFit(FIT, VIEW, SOURCE, far).offsetX).toBe(0)
    // Not a long way past the edge to come back from: 10 pixels back is 10 pixels moved.
    const back = panBy(FIT, VIEW, SOURCE, far, -10, 0)
    expect(zoomedFit(FIT, VIEW, SOURCE, back).offsetX).toBeCloseTo(-10, 6)
  })

  it('does nothing with no zoom', () => {
    expect(panBy(FIT, VIEW, SOURCE, null, 30, 30)).toBeNull()
  })
})

describe('the Output view (task 53)', () => {
  // The whole view is the picture: fitted, it is the view itself.
  const BOX = { width: 800, height: 450 }
  const WHOLE = { scale: 1, width: 800, height: 450, offsetX: 0, offsetY: 0 }
  const SIZE = { w: 800, h: 450 }

  it('stops at its own maximum, below the Source view', () => {
    expect(MAX_OUTPUT_ZOOM).toBeLessThan(MAX_SOURCE_ZOOM)
    const z = zoomAt(WHOLE, BOX, SIZE, null, { x: 400, y: 225 }, 100, MAX_OUTPUT_ZOOM)
    expect(z!.scale).toBe(MAX_OUTPUT_ZOOM)
    expect(zoomedFit(WHOLE, BOX, SIZE, { scale: 10, cx: 400, cy: 225 }, MAX_OUTPUT_ZOOM).width).toBe(800 * MAX_OUTPUT_ZOOM)
  })

  it('keeps the point under the pointer where it is', () => {
    const z = zoomAt(WHOLE, BOX, SIZE, null, { x: 200, y: 100 }, 2, MAX_OUTPUT_ZOOM)
    const f = zoomedFit(WHOLE, BOX, SIZE, z, MAX_OUTPUT_ZOOM)
    expect(under(f, 200, 100)[0]).toBeCloseTo(200)
    expect(under(f, 200, 100)[1]).toBeCloseTo(100)
  })

  it('pans no further than its edges', () => {
    const z = { scale: 2, cx: 400, cy: 225 }
    const f = zoomedFit(WHOLE, BOX, SIZE, panBy(WHOLE, BOX, SIZE, z, 5000, 5000, MAX_OUTPUT_ZOOM), MAX_OUTPUT_ZOOM)
    expect(f.offsetX).toBe(0)
    expect(f.offsetY).toBe(0)
  })
})
