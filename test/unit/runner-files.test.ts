import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runExport, segmentsAtOnce, withCardDecoding } from '../../src/main/render/runner'
import type { RenderPlan } from '../../src/shared/render-plan'
import { runFfmpeg } from '../../src/main/ffmpeg/run'

/** Whether the next renames onto a finished file's name fail as a player holding it makes them. */
const lock = vi.hoisted(() => ({ times: 0, file: '.mp4' }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      if (lock.times > 0 && to.endsWith(lock.file)) {
        lock.times -= 1
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      }
      return real.rename(from, to)
    }
  }
})

vi.mock('../../src/main/ffmpeg/run', () => ({
  // Writes a file where it was told to, as ffmpeg does.
  runFfmpeg: vi.fn(async (args: string[]) => {
    const { mkdir: made, writeFile: wrote } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const out = args[args.length - 1]!
    await made(dirname(out), { recursive: true })
    await wrote(out, 'new')
  }),
  measureFfmpeg: vi.fn(async () => ''),
  runFfprobe: vi.fn(),
  parseProgressChunk: vi.fn()
}))

const work = await mkdtemp(join(tmpdir(), 'editbay-runner-files-'))
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

let folder = ''
beforeEach(async () => {
  lock.times = 0
  lock.file = '.mp4'
  vi.mocked(runFfmpeg).mockClear()
  folder = await mkdtemp(join(work, 'out-'))
})

/** One file per clip, two clips, each written straight to its own name in `folder`. */
function batch(frames = 30): RenderPlan {
  const a = join(folder, 'a.mp4')
  const b = join(folder, 'b.mp4')
  return {
    segments: [
      { clipId: 'a', index: 1, args: ['-i', 'a.mov', '-y', a], output: a, frames, label: 'a' },
      { clipId: 'b', index: 2, args: ['-i', 'b.mov', '-y', b], output: b, frames, label: 'b' }
    ],
    join: null,
    outputs: [a, b],
    totalFrames: 2 * frames,
    loudness: null,
    beside: []
  }
}

const run = (plan: RenderPlan): Promise<string[]> => runExport({ plan, fps: 30, scratchDir: join(folder, '.scratch'), onProgress: () => undefined })

describe('a file open in another program', () => {
  it('is replaced once it lets go, a moment later', async () => {
    await writeFile(join(folder, 'a.mp4'), 'old')
    lock.times = 2
    await run(batch())
    expect(await readFile(join(folder, 'a.mp4'), 'utf8')).toBe('new')
  })

  it('stops the export with a plain reason, and keeps the new video beside it rather than throwing it away', async () => {
    await writeFile(join(folder, 'a.mp4'), 'old')
    // Only a.mp4 held: b may be made beside it, two at a time, and take its name.
    lock.times = 100
    lock.file = 'a.mp4'
    await expect(run(batch())).rejects.toThrow(/a\.mp4 is open in another program/)
    expect(await readFile(join(folder, 'a.mp4'), 'utf8')).toBe('old')
    const kept = (await readdir(folder)).filter((n) => n.endsWith('.part.mp4'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(folder, kept[0]!), 'utf8')).toBe('new')
  }, 30_000)
})

describe('a file of its own for each clip', () => {
  it('keeps the clips finished before one that fails', async () => {
    vi.mocked(runFfmpeg).mockImplementationOnce(async (args: string[]) => {
      await writeFile(args[args.length - 1]!, 'new')
    })
    // Broken whichever way it is decoded: on the card on Windows, then on the processor.
    const broken = async (): Promise<void> => {
      throw new Error('broken')
    }
    // Tried twice only where there is a card to try first; a failure left queued would break the next test.
    const once = vi.mocked(runFfmpeg).mockImplementationOnce(broken)
    if (process.platform === 'win32') once.mockImplementationOnce(broken)
    await expect(run(batch())).rejects.toThrow()
    expect(await readFile(join(folder, 'a.mp4'), 'utf8')).toBe('new')
    expect((await readdir(folder)).filter((n) => n !== 'a.mp4')).toEqual([])
  })
})

describe('decoding on the graphics card', () => {
  it('asks for it before every input on Windows, and nowhere else', () => {
    const args = ['-ss', '1', '-i', 'a.mov', '-f', 'lavfi', '-i', 'color=c=black', '-y', 'out.mkv']
    expect(withCardDecoding(args, 'win32')).toEqual(['-ss', '1', '-hwaccel', 'd3d11va', '-i', 'a.mov', '-f', 'lavfi', '-hwaccel', 'd3d11va', '-i', 'color=c=black', '-y', 'out.mkv'])
    expect(withCardDecoding(args, 'darwin')).toBe(args)
    expect(withCardDecoding(args, 'linux')).toBe(args)
  })

  it('makes a segment again on the processor when the card fails it', async () => {
    if (process.platform !== 'win32') return
    vi.mocked(runFfmpeg).mockClear()
    vi.mocked(runFfmpeg).mockImplementationOnce(async () => {
      throw new Error('card failed')
    })
    // Long enough to be decoded on the card: 30 s.
    await run(batch(900))
    const calls = vi.mocked(runFfmpeg).mock.calls.map((c) => c[0]).filter((args) => args.includes('a.mov'))
    expect(calls[0]).toContain('-hwaccel')
    expect(calls[1]).not.toContain('-hwaccel')
    expect(await readFile(join(folder, 'a.mp4'), 'utf8')).toBe('new')
  })

  it('leaves a short segment to the processor, where the card is slower to start than it saves', async () => {
    await run(batch(30))
    const calls = vi.mocked(runFfmpeg).mock.calls.map((c) => c[0])
    expect(calls.some((args) => args.includes('-hwaccel'))).toBe(false)
  })
})

describe('segments at once', () => {
  it('runs two at a time with eight threads or more, one with fewer', () => {
    expect(segmentsAtOnce(16)).toBe(2)
    expect(segmentsAtOnce(8)).toBe(2)
    expect(segmentsAtOnce(4)).toBe(1)
  })
})

describe('what an export killed part way left', () => {
  it('is cleared by the next export to the same name, and nothing else is', async () => {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, '.a.mp4.0badf00d.part.mp4'), 'left over')
    await writeFile(join(folder, '.a.mp4.notmine.part.mp4'), 'not ours')
    await writeFile(join(folder, '.other.mp4.0badf00d.part.mp4'), 'another name')
    await run(batch())
    expect((await readdir(folder)).sort()).toEqual(['.a.mp4.notmine.part.mp4', '.other.mp4.0badf00d.part.mp4', 'a.mp4', 'b.mp4'])
  })
})
