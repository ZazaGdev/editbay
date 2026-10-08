import { readFile, rename } from 'node:fs/promises'

/**
 * Read one of the app's own JSON files: the settings, the shortcuts, the
 * recent list. Undefined when there is none, or when it cannot be read.
 *
 * One that cannot be read is moved aside as `name.<time>.bad` first. The app
 * goes on with its defaults, as it always has, but the next save would
 * otherwise write those defaults over the damaged file, and with it every
 * shortcut you had changed. Kept aside, it can still be mended by hand.
 *
 * A file that is there but held open for a moment, as a virus scanner does,
 * is tried again before it is given up on.
 */
export async function readKept(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readTwice(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    await setAside(path)
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    await setAside(path)
    return undefined
  }
}

async function readTwice(path: string): Promise<string> {
  try {
    return (await readFile(path)).toString()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err
    await new Promise((resolve) => setTimeout(resolve, 250))
    return (await readFile(path)).toString()
  }
}

/** Each one kept by the time it was set aside, so a second damaged file never replaces the first. */
async function setAside(path: string): Promise<void> {
  await rename(path, `${path}.${Date.now()}.bad`).catch(() => undefined)
}
