import { describe, it, expect, afterAll } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanCredits, creditKey, creditLine } from '../../src/shared/credits'
import { creditsFor } from '../../src/main/credits'

const root = await mkdtemp(join(tmpdir(), 'editbay-credits-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('a credit line (task 47)', () => {
  it('is the first line with words in it, trimmed', () => {
    expect(creditLine('\uFEFF\n  Sound effects obtained from https://www.zapsplat.com  \nmore')).toBe('Sound effects obtained from https://www.zapsplat.com')
    expect(creditLine(' \n\n')).toBeNull()
  })

  it('keeps only marks with a line, however a path is cased or slashed', () => {
    expect(cleanCredits({ 'D:/FX/Boing.MP3': ' Boing by Ann ', 'D:/x.wav': '  ', '': 'x' })).toEqual({ [creditKey('d:/fx/boing.mp3')]: 'Boing by Ann' })
    expect(cleanCredits(['x'])).toEqual({})
  })
})

describe('the credits a video needs (task 47)', () => {
  it("names a pack folder's credit once for all its files, a file marked by hand, and nothing for the rest", async () => {
    const zap = join(root, 'Assets', 'Audio', 'ZapSplat')
    const free = join(root, 'Assets', 'Audio', 'Kenney')
    await mkdir(join(zap, 'whooshes'), { recursive: true })
    await mkdir(free, { recursive: true })
    await writeFile(join(zap, 'credit.txt'), 'Sound effects obtained from https://www.zapsplat.com\n')
    const marked = { [creditKey(join(free, 'boing.ogg'))]: '"Boing" by Ann licensed under CC BY 4.0' }
    const lines = await creditsFor(
      [join(zap, 'whooshes', 'a.mp3'), join(free, 'click.ogg'), join(zap, 'b.mp3'), join(free, 'boing.ogg')],
      marked
    )
    expect(lines).toEqual(['Sound effects obtained from https://www.zapsplat.com', '"Boing" by Ann licensed under CC BY 4.0'])
    expect(await creditsFor([join(free, 'click.ogg')], {})).toEqual([])
  })
})
