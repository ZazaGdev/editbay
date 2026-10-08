import { describe, it, expect } from 'vitest'
import {
  MAX_SAVED_LAYOUTS,
  cleanLayoutName,
  cleanSavedLayouts,
  layoutNamed,
  layoutShape,
  nextLayoutName,
  removeLayout,
  renameLayout,
  restoreLayout,
  saveLayout,
  updateLayout
} from '../../src/shared/saved-layouts'
import type { Framing } from '../../src/shared/project'

/** Plan 68: framings saved under a name. */

const framing = (x = 0): Framing => ({
  crop: { x, y: 0, w: 608, h: 1080 },
  place: { x: 0, y: 0, w: 1, h: 1 },
  layers: [{ id: 'l1', crop: { x: 1400, y: 700, w: 320, h: 180 }, place: { x: 0.6, y: 0.05, w: 0.35, h: 0.2 }, style: { radius: 24 } }],
  layout: 'pip',
  width: 1920,
  height: 1080,
  frameW: 1080,
  frameH: 1920
})

describe('a saved layout', () => {
  it('is saved at the end under a tidy name, and under a name already there updates that one', () => {
    let list = saveLayout([], '  Game +   facecam ', framing(0), 'a')
    list = saveLayout(list, 'Talking head', framing(10), 'b')
    expect(list.map((l) => [l.id, l.name])).toEqual([
      ['a', 'Game + facecam'],
      ['b', 'Talking head']
    ])
    list = saveLayout(list, 'game + FACECAM', framing(50), 'c')
    expect(list.map((l) => l.id)).toEqual(['a', 'b'])
    expect(list[0]!.framing.crop.x).toBe(50)
    expect(list[0]!.name).toBe('Game + facecam')
  })

  it('is not saved without a name, or past the most kept', () => {
    expect(saveLayout([], '   ', framing())).toEqual([])
    let full = [] as ReturnType<typeof saveLayout>
    for (let i = 0; i < MAX_SAVED_LAYOUTS; i++) full = saveLayout(full, `L${i}`, framing(), `id${i}`)
    expect(saveLayout(full, 'one more', framing())).toHaveLength(MAX_SAVED_LAYOUTS)
  })

  it('is renamed, but not to nothing or to a name another has', () => {
    let list = saveLayout(saveLayout([], 'One', framing(), 'a'), 'Two', framing(), 'b')
    list = renameLayout(list, 'a', 'First')
    expect(list[0]!.name).toBe('First')
    expect(renameLayout(list, 'a', '  ')[0]!.name).toBe('First')
    expect(renameLayout(list, 'a', 'two')[0]!.name).toBe('First')
    // Its own name in other capitals is fine.
    expect(renameLayout(list, 'a', 'FIRST')[0]!.name).toBe('FIRST')
  })

  it('is updated with a new framing, deleted, and put back where it was', () => {
    let list = saveLayout(saveLayout(saveLayout([], 'A', framing(), 'a'), 'B', framing(), 'b'), 'C', framing(), 'c')
    list = updateLayout(list, 'b', framing(99))
    expect(list[1]!.framing.crop.x).toBe(99)
    const b = list[1]!
    const gone = removeLayout(list, 'b')
    expect(gone.map((l) => l.id)).toEqual(['a', 'c'])
    expect(restoreLayout(gone, b, 1).map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(restoreLayout(list, b, 0)).toEqual(list)
  })

  it('offers a name no other layout has', () => {
    expect(nextLayoutName([])).toBe('Layout 1')
    const list = saveLayout(saveLayout([], 'Layout 2', framing(), 'a'), 'x', framing(), 'b')
    expect(nextLayoutName(list)).toBe('Layout 3')
    expect(layoutNamed(list, 'layout 2')?.id).toBe('a')
    expect(cleanLayoutName('x'.repeat(100))).toHaveLength(60)
  })

  it('comes back from the settings file as it went in, style and all, one to a name', () => {
    const list = saveLayout(saveLayout([], 'A', framing(), 'a'), 'B', framing(5), 'b')
    const read = cleanSavedLayouts(JSON.parse(JSON.stringify([...list, { ...list[0]!, id: 'dupe' }])))
    expect(read).toEqual(list)
    expect(cleanSavedLayouts([{ id: 'x', name: 'Bad', framing: { ...framing(), layers: [{ id: 'l', crop: 3 }] } }])).toEqual([])
  })
})

describe('the shape a layout was saved in', () => {
  it('is the fixed shape whose size its frame was, and none for any other size', () => {
    const at = (frameW: number, frameH: number) => layoutShape({ id: 'a', name: 'A', framing: { ...framing(), frameW, frameH } })
    expect(at(1080, 1920)).toBe('vertical')
    expect(at(1920, 1080)).toBe('landscape')
    expect(at(1080, 1080)).toBe('square')
    // Saved under Handoff, where the frame is the recording's own size.
    expect(at(2560, 1440)).toBeNull()
  })
})
