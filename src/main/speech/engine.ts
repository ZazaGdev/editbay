import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { join } from 'node:path'
import { capture } from '../ffmpeg/spawn'

/**
 * The speech engine: whisper.cpp's command-line program and its English
 * model, downloaded once into the app's data folder and shared by every
 * project. Both come from fixed addresses at fixed versions, and each is
 * checked against the SHA-256 written here as it arrives, so a changed or
 * broken download is refused rather than run.
 */

/** One file the engine needs: where it comes from, and what it must be. */
export interface SpeechFile {
  name: string
  url: string
  sha256: string
  /** How big it is, for the progress while the server does not say. */
  bytes: number
}

/** whisper.cpp's Windows x64 CPU build, from its release builds. */
export const ENGINE_ZIP: SpeechFile = {
  name: 'whisper-bin-x64.zip',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
  bytes: 8573270
}

/**
 * The program in ENGINE_ZIP and every library it loads, by their SHA-256 as
 * they come in it. Checked before each run, not only at the download: a file
 * changed in the data folder since would otherwise be run (audit 2026-10-01).
 */
export const ENGINE_FILES: Readonly<Record<string, string>> = {
  'whisper-cli.exe': '19b976e037c02c0de712fa26096842d4ebafca03c976b12e8e6123215e7aab58',
  'whisper.dll': 'b7bb4ba92bd36b8afe0c00059ca6a0f69c6767193bfb5f0761e9ed27b1087803',
  'ggml.dll': 'c6e88687d6aa0238f2e834a87958f38d2dc96075a6a7bf6fb8b9cd728a0faed2',
  'ggml-base.dll': 'a5241b52206f61c9dfd6f0f53a8ef19076f9528ead2db1e039a66d7e03817bfc',
  'ggml-cpu-alderlake.dll': '5a5b11dcd38e321b13f85c95414940db9eab1132be3da6342f03dfb1d8e51bd5',
  'ggml-cpu-cannonlake.dll': '2c858781450b52eda95c381232cc65c9e19cbf621cc7b254d8c44fdbab77791e',
  'ggml-cpu-cascadelake.dll': 'ddf49bb749b34800afcb3d6224544966a05c5d00f1d0b6565bee9f3b010dd53c',
  'ggml-cpu-haswell.dll': '6b772e094b8976e22b4c043be86a1a8deda4b50511dc803a693b652c51b24944',
  'ggml-cpu-icelake.dll': 'bbd87ea5920edc401054848071ad2ef8c96bbf8007c4e4cd0ea82ba9b9e3bd10',
  'ggml-cpu-sandybridge.dll': 'de2ad5f84c7dfa557d515b3678d6452ce0216590268b2ca79cc537fe87cf239d',
  'ggml-cpu-skylakex.dll': '9fa3f9d984ca42d568181dd345072299db2978b328800343218c2c7f000b7152',
  'ggml-cpu-sse42.dll': '740fc769ef433985dfdb24a609a42d5acf188abda52287a4d89b89b567507c19',
  'ggml-cpu-x64.dll': '43ccf32b9b70aa4c47d0a12ac2ed3c241e0045571acdad565ecd9d1f99ffc08b'
}

/** A model, and the alignment heads whisper.cpp needs to put times on its words. */
export interface SpeechModel extends SpeechFile {
  /**
   * What `-dtw` is given. It names the very model being run: handed the preset
   * for a different one, whisper.cpp either refuses to start or puts the word
   * times in the wrong places, so this belongs beside the file and not in the
   * arguments.
   */
  dtw: string
}

/**
 * The medium English model, quantised, from the revision of whisper.cpp's
 * models that was current when the small one was chosen.
 *
 * The small one, `ggml-small.en-q5_1.bin`, was here until 2026-09-24. It is 190
 * MB against this one's 539 and runs about three times faster, and on clean
 * talking it is just as good. It was changed for the hard case, which is what
 * this app is mostly pointed at: a voice under game audio and gunfire, where
 * short shouted lines came back as nothing at all and no setting recovered
 * them. A bigger model is the only lever left on those.
 *
 * A machine that already has the small one keeps it. Nothing reads it any more,
 * so it can be deleted from the app's `speech` folder by hand.
 */
export const MODEL: SpeechModel = {
  name: 'ggml-medium.en-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.en-q5_0.bin',
  sha256: '76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0',
  bytes: 539225533,
  dtw: 'medium.en'
}

/** What the engine is downloaded from: the program, zipped, and the model. */
export interface SpeechSources {
  engine: SpeechFile
  model: SpeechModel
}

export const SOURCES: SpeechSources = { engine: ENGINE_ZIP, model: MODEL }

/** The folder the program is unpacked into, named after its build, so another build never mixes with this one. */
const ENGINE_DIR = 'whisper-b5130'

export interface EnginePaths {
  cli: string
  model: string
  /** The `-dtw` preset for the model at `model`, carried with it so the two cannot drift apart. */
  dtw: string
}

/** Where the engine's program and model are, in the folder it is kept in. */
export function enginePaths(folder: string, sources: SpeechSources = SOURCES): EnginePaths {
  return {
    cli: join(folder, ENGINE_DIR, 'Release', 'whisper-cli.exe'),
    model: join(folder, sources.model.name),
    dtw: sources.model.dtw
  }
}

/** A failure a person can be told about in these words. */
export class SpeechError extends Error {}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Whether the engine is there to use: only a whole, checked download ever has the names looked for. */
export async function engineReady(folder: string, sources: SpeechSources = SOURCES): Promise<boolean> {
  const paths = enginePaths(folder, sources)
  return (await isFile(paths.cli)) && (await isFile(paths.model))
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Each file found right, by its size and time, so an unchanged one is not read again every run. */
const found = new Map<string, string>()

/**
 * Whether the program and its libraries in `folder` are the ones downloaded,
 * by `files`' checksums. One missing or changed is not.
 */
export async function engineIntact(folder: string, files: Readonly<Record<string, string>> = ENGINE_FILES): Promise<boolean> {
  const dir = join(folder, ENGINE_DIR, 'Release')
  for (const [name, sha256] of Object.entries(files)) {
    const path = join(dir, name)
    let seen: string
    try {
      const s = await stat(path)
      seen = `${s.size}:${s.mtimeMs}:${sha256}`
    } catch {
      return false
    }
    if (found.get(path) === seen) continue
    if ((await sha256Of(path)) !== sha256) return false
    found.set(path, seen)
  }
  return true
}

/** The folder the program is in, taken away so the next use downloads it afresh. */
export function removeEngine(folder: string): Promise<void> {
  return rm(join(folder, ENGINE_DIR), { recursive: true, force: true })
}

/** How a file is fetched: Electron's own in the app, which follows the system's proxy, and Node's in the tests. */
export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/**
 * Download one file to `dest`. It is written beside it as `dest.part` first,
 * and checked as it comes, so only the whole right file ever has its name:
 * one that stops half way, cannot be written, or is not the file expected,
 * is deleted.
 */
export async function downloadFile(
  file: SpeechFile,
  dest: string,
  opts: { fetch: Fetcher; onBytes: (n: number) => void; signal?: AbortSignal }
): Promise<void> {
  const part = `${dest}.part`
  let res: Response
  try {
    res = await opts.fetch(file.url, opts.signal ? { signal: opts.signal } : {})
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new SpeechError(`${file.name} could not be downloaded. Check the internet connection and try again.`)
  }
  if (!res.ok || !res.body) throw new SpeechError(`${file.name} could not be downloaded: the server answered ${res.status}.`)
  const hash = createHash('sha256')
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      opts.onBytes(chunk.length)
      done(null, chunk)
    }
  })
  try {
    // One pipeline, so a failed write stops the download, and the download
    // stopping stops the write, rather than either waiting on the other.
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), counted, createWriteStream(part), opts.signal ? { signal: opts.signal } : {})
  } catch (err) {
    await rm(part, { force: true })
    if (opts.signal?.aborted) throw err
    const e = err as NodeJS.ErrnoException
    // Failed on this side: the disk is full, or the folder cannot be written.
    if (e.syscall) throw new SpeechError(`The speech model could not be saved on this computer (${e.code ?? e.message}).`)
    throw new SpeechError(`${file.name} stopped part way through downloading. Try again.`)
  }
  if (hash.digest('hex') !== file.sha256) {
    await rm(part, { force: true })
    throw new SpeechError(`${file.name} is not the file expected, so it was not used. The app may need an update.`)
  }
  await rename(part, dest)
}

/** Windows' own tar, which reads zips. */
function tarPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/** Unpack a zip into `dir`, into `dir.part` first, so a half unpacked program is never taken for a whole one. */
async function unpack(zip: string, dir: string): Promise<void> {
  const part = `${dir}.part`
  await rm(part, { recursive: true, force: true })
  await mkdir(part, { recursive: true })
  try {
    await capture(tarPath(), ['-xf', zip, '-C', part], { collectStdout: false })
  } catch {
    await rm(part, { recursive: true, force: true })
    throw new SpeechError('The speech engine could not be unpacked.')
  }
  await rm(dir, { recursive: true, force: true })
  await rename(part, dir)
}

/**
 * Download whatever of the engine is not there yet, into `folder`: the
 * program, unpacked, and the model. `onProgress` hears the share of the whole
 * download done so far.
 */
export async function installEngine(
  folder: string,
  opts: { fetch: Fetcher; onProgress: (fraction: number) => void; signal?: AbortSignal; sources?: SpeechSources }
): Promise<void> {
  const sources = opts.sources ?? SOURCES
  const paths = enginePaths(folder, sources)
  await mkdir(folder, { recursive: true })
  const total = sources.engine.bytes + sources.model.bytes
  let done = 0
  // Told only when the whole percent changes: the window hears each one, and chunks come far faster.
  let told = -1
  const onBytes = (n: number): void => {
    done += n
    const percent = Math.floor(Math.min(1, done / total) * 100)
    if (percent === told) return
    told = percent
    opts.onProgress(percent / 100)
  }
  const signal = opts.signal ? { signal: opts.signal } : {}
  if (!(await isFile(paths.cli))) {
    const zip = join(folder, sources.engine.name)
    await downloadFile(sources.engine, zip, { fetch: opts.fetch, onBytes, ...signal })
    try {
      await unpack(zip, join(folder, ENGINE_DIR))
    } finally {
      await rm(zip, { force: true })
    }
    if (!(await isFile(paths.cli))) throw new SpeechError('The speech engine download did not hold the program it should.')
  } else {
    onBytes(sources.engine.bytes)
  }
  if (!(await isFile(paths.model))) await downloadFile(sources.model, paths.model, { fetch: opts.fetch, onBytes, ...signal })
  opts.onProgress(1)
}
