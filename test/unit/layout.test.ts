import { describe, it, expect } from 'vitest'
import {
  FULL_PLACE,
  placeInPixels,
  placeFromPixels,
  placeAspect,
  fitInPlace,
  isSideBySide,
  viewsOf,
  viewOf,
  cropInView,
  refitInView,
  layoutPlaces,
  layoutPictures,
  placeInNewFrame,
  tidyPlace,
  stretchPlace,
  isFullFrame,
  cropSnapLines
} from '../../src/shared/layout'
import { snapBox } from '../../src/shared/crop-geometry'

// The owner's OBS canvas: two 1920x1080 views side by side.
const OBS = { w: 3840, h: 1080 }
const VERTICAL = { w: 1080, h: 1920 }
const LANDSCAPE = { w: 1920, h: 1080 }
const SQUARE = { w: 1080, h: 1080 }

function inside(inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

describe('places in pixels', () => {
  it('reads a fraction of the frame at any size', () => {
    expect(placeInPixels({ x: 0, y: 0.5, w: 1, h: 0.5 }, 1080, 1920)).toEqual({ x: 0, y: 960, w: 1080, h: 960 })
    expect(placeInPixels({ x: 0.5, y: 0, w: 0.5, h: 1 }, 1920, 1080)).toEqual({ x: 960, y: 0, w: 960, h: 1080 })
  })

  it('lands on even pixels, inside the frame', () => {
    const r = placeInPixels({ x: 2 / 3, y: 0, w: 1 / 3, h: 0.1 }, 1080, 1920)
    for (const n of [r.x, r.y, r.w, r.h]) expect(n % 2).toBe(0)
    expect(r.x + r.w).toBeLessThanOrEqual(1080)
  })

  it('go back to the same fractions', () => {
    const p = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }
    expect(placeFromPixels(placeInPixels(p, 1920, 1080), 1920, 1080)).toEqual(p)
  })

  it('have a shape in the frame they are in', () => {
    expect(placeAspect({ x: 0, y: 0, w: 1, h: 0.5 }, 1080, 1920)).toBeCloseTo(1080 / 960)
    expect(placeAspect(FULL_PLACE, 1920, 1080)).toBeCloseTo(16 / 9)
  })

  it('know the whole frame when they see it', () => {
    expect(isFullFrame(FULL_PLACE)).toBe(true)
    expect(isFullFrame({ x: 0, y: 0, w: 1, h: 0.5 })).toBe(false)
  })
})

describe('fitting a crop in its place', () => {
  it('fills a place of the same shape exactly', () => {
    expect(fitInPlace(1920, 1080, { x: 0, y: 0, w: 960, h: 540 })).toEqual({ x: 0, y: 0, w: 960, h: 540 })
  })

  it('never stretches: a different shape gets black around it, centred', () => {
    const r = fitInPlace(1080, 1080, { x: 0, y: 0, w: 1920, h: 1080 })
    expect(r.w).toBeCloseTo(1080)
    expect(r.h).toBeCloseTo(1080)
    expect(r.x).toBeCloseTo(420)
  })
})

describe('views of a source', () => {
  it('finds two side by side on a canvas three or more times as wide as it is tall', () => {
    expect(isSideBySide(OBS.w, OBS.h)).toBe(true)
    expect(viewsOf(OBS.w, OBS.h)).toEqual([
      { x: 0, y: 0, w: 1920, h: 1080 },
      { x: 1920, y: 0, w: 1920, h: 1080 }
    ])
  })

  it('treats anything narrower as one view', () => {
    expect(isSideBySide(1920, 1080)).toBe(false)
    expect(isSideBySide(2560, 1080)).toBe(false)
    expect(viewsOf(1920, 1080)).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }])
  })

  it('gives a crop each camera’s middle to snap its centre to, and never the seam', () => {
    expect(cropSnapLines(OBS.w, OBS.h)).toEqual({
      edgesX: [0, 1920, 3840],
      centresX: [960, 2880],
      edgesY: [0, 1080],
      centresY: [540]
    })
    // A 608 wide crop dragged so its centre is 5 pixels past the seam stays there.
    const crop = { x: 1925 - 304, y: 0, w: 608, h: 1080 }
    expect(snapBox(crop, cropSnapLines(OBS.w, OBS.h), 16).x).toBe(crop.x)
    // Near the right camera's middle, it is pulled onto it.
    expect(snapBox({ x: 2880 - 304 + 6, y: 0, w: 608, h: 1080 }, cropSnapLines(OBS.w, OBS.h), 16).x).toBe(2880 - 304)
  })

  it('gives a crop of an ordinary recording its middle and edges', () => {
    expect(cropSnapLines(1920, 1080)).toEqual({ edgesX: [0, 1920], centresX: [960], edgesY: [0, 1080], centresY: [540] })
  })

  it('tells which view a crop shows from its centre', () => {
    expect(viewOf({ x: 100, y: 0, w: 600, h: 1080 }, OBS.w, OBS.h).x).toBe(0)
    expect(viewOf({ x: 3000, y: 0, w: 600, h: 1080 }, OBS.w, OBS.h).x).toBe(1920)
  })

  it('takes the largest crop of a shape inside a view, centred on it', () => {
    const r = cropInView({ x: 1920, y: 0, w: 1920, h: 1080 }, 1080 / 960)
    expect(r.h).toBe(1080)
    expect(r.w / r.h).toBeCloseTo(1.125, 2)
    expect(r.x + r.w / 2).toBeCloseTo(1920 + 960, -1)
  })
})

describe('reshaping a crop inside its view', () => {
  it('keeps it in the half it shows, where a plain reshape would spill into the other', () => {
    const crop = { x: 2000, y: 0, w: 960, h: 1080 }
    const r = refitInView(crop, OBS.w, OBS.h, 16 / 9)
    expect(inside(r, { x: 1920, y: 0, w: 1920, h: 1080 })).toBe(true)
    expect(r.w / r.h).toBeCloseTo(16 / 9, 2)
  })

  it('reshapes an ordinary source exactly as before', () => {
    const r = refitInView({ x: 600, y: 0, w: 608, h: 1080 }, 1920, 1080, 1)
    expect(r.h).toBe(1080)
    expect(r.w).toBe(1080)
  })
})

describe('the layouts', () => {
  it('stack Split on a vertical frame, main picture on top', () => {
    expect(layoutPlaces('split', VERTICAL.w, VERTICAL.h, 16 / 9)).toEqual([
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 }
    ])
  })

  it('stack Split on a square frame too', () => {
    expect(layoutPlaces('split', SQUARE.w, SQUARE.h, 16 / 9)[0]).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
  })

  it('put Split side by side on a landscape frame, main picture on the left', () => {
    expect(layoutPlaces('split', LANDSCAPE.w, LANDSCAPE.h, 16 / 9)).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 }
    ])
  })

  it('put the Picture in picture box in the top right corner, a third wide, the shape of its view', () => {
    const [main, box] = layoutPlaces('pip', VERTICAL.w, VERTICAL.h, 16 / 9)
    expect(main).toEqual(FULL_PLACE)
    expect(box!.x + box!.w).toBeCloseTo(1)
    expect(box!.y).toBe(0)
    expect(box!.w).toBeCloseTo(1 / 3)
    expect(placeAspect(box!, VERTICAL.w, VERTICAL.h)).toBeCloseTo(16 / 9)
  })

  it('take the main picture from the left view and the layer from the right on a side by side source', () => {
    const [main, layer] = layoutPictures('split', OBS.w, OBS.h, VERTICAL.w, VERTICAL.h)
    expect(inside(main.crop, { x: 0, y: 0, w: 1920, h: 1080 })).toBe(true)
    expect(inside(layer.crop, { x: 1920, y: 0, w: 1920, h: 1080 })).toBe(true)
  })

  it('fill each box, trimming the sides of the view rather than leaving black bars', () => {
    const [main, layer] = layoutPictures('split', OBS.w, OBS.h, VERTICAL.w, VERTICAL.h)
    for (const p of [main, layer]) {
      expect(p.crop.w / p.crop.h).toBeCloseTo(placeAspect(p.place, VERTICAL.w, VERTICAL.h), 2)
      expect(p.crop.h).toBe(1080)
    }
    // Keeping about the middle 63% of each view's width.
    expect(main.crop.w / 1920).toBeCloseTo(0.63, 1)
  })

  it('start both pictures from the middle of an ordinary source', () => {
    const [main, layer] = layoutPictures('pip', 1920, 1080, VERTICAL.w, VERTICAL.h)
    expect(main.crop.x + main.crop.w / 2).toBeCloseTo(960, -1)
    expect(layer.crop.x + layer.crop.w / 2).toBeCloseTo(960, -1)
  })
})

describe('a place laid out by hand, in a new frame', () => {
  it('keeps filling a frame it filled', () => {
    expect(placeInNewFrame(FULL_PLACE, 1080, 1920, 1920, 1080)).toEqual(FULL_PLACE)
  })

  it('keeps its own shape and its centre, scaled to still fit', () => {
    const box = { x: 0.6, y: 0.1, w: 0.3, h: 0.1 }
    const moved = placeInNewFrame(box, 1080, 1920, 1920, 1080)
    expect(placeAspect(moved, 1920, 1080)).toBeCloseTo(placeAspect(box, 1080, 1920), 3)
    expect(moved.x + moved.w / 2).toBeCloseTo(0.75, 3)
    expect(moved.y + moved.h / 2).toBeCloseTo(0.15, 3)
    expect(moved.x + moved.w).toBeLessThanOrEqual(1)
    expect(moved.y + moved.h).toBeLessThanOrEqual(1)
  })
})

describe('dragging a place', () => {
  it('is kept inside the frame and big enough to grab', () => {
    const p = tidyPlace({ x: 0.95, y: -0.2, w: 0.001, h: 2 }, 1080, 1920)
    expect(p.x + p.w).toBeLessThanOrEqual(1)
    expect(p.y).toBe(0)
    expect(p.h).toBe(1)
    expect(p.w * 1080).toBeGreaterThanOrEqual(32)
  })

  it('stretches one edge and leaves the opposite one where it was', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 }
    expect(stretchPlace(r, 'e', 60, { w: 1080, h: 1920 })).toEqual({ x: 100, y: 100, w: 460, h: 300 })
    expect(stretchPlace(r, 'w', -40, { w: 1080, h: 1920 })).toEqual({ x: 60, y: 100, w: 440, h: 300 })
    expect(stretchPlace(r, 'n', 50, { w: 1080, h: 1920 })).toEqual({ x: 100, y: 150, w: 400, h: 250 })
  })

  it('never stretches past the frame', () => {
    expect(stretchPlace({ x: 900, y: 0, w: 100, h: 100 }, 'e', 500, { w: 1080, h: 1920 }).w).toBe(180)
    expect(stretchPlace({ x: 10, y: 0, w: 100, h: 100 }, 'w', -500, { w: 1080, h: 1920 }).x).toBe(0)
  })
})
