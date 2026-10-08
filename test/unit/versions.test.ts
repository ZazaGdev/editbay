import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isVersionId, keepBeforeSaving, KEEP_AT_MOST, KEEP_EVERY_MS, KEEP_FOR_MS, versionsToLetGo } from '../../src/shared/versions'
import { keepVersion, listVersions, newestKeptAt, readVersion, versionsKey } from '../../src/main/project/versions'

/** Plan 84: earlier versions, kept whenever work would otherwise be thrown away. */

const root = await mkdtemp(join(tmpdir(), 'editbay-versions-'))
afterAll(() => rm(root, { recursive: true, force: true }))

const DAY = 24 * 3600 * 1000

describe('which versions are let go', () => {
  it('keeps the newest ones and lets go of those past the most kept', () => {
    const now = 10 * DAY
    const all = Array.from({ length: KEEP_AT_MOST + 3 }, (_, i) => ({ id: `v${i}`, keptAt: now - i * 1000 }))
    expect(versionsToLetGo(all, now)).toEqual([`v${KEEP_AT_MOST}`, `v${KEEP_AT_MOST + 1}`, `v${KEEP_AT_MOST + 2}`])
  })

  it('lets go of old ones, but never the newest five, however old', () => {
    const now = 1000 * DAY
    const old = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, keptAt: now - KEEP_FOR_MS - (i + 1) * DAY }))
    expect(versionsToLetGo(old, now)).toEqual(['v5', 'v6', 'v7'])
  })
})

describe('what a save keeps first', () => {
  const now = 100 * DAY
  it('keeps a file changed elsewhere, always', () => {
    expect(keepBeforeSaving({ changedElsewhere: true, firstSave: false, newestKeptAt: now, now })).toBe('changed-elsewhere')
  })

  it('keeps the file as it was opened, before the first save over it', () => {
    expect(keepBeforeSaving({ changedElsewhere: false, firstSave: true, newestKeptAt: now, now })).toBe('saved-over')
  })

  it('keeps one again only once the newest is ten minutes old', () => {
    expect(keepBeforeSaving({ changedElsewhere: false, firstSave: false, newestKeptAt: now - 1000, now })).toBeNull()
    expect(keepBeforeSaving({ changedElsewhere: false, firstSave: false, newestKeptAt: now - KEEP_EVERY_MS, now })).toBe('saved-over')
    expect(keepBeforeSaving({ changedElsewhere: false, firstSave: false, newestKeptAt: null, now })).toBe('saved-over')
  })
})

describe('versions on disk', () => {
  it('keeps one, lists it with why, and gives back what was kept', async () => {
    const dir = join(root, 'a')
    const kept = await keepVersion(dir, { projectPath: 'D:\\Films\\trip.editbay', name: 'trip', reason: 'not-saved', text: '{"one":1}' }, 1_700_000_000_000)
    expect(kept).not.toBeNull()
    const list = await listVersions(dir, 'd:\\films\\TRIP.editbay')
    expect(list.map((v) => [v.name, v.reason, v.keptAt])).toEqual([['trip', 'not-saved', 1_700_000_000_000]])
    expect(await readVersion(dir, list[0]!.id)).toEqual({ projectPath: 'D:\\Films\\trip.editbay', text: '{"one":1}' })
    expect(await newestKeptAt(dir, 'D:\\Films\\trip.editbay')).toBe(1_700_000_000_000)
  })

  it('does not keep the same thing twice in a row, and never gives two the same name', async () => {
    const dir = join(root, 'b')
    const what = { projectPath: null, name: 'Untitled', reason: 'not-saved' as const, text: 'x' }
    expect(await keepVersion(dir, what, 1_700_000_000_000)).not.toBeNull()
    expect(await keepVersion(dir, what, 1_700_000_000_000)).toBeNull()
    expect(await keepVersion(dir, { ...what, text: 'y' }, 1_700_000_000_000)).not.toBeNull()
    const list = await listVersions(dir, null)
    expect(list.map((v) => v.keptAt)).toEqual([1_700_000_000_001, 1_700_000_000_000])
  })

  it('lets go of the oldest once there are too many', async () => {
    const dir = join(root, 'c')
    for (let i = 0; i < KEEP_AT_MOST + 2; i++) {
      await keepVersion(dir, { projectPath: 'C:\\p.editbay', name: 'p', reason: 'saved-over', text: `t${i}` }, 1_700_000_000_000 + i * 1000)
    }
    const files = await readdir(join(dir, versionsKey('C:\\p.editbay')))
    expect(files).toHaveLength(KEEP_AT_MOST)
    expect((await listVersions(dir, 'C:\\p.editbay')).at(-1)!.keptAt).toBe(1_700_000_002_000)
  })

  it('reads nothing but a version, whatever name it is given', async () => {
    const dir = join(root, 'd')
    await mkdir(join(dir, 'untitled'), { recursive: true })
    await writeFile(join(dir, 'untitled', 'notes.txt'), 'hello')
    expect(isVersionId('untitled/notes.txt')).toBe(false)
    expect(isVersionId('../secrets/1700000000000-not-saved.editbay.gz')).toBe(false)
    expect(isVersionId('untitled/1700000000000-not-saved.editbay.gz')).toBe(true)
    await expect(readVersion(dir, 'untitled/notes.txt')).rejects.toThrow()
    expect(await listVersions(dir, null)).toEqual([])
  })
})
