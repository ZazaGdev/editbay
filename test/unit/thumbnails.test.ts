import { describe, it, expect } from 'vitest'
import { filmstripLayout, filmstripArgs } from '../../src/main/media/thumbnails'

describe('filmstripLayout', () => {
  it('uses a whole grid that fits every tile', () => {
    const l = filmstripLayout(600)
    expect(l.cols * l.rows).toBeGreaterThanOrEqual(l.tileCount)
    expect(Number.isInteger(l.cols)).toBe(true)
    expect(Number.isInteger(l.rows)).toBe(true)
  })

  it('samples a short clip more often than a long one', () => {
    expect(filmstripLayout(10).intervalSec).toBeLessThan(filmstripLayout(3600).intervalSec)
  })

  it('never asks for more than the tile budget', () => {
    for (const d of [1, 10, 120, 600, 3600, 14400]) {
      expect(filmstripLayout(d).tileCount).toBeLessThanOrEqual(100)
    }
  })

  it('gives a very short clip at least one tile', () => {
    expect(filmstripLayout(0.5).tileCount).toBeGreaterThanOrEqual(1)
    expect(filmstripLayout(0).tileCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps the sprite within a sane pixel width', () => {
    const l = filmstripLayout(3600)
    expect(l.cols * l.tileWidth).toBeLessThanOrEqual(4096)
  })
})

describe('filmstripArgs', () => {
  it('samples at the layout interval and tiles the result', () => {
    const args = filmstripArgs('C:\\in.mp4', 'C:\\out.jpg', filmstripLayout(600))
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).toContain('fps=')
    expect(vf).toContain('tile=')
  })

  it('writes exactly one image', () => {
    const args = filmstripArgs('C:\\in.mp4', 'C:\\out.jpg', filmstripLayout(600))
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1')
  })

  it('ends with the output path', () => {
    const args = filmstripArgs('C:\\in.mp4', 'C:\\out.jpg', filmstripLayout(600))
    expect(args[args.length - 1]).toBe('C:\\out.jpg')
  })

  it('decodes only keyframes when the tiles are far apart', () => {
    // An hour gives 36 seconds a tile, far more than any keyframe spacing.
    const args = filmstripArgs('C:\\in.mp4', 'C:\\out.jpg', filmstripLayout(3600))
    expect(args.slice(0, 3)).toEqual(['-skip_frame', 'nokey', '-i'])
  })

  it('decodes every frame when the tiles are close together', () => {
    // A minute gives a tile a second, closer than x264's default keyframe spacing.
    expect(filmstripArgs('C:\\in.mp4', 'C:\\out.jpg', filmstripLayout(60))).not.toContain('-skip_frame')
  })
})
