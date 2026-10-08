import { join } from 'node:path'
import { readKept } from './read-kept'
import { writeAtomic } from '../media/cache'

/**
 * The projects you have worked on, most recent first, and the one that was
 * open last so the app can reopen it on launch. Yours rather than a
 * project's, so it lives with the app's settings, like the keymap.
 */

const FILE_NAME = 'recent.json'
export const MAX_RECENT = 10

export interface RecentState {
  projects: string[]
  /** The project that was open when the app last had one, or null for a new unsaved one. */
  last: string | null
}

export function recentPath(settingsDir: string): string {
  return join(settingsDir, FILE_NAME)
}

export function emptyRecent(): RecentState {
  return { projects: [], last: null }
}

/** Windows paths ignore case, so D:\A.editbay and d:\a.editbay are one project. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Whatever was read from disk, made into a list the app can trust. */
export function sanitiseRecent(raw: unknown): RecentState {
  if (typeof raw !== 'object' || raw === null) return emptyRecent()
  const r = raw as Record<string, unknown>
  const projects: string[] = []
  if (Array.isArray(r.projects)) {
    for (const p of r.projects) {
      if (typeof p === 'string' && p !== '' && !projects.some((x) => samePath(x, p))) projects.push(p)
    }
  }
  return {
    projects: projects.slice(0, MAX_RECENT),
    last: typeof r.last === 'string' && r.last !== '' ? r.last : null
  }
}

/** A project you have just opened or saved: to the top, once, and now the last one open. */
export function addRecent(state: RecentState, path: string): RecentState {
  const rest = state.projects.filter((p) => !samePath(p, path))
  return { projects: [path, ...rest].slice(0, MAX_RECENT), last: path }
}

/** Take a project off the list, for one whose file has gone. */
export function forgetRecent(state: RecentState, path: string): RecentState {
  return {
    projects: state.projects.filter((p) => !samePath(p, path)),
    last: state.last !== null && samePath(state.last, path) ? null : state.last
  }
}

/** Which project is open now, without changing the list: null for a new one never saved. */
export function setLast(state: RecentState, path: string | null): RecentState {
  return { ...state, last: path }
}

/**
 * Read the list. A missing or unreadable file is an empty list rather than a
 * reason for the app not to start.
 */
export async function loadRecent(path: string): Promise<RecentState> {
  try {
    const raw = await readKept(path)
    return raw === undefined ? emptyRecent() : sanitiseRecent(raw)
  } catch {
    return emptyRecent()
  }
}

/** Save the list, whole or not at all. */
export async function saveRecent(path: string, state: RecentState): Promise<RecentState> {
  const clean = sanitiseRecent(state)
  await writeAtomic(path, Buffer.from(JSON.stringify(clean, null, 2)))
  return clean
}
