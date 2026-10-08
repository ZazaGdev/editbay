import type { Rect } from './project'

/**
 * Plan 85: blur on a picture clip, the whole picture or boxes on it.
 *
 * A box is placed as shares of the recording's frame, so it stays on the
 * same part of the footage through any crop or zoom: hiding a name in a
 * screen recording is the need. How much is a share of the recording's
 * height, so it looks the same at any size. Both halves blur the recording
 * itself, at the head of the clip's chain after its colour: the export with
 * `gblur`, the Output view through the canvas's `blur()`, each a gaussian of
 * the same size.
 */

/** A blurred box, as shares of the recording's width and height, and how much, 1 to 100. */
export interface BlurBox {
  x: number
  y: number
  w: number
  h: number
  amount: number
}

/** How much blur a box gets when it is made. */
export const NEW_BOX_AMOUNT = 60
/** At most this many boxes on one clip. */
export const MOST_BOXES = 8

/** The gaussian's standard deviation, in the recording's pixels, for an amount on a recording `height` tall. */
export function blurSigma(amount: number, height: number): number {
  return Math.max(0.5, (Math.min(100, Math.max(1, amount)) / 100) * 0.025 * height)
}

/** How far past a box the picture is read, so its edge is blurred with what is beside it, as the whole picture would be. */
export function blurMargin(sigma: number): number {
  // Even, so every crop of the picture starts on an even pixel, as one of
  // video with its colour at half size has to.
  return Math.ceil((3 * sigma) / 2) * 2
}

/** An amount as the app keeps it, 1 to 100, or undefined for one that is not a number or is none. */
export function cleanAmount(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  const a = Math.round(Math.min(100, n))
  return a >= 1 ? a : undefined
}

/** A stored box as the app can use it, kept inside the frame and at least a hundredth of it, or null. */
export function cleanBox(b: unknown): BlurBox | null {
  if (!b || typeof b !== 'object') return null
  const r = b as Record<string, unknown>
  const n = (k: string): number | null => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : null)
  const [x, y, w, h] = [n('x'), n('y'), n('w'), n('h')]
  const amount = cleanAmount(r.amount)
  if (x === null || y === null || w === null || h === null || amount === undefined) return null
  const cw = Math.min(1, Math.max(0.01, w))
  const ch = Math.min(1, Math.max(0.01, h))
  const round = (v: number): number => Math.round(v * 1e5) / 1e5
  return { x: round(Math.min(1 - cw, Math.max(0, x))), y: round(Math.min(1 - ch, Math.max(0, y))), w: round(cw), h: round(ch), amount }
}

/** Stored boxes as the app can use them: the damaged dropped, no more than `MOST_BOXES`, undefined for none. */
export function cleanBoxes(list: unknown): BlurBox[] | undefined {
  if (!Array.isArray(list)) return undefined
  const boxes = list.map(cleanBox).filter((b): b is BlurBox => b !== null).slice(0, MOST_BOXES)
  return boxes.length > 0 ? boxes : undefined
}

/** A new box, in the middle of the frame, a third wide and a sixth tall. */
export function newBox(): BlurBox {
  return { x: 1 / 3, y: 5 / 12, w: 1 / 3, h: 1 / 6, amount: NEW_BOX_AMOUNT }
}

/** A box in the recording's pixels, on even pixels as the export's crop wants them, inside the frame. */
export function boxInPixels(b: Pick<BlurBox, 'x' | 'y' | 'w' | 'h'>, width: number, height: number): Rect {
  const even = (v: number): number => Math.round(v / 2) * 2
  const x = Math.min(even(b.x * width), width - 2)
  const y = Math.min(even(b.y * height), height - 2)
  return { x, y, w: Math.max(2, Math.min(even(b.w * width), width - x)), h: Math.max(2, Math.min(even(b.h * height), height - y)) }
}

/** A box from the recording's pixels, as the Source view's box gives it, keeping its amount. */
export function boxFromPixels(r: Rect, width: number, height: number, amount: number): BlurBox {
  return cleanBox({ x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height, amount })!
}

/** What of a clip its blur is made from. */
export interface Blurred {
  blur?: number
  blurBoxes?: BlurBox[]
}

/** A part of the recording to blur, in its pixels, and the gaussian's size there. */
export interface BlurRegion {
  rect: Rect
  sigma: number
}

/** What a clip blurs, in the recording's pixels: the whole frame first when it is all blurred, then each box. */
export function blurRegions(c: Blurred, width: number, height: number): BlurRegion[] {
  return [
    ...(c.blur !== undefined ? [{ rect: { x: 0, y: 0, w: width, h: height }, sigma: blurSigma(c.blur, height) }] : []),
    ...(c.blurBoxes ?? []).map((b) => ({ rect: boxInPixels(b, width, height), sigma: blurSigma(b.amount, height) }))
  ]
}

/**
 * The ffmpeg filters that blur a picture `width` by `height`, for a chain
 * that goes on afterwards: the whole picture with `gblur`, then each box as
 * the picture with a margin round the box, blurred, cut to the box and laid
 * back where it was. `tag` keeps the labels apart from any other chain's.
 *
 * Blurred with its colour at full size: video keeps colour at half size, and
 * `gblur` on that spread colour twice as far as brightness, where the Output
 * view blurs all three alike. `keepAlpha` is for a picture with see-through
 * parts, which keeps them.
 */
export function blurFfmpeg(c: Blurred, width: number, height: number, tag: string, keepAlpha = false): string[] {
  const full = keepAlpha ? 'format=yuva444p' : 'format=yuv444p'
  const back = keepAlpha ? 'format=yuva420p' : 'format=yuv420p'
  const out: string[] = []
  if (c.blur !== undefined) out.push(full, `gblur=sigma=${blurSigma(c.blur, height).toFixed(2)}`, back)
  ;(c.blurBoxes ?? []).forEach((b, i) => {
    const r = boxInPixels(b, width, height)
    const sigma = blurSigma(b.amount, height)
    const m = blurMargin(sigma)
    const x0 = Math.max(0, r.x - m)
    const y0 = Math.max(0, r.y - m)
    const x1 = Math.min(width, r.x + r.w + m)
    const y1 = Math.min(height, r.y + r.h + m)
    const [a, k, z] = [`bx${tag}a${i}`, `bx${tag}k${i}`, `bx${tag}z${i}`]
    out.push(
      `split=2[${a}][${k}];[${k}]crop=${x1 - x0}:${y1 - y0}:${x0}:${y0},${full},gblur=sigma=${sigma.toFixed(2)},crop=${r.w}:${r.h}:${r.x - x0}:${r.y - y0},${back}[${z}];` +
        `[${a}][${z}]overlay=${r.x}:${r.y}${keepAlpha ? ':format=auto' : ''}`
    )
  })
  return out
}
