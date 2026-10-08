import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExportFailure, runExport } from '../../src/main/render/runner'
import type { RenderPlan } from '../../src/shared/render-plan'
import { measureFfmpeg, runFfmpeg } from '../../src/main/ffmpeg/run'

// Nothing here starts ffmpeg: what is under test is which arguments it is handed,
// and in what order, which is the part that decides what comes out.
/** ffmpeg as far as the runner can tell: a file where it was told to write one. What becomes of that file is under test too. */
const { writesItsOutput } = vi.hoisted(() => ({
  writesItsOutput: async (args: string[]): Promise<void> => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const out = args[args.length - 1]
    if (out && /\.(mp4|mkv|png)$/.test(out)) {
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, 'new')
    }
  }
}))

vi.mock('../../src/main/ffmpeg/run', () => ({
  runFfmpeg: vi.fn(writesItsOutput),
  measureFfmpeg: vi.fn(async () => ''),
  runFfprobe: vi.fn(),
  parseProgressChunk: vi.fn()
}))

const work = await mkdtemp(join(tmpdir(), 'editbay-runner-'))

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

/** A plan of one segment with captions, which is never run: the font is looked for first. */
function captioned(): RenderPlan {
  return {
    segments: [{ clipId: 'a', index: 1, args: [], output: join(work, 'out', 'segment.mkv'), frames: 30, label: 'a', subtitles: { name: 'captions-001.ass', content: '' } }],
    join: null,
    outputs: [join(work, 'out', 'a.mp4')],
    totalFrames: 30,
    loudness: null,
    beside: []
  }
}

describe('an export with captions and no font for them', () => {
  it('is refused plainly, rather than burning the captions in another font, and leaves nothing behind', async () => {
    const empty = join(work, 'no-fonts')
    await mkdir(empty, { recursive: true })
    const scratch = join(work, 'scratch')
    const going = runExport({ plan: captioned(), fps: 30, scratchDir: scratch, onProgress: () => undefined, fontsDir: empty })
    await expect(going).rejects.toThrow(ExportFailure)
    await expect(runExport({ plan: captioned(), fps: 30, scratchDir: scratch, onProgress: () => undefined, fontsDir: empty })).rejects.toThrow(
      /their font is missing from the app/
    )
    expect(existsSync(scratch)).toBe(false)
  })

  it('is refused too when no font folder is given at all', async () => {
    await expect(runExport({ plan: captioned(), fps: 30, scratchDir: join(work, 'scratch-2'), onProgress: () => undefined })).rejects.toThrow(
      /their font is missing/
    )
  })
})

/** ffmpeg's report of a quiet recording, as the measuring pass prints it. */
const MEASURED = `[Parsed_loudnorm_0 @ 0001]
{
"input_i" : "-27.85",
"input_tp" : "-9.62",
"input_lra" : "6.70",
"input_thresh" : "-37.99",
"target_offset" : "-0.01"
}
`

/** A one segment joined export, with the sound to be levelled. */
function joined(): RenderPlan {
  const scratch = join(work, 'level', '.scratch')
  return {
    segments: [{ clipId: 'a', index: 1, args: ['-i', 'a.mp4', '-y', join(scratch, 'segment-001.mkv')], output: join(scratch, 'segment-001.mkv'), frames: 300, label: 'a' }],
    join: {
      listPath: join(scratch, 'segments.txt'),
      listContent: "file 'segment-001.mkv'\n",
      args: ['-f', 'concat', '-safe', '0', '-i', join(scratch, 'segments.txt'), '-c:v', 'copy', '-c:a', 'aac', '-y', join(work, 'level', 'out.mp4')],
      output: join(work, 'level', 'out.mp4')
    },
    outputs: [join(work, 'level', 'out.mp4')],
    totalFrames: 300,
    loudness: {
      measureArgs: ['-f', 'concat', '-safe', '0', '-i', join(scratch, 'segments.txt'), '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'],
      target: { i: -14, tp: -1, lra: 11 }
    },
    beside: []
  }
}

/** The arguments of the join, which is the last thing ffmpeg is asked to run. */
const joinCall = (): string[] => {
  const calls = vi.mocked(runFfmpeg).mock.calls
  // Written under a stand-in name until it is whole; the name it becomes is the one planned.
  return calls[calls.length - 1]![0].map((a) => {
    const stand = a.match(/^(.*[\\/])\.(.+)\.[0-9a-f]{8}\.part\.mp4$/)
    return stand ? `${stand[1]}${stand[2]}` : a
  })
}

describe('levelling the sound of a joined export', () => {
  beforeEach(() => {
    vi.mocked(runFfmpeg).mockClear()
    vi.mocked(measureFfmpeg).mockReset()
    vi.mocked(measureFfmpeg).mockResolvedValue(MEASURED)
  })

  const run = (plan: RenderPlan): Promise<string[]> =>
    runExport({ plan, fps: 30, scratchDir: join(work, 'level', '.scratch'), onProgress: () => undefined })

  it('measures before it joins, and gives the join what the measure found', async () => {
    await run(joined())
    expect(measureFfmpeg).toHaveBeenCalledTimes(1)
    // Measured after the segment is written and before the join reads it: a list
    // measured before its files exist would report silence.
    expect(vi.mocked(measureFfmpeg).mock.invocationCallOrder[0]!).toBeGreaterThan(vi.mocked(runFfmpeg).mock.invocationCallOrder[0]!)
    const args = joinCall()
    expect(args[args.indexOf('-af') + 1]).toBe(
      'loudnorm=I=-14:TP=-1:LRA=11:measured_I=-27.85:measured_TP=-9.62:measured_LRA=6.7:measured_thresh=-37.99:offset=-0.01:linear=true'
    )
    expect(args.indexOf('-af')).toBeLessThan(args.indexOf('-c:v'))
  })

  it('still exports, unlevelled, when the measuring pass fails', async () => {
    vi.mocked(measureFfmpeg).mockRejectedValue(new Error('ffmpeg fell over'))
    const plan = joined()
    await expect(run(plan)).resolves.toEqual(plan.outputs)
    expect(joinCall()).toEqual(plan.join!.args)
  })

  it('still exports, unlevelled, when the measuring pass says nothing it can read', async () => {
    vi.mocked(measureFfmpeg).mockResolvedValue('no figures here')
    const plan = joined()
    await expect(run(plan)).resolves.toEqual(plan.outputs)
    expect(joinCall()).toEqual(plan.join!.args)
  })

  it('leaves a sequence with nothing but a noise floor alone, rather than lifting it to the target', async () => {
    // A real figure, not "-inf": room tone at -62 LUFS is measurable, and levelling it
    // would put fifty decibels of hiss into the video. This is the floor doing its work,
    // not the parser refusing an unreadable block.
    vi.mocked(measureFfmpeg).mockResolvedValue(MEASURED.replace('"-27.85"', '"-62.00"'))
    const plan = joined()
    await run(plan)
    expect(joinCall()).toEqual(plan.join!.args)
  })

  it('levels a quiet sequence that is still above the floor', async () => {
    vi.mocked(measureFfmpeg).mockResolvedValue(MEASURED.replace('"-27.85"', '"-44.00"'))
    await run(joined())
    expect(joinCall()).toContain('-af')
  })

  it('does not measure at all when the plan has nothing to level, as a handoff has not', async () => {
    const plan = joined()
    await run({ ...plan, loudness: null })
    expect(measureFfmpeg).not.toHaveBeenCalled()
    expect(joinCall()).toEqual(plan.join!.args)
  })
})

describe('a subtitle file beside the video', () => {
  beforeEach(() => {
    vi.mocked(runFfmpeg).mockReset()
    vi.mocked(runFfmpeg).mockImplementation(writesItsOutput)
    vi.mocked(measureFfmpeg).mockResolvedValue(MEASURED)
  })

  const withSubtitles = (name: string): RenderPlan => ({ ...joined(), beside: [{ path: join(work, 'level', name), content: '1\n00:00:00,000 --> 00:00:01,000\nhi\n' }] })

  it('is written once the video is finished', async () => {
    await runExport({ plan: withSubtitles('done.srt'), fps: 30, scratchDir: join(work, 'level', '.scratch'), onProgress: () => undefined })
    expect(await readFile(join(work, 'level', 'done.srt'), 'utf8')).toContain('hi')
  })

  it('is not written when the video fails', async () => {
    vi.mocked(runFfmpeg).mockRejectedValue(new Error('broken'))
    await expect(
      runExport({ plan: withSubtitles('failed.srt'), fps: 30, scratchDir: join(work, 'level', '.scratch'), onProgress: () => undefined })
    ).rejects.toThrow()
    expect(existsSync(join(work, 'level', 'failed.srt'))).toBe(false)
  })
})

describe('the finished file', () => {
  const folder = join(work, 'level')
  const out = join(folder, 'out.mp4')
  const run = (): Promise<string[]> => runExport({ plan: joined(), fps: 30, scratchDir: join(folder, '.scratch'), onProgress: () => undefined })
  const leftovers = async (): Promise<string[]> => (await readdir(folder)).filter((n) => n.endsWith('.part.mp4'))

  beforeEach(async () => {
    vi.mocked(runFfmpeg).mockReset()
    vi.mocked(runFfmpeg).mockImplementation(writesItsOutput)
    vi.mocked(measureFfmpeg).mockResolvedValue('')
    await mkdir(folder, { recursive: true })
    await writeFile(out, 'old')
  })

  it('replaces the file already there only once the new one is whole', async () => {
    await run()
    expect(await readFile(out, 'utf8')).toBe('new')
    expect(await leftovers()).toEqual([])
  })

  it('leaves the file already there as it was when the export fails part way, and nothing half written beside it', async () => {
    // The join starts writing, then falls over.
    vi.mocked(runFfmpeg).mockImplementation(async (args: string[]) => {
      await writesItsOutput(args)
      if (args.includes('concat')) throw new Error('disk full')
    })
    await expect(run()).rejects.toThrow()
    expect(await readFile(out, 'utf8')).toBe('old')
    expect(await leftovers()).toEqual([])
  })

  it('leaves the file already there as it was when the export is cancelled', async () => {
    const stop = new AbortController()
    // Cancelled while the join is writing the file.
    vi.mocked(runFfmpeg).mockImplementation(async (args: string[]) => {
      await writesItsOutput(args)
      if (!args.includes('concat')) return
      stop.abort()
      throw new Error('cancelled')
    })
    await expect(runExport({ plan: joined(), fps: 30, scratchDir: join(folder, '.scratch'), onProgress: () => undefined, signal: stop.signal })).rejects.toThrow()
    expect(await readFile(out, 'utf8')).toBe('old')
    expect(await leftovers()).toEqual([])
  })
})
