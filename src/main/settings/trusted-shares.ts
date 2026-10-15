import { readKept } from './read-kept'
import { join } from 'node:path'
import { writeAtomic } from '../media/cache'
import { shareOf } from '../../shared/source-paths'

/**
 * The network shares you have allowed Editbay to open files from.
 *
 * A project names its files, and one made by someone else could name a file
 * on their computer, which Windows signs in to as you. So a share is only
 * opened once you have allowed it: by bringing in or finding a file there
 * yourself, or by answering Connect when a project asks. Yours rather than a
 * project's, so it lives with the app's settings.
 */

const FILE_NAME = 'trusted-shares.json'

let file: string | null = null
let shares = new Set<string>()
/** Shares allowed until Editbay closes: ones only the window says you used. */
let forNow = new Set<string>()
let writing: Promise<void> = Promise.resolve()
/** Told when the list could not be written, so a share allowed is not quietly asked about again next time. */
let failed: (reason: string) => void = () => undefined

export function onTrustWriteFailed(tell: (reason: string) => void): void {
  failed = tell
}

/**
 * Read the list from the settings folder. A list that cannot be read allows
 * nothing, and is set aside rather than written over (audit 2026-10-01).
 */
export async function loadTrustedShares(settingsDir: string): Promise<void> {
  file = join(settingsDir, FILE_NAME)
  const raw = await readKept(file)
  const list = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []
  // Kept only as `shareOf` spells a share, so a hand-edited entry cannot allow more than one.
  shares = new Set(list.map((s) => shareOf(`${s}\\x`)).filter((s): s is string => s !== null))
}

export function trustedShares(): ReadonlySet<string> {
  return forNow.size === 0 ? shares : new Set([...shares, ...forNow])
}

/**
 * Allow the shares these paths are on until Editbay closes, not for good:
 * for files the window says you dropped, which main cannot see you do, so a
 * window that had been made to lie could not allow a share for every later
 * project (audit 2026-10-01).
 */
export function trustSharesForNow(paths: readonly string[]): void {
  const added = paths.map((p) => shareOf(p)).filter((s): s is string => s !== null && !shares.has(s))
  if (added.length > 0) forNow = new Set([...forNow, ...added])
}

/** Allow the shares these paths are on. Paths that are not on a share change nothing. */
export function trustSharesOf(paths: readonly string[]): Promise<void> {
  return trustShares(paths.map((p) => shareOf(p)).filter((s): s is string => s !== null))
}

/** Allow these shares, spelled as `shareOf` gives them. */
export function trustShares(allow: readonly string[]): Promise<void> {
  const added = allow.filter((s) => !shares.has(s))
  if (added.length === 0) return writing
  shares = new Set([...shares, ...added])
  const target = file
  const list = [...shares]
  // One write at a time, in order, so an older list never lands after a newer one.
  writing = writing
    .then(() => (target ? writeAtomic(target, Buffer.from(JSON.stringify(list, null, 2))) : undefined))
    .catch((err: unknown) => failed(err instanceof Error ? err.message : String(err)))
  return writing
}
