import { createHash } from 'node:crypto'
import { readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { writeAtomic } from '../media/cache'

/**
 * Recovery copies: the open project, written every minute while it has
 * unsaved changes, so a crash costs at most that minute.
 *
 * They live in the app's own folder rather than beside the project, so they
 * never clutter a folder you look in and a project never saved has somewhere
 * to go. Each copy says which project it belongs to and when it was written,
 * so there is no separate index to fall out of step with the copies.
 */

const EXTENSION = '.editbay-recovery'
const UNTITLED_FILE = `untitled${EXTENSION}`
/** A copy set aside while it is offered, out of the way of the autosave. */
const HELD_PREFIX = 'offered-'

export interface RecoveryCopy {
  file: string
  /** The project file this is a copy of, or null for a project never saved. */
  recoveryOf: string | null
  name: string
  /** Milliseconds since 1970. */
  writtenAt: number
  /**
   * Set aside at a launch that offered it, and not yet restored or
   * discarded. Only you can decide it is no longer wanted.
   */
  held: boolean
}

export function recoveryDir(settingsDir: string): string {
  return join(settingsDir, 'recovery')
}

/**
 * The file a project's copies go in. The same project always lands on the
 * same file, so each write replaces the last, and a copy can never be written
 * to the project's own path.
 */
export function recoveryFileName(projectPath: string | null): string {
  if (!projectPath) return UNTITLED_FILE
  // Windows paths ignore case, so one project must not become two copies.
  const hash = createHash('sha256').update(projectPath.toLowerCase()).digest('hex').slice(0, 16)
  return `${hash}${EXTENSION}`
}

export interface RecoveryChoice {
  /** The copy to offer, or null when every copy was overtaken by a save. */
  offer: RecoveryCopy | null
  /** Copies older than their project file, which a later save made pointless. */
  stale: RecoveryCopy[]
}

/**
 * Which copy to offer at launch, from times and paths alone.
 *
 * A save or a clean close removes a project's copy, so any copy still there
 * means the app did not close cleanly. A copy is stale when its project file
 * already holds exactly its work, as when the app stopped between writing a
 * save and removing the copy; any other is worth offering. Decided by what
 * the two hold, never by comparing this computer's clock with a file's time,
 * which a NAS keeps by its own clock (audit 2026-10-01). When several are
 * worth offering, the newest is; the rest wait.
 *
 * A copy set aside by an earlier launch is never stale, however the project
 * file has changed since: it was offered, and nobody has answered yet.
 *
 * `saved` says whether a copy's project file holds exactly its work.
 */
export function chooseRecovery(copies: RecoveryCopy[], saved: (copy: RecoveryCopy) => boolean): RecoveryChoice {
  const stale: RecoveryCopy[] = []
  let offer: RecoveryCopy | null = null
  for (const copy of copies) {
    if (!copy.held && copy.recoveryOf !== null && saved(copy)) {
      stale.push(copy)
      continue
    }
    if (!offer || copy.writtenAt > offer.writtenAt) offer = copy
  }
  return { offer, stale }
}

interface StoredCopy {
  recoveryOf: string | null
  name: string
  writtenAt: number
  /** The project file's own content, exactly as saving it would write it. */
  document: unknown
}

/** Write a copy of a project, whole or not at all. Returns where it went. */
export async function writeRecovery(
  dir: string,
  copy: { recoveryOf: string | null; name: string; writtenAt: number },
  documentText: string
): Promise<string> {
  const file = join(dir, recoveryFileName(copy.recoveryOf))
  const stored: StoredCopy = { ...copy, document: JSON.parse(documentText) }
  await writeAtomic(file, Buffer.from(JSON.stringify(stored, null, 2)))
  return file
}

/** Every copy in the folder. A file that cannot be read is skipped, never fatal. */
export async function listRecovery(dir: string): Promise<RecoveryCopy[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const copies: RecoveryCopy[] = []
  for (const name of names) {
    if (!name.endsWith(EXTENSION)) continue
    const file = join(dir, name)
    try {
      const raw = JSON.parse((await readFile(file)).toString()) as Partial<StoredCopy>
      if (typeof raw.writtenAt !== 'number' || raw.document === undefined) continue
      copies.push({
        file,
        recoveryOf: typeof raw.recoveryOf === 'string' ? raw.recoveryOf : null,
        name: typeof raw.name === 'string' ? raw.name : 'Untitled',
        writtenAt: raw.writtenAt,
        held: name.startsWith(HELD_PREFIX)
      })
    } catch {
      // Half written or not ours: leave it alone rather than stop the app starting.
    }
  }
  return copies
}

/** The project file text inside a copy, ready for the ordinary reader. */
export async function readRecoveryDocument(file: string): Promise<string> {
  const raw = JSON.parse((await readFile(file)).toString()) as StoredCopy
  return JSON.stringify(raw.document)
}

export async function removeRecovery(file: string): Promise<void> {
  await rm(file, { force: true })
}

/**
 * Move an offered copy out of the file its project autosaves to, so that
 * working on meanwhile can neither write over it nor make it look older than
 * the project file. It stays there until you restore or discard it.
 */
export async function setAside(copy: RecoveryCopy): Promise<RecoveryCopy> {
  if (copy.held) return copy
  const file = join(dirname(copy.file), `${HELD_PREFIX}${copy.writtenAt}-${basename(copy.file)}`)
  await rename(copy.file, file)
  return { ...copy, file, held: true }
}
