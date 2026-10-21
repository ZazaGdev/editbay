/**
 * Which system the app is running on (plan 104). Editbay runs on Windows and
 * on the Mac, and the few rules that differ, which paths are on this computer
 * and which key stands for Ctrl, take the system as a parameter defaulting to
 * this one, so a test can pin either.
 *
 * Read from Node's `process` where there is one (the main process, the tests,
 * the command line) and from the browser's own report in the window.
 */
export type System = 'windows' | 'mac'

function detect(): System {
  const node = (globalThis as { process?: { platform?: string } }).process?.platform
  if (typeof node === 'string') return node === 'darwin' ? 'mac' : 'windows'
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
  return /Mac/i.test(nav?.platform ?? nav?.userAgent ?? '') ? 'mac' : 'windows'
}

export const RUNNING_SYSTEM: System = detect()

/**
 * Whether the key a shortcut calls Ctrl is held: Cmd on a Mac, where Ctrl with
 * a click is a right click, and Ctrl elsewhere.
 */
export function commandKey(e: { ctrlKey: boolean; metaKey: boolean }, system: System = RUNNING_SYSTEM): boolean {
  return system === 'mac' ? e.metaKey : e.ctrlKey
}

/** That key's name, for text that names it. */
export const COMMAND_KEY_NAME = RUNNING_SYSTEM === 'mac' ? 'Cmd' : 'Ctrl'

/** Alt's name, for text that names it: Option on a Mac's keyboard (task 1388). */
export const ALT_KEY_NAME = RUNNING_SYSTEM === 'mac' ? 'Option' : 'Alt'

/**
 * Whether a wheel turn zooms: Ctrl held, which is also how a pinch on a
 * trackpad arrives, or on a Mac Cmd too.
 */
export function zoomKey(e: { ctrlKey: boolean; metaKey: boolean }, system: System = RUNNING_SYSTEM): boolean {
  return e.ctrlKey || (system === 'mac' && e.metaKey)
}
