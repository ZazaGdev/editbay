import { describe, it, expect } from 'vitest'
import { filmstripLayout, stripTiles, tileFit, tileIndexForTime, tileHeight, tileRect } from '../../src/shared/filmstrip'

describe('tileIndexForTime', () => {
  const layout = filmstripLayout(100)

  it('maps the start and end of the clip to the first and last tile', () => {
    expect(tileIndexForTime(layout, 0, 100)).toBe(0)
    expect(tileIndexForTime(layout, 99.999, 100)).toBe(layout.tileCount - 1)
  })

  it('maps the middle to the middle', () => {
    expect(tileIndexForTime(layout, 50, 100)).toBeCloseTo(layout.tileCount / 2, 0)
  })

  it('clamps rather than going out of range', () => {
    expect(tileIndexForTime(layout, -10, 100)).toBe(0)
    expect(tileIndexForTime(layout, 500, 100)).toBe(layout.tileCount - 1)
  })

  it('survives a zero length clip', () => {
    expect(tileIndexForTime(layout, 0, 0)).toBe(0)
    expect(tileIndexForTime(layout, 5, -1)).toBe(0)
  })
})

describe('tileHeight', () => {
  it('keeps the source aspect and lands on an even number, as ffmpeg does', () => {
    expect(tileHeight(160, 1920, 1080)).toBe(90)
    expect(tileHeight(160, 1080, 1920)).toBe(284)
  })

  it('never returns zero for a degenerate source', () => {
    expect(tileHeight(160, 0, 0)).toBeGreaterThan(0)
    expect(tileHeight(160, 100, 0)).toBeGreaterThan(0)
  })
})

describe('tileRect', () => {
  const layout = filmstripLayout(16)
  const h = tileHeight(layout.tileWidth, 1920, 1080)

  it('walks the grid left to right, then down', () => {
    expect(tileRect(layout, 0, h)).toEqual({ x: 0, y: 0, w: layout.tileWidth, h })
    expect(tileRect(layout, 1, h).x).toBe(layout.tileWidth)
    expect(tileRect(layout, layout.cols, h)).toEqual({ x: 0, y: h, w: layout.tileWidth, h })
  })

  it('clamps an index past the last tile', () => {
    expect(tileRect(layout, 9999, h).y).toBe((layout.rows - 1) * h)
  })

  it('clamps a negative index', () => {
    expect(tileRect(layout, -5, h)).toEqual({ x: 0, y: 0, w: layout.tileWidth, h })
  })
})

describe('filmstripLayout', () => {
  it('still behaves as the extraction step expects', () => {
    const l = filmstripLayout(600)
    expect(l.cols * l.rows).toBeGreaterThanOrEqual(l.tileCount)
    expect(l.tileCount).toBeLessThanOrEqual(100)
    expect(l.cols * l.tileWidth).toBeLessThanOrEqual(4096)
  })
})

describe('stripTiles', () => {
  const layout = filmstripLayout(600)

  it('fills the strip with as many tiles as fit', () => {
    expect(stripTiles(layout, 600, 800, 80)).toHaveLength(10)
  })

  it('starts at the beginning of the recording and reaches its last stretch', () => {
    const tiles = stripTiles(layout, 600, 800, 80)
    expect(tiles[0]).toBe(0)
    // Ten tiles across the whole of it, so the last stands for its final tenth.
    expect(tiles[tiles.length - 1]).toBeGreaterThanOrEqual(layout.tileCount * 0.9 - 1)
  })

  it('reads a tile as the frame at its own left edge, so the strip is a ruler', () => {
    const tiles = stripTiles(layout, 600, 800, 80)
    tiles.forEach((tile, i) => expect(tile).toBe(tileIndexForTime(layout, (i / tiles.length) * 600, 600)))
  })

  it('walks forwards and never goes back', () => {
    const tiles = stripTiles(layout, 600, 1600, 80)
    for (let i = 1; i < tiles.length; i++) expect(tiles[i]!).toBeGreaterThanOrEqual(tiles[i - 1]!)
  })

  it('never asks for more tiles than the sheet holds', () => {
    const short = filmstripLayout(3)
    expect(stripTiles(short, 3, 1900, 80).length).toBeLessThanOrEqual(short.tileCount)
  })

  it('draws nothing before the strip has been measured', () => {
    expect(stripTiles(layout, 600, 0, 80)).toEqual([])
    expect(stripTiles(layout, 600, 800, 0)).toEqual([])
  })

  it('draws one tile in a strip narrower than a tile', () => {
    expect(stripTiles(layout, 600, 20, 80)).toHaveLength(1)
  })
})

describe('tileFit', () => {
  const layout = filmstripLayout(600)
  const h = tileHeight(layout.tileWidth, 1920, 1080)

  /** The width and height a placement asks the sheet to be drawn at. */
  const sheet = (p: { backgroundSize: string }): [number, number] => {
    const [w, y] = p.backgroundSize.split(' ')
    return [parseFloat(w!), parseFloat(y!)]
  }

  it('keeps the shape the camera saw, whichever way the box is wrong', () => {
    const wide = sheet(tileFit(layout, 0, h, 1900, 840, 'contain'))
    const tall = sheet(tileFit(layout, 0, h, 400, 900, 'contain'))
    // A sheet drawn at its own shape has the same ratio as one tile of it.
    for (const [w, y] of [wide, tall]) {
      expect(w / (layout.cols * layout.tileWidth)).toBeCloseTo(y / (layout.rows * h), 4)
    }
  })

  it('fits the whole frame inside the box when told to contain it', () => {
    const [w] = sheet(tileFit(layout, 0, h, 1900, 840, 'contain'))
    const drawnTileWidth = w / layout.cols
    const drawnTileHeight = (drawnTileWidth * h) / layout.tileWidth
    expect(drawnTileWidth).toBeLessThanOrEqual(1900 + 0.01)
    expect(drawnTileHeight).toBeLessThanOrEqual(840 + 0.01)
  })

  it('fills the box and crops when told to cover it', () => {
    const [w] = sheet(tileFit(layout, 0, h, 200, 60, 'cover'))
    const drawnTileWidth = w / layout.cols
    const drawnTileHeight = (drawnTileWidth * h) / layout.tileWidth
    expect(drawnTileWidth).toBeGreaterThanOrEqual(200 - 0.01)
    expect(drawnTileHeight).toBeGreaterThanOrEqual(60 - 0.01)
  })

  it('puts the first tile at the top left corner of the box', () => {
    const p = tileFit(layout, 0, h, 160, h, 'contain')
    expect(p.backgroundPosition).toBe('0px 0px')
  })

  it('moves along the sheet as the tile asked for moves', () => {
    const first = tileFit(layout, 0, h, 160, h, 'contain')
    const second = tileFit(layout, 1, h, 160, h, 'contain')
    expect(second.backgroundPosition).not.toBe(first.backgroundPosition)
    expect(parseFloat(second.backgroundPosition)).toBeLessThan(parseFloat(first.backgroundPosition))
  })

  it('asks for nothing it cannot work out before the box is measured', () => {
    expect(tileFit(layout, 0, h, 0, 100, 'cover').backgroundSize).toBe('auto')
    expect(tileFit(layout, 0, h, 100, 0, 'cover').backgroundSize).toBe('auto')
    expect(tileFit(layout, 0, 0, 100, 100, 'cover').backgroundSize).toBe('auto')
  })
})
