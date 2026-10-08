function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`invalid frame rate: ${fps}`)
  }
}

/** Convert a whole frame count at `fps` into seconds. */
export function framesToSeconds(frames: number, fps: number): number {
  assertFps(fps)
  return frames / fps
}

/** Convert seconds into the nearest whole frame at `fps`. */
export function secondsToFrames(seconds: number, fps: number): number {
  assertFps(fps)
  return Math.round(seconds * fps)
}

/** Format a frame count as the seconds string an ffmpeg argument takes. */
export function framesToFfmpegTime(frames: number, fps: number): string {
  return framesToSeconds(frames, fps).toFixed(6)
}

/** Format a frame count as non-drop-frame HH:MM:SS:FF for display. */
export function formatTimecode(frames: number, fps: number): string {
  assertFps(fps)
  const whole = Math.round(fps)
  const totalSeconds = Math.floor(frames / whole)
  const ff = frames % whole
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/**
 * A time typed in by hand, as a frame count, or null when it is not one.
 *
 * Takes what someone would type to go somewhere: `83` or `83s` or `1.5s` for
 * seconds, `120f` for frames, `1:23` for minutes and seconds, `1:23:10` for
 * minutes, seconds and frames, and the full `01:02:03:04` that the timecode
 * shows. Seconds count whole frames at the rate rounded, as the timecode does.
 */
export function parseTimecode(text: string, fps: number): number | null {
  assertFps(fps)
  const whole = Math.round(fps)
  const t = text.trim().toLowerCase()
  const frames = t.match(/^(\d+)\s*f$/)
  if (frames?.[1]) return Number(frames[1])
  const seconds = t.match(/^(\d+(?:\.\d+)?)\s*s?$/)
  if (seconds?.[1]) return Math.round(Number(seconds[1]) * whole)
  const parts = t.split(':')
  if (parts.length < 2 || parts.length > 4 || !parts.every((p) => /^\d+$/.test(p))) return null
  const n = parts.map(Number)
  let h = 0
  let m = 0
  let s = 0
  let f = 0
  if (n.length === 2) [m, s] = n as [number, number]
  else if (n.length === 3) [m, s, f] = n as [number, number, number]
  else [h, m, s, f] = n as [number, number, number, number]
  // Only the first part may run past its usual limit: 90:00 is ninety minutes.
  if (s >= 60 || f >= whole || (n.length === 4 && m >= 60)) return null
  return ((h * 60 + m) * 60 + s) * whole + f
}
