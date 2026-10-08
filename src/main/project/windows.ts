import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import type { Notice } from '../../shared/types'

/** What the windows are told and asked: messages, notices and boxes. See lifecycle.ts. */

const notices: Notice[] = []

export function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Something you should be told, shown in the window as soon as it can be.
 *
 * `weight` is not optional, so a message cannot be added without saying which
 * it is. `fades` goes by itself after a few seconds, like every other passing
 * notice: it is for something that simply refused to happen, where nothing was
 * lost and nothing is being asked of you. `waits` keeps an OK and stays until
 * it is pressed, and is for work at risk or a decision to make.
 *
 * Everything used to wait, so being told a locked track had refused an edit
 * meant clearing a box before carrying on, which is a lot of ceremony for
 * "nothing happened".
 */
export function notify(text: string, weight: 'fades' | 'waits'): void {
  notices.push({ text, waits: weight === 'waits' })
  send('notices:ping', null)
}

export function takeNotices(): Notice[] {
  return notices.splice(0)
}

export async function messageBox(win: BrowserWindow | null, options: MessageBoxOptions): Promise<number> {
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response
}
