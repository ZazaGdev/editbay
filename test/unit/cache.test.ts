import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, open, mkdir, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { cacheKey, writeAtomic, sweepLeftovers, CONFORM_SETTINGS_VERSION } from '../../src/main/media/cache'

const base = { path: 'C:\\video\\a.mp4', size: 12345, mtimeMs: 1700000000000 }
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-'))
  dirs.push(dir)
  return dir
}

describe('cacheKey', () => {
  it('is stable for the same input', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }))
  })

  it('changes when the file is edited in place', () => {
    expect(cacheKey({ ...base, mtimeMs: base.mtimeMs + 1 })).not.toBe(cacheKey(base))
    expect(cacheKey({ ...base, size: base.size + 1 })).not.toBe(cacheKey(base))
  })

  it('changes when the file moves, because the same name elsewhere is a different file', () => {
    expect(cacheKey({ ...base, path: 'D:\\video\\a.mp4' })).not.toBe(cacheKey(base))
  })

  it('changes when the conform settings version changes', () => {
    expect(cacheKey({ ...base, settingsVersion: CONFORM_SETTINGS_VERSION + 1 })).not.toBe(cacheKey(base))
  })

  it('is filesystem safe and short', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('writeAtomic', () => {
  it('writes the file', async () => {
    const target = join(await workDir(), 'out.bin')
    await writeAtomic(target, Buffer.from('hello'))
    expect((await readFile(target)).toString()).toBe('hello')
  })

  it('replaces an existing file', async () => {
    const target = join(await workDir(), 'out.bin')
    await writeFile(target, 'old')
    await writeAtomic(target, Buffer.from('new'))
    expect((await readFile(target)).toString()).toBe('new')
  })

  it('leaves no temporary file behind', async () => {
    const dir = await workDir()
    await writeAtomic(join(dir, 'out.bin'), Buffer.from('x'))
    expect(await readdir(dir)).toEqual(['out.bin'])
  })

  it('has the new file on the disk before it takes the old one\'s name', async () => {
    const dir = await workDir()
    const target = join(dir, 'out.bin')
    await writeFile(target, 'old')
    // Every open file shares this, so the one writeAtomic opens is watched too.
    const probe = await open(join(dir, 'probe'), 'w')
    const handles = Object.getPrototypeOf(probe) as { sync: () => Promise<void> }
    await probe.close()
    const seen: string[] = []
    const sync = vi.spyOn(handles, 'sync').mockImplementation(async function (this: unknown) {
      seen.push((await readFile(target)).toString())
    })
    try {
      await writeAtomic(target, Buffer.from('new'))
    } finally {
      sync.mockRestore()
    }
    // Flushed while the old file was still the one there, so a power cut before the rename loses nothing.
    expect(seen).toEqual(['old'])
    expect((await readFile(target)).toString()).toBe('new')
  })
})

describe('sweepLeftovers', () => {
  const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

  /** Make a file or a folder, and date it `when`. */
  async function make(path: string, kind: 'file' | 'folder', when: Date): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    if (kind === 'folder') {
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'inside.bin'), 'x')
    } else {
      await writeFile(path, 'x')
    }
    await utimes(path, when, when)
  }

  async function present(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  it('removes what a crash left a day ago, and nothing else', async () => {
    const root = await workDir()
    const temp = join(root, 'temp')
    const cache = join(root, 'media-cache')
    const now = new Date()
    const gone = [
      join(temp, 'editbay-export-1700000000000'),
      join(temp, 'editbay-frame-1700000000000'),
      join(temp, 'editbay-speech-1700000000000'),
      join(cache, `.${uuid}.tmp`),
      join(cache, 'abcdef0123456789', `.${uuid}.mp4`),
      join(cache, 'abcdef0123456789', 'frames.part'),
      join(cache, 'text', `.${uuid}.tmp`)
    ]
    const kept = [
      // Still being written, as far as anyone can tell.
      join(temp, 'editbay-export-1800000000000'),
      join(cache, 'abcdef0123456789', `.${uuid}.jpg`),
      // Not a name this app makes, or not the kind it makes under that name.
      join(temp, 'editbay-media-x1y2z3'),
      join(temp, 'someone-else'),
      join(temp, 'editbay-export-1600000000000'),
      join(cache, 'abcdef0123456789', 'conformed.mp4'),
      join(cache, 'abcdef0123456789', 'frames', '0001.png'),
      join(cache, 'abcdef0123456789', '.hidden'),
      join(cache, 'abcdef0123456789', `${uuid}.tmp`),
      // Deeper than scratch files are ever written.
      join(cache, 'abcdef0123456789', 'frames', `.${uuid}.png`)
    ]
    for (const p of gone) await make(p, /^(editbay-|frames\.part)/.test(basename(p)) ? 'folder' : 'file', twoDaysAgo)
    await make(kept[0]!, 'folder', now)
    await make(kept[1]!, 'file', now)
    await make(kept[2]!, 'folder', twoDaysAgo)
    await make(kept[3]!, 'folder', twoDaysAgo)
    await make(kept[4]!, 'file', twoDaysAgo)
    for (const p of kept.slice(5)) await make(p, 'file', twoDaysAgo)

    const removed = await sweepLeftovers({ temp, cache }, now.getTime())

    for (const p of gone) expect(await present(p), p).toBe(false)
    for (const p of kept) expect(await present(p), p).toBe(true)
    expect(removed.sort()).toEqual([...gone].sort())
  })

  it('carries on when a folder is missing', async () => {
    const root = await workDir()
    await expect(sweepLeftovers({ temp: join(root, 'no-temp'), cache: join(root, 'no-cache') })).resolves.toEqual([])
  })
})
