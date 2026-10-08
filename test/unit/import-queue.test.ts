import { describe, it, expect, beforeEach } from 'vitest'
import { ImportQueue, type Importer, type QueueSink } from '../../src/main/media/queue'
import { clearAssets, ImportCancelled, listAssets } from '../../src/main/media/import'
import type { MediaAsset } from '../../src/shared/types'

/** A file the stand-in importer has been asked for, finished when the test says so. */
interface Pending {
  path: string
  id: string
  signal: AbortSignal
  finish: (ok?: boolean) => void
}

let doc = 1
let started: Pending[]
let events: string[]
let sink: QueueSink

/** Imports nothing: each file waits until the test finishes it, or its signal aborts it. */
const importer: Importer = (path, _progress, onAsset, options) =>
  new Promise<MediaAsset>((resolve, reject) => {
    const id = options.id!
    const signal = options.signal!
    const base = listAssets().find((a) => a.id === id)!
    onAsset({ ...base, status: 'probing' })
    signal.addEventListener('abort', () => reject(new ImportCancelled()))
    started.push({
      path,
      id,
      signal,
      finish: (ok = true) => resolve({ ...base, status: ok ? 'ready' : 'failed', ...(ok ? {} : { error: 'no video or sound' }) })
    })
  })

/** Let the queue's promises run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Wait for something the queue does, which may need the disk: up to two seconds. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(check()).toBe(true)
}

beforeEach(() => {
  clearAssets()
  doc = 1
  started = []
  events = []
  sink = {
    progress: () => undefined,
    changed: (a) => events.push(`${a.status} ${a.originalPath}`),
    removed: (id) => events.push(`removed ${listAssets().find((a) => a.id === id)?.originalPath ?? id}`),
    ready: (a) => events.push(`added ${a.originalPath}`)
  }
})

describe('the import queue', () => {
  it('shows every file as waiting at once, then imports them one at a time in order', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const all = q.add(['a.mp4', 'b.mp4', 'c.mp4'])
    await until(() => started.length === 1)
    expect(events.filter((e) => e.startsWith('queued'))).toEqual(['queued a.mp4', 'queued b.mp4', 'queued c.mp4'])
    expect(started.map((s) => s.path)).toEqual(['a.mp4'])
    started[0]!.finish()
    await until(() => started.length === 2)
    expect(started[1]!.path).toBe('b.mp4')
    started[1]!.finish()
    await until(() => started.length === 3)
    started[2]!.finish()
    expect((await all).map((a) => a.originalPath)).toEqual(['a.mp4', 'b.mp4', 'c.mp4'])
    expect(events.filter((e) => e.startsWith('added'))).toEqual(['added a.mp4', 'added b.mp4', 'added c.mp4'])
  })

  it('keeps a second drop waiting until the first is done, rather than importing both at once', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const first = q.add(['a.mp4'])
    await until(() => started.length === 1)
    const second = q.add(['b.mp4'])
    await until(() => events.includes('queued b.mp4'))
    for (let i = 0; i < 10; i++) await settle()
    expect(started.map((s) => s.path)).toEqual(['a.mp4'])
    started[0]!.finish()
    await until(() => started.length === 2)
    started[1]!.finish()
    expect((await first).map((x) => x.originalPath)).toEqual(['a.mp4'])
    expect((await second).map((x) => x.originalPath)).toEqual(['b.mp4'])
  })

  it('takes a waiting file off the queue, and never imports it', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const all = q.add(['a.mp4', 'b.mp4'])
    await until(() => started.length === 1)
    const b = listAssets().find((a) => a.originalPath === 'b.mp4')!
    expect(q.cancel(b.id)).toBe(true)
    expect(listAssets().some((a) => a.id === b.id)).toBe(false)
    started[0]!.finish()
    expect((await all).map((a) => a.originalPath)).toEqual(['a.mp4'])
    expect(started).toHaveLength(1)
  })

  it('stops the file being imported, drops its card and goes on to the next', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const all = q.add(['a.mp4', 'b.mp4'])
    await until(() => started.length === 1)
    const a = started[0]!
    expect(q.cancel(a.id)).toBe(true)
    expect(a.signal.aborted).toBe(true)
    await until(() => started.length === 2)
    expect(listAssets().some((x) => x.id === a.id)).toBe(false)
    expect(events).toContain('removed ' + a.id)
    started[1]!.finish()
    expect((await all).map((x) => x.originalPath)).toEqual(['b.mp4'])
  })

  it('imports a failed file again under the same id', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const first = q.add(['a.mp4'])
    await until(() => started.length === 1)
    const id = started[0]!.id
    started[0]!.finish(false)
    expect((await first)[0]!.status).toBe('failed')
    // The failed card is what the bin holds; the stand-in does not keep it, so put it there.
    const failed = listAssets().find((x) => x.id === id)!
    Object.assign(failed, { status: 'failed' })
    const again = q.retry(id)
    await until(() => started.length === 2)
    expect(started[1]!.id).toBe(id)
    started[1]!.finish()
    expect((await again)?.status).toBe('ready')
  })

  it('adds a file dropped again while it waits only once, and tells both drops what came of it', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const first = q.add(['a.mp4', 'b.mp4'])
    const second = q.add(['B.MP4'])
    await until(() => started.length === 1)
    expect(listAssets().filter((x) => x.originalPath.toLowerCase() === 'b.mp4')).toHaveLength(1)
    started[0]!.finish()
    await until(() => started.length === 2)
    started[1]!.finish()
    expect((await first).map((x) => x.originalPath.toLowerCase())).toEqual(['a.mp4', 'b.mp4'])
    expect((await second).map((x) => x.originalPath.toLowerCase())).toEqual(['b.mp4'])
    expect(started).toHaveLength(2)
  })

  it('tries a failed file again on its own card when it is dropped again', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const first = q.add(['a.mp4'])
    await until(() => started.length === 1)
    const id = started[0]!.id
    started[0]!.finish(false)
    await first
    Object.assign(listAssets().find((x) => x.id === id)!, { status: 'failed' })
    const again = q.add(['A.mp4'])
    await until(() => started.length === 2)
    expect(started[1]!.id).toBe(id)
    expect(listAssets()).toHaveLength(1)
    started[1]!.finish()
    expect((await again).map((x) => x.id)).toEqual([id])
  })

  it('drops what is waiting once another document opens', async () => {
    const q = new ImportQueue(() => doc, sink, importer)
    const all = q.add(['a.mp4', 'b.mp4'])
    await until(() => started.length === 1)
    doc = 2
    started[0]!.finish()
    expect(await all).toEqual([])
    expect(started).toHaveLength(1)
    expect(events.filter((e) => e.startsWith('added'))).toEqual([])
    // Nothing is left behind from the document that went.
    expect(listAssets().some((x) => x.originalPath === 'b.mp4')).toBe(false)
  })

  it('adds no more cards once another document opens part way through a drop', async () => {
    const q = new ImportQueue(() => doc, { ...sink, changed: (a) => {
      sink.changed(a)
      if (a.status === 'queued') doc = 2
    } }, importer)
    expect(await q.add(['a.mp4', 'b.mp4'])).toEqual([])
    expect(events.filter((e) => e.startsWith('queued'))).toEqual(['queued a.mp4'])
  })

  it('imports a file dropped on the next document, though the last one’s import of it is still finishing', async () => {
    // Some steps finish what they are doing before they notice a cancel.
    const stubborn: Importer = (path, _progress, onAsset, options) =>
      new Promise<MediaAsset>((resolve) => {
        const base = listAssets().find((a) => a.id === options.id)!
        onAsset({ ...base, status: 'probing' })
        started.push({ path, id: options.id!, signal: options.signal!, finish: () => resolve({ ...base, status: 'ready' }) })
      })
    const q = new ImportQueue(() => doc, sink, stubborn)
    void q.add(['a.mp4'])
    await until(() => started.length === 1)
    doc = 2
    q.clear()
    expect(started[0]!.signal.aborted).toBe(true)
    const again = q.add(['a.mp4'])
    await until(() => events.filter((e) => e === 'queued a.mp4').length === 2)
    started[0]!.finish()
    await until(() => started.length === 2)
    started[1]!.finish()
    expect((await again).map((x) => x.originalPath)).toEqual(['a.mp4'])
  })

  it('hands a failed file to whoever else must try it again, such as a missing file of the project', async () => {
    const elsewhere: string[] = []
    const q = new ImportQueue(() => doc, {
      ...sink,
      tryAgain: (id) => {
        elsewhere.push(id)
        return Promise.resolve(listAssets().find((x) => x.id === id) ?? null)
      }
    }, importer)
    const first = q.add(['a.mp4'])
    await until(() => started.length === 1)
    const id = started[0]!.id
    started[0]!.finish(false)
    await first
    Object.assign(listAssets().find((x) => x.id === id)!, { status: 'failed' })
    await q.add(['a.mp4'])
    expect(elsewhere).toEqual([id])
    expect(started).toHaveLength(1)
    expect(events.filter((e) => e === 'queued a.mp4')).toHaveLength(1)
  })
})
