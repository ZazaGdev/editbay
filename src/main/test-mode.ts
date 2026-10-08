/**
 * The test switch (task 18). A run of the tests, or an agent starting the app
 * to look at it, sets EDITBAY_UNDER_TEST=1. Under it nothing the app does can
 * wait for a person: every native dialog is answered without being shown, and
 * the app quits by itself when the run that started it is gone. The installed
 * app never reads it, so a person always gets every question.
 *
 * A test that is about one of those questions still asks it: it puts its own
 * answer in the dialog's place, as the tests always have, and counts what was
 * asked. This is only the answer for everything else.
 */

import type { Dialog, MessageBoxOptions, Shell } from 'electron'

/** Whether this is a run under the tests: set by them, and never read by the installed app. */
export function isUnderTest(env: Record<string, string | undefined>, packaged: boolean): boolean {
  return !packaged && env.EDITBAY_UNDER_TEST === '1'
}

/**
 * What a question is answered with when nobody is there to answer it: "Don't
 * save" where it offers that, so closing never saves a test's work over
 * anything, and otherwise the button that backs out of it.
 */
export function quietAnswer(options: Pick<MessageBoxOptions, 'buttons' | 'cancelId'>): number {
  const buttons = options.buttons ?? []
  const dontSave = buttons.findIndex((b) => /^don.t save$/i.test(b))
  if (dontSave >= 0) return dontSave
  return options.cancelId ?? (buttons.length > 1 ? buttons.length - 1 : 0)
}

/** Marks the stand-ins, so a test can tell the app is quiet and not asking for real. */
export const QUIET = Symbol.for('editbay.quiet-dialog')

/** Every native dialog answered on the spot, without a window: nothing can wait for a click. */
export function quietDialogs(dialog: Dialog): void {
  const options = (args: unknown[]): MessageBoxOptions =>
    (args.find((a) => typeof a === 'object' && a !== null && 'message' in a) as MessageBoxOptions | undefined) ?? { message: '' }
  const replace = <K extends keyof Dialog>(name: K, stand: Dialog[K]): void => {
    Object.assign(stand as object, { [QUIET]: true })
    dialog[name] = stand
  }
  replace('showMessageBox', (async (...args: unknown[]) => ({ response: quietAnswer(options(args)), checkboxChecked: false })) as Dialog['showMessageBox'])
  replace('showMessageBoxSync', ((...args: unknown[]) => quietAnswer(options(args))) as Dialog['showMessageBoxSync'])
  replace('showOpenDialog', (async () => ({ canceled: true, filePaths: [] })) as Dialog['showOpenDialog'])
  replace('showSaveDialog', (async () => ({ canceled: true, filePath: '' })) as Dialog['showSaveDialog'])
  replace('showErrorBox', ((title: string, content: string) => console.error(`${title}: ${content}`)) as Dialog['showErrorBox'])
}

/**
 * Nothing opened outside the app (task 78): an Explorer window, a file in its
 * player, a page in the browser. Each would land in front of whoever is at
 * the machine. What would have opened is kept in `editbayQuietShell`, and a
 * test about one of these still puts its own stand-in in place, as before.
 */
export function quietShell(shell: Pick<Shell, 'openPath' | 'showItemInFolder' | 'openExternal'>): void {
  const g = globalThis as { editbayQuietShell?: string[] }
  const opened = (g.editbayQuietShell ??= [])
  shell.openPath = async (path: string) => {
    opened.push(path)
    return ''
  }
  shell.showItemInFolder = (path: string) => {
    opened.push(path)
  }
  shell.openExternal = async (url: string) => {
    opened.push(url)
  }
}

/**
 * Quit once the process that started this one is gone. A test run that times
 * out or is stopped takes its own process with it, and used to leave the app
 * it started running, out of sight, for good.
 */
export function quitWithParent(parent: number, quit: () => void, everyMs = 2000): () => void {
  const timer = setInterval(() => {
    try {
      process.kill(parent, 0)
    } catch (err) {
      // There, but not this process's to signal: still running.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return
      clearInterval(timer)
      quit()
    }
  }, everyMs)
  timer.unref()
  return () => clearInterval(timer)
}
