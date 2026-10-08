import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdir, mkdtemp, rm, readdir, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-export-cache-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport, ExportFailure } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { setCrop, trimToFrame, timelineDuration, editSequence, duplicateSequence, setSequenceShape, timelineOf, v1Clips } =
  await import('../../src/shared/project')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { canEncodeOnGpu, ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { S1, clipsOf, soundsOf, firstTimeline } = await import('../project-helpers')

const fx = fixtureSet('export')
const work = await mkdtemp(join(tmpdir(), 'editbay-export-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** Decode the whole file and count the video frames. Exact, and slow enough to matter only here. */
async function countFrames(path: string): Promise<number> {
  const out = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'csv=p=0',
    path
  ])
  return Number(out.trim())
}

async function videoInfo(path: string): Promise<{ width: number; height: number; fps: number }> {
  const out = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-of', 'csv=p=0',
    path
  ])
  const [w, h, rate] = out.trim().split(',')
  const [num, den] = (rate ?? '0/1').split('/')
  return { width: Number(w), height: Number(h), fps: Number(num) / Number(den ?? 1) }
}

async function audioDuration(path: string): Promise<number> {
  const out = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=duration',
    '-of', 'csv=p=0',
    path
  ])
  return Number(out.trim())
}

/**
 * A 30fps project: a 4 second clip with sound, then a 3 second silent one.
 * The silent clip is the point: a segment missing the audio track the others
 * have is the likeliest way to break the join, and it breaks it quietly.
 */
async function twoClipProject(): Promise<void> {
  session.resetProject()
  const a = await importFile(await fx.cleanClip(), ...quiet())
  const b = await importFile(await fx.silentClip(), ...quiet())
  expect(a.status).toBe('ready')
  expect(b.status).toBe('ready')
  expect(a.hasAudio).toBe(true)
  expect(b.hasAudio).toBe(false)
  session.addAsset(a)
  session.addAsset(b)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: a.id, clipId: 'first' })
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: b.id, clipId: 'second' })
}

async function exportTo(dir: string, presetId: string, mode: 'join' | 'batch', opts: { sharpen?: boolean; fast?: boolean } = {}): Promise<string[]> {
  const project = session.getProject()
  const scratch = join(work, `scratch-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: exportNames(project, S1),
    preset: presetById(presetId),
    mode,
    outputDir: dir,
    scratchDir: scratch,
    filenamePattern: '{project}_{index}_{clip}',
    ...(opts.sharpen ? { sharpen: true } : {}),
    ...(opts.fast ? { fast: true } : {})
  })
  const outputs = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  expect(existsSync(scratch)).toBe(false)
  return outputs
}

describe('exporting one joined video', () => {
  it('produces a file at exactly the preset shape and length', async () => {
    await twoClipProject()
    const expectedFrames = timelineDuration(firstTimeline(session.getProject()))
    expect(expectedFrames).toBe(210)

    const dir = join(work, 'joined')
    const [output] = await exportTo(dir, 'vertical', 'join')
    expect(output).toBeTruthy()

    const info = await videoInfo(output!)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
    expect(info.fps).toBeCloseTo(30, 2)

    // The assertion the whole two stage render exists to make true: the joined
    // file is exactly as long as the sum of its parts, to the frame.
    expect(await countFrames(output!)).toBe(expectedFrames)
  })

  it('sharpens the picture when asked, and is still exactly as long', async () => {
    await twoClipProject()
    const [plain] = await exportTo(join(work, 'unsharpened'), 'vertical', 'join')
    const [sharp] = await exportTo(join(work, 'sharpened'), 'vertical', 'join', { sharpen: true })
    expect(await countFrames(sharp!)).toBe(timelineDuration(firstTimeline(session.getProject())))
    // The two pictures differ: identical ones compare as "inf".
    const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', plain!, '-i', sharp!, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'])
    const average = /average:(\S+)/.exec(stderr)?.[1]
    expect(average).toBeDefined()
    expect(average).not.toBe('inf')
  })

  it('exports on the graphics card where there is one: the same shape, exactly as long, and no slower', async (ctx) => {
    if (!(await canEncodeOnGpu())) ctx.skip()
    await twoClipProject()
    const began = performance.now()
    const [best] = await exportTo(join(work, 'best'), 'vertical', 'join')
    const bestMs = performance.now() - began
    const fastBegan = performance.now()
    const [fast] = await exportTo(join(work, 'fast'), 'vertical', 'join', { fast: true })
    const fastMs = performance.now() - fastBegan
    const info = await videoInfo(fast!)
    expect([info.width, info.height]).toEqual([1080, 1920])
    // Joined by copying the pieces: exactly as long as the timeline, and plays to the end.
    expect(await countFrames(fast!)).toBe(timelineDuration(firstTimeline(session.getProject())))
    const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-v', 'error', '-i', fast!, '-f', 'null', '-'])
    expect(stderr.trim()).toBe('')
    // Close to the processor's picture: over 35 dB is the same picture to the eye.
    const psnr = await capture(ffmpegPath, ['-hide_banner', '-i', best!, '-i', fast!, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'])
    expect(Number(/average:(\S+)/.exec(psnr.stderr)?.[1])).toBeGreaterThan(35)
    // No slower, with room for the card's start: on two clips this short its
    // half second of setting up per piece is most of its lead, and ffmpeg 9's
    // newer x264 made the two a coin toss (plan 89). Over ten seconds of this
    // picture the card takes 1.5 s to the processor's 2.5.
    expect(fastMs).toBeLessThan(bestMs * 1.2)
  })

  it('ends on a plain colour clip, that colour and silent for its three seconds', async () => {
    await twoClipProject()
    const before = timelineDuration(firstTimeline(session.getProject()))
    // The picture the window would draw: one colour, the sequence's size.
    const png = join(work, 'red.png')
    await capture(ffmpegPath, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=#ff0000:s=1080x1920', '-frames:v', '1', '-y', png])
    session.applyEdit({
      kind: 'addColour',
      sequenceId: S1,
      mediaId: 'red',
      clipId: 'end',
      at: before,
      colour: '#ff0000',
      drawn: { path: png, width: 1080, height: 1920 }
    })
    const after = timelineDuration(firstTimeline(session.getProject()))
    expect(after).toBe(before + 90)
    const [output] = await exportTo(join(work, 'colour-end'), 'vertical', 'join')
    expect(await countFrames(output!)).toBe(after)
    const end = await colourAt(output!, (before + 45) / 30)
    expect(end.r).toBeGreaterThan(200)
    expect(end.g + end.b).toBeLessThan(60)
    // The sound runs on to the end, silent under the colour, not cut short.
    expect(await audioDuration(output!)).toBeCloseTo(after / 30, 1)
  })

  it('carries one continuous audio track across a silent clip', async () => {
    await twoClipProject()
    const dir = join(work, 'joined-audio')
    const [output] = await exportTo(dir, 'vertical', 'join')

    const expectedSec = timelineDuration(firstTimeline(session.getProject())) / session.getProject().fps
    const audio = await audioDuration(output!)
    expect(audio).toBeGreaterThan(0)
    // Within a couple of frames of the picture, not two thirds of it, which is
    // what a missing track on the silent segment would give.
    expect(audio).toBeCloseTo(expectedSec, 1)
  })

  it('honours the crop', async () => {
    await twoClipProject()
    const p = session.getProject()
    // A narrow vertical slice out of the 640x360 source.
    session.setProject(editSequence(p, S1, (t) => setCrop(t, v1Clips(t)[0]!.id, { x: 200, y: 0, w: 202, h: 360 })))

    const dir = join(work, 'cropped')
    const [output] = await exportTo(dir, 'vertical', 'join')
    const info = await videoInfo(output!)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
  })

  it('follows a trim', async () => {
    await twoClipProject()
    const p = session.getProject()
    // O on V1, which closes up: the second clip follows the first's new end.
    session.setProject(editSequence(p, S1, (t) => trimToFrame(t, v1Clips(t)[0]!.id, 'end', 60)))
    const expectedFrames = timelineDuration(firstTimeline(session.getProject()))
    expect(expectedFrames).toBe(150)

    const dir = join(work, 'trimmed')
    const [output] = await exportTo(dir, 'vertical', 'join')
    expect(await countFrames(output!)).toBe(expectedFrames)
  })

  it('keeps every frame of a clip that runs to the end of a file whose sound outlasts its picture', async () => {
    // An MKV like OBS writes: three seconds of picture, and AAC sound that runs
    // about 20 ms longer, so the clip is one frame longer than the picture has.
    // That frame used to go missing, and the clips after it out of step.
    session.resetProject()
    const obs = await importFile(await fx.obsClip(), ...quiet())
    const clean = await importFile(await fx.cleanClip(), ...quiet())
    session.addAsset(obs)
    session.addAsset(clean)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: obs.id, clipId: 'obs' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: clean.id, clipId: 'clean' })
    const [first] = clipsOf(session.getProject())
    expect(first!.sourceOut - first!.sourceIn).toBe(91)
    const expectedFrames = timelineDuration(firstTimeline(session.getProject()))

    const [output] = await exportTo(join(work, 'sound-outlasts'), 'vertical', 'join')
    expect(await countFrames(output!)).toBe(expectedFrames)
  })

  it('exports each sequence of one project at its own size', async () => {
    await twoClipProject()
    let p = duplicateSequence(session.getProject(), S1, 'land')
    p = setSequenceShape(p, 'land', 'landscape')
    session.setProject(p)

    const expected = timelineDuration(firstTimeline(p))
    const outputs: string[] = []
    for (const [id, presetId] of [[S1, 'vertical'], ['land', 'landscape']] as const) {
      const scratch = join(work, `scratch-seq-${id}`)
      const plan = planRender({
        timeline: timelineOf(p, id),
        names: exportNames(p, id),
        preset: presetById(presetId),
        mode: 'join',
        outputDir: join(work, 'sequences'),
        scratchDir: scratch,
        filenamePattern: '{project}'
      })
      outputs.push(...(await runExport({ plan, fps: p.fps, scratchDir: scratch, onProgress: () => {} })))
    }

    // Two files, each named after its sequence, so neither overwrites the other.
    expect(outputs.map((o) => o.split(/[\\/]/).pop())).toEqual(['Untitled Vertical.mp4', 'Untitled Landscape.mp4'])
    const [vertical, landscape] = await Promise.all(outputs.map((o) => videoInfo(o)))
    expect([vertical!.width, vertical!.height]).toEqual([1080, 1920])
    expect([landscape!.width, landscape!.height]).toEqual([1920, 1080])
    for (const o of outputs) expect(await countFrames(o)).toBe(expected)
  })

  it('writes a landscape file at the landscape size', async () => {
    await twoClipProject()
    const dir = join(work, 'landscape')
    const [output] = await exportTo(dir, 'landscape', 'join')
    const info = await videoInfo(output!)
    expect(info.width).toBe(1920)
    expect(info.height).toBe(1080)
  })
})

/** Every frame of a file's picture, as a checksum each, and its sound as one. */
async function checksums(path: string): Promise<{ picture: string[]; sound: string }> {
  const lines = async (stream: string, format: string): Promise<string[]> => {
    const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-map', stream, '-f', format, '-'])
    return stdout.toString().split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('#'))
  }
  return { picture: await lines('0:v', 'framemd5'), sound: (await lines('0:a', 'md5')).join('') }
}

describe('a plain V1 clip with its first stream heard at 100%', () => {
  it('exports the same frames as before every segment put its picture\'s first frame at its start', async () => {
    session.resetProject()
    const a = await importFile(await fx.cleanClip(), ...quiet())
    session.addAsset(a)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: a.id, clipId: 'plain' })
    const project = session.getProject()
    expect(soundsOf(project).map((s) => [s.id, s.track, s.gain, s.muted])).toEqual([['plain.1', 0, 1, false]])

    const plan = (name: string): ReturnType<typeof planRender> =>
      planRender({
        timeline: firstTimeline(project),
        names: { ...exportNames(project, S1), joined: name },
        preset: presetById('vertical'),
        mode: 'join',
        outputDir: join(work, 'plain'),
        scratchDir: join(work, `scratch-${name}`),
        filenamePattern: '{project}'
      })
    const now = plan('now')
    expect(now.segments).toHaveLength(1)
    const graph = now.segments[0]!.args[now.segments[0]!.args.indexOf('-filter_complex') + 1]!
    // Today's plain command: its picture's single chain, now with its first
    // frame put at the start, and the sound's single chain from input 0.
    expect(graph).toMatch(/^\[0:v\]fps=30:start_time=0,crop=/)
    expect(graph).toContain(';[0:a:0]volume=1,aresample=async=1,apad,pan=stereo|FL=FL+FC|FR=FR+FC,aformat=')
    expect(now.segments[0]!.args.filter((x) => x === '-i')).toHaveLength(1)

    // The command as it was before, without start_time=0.
    const before = plan('before')
    before.segments = before.segments.map((s) => ({ ...s, args: s.args.map((x) => x.replace('fps=30:start_time=0', 'fps=30')) }))
    expect(before.segments[0]!.args.join(' ')).not.toContain('start_time')

    const [outNow] = await runExport({ plan: now, fps: project.fps, scratchDir: join(work, 'scratch-now'), onProgress: () => {} })
    const [outBefore] = await runExport({ plan: before, fps: project.fps, scratchDir: join(work, 'scratch-before'), onProgress: () => {} })
    expect(await countFrames(outNow!)).toBe(120)
    const [n, b] = [await checksums(outNow!), await checksums(outBefore!)]
    expect(n.picture).toHaveLength(120)
    expect(n.picture).toEqual(b.picture)
    expect(n.sound).toBe(b.sound)
  })
})

describe('exporting one file per clip', () => {
  it('writes one file for each, named from the pattern', async () => {
    await twoClipProject()
    const dir = join(work, 'batch')
    const outputs = await exportTo(dir, 'vertical', 'batch')

    expect(outputs).toHaveLength(2)
    const names = (await readdir(dir)).sort()
    expect(names).toHaveLength(2)
    expect(names[0]).toMatch(/_01_/)
    expect(names[1]).toMatch(/_02_/)
  })

  it('gives each file the right length and shape', async () => {
    await twoClipProject()
    const dir = join(work, 'batch-shape')
    const outputs = await exportTo(dir, 'vertical', 'batch')

    expect(await countFrames(outputs[0]!)).toBe(120)
    expect(await countFrames(outputs[1]!)).toBe(90)
    for (const o of outputs) {
      const info = await videoInfo(o)
      expect(info.width).toBe(1080)
      expect(info.height).toBe(1920)
      // Even the silent source gets a track, so every deliverable is uniform.
      expect(await audioDuration(o)).toBeGreaterThan(0)
    }
  })

  it('keeps the cropped region at source scale for the handoff preset', async () => {
    await twoClipProject()
    const p = session.getProject()
    session.setProject(editSequence(p, S1, (t) => setCrop(t, v1Clips(t)[0]!.id, { x: 100, y: 0, w: 300, h: 200 })))

    const dir = join(work, 'handoff')
    const outputs = await exportTo(dir, 'handoff', 'join')

    // Asked to join, but the handoff preset cannot be: its size varies per clip.
    expect(outputs).toHaveLength(2)
    const first = await videoInfo(outputs[0]!)
    expect(first.width).toBe(300)
    expect(first.height).toBe(200)
  })
})

describe('when an export goes wrong', () => {
  it('refuses an empty timeline instead of writing an empty file', async () => {
    session.resetProject()
    expect(() =>
      planRender({
        timeline: firstTimeline(session.getProject()),
        names: exportNames(session.getProject(), S1),
        preset: presetById('vertical'),
        mode: 'join',
        outputDir: work,
        scratchDir: join(work, 'never'),
        filenamePattern: '{project}'
      })
    ).toThrow(/nothing on the timeline/i)
  })

  it('names the clip that failed', async () => {
    await twoClipProject()
    const project = session.getProject()
    const scratch = join(work, 'scratch-fail')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'fail'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    // Point the second segment at a file that is not there.
    plan.segments[1]!.args[plan.segments[1]!.args.indexOf('-i') + 1] = join(work, 'missing.mp4')

    const failure = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} }).catch(
      (err: unknown) => err
    )
    // Said plainly, naming the clip, with ffmpeg's own words kept for whoever wants them.
    expect(failure).toBeInstanceOf(ExportFailure)
    expect((failure as InstanceType<typeof ExportFailure>).message).toMatch(/^Clip 2 \(.+\) could not be exported\.$/)
    expect((failure as InstanceType<typeof ExportFailure>).details).toMatch(/missing\.mp4/)
    expect(existsSync(scratch)).toBe(false)
  })

  it('stops when cancelled and leaves nothing behind', async () => {
    await twoClipProject()
    const project = session.getProject()
    const scratch = join(work, 'scratch-cancel')
    const dir = join(work, 'cancelled')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: dir,
      scratchDir: scratch,
      filenamePattern: '{project}'
    })

    const controller = new AbortController()
    const running = runExport({
      plan,
      fps: project.fps,
      scratchDir: scratch,
      onProgress: () => controller.abort(),
      signal: controller.signal
    })

    await expect(running).rejects.toThrow()
    expect(existsSync(scratch)).toBe(false)
    expect(existsSync(join(dir, 'Untitled.mp4'))).toBe(false)
  })
})

describe('export progress', () => {
  it('runs from nothing to finished, naming each clip on the way', async () => {
    await twoClipProject()
    const project = session.getProject()
    const scratch = join(work, 'scratch-progress')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'progress'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })

    const seen: number[] = []
    const stages = new Set<string>()
    await runExport({
      plan,
      fps: project.fps,
      scratchDir: scratch,
      onProgress: (p) => {
        seen.push(p.fraction)
        stages.add(p.stage)
      }
    })

    expect(stages.has('segment')).toBe(true)
    expect(stages.has('join')).toBe(true)
    expect(stages.has('done')).toBe(true)
    expect(seen.at(-1)).toBe(1)
    // Never goes backwards, which a progress bar that jumps looks broken doing.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]! - 0.001)
    }
  })
})

describe('keeping a file that is already there', () => {
  it('writes the new one beside it, and both are whole to the frame', async () => {
    await twoClipProject()
    const dir = join(work, 'keep-both')
    const [first] = await exportTo(dir, 'vertical', 'join')
    const project = session.getProject()
    const scratch = join(work, 'scratch-keep-both')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: dir,
      scratchDir: scratch,
      filenamePattern: '{project}',
      keep: [first!]
    })
    const [second] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    expect(second).toBe(join(dir, 'Untitled (2).mp4'))
    expect((await readdir(dir)).sort()).toEqual(['Untitled (2).mp4', 'Untitled.mp4'])
    const frames = timelineDuration(firstTimeline(project))
    expect(await countFrames(first!)).toBe(frames)
    expect(await countFrames(second!)).toBe(frames)
  })

  it('clears a day-old stand-in another export left under another name, and leaves a new one alone (audit 2026-10-01)', async () => {
    await twoClipProject()
    const dir = join(work, 'old-stand-ins')
    await mkdir(dir, { recursive: true })
    const old = join(dir, '.Something else.mp4.0123abcd.part.mp4')
    const fresh = join(dir, '.Running now.mp4.89abcdef.part.mp4')
    const mine = join(dir, 'notes.part.mp4')
    for (const f of [old, fresh, mine]) await writeFile(f, 'x')
    const twoDays = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await utimes(old, twoDays, twoDays)
    await utimes(mine, twoDays, twoDays)
    await exportTo(dir, 'vertical', 'join')
    const left = await readdir(dir)
    expect(left).not.toContain('.Something else.mp4.0123abcd.part.mp4')
    expect(left).toContain('.Running now.mp4.89abcdef.part.mp4')
    // Not a name an export gives: never touched.
    expect(left).toContain('notes.part.mp4')
  })
})

/**
 * The average colour of one frame, as the file actually decodes: a dissolve
 * halfway through is neither of its two pictures, and the way to know that is
 * to look at the pixels rather than at the command that made them.
 */
async function colourAt(path: string, sec: number): Promise<{ r: number; g: number; b: number }> {
  const raw = await capture(ffmpegPath, [
    '-hide_banner',
    '-v', 'error',
    // Down to the millisecond, so a frame at an exact time such as 4.4667 s is not stepped past.
    '-ss', (Math.floor(sec * 1000) / 1000).toFixed(3),
    '-i', path,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-'
  ])
  const b = raw.stdout
  let r = 0
  let g = 0
  let bl = 0
  const pixels = Math.floor(b.length / 3)
  for (let i = 0; i < pixels; i++) {
    r += b[i * 3]!
    g += b[i * 3 + 1]!
    bl += b[i * 3 + 2]!
  }
  return { r: r / pixels, g: g / pixels, b: bl / pixels }
}

/** How loud one narrow band of frequencies is over a stretch of a file, in dB. */
async function bandLevel(path: string, fromSec: number, lengthSec: number, hz: number): Promise<number> {
  const out = await capture(ffmpegPath, [
    '-hide_banner',
    '-v', 'info',
    '-ss', fromSec.toFixed(3),
    '-t', lengthSec.toFixed(3),
    '-i', path,
    // Three of them: one band pass leaves a tone an octave away only about 19 dB
    // down, which is not enough to tell a fading tone from its neighbour's leak.
    '-af', `${[0, 1, 2].map(() => `bandpass=f=${hz}:width_type=h:w=40`).join(',')},volumedetect`,
    '-f', 'null',
    '-'
  ])
  const found = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(out.stderr)
  return found ? Number(found[1]) : -100
}

describe('transitions', () => {
  /**
   * Red then blue on V1, two seconds each, with a tone under each, and half a
   * second of footage to spare on either side of the cut.
   *
   * The spare footage is the point. A transition eats into it, and two clips
   * used whole have none, so a crossfade between them would be a fade against
   * silence and a held frame, which is a different thing being tested.
   */
  async function twoColours(): Promise<void> {
    session.resetProject()
    const red = await importFile(await fx.solidClip('red', 440, 3), ...quiet())
    const blue = await importFile(await fx.solidClip('blue', 880, 3), ...quiet())
    session.addAsset(red)
    session.addAsset(blue)
    // The blue one starts thirty frames into its recording, so it has footage
    // before its first frame for a transition to reach back into.
    session.applyEdit({ kind: 'setSourceMarks', mediaId: blue.id, in: 30 })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'first' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: blue.id, clipId: 'second' })
    // The red one trimmed to sixty of its ninety frames, closing up, so it has
    // thirty frames of tail to spare and the two still meet at a cut.
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'first', frame: 60, closeUp: true })
    const t = firstTimeline(session.getProject())
    expect(v1Clips(t).map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 30, 90]
    ])
    // Both sounds on one track, meeting at the same cut: a crossfade joins two
    // clips of one track, and two tracks would be a different test.
    expect(t.audioTracks.length).toBe(1)
    expect(t.audioTracks[0]!.clips.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 30, 90]
    ])
  }

  it('fades the last clip to black, and the sequence is longer for the part hanging off it', async () => {
    await twoColours()
    const before = timelineDuration(firstTimeline(session.getProject()))
    // Half a second, centred on the end: a quarter of it hangs off the sequence.
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'out', transitionKind: 'toBlack', length: 30 })
    const after = timelineDuration(firstTimeline(session.getProject()))
    expect(after).toBe(before + 15)

    const dir = join(work, 'fade-to-black')
    const [output] = await exportTo(dir, 'vertical', 'join')
    expect(await countFrames(output!)).toBe(after)
    // Blue right up to the window, and black by the end of it.
    const early = await colourAt(output!, (after - 30) / 30)
    expect(early.b).toBeGreaterThan(100)
    const last = await colourAt(output!, (after - 1) / 30)
    expect(last.r + last.g + last.b).toBeLessThan(30)
  })

  it('dissolves between two clips, and the middle is neither of them', async () => {
    await twoColours()
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'dissolve', length: 30 })
    const dir = join(work, 'dissolve')
    const [output] = await exportTo(dir, 'vertical', 'join')
    expect(await countFrames(output!)).toBe(120)

    // The cut is at 60 frames and the window is centred on it.
    const middle = await colourAt(output!, 60 / 30)
    expect(middle.r).toBeGreaterThan(20)
    expect(middle.b).toBeGreaterThan(20)
    // Neither picture on its own: both of them are in it.
    const red = await colourAt(output!, 30 / 30)
    const blue = await colourAt(output!, 100 / 30)
    expect(middle.r).toBeLessThan(red.r - 10)
    expect(middle.b).toBeLessThan(blue.b - 10)
  })

  it('dissolves on smoothly through a clip starting on another track in the middle of it, never starting again', async () => {
    await twoColours()
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'dissolve', length: 30 })
    // A small green box on V2 from the cut on, as a title laid over the end is:
    // it cuts the dissolve's window in two.
    const green = await importFile(await fx.solidClip('green', 660, 2, 30), ...quiet())
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'box', at: 60, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'box', picture: 'main', place: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, reshapeCrop: true })
    const [output] = await exportTo(join(work, 'dissolve-split'), 'vertical', 'join')
    expect(await countFrames(output!)).toBe(120)
    // Red going out across the window, 45 to 75, frame by frame: always down, never back up at the cut.
    const reds: number[] = []
    for (let f = 48; f <= 72; f++) reds.push((await colourAt(output!, (f + 0.5) / 30)).r)
    for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeLessThanOrEqual(reds[i - 1]! + 3)
    expect(reds[0]! - reds[reds.length - 1]!).toBeGreaterThan(100)
  })

  it('dips to black smoothly through a clip starting on another track part way into the dip', async () => {
    await twoColours()
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'toBlack', length: 30 })
    const green = await importFile(await fx.solidClip('green', 660, 2, 30), ...quiet())
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // From frame 52, half way into the red side's fade to black, 45 to 60.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'box', at: 52, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'box', picture: 'main', place: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, reshapeCrop: true })
    const [output] = await exportTo(join(work, 'dip-split'), 'vertical', 'join')
    const reds: number[] = []
    for (let f = 46; f <= 59; f++) reds.push((await colourAt(output!, (f + 0.5) / 30)).r)
    for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeLessThanOrEqual(reds[i - 1]! + 3)
    expect(reds[0]! - reds[reds.length - 1]!).toBeGreaterThan(100)
  })

  it('dips to black before the cut without flashing the clip going out back in after the middle', async () => {
    await twoColours()
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'toBlack', length: 13 })
    // All before the cut at 60: to black over 47 to 54, out of it from 54 to 60.
    session.applyEdit({ sequenceId: S1, kind: 'setTransition', clipId: 'second', side: 'in', length: 13, before: 13 })
    const [output] = await exportTo(join(work, 'dip-before-cut'), 'vertical', 'join')
    const reds: number[] = []
    for (let f = 47; f <= 61; f++) reds.push((await colourAt(output!, (f + 0.5) / 30)).r)
    for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeLessThanOrEqual(reds[i - 1]! + 3)
    // From the middle on it is blue coming out of black, never red.
    expect(Math.max(...reds.slice(54 - 47))).toBeLessThan(40)
  })

  it('dissolves between a 60 fps source and a 30 fps one, which xfade is strict about', async () => {
    session.resetProject()
    const slow = await importFile(await fx.solidClip('red', 440, 3, 30), ...quiet())
    const fast = await importFile(await fx.solidClip('blue', 880, 3, 60), ...quiet())
    session.addAsset(slow)
    session.addAsset(fast)
    session.applyEdit({ kind: 'setSourceMarks', mediaId: fast.id, in: 30 })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: slow.id, clipId: 'first' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: fast.id, clipId: 'second' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'first', frame: 60, closeUp: true })
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'dissolve', length: 30 })

    const dir = join(work, 'mixed-rates')
    const [output] = await exportTo(dir, 'vertical', 'join')
    const frames = timelineDuration(firstTimeline(session.getProject()))
    // It renders at all, and to the frame: two inputs of different rates or
    // sizes are what xfade refuses or makes nonsense of.
    expect(await countFrames(output!)).toBe(frames)
    const middle = await colourAt(output!, 60 / 30)
    expect(middle.r).toBeGreaterThan(20)
    expect(middle.b).toBeGreaterThan(20)
  })

  it('crossfades the sound, with both of them heard in the middle', async () => {
    await twoColours()
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: 'dissolve', length: 30 })
    const dir = join(work, 'crossfade')
    const [output] = await exportTo(dir, 'vertical', 'join')

    // Measured against what the same band reads where that tone is definitely
    // not playing: a band pass leaks an octave away, so an absolute figure
    // would pass on the leak alone and prove nothing.
    const floor440 = await bandLevel(output!, 2.6, 0.1, 440)
    const floor880 = await bandLevel(output!, 0.5, 0.1, 880)

    // A tenth of a second after the cut, inside the window: the outgoing tone
    // is past its own last frame and is there only because the transition
    // stretched it. A fade to silence and then a fade up sounds nearly right
    // and is wrong, and only this tells the two apart.
    expect(await bandLevel(output!, 2.05, 0.1, 440)).toBeGreaterThan(floor440 + 12)
    // And before the cut the incoming one is already there, for the same reason.
    expect(await bandLevel(output!, 1.85, 0.1, 880)).toBeGreaterThan(floor880 + 12)

    // Both present is not enough on its own: two sounds simply overlapping
    // would read the same. Each one has to be on its way somewhere, so the
    // curve is measured as well as the presence.
    const loud440 = await bandLevel(output!, 1.0, 0.1, 440)
    expect(await bandLevel(output!, 2.3, 0.1, 440)).toBeLessThan(loud440 - 6)
    const loud880 = await bandLevel(output!, 3.0, 0.1, 880)
    expect(await bandLevel(output!, 1.6, 0.1, 880)).toBeLessThan(loud880 - 6)
  })
})
