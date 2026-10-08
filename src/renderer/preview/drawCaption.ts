import { targetAspect, type Timeline } from '../../shared/project'
import { captionAt, captionFontOf, drawnWord, layoutCaption, wordAt, type CaptionStyle } from '../../shared/captions'
import { BLUR_SIGMA_PER_ASS, captionDrawing, type CaptionPiece, type CaptionRect } from '../../shared/caption-drawing'
import type { DrawPlan } from './compositor'

/**
 * Draw the caption on screen at `frame` over the finished frame on the
 * monitor, as the export burns it in: the layout the export uses, the bundled
 * font, white with a black outline, and the word being said in the highlight
 * colour. Under a shape with no fixed frame, as Handoff, there is none.
 *
 * Plan 99: the box behind it, its glow and the word being said popping are
 * placed by the same shared geometry the export writes, and drawn in the same
 * order: the box, the glow, the word's box, then the words.
 */
export function drawCaption(ctx: CanvasRenderingContext2D, timeline: Timeline, frame: number, plan: DrawPlan | null, scale: number): void {
  if (!plan || targetAspect(timeline) === null) return
  const c = captionAt(timeline.captions.clips, frame)
  if (!c || c.words.length === 0) return
  const style = timeline.captions.style
  const { width: W, height: H } = timeline.output
  const layout = layoutCaption(c, style, W, H)
  // Monitor pixels per output pixel.
  const k = plan.frame.w / W
  const lit = wordAt(c, frame)
  const drawing = captionDrawing(c, style, layout, lit)
  const X = (x: number): number => plan.frame.x + x * k
  const Y = (y: number): number => plan.frame.y + y * k
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  // Nothing of it outside the frame, as the export has nowhere to put it.
  ctx.beginPath()
  ctx.rect(plan.frame.x, plan.frame.y, plan.frame.w, plan.frame.h)
  ctx.clip()
  const box = (r: CaptionRect): void => {
    ctx.save()
    ctx.globalAlpha = r.opacity
    ctx.fillStyle = r.colour
    ctx.beginPath()
    ctx.roundRect(X(r.x), Y(r.y), r.w * k, r.h * k, Math.min(r.radius, r.w / 2, r.h / 2) * k)
    ctx.fill()
    ctx.restore()
  }
  if (drawing.box) box(drawing.box)
  ctx.font = `${layout.fontPx * k}px "${captionFontOf(style).family}"`
  // After every letter, as libass adds it (plan 87).
  ctx.letterSpacing = `${(style.spacing ?? 0) * layout.fontPx * k}px`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  const outline = layout.outlinePx * k
  const shadow = (style.shadow ?? 0) * layout.fontPx * k

  // The glow: the words again in its colour, the outline widened by half of it, blurred as libass blurs.
  const glow = (draw: (text: string, x: number, y: number) => void, text: string, x: number, y: number, at = 1): void => {
    if (!drawing.glow) return
    ctx.save()
    // A filter is not scaled with the drawing, so it is given in the canvas's own pixels.
    ctx.filter = `blur(${drawing.glow.blur * BLUR_SIGMA_PER_ASS * k * scale}px)`
    ctx.fillStyle = drawing.glow.colour
    ctx.strokeStyle = drawing.glow.colour
    ctx.lineWidth = (2 * (outline + (drawing.glow.blur * k) / 2)) / at
    draw(text, x, y)
    ctx.restore()
  }

  if (drawing.pieces) {
    // The box behind the word being said goes over the glow, so the glow never hides it.
    const wordBox = drawing.wordBox
    drawPieces(ctx, drawing.pieces, style, X, Y, outline, shadow, glow, () => wordBox && box(wordBox))
    ctx.restore()
    return
  }

  ctx.lineWidth = 2 * outline
  ctx.strokeStyle = style.outlineColour ?? '#000000'
  const lines = layout.lines.map((line) => {
    const words = line.words.map((i) => drawnWord(c.words[i]!.text, style))
    const text = words.join(' ')
    return { line, words, text, x: X(layout.centerX) - ctx.measureText(text).width / 2, y: Y(line.baseline) }
  })
  for (const l of lines)
    glow(
      (text, x, y) => {
        ctx.strokeText(text, x, y)
        ctx.fillText(text, x, y)
      },
      l.text,
      l.x,
      l.y
    )
  for (const { line, words, text, x, y } of lines) {
    // The shadow as libass draws it: the outlined words again, in its colour, down and to the right, underneath.
    if (shadow > 0) {
      const colour = style.shadowColour ?? '#000000'
      ctx.save()
      ctx.fillStyle = colour
      ctx.strokeStyle = colour
      if (layout.outlinePx > 0) ctx.strokeText(text, x + shadow, y + shadow)
      ctx.fillText(text, x + shadow, y + shadow)
      ctx.restore()
    }
    // No outline at all when none is asked for: a stroke of no width still draws a hairline.
    if (layout.outlinePx > 0) ctx.strokeText(text, x, y)
    ctx.fillStyle = style.wordColour ?? '#FFFFFF'
    ctx.fillText(text, x, y)
    const at = line.words.indexOf(lit)
    if (at < 0) continue
    const before = at > 0 ? `${words.slice(0, at).join(' ')} ` : ''
    ctx.fillStyle = style.highlight
    ctx.fillText(words[at]!, x + ctx.measureText(before).width, y)
  }
  ctx.restore()
}

/**
 * The words drawn one at a time, each from its left edge on its baseline, the
 * grown one scaled from there, as the export writes one event a word. Inside
 * the scaling the outline and shadow are made smaller again, since libass does
 * not grow them with the letters.
 */
function drawPieces(
  ctx: CanvasRenderingContext2D,
  pieces: CaptionPiece[],
  style: CaptionStyle,
  X: (x: number) => number,
  Y: (y: number) => number,
  outline: number,
  shadow: number,
  glow: (draw: (text: string, x: number, y: number) => void, text: string, x: number, y: number, at?: number) => void,
  overGlow: () => void
): void {
  const each = (p: CaptionPiece, draw: () => void): void => {
    ctx.save()
    ctx.translate(X(p.x), Y(p.baseline))
    ctx.scale(p.scale, p.scale)
    draw()
    ctx.restore()
  }
  for (const p of pieces)
    each(p, () =>
      glow(
        (text, x, y) => {
          ctx.strokeText(text, x, y)
          ctx.fillText(text, x, y)
        },
        p.text,
        0,
        0,
        p.scale
      )
    )
  overGlow()
  for (const p of pieces)
    each(p, () => {
      const s = p.scale
      if (shadow > 0) {
        const colour = style.shadowColour ?? '#000000'
        ctx.fillStyle = colour
        ctx.strokeStyle = colour
        ctx.lineWidth = (2 * outline) / s
        if (outline > 0) ctx.strokeText(p.text, shadow / s, shadow / s)
        ctx.fillText(p.text, shadow / s, shadow / s)
      }
      if (outline > 0) {
        ctx.lineWidth = (2 * outline) / s
        ctx.strokeStyle = style.outlineColour ?? '#000000'
        ctx.strokeText(p.text, 0, 0)
      }
      ctx.fillStyle = p.lit ? style.highlight : (style.wordColour ?? '#FFFFFF')
      ctx.fillText(p.text, 0, 0)
    })
}
