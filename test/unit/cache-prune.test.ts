import { describe, it, expect, afterAll } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheSize, cacheUsedBy, markUsed, pruneCache, recordOriginal, UNUSED_FOR_MS } from '../../src/main/media/prune'
import type { ProjectMedia } from '../../src/shared/project'

const root = await mkdtemp(join(tmpdir(), 'editbay-prune-'))
afterAll(() => rm(root, { recursive: true, force: true }))

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
/** A file that is there, standing for a recording still on the disk. */
const THERE = process.execPath
const RECORD = Buffer.byteLength(THERE)

/** A source's folder in the cache, its copy of `bytes`, made from `original`, or a drawn picture. */
async function made(name: string, bytes: number, ageMs: number, original: string | null = THERE): Promise<string> {
  const path = join(root, ...name.split('/'))
  const folder = name.startsWith('text/') ? join(root, 'text') : path
  await mkdir(folder, { recursive: true })
  const file = name.startsWith('text/') ? path : join(path, 'conformed.mp4')
  await writeFile(file, Buffer.alloc(bytes))
  if (original !== null && !name.startsWith('text/')) await recordOriginal(path, original)
  const when = new Date(now - ageMs)
  await utimes(path, when, when)
  return path
}

describe('the media cache (audit 2026-10-01)', () => {
  it('loses only what nothing uses and has gone unused for long, and says how much room it took', async () => {
    await made('aaaa', 100, 90 * DAY)
    await made('bbbb', 200, 90 * DAY)
    await made('cccc', 300, 5 * DAY)
    await made('text/old.png', 10, 90 * DAY)
    await made('text/used.png', 20, 90 * DAY)
    const media = [
      { playablePath: join(root, 'bbbb', 'conformed.mp4'), originalPath: 'D:\videos\b.mp4', peaksPath: join(root, 'bbbb', 'peaks.bin'), filmstripPath: '' },
      { playablePath: join(root, 'text', 'used.png'), originalPath: join(root, 'text', 'used.png'), peaksPath: '', filmstripPath: '' }
    ] as unknown as ProjectMedia[]
    const used = cacheUsedBy(root, media)
    expect([...used].sort()).toEqual(['bbbb', 'text/used.png'])
    expect(await cacheSize(root)).toBe(630 + 3 * RECORD)

    expect(await pruneCache(root, used, UNUSED_FOR_MS, now)).toBe(110 + RECORD)
    expect((await readdir(root)).sort()).toEqual(['bbbb', 'cccc', 'text'])
    expect(await readdir(join(root, 'text'))).toEqual(['used.png'])
  })

  it('keeps what a project opened marks as used, however old', async () => {
    await made('dddd', 50, 90 * DAY)
    await markUsed(root, new Set(['dddd']), now)
    await pruneCache(root, new Set(), UNUSED_FOR_MS, now)
    expect(await readdir(root)).toContain('dddd')
    // Freed by hand: all that the open project does not use, but never what was written in the last minute.
    await made('eeee', 5, -110_000)
    await pruneCache(root, new Set(['cccc']), 0, now + 120_000)
    expect((await readdir(root)).sort()).toEqual(['cccc', 'eeee', 'text'])
  })

  it('keeps the only copy of a recording whose original is gone (audit 2026-10-08)', async () => {
    await made('gone', 40, 90 * DAY, 'C:\\no such folder\\phone.mp4')
    await made('share', 40, 90 * DAY, '\\\\nas\\footage\\phone.mp4')
    await made('unknown', 40, 90 * DAY, null)
    await pruneCache(root, new Set(), 0, now)
    expect(await readdir(root)).toEqual(expect.arrayContaining(['gone', 'share', 'unknown']))
  })

  it('still frees what was made from a recording that is still there', async () => {
    await made('still-there', 40, 90 * DAY)
    await pruneCache(root, new Set(), 0, now)
    expect(await readdir(root)).not.toContain('still-there')
  })
})
