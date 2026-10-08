import { join } from 'node:path'
import { isTestLaunch } from '../test-launch'
import { capture, captureText } from '../ffmpeg/spawn'
import { PROJECT_EXTS } from '../../shared/project-ext'

/**
 * Windows' own programs, by their full path. By name alone, Windows looks in
 * the folder the app was started in first, and a double-clicked project
 * starts it in the project's folder, where a download could have put a
 * `reg.exe` of its own.
 */
function system32(program: string): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', program)
}

const REG = system32('reg.exe')
const POWERSHELL = system32(join('WindowsPowerShell', 'v1.0', 'powershell.exe'))

/**
 * Double-clicking a `.editbay` file opens it in Editbay.
 *
 * The installer registers the file type, but a build run from its own folder
 * rather than installed never goes through the installer, so the app
 * registers the type for itself on launch, pointing at whichever copy is
 * running. It writes only to the current user's part of the registry, which
 * needs no administrator rights, and only when something has changed.
 */

/**
 * Whether this launch should claim project files. Only the real app does:
 * a development run is Electron itself, and every test suite launches with a
 * settings folder of its own, and neither may take the file type over from
 * the copy on the desktop. Read from the arguments as given, because Chromium
 * takes that switch for itself and does not report it back.
 */
export function shouldRegisterFileType(isPackaged: boolean, argv: string[]): boolean {
  return isPackaged && !isTestLaunch(argv)
}

/** Where the current user's file types live. */
export const CLASSES_ROOT = 'HKCU\\Software\\Classes'

/** The same class name the installer registers, so the two never compete. */
export const PROG_ID = 'Editbay project'

export interface RegistryEntry {
  key: string
  /** The value's name, or null for the key's default value. */
  name: string | null
  type: 'REG_SZ' | 'REG_NONE'
  data: string
}

/**
 * Every value the association needs, for the program at `exePath`.
 *
 * Every extension points at the one class, so the type is described once
 * however many of them there are. There is one today.
 */
export function associationEntries(exePath: string, root: string = CLASSES_ROOT): RegistryEntry[] {
  return [
    ...PROJECT_EXTS.flatMap((ext) => [
      { key: `${root}\\.${ext}`, name: null, type: 'REG_SZ' as const, data: PROG_ID },
      // Also listed as a program that can open the type, so it appears under Open with.
      { key: `${root}\\.${ext}\\OpenWithProgids`, name: PROG_ID, type: 'REG_NONE' as const, data: '' }
    ]),
    { key: `${root}\\${PROG_ID}`, name: null, type: 'REG_SZ', data: 'Editbay project' },
    { key: `${root}\\${PROG_ID}\\DefaultIcon`, name: null, type: 'REG_SZ', data: `"${exePath}",0` },
    { key: `${root}\\${PROG_ID}\\shell\\open\\command`, name: null, type: 'REG_SZ', data: `"${exePath}" "%1"` }
  ]
}

/** reg.exe's arguments for writing one value. */
export function regAddArgs(e: RegistryEntry): string[] {
  const name = e.name === null ? ['/ve'] : ['/v', e.name]
  return ['add', e.key, ...name, '/t', e.type, '/d', e.data, '/f']
}

/**
 * A key's default value from what `reg query KEY /ve` printed, or null if it
 * has none. The label for the default value is translated on non-English
 * Windows, so this goes by the type column instead.
 */
export function defaultValueFrom(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s+\S.*?\s{2,}REG_(?:SZ|EXPAND_SZ)\s{2,}(.*)$/)
    if (m) return m[1] ?? ''
  }
  return null
}

async function readDefault(key: string): Promise<string | null> {
  try {
    return defaultValueFrom(await captureText(REG, ['query', key, '/ve']))
  } catch {
    // reg exits with an error for a key that does not exist.
    return null
  }
}

/** Whether the type is already registered to open in the program at `exePath`. */
export async function isRegistered(exePath: string, root: string = CLASSES_ROOT): Promise<boolean> {
  const wanted = associationEntries(exePath, root)
  for (const e of wanted) {
    if (e.name !== null) continue
    if ((await readDefault(e.key)) !== e.data) return false
  }
  return true
}

/**
 * Tell Explorer that file types changed, so the next double-click and the
 * files' icons use the new registration without signing out. There is no
 * way to call this from Node directly, so PowerShell does it.
 */
async function announceChange(): Promise<void> {
  const script =
    "Add-Type -Namespace Editbay -Name Shell -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);'; " +
    '[Editbay.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await capture(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
}

/**
 * Register `.editbay` to open in the program at `exePath`, unless it already
 * does. True when something was written.
 */
export async function registerFileType(exePath: string, root: string = CLASSES_ROOT): Promise<boolean> {
  if (await isRegistered(exePath, root)) return false
  for (const e of associationEntries(exePath, root)) await capture(REG, regAddArgs(e))
  if (root === CLASSES_ROOT) await announceChange().catch(() => undefined)
  return true
}
