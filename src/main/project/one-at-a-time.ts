import type { BrowserWindow } from 'electron'
import { stopSpeech } from '../speech/ipc'
import { closeCleanly, confirmDiscard, confirmStop } from './open-document'

/** One question, save or open at a time, and the window's close. See lifecycle.ts. */

/**
 * Anything that asks about unsaved changes, saves, or replaces the document
 * runs one at a time. Two questions open at once could otherwise each be
 * answered for the other's document: "Save changes to A?" answered after B
 * had already been opened in its place would save B.
 */
let flow: Promise<unknown> = Promise.resolve()
/** Set once the window has been let go. Nothing may open or ask after that. */
let closing = false

/** Run a task after every earlier one has finished, or give `closed` once the window has gone. */
export function exclusive<T>(closed: T, task: () => Promise<T>): Promise<T> {
  const run = flow.then(() => (closing ? closed : task()))
  flow = run.catch(() => undefined)
  return run
}

/**
 * Hold a window open until its unsaved changes are saved or given up.
 *
 * The close is always stopped first and only let through once the answer is
 * in and any save has finished, so the window can never close underneath the
 * question or halfway through writing the file.
 */
/** What stops the running export, once closing has been agreed to. */
let stopWork: () => Promise<void> = async () => undefined

/**
 * Give closing the way to stop an export, and to wait until it has: ffmpeg is
 * stopped rather than left writing, and its scratch files are cleared.
 */
export function onCloseStop(stop: () => Promise<void>): void {
  stopWork = stop
}

export function guardClose(win: BrowserWindow): void {
  let allowed = false
  let asking = false
  win.on('close', (e) => {
    if (allowed) return
    e.preventDefault()
    if (asking) return
    asking = true
    void exclusive(undefined, async () => {
      if (!(await confirmStop(win))) return
      if (!(await confirmDiscard(win))) return
      closing = true
      await stopWork().catch(() => undefined)
      await stopSpeech().catch(() => undefined)
      try {
        await closeCleanly()
      } catch {
        // Tidying up must never trap you in the app.
      }
      allowed = true
      win.close()
    }).finally(() => {
      asking = false
    })
  })
}
