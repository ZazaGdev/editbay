/**
 * Plan 84: earlier versions of a project, kept whenever the app would
 * otherwise have thrown work away, so none is ever lost. This file decides,
 * from times and reasons alone, which to keep and which to let go; reading
 * and writing them is `src/main/project/versions.ts`.
 */

/** Why a version was kept, which the list says beside it. */
export type VersionReason = 'saved-over' | 'changed-elsewhere' | 'not-saved' | 'recovery-discarded'

export const VERSION_REASONS: readonly VersionReason[] = ['saved-over', 'changed-elsewhere', 'not-saved', 'recovery-discarded']

/** What a version is, as the list shows it. */
export const REASON_WORDS: Record<VersionReason, string> = {
  'saved-over': 'Saved over',
  'changed-elsewhere': 'Changed elsewhere, then saved over',
  'not-saved': 'Changes not saved',
  'recovery-discarded': 'Recovery copy set aside'
}

/** One kept version, newest first in a list. */
export interface KeptVersion {
  /** Its name in the versions folder, which is all the window ever sends back. */
  id: string
  /** The project's file, or null for work never saved. */
  projectPath: string | null
  /** The project's name when it was kept. */
  name: string
  /** Milliseconds since 1970. */
  keptAt: number
  reason: VersionReason
  /** A hash of what was kept, so the same thing is never kept twice in a row. */
  hash: string
}

/** How many of one project's versions are kept, at most. */
export const KEEP_AT_MOST = 40
/** How long a version is kept, beyond the newest few. */
export const KEEP_FOR_MS = 60 * 24 * 3600 * 1000
/** How many of one project's versions are kept however old they are. */
export const KEEP_ALWAYS = 5
/** How long saving goes on over a file before what it replaces is kept again. */
export const KEEP_EVERY_MS = 10 * 60 * 1000

/**
 * Which of one project's versions to let go, given them all: past the newest
 * `KEEP_AT_MOST`, and any older than `KEEP_FOR_MS` beyond the newest
 * `KEEP_ALWAYS`.
 */
export function versionsToLetGo(versions: readonly Pick<KeptVersion, 'id' | 'keptAt'>[], now: number): string[] {
  const newest = [...versions].sort((a, b) => b.keptAt - a.keptAt)
  return newest.filter((v, i) => i >= KEEP_AT_MOST || (i >= KEEP_ALWAYS && now - v.keptAt > KEEP_FOR_MS)).map((v) => v.id)
}

/**
 * Whether the file a save is about to write over is kept first: when it
 * changed on disk since the app last read or wrote it, which is someone
 * else's work; when it is the first save over it since the document was
 * opened, restored or made, which is the version as it was before any of
 * this; and otherwise when the newest version kept is `KEEP_EVERY_MS` old, so
 * a long session leaves a trail to go back along.
 */
export function keepBeforeSaving(s: { changedElsewhere: boolean; firstSave: boolean; newestKeptAt: number | null; now: number }): VersionReason | null {
  if (s.changedElsewhere) return 'changed-elsewhere'
  if (s.firstSave || s.newestKeptAt === null || s.now - s.newestKeptAt >= KEEP_EVERY_MS) return 'saved-over'
  return null
}

/** Whether `id` is one a version could be called, so nothing else is ever read for one. */
export function isVersionId(id: string): boolean {
  return /^(?:[0-9a-f]{16}|untitled)\/\d{13}-(?:saved-over|changed-elsewhere|not-saved|recovery-discarded)\.editbay\.gz$/.test(id)
}
