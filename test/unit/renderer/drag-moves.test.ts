import { describe, it, expect } from 'vitest'
import { replacesMove } from '../../../src/renderer/state/dragMoves'
import type { ProjectEdit } from '../../../src/shared/types'

/** Audit 2026-10-01, item 8: a drag's movements waiting to be sent, only the latest kept. */

const trim = (clipId: string, frame: number, edge: 'start' | 'end' = 'end'): ProjectEdit =>
  ({ sequenceId: 's', kind: 'trimToFrame', clipId, edge, frame }) as ProjectEdit

describe('a drag movement standing in for one still waiting', () => {
  it('stands in for the same edit on the same thing, wherever it was dragged to', () => {
    expect(replacesMove(trim('a', 10), trim('a', 14))).toBe(true)
  })

  it('never for another clip, another edge or another kind of edit', () => {
    expect(replacesMove(trim('a', 10), trim('b', 14))).toBe(false)
    expect(replacesMove(trim('a', 10), trim('a', 14, 'start'))).toBe(false)
    expect(replacesMove(trim('a', 10), { sequenceId: 's', kind: 'setFade', clipId: 'a', side: 'out', length: 4 } as ProjectEdit)).toBe(false)
  })

  it('never for a change of other settings of the same picture', () => {
    const pip = (change: object): ProjectEdit => ({ sequenceId: 's', kind: 'setPip', clipId: 'a', change }) as unknown as ProjectEdit
    expect(replacesMove(pip({ size: 0.3 }), pip({ size: 0.31 }))).toBe(true)
    expect(replacesMove(pip({ size: 0.3 }), pip({ border: 2 }))).toBe(false)
  })
})
