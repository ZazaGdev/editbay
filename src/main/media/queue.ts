import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { ImportProgress, MediaAsset } from '../../shared/types'
import {
  forgetAsset,
  getAsset,
  importFile,
  ImportCancelled,
  knownReady,
  listAssets,
  queuedAsset,
  type ImportOptions
} from './import'

/** Where the queue reports to: the window, and the project for a source that is ready. */
export interface QueueSink {
  progress: (p: ImportProgress) => void
  changed: (a: MediaAsset) => void
  /** A card that left the bin: cancelled, or found to be a file the bin already has. */
  removed: (id: string) => void
  ready: (a: MediaAsset) => void
  /**
   * A ready source's other tracks copied behind it, or why they could not be.
   * Given, a recording is ready before its copies are made.
   */
  tracksCopied?: (a: MediaAsset, error?: string) => void
  /**
   * Try a failed source again somewhere else, as a missing file of the open
   * project must be, or null to try it here.
   */
  tryAgain?: (id: string) => Promise<MediaAsset | null> | null
}

/** Imports one file, as importFile does. Passed in so the queue can be tested without ffmpeg. */
export type Importer = (
  path: string,
  onProgress: (p: ImportProgress) => void,
  onAsset: (a: MediaAsset) => void,
  options: ImportOptions
) => Promise<MediaAsset>

interface Job {
  id: string
  path: string
  /** The document it was dropped on. Once another opens, it is dropped. */
  doc: number
  controller: AbortController
  done: (a: MediaAsset | null) => void
  /** What came of it, for every drop that asked for it. */
  result: Promise<MediaAsset | null>
}

/** Windows paths are the same file whatever their case or slashes. */
function samePath(a: string, b: string): boolean {
  const key = (p: string): string => p.replace(/\//g, '\\').toLowerCase()
  return key(a) === key(b)
}

/**
 * Files to import, one at a time in the order they came. Every file gets its
 * card the moment it arrives, marked as waiting, so a drop of ten shows ten.
 * One at a time because two conversions of 4K footage at once saturate the
 * processor and neither finishes sooner.
 */
export class ImportQueue {
  private waiting: Job[] = []
  private running: Job | null = null

  constructor(
    private readonly currentDoc: () => number,
    private readonly sink: QueueSink,
    private readonly importer: Importer = importFile
  ) {}

  /**
   * Add files. Resolves once each has been imported, has failed or has been
   * cancelled, with what came of those still in the bin. A file already in
   * the bin, or already waiting, is not added again: this waits on that one.
   */
  async add(paths: string[]): Promise<MediaAsset[]> {
    const doc = this.currentDoc()
    const results: Promise<MediaAsset | null>[] = []
    for (const dropped of paths) {
      // The file's own name, as Windows spells it, so one file is one source whatever case it was typed in.
      const path = await realpath(dropped).catch(() => dropped)
      const known = await knownReady(path)
      // Files dropped on one document are not added to the next.
      if (doc !== this.currentDoc()) break
      if (known) {
        this.sink.changed(known)
        results.push(Promise.resolve(known))
        continue
      }
      const same = [this.running, ...this.waiting].find(
        (j) => j && j.doc === doc && !j.controller.signal.aborted && samePath(j.path, path)
      )
      if (same) {
        results.push(same.result)
        continue
      }
      // Dropped again after it failed: tried again on the same card.
      const failed = listAssets().find((a) => a.status === 'failed' && samePath(a.originalPath, path))
      if (failed) {
        results.push(this.retry(failed.id))
        continue
      }
      // Shown before it joins the queue, so a queue already running cannot
      // start it and then have its card put back to waiting.
      const id = randomUUID()
      this.sink.changed(queuedAsset(id, path))
      results.push(this.enqueue(id, path, doc))
    }
    void this.pump()
    return (await Promise.all(results)).filter((a): a is MediaAsset => a !== null)
  }

  /** Whether a source is waiting or being imported. */
  has(id: string): boolean {
    return this.running?.id === id || this.waiting.some((j) => j.id === id)
  }

  /**
   * Take a waiting file off the queue, or stop the one being imported. Its
   * card leaves the bin either way. False when it is neither.
   */
  cancel(id: string): boolean {
    if (this.running?.id === id) {
      this.running.controller.abort()
      return true
    }
    const i = this.waiting.findIndex((j) => j.id === id)
    if (i < 0) return false
    const [job] = this.waiting.splice(i, 1)
    forgetAsset(id)
    this.sink.removed(id)
    job!.done(null)
    return true
  }

  /** Import a source that failed again, under the same id, at the back of the queue. */
  retry(id: string): Promise<MediaAsset | null> {
    const asset = getAsset(id)
    if (!asset || asset.status !== 'failed' || this.has(id)) return Promise.resolve(null)
    const elsewhere = this.sink.tryAgain?.(id)
    if (elsewhere) return elsewhere
    this.sink.changed(queuedAsset(id, asset.originalPath))
    const result = this.enqueue(id, asset.originalPath, this.currentDoc())
    void this.pump()
    return result
  }

  private enqueue(id: string, path: string, doc: number): Promise<MediaAsset | null> {
    let done: (a: MediaAsset | null) => void = () => undefined
    const result = new Promise<MediaAsset | null>((resolve) => (done = resolve))
    this.waiting.push({ id, path, doc, controller: new AbortController(), done, result })
    return result
  }

  /** Drop everything waiting and stop what is running, as when another document opens. */
  clear(): void {
    for (const job of this.waiting) job.done(null)
    this.waiting = []
    this.running?.controller.abort()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    for (let job = this.waiting.shift(); job; job = this.waiting.shift()) {
      if (job.doc !== this.currentDoc()) {
        forgetAsset(job.id)
        job.done(null)
        continue
      }
      this.running = job
      const wanted = (): boolean => job!.doc === this.currentDoc()
      try {
        // Imported meanwhile, perhaps by a drop that came before this one finished.
        const known = await knownReady(job.path)
        if (job.controller.signal.aborted) throw new ImportCancelled()
        if (known) {
          forgetAsset(job.id)
          this.sink.removed(job.id)
          this.sink.changed(known)
          job.done(known)
          continue
        }
        const asset = await this.importer(job.path, this.sink.progress, this.sink.changed, {
          id: job.id,
          stillWanted: wanted,
          signal: job.controller.signal,
          // A recording is ready as soon as it can be cut, and the next file
          // starts, while its other tracks are copied behind it.
          ...(this.sink.tracksCopied ? { onTracksCopied: this.sink.tracksCopied } : {})
        })
        if (asset.status === 'ready' && wanted()) this.sink.ready(asset)
        job.done(wanted() ? asset : null)
      } catch (err) {
        if (err instanceof ImportCancelled) {
          if (wanted()) {
            forgetAsset(job.id)
            this.sink.removed(job.id)
          }
        } else if (wanted()) {
          // importFile keeps its own failures on the card; anything else is shown there too.
          const card = getAsset(job.id)
          if (card) this.sink.changed({ ...card, status: 'failed', error: err instanceof Error ? err.message : String(err) })
        }
        job.done(null)
      } finally {
        this.running = null
      }
    }
  }
}
