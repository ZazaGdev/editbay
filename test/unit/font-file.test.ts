import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFontFamily, readFontFigures } from '../../src/shared/font-file'
import { CAPTION_FONTS } from '../../src/shared/caption-fonts'

describe('reading a font file (plan 87)', () => {
  for (const font of CAPTION_FONTS) {
    it(`gives ${font.label} the figures the captions are laid out by`, async () => {
      const bytes = new Uint8Array(await readFile(join('resources', 'fonts', font.file)))
      const read = readFontFigures(bytes)!
      expect(read.family).toBe(font.family)
      expect(readFontFamily(bytes)).toBe(font.family)
      expect(read.capHeight).toBe(font.capHeight)
      expect(read.assSizePerEm).toBe(font.assSizePerEm)
      expect(read.assDescent).toBe(font.assDescent)
      expect(read.averageAdvance).toBe(font.averageAdvance)
      expect(read.advance).toEqual(font.advance)
    })
  }

  it.runIf(process.platform === 'win32')('reads a font from this PC', async () => {
    const bytes = new Uint8Array(await readFile(join(process.env.SystemRoot ?? 'C:\Windows', 'Fonts', 'arial.ttf')))
    const read = readFontFigures(bytes)!
    expect(read.family).toBe('Arial')
    expect(read.advance['W']).toBeGreaterThan(read.advance['i']!)
  })

  it('refuses what is not a font', () => {
    expect(readFontFigures(new TextEncoder().encode('not a font at all, just words'))).toBeNull()
    expect(readFontFamily(new Uint8Array(4))).toBeNull()
  })
})
