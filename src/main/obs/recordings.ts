import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Recording, RecordingsListing } from '../../shared/types'

/** The kinds of file OBS records to. */
const VIDEO = new Set(['.mkv', '.mp4', '.mov', '.flv', '.ts', '.m4v', '.webm'])
/** How many are listed, newest first. */
export const NEWEST = 20
/** A file whose size and time have not changed for this long is finished. */
export const QUIET_MS = 5000
/** How often the folder is looked at while the app is open. */
export const POLL_MS = 3000

export interface Entry {
  path: string
  size: number
  mtimeMs: number
}

/**
 * The newest video files in a folder, newest first. Null when the folder
 * cannot be read, as when its disk is not plugged in: not the same as empty.
 */
export async function newestVideos(folder: string): Promise<Entry[] | null> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return null
  }
  const entries = await Promise.all(
    names
      .filter((n) => VIDEO.has(extname(n).toLowerCase()))
      .map(async (n): Promise<Entry | null> => {
        const path = join(folder, n)
        try {
          const s = await stat(path)
          return s.isFile() ? { path, size: s.size, mtimeMs: s.mtimeMs } : null
        } catch {
          return null
        }
      })
  )
  return entries
    .filter((e): e is Entry => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, NEWEST)
}

/** Where to look: the folder, and whether it came from OBS's own settings. */
export type Where = () => Promise<{ folder: string | null; fromObs: boolean }>

/**
 * Keeps an eye on the recording folder: lists its newest files, marks those
 * still being written, and says once when a new one has finished. Only a file
 * written after the first look at the folder is announced: one that was there
 * already, or an old one that comes into the list when a newer one is deleted
 * or renamed, is listed but never announced.
 */
export class RecordingsWatcher {
  /** Each file's size and time as last seen, and since when they have been so. */
  private seen = new Map<string, { size: number; mtimeMs: number; since: number }>()
  private there: Set<string> | null = null
  /** When the folder was first read. Only files written since are news. */
  private since: number | null = null
  private announced = new Set<string>()
  private folder: string | null | undefined = undefined
  private latest: RecordingsListing | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private polling: Promise<RecordingsListing> | null = null

  constructor(
    private readonly where: Where,
    private readonly onFinished: (r: Recording) => void,
    private readonly list: (folder: string) => Promise<Entry[] | null> = newestVideos,
    private readonly now: () => number = Date.now
  ) {}

  /** Look at the folder now. Two calls at once share one look. */
  poll(): Promise<RecordingsListing> {
    this.polling ??= this.look().finally(() => (this.polling = null))
    return this.polling
  }

  /** The last look, or a new one when there has been none. */
  listing(): Promise<RecordingsListing> {
    return this.latest ? Promise.resolve(this.latest) : this.poll()
  }

  /**
   * Start from nothing, as when another folder is chosen: what is there now is
   * never announced. Waits for a look under way, which would otherwise finish
   * with the old folder after this.
   */
  async reset(): Promise<void> {
    await this.polling?.catch(() => undefined)
    this.folder = undefined
  }

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll().catch(() => undefined), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async look(): Promise<RecordingsListing> {
    const { folder, fromObs } = await this.where()
    const now = this.now()
    if (folder !== this.folder) {
      this.folder = folder
      this.seen.clear()
      this.there = null
      this.since = null
      this.announced.clear()
    }
    const read = folder ? await this.list(folder) : []
    if (read === null) {
      // Not there for now: listed as empty, and what was learned about it kept.
      this.latest = { folder, fromObs, recordings: [] }
      return this.latest
    }
    const entries = read
    const next = new Map<string, { size: number; mtimeMs: number; since: number }>()
    for (const e of entries) {
      const before = this.seen.get(e.path)
      const same = before !== undefined && before.size === e.size && before.mtimeMs === e.mtimeMs
      // Seen for the first time, it has been as it is since it was last written.
      const since = same ? before.since : before ? now : Math.min(now, e.mtimeMs)
      next.set(e.path, { size: e.size, mtimeMs: e.mtimeMs, since })
    }
    this.seen = next
    this.there ??= new Set(entries.map((e) => e.path))
    this.since ??= now
    const recordings: Recording[] = entries.map((e) => ({
      path: e.path,
      name: basename(e.path),
      size: e.size,
      modifiedAt: e.mtimeMs,
      recording: now - next.get(e.path)!.since < QUIET_MS
    }))
    for (const r of recordings) {
      if (r.recording || this.there.has(r.path) || this.announced.has(r.path)) continue
      if (r.modifiedAt <= this.since) continue
      this.announced.add(r.path)
      this.onFinished(r)
    }
    this.latest = { folder, fromObs, recordings }
    return this.latest
  }
}
