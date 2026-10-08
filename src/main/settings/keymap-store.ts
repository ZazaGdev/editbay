import { join } from 'node:path'
import { readKept } from './read-kept'
import { sanitiseOverrides, type Overrides } from '../../shared/keymap'
import { writeAtomic } from '../media/cache'

const FILE_NAME = 'keymap.json'

/** Where the keymap lives for a given settings folder. */
export function keymapPath(settingsDir: string): string {
  return join(settingsDir, FILE_NAME)
}

/**
 * Read your shortcut changes. A missing file means you have not changed any.
 * A file that cannot be read or parsed is treated the same way rather than
 * stopping the app from starting: the defaults are always a working keymap.
 * The damaged file is kept aside as `keymap.json.bad`, not saved over.
 */
export async function loadOverrides(path: string): Promise<Overrides> {
  try {
    const raw = await readKept(path)
    return raw === undefined ? {} : sanitiseOverrides(raw)
  } catch {
    return {}
  }
}

/** Save your shortcut changes. Written whole or not at all. */
export async function saveOverrides(path: string, overrides: Overrides): Promise<Overrides> {
  const clean = sanitiseOverrides(overrides)
  await writeAtomic(path, Buffer.from(JSON.stringify(clean, null, 2)))
  return clean
}
