import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Plan 91: no source file of thousands of lines. A big file is hard to read
 * and makes anyone changing one thing in it load all of it. A file over the
 * limit is split by what its parts do. The few not split yet are listed with
 * their size on the day they were listed: they may shrink, never grow, and
 * come off the list once they are under the limit.
 */

const LIMIT = 1000

/** Files not split yet, each held to its line count when it was listed. */
const NOT_SPLIT_YET: Record<string, number> = {
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const root = process.cwd()
const sizes = sourceFiles(join(root, 'src')).map((path) => {
  const text = readFileSync(path, 'utf8')
  return { file: relative(root, path).split(sep).join('/'), lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) }
})

describe('the size of a source file', () => {
  it(`is at most ${LIMIT} lines, or no more than it was for one not split yet`, () => {
    const over = sizes.filter((s) => s.lines > (NOT_SPLIT_YET[s.file] ?? LIMIT)).map((s) => `${s.file}: ${s.lines}`)
    expect(over).toEqual([])
  })

  it('lists only files that are still over the limit', () => {
    const done = Object.keys(NOT_SPLIT_YET).filter((file) => (sizes.find((s) => s.file === file)?.lines ?? 0) <= LIMIT)
    expect(done).toEqual([])
  })
})
