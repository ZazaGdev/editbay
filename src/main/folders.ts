import { constants, copyFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FolderFile, FolderListing, FolderSearch } from '../shared/types'

/**
 * Your own folders in Sources, read as they are on disk each time they are
 * looked at: a file dropped into one is there the next time. Bringing one in
 * makes it a source of the project, like any other, so a project never needs
 * the folder to open.
 */

/** What can be brought in: video, sound and pictures. */
const MEDIA = new Set([
  '.mkv', '.mp4', '.mov', '.m4v', '.webm', '.avi', '.ts', '.flv',
  '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'
])

/** How many of one folder's files are listed. The rest are counted, and the search finds them. */
export const LEVEL_LIMIT = 500
/** A search stops after reading this many folders, or finding this many files, rather than reading a whole drive. */
export const SEARCH_FOLDERS = 2000
export const SEARCH_FOUND = 200
/** And never goes deeper than this below the entry's folder. */
export const SEARCH_DEPTH = 8

/** Folders nobody keeps media in, which Windows puts at the top of a drive. */
function skipped(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || name === 'System Volume Information'
}

/**
 * The folder at `under` below `root`, or null when `under` would lead
 * anywhere outside it. The window names only an entry and a path under it,
 * so nothing it sends can have another folder read.
 */
export function insideOf(root: string, under: string): string | null {
  const top = resolve(root)
  const at = resolve(top, under)
  const rel = relative(top, at)
  if (rel === '') return top
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null
  return at
}

function underOf(root: string, dir: string): string {
  return relative(resolve(root), dir).split(sep).join('/')
}

async function fileAt(dir: string, name: string, under?: string): Promise<FolderFile | null> {
  const path = join(dir, name)
  try {
    const s = await stat(path)
    return s.isFile() ? { path, name, size: s.size, modifiedAt: s.mtimeMs, ...(under !== undefined ? { under } : {}) } : null
  } catch {
    return null
  }
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * One level of an entry's folder: its subfolders by name, and its media
 * files, by name or newest first. Null files when it cannot be read, as when
 * its drive is not plugged in.
 */
export async function readLevel(root: string, under: string, newestFirst: boolean): Promise<FolderListing> {
  const dir = insideOf(root, under)
  if (!dir) return { folder: root, dirs: [], files: null, more: 0 }
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { folder: root, dirs: [], files: null, more: 0 }
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !skipped(e.name))
    .map((e) => ({ name: e.name, under: underOf(root, join(dir, e.name)) }))
    .sort(byName)
  const files = (await Promise.all(entries.filter((e) => !e.isDirectory() && MEDIA.has(extname(e.name).toLowerCase())).map((e) => fileAt(dir, e.name))))
    .filter((f): f is FolderFile => f !== null)
    .sort(newestFirst ? (a, b) => b.modifiedAt - a.modifiedAt : byName)
  return { folder: root, dirs, files: files.slice(0, LEVEL_LIMIT), more: Math.max(0, files.length - LEVEL_LIMIT) }
}

/**
 * The media files named with `words` in an entry's folder and below it, each
 * with where it is under the folder, by name. Folder by folder, nearest
 * first, stopping at the limits and saying so.
 */
export async function searchBelow(root: string, words: string): Promise<FolderSearch> {
  const wanted = words.trim().toLowerCase()
  if (wanted === '') return { files: [], cut: false }
  const found: FolderFile[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: resolve(root), depth: 0 }]
  let read = 0
  let cut = false
  while (queue.length > 0) {
    if (read >= SEARCH_FOLDERS || found.length >= SEARCH_FOUND) {
      cut = true
      break
    }
    const { dir, depth } = queue.shift()!
    read++
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const under = underOf(root, dir)
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skipped(e.name) && depth < SEARCH_DEPTH) queue.push({ dir: join(dir, e.name), depth: depth + 1 })
      } else if (MEDIA.has(extname(e.name).toLowerCase()) && e.name.toLowerCase().includes(wanted)) {
        const f = await fileAt(dir, e.name, under)
        if (f) found.push(f)
      }
    }
  }
  return { files: found.slice(0, SEARCH_FOUND).sort(byName), cut }
}

/**
 * Task 103: media files copied into the folder at `under` below `root`, each
 * left where it was. A name already taken there is kept, and the copy gets
 * " (2)", " (3)" and so on before its extension. Anything that is not a
 * media file, or a folder outside `root`, is left alone. The copies' paths.
 */
export async function copyInto(root: string, under: string, paths: readonly string[]): Promise<string[]> {
  const dir = insideOf(root, under)
  if (!dir) return []
  const made: string[] = []
  for (const from of paths) {
    if (!MEDIA.has(extname(from).toLowerCase())) continue
    try {
      if (!(await stat(from)).isFile()) continue
    } catch {
      continue
    }
    // Already in this folder: nothing to copy.
    if (resolve(from).toLowerCase() === join(dir, basename(from)).toLowerCase()) continue
    const ext = extname(from)
    const stem = basename(from, ext)
    for (let n = 1; n < 1000; n++) {
      const to = join(dir, n === 1 ? `${stem}${ext}` : `${stem} (${n})${ext}`)
      try {
        // Never over a file that is there: a taken name fails, and the next number is tried.
        await copyFile(from, to, constants.COPYFILE_EXCL)
        made.push(to)
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') break
      }
    }
  }
  return made
}
