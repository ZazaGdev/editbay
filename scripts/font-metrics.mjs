// Reads what the caption layout needs from a TrueType font: its family name
// as libass looks it up, how wide each character is in thousandths of an em,
// and the heights libass and a canvas size it by. Run by hand when a caption
// font is added; its output is pasted into src/shared/caption-fonts.ts.
//
//   node scripts/font-metrics.mjs resources/fonts/Anton-Regular.ttf

import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/font-metrics.mjs <font.ttf>')
  process.exit(1)
}
const b = readFileSync(file)
const u16 = (o) => b.readUInt16BE(o)
const i16 = (o) => b.readInt16BE(o)
const u32 = (o) => b.readUInt32BE(o)

const tables = {}
for (let i = 0; i < u16(4); i++) {
  const at = 12 + i * 16
  tables[b.toString('latin1', at, at + 4)] = { offset: u32(at + 8), length: u32(at + 12) }
}

const upm = u16(tables.head.offset + 18)
const numberOfHMetrics = u16(tables.hhea.offset + 34)
const os2 = tables['OS/2'].offset
const winAscent = u16(os2 + 74)
const winDescent = u16(os2 + 76)
const version = u16(os2)
const capHeight = version >= 2 ? i16(os2 + 88) : Math.round(upm * 0.7)

function advanceOf(glyph) {
  const hmtx = tables.hmtx.offset
  const index = Math.min(glyph, numberOfHMetrics - 1)
  return u16(hmtx + index * 4)
}

// A format 4 subtable of cmap: the Unicode BMP map.
function glyphFor() {
  const cmap = tables.cmap.offset
  let sub = null
  for (let i = 0; i < u16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8
    const platform = u16(rec)
    const encoding = u16(rec + 2)
    const offset = cmap + u32(rec + 4)
    if (u16(offset) === 4 && (platform === 3 || platform === 0) && (encoding === 1 || platform === 0)) sub = offset
  }
  if (sub === null) throw new Error('no format 4 cmap')
  const segX2 = u16(sub + 6)
  const ends = sub + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const ranges = deltas + segX2
  return (code) => {
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(ends + s * 2)
      if (code > end) continue
      const start = u16(starts + s * 2)
      if (code < start) return 0
      const delta = i16(deltas + s * 2)
      const range = u16(ranges + s * 2)
      if (range === 0) return (code + delta) & 0xffff
      const g = u16(ranges + s * 2 + range + (code - start) * 2)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
}

// The family name libass matches: name ID 1, from a Windows Unicode record.
function familyName() {
  const name = tables.name.offset
  const count = u16(name + 2)
  const strings = name + u16(name + 4)
  for (let i = 0; i < count; i++) {
    const rec = name + 6 + i * 12
    if (u16(rec) === 3 && u16(rec + 6) === 1) {
      const length = u16(rec + 8)
      const offset = strings + u16(rec + 10)
      let s = ''
      for (let k = 0; k < length; k += 2) s += String.fromCharCode(u16(offset + k))
      return s
    }
  }
  return ''
}

const glyph = glyphFor()
const chars = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), '’', '‘', '“', '”', '…', '—']
const advance = {}
for (const ch of chars) {
  const g = glyph(ch.codePointAt(0))
  if (g !== 0 || ch === ' ') advance[ch] = Math.round((advanceOf(g) * 1000) / upm)
}
const capitals = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => advance[c]).filter((n) => n !== undefined)
console.log(
  JSON.stringify(
    {
      family: familyName(),
      averageAdvance: Math.round(capitals.reduce((a, n) => a + n, 0) / capitals.length),
      capHeight: Math.round((capHeight / upm) * 1000) / 1000,
      assSizePerEm: Math.round(((winAscent + winDescent) / upm) * 1000) / 1000,
      assDescent: Math.round((winDescent / upm) * 1000) / 1000,
      advance
    },
    null,
    1
  )
)
