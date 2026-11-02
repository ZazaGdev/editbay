import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyInto, insideOf, readLevel, searchBelow, LEVEL_LIMIT } from '../../src/main/folders'

/**
 * Plan 71: one of your folders in Sources, read as it is on disk, a level at
 * a time for its tree, and searched through below. Nothing outside it is read.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-folders-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('a folder in Sources', () => {
  it('lists its subfolders and its media files by name, and nothing else', async () => {
    const dir = join(root, 'fx')
    await mkdir(join(dir, 'whooshes'), { recursive: true })
    await mkdir(join(dir, '.hidden'), { recursive: true })
    for (const n of ['whoosh 10.wav', 'whoosh 2.wav', 'logo.png', 'clip.mp4', 'notes.txt']) await writeFile(join(dir, n), 'x')
    const level = await readLevel(dir, '', false)
    expect(level.dirs).toEqual([{ name: 'whooshes', under: 'whooshes' }])
    expect(level.files!.map((f) => f.name)).toEqual(['clip.mp4', 'logo.png', 'whoosh 2.wav', 'whoosh 10.wav'])
    expect(level.more).toBe(0)
  })

  it('opens a subfolder, and lists newest first when asked', async () => {
    const dir = join(root, 'rec')
    await mkdir(join(dir, 'week 1'), { recursive: true })
    await writeFile(join(dir, 'week 1', 'old.mkv'), 'x')
    await writeFile(join(dir, 'week 1', 'new.mkv'), 'x')
    await utimes(join(dir, 'week 1', 'old.mkv'), new Date(2020, 1, 1), new Date(2020, 1, 1))
    expect((await readLevel(dir, 'week 1', true)).files!.map((f) => f.name)).toEqual(['new.mkv', 'old.mkv'])
    expect((await readLevel(dir, 'week 1', false)).files!.map((f) => f.name)).toEqual(['new.mkv', 'old.mkv'].sort())
  })

  it('says when it cannot be read, which is not the same as empty', async () => {
    const empty = join(root, 'empty')
    await mkdir(empty)
    expect((await readLevel(empty, '', false)).files).toEqual([])
    expect((await readLevel(join(root, 'unplugged'), '', false)).files).toBeNull()
  })

  it('never reads outside itself', async () => {
    expect(insideOf(join(root, 'fx'), '..')).toBeNull()
    expect(insideOf(join(root, 'fx'), '../rec')).toBeNull()
    // A drive is another place only on Windows; on a Mac this is a name like any other.
    if (process.platform === 'win32') expect(insideOf(join(root, 'fx'), 'C:\\Windows')).toBeNull()
    expect(insideOf(join(root, 'fx'), 'whooshes')).toBe(join(root, 'fx', 'whooshes'))
    expect((await readLevel(join(root, 'fx'), '../rec', false)).files).toBeNull()
  })

  it('finds a file by name in a subfolder, and says where it is', async () => {
    const dir = join(root, 'deep')
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'Big Boom.wav'), 'x')
    await writeFile(join(dir, 'boom.txt'), 'x')
    const found = await searchBelow(dir, 'boom')
    expect(found.files.map((f) => [f.name, f.under])).toEqual([['Big Boom.wav', 'a/b']])
    expect(found.cut).toBe(false)
    expect((await searchBelow(dir, '   ')).files).toEqual([])
  })

  it('lists only so many of one folder, and counts the rest', async () => {
    const dir = join(root, 'many')
    await mkdir(dir)
    await Promise.all(Array.from({ length: LEVEL_LIMIT + 3 }, (_, i) => writeFile(join(dir, `s${i}.wav`), 'x')))
    const level = await readLevel(dir, '', false)
    expect(level.files).toHaveLength(LEVEL_LIMIT)
    expect(level.more).toBe(3)
  })
})

// Task 103.
describe('a file dropped on a folder in Sources', () => {
  it('is copied in, the original left, and a name taken there keeps both with a number', async () => {
    const assets = join(root, 'assets')
    const away = join(root, 'downloads')
    await mkdir(join(assets, 'Video'), { recursive: true })
    await mkdir(away, { recursive: true })
    const original = join(away, 'subscribe.mp4')
    await writeFile(original, 'new')
    await writeFile(join(assets, 'Video', 'subscribe.mp4'), 'old')

    const made = await copyInto(assets, 'Video', [original])
    expect(made).toEqual([join(assets, 'Video', 'subscribe (2).mp4')])
    expect(await readFile(join(assets, 'Video', 'subscribe.mp4'), 'utf8')).toBe('old')
    expect(await readFile(made[0]!, 'utf8')).toBe('new')
    expect(await readdir(away)).toEqual(['subscribe.mp4'])
    expect(await copyInto(assets, 'Video', [original])).toEqual([join(assets, 'Video', 'subscribe (3).mp4')])
  })

  it('takes media files only, and nowhere outside the folder', async () => {
    const assets = join(root, 'assets2')
    await mkdir(assets, { recursive: true })
    const notes = join(root, 'notes.txt')
    await writeFile(notes, 'x')
    const clip = join(root, 'clip2.mp4')
    await writeFile(clip, 'x')
    expect(await copyInto(assets, '', [notes, join(root, 'missing.mp4')])).toEqual([])
    expect(await copyInto(assets, '..', [clip])).toEqual([])
    expect(await copyInto(assets, '', [clip])).toEqual([join(assets, 'clip2.mp4')])
  })
})
