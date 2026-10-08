import { describe, it, expect } from 'vitest'
import { emptyHistory, recorded, stepBack, stepForward } from '../../src/shared/history'

describe('the undo history (audit 2026-10-01)', () => {
  it('goes back and forward again through what was edited, in order', () => {
    let h = recorded(recorded(emptyHistory<string>(), 'a', 100), 'b', 100)
    const back = stepBack(h, 'c')!
    expect(back.to).toBe('b')
    h = back.history
    const back2 = stepBack(h, 'b')!
    expect(back2.to).toBe('a')
    expect(stepBack(back2.history, 'a')).toBeNull()
    const on = stepForward(back2.history, 'a')!
    expect(on.to).toBe('b')
    expect(stepForward(on.history, 'b')!.to).toBe('c')
  })

  it('offers nothing undone again once something new is edited, and keeps at most so many steps', () => {
    let h = recorded(emptyHistory<number>(), 1, 3)
    h = stepBack(h, 2)!.history
    expect(h.future).toEqual([2])
    h = recorded(h, 1, 3)
    expect(h.future).toEqual([])
    for (let i = 2; i <= 6; i++) h = recorded(h, i, 3)
    expect(h.past).toEqual([4, 5, 6])
  })
})
