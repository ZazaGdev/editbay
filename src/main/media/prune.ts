import { access, lstat, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { framePath, isAnimated, type ProjectMedia } from '../../shared/project'
import { MEDIA_FIELDS, pathKind } from '../../shared/source-paths'

/**
 * Keeping the media cache from growing for ever (audit 2026-10-01).
 *
 * Everything made from a source lives in its own folder in the cache, and a
 * drawn text or shape is a picture in its `text` folder. A project opened
 * marks what it uses as used now; what nothing has used for a long while is
 * removed. A project opened after that makes again what it misses, as it does
 * after the cache is cleared by hand, so nothing of yours is ever lost: only
 * time, the next time that project is opened.
 */

/**
 * The file in a source's folder that names the recording it was made from.
 * A conformed copy plays on after its original is deleted, and is then the
 * only copy of that footage: a folder whose original is gone, or cannot be
 * told, is never removed (audit 2026-10-08).
 */
const ORIGINAL = 'original.txt'

/** The copies a source can play from in place of its original. */
const PLAYABLE_COPIES = ['conformed.mp4', 'sound.m4a']

/** Note in a source's folder which recording it was made from, once. */
export async function recordOriginal(dir: string, original: string): Promise<void> {
  const record = join(dir, ORIGINAL)
  if (await there(record)) return
  await mkdir(dir, { recursive: true })
  await writeFile(record, original, 'utf8')
}

/**
 * Note for each source which recording its folder in the cache was made
 * from, where that is not noted yet: what the folders made before the note
 * existed learn as their project opens.
 */
export async function recordOriginals(root: string, media: readonly ProjectMedia[]): Promise<void> {
  for (const m of media) {
    if (m.text !== undefined) continue
    for (const name of cacheUsedBy(root, [m])) {
      const dir = join(root, name)
      if (!name.startsWith(`${TEXT}/`) && (await there(dir))) await recordOriginal(dir, m.originalPath).catch(() => undefined)
    }
  }
}

async function there(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a source's folder may hold the only copy of its footage: its
 * original is gone, or on another computer, which is not reached to find out,
 * or not noted and the folder holds a copy that plays in its place.
 */
async function mayBeOnlyCopy(dir: string): Promise<boolean> {
  let original: string | null = null
  try {
    original = (await readFile(join(dir, ORIGINAL), 'utf8')).trim()
  } catch {
    // Made before the note: only what cannot play in its place may go.
  }
  if (original === null) {
    for (const name of PLAYABLE_COPIES) if (await there(join(dir, name))) return true
    return false
  }
  return pathKind(original) !== 'local' || !(await there(original))
}

/** How long something in the cache may go unused before it is removed. */
export const UNUSED_FOR_MS = 60 * 24 * 60 * 60 * 1000

/** The folder drawn texts are kept in, in the cache. */
const TEXT = 'text'

/** Every file a source names, as the record of its fields says which hold files. */
function filesOf(m: ProjectMedia): string[] {
  const out: string[] = []
  const collect = (v: unknown): void => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(collect)
  }
  for (const [key, kind] of Object.entries(MEDIA_FIELDS)) if (kind === 'file') collect(m[key as keyof ProjectMedia])
  // Every picture of a run, a shape drawing itself on or an animation, not only the first (plan 88).
  if (isAnimated(m)) for (let i = 1; i < (m.frames ?? 1); i++) out.push(framePath(m, i))
  return out
}

/**
 * What of the cache these sources use: each source's folder by its name, and
 * each drawn picture as `text/<its name>`. Paths outside the cache are not.
 */
export function cacheUsedBy(root: string, media: readonly ProjectMedia[]): Set<string> {
  const used = new Set<string>()
  for (const m of media) {
    for (const path of filesOf(m)) {
      const inside = relative(root, path)
      if (inside === '' || inside.startsWith('..') || /^[a-z]:/i.test(inside)) continue
      const parts = inside.split(/[\\/]/)
      if (parts[0] === TEXT && parts[1]) used.add(`${TEXT}/${parts[1]}`)
      else if (parts[0]) used.add(parts[0])
    }
  }
  return used
}

/** Mark what is used as used now, so a project opened often keeps what it made long ago. */
export async function markUsed(root: string, used: ReadonlySet<string>, now = Date.now()): Promise<void> {
  const when = new Date(now)
  for (const name of used) {
    try {
      await utimes(join(root, ...name.split('/')), when, when)
    } catch {
      // Not there: it is made again when it is wanted.
    }
  }
}

/** How many bytes a file or folder holds. A link is never followed. */
async function sizeOf(path: string): Promise<number> {
  try {
    const s = await lstat(path)
    if (!s.isDirectory()) return s.isFile() ? s.size : 0
    let total = 0
    for (const e of await readdir(path)) total += await sizeOf(join(path, e))
    return total
  } catch {
    return 0
  }
}

/** How much room the cache takes on the disk, in bytes. */
export function cacheSize(root: string): Promise<number> {
  return sizeOf(root)
}

/** One thing in the cache that could go: a source's folder, or a drawn picture. */
interface Entry {
  name: string
  path: string
}

async function entriesOf(root: string): Promise<Entry[]> {
  const out: Entry[] = []
  let top: string[]
  try {
    top = await readdir(root)
  } catch {
    return out
  }
  for (const name of top) {
    const path = join(root, name)
    if (name === TEXT) {
      let pictures: string[] = []
      try {
        pictures = await readdir(path)
      } catch {
        // Unreadable: left alone.
      }
      for (const p of pictures) out.push({ name: `${TEXT}/${p}`, path: join(path, p) })
    } else {
      out.push({ name, path })
    }
  }
  return out
}

/**
 * Remove what in the cache is not in `used` and has not been used for
 * `unusedFor`: a source's whole folder, or one drawn picture. Anything that
 * cannot be read or removed, such as a file being written just now, is left.
 * Gives how many bytes were freed.
 */
export async function pruneCache(root: string, used: ReadonlySet<string>, unusedFor = UNUSED_FOR_MS, now = Date.now()): Promise<number> {
  let freed = 0
  for (const e of await entriesOf(root)) {
    if (used.has(e.name)) continue
    try {
      const s = await lstat(e.path)
      // Only what the app made: never a link, and never something written in the last minute.
      if (s.isSymbolicLink() || now - s.mtimeMs <= Math.max(unusedFor, 60_000)) continue
      if (s.isDirectory() && (await mayBeOnlyCopy(e.path))) continue
      const bytes = await sizeOf(e.path)
      await rm(e.path, { recursive: true, force: true })
      freed += bytes
    } catch {
      // In use or not removable: tried again next time.
    }
  }
  return freed
}
