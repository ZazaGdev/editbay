/**
 * Your own folders in Sources: each a name and a folder on disk, listed in
 * every project without being imported, like a small file explorer. Kept with
 * the app's settings, not in a project. One of them may be Recordings, which
 * follows OBS's folder and says when a new recording has finished.
 */

export interface SourceFolder {
  id: string
  name: string
  /**
   * An ordinary folder, Recordings, which watches for new recordings, or
   * Effects, whose files go on the timeline straight from it and onto a clip
   * (plan 90).
   */
  kind: 'folder' | 'recordings' | 'effects'
  /**
   * The folder on disk. Recordings may have none, and then follows OBS's own
   * folder; an ordinary entry always has one.
   */
  folder: string | null
  /** Newest first rather than by name. */
  newestFirst: boolean
}

/** The most entries kept. A list longer than this is a mistake, not a preference. */
export const MAX_SOURCE_FOLDERS = 30
/** The longest name kept. */
export const MAX_FOLDER_NAME = 60

/** What Recordings is called until it is renamed. */
export const RECORDINGS_NAME = 'Recordings'
/**
 * What the assets folder is called until it is renamed (plan 96). It took
 * over from the effects folder of plan 90, whose entry it still is: one
 * still called by that folder's old name is shown by the new one.
 */
export const EFFECTS_NAME = 'Assets'
const OLD_EFFECTS_NAME = 'Effects'

function newId(): string {
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A name as kept: trimmed, one line, and not too long. */
export function cleanFolderName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME)
}

/** The last part of a folder's path, as a name for it. */
export function folderNameOf(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return cleanFolderName(parts.at(-1) || path) || 'Folder'
}

/**
 * The entries as kept, from something that may not be whole, as a settings
 * file gives it: a damaged entry goes and the rest stay, an id seen twice
 * keeps the first, and only the first Recordings is kept.
 */
export function cleanSourceFolders(raw: unknown): SourceFolder[] {
  if (!Array.isArray(raw)) return []
  const out: SourceFolder[] = []
  const ids = new Set<string>()
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue
    const e = x as Partial<SourceFolder>
    const kind = e.kind === 'recordings' || e.kind === 'folder' || e.kind === 'effects' ? e.kind : null
    if (!kind || typeof e.id !== 'string' || e.id === '' || ids.has(e.id)) continue
    if (kind !== 'folder' && out.some((f) => f.kind === kind)) continue
    const folder = typeof e.folder === 'string' && e.folder.trim() !== '' ? e.folder : null
    if (kind !== 'recordings' && folder === null) continue
    const given = typeof e.name === 'string' ? cleanFolderName(e.name) : ''
    const name = kind === 'effects' && given === OLD_EFFECTS_NAME ? EFFECTS_NAME : given
    ids.add(e.id)
    out.push({
      id: e.id,
      name: name || (kind === 'recordings' ? RECORDINGS_NAME : kind === 'effects' ? EFFECTS_NAME : folderNameOf(folder!)),
      kind,
      folder,
      newestFirst: typeof e.newestFirst === 'boolean' ? e.newestFirst : kind === 'recordings'
    })
    if (out.length >= MAX_SOURCE_FOLDERS) break
  }
  return out
}

/**
 * The entries the first time, from what Sources had before them: Recordings,
 * on the folder chosen for it or else OBS's, and the library's video and
 * sound folders, where they were set.
 */
export function firstSourceFolders(old: { recordingsFolder?: unknown; libraryVideoFolder?: unknown; librarySoundFolder?: unknown }): SourceFolder[] {
  const path = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null)
  const video = path(old.libraryVideoFolder)
  const sound = path(old.librarySoundFolder)
  return [
    { id: 'recordings', name: RECORDINGS_NAME, kind: 'recordings', folder: path(old.recordingsFolder), newestFirst: true },
    ...(video ? [{ id: 'library-video', name: 'Video library', kind: 'folder' as const, folder: video, newestFirst: false }] : []),
    ...(sound ? [{ id: 'library-sound', name: 'Sound library', kind: 'folder' as const, folder: sound, newestFirst: false }] : [])
  ]
}

/** A new entry for a folder, named after it, at the end. */
export function addFolder(list: SourceFolder[], folder: string, makeId: () => string = newId): SourceFolder[] {
  if (list.length >= MAX_SOURCE_FOLDERS) return list
  return [...list, { id: makeId(), name: folderNameOf(folder), kind: 'folder', folder, newestFirst: false }]
}

/** Recordings back, at the top, following OBS's folder, when there is none. */
export function addRecordings(list: SourceFolder[]): SourceFolder[] {
  if (list.some((f) => f.kind === 'recordings') || list.length >= MAX_SOURCE_FOLDERS) return list
  const id = list.some((f) => f.id === 'recordings') ? newId() : 'recordings'
  return [{ id, name: RECORDINGS_NAME, kind: 'recordings', folder: null, newestFirst: true }, ...list]
}

/**
 * The effects folder set, pointed elsewhere, or taken out with null: one at
 * most, listed after Recordings so it is near the top.
 */
export function setEffectsFolder(list: SourceFolder[], folder: string | null): SourceFolder[] {
  const now = list.find((f) => f.kind === 'effects')
  if (folder === null) return list.filter((f) => f.kind !== 'effects')
  if (now) return list.map((f) => (f.kind === 'effects' ? { ...f, folder } : f))
  if (list.length >= MAX_SOURCE_FOLDERS) return list
  const id = list.some((f) => f.id === 'effects') ? newId() : 'effects'
  const entry: SourceFolder = { id, name: EFFECTS_NAME, kind: 'effects', folder, newestFirst: false }
  const after = list.findIndex((f) => f.kind === 'recordings') + 1
  return [...list.slice(0, after), entry, ...list.slice(after)]
}

/** The effects folder, if one is set. */
export function effectsFolderOf(list: readonly SourceFolder[]): SourceFolder | null {
  return list.find((f) => f.kind === 'effects') ?? null
}

/** An entry renamed. An empty name leaves it as it was. */
export function renameFolder(list: SourceFolder[], id: string, name: string): SourceFolder[] {
  const clean = cleanFolderName(name)
  return clean === '' ? list : list.map((f) => (f.id === id ? { ...f, name: clean } : f))
}

/** An entry on another folder. */
export function changeFolder(list: SourceFolder[], id: string, folder: string): SourceFolder[] {
  return list.map((f) => (f.id === id ? { ...f, folder } : f))
}

export function setNewestFirst(list: SourceFolder[], id: string, on: boolean): SourceFolder[] {
  return list.map((f) => (f.id === id ? { ...f, newestFirst: on } : f))
}

/** An entry taken out of the list, and where it was, for putting it back. The files on disk are never touched. */
export function removeFolder(list: SourceFolder[], id: string): { list: SourceFolder[]; removed: SourceFolder | null; at: number } {
  const at = list.findIndex((f) => f.id === id)
  if (at < 0) return { list, removed: null, at: -1 }
  return { list: list.filter((f) => f.id !== id), removed: list[at]!, at }
}

/** An entry put back where it was, unless one like it has come back meanwhile. */
export function restoreFolder(list: SourceFolder[], entry: SourceFolder, at: number): SourceFolder[] {
  if (list.some((f) => f.id === entry.id) || (entry.kind === 'recordings' && list.some((f) => f.kind === 'recordings'))) return list
  const next = [...list]
  next.splice(Math.max(0, Math.min(at, next.length)), 0, entry)
  return next.slice(0, MAX_SOURCE_FOLDERS)
}

/** An entry moved to sit at `to` in the list as it will be. */
export function moveFolder(list: SourceFolder[], id: string, to: number): SourceFolder[] {
  const from = list.findIndex((f) => f.id === id)
  if (from < 0) return list
  const next = list.filter((f) => f.id !== id)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, list[from]!)
  return next
}
