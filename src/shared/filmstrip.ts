const TILE_BUDGET = 100
const TILE_WIDTH = 160
const MAX_SPRITE_WIDTH = 4096

export interface FilmstripLayout {
  intervalSec: number
  tileCount: number
  cols: number
  rows: number
  tileWidth: number
}

/** Decide how often to sample and how to lay the tiles out in one sprite. */
export function filmstripLayout(durationSec: number): FilmstripLayout {
  const duration = Math.max(durationSec, 0.5)
  const tileCount = Math.max(1, Math.min(TILE_BUDGET, Math.ceil(duration)))
  const intervalSec = duration / tileCount
  const cols = Math.max(1, Math.min(Math.floor(MAX_SPRITE_WIDTH / TILE_WIDTH), Math.ceil(Math.sqrt(tileCount))))
  const rows = Math.ceil(tileCount / cols)
  return { intervalSec, tileCount, cols, rows, tileWidth: TILE_WIDTH }
}

/** Which tile of the sprite covers `timeSec` in a clip of `durationSec`. */
export function tileIndexForTime(layout: FilmstripLayout, timeSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  const fraction = Math.min(0.999999, Math.max(0, timeSec / durationSec))
  return Math.min(layout.tileCount - 1, Math.floor(fraction * layout.tileCount))
}

/** The height ffmpeg's `scale=W:-2` produced for this source. */
export function tileHeight(tileWidth: number, sourceWidth: number, sourceHeight: number): number {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return 2
  return Math.max(2, Math.round((tileWidth * sourceHeight) / sourceWidth / 2) * 2)
}

/** Where one tile sits inside the sprite, in sprite pixels. */
export function tileRect(
  layout: FilmstripLayout,
  index: number,
  height: number
): { x: number; y: number; w: number; h: number } {
  const i = Math.min(Math.max(0, index), layout.cols * layout.rows - 1)
  return {
    x: (i % layout.cols) * layout.tileWidth,
    y: Math.floor(i / layout.cols) * height,
    w: layout.tileWidth,
    h: height
  }
}

/**
 * The tiles drawn side by side across the skim strip: which tile of the sheet
 * each one is, left to right, so the whole recording is visible at once rather
 * than only the frame under the pointer.
 *
 * As many as fit at `tileWidthPx`, never more than the sheet holds: a short
 * recording has fewer tiles than a wide strip has room for, and stretching
 * them is honest where inventing them is not.
 *
 * A tile is the frame at its own left edge, not the middle of the stretch it
 * covers, so the strip reads as a ruler over the recording: the picture at a
 * point is the frame at that point, which is the one the big box shows when
 * the pointer is there.
 */
export function stripTiles(
  layout: FilmstripLayout,
  durationSec: number,
  widthPx: number,
  tileWidthPx: number
): number[] {
  if (!(widthPx > 0) || !(tileWidthPx > 0)) return []
  const count = Math.max(1, Math.min(layout.tileCount, Math.round(widthPx / tileWidthPx)))
  return Array.from({ length: count }, (_, i) => tileIndexForTime(layout, (i / count) * durationSec, durationSec))
}

/** Where to put a sprite sheet, and how big, to draw one of its tiles in a box. */
export interface TilePlacement {
  backgroundSize: string
  backgroundPosition: string
}

/**
 * Draw one tile of a sheet in a box of `boxW` by `boxH`, keeping the shape the
 * camera saw.
 *
 * `contain` fits the whole frame in and leaves the box showing either side of
 * it, which is what a frame being judged wants: a 16:9 game frame drawn to fill
 * a 2.3:1 box is 27% too wide, and a crop decided against a stretched picture is
 * the wrong crop. `cover` fills the box and crops, which is what a thumbnail on
 * a strip wants, where a gap between tiles reads as a fault.
 *
 * The maths is in pixels rather than percentages because a percentage
 * background is scaled to the box on each axis on its own, which is exactly the
 * stretch being avoided.
 */
export function tileFit(
  layout: FilmstripLayout,
  index: number,
  tileH: number,
  boxW: number,
  boxH: number,
  fit: 'cover' | 'contain'
): TilePlacement {
  // Before the box has been measured there is nothing to scale to. Ask for the
  // sheet at its own size rather than at a size worked out from a zero.
  if (!(boxW > 0) || !(boxH > 0) || !(tileH > 0)) return { backgroundSize: 'auto', backgroundPosition: '0 0' }
  const tile = tileRect(layout, index, tileH)
  const byWidth = boxW / layout.tileWidth
  const byHeight = boxH / tileH
  const scale = fit === 'cover' ? Math.max(byWidth, byHeight) : Math.min(byWidth, byHeight)
  // Centred in the box: cropped equally on both sides for cover, and with an
  // equal margin either side for contain.
  const x = tile.x * scale + (layout.tileWidth * scale - boxW) / 2
  const y = tile.y * scale + (tileH * scale - boxH) / 2
  return {
    backgroundSize: `${round(layout.cols * layout.tileWidth * scale)}px ${round(layout.rows * tileH * scale)}px`,
    backgroundPosition: `${round(-x)}px ${round(-y)}px`
  }
}

/** Hundredths of a pixel: enough to place a tile exactly, short enough to read. */
function round(px: number): number {
  return Math.round(px * 100) / 100
}
