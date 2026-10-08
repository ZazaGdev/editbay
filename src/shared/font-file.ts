/**
 * What the caption layout needs from a font file (plan 87): its family name as
 * libass looks it up, how wide each character is in thousandths of an em, and
 * the heights libass and a canvas size it by. Read the same way for the
 * bundled fonts, whose figures are in `caption-fonts.ts`, and for a font
 * chosen from this PC, whose figures travel with the project.
 */
export interface FontFigures {
  family: string
  capHeight: number
  assSizePerEm: number
  assDescent: number
  averageAdvance: number
  advance: Record<string, number>
}

/** The characters measured: printable ASCII and the curly quotes, ellipsis and dash whisper writes. */
const MEASURED = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), '’', '‘', '“', '”', '…', '—']

/**
 * The figures of a TrueType or OpenType font, or null for a file that is not
 * one, or not one this can read. `face` is where one face of a collection
 * starts, as `facesOf` gives it.
 */
export function readFontFigures(bytes: Uint8Array, face = 0): FontFigures | null {
  try {
    return read(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), face)
  } catch {
    return null
  }
}

/** Just the family name, for listing many files quickly. Null when it cannot be read. */
export function readFontFamily(bytes: Uint8Array): string | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const name = tablesOf(v).get('name')
    return name ? familyName(v, name.offset) || null : null
  } catch {
    return null
  }
}

/**
 * Where each face of a font file starts: one at the start for a single font,
 * and each listed in its header for a collection (.ttc), as Windows keeps
 * Cambria and the East Asian fonts (audit 2026-10-08). Read from its first bytes.
 */
export function facesOf(head: Uint8Array): number[] {
  try {
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength)
    if (v.getUint32(0) !== 0x74746366) return [0]
    return Array.from({ length: Math.min(v.getUint32(8), 64) }, (_, i) => v.getUint32(12 + i * 4))
  } catch {
    return []
  }
}

/**
 * Where a font file's name table is, from the bytes of its table directory,
 * so a long list of files can be named without reading them whole. For a face
 * of a collection, the bytes start at that face's directory: the tables it
 * names are where they are in the whole file either way.
 */
export function nameTableAt(head: Uint8Array): Table | null {
  try {
    return tablesOf(new DataView(head.buffer, head.byteOffset, head.byteLength)).get('name') ?? null
  } catch {
    return null
  }
}

/** The family name from a name table read on its own. */
export function familyFromNameTable(table: Uint8Array): string | null {
  try {
    return familyName(new DataView(table.buffer, table.byteOffset, table.byteLength), 0) || null
  } catch {
    return null
  }
}

/** The style within the family, Regular or Bold Italic and so on, from a name table read on its own. */
export function styleFromNameTable(table: Uint8Array): string | null {
  try {
    return familyName(new DataView(table.buffer, table.byteOffset, table.byteLength), 0, 2) || null
  } catch {
    return null
  }
}

export interface Table {
  offset: number
  length: number
}

function tablesOf(v: DataView, face = 0): Map<string, Table> {
  const tag = v.getUint32(face)
  // TrueType (0x00010000) or OpenType with PostScript outlines ('OTTO'); a collection is not one font.
  if (tag !== 0x00010000 && tag !== 0x4f54544f) throw new Error('not a single font')
  const tables = new Map<string, Table>()
  for (let i = 0; i < v.getUint16(face + 4); i++) {
    const at = face + 12 + i * 16
    const name = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
    tables.set(name, { offset: v.getUint32(at + 8), length: v.getUint32(at + 12) })
  }
  return tables
}

/** The family name libass matches: name ID 1, or another `id`, from a Windows Unicode record. */
function familyName(v: DataView, name: number, id = 1): string {
  const count = v.getUint16(name + 2)
  const strings = name + v.getUint16(name + 4)
  for (let i = 0; i < count; i++) {
    const rec = name + 6 + i * 12
    if (v.getUint16(rec) === 3 && v.getUint16(rec + 6) === id) {
      const length = v.getUint16(rec + 8)
      const offset = strings + v.getUint16(rec + 10)
      let s = ''
      for (let k = 0; k < length; k += 2) s += String.fromCharCode(v.getUint16(offset + k))
      return s
    }
  }
  return ''
}

/** The glyph for a character, from the Unicode map's format 4 part. */
function glyphMap(v: DataView, cmap: number): (code: number) => number {
  let sub: number | null = null
  for (let i = 0; i < v.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8
    const platform = v.getUint16(rec)
    const encoding = v.getUint16(rec + 2)
    const offset = cmap + v.getUint32(rec + 4)
    if (v.getUint16(offset) === 4 && (platform === 0 || (platform === 3 && encoding === 1))) sub = offset
  }
  if (sub === null) throw new Error('no Unicode map')
  const at = sub
  const segX2 = v.getUint16(at + 6)
  const ends = at + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const ranges = deltas + segX2
  return (code) => {
    for (let s = 0; s < segX2 / 2; s++) {
      const end = v.getUint16(ends + s * 2)
      if (code > end) continue
      const start = v.getUint16(starts + s * 2)
      if (code < start) return 0
      const delta = v.getInt16(deltas + s * 2)
      const range = v.getUint16(ranges + s * 2)
      if (range === 0) return (code + delta) & 0xffff
      const g = v.getUint16(ranges + s * 2 + range + (code - start) * 2)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
}

function read(v: DataView, face: number): FontFigures {
  const tables = tablesOf(v, face)
  const need = (tag: string): number => {
    const t = tables.get(tag)
    if (!t) throw new Error(`no ${tag} table`)
    return t.offset
  }
  const upm = v.getUint16(need('head') + 18)
  const numberOfHMetrics = v.getUint16(need('hhea') + 34)
  const os2 = need('OS/2')
  const winAscent = v.getUint16(os2 + 74)
  const winDescent = v.getUint16(os2 + 76)
  const capHeight = v.getUint16(os2) >= 2 ? v.getInt16(os2 + 88) : Math.round(upm * 0.7)
  const hmtx = need('hmtx')
  const advanceOf = (glyph: number): number => v.getUint16(hmtx + Math.min(glyph, numberOfHMetrics - 1) * 4)
  const glyph = glyphMap(v, need('cmap'))
  const advance: Record<string, number> = {}
  for (const ch of MEASURED) {
    const g = glyph(ch.codePointAt(0)!)
    if (g !== 0 || ch === ' ') advance[ch] = Math.round((advanceOf(g) * 1000) / upm)
  }
  const capitals = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => advance[c]).filter((n): n is number => n !== undefined)
  if (upm === 0 || capitals.length === 0) throw new Error('no letters')
  return {
    family: familyName(v, need('name')),
    averageAdvance: Math.round(capitals.reduce((a, n) => a + n, 0) / capitals.length),
    capHeight: Math.round((capHeight / upm) * 1000) / 1000,
    assSizePerEm: Math.round(((winAscent + winDescent) / upm) * 1000) / 1000,
    assDescent: Math.round((winDescent / upm) * 1000) / 1000,
    advance
  }
}
