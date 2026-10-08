import { cleanTextStyle, textKey, textMargin, type TextStyle } from '../../shared/text'
import type { DrawnText } from '../../shared/project'
import { BLUR_SIGMA_PER_ASS } from '../../shared/caption-drawing'

/**
 * Drawing a text into a picture: the words, their outline and shadow, and the
 * box behind them, on a canvas exactly as large as they need, transparent
 * everywhere else. The picture is what the preview draws and the export reads,
 * so the two can only ever show the same pixels.
 */

/** A text's font as a canvas takes it. */
export function fontOf(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px "${style.font}"`
}

/** Rounded up to an even number, which every encoder wants of a picture's size. */
function even(n: number): number {
  return Math.max(2, Math.ceil(n / 2) * 2)
}

/**
 * Where everything goes, measured on `ctx` with the text's font set: the
 * picture's size, and each line's left edge and baseline in it.
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  style: TextStyle
): { width: number; height: number; lines: { text: string; x: number; y: number }[]; box: { x: number; y: number; w: number; h: number } } {
  ctx.font = fontOf(style)
  const lines = style.text.split('\n')
  const widths = lines.map((l) => ctx.measureText(l === '' ? ' ' : l).width)
  // Every line the same height, from the font rather than from its letters,
  // so a line of "ooo" sits where a line of "Égypte" would.
  const probe = ctx.measureText('Hg')
  const ascent = probe.fontBoundingBoxAscent || style.size * 0.8
  const descent = probe.fontBoundingBoxDescent || style.size * 0.2
  const step = style.size * style.lineSpacing
  const textW = Math.max(1, ...widths)
  const textH = step * (lines.length - 1) + ascent + descent
  const pad = style.box ? style.boxPadding : 0
  const margin = textMargin(style)
  const boxW = textW + 2 * pad
  const boxH = textH + 2 * pad
  const width = even(boxW + 2 * margin)
  const height = even(boxH + 2 * margin)
  const box = { x: (width - boxW) / 2, y: (height - boxH) / 2, w: boxW, h: boxH }
  const left = box.x + pad
  return {
    width,
    height,
    box,
    lines: lines.map((text, i) => {
      const w = widths[i]!
      const x = style.align === 'left' ? left : style.align === 'right' ? left + textW - w : left + (textW - w) / 2
      return { text, x, y: box.y + pad + ascent + i * step }
    })
  }
}

/** Draw a text onto a canvas of the size its layout asks for. */
export function drawText(canvas: HTMLCanvasElement, raw: TextStyle): void {
  const style = cleanTextStyle(raw)
  const ctx = canvas.getContext('2d')!
  const layout = layoutText(ctx, style)
  canvas.width = layout.width
  canvas.height = layout.height
  // Sizing a canvas clears it and its settings: the font is set again.
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = fontOf(style)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  if (style.box) {
    // The box's own colour, which is the text's, at its own opacity.
    ctx.globalAlpha = style.boxOpacity
    ctx.fillStyle = style.boxColour
    ctx.beginPath()
    ctx.roundRect(layout.box.x, layout.box.y, layout.box.w, layout.box.h, Math.min(style.boxRadius, layout.box.h / 2, layout.box.w / 2))
    ctx.fill()
    ctx.globalAlpha = 1
  }
  if (style.glow) {
    // Plan 99: the words again in the glow's colour, their outline widened by
    // half the glow, blurred as a caption's glow is, under the letters.
    ctx.save()
    ctx.filter = `blur(${style.glowSize * BLUR_SIGMA_PER_ASS}px)`
    ctx.fillStyle = style.glowColour
    ctx.strokeStyle = style.glowColour
    ctx.lineWidth = 2 * (style.outlineWidth + style.glowSize / 2)
    for (const l of layout.lines) {
      ctx.strokeText(l.text, l.x, l.y)
      ctx.fillText(l.text, l.x, l.y)
    }
    ctx.restore()
  }
  const shadowOn = (): void => {
    if (!style.shadow) return
    ctx.shadowColor = style.shadowColour
    ctx.shadowBlur = style.shadowBlur
    ctx.shadowOffsetX = style.shadowX
    ctx.shadowOffsetY = style.shadowY
  }
  const shadowOff = (): void => {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
  // The outline under the letters, so it widens them outwards only, and the
  // shadow cast by whichever is drawn first, so it is cast once.
  if (style.outlineWidth > 0) {
    shadowOn()
    ctx.lineWidth = style.outlineWidth * 2
    ctx.strokeStyle = style.outlineColour
    for (const l of layout.lines) ctx.strokeText(l.text, l.x, l.y)
    shadowOff()
  } else shadowOn()
  ctx.fillStyle = style.colour
  for (const l of layout.lines) ctx.fillText(l.text, l.x, l.y)
  shadowOff()
}

/**
 * Draw a text and keep its picture, once its font has loaded: what a text
 * source's playable file is. The same text drawn again lands on the same file.
 */
export async function renderText(raw: TextStyle): Promise<DrawnText> {
  const style = cleanTextStyle(raw)
  await document.fonts?.load(fontOf(style)).catch(() => undefined)
  const canvas = document.createElement('canvas')
  drawText(canvas, style)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the text could not be drawn'))), 'image/png')
  )
  const png = new Uint8Array(await blob.arrayBuffer())
  const path = await window.api.saveText(textKey(style), png)
  return { path, width: canvas.width, height: canvas.height }
}

/**
 * A plain colour's picture, the size of the frame, kept where texts' pictures
 * are: what a black screen's playable file is. The same colour at the same
 * size lands on the same file.
 */
export async function renderColour(colour: string, width: number, height: number): Promise<DrawnText> {
  const w = Math.max(2, Math.round(width))
  const h = Math.max(2, Math.round(height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('the colour could not be drawn')
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the colour could not be drawn'))), 'image/png')
  )
  // A key the store takes, sixteen hex digits: the colour and the size, so it is the same file each time.
  const key = `c0${colour.slice(1).toLowerCase()}${(w & 0xffff).toString(16).padStart(4, '0')}${(h & 0xffff).toString(16).padStart(4, '0')}`
  const path = await window.api.saveText(key, new Uint8Array(await blob.arrayBuffer()))
  return { path, width: w, height: h }
}
