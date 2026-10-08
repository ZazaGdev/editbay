const FULL_SCALE = 32768

/**
 * The quietest thing a waveform draws at all, in decibels. Below this it is
 * the flat line that silence should be.
 */
export const WAVE_FLOOR_DB = -48

/**
 * How far from the middle line a level is drawn, 0 at the line and 1 at full
 * height, on a decibel scale.
 *
 * Not the level itself. Game audio is recorded around -30 dB, which is a fifth
 * of the way up in decibels and a fortieth of the way up as a fraction: on a
 * straight scale a whole recording draws as a flat line while it plays
 * perfectly well, which reads as a missing waveform rather than a quiet one.
 * Every meter and every waveform in every audio tool is on this scale for the
 * same reason.
 */
export function waveHeight(level: number): number {
  const at = Math.min(1, Math.abs(level))
  if (!(at > 0)) return 0
  const db = 20 * Math.log10(at)
  if (db <= WAVE_FLOOR_DB) return 0
  return (db - WAVE_FLOOR_DB) / -WAVE_FLOOR_DB
}

export interface PeakColumn {
  min: number
  max: number
}

/**
 * The loudest sample in the bucket `sec` falls in, 0 to 1, and 0 outside the
 * data. One bucket rather than a range: this is what a meter reads, where
 * `peaksForRange` is what a waveform draws.
 */
export function peakAtSecond(peaks: Int16Array, peaksPerSecond: number, sec: number): number {
  if (peaksPerSecond <= 0 || sec < 0 || !Number.isFinite(sec)) return 0
  const bucket = Math.floor(sec * peaksPerSecond)
  if (bucket < 0 || bucket >= peaks.length / 2) return 0
  const lo = peaks[bucket * 2] ?? 0
  const hi = peaks[bucket * 2 + 1] ?? 0
  return Math.max(Math.abs(lo), Math.abs(hi)) / FULL_SCALE
}

/**
 * Reduce a peaks file to one column per pixel over a time range.
 *
 * Peaks are stored as [min, max] pairs at `peaksPerSecond`. Anything outside the
 * data reads as silence, so drawing past the end of a clip is not an error.
 */
export function peaksForRange(
  peaks: Int16Array,
  peaksPerSecond: number,
  startSec: number,
  endSec: number,
  columns: number
): PeakColumn[] {
  if (columns <= 0) return []
  const silent = (): PeakColumn[] => Array.from({ length: columns }, () => ({ min: 0, max: 0 }))
  if (endSec <= startSec || peaks.length === 0 || peaksPerSecond <= 0) return silent()

  const buckets = peaks.length / 2
  const secondsPerColumn = (endSec - startSec) / columns
  const out: PeakColumn[] = []

  // Zoomed in past one bucket to a column, each bucket would be drawn as a
  // flat block several pixels wide, and the wave as steps. Instead each
  // column reads between the two buckets nearest it, so the shape runs on
  // smoothly from one to the next.
  if (secondsPerColumn * peaksPerSecond < 1) {
    const at = (b: number, side: 0 | 1): number => (b < 0 || b >= buckets ? 0 : (peaks[b * 2 + side] ?? 0))
    for (let col = 0; col < columns; col++) {
      // The column's middle, in buckets; past the data is silence, as above.
      const raw = (startSec + (col + 0.5) * secondsPerColumn) * peaksPerSecond
      if (raw < 0 || raw >= buckets) {
        out.push({ min: 0, max: 0 })
        continue
      }
      // Measured between the buckets' middles, held flat over the first and last half bucket.
      const pos = Math.max(0, Math.min(buckets - 1, raw - 0.5))
      const b = Math.floor(pos)
      const t = pos - b
      const lo = at(b, 0) * (1 - t) + at(b + 1, 0) * t
      const hi = at(b, 1) * (1 - t) + at(b + 1, 1) * t
      out.push({ min: lo / FULL_SCALE, max: hi / FULL_SCALE })
    }
    return out
  }

  for (let col = 0; col < columns; col++) {
    const from = (startSec + col * secondsPerColumn) * peaksPerSecond
    const to = (startSec + (col + 1) * secondsPerColumn) * peaksPerSecond
    // At deep zoom a column can be narrower than one bucket, so always read at
    // least the bucket the column starts in.
    const first = Math.floor(from)
    const last = Math.max(first, Math.ceil(to) - 1)

    let min = 0
    let max = 0
    for (let b = first; b <= last; b++) {
      if (b < 0 || b >= buckets) continue
      const lo = peaks[b * 2] ?? 0
      const hi = peaks[b * 2 + 1] ?? 0
      if (lo < min) min = lo
      if (hi > max) max = hi
    }
    out.push({ min: min / FULL_SCALE, max: max / FULL_SCALE })
  }
  return out
}

export interface WaveTile {
  /** From the waveform's left edge, in pixels. */
  left: number
  width: number
}

/**
 * A waveform `width` pixels wide cut into tiles no wider than `tileWidth`, each
 * starting on a whole pixel so the columns either side of a join line up.
 *
 * One canvas the width of the clip goes blank once it is past the size a
 * canvas may be, 65535 pixels a side in Chromium, which a long clip at the
 * closest zoom easily is. Tiles keep every canvas small however far in the
 * timeline is zoomed.
 */
export function waveTiles(width: number, tileWidth: number): WaveTile[] {
  if (!(width > 0) || !(tileWidth >= 1)) return []
  const step = Math.floor(tileWidth)
  const out: WaveTile[] = []
  for (let left = 0; left < width; left += step) out.push({ left, width: Math.min(step, width - left) })
  return out
}

/**
 * Where the quietest whole second of a waveform starts, in seconds, going by
 * its loudest peak: where nobody is talking, so what is heard there is the
 * noise alone. A second of digital silence has no noise to learn and is
 * passed over. Null when there is no whole second that is not silent.
 */
export function quietestSecond(peaks: Int16Array, peaksPerSecond: number): number | null {
  const per = Math.round(peaksPerSecond)
  const buckets = Math.floor(peaks.length / 2)
  let best: number | null = null
  let bestLevel = Infinity
  for (let s = 0; (s + 1) * per <= buckets; s++) {
    let loudest = 0
    for (let b = s * per; b < (s + 1) * per; b++) loudest = Math.max(loudest, Math.abs(peaks[b * 2]!), Math.abs(peaks[b * 2 + 1]!))
    if (loudest > 0 && loudest < bestLevel) {
      best = s
      bestLevel = loudest
    }
  }
  return best
}
