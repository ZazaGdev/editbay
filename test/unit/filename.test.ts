import { describe, it, expect } from 'vitest'
import { formatFilename, sanitiseFilename, clipNameFromPath } from '../../src/shared/filename'

describe('sanitiseFilename', () => {
  it('leaves an ordinary name alone', () => {
    expect(sanitiseFilename('my video')).toBe('my video')
  })

  it('replaces the characters Windows refuses', () => {
    expect(sanitiseFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('stops a name from escaping the folder it was meant for', () => {
    // The dangerous part is the separators, which are replaced.
    expect(sanitiseFilename('../../etc/passwd')).not.toContain('/')
    expect(sanitiseFilename('..\\..\\windows')).not.toContain('\\')
  })

  it('strips trailing dots and spaces, which Windows silently drops', () => {
    expect(sanitiseFilename('name...')).toBe('name')
    expect(sanitiseFilename('name   ')).toBe('name')
  })

  it('gets out of the way of reserved device names', () => {
    expect(sanitiseFilename('con')).toBe('con_')
    expect(sanitiseFilename('COM1')).toBe('COM1_')
    expect(sanitiseFilename('console')).toBe('console')
  })

  it('never returns an empty name', () => {
    expect(sanitiseFilename('')).toBe('untitled')
    expect(sanitiseFilename('///')).not.toBe('')
    expect(sanitiseFilename('   ')).toBe('untitled')
  })

  it('keeps a very long name within reach of the path limit', () => {
    expect(sanitiseFilename('x'.repeat(500)).length).toBeLessThanOrEqual(120)
  })
})

describe('formatFilename', () => {
  const fields = { sequence: 'Vertical', project: 'holiday', index: 3, clip: 'beach' }

  it('fills in every field', () => {
    expect(formatFilename('{project}_{index}_{clip}', fields, 'mp4')).toBe('holiday_03_beach.mp4')
  })

  it('pads the index so a folder sorts the way it was cut', () => {
    expect(formatFilename('{index}', { ...fields, index: 1 }, 'mp4')).toBe('01.mp4')
    expect(formatFilename('{index}', { ...fields, index: 12 }, 'mp4')).toBe('12.mp4')
    expect(formatFilename('{index}', { ...fields, index: 100 }, 'mp4')).toBe('100.mp4')
  })

  it('leaves an unknown field alone rather than blanking it', () => {
    expect(formatFilename('{project}_{nope}', fields, 'mp4')).toBe('holiday_{nope}.mp4')
  })

  it('takes an extension with or without a dot', () => {
    expect(formatFilename('a', fields, '.mkv')).toBe('a.mkv')
    expect(formatFilename('a', fields, 'mkv')).toBe('a.mkv')
  })

  it('sanitises what the fields put in', () => {
    const nasty = { sequence: 'Vertical', project: 'a/b', index: 1, clip: 'c:d' }
    expect(formatFilename('{project}_{clip}', nasty, 'mp4')).toBe('a_b_c_d.mp4')
  })

  it('survives a pattern with no fields at all', () => {
    expect(formatFilename('output', fields, 'mp4')).toBe('output.mp4')
  })

  it('survives an empty pattern', () => {
    expect(formatFilename('', fields, 'mp4')).toBe('untitled.mp4')
  })
})

describe('clipNameFromPath', () => {
  it('takes the name without its extension', () => {
    expect(clipNameFromPath('C:\\v\\my clip.mp4')).toBe('my clip')
    expect(clipNameFromPath('/home/x/my clip.mov')).toBe('my clip')
  })

  it('keeps a name that has no extension', () => {
    expect(clipNameFromPath('C:\\v\\README')).toBe('README')
  })

  it('keeps a leading dot, which is the whole name and not an extension', () => {
    expect(clipNameFromPath('/home/x/.hidden')).toBe('.hidden')
  })
})
