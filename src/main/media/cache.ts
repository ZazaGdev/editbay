import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, access, lstat, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { app } from 'electron'

/** Bump this when the conform command changes, to invalidate every cached file. */
export const CONFORM_SETTINGS_VERSION = 1

export interface CacheKeyInput {
  path: string
  size: number
  mtimeMs: number
  settingsVersion?: number
}

/** A stable short key for one source file under one set of conform settings. */
export function cacheKey(input: CacheKeyInput): string {
  const version = input.settingsVersion ?? CONFORM_SETTINGS_VERSION
  return createHash('sha256')
    .update(`${input.path}\u0000${input.size}\u0000${input.mtimeMs}\u0000${version}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Write a file so that it either exists complete or does not exist.
 * A crash halfway through must never leave a half file that looks finished.
 *
 * The new file is flushed to the disk before it takes the old one's name.
 * Without that, Windows can write the rename first, and a power cut in the
 * seconds after a save leaves an empty project where the saved one was, with
 * the recovery copy already dropped because the save had succeeded.
 */
export async function writeAtomic(target: string, data: Buffer): Promise<void> {
  const tmp = join(dirname(target), `.${randomUUID()}.tmp`)
  await mkdir(dirname(target), { recursive: true })
  try {
    const file = await open(tmp, 'w')
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    await renameSoon(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/**
 * Rename, trying again for a moment when Windows says the target is in use:
 * something reading it just then, such as a virus scanner or a search indexer,
 * holds it for a few milliseconds, and giving up would keep the old file.
 */
async function renameSoon(from: string, to: string): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (tries >= 10 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err
      await new Promise((resolve) => setTimeout(resolve, 20 * tries))
    }
  }
}

/** A temporary sibling path for output a process writes, keeping the extension. */
export function scratchPath(target: string): string {
  return join(dirname(target), `.${randomUUID()}${extname(target)}`)
}

export async function commitScratch(scratch: string, target: string): Promise<void> {
  await rename(scratch, target)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface DerivedPaths {
  dir: string
  conformed: string
  /** A sound file converted to play dependably. */
  sound: string
  /** A picture, upright and within the size cap, as a PNG. */
  picture: string
  peaks: string
  filmstrip: string
}

/**
 * Where the copy of one of a recording's audio tracks lives, and its waveform,
 * in the folder of the recording's other derived files. `index` counts from 0,
 * and the files are named by track number, so track 2 is `track-2.m4a`.
 */
export function trackPaths(dir: string, index: number): { path: string; peaksPath: string } {
  return { path: join(dir, `track-${index + 1}.m4a`), peaksPath: join(dir, `peaks-${index + 1}.bin`) }
}

/** Where a source's track is kept cleaned of noise, beside its copies. */
export function cleanedPath(dir: string, index: number): string {
  return join(dir, `cleaned-${index + 1}.m4a`)
}

/** Where a source's track is kept treated to a recipe (plan 81), beside its copies. */
export function treatedPath(dir: string, index: number, recipe: string): string {
  return join(dir, `treated-${index + 1}-${recipe}.m4a`)
}

/** Where a source's track is kept with its voice enhanced to a recipe, beside its copies. */
export function enhancedPath(dir: string, index: number, recipe: string): string {
  return join(dir, `voice-${index + 1}-${recipe}.m4a`)
}

/**
 * Where a recording's lighter copy for the preview is kept, beside its other
 * copies: Matroska for a Matroska or WebM recording, MP4 for anything else.
 * The copy keeps the recording's sound as it is, and the two containers write
 * where AAC sound starts differently, so a copy in the other one would play
 * its sound 21 ms off.
 */
export function proxyPath(dir: string, playable: string): string {
  return join(dir, /\.(mkv|webm)$/i.test(playable) ? 'lighter.mkv' : 'lighter.mp4')
}

/** The folder everything made from a source is kept in, and the only one it is written to. */
export function cacheRoot(): string {
  return join(app.getPath('userData'), 'media-cache')
}

/** How old something left behind must be before it is taken to be abandoned. */
export const LEFTOVER_AGE_MS = 24 * 60 * 60 * 1000

/** The folders an export, a still frame and a transcription make in the temp folder, named when they start. */
const TEMP_LEFTOVER = /^editbay-(export|frame|speech)-\d+$/

/** A file written beside its target before it is renamed into place: `writeAtomic`'s `.tmp` and `scratchPath`'s copy. */
const SCRATCH_FILE = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$/i

/** A folder filled before it is renamed into place, as a GIF's frames are. */
const SCRATCH_FOLDER = /\.part$/

export interface LeftoverRoots {
  /** The OS temp folder. */
  temp: string
  /** The media cache. */
  cache: string
}

/**
 * Remove what a crash or a killed process left behind, once it is a day old.
 *
 * Every one of these is deleted when its work finishes or fails, so one that
 * survives means the app was stopped halfway, and nothing will ever finish it:
 * an export's scratch folder in the temp folder can hold gigabytes. A day is
 * far longer than any export or import takes, so nothing still being written
 * is touched. Only names this app makes are looked at, and only in the temp
 * folder itself, the cache, and the cache's folders one level down, where
 * scratch files are written beside the files they become. A link is never
 * followed. Anything that cannot be read or removed is left for next time.
 */
/**
 * Remove the scratch files a save left beside a project when the app was
 * stopped halfway, once a day old (audit 2026-10-01): only `writeAtomic`'s own
 * hidden `.tmp` names, in that folder alone, nothing else of yours.
 */
export async function sweepBeside(dir: string, now = Date.now()): Promise<string[]> {
  const removed: string[] = []
  let list: Dirent[]
  try {
    list = await readdir(dir, { withFileTypes: true })
  } catch {
    return removed
  }
  for (const e of list) {
    if (!e.isFile() || !SCRATCH_FILE.test(e.name) || !e.name.endsWith('.tmp')) continue
    const path = join(dir, e.name)
    try {
      if (now - (await lstat(path)).mtimeMs <= LEFTOVER_AGE_MS) continue
      await rm(path, { force: true })
      removed.push(path)
    } catch {
      // In use or not ours to remove: tried again next time.
    }
  }
  return removed
}

export async function sweepLeftovers(roots: LeftoverRoots, now = Date.now()): Promise<string[]> {
  const removed: string[] = []
  const old = async (path: string): Promise<boolean> => {
    try {
      return now - (await lstat(path)).mtimeMs > LEFTOVER_AGE_MS
    } catch {
      return false
    }
  }
  const remove = async (path: string): Promise<void> => {
    if (!(await old(path))) return
    try {
      await rm(path, { recursive: true, force: true })
      removed.push(path)
    } catch {
      // In use or not ours to remove: tried again at the next start.
    }
  }
  const entries = async (dir: string): Promise<Dirent[]> => {
    try {
      return await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }

  for (const e of await entries(roots.temp)) {
    if (e.isDirectory() && TEMP_LEFTOVER.test(e.name)) await remove(join(roots.temp, e.name))
  }

  const sweepCacheFolder = async (dir: string): Promise<Dirent[]> => {
    const list = await entries(dir)
    for (const e of list) {
      if ((e.isFile() && SCRATCH_FILE.test(e.name)) || (e.isDirectory() && SCRATCH_FOLDER.test(e.name))) {
        await remove(join(dir, e.name))
      }
    }
    return list
  }
  for (const e of await sweepCacheFolder(roots.cache)) {
    if (e.isDirectory() && !SCRATCH_FOLDER.test(e.name)) await sweepCacheFolder(join(roots.cache, e.name))
  }
  return removed
}

/** Where a drawn text's picture is kept, by the key its words and style give it. */
export function textPath(key: string): string {
  return join(cacheRoot(), 'text', `${key}.png`)
}

/** Where every derived file for one source lives. */
export function derivedPaths(key: string): DerivedPaths {
  const dir = join(cacheRoot(), key)
  return {
    dir,
    conformed: join(dir, 'conformed.mp4'),
    sound: join(dir, 'sound.m4a'),
    picture: join(dir, 'picture.png'),
    peaks: join(dir, 'peaks.bin'),
    filmstrip: join(dir, 'filmstrip.jpg')
  }
}
