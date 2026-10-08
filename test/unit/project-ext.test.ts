import { describe, it, expect } from 'vitest'
import { PROJECT_EXT, PROJECT_EXTS, isProjectPath, stripProjectExt } from '../../src/shared/project-ext'

describe('which extension a project carries', () => {
  it('is the one every save writes', () => {
    expect(PROJECT_EXT).toBe('editbay')
  })

  it('is the only one, so nothing else is accepted by accident', () => {
    expect(PROJECT_EXTS).toEqual(['editbay'])
  })
})

describe('which paths name a project', () => {
  it('takes the project extension', () => {
    expect(isProjectPath('D:\\trips\\holiday.editbay')).toBe(true)
  })

  it('ignores case, as Windows does', () => {
    expect(isProjectPath('D:\\A.EDITBAY')).toBe(true)
    expect(isProjectPath('D:\\a.EditBay')).toBe(true)
  })

  it('refuses the names the app used before it was renamed', () => {
    expect(isProjectPath('D:\\trips\\holiday.clipper')).toBe(false)
    expect(isProjectPath('D:\\trips\\holiday.cutroom')).toBe(false)
  })

  it('refuses anything else, including footage and a near miss', () => {
    expect(isProjectPath('D:\\trips\\holiday.mp4')).toBe(false)
    expect(isProjectPath('D:\\trips\\editbay')).toBe(false)
    expect(isProjectPath('D:\\trips\\holiday.editbay.bak')).toBe(false)
    expect(isProjectPath('')).toBe(false)
  })
})

describe('a project file name without its extension', () => {
  it('drops the extension', () => {
    expect(stripProjectExt('holiday.editbay')).toBe('holiday')
  })

  it('drops it whatever its case', () => {
    expect(stripProjectExt('holiday.EDITBAY')).toBe('holiday')
    expect(stripProjectExt('holiday.EditBay')).toBe('holiday')
  })

  it('leaves a name that carries no project extension alone', () => {
    expect(stripProjectExt('holiday.mp4')).toBe('holiday.mp4')
    expect(stripProjectExt('holiday.clipper')).toBe('holiday.clipper')
    expect(stripProjectExt('holiday')).toBe('holiday')
  })

  it('keeps a dot that belongs to the name', () => {
    expect(stripProjectExt('holiday.2026.editbay')).toBe('holiday.2026')
  })
})
