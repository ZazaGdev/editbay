import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fontFor, fontFolders } from '../../src/main/fonts/system-fonts'

/**
 * Fonts Windows keeps as collections, several faces in one .ttc (audit
 * 2026-10-08). Cambria's regular face is only in cambria.ttc, so it was
 * skipped and the export burned captions in Cambria Bold; families that are
 * only in a collection were called not on this computer.
 */

const fonts = fontFolders()[0]!

describe('a font kept in a collection', () => {
  it.runIf(existsSync(join(fonts, 'cambria.ttc')))('is found by its regular face, not a bolder file of the family', async () => {
    const cambria = await fontFor('Cambria', fontFolders())
    expect(cambria?.path.toLowerCase().endsWith('cambria.ttc')).toBe(true)
    expect(cambria?.figures.family).toBe('Cambria')
  })

  it.runIf(existsSync(join(fonts, 'msgothic.ttc')))('is found when the family is in no other file', async () => {
    const gothic = await fontFor('MS Gothic', fontFolders())
    expect(gothic?.figures.family).toBe('MS Gothic')
  })
})
