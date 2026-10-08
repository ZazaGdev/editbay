import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-late-sound-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { decodePeaks } = await import('../../src/main/media/waveform')
const { readFile, writeFile } = await import('node:fs/promises')
const { mixArgs, mixGraph } = await import('../../src/main/speech/transcribe')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')

/**
 * A recording whose sound starts a little after its picture, as a phone's or
 * a screen recorder's often does, cut and joined. The first piece's sound is
 * read straight out of the recording with its picture, and must start where
 * the picture does, or every sound after it in the joined file comes early.
 */

const fx = fixtureSet('late-sound-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-late-sound-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** When the beep starts: the end of the first long silence, in seconds. */
async function beepAt(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'silencedetect=n=-40dB:d=0.5', '-f', 'null', '-'
  ])
  const m = stderr.toString().match(/silence_end: ([\d.]+)/)
  if (!m?.[1]) throw new Error(`no beep found in ${path}`)
  return Number(m[1])
}

async function exportJoined(name: string): Promise<string> {
  const project = session.getProject()
  const scratch = join(work, `scratch-${name}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: { ...exportNames(project, S1), joined: name },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, 'out'),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [output] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return output!
}

describe('a recording whose sound starts after its picture', () => {
  it('keeps what follows a cut in step with its picture in a joined export', async () => {
    session.resetProject()
    const late = await importFile(await fx.lateSoundBeep(), ...quiet())
    session.addAsset(late)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: late.id, clipId: 'r' })
    // The second second taken out: 0 to 1 s, then 2 to 4 s of the recording, its beep at 3 s landing at 2 s.
    session.applyEdit({ sequenceId: S1, kind: 'split', clipId: 'r', frame: 30 })
    session.applyEdit({ sequenceId: S1, kind: 'split', clipId: clipsOf(session.getProject())[1]!.id, frame: 60 })
    session.applyEdit({ sequenceId: S1, kind: 'closeUpClip', clipId: clipsOf(session.getProject())[1]!.id })
    expect(clipsOf(session.getProject()).map((c) => [c.timelineStart, c.sourceIn])).toEqual([
      [0, 0],
      [30, 60]
    ])
    const out = await exportJoined('late')
    expect(Math.abs((await beepAt(out)) - 2)).toBeLessThan(0.02)
  })

  it('draws its waveform where its sound is heard, so Remove silences cuts the pauses it hears', async () => {
    const late = await importFile(await fx.lateSoundBeep(), ...quiet())
    // A low and a high for each moment, so the moment is half the index.
    const { peaksPerSecond, peaks } = decodePeaks(await readFile(late.peaksPath))
    const first = peaks.findIndex((v) => v > 1000)
    expect(first).toBeGreaterThan(0)
    expect(Math.abs(Math.floor(first / 2) / peaksPerSecond - 3)).toBeLessThan(0.02)
  })

  it('is heard by Make captions where it is said, so its words are not placed early', async () => {
    const late = await importFile(await fx.lateSoundBeep(), ...quiet())
    // Two seconds from one second in, put at the sequence's start: the beep at 3 s is heard at 2 s.
    const { inputs, graph } = mixGraph([{ path: late.playablePath, fromSec: 1, lengthSec: 2.5, atSec: 0, gain: 1, label: 'late', copy: false }])
    const graphPath = join(work, 'speech-graph.txt')
    const heard = join(work, 'speech.wav')
    await writeFile(graphPath, graph)
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...mixArgs(inputs, graphPath, heard)])
    expect(Math.abs((await beepAt(heard)) - 2)).toBeLessThan(0.02)
  })
})
