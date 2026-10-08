import { describe, it, expect } from 'vitest'
import { sequencesChanged } from '../../../src/renderer/state/useProject'
import { addSequence, createProject, renameSequence, type Project } from '../../../src/shared/project'

/** Audit 2026-10-01: the history is one for the whole project, so an undo says which sequences it changed. */

describe('the sequences a step changed', () => {
  const two = (): Project => addSequence(createProject('p', 30, { width: 1080, height: 1920 }), 'second', 'landscape')

  it('names the one changed, and none when nothing was', () => {
    const before = two()
    const after = renameSequence(before, 'second', 'Wide cut')
    expect(sequencesChanged(before, after)).toEqual(['second'])
    expect(sequencesChanged(before, before)).toEqual([])
  })

  it('names a sequence brought back by the step', () => {
    const one = createProject('p', 30, { width: 1080, height: 1920 })
    expect(sequencesChanged(one, two())).toEqual(['second'])
  })
})
