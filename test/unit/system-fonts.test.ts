import { describe, it, expect } from 'vitest'
import { fontFor, fontFolders } from '../../src/main/fonts/system-fonts'

describe('fonts on this PC (plan 87)', () => {
  it('finds a family by its name, its regular file first, with the figures the captions need', async () => {
    const t = Date.now()
    const arial = await fontFor('arial', fontFolders())
    expect(arial?.path.toLowerCase().endsWith('arial.ttf')).toBe(true)
    expect(arial?.figures.family).toBe('Arial')
    expect(Date.now() - t).toBeLessThan(15_000)
    expect(await fontFor('No Such Font Anywhere')).toBeNull()
  })
})
