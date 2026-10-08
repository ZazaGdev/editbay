import { open, mkdir, readdir, rm, access, type FileHandle } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { BYTES_PER_SAMPLE, OPEN_ENDED, WAV_HEADER_BYTES, wavHeader, writeWav } from './wav'

/**
 * The one take being recorded. Its samples go into a WAV of their own as they
 * arrive, "Voice over ... (recording).wav", whose header claims the most a
 * WAV can hold, so a crash or a power cut leaves a file most players still
 * open. When it stops, the take's WAV is made from it with its head lined up
 * to the frame where recording began, which is only known then, and the
 * recording is deleted. Should that fail, the recording is kept.
 */

interface Take {
  target: string
  recording: string
  handle: FileHandle
  sampleRate: number
  samples: number
  /** Chunks are written one after another, in the order they came. */
  writing: Promise<void>
}

let take: Take | null = null

/**
 * Takes left recording when the app stopped, as "Close anyway" during one
 * leaves them, by file name (audit 2026-10-01). Never removed: they are your
 * voice, and most players still open them.
 */
export async function unfinishedTakes(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).filter((n) => n.endsWith(' (recording).wav'))
  } catch {
    return []
  }
}

/** Whether a take is recording now, which closing the window would stop. */
export function recording(): boolean {
  return take !== null
}

async function taken(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Where a take's samples go while it records, beside the WAV it will become. */
export function recordingPath(target: string): string {
  const { dir, name, ext } = parse(target)
  return join(dir, `${name} (recording)${ext}`)
}

/** `name` in `folder`, or "name (2)" and so on when a take of that second is already there, or recording. */
async function freeTarget(folder: string, name: string): Promise<string> {
  const { name: stem, ext } = parse(name)
  for (let n = 1; ; n++) {
    const candidate = join(folder, n === 1 ? name : `${stem} (${n})${ext}`)
    if (!(await taken(candidate)) && !(await taken(recordingPath(candidate)))) return candidate
  }
}

/**
 * Start a take: the folder made if it is not there, and the WAV's path
 * returned. Any take still open is kept as it was recorded: its window went
 * away without stopping it, so nobody chose to throw it away (audit 2026-10-08).
 */
export async function beginTake(folder: string, name: string, sampleRate: number): Promise<string> {
  await keepTake()
  await mkdir(folder, { recursive: true })
  const target = await freeTarget(folder, name)
  const recording = recordingPath(target)
  const handle = await open(recording, 'w')
  try {
    await handle.write(wavHeader(sampleRate, 1, OPEN_ENDED))
  } catch (err) {
    await handle.close().catch(() => undefined)
    await rm(recording, { force: true })
    throw err
  }
  take = { target, recording, handle, sampleRate, samples: 0, writing: Promise.resolve() }
  return target
}

/**
 * Add 16-bit samples to the take recording now. Nothing happens when none is.
 * A write that fails rejects this and every later one, so the window can stop.
 */
export function appendTake(bytes: Uint8Array): Promise<void> {
  const t = take
  if (!t) return Promise.resolve()
  const whole = bytes.byteLength - (bytes.byteLength % BYTES_PER_SAMPLE)
  t.writing = t.writing.then(async () => {
    await t.handle.write(bytes, 0, whole)
    t.samples += whole / BYTES_PER_SAMPLE
  })
  return t.writing
}

/**
 * Stop the take and make its WAV, `drop` samples left off its head or `pad`
 * of silence put before it. The WAV's path, or null when nothing was being
 * recorded or nothing is left once its head is lined up. A take that cannot
 * be written keeps its recording, and says where.
 */
export async function finishTake(line: { drop: number; pad: number }): Promise<string | null> {
  const t = take
  if (!t) return null
  take = null
  try {
    await t.writing
  } catch (err) {
    await t.handle.close().catch(() => undefined)
    throw new Error(`${err instanceof Error ? err.message : String(err)}. What was recorded is kept as ${parse(t.recording).base}`)
  }
  await t.handle.close()
  if (t.samples - Math.max(0, Math.round(line.drop)) <= 0) {
    await rm(t.recording, { force: true })
    return null
  }
  try {
    await writeWav(t.target, t.recording, {
      sampleRate: t.sampleRate,
      samples: t.samples,
      skip: WAV_HEADER_BYTES,
      drop: line.drop,
      pad: line.pad
    })
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)}. What was recorded is kept as ${parse(t.recording).base}`)
  }
  await rm(t.recording, { force: true })
  return t.target
}

/**
 * Leave the take open now as its "(recording).wav", as a crash would, for the
 * window that was recording it is gone: crashed, or drawn again. Its header
 * claims the most a WAV can hold, so most players open it, and the project
 * names it the next time it opens.
 */
export async function keepTake(): Promise<void> {
  const t = take
  if (!t) return
  take = null
  await t.writing.catch(() => undefined)
  await t.handle.close().catch(() => undefined)
}

/** Throw the take away, leaving no file. */
export async function cancelTake(): Promise<void> {
  const t = take
  if (!t) return
  take = null
  await t.writing.catch(() => undefined)
  await t.handle.close().catch(() => undefined)
  await rm(t.recording, { force: true })
}
