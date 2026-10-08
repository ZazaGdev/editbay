/**
 * The looks a picture clip can have, how strongly, and the four sliders on
 * top of them (plans 35 and 85).
 *
 * Every look and every slider is the same kind of change: each pixel's red,
 * green and blue mixed by a 3 by 3 matrix, plus an offset, clamped once at
 * the end. Any mix of them is one such change too, so a clip's colour is one
 * matrix, and the Output view and the export each apply that matrix and
 * nothing else: the view through an SVG `feColorMatrix`, the export through
 * `colorchannelmixer` on an RGBA frame, whose alpha column is the offset. The
 * two were measured to give the same levels exactly. A look goes on this
 * list only when they do, because a preview that disagrees with the file is
 * worse than having no look at all.
 *
 * Black and white alone, at full strength and with no slider moved, keeps
 * the halves plan 35 measured, so no project made before changes.
 */

/** Rows for red, green and blue, each the three weights and then the offset, in shares of full. */
export type ColourMatrix = readonly [readonly number[], readonly number[], readonly number[]]

export interface Look {
  id: string
  name: string
  /** What the Inspector's button says it does. */
  title: string
  matrix: ColourMatrix
}

/** The four sliders, each -100 to 100, 0 for as recorded. Absent for 0. */
export interface ColourAdjust {
  brightness?: number
  contrast?: number
  saturation?: number
  warmth?: number
}

export const ADJUSTMENTS: readonly { id: keyof ColourAdjust; name: string; title: string }[] = [
  { id: 'brightness', name: 'Brightness', title: 'Lighter or darker' },
  { id: 'contrast', name: 'Contrast', title: 'More or less between the darks and the lights' },
  { id: 'saturation', name: 'Saturation', title: 'Stronger or weaker colour' },
  { id: 'warmth', name: 'Warmth', title: 'Warmer, towards orange, or cooler, towards blue' }
]

const IDENTITY: ColourMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0]
]

/** The Rec. 709 weights of red, green and blue in brightness, as an HD recording was made with. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

/** One matrix after another: `second` applied to what `first` gives. */
export function followedBy(first: ColourMatrix, second: ColourMatrix): ColourMatrix {
  const row = (r: readonly number[]): number[] => [
    r[0]! * first[0][0]! + r[1]! * first[1][0]! + r[2]! * first[2][0]!,
    r[0]! * first[0][1]! + r[1]! * first[1][1]! + r[2]! * first[2][1]!,
    r[0]! * first[0][2]! + r[1]! * first[1][2]! + r[2]! * first[2][2]!,
    r[0]! * first[0][3]! + r[1]! * first[1][3]! + r[2]! * first[2][3]! + r[3]!
  ]
  return [row(second[0]), row(second[1]), row(second[2])]
}

/** A part of the way from as recorded to `m`: 0 is none of it, 1 all of it. */
function partWay(m: ColourMatrix, t: number): ColourMatrix {
  const mix = (a: readonly number[], b: readonly number[]): number[] => a.map((x, i) => x + (b[i]! - x) * t)
  return [mix(IDENTITY[0], m[0]), mix(IDENTITY[1], m[1]), mix(IDENTITY[2], m[2])]
}

/** Colour taken out by `1 - s`, or put in past the recording's for `s` over 1, keeping brightness. */
function saturate(s: number): ColourMatrix {
  const row = (i: number): number[] => [...LUMA.map((w, j) => w * (1 - s) + (i === j ? s : 0)), 0]
  return [row(0), row(1), row(2)]
}

/** Spread from the middle grey by `c`. */
function contrast(c: number): ColourMatrix {
  const o = 0.5 - 0.5 * c
  return [
    [c, 0, 0, o],
    [0, c, 0, o],
    [0, 0, c, o]
  ]
}

function scale(r: number, g: number, b: number, lift = 0): ColourMatrix {
  return [
    [r, 0, 0, lift],
    [0, g, 0, lift],
    [0, 0, b, lift]
  ]
}

/** Warmer for `w` over 0, towards orange, cooler under it, towards blue. */
function warm(w: number): ColourMatrix {
  return scale(1 + 0.12 * w, 1 + 0.02 * w, 1 - 0.12 * w)
}

export const LOOKS: readonly Look[] = [
  {
    id: 'mono',
    name: 'Black and white',
    title: 'Take the colour out of this clip',
    matrix: saturate(0)
  },
  {
    // The matrix CSS's sepia() uses, as photo editors have long had it.
    id: 'sepia',
    name: 'Sepia',
    title: 'Brown and old, as an old photograph',
    matrix: [
      [0.393, 0.769, 0.189, 0],
      [0.349, 0.686, 0.168, 0],
      [0.272, 0.534, 0.131, 0]
    ]
  },
  { id: 'warm', name: 'Warm', title: 'Towards orange, as late sun', matrix: warm(1) },
  { id: 'cool', name: 'Cool', title: 'Towards blue, as shade', matrix: warm(-1) },
  {
    id: 'faded',
    name: 'Faded',
    title: 'Softer colour and lifted blacks, as a print left in the sun',
    matrix: followedBy(saturate(0.7), scale(0.84, 0.84, 0.84, 0.08))
  },
  { id: 'contrast', name: 'High contrast', title: 'Deeper darks and brighter lights', matrix: followedBy(contrast(1.35), saturate(1.1)) },
  { id: 'vivid', name: 'Vivid', title: 'Stronger colour', matrix: followedBy(saturate(1.45), contrast(1.08)) }
]

/** A look by its id, or null for none, including an id the app no longer has. */
export function lookOf(id: unknown): Look | null {
  return LOOKS.find((l) => l.id === id) ?? null
}

/**
 * A stored look as the app can use it: its id when it names one on the list,
 * otherwise undefined. A look taken off the list must never stop a project
 * opening, and one that cannot be drawn is the same as none.
 */
export function cleanLook(id: unknown): string | undefined {
  return lookOf(id)?.id
}

/** A stored strength as the app can use it, 0 to 100, or undefined for full. */
export function cleanStrength(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  const s = Math.round(Math.min(100, Math.max(0, n)))
  return s === 100 ? undefined : s
}

/** Stored sliders as the app can use them, each -100 to 100, those at 0 left out; undefined when none moved. */
export function cleanAdjust(a: unknown): ColourAdjust | undefined {
  if (!a || typeof a !== 'object') return undefined
  const out: ColourAdjust = {}
  for (const { id } of ADJUSTMENTS) {
    const v = (a as Record<string, unknown>)[id]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const n = Math.round(Math.min(100, Math.max(-100, v)))
    if (n !== 0) out[id] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The background colours Remove background keys out (plan 90). */
export type BackgroundColour = 'green' | 'blue' | 'black'
export const BACKGROUND_COLOURS: readonly BackgroundColour[] = ['green', 'blue', 'black']

/** A plain colour: red, green and blue, each 0 to 255 (plan 98). */
export type Rgb = readonly [number, number, number]

/** A clip's background taken out: which colour, and how strongly, 0 to 100. */
export interface BackgroundRemoval {
  /** Green, blue or black (plan 90), or any other plain colour, given as `rgb` (plan 98). */
  colour: BackgroundColour | 'plain'
  rgb?: Rgb
  strength?: number
}

/** The background a clip was found to stand on: green, blue, black, or another plain colour (plan 98). */
export type FoundBackground = { colour: BackgroundColour } | { colour: 'plain'; rgb: Rgb }

/**
 * What a background's colour is called, for the words round it: green, blue
 * and black by name, and a plain colour by the nearest everyday one, white,
 * grey, dark grey or a hue.
 */
export function backgroundName(b: { colour: BackgroundColour | 'plain'; rgb?: Rgb }): string {
  if (b.colour !== 'plain' || !b.rgb) return b.colour
  const [r, g, bl] = b.rgb
  const hi = Math.max(r, g, bl)
  const lo = Math.min(r, g, bl)
  if (hi - lo < 30) return hi > 200 ? 'white' : hi < 60 ? 'black' : hi < 110 ? 'dark grey' : 'grey'
  // The hue, in degrees round the colour wheel.
  const c = hi - lo
  const h = hi === r ? ((g - bl) / c + 6) % 6 : hi === g ? (bl - r) / c + 2 : (r - g) / c + 4
  const deg = h * 60
  const names: [number, string][] = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [165, 'green'], [195, 'cyan'], [255, 'blue'], [290, 'purple'], [340, 'pink'], [360, 'red']]
  return names.find(([upTo]) => deg < upTo)![1]
}

/** How strongly a background is taken out when nothing says otherwise. */
export const BACKGROUND_STRENGTH = 50

/** A background removal as it is kept, or undefined for none or one that makes no sense. */
export function cleanBackground(b: unknown): BackgroundRemoval | undefined {
  if (!b || typeof b !== 'object') return undefined
  const { colour, rgb, strength } = b as { colour?: unknown; rgb?: unknown; strength?: unknown }
  const n = typeof strength === 'number' && Number.isFinite(strength) ? Math.round(Math.min(100, Math.max(0, strength))) : undefined
  const strengthPart = n !== undefined && n !== BACKGROUND_STRENGTH ? { strength: n } : {}
  if (colour === 'plain') {
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined
    const level = (v: number): number => Math.round(Math.min(255, Math.max(0, v)))
    return { colour: 'plain', rgb: [level(rgb[0]), level(rgb[1]), level(rgb[2])], ...strengthPart }
  }
  if (!BACKGROUND_COLOURS.includes(colour as BackgroundColour)) return undefined
  return { colour: colour as BackgroundColour, ...strengthPart }
}

/**
 * A background removal as a row of the colour matrix for alpha, which the
 * Output view's `feColorMatrix` and the export's `colorchannelmixer` both
 * apply: alpha from red, green and blue, plus a constant, clamped to 0 to 1.
 * Green goes clear where green stands above red and blue, blue likewise, and
 * black where the picture is dark.
 *
 * ffmpeg takes no factor past 2, so a key that needs more is written at half
 * and doubled by a second step, `times`, which the view takes too: the two
 * clamp at the same places and come out the same.
 */
export function backgroundAlpha(b: BackgroundRemoval | undefined): { row: [number, number, number, number]; times: 1 | 2 } | null {
  const clean = cleanBackground(b)
  if (!clean || clean.colour === 'plain') return null
  const s = (clean.strength ?? BACKGROUND_STRENGTH) / 100
  if (clean.colour === 'black') {
    // Opaque from a third of full brightness at the default, more of it clear as it is turned up.
    const k = (1 + 5 * s) / 3
    return { row: [k, k, k, 0], times: 1 }
  }
  // alpha = 1 + k(r + b - 2g) for green, written at half and doubled.
  const k = 0.5 + 1.5 * s
  return clean.colour === 'green' ? { row: [k / 2, -k, k / 2, 0.5], times: 2 } : { row: [k / 2, k / 2, -k, 0.5], times: 2 }
}

/** How far past `from` a plain background's key goes from clear to solid, as an average distance 0 to 1. */
export const PLAIN_SOFTNESS = 0.1

/**
 * A plain background taken out (plan 98), as a distance from its colour: the
 * average over red, green and blue of how far a pixel is from it, 0 to 1.
 * Clear within `from` of it, solid past `from + width`, and soft between.
 * Strength sets `from`, 0.04 at none to 0.20 at full, 0.12 at the default.
 * Null for none, or for green, blue or black, which keep their own keys.
 */
export function backgroundDistance(b: BackgroundRemoval | undefined): { rgb: Rgb; from: number; width: number } | null {
  const clean = cleanBackground(b)
  if (!clean || clean.colour !== 'plain' || !clean.rgb) return null
  const s = (clean.strength ?? BACKGROUND_STRENGTH) / 100
  return { rgb: clean.rgb, from: 0.04 + 0.16 * s, width: PLAIN_SOFTNESS }
}

/** What of a clip its colour is made from. */
export interface Coloured {
  look?: string
  lookStrength?: number
  adjust?: ColourAdjust
  /** Its background taken out, which rides in the colour code as its alpha (plan 90). */
  removeBackground?: BackgroundRemoval
}

/** The four sliders as one matrix, in this order: brightness, contrast, saturation, warmth. */
function adjustMatrix(a: ColourAdjust): ColourMatrix {
  let m = IDENTITY
  if (a.brightness) m = followedBy(m, scale(1 + a.brightness / 200, 1 + a.brightness / 200, 1 + a.brightness / 200))
  if (a.contrast) m = followedBy(m, contrast(1 + a.contrast / 200))
  if (a.saturation) m = followedBy(m, saturate(1 + a.saturation / 100))
  if (a.warmth) m = followedBy(m, warm(a.warmth / 100))
  return m
}

/** A clip's whole colour as one matrix: its look at its strength, then the sliders. Null for as recorded. */
export function colourMatrix(c: Coloured): ColourMatrix | null {
  const look = lookOf(c.look)
  const strength = (cleanStrength(c.lookStrength) ?? 100) / 100
  const adjust = cleanAdjust(c.adjust)
  if ((!look || strength === 0) && !adjust) return null
  const base = look && strength > 0 ? partWay(look.matrix, strength) : IDENTITY
  return adjust ? followedBy(base, adjustMatrix(adjust)) : base
}

/** A number as short as it can be written and still be the same to six places. */
function short(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * A clip's colour as a short code the preview and the export both read:
 * undefined for as recorded, `mono` for Black and white alone as plan 35 drew
 * it, and otherwise `m:` and the matrix's twelve numbers.
 */
export function colourKey(c: Coloured): string | undefined {
  const alpha = backgroundAlpha(c.removeBackground)
  const distance = backgroundDistance(c.removeBackground)
  const m = colourMatrix(c) ?? (alpha || distance ? IDENTITY : null)
  if (!m) return undefined
  if (!alpha && !distance && c.look === 'mono' && cleanStrength(c.lookStrength) === undefined && !cleanAdjust(c.adjust)) return 'mono'
  // The alpha after the colour, as `;a:` and its four numbers and how many
  // times it is taken, or as `;d:`, the plain colour and its `from` and `width`.
  const key = alpha
    ? `;a:${alpha.row.map(short).join(',')},${alpha.times}`
    : distance
      ? `;d:${[...distance.rgb, distance.from, distance.width].map(short).join(',')}`
      : ''
  return `m:${m.flat().map(short).join(',')}${key}`
}

/**
 * A clip's colour code, or the code it already carries: an overlay's
 * pictures, rebuilt as a clip for the export's graph, carry theirs as it is.
 */
export function colourKeyOf(c: Coloured): string | undefined {
  return c.look?.startsWith('m:') ? c.look : colourKey(c)
}

/** The matrix a code stands for, or null for one that is not a matrix. */
export function matrixOfKey(key: string): ColourMatrix | null {
  if (!key.startsWith('m:')) return null
  const n = key.slice(2).split(';')[0]!.split(',').map(Number)
  if (n.length !== 12 || n.some((x) => !Number.isFinite(x))) return null
  return [n.slice(0, 4), n.slice(4, 8), n.slice(8, 12)]
}

/** The alpha row a code carries for a background taken out, or null for none. */
export function alphaOfKey(key: string | undefined): { row: number[]; times: 1 | 2 } | null {
  const part = key?.split(';a:')[1]
  if (!part) return null
  const n = part.split(',').map(Number)
  if (n.length !== 5 || n.some((x) => !Number.isFinite(x)) || (n[4] !== 1 && n[4] !== 2)) return null
  return { row: n.slice(0, 4), times: n[4] as 1 | 2 }
}

/** The plain colour and its ramp a code carries for a plain background taken out (plan 98), or null for none. */
export function distanceOfKey(key: string | undefined): { rgb: Rgb; from: number; width: number } | null {
  const part = key?.split(';d:')[1]
  if (!part) return null
  const n = part.split(',').map(Number)
  if (n.length !== 5 || n.some((x) => !Number.isFinite(x)) || !(n[4]! > 0)) return null
  return { rgb: [n[0]!, n[1]!, n[2]!], from: n[3]!, width: n[4]! }
}

/** Whether a code takes a background out, by either kind of key, so its picture has clear pixels. */
export function isKeyed(key: string | undefined): boolean {
  return alphaOfKey(key) !== null || distanceOfKey(key) !== null
}

/**
 * One channel's distance from a level `c`, 0 to 255, as the 256 entries of an
 * `feFuncR`'s table: exact at every 8-bit level, as ffmpeg's `lutrgb` is.
 */
export function distanceTable(c: number): string {
  return Array.from({ length: 256 }, (_, i) => short(Math.abs(i - c) / 255)).join(' ')
}

/**
 * The ffmpeg filters a plain background is taken out with (plan 98), on RGBA:
 * each channel's distance from the colour by `lutrgb`, their average into
 * alpha, the ramp on it by `lut`, multiplied by the picture's own alpha and
 * put on the picture. Labelled by `tag`, as more than one clip's chain can be
 * in one graph. The Output view's SVG filter takes the same steps.
 */
function distanceFfmpeg(d: { rgb: Rgb; from: number; width: number }, tag: string): string {
  const [cr, cg, cb] = d.rgb
  const k = (n: string): string => `kd${tag}${n}`
  const third = short(1 / 3)
  return (
    `split=3[${k('c')}][${k('d')}][${k('s')}];` +
    `[${k('d')}]lutrgb=r='abs(val-${cr})':g='abs(val-${cg})':b='abs(val-${cb})',` +
    `colorchannelmixer=rr=0:gg=0:bb=0:ar=${third}:ag=${third}:ab=${third}:aa=0,` +
    `lut=a='clip((val-${short(d.from * 255)})*${short(1 / d.width)},0,255)',alphaextract[${k('a')}];` +
    `[${k('s')}]alphaextract[${k('o')}];[${k('a')}][${k('o')}]blend=all_mode=multiply[${k('k')}];` +
    `[${k('c')}][${k('k')}]alphamerge`
  )
}

/** The ffmpeg filters a colour code is written with, at the head of a clip's chain, from video and back to it. */
export function colourFfmpeg(key: string | undefined, toRgb: string, toVideo: string, tag = ''): string[] {
  if (!key) return []
  if (key === 'mono') return ['hue=s=0']
  const m = matrixOfKey(key)
  if (!m) return []
  const distance = distanceOfKey(key)
  if (distance) {
    // The key from the colours as recorded, then the look, which keeps the alpha the key made.
    const [r, g, b] = m.map((row) => row.map(short))
    return [
      toRgb,
      'format=rgba',
      distanceFfmpeg(distance, tag),
      `colorchannelmixer=rr=${r![0]}:rg=${r![1]}:rb=${r![2]}:ra=${r![3]}:gr=${g![0]}:gg=${g![1]}:gb=${g![2]}:ga=${g![3]}:br=${b![0]}:bg=${b![1]}:bb=${b![2]}:ba=${b![3]}:aa=1`,
      toVideo
    ]
  }
  const [r, g, b] = m.map((row) => row.map(short))
  // With a background taken out, alpha from the colours: the constant rides
  // on the picture's own alpha, which is 1 for a recording.
  const alpha = alphaOfKey(key)
  const a = alpha ? alpha.row.map(short) : null
  return [
    toRgb,
    'format=rgba',
    `colorchannelmixer=rr=${r![0]}:rg=${r![1]}:rb=${r![2]}:ra=${r![3]}:gr=${g![0]}:gg=${g![1]}:gb=${g![2]}:ga=${g![3]}:br=${b![0]}:bg=${b![1]}:bb=${b![2]}:ba=${b![3]}:` +
      (a ? `ar=${a[0]}:ag=${a[1]}:ab=${a[2]}:aa=${a[3]}` : 'aa=1'),
    ...(alpha?.times === 2 ? ['colorchannelmixer=aa=2'] : []),
    toVideo
  ]
}

/** The id the Output view's SVG filter for a colour code is found by. */
export function colourFilterId(key: string): string {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return `editbay-colour-${(h >>> 0).toString(16)}`
}

/** The values of an `feColorMatrix` for a matrix: four rows of five, alpha kept, or from the colours when a background is taken out. */
export function feColorMatrixValues(m: ColourMatrix, alpha?: readonly number[] | null): string {
  // The key's constant on the picture's own alpha, as ffmpeg's `aa` is: an image's clear pixels stay clear.
  const a = alpha ? [alpha[0]!, alpha[1]!, alpha[2]!, alpha[3]!, 0].map(short).join(' ') : '0 0 0 1 0'
  return [...m.map((row) => [row[0], row[1], row[2], 0, row[3]].map((x) => short(x!)).join(' ')), a].join('  ')
}

/** The canvas filter a colour code is drawn with: `grayscale(1)` for plan 35's Black and white, else the SVG filter by id. */
export function colourCanvas(key: string | undefined): string | undefined {
  if (!key) return undefined
  if (key === 'mono') return 'grayscale(1)'
  return matrixOfKey(key) ? `url(#${colourFilterId(key)})` : undefined
}
