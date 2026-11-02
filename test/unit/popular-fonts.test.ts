import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TEXT_FONTS, popularOf } from '../../src/shared/popular-fonts'

/**
 * Task 1087: the font lists offered every font on the PC, dozens of Georgian
 * BPG ones among them. Now the fonts the app brings, then only the popular
 * ones on the PC.
 */
describe('the popular fonts of a PC', () => {
  it('keeps the popular ones and drops the rest', () => {
    const pc = ['BPG Arial', 'BPG Glaho', 'Segoe UI', 'Arial', 'Sylfaen', 'Wingdings', 'Georgia', 'BPG Nino Mtavruli']
    expect(popularOf(pc)).toEqual(['Arial', 'Georgia', 'Segoe UI'])
  })

  it('names each once, as the PC names it', () => {
    expect(popularOf(['segoe ui', 'Segoe UI', 'ARIAL'])).toEqual(['ARIAL', 'segoe ui'])
  })
})

describe('the fonts the app brings for texts', () => {
  it('has every file, and each its licence', () => {
    const licences = readdirSync(join('resources', 'licences'))
    for (const font of TEXT_FONTS) {
      expect(existsSync(join('resources', 'text-fonts', font.file)), font.file).toBe(true)
      const base = font.file.replace('-Regular.ttf', '')
      expect(licences.some((l) => l.startsWith(`${base}-`)), `${base} licence`).toBe(true)
    }
  })

  it('lists every file in the folder, so none ships unused', () => {
    expect(readdirSync(join('resources', 'text-fonts')).sort()).toEqual(TEXT_FONTS.map((f) => f.file).sort())
  })
})
