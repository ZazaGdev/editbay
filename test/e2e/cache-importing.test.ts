import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from './fixtures'

const userData = await mkdtemp(join(tmpdir(), 'editbay-cache-importing-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => userData }
}))

const { importFile, cacheKeysImporting } = await import('../../src/main/media/import')

/**
 * Freeing the cache while a recording is being imported (audit 2026-10-08):
 * the source is not in the project until it is ready, so its folder is
 * counted as in use while the import runs. And the folder notes the recording
 * it was made from, so a conformed copy whose original is deleted later is
 * never freed as if it could be made again.
 */

const fx = fixtureSet('cache-importing')
afterAll(async () => {
  await rm(userData, { recursive: true, force: true })
  await fx.cleanup()
})

describe('a recording being imported', () => {
  it('has its cache folder counted as in use until it is done, and the folder names its original', async () => {
    const clip = await fx.cleanClip()
    const seen: string[][] = []
    const asset = await importFile(clip, () => seen.push([...cacheKeysImporting()]), () => {})
    expect(asset.status).toBe('ready')
    const folder = (await readdir(join(userData, 'media-cache')))[0]!
    expect(seen.some((keys) => keys.includes(folder))).toBe(true)
    expect([...cacheKeysImporting()]).toEqual([])
    expect(await readFile(join(userData, 'media-cache', folder, 'original.txt'), 'utf8')).toBe(clip)
  })
})
