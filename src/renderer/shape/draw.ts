import { DRAW_ON_RATE, SHADOW, bodyInPicture, cleanShapeStyle, drawOnFrames, headSize, outlineLength, pictureSize, shapeKey, type Point, type ShapeStyle } from '../../shared/shape'
import type { DrawnText } from '../../shared/project'

/**
 * Drawing a shape into a picture, transparent round it, as a text is drawn:
 * the picture is what the preview draws and the export reads, so the two can
 * only ever show the same pixels.
 */

/** An arrowhead with its point at `tip`, pointing away from `from`. */
function head(ctx: CanvasRenderingContext2D, tip: Point, from: Point, length: number, width: number): void {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  const back = { x: tip.x - Math.cos(a) * length, y: tip.y - Math.sin(a) * length }
  const nx = -Math.sin(a) * (width / 2)
  const ny = Math.cos(a) * (width / 2)
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(back.x + nx, back.y + ny)
  ctx.lineTo(back.x - nx, back.y - ny)
  ctx.closePath()
  ctx.fill()
}

/** Where a line leaves its end, for the arrowhead there: towards the bend on a curve, or the other end. */
function towards(end: Point, bend: Point | null, other: Point): Point {
  if (bend && Math.hypot(bend.x - end.x, bend.y - end.y) > 0.5) return bend
  return other
}

/**
 * Draw a shape onto a canvas of its picture's size: all of it, or with
 * `progress` below 1, that share of its outline from where it starts, its
 * fill coming in with it and its arrowheads once it is there (plan 88).
 */
export function drawShape(canvas: HTMLCanvasElement, raw: ShapeStyle, progress = 1): void {
  const style = cleanShapeStyle(raw)
  const size = pictureSize(style)
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const at = bodyInPicture(style)
  const body = { x: at.x, y: at.y, w: style.width, h: style.height }
  if (style.shadow) {
    ctx.shadowColor = SHADOW.colour
    ctx.shadowBlur = SHADOW.blur
    ctx.shadowOffsetX = SHADOW.x
    ctx.shadowOffsetY = SHADOW.y
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const whole = progress >= 1
  // Part of the outline: a dash that long, then a gap longer than the rest.
  const partOf = (length: number): void => {
    if (!whole) ctx.setLineDash([Math.max(0.01, length * progress), length * 2 + 10])
  }
  ctx.globalAlpha = style.strokeOpacity ?? 1

  if (style.kind === 'pen') {
    const pts = (style.points ?? []).map((q) => ({ x: body.x + q.x * body.w, y: body.y + q.y * body.h }))
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = style.strokeWidth
    partOf(outlineLength(style))
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    // Smooth, through the middle of each step, as a hand draws it.
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i]!.x + pts[i + 1]!.x) / 2, y: (pts[i]!.y + pts[i + 1]!.y) / 2 }
      ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mid.x, mid.y)
    }
    const last = pts[pts.length - 1]!
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
    return
  }

  if (style.kind === 'line') {
    const p = (q: Point): Point => ({ x: body.x + q.x * body.w, y: body.y + q.y * body.h })
    const from = p(style.from)
    const to = p(style.to)
    const bend = style.bend ? p(style.bend) : null
    const { length, width } = headSize(style)
    // The line stops short of a head, so its round end does not show past the point.
    const cut = (end: Point, toward: Point, on: boolean): Point => {
      if (!on) return end
      const d = Math.hypot(toward.x - end.x, toward.y - end.y)
      if (d < 1e-6) return end
      const k = Math.min(length * 0.7, d * 0.9) / d
      return { x: end.x + (toward.x - end.x) * k, y: end.y + (toward.y - end.y) * k }
    }
    const startDir = towards(from, bend, to)
    const endDir = towards(to, bend, from)
    const a = cut(from, startDir, style.startHead)
    const b = cut(to, endDir, style.endHead)
    ctx.strokeStyle = style.stroke
    ctx.fillStyle = style.stroke
    ctx.lineWidth = style.strokeWidth
    partOf(outlineLength(style))
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    if (bend) ctx.quadraticCurveTo(bend.x, bend.y, b.x, b.y)
    else ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
    if (style.startHead && progress > 0) head(ctx, from, startDir, length, width)
    if (style.endHead && whole) head(ctx, to, endDir, length, width)
    return
  }

  const path = (): void => {
    ctx.beginPath()
    if (style.kind === 'ellipse') ctx.ellipse(body.x + body.w / 2, body.y + body.h / 2, body.w / 2, body.h / 2, 0, 0, Math.PI * 2)
    else ctx.roundRect(body.x, body.y, body.w, body.h, Math.min(style.radius, body.w / 2, body.h / 2))
  }
  if (style.fill !== null && style.fillOpacity > 0) {
    path()
    ctx.globalAlpha = style.fillOpacity * Math.min(1, progress)
    ctx.fillStyle = style.fill
    ctx.fill()
    ctx.globalAlpha = 1
    // The shadow is cast once, by whatever is drawn first.
    if (style.strokeWidth > 0) {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
  }
  if (style.strokeWidth > 0) {
    path()
    ctx.globalAlpha = style.strokeOpacity ?? 1
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = style.strokeWidth
    partOf(outlineLength(style))
    ctx.stroke()
  }
}

/** Draw a shape and keep its picture where texts' are: the same shape drawn again lands on the same file. */
export async function renderShape(raw: ShapeStyle): Promise<DrawnText> {
  const style = cleanShapeStyle(raw)
  const canvas = document.createElement('canvas')
  const png = async (): Promise<Uint8Array> => {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the shape could not be drawn'))), 'image/png')
    )
    return new Uint8Array(await blob.arrayBuffer())
  }
  const frames = drawOnFrames(style)
  if (frames <= 1) {
    drawShape(canvas, style)
    const path = await window.api.saveText(shapeKey(style), await png())
    return { path, width: canvas.width, height: canvas.height }
  }
  // Drawing itself on (plan 88): a numbered run of pictures, the last the whole shape.
  let first = ''
  for (let i = 0; i < frames; i++) {
    drawShape(canvas, style, (i + 1) / frames)
    const path = await window.api.saveText(`${shapeKey(style)}-${String(i + 1).padStart(4, '0')}`, await png())
    if (i === 0) first = path
  }
  return { path: first, width: canvas.width, height: canvas.height, frames, frameRate: DRAW_ON_RATE }
}
