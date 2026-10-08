import { open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { facesOf, familyFromNameTable, nameTableAt, readFontFigures, styleFromNameTable, type FontFigures } from '../../shared/font-file'

/**
 * Fonts installed on this PC, for captions (plan 87): the export burns
 * captions in with libass, which needs the font's file, so a family chosen in
 * the window is found here, in the fonts folder of the machine and of the user.
 */

/** Where Windows keeps installed fonts: every user's, and this user's own. */
export function fontFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const folders = [join(env.SystemRoot ?? 'C:\\Windows', 'Fonts')]
  if (env.LOCALAPPDATA) folders.push(join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
  return folders
}

/** One face of a font file: the file, where the face starts in it, its family and its style. */
interface Face {
  path: string
  at: number
  family: string
  style: string
}

/**
 * Every face of a file, from its table directories and name tables alone. A
 * collection (.ttc) holds several: Cambria's regular face is only in one, so
 * reading single fonts alone found its bold file instead (audit 2026-10-08).
 */
async function facesIn(path: string): Promise<Face[]> {
  const out: Face[] = []
  try {
    const file = await open(path, 'r')
    try {
      const read = async (at: number, length: number): Promise<Uint8Array> => {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await file.read(buf, 0, length, at)
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
      }
      for (const at of facesOf(await read(0, 4096))) {
        const table = nameTableAt(await read(at, 4096))
        if (!table || table.length > 1024 * 1024) continue
        const names = await read(table.offset, table.length)
        const family = familyFromNameTable(names)
        if (family) out.push({ path, at, family, style: styleFromNameTable(names) ?? '' })
      }
    } finally {
      await file.close()
    }
  } catch {
    // Unreadable: no faces.
  }
  return out
}

/** The styles a family's plain face goes by. */
const PLAIN = new Set(['regular', 'normal', 'book', 'roman'])

/** Each family's faces, read once: the plain one first, so Regular is chosen over Bold. */
let families: Promise<Map<string, Face[]>> | null = null

async function listFamilies(folders: string[]): Promise<Map<string, Face[]>> {
  const found = new Map<string, Face[]>()
  for (const folder of folders) {
    let names: string[]
    try {
      names = await readdir(folder)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/\.(ttf|otf|ttc)$/i.test(name)) continue
      for (const face of await facesIn(join(folder, name))) {
        const key = face.family.toLowerCase()
        found.set(key, [...(found.get(key) ?? []), face])
      }
    }
  }
  // The plain style first, then shorter names: arial.ttf before arialbd.ttf.
  const rank = (f: Face): number => (PLAIN.has(f.style.toLowerCase()) ? 0 : 1)
  for (const faces of found.values()) faces.sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return found
}

/** Forget what was read, as when fonts may have been installed since. */
export function forgetFonts(): void {
  families = null
}

/**
 * A family's file on this PC and the figures the caption layout needs from
 * it, or null when it is not installed or cannot be read.
 */
export async function fontFor(family: string, folders: string[] = fontFolders()): Promise<{ path: string; figures: FontFigures } | null> {
  families ??= listFamilies(folders)
  const faces = (await families).get(family.toLowerCase()) ?? []
  for (const face of faces) {
    try {
      // The whole file goes to the export, a collection too: libass picks the face by its family and style.
      const figures = readFontFigures(new Uint8Array(await readFile(face.path)), face.at)
      if (figures) return { path: face.path, figures }
    } catch {
      // Unreadable: the next face of the family.
    }
  }
  return null
}
