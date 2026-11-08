/**
 * A crop filter for an ffmpeg filter graph, written from numbers only.
 *
 * A crop is where a project's own numbers go into the graph as they stand, and
 * the graph is text: a side that is not a number would go in as whatever the
 * file held, a comma and filters of its own included, which can make ffmpeg
 * write files and open addresses (audit 2026-11-07). The project reader
 * refuses such a file; this refuses it again here, failing the export, so a
 * gap in any reader never reaches the graph. With no x and y, the crop is
 * centred, as ffmpeg's own default.
 */
export function cropFilter(w: number, h: number, x?: number, y?: number): string {
  const sides = x === undefined && y === undefined ? [w, h] : [w, h, x, y]
  if (!sides.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('a picture in this sequence has a damaged crop')
  return `crop=${sides.join(':')}`
}
