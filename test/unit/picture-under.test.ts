import { describe, it, expect } from 'vitest'
import { pictureUnder } from '../../src/shared/playback'
import { MAIN_PICTURE } from '../../src/shared/project'

/** Bugs and notes 2, note 12: the picture a double click on the Output view chooses. */
describe('the picture under a point of the frame', () => {
  const clip = {
    transform: { mode: 'crop' as const, crop: { x: 0, y: 0, w: 100, h: 100 }, place: { x: 0, y: 0, w: 1, h: 1 } },
    layers: [
      { id: 'two', crop: { x: 0, y: 0, w: 10, h: 10 }, place: { x: 0.6, y: 0.05, w: 0.35, h: 0.2 } },
      { id: 'three', crop: { x: 0, y: 0, w: 10, h: 10 }, place: { x: 0.7, y: 0.1, w: 0.2, h: 0.2 } }
    ]
  }

  it('is the one drawn on top: the last further picture, then the main one under them all', () => {
    expect(pictureUnder(clip, 0.8, 0.2)).toBe('three')
    expect(pictureUnder(clip, 0.62, 0.07)).toBe('two')
    expect(pictureUnder(clip, 0.2, 0.8)).toBe(MAIN_PICTURE)
  })

  it('is none outside every picture', () => {
    const small = { ...clip, transform: { ...clip.transform, place: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }, layers: [] }
    expect(pictureUnder(small, 0.1, 0.1)).toBeNull()
  })
})
