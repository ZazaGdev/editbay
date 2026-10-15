import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, utimes, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NEWEST, QUIET_MS, RecordingsWatcher, newestVideos, type Entry } from '../../src/main/obs/recordings'
import type { Recording } from '../../src/shared/types'

/** A folder that exists only in the test: files by name, with a size and a time. */
let files: Map<string, Entry>
let clock: number
let announced: Recording[]
let folder: string | null
/** Whether the folder can be read, as when its disk is plugged in. */
let readable: boolean

function write(name: string, size: number, mtimeMs = clock): void {
  const path = `D:\\OBS\\${name}`
  files.set(path, { path, size, mtimeMs })
}

function watcher(): RecordingsWatcher {
  return new RecordingsWatcher(
    async () => ({ folder, fromObs: true }),
    (r) => announced.push(r),
    // As the real one does: the newest few only, and nothing when it cannot be read.
    async () => (readable ? [...files.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, NEWEST) : null),
    () => clock
  )
}

beforeEach(() => {
  files = new Map()
  clock = 1_000_000
  announced = []
  folder = 'D:\\OBS'
  readable = true
})

// Watches a made-up Windows folder, which only Windows' path rules read (plan 104).
describe.runIf(process.platform === 'win32')('the recordings watcher', () => {
  it('lists what is there, newest first, and never announces it', async () => {
    write('old.mkv', 100, clock - 60_000)
    write('older.mkv', 100, clock - 120_000)
    const w = watcher()
    const first = await w.poll()
    expect(first.recordings.map((r) => [r.name, r.recording])).toEqual([
      ['old.mkv', false],
      ['older.mkv', false]
    ])
    clock += 10_000
    await w.poll()
    expect(announced).toEqual([])
  })

  it('marks a new file as recording while it grows, and announces it once it has been still for five seconds', async () => {
    const w = watcher()
    await w.poll()
    write('new.mkv', 10)
    expect((await w.poll()).recordings[0]!.recording).toBe(true)
    clock += 3000
    write('new.mkv', 20)
    expect((await w.poll()).recordings[0]!.recording).toBe(true)
    clock += 3000
    // Unchanged for 3 seconds: not yet.
    expect((await w.poll()).recordings[0]!.recording).toBe(true)
    expect(announced).toEqual([])
    clock += QUIET_MS - 3000
    const done = await w.poll()
    expect(done.recordings[0]!.recording).toBe(false)
    expect(announced.map((r) => r.name)).toEqual(['new.mkv'])
    clock += 3000
    await w.poll()
    expect(announced).toHaveLength(1)
  })

  it('never announces a recording that was under way when it first looked', async () => {
    write('live.mkv', 10)
    const w = watcher()
    await w.poll()
    clock += 3000
    write('live.mkv', 50)
    await w.poll()
    clock += QUIET_MS + 1000
    expect((await w.poll()).recordings[0]!.recording).toBe(false)
    expect(announced).toEqual([])
  })

  it('starts again when the folder changes: what the new one holds is not announced', async () => {
    const w = watcher()
    await w.poll()
    folder = 'E:\\Elsewhere'
    write('there-already.mkv', 10, clock - 60_000)
    await w.poll()
    clock += QUIET_MS + 1000
    await w.poll()
    expect(announced).toEqual([])
  })

  it('does not announce an old recording that comes into the list when a newer one is deleted', async () => {
    for (let i = 0; i < NEWEST + 1; i++) write(`old ${i}.mkv`, 100, clock - 100_000 + i * 1000)
    const w = watcher()
    expect((await w.poll()).recordings).toHaveLength(NEWEST)
    // The oldest is not listed; deleting the newest brings it in.
    files.delete(`D:\\OBS\\old ${NEWEST}.mkv`)
    clock += 3000
    const after = await w.poll()
    expect(after.recordings.some((r) => r.name === 'old 0.mkv')).toBe(true)
    clock += QUIET_MS + 1000
    await w.poll()
    expect(announced).toEqual([])
  })

  it('does not announce a recording that was renamed', async () => {
    write('take.mkv', 100, clock - 60_000)
    const w = watcher()
    await w.poll()
    const e = files.get('D:\\OBS\\take.mkv')!
    files.delete(e.path)
    write('take renamed.mkv', e.size, e.mtimeMs)
    clock += QUIET_MS + 1000
    await w.poll()
    expect(announced).toEqual([])
  })

  it('announces nothing that was there when a folder it could not read at first comes back', async () => {
    readable = false
    write('a.mkv', 10, clock - 60_000)
    write('b.mkv', 10, clock - 50_000)
    const w = watcher()
    expect((await w.poll()).recordings).toEqual([])
    clock += 3000
    readable = true
    expect((await w.poll()).recordings).toHaveLength(2)
    clock += QUIET_MS + 1000
    await w.poll()
    expect(announced).toEqual([])
    // A new one after that is news.
    write('c.mkv', 10)
    await w.poll()
    clock += QUIET_MS + 1000
    await w.poll()
    expect(announced.map((r) => r.name)).toEqual(['c.mkv'])
  })

  it('lists nothing when there is no folder', async () => {
    folder = null
    write('a.mkv', 10)
    expect(await watcher().poll()).toEqual({ folder: null, fromObs: true, recordings: [] })
  })
})

describe('newestVideos', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'editbay-recordings-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('lists the newest video files, newest first, and nothing else', async () => {
    const at = Date.now() / 1000
    for (let i = 0; i < NEWEST + 3; i++) {
      const f = join(dir, `rec ${String(i).padStart(2, '0')}.mkv`)
      await writeFile(f, 'x')
      await utimes(f, at - 1000 + i, at - 1000 + i)
    }
    await writeFile(join(dir, 'notes.txt'), 'x')
    await mkdir(join(dir, 'folder.mp4'))
    const list = (await newestVideos(dir))!
    expect(list).toHaveLength(NEWEST)
    expect(list[0]!.path).toBe(join(dir, `rec ${NEWEST + 2}.mkv`))
    expect(list.every((e) => e.path.endsWith('.mkv'))).toBe(true)
  })

  it('says it could not read a folder that is not there, rather than calling it empty', async () => {
    expect(await newestVideos(join(dir, 'missing'))).toBeNull()
    expect(await newestVideos(dir)).toEqual([])
  })
})
