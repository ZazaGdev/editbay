import { describe, it, expect, beforeEach } from 'vitest'
import { currentToasts, dismissToast, editMade, showToast } from '../../../src/renderer/state/toasts'

beforeEach(() => {
  for (const t of currentToasts()) dismissToast(t.id)
})

describe('notices that wait for an answer', () => {
  it('stay through an edit, which puts the others away', () => {
    showToast({ kind: 'saved', text: 'Saved', sticky: true })
    showToast({ kind: 'recording', text: 'New recording: a.mkv', sticky: true, lasting: true })
    editMade()
    expect(currentToasts().map((t) => t.kind)).toEqual(['recording'])
  })

  it('are the last to go when too many arrive at once', () => {
    showToast({ kind: 'recording', text: 'New recording: a.mkv', sticky: true, lasting: true })
    for (let i = 0; i < 4; i++) showToast({ kind: `other ${i}`, text: 'Something', sticky: true })
    const kinds = currentToasts().map((t) => t.kind)
    expect(kinds).toHaveLength(3)
    expect(kinds).toContain('recording')
    expect(kinds).toEqual(['recording', 'other 2', 'other 3'])
  })
})
