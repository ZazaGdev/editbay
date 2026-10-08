import type { Rect } from '../../shared/project'

/**
 * The stylised transitions' drawing (plan 95): a picture drawn apart, cut
 * into squares as `xfade`'s `pixelize` cuts it, or split into its colours as
 * `rgbashift` splits it. Each works on the canvas the step was drawn on apart,
 * in device pixels, and matches the export's own sampling.
 */

/** A frame in device pixels. */
function inDevice(r: Rect, scale: number): Rect {
  return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale }
}

/**
 * The frame's edge columns and rows carried `reach` device pixels past it, as
 * ffmpeg reads a pixel past the edge as the edge pixel itself.
 */
function smearEdges(c: CanvasRenderingContext2D, f: Rect, reach: number, rows: boolean): void {
  const src = c.canvas
  c.save()
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.imageSmoothingEnabled = false
  c.drawImage(src, f.x, f.y, 1, f.h, f.x - reach, f.y, reach, f.h)
  c.drawImage(src, f.x + f.w - 1, f.y, 1, f.h, f.x + f.w, f.y, reach, f.h)
  if (rows) {
    c.drawImage(src, f.x - reach, f.y, f.w + 2 * reach, 1, f.x - reach, f.y - reach, f.w + 2 * reach, reach)
    c.drawImage(src, f.x - reach, f.y + f.h - 1, f.w + 2 * reach, 1, f.x - reach, f.y + f.h, f.w + 2 * reach, reach)
  }
  c.restore()
}

/**
 * The picture on `c` cut into squares `size` layout pixels across, counted
 * from the frame's corner, each the colour at its middle: `pixelize` reads
 * each square's middle pixel, a last square cut short by the frame's edge
 * reading the edge.
 */
export function pixelate(
  c: CanvasRenderingContext2D,
  px: { size: number; frame: Rect },
  scale: number,
  spare: (w: number, h: number) => CanvasRenderingContext2D
): void {
  const size = px.size * scale
  if (!(size > 1)) return
  const f = inDevice(px.frame, scale)
  const across = Math.ceil(f.w / size)
  const down = Math.ceil(f.h / size)
  smearEdges(c, f, size, true)
  const small = spare(across, down)
  small.setTransform(1, 0, 0, 1, 0, 0)
  small.clearRect(0, 0, across, down)
  // Without smoothing, a canvas shrunk this way takes the pixel at the middle of each square.
  small.imageSmoothingEnabled = false
  small.drawImage(c.canvas, f.x, f.y, across * size, down * size, 0, 0, across, down)
  small.imageSmoothingEnabled = true
  c.save()
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, c.canvas.width, c.canvas.height)
  c.beginPath()
  c.rect(f.x, f.y, f.w, f.h)
  c.clip()
  c.imageSmoothingEnabled = false
  c.drawImage(small.canvas, 0, 0, across, down, f.x, f.y, across * size, down * size)
  c.restore()
}

const CHANNELS = ['red', 'green', 'blue'] as const
let channelsMade = false

/** The canvas filter that keeps one colour of a picture and drops the other two. */
function channelFilter(i: 0 | 1 | 2): string {
  const id = `editbay-only-${CHANNELS[i]}`
  if (!channelsMade && typeof document !== 'undefined') {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    CHANNELS.forEach((name, j) => {
      const f = document.createElementNS(ns, 'filter')
      f.id = `editbay-only-${name}`
      f.setAttribute('color-interpolation-filters', 'sRGB')
      const m = document.createElementNS(ns, 'feColorMatrix')
      m.setAttribute('type', 'matrix')
      const rows = [0, 1, 2].map((r) => (r === j ? [0, 1, 2].map((k) => (k === j ? 1 : 0)) : [0, 0, 0]))
      m.setAttribute('values', `${rows.map((r) => `${r.join(' ')} 0 0`).join('  ')}  0 0 0 1 0`)
      f.appendChild(m)
      svg.appendChild(f)
    })
    document.body.appendChild(svg)
    channelsMade = true
  }
  return `url(#${id})`
}

/**
 * The picture on `c` with its red pulled `d` layout pixels left and its blue
 * as far right, drawn onto `into`, a clear canvas the same size: the three
 * colours added back together, the strip each leaves at the frame's edge
 * filled from the edge, as `rgbashift` fills it.
 */
export function splitColours(c: CanvasRenderingContext2D, sp: { d: number; frame: Rect }, scale: number, into: CanvasRenderingContext2D): void {
  const d = sp.d * scale
  smearEdges(c, inDevice(sp.frame, scale), Math.ceil(d) + 1, false)
  into.save()
  into.setTransform(1, 0, 0, 1, 0, 0)
  into.clearRect(0, 0, into.canvas.width, into.canvas.height)
  into.globalCompositeOperation = 'lighter'
  const shifts = [-d, 0, d]
  for (const i of [0, 1, 2] as const) {
    into.filter = channelFilter(i)
    into.drawImage(c.canvas, shifts[i]!, 0)
  }
  into.restore()
}
