import { newId } from './ids'

/**
 * Plan 83: shapes over the picture. An arrow, a line, a box or a circle,
 * drawn by the window into a picture as a text is, so the preview and the
 * export show the same pixels, and moved, turned, faded and popped as any
 * picture laid over the footage is.
 *
 * A shape's body is the box its outline is drawn in, in output pixels. A
 * line's ends and its bend are shares of that body, so a body made wider or
 * taller takes the line with it. The picture is the body with a margin round
 * it for what is drawn outside it: half the outline, the arrowheads, the shadow.
 */

/** Plan 88: a pen stroke is drawn by hand, its path kept as points. */
export type ShapeKind = 'line' | 'box' | 'ellipse' | 'pen'

export interface Point {
  x: number
  y: number
}

export interface ShapeStyle {
  kind: ShapeKind
  /** The body's size, in output pixels. */
  width: number
  height: number
  /** A line's two ends, as shares of the body, 0 to 1. */
  from: Point
  to: Point
  /** A curved line's bend: the point its curve is pulled towards, as a share of the body. Absent for straight. */
  bend?: Point
  /** Arrowheads on a line, at its start and at its end. */
  startHead: boolean
  endHead: boolean
  /** The outline: its colour, as `#rrggbb`, and its width in output pixels, 0 for none. */
  stroke: string
  strokeWidth: number
  /** A box's or a circle's fill, as `#rrggbb`, or null for none, and how see-through it is. */
  fill: string | null
  fillOpacity: number
  /** A box's corners, in output pixels. */
  radius: number
  /** A soft shadow under it, so it reads over busy footage. */
  shadow: boolean
  /** Plan 88: a pen stroke's path, as shares of the body, in the order it was drawn. */
  points?: Point[]
  /** How see-through the outline is, 0 to 1: a highlighter's is. Absent for solid. */
  strokeOpacity?: number
  /** Plan 88: how many seconds the outline takes to draw itself on. Absent for none. */
  drawOn?: number
}

/** The most points a pen stroke keeps, after it is simplified. */
export const MAX_PEN_POINTS = 600

/** The draw on times offered, in seconds. */
export const DRAW_ON_CHOICES: { seconds: number; name: string }[] = [
  { seconds: 0, name: 'Off' },
  { seconds: 0.5, name: 'Quick' },
  { seconds: 1, name: 'Steady' },
  { seconds: 2, name: 'Slow' }
]

/** The longest a shape takes to draw itself on, in seconds. */
export const MAX_DRAW_ON = 10

/** How many pictures a second a shape drawing itself on is drawn at. */
export const DRAW_ON_RATE = 30

export const MAX_STROKE = 60
export const MAX_RADIUS = 400
/** The smallest a box or a circle is drawn, in output pixels, from a click or a short drag. */
export const MIN_BOX = 12

/** How far a shadow reaches past what casts it, in output pixels, and how it is drawn. */
export const SHADOW = { blur: 10, x: 0, y: 4, colour: 'rgba(0,0,0,0.55)' }

const BASE: ShapeStyle = {
  kind: 'box',
  width: 300,
  height: 200,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  startHead: false,
  endHead: false,
  stroke: '#ff3b30',
  strokeWidth: 8,
  fill: null,
  fillOpacity: 1,
  radius: 0,
  shadow: true
}

/** The ready styles the Shape menu offers, each one click. */
export const BUILT_IN_SHAPES: { id: string; label: string; style: ShapeStyle; bent?: number }[] = [
  { id: 'arrow', label: 'Arrow', style: { ...BASE, kind: 'line', endHead: true } },
  { id: 'curved-arrow', label: 'Curved arrow', style: { ...BASE, kind: 'line', endHead: true }, bent: 0.25 },
  { id: 'line', label: 'Line', style: { ...BASE, kind: 'line' } },
  { id: 'box', label: 'Box', style: { ...BASE } },
  { id: 'rounded-box', label: 'Rounded box', style: { ...BASE, radius: 24 } },
  { id: 'circle', label: 'Circle', style: { ...BASE, kind: 'ellipse' } },
  {
    id: 'highlight',
    label: 'Highlight',
    style: { ...BASE, stroke: '#ffd60a', strokeWidth: 0, fill: '#ffd60a', fillOpacity: 0.35, radius: 6, shadow: false }
  },
  // Plan 88: drawn by hand, a press and a drag along the path.
  { id: 'pen', label: 'Pen', style: { ...BASE, kind: 'pen', strokeWidth: 8 } },
  { id: 'highlighter', label: 'Highlighter', style: { ...BASE, kind: 'pen', stroke: '#ffd60a', strokeWidth: 28, strokeOpacity: 0.45, shadow: false } }
]

/** What a shape is called on the timeline and in the Inspector. */
export function shapeName(style: ShapeStyle): string {
  if (style.kind === 'pen') return (style.strokeOpacity ?? 1) < 1 ? 'Highlighter' : 'Pen'
  if (style.kind === 'ellipse') return 'Circle'
  if (style.kind === 'box') return style.strokeWidth === 0 && style.fill !== null ? 'Highlight' : 'Box'
  const curved = style.bend !== undefined
  if (style.startHead || style.endHead) return curved ? 'Curved arrow' : 'Arrow'
  return curved ? 'Curved line' : 'Line'
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const colour = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null)
function point(v: unknown, fallback: Point): Point {
  if (typeof v !== 'object' || v === null) return fallback
  const r = v as Record<string, unknown>
  return { x: clamp(num(r.x, fallback.x), 0, 1), y: clamp(num(r.y, fallback.y), 0, 1) }
}

/** A kept shape made safe: what is damaged goes back to how a new one starts. */
export function cleanShapeStyle(raw: unknown): ShapeStyle {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const kind: ShapeKind = r.kind === 'line' || r.kind === 'ellipse' || r.kind === 'pen' ? r.kind : 'box'
  const bend = r.bend !== undefined ? point(r.bend, { x: 0.5, y: 0.5 }) : undefined
  const stroked = kind === 'line' || kind === 'pen'
  const kept = Array.isArray(r.points) ? (r.points as unknown[]).slice(0, MAX_PEN_POINTS).map((p) => point(p, { x: 0, y: 0 })) : []
  const points = kept.length >= 2 ? kept : [BASE.from, BASE.to]
  const strokeOpacity = clamp(num(r.strokeOpacity, 1), 0.05, 1)
  const drawOn = clamp(num(r.drawOn, 0), 0, MAX_DRAW_ON)
  return {
    kind,
    width: clamp(Math.round(num(r.width, BASE.width)), 2, 20000),
    height: clamp(Math.round(num(r.height, BASE.height)), 2, 20000),
    from: point(r.from, BASE.from),
    to: point(r.to, BASE.to),
    ...(kind === 'line' && bend ? { bend } : {}),
    startHead: kind === 'line' && r.startHead === true,
    endHead: kind === 'line' && r.endHead === true,
    stroke: colour(r.stroke) ?? BASE.stroke,
    strokeWidth: clamp(num(r.strokeWidth, BASE.strokeWidth), stroked ? 1 : 0, MAX_STROKE),
    fill: stroked ? null : r.fill === null ? null : (colour(r.fill) ?? null),
    fillOpacity: clamp(num(r.fillOpacity, 1), 0, 1),
    radius: kind === 'box' ? clamp(num(r.radius, 0), 0, MAX_RADIUS) : 0,
    shadow: r.shadow === true,
    // Kept only when they say something, so a shape without them keeps the name its picture has.
    ...(kind === 'pen' ? { points } : {}),
    ...(strokeOpacity < 1 ? { strokeOpacity } : {}),
    ...(drawOn > 0 ? { drawOn } : {})
  }
}

/**
 * The name a shape's picture is kept under, sixteen hex digits as a text's
 * is, and never one a text's could be: the same shape drawn again finds it.
 */
export function shapeKey(style: ShapeStyle): string {
  const clean = cleanShapeStyle(style)
  const json = 'shape' + JSON.stringify(Object.keys(clean).sort().map((k) => [k, clean[k as keyof ShapeStyle]]))
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let g = 0x6c62272e
  for (let i = json.length - 1; i >= 0; i--) {
    g ^= json.charCodeAt(i)
    g = Math.imul(g, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}${g.toString(16).padStart(8, '0')}`
}

/** An arrowhead's length and width, from the line's width. */
export function headSize(style: Pick<ShapeStyle, 'strokeWidth'>): { length: number; width: number } {
  const length = Math.max(16, style.strokeWidth * 3.2)
  return { length, width: length * 0.95 }
}

/** How far past its body a shape is drawn, in output pixels: half its outline, its arrowheads, its shadow. */
export function shapeMargin(style: ShapeStyle): number {
  const heads = style.kind === 'line' && (style.startHead || style.endHead) ? headSize(style).width / 2 + style.strokeWidth : 0
  const outline = style.strokeWidth / 2
  const shadow = style.shadow ? SHADOW.blur * 1.5 + Math.max(Math.abs(SHADOW.x), Math.abs(SHADOW.y)) : 0
  return Math.ceil(Math.max(outline, heads) + shadow + 2)
}

const even = (n: number): number => Math.max(2, Math.ceil(n / 2) * 2)

/** The size of a shape's picture: its body and the margin round it, in even output pixels. */
export function pictureSize(style: ShapeStyle): { width: number; height: number } {
  const m = shapeMargin(style)
  return { width: even(style.width + 2 * m), height: even(style.height + 2 * m) }
}

/** Where the body sits in the picture: centred, in output pixels. */
export function bodyInPicture(style: ShapeStyle): { x: number; y: number } {
  const p = pictureSize(style)
  return { x: (p.width - style.width) / 2, y: (p.height - style.height) / 2 }
}

/** A rectangle in output pixels. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A line's ends and bend in output pixels, from where its body is. */
export function linePoints(style: ShapeStyle, body: Box): { from: Point; to: Point; bend: Point | null } {
  const at = (p: Point): Point => ({ x: body.x + p.x * body.w, y: body.y + p.y * body.h })
  return { from: at(style.from), to: at(style.to), bend: style.bend ? at(style.bend) : null }
}

/**
 * A line through these points, in output pixels: its body, the box round
 * its two ends and its bend, never thinner than 2, and each point as a
 * share of it. A curve never leaves the box round its ends and the point
 * it is pulled to, so the body holds the whole of it.
 */
export function lineThrough(style: ShapeStyle, from: Point, to: Point, bend: Point | null): { style: ShapeStyle; body: Box } {
  const xs = [from.x, to.x, ...(bend ? [bend.x] : [])]
  const ys = [from.y, to.y, ...(bend ? [bend.y] : [])]
  let x = Math.min(...xs)
  let y = Math.min(...ys)
  let w = Math.max(...xs) - x
  let h = Math.max(...ys) - y
  if (w < 2) {
    x -= (2 - w) / 2
    w = 2
  }
  if (h < 2) {
    y -= (2 - h) / 2
    h = 2
  }
  const share = (p: Point): Point => ({ x: clamp((p.x - x) / w, 0, 1), y: clamp((p.y - y) / h, 0, 1) })
  const { bend: _old, ...rest } = style
  return {
    style: { ...rest, width: Math.round(w), height: Math.round(h), from: share(from), to: share(to), ...(bend ? { bend: share(bend) } : {}) },
    body: { x, y, w, h }
  }
}

/** The bend a curved line starts with: pulled to one side of its middle by `amount` of its length. */
export function bendFor(from: Point, to: Point, amount: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return { x: (from.x + to.x) / 2 + dy * amount, y: (from.y + to.y) / 2 - dx * amount }
}

/**
 * A new shape dragged from `a` to `b` on the frame, in output pixels, in the
 * look of `style`: a line from one to the other, bent by `bent` when it is a
 * curved one, or a box or circle with them as opposite corners. A click with
 * hardly any drag makes one of a usable size, centred there, or for a line
 * ending there.
 */
export function shapeFromDrag(style: ShapeStyle, a: Point, b: Point, bent = 0): { style: ShapeStyle; body: Box } {
  const far = Math.hypot(b.x - a.x, b.y - a.y) >= MIN_BOX
  if (style.kind === 'line') {
    // A click: an arrow of 240 pixels coming in from the upper left, its point on the click.
    const from = far ? a : { x: a.x - 170, y: a.y - 170 }
    const to = far ? b : a
    return lineThrough(style, from, to, bent !== 0 ? bendFor(from, to, bent) : null)
  }
  const box = far
    ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(MIN_BOX, Math.abs(b.x - a.x)), h: Math.max(MIN_BOX, Math.abs(b.y - a.y)) }
    : { x: a.x - 150, y: a.y - (style.kind === 'ellipse' ? 150 : 100), w: 300, h: style.kind === 'ellipse' ? 300 : 200 }
  return { style: { ...style, width: Math.round(box.w), height: Math.round(box.h) }, body: box }
}

/** The points of a path that matter: the ones a straight run between neighbours would lose by more than `within` pixels. */
export function simplifyPath(points: readonly Point[], within: number): Point[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let far = -1
    let most = within
    for (let i = a + 1; i < b; i++) {
      const d = offLine(points[i]!, points[a]!, points[b]!)
      if (d > most) {
        most = d
        far = i
      }
    }
    if (far < 0) continue
    keep[far] = true
    stack.push([a, far], [far, b])
  }
  return points.filter((_, i) => keep[i])
}

/** How far a point is from the segment between two others. */
function offLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Plan 88: a pen stroke drawn along these points on the frame, in output
 * pixels, in the look of `style`: simplified to what shows, its body the box
 * round it, and each point a share of that box. A click with no drag leaves
 * a dot.
 */
export function shapeFromPath(style: ShapeStyle, path: readonly Point[]): { style: ShapeStyle; body: Box } {
  const start = path[0] ?? { x: 0, y: 0 }
  const raw = path.length >= 2 ? path : [start, { x: start.x + 1, y: start.y }]
  let within = 1.5
  let points = simplifyPath(raw, within)
  while (points.length > MAX_PEN_POINTS) {
    within *= 2
    points = simplifyPath(raw, within)
  }
  if (points.length < 2) points = [raw[0]!, raw[raw.length - 1]!]
  let x = Math.min(...points.map((p) => p.x))
  let y = Math.min(...points.map((p) => p.y))
  let w = Math.max(...points.map((p) => p.x)) - x
  let h = Math.max(...points.map((p) => p.y)) - y
  if (w < 2) {
    x -= (2 - w) / 2
    w = 2
  }
  if (h < 2) {
    y -= (2 - h) / 2
    h = 2
  }
  const share = (p: Point): Point => ({ x: clamp((p.x - x) / w, 0, 1), y: clamp((p.y - y) / h, 0, 1) })
  const { bend: _bend, ...rest } = style
  return {
    style: { ...rest, kind: 'pen', width: Math.round(w), height: Math.round(h), points: points.map(share), startHead: false, endHead: false, fill: null },
    body: { x, y, w, h }
  }
}

/**
 * How long a shape's outline is, in output pixels, for drawing part of it:
 * along a line or its curve, round a box or an ellipse, along a pen's path.
 */
export function outlineLength(style: ShapeStyle): number {
  const w = style.width
  const h = style.height
  const along = (pts: Point[]): number => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0)
  const at = (p: Point): Point => ({ x: p.x * w, y: p.y * h })
  if (style.kind === 'pen') return along((style.points ?? []).map(at))
  if (style.kind === 'line') {
    const from = at(style.from)
    const to = at(style.to)
    if (!style.bend) return Math.hypot(to.x - from.x, to.y - from.y)
    const bend = at(style.bend)
    const curve: Point[] = []
    for (let i = 0; i <= 32; i++) {
      const t = i / 32
      const u = 1 - t
      curve.push({ x: u * u * from.x + 2 * u * t * bend.x + t * t * to.x, y: u * u * from.y + 2 * u * t * bend.y + t * t * to.y })
    }
    return along(curve)
  }
  if (style.kind === 'ellipse') {
    const a = w / 2
    const b = h / 2
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  }
  return 2 * (w + h)
}

/** How many pictures a shape drawing itself on takes: none past one when it does not. */
export function drawOnFrames(style: Pick<ShapeStyle, 'drawOn'>): number {
  const seconds = style.drawOn ?? 0
  return seconds > 0 ? Math.max(2, Math.round(seconds * DRAW_ON_RATE)) : 1
}

/** Where a shape's picture goes on the frame, in output pixels, for its body there. */
export function pictureAround(style: ShapeStyle, body: Box): Box {
  const p = pictureSize(style)
  return { x: body.x + body.w / 2 - p.width / 2, y: body.y + body.h / 2 - p.height / 2, w: p.width, h: p.height }
}

/** Where a shape's body is on the frame, in output pixels, from where its picture is drawn there. */
export function bodyWithin(style: ShapeStyle, picture: Box): Box {
  const p = pictureSize(style)
  const kx = picture.w / p.width
  const ky = picture.h / p.height
  return {
    x: picture.x + picture.w / 2 - (style.width * kx) / 2,
    y: picture.y + picture.h / 2 - (style.height * ky) / 2,
    w: style.width * kx,
    h: style.height * ky
  }
}

/**
 * The shape for a picture box dragged to `shown` output pixels across and
 * down: its body grows or shrinks by what the picture did, the margin round
 * it staying as it is, so the outline keeps its width and the arrowheads
 * their size, rather than being stretched with it.
 */
export function resizedShape(style: ShapeStyle, shownW: number, shownH: number): ShapeStyle {
  const p = pictureSize(style)
  return {
    ...style,
    width: Math.max(2, Math.round(style.width + (shownW - p.width))),
    height: Math.max(2, Math.round(style.height + (shownH - p.height)))
  }
}

/** A style of your own, named, kept with the app's settings so every project has it. */
export interface SavedShape {
  id: string
  name: string
  style: ShapeStyle
}

export const MAX_SAVED_SHAPES = 40
export const MAX_SHAPE_NAME = 60

export function cleanShapeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_SHAPE_NAME).trim()
}

export function cleanSavedShapes(raw: unknown): SavedShape[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedShape[] = []
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue
    const r = x as Record<string, unknown>
    const id = typeof r.id === 'string' && r.id !== '' ? r.id : null
    const name = typeof r.name === 'string' ? cleanShapeName(r.name) : ''
    if (!id || name === '' || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, style: cleanShapeStyle(r.style) })
    if (out.length >= MAX_SAVED_SHAPES) break
  }
  return out
}

/** A style saved under a name, last in the list; one of the same name is replaced where it is. */
export function saveShape(list: readonly SavedShape[], name: string, style: ShapeStyle, id: string = newId()): SavedShape[] {
  const clean = cleanShapeName(name)
  if (clean === '') return [...list]
  const same = list.findIndex((s) => s.name.toLowerCase() === clean.toLowerCase())
  if (same >= 0) return list.map((s, i) => (i === same ? { ...s, style: cleanShapeStyle(style) } : s))
  return [...list, { id, name: clean, style: cleanShapeStyle(style) }].slice(-MAX_SAVED_SHAPES)
}

export function removeShape(list: readonly SavedShape[], id: string): SavedShape[] {
  return list.filter((s) => s.id !== id)
}

/** The name a new saved style is offered: its kind, numbered past any taken. */
export function nextShapeName(list: readonly SavedShape[], style: ShapeStyle): string {
  const base = `My ${shapeName(style).toLowerCase()}`
  const taken = new Set(list.map((s) => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
