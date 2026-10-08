import { runFfprobe } from '../ffmpeg/run'

const MIN_SAMPLES = 30
const DEVIATION_TOLERANCE = 0.2
const MAX_DEVIANT_FRACTION = 0.02

/**
 * A cheap first pass over the two rates ffprobe reports.
 * A file that fails this is only a candidate; confirmVfr decides.
 */
export function ratesSuggestVfr(nominalFps: number, averageFps: number): boolean {
  if (averageFps <= 0) return true
  if (nominalFps <= 0) return true
  const ratio = nominalFps / averageFps
  return ratio > 1.01 || ratio < 0.99
}

/**
 * Decide from real presentation timestamps whether the timing is variable.
 *
 * Tolerant of two things that are not variable timing: container timebase
 * quantisation, which makes 30fps alternate between 33ms and 34ms, and the
 * occasional lone outlier from a seek.
 */
export function deltasIndicateVfr(ptsTimes: number[]): boolean {
  if (ptsTimes.length < MIN_SAMPLES) return false

  const sorted = [...ptsTimes].sort((a, b) => a - b)
  const deltas: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0)
    if (d > 0) deltas.push(d)
  }
  if (deltas.length < MIN_SAMPLES) return false

  const ordered = [...deltas].sort((a, b) => a - b)
  const median = ordered[Math.floor(ordered.length / 2)] ?? 0
  if (median <= 0) return false

  let deviant = 0
  for (const d of deltas) {
    if (Math.abs(d - median) / median > DEVIATION_TOLERANCE) deviant++
  }
  return deviant / deltas.length > MAX_DEVIANT_FRACTION
}

/**
 * Decide whether a file has variable timing.
 *
 * The timestamps decide, always. The two rates ffprobe reports cannot rule
 * variable timing out: Matroska from a screen recorder routinely reports a
 * clean 30/1 for both the nominal and the average rate while its packet
 * timestamps are plainly irregular, and trusting the rates lets exactly the
 * files this app exists to handle slip through as clean.
 *
 * The rates are only consulted when there are too few timestamps to judge,
 * which means a clip of under a second or a file whose packets cannot be read.
 */
export async function detectVfr(path: string, nominalFps: number, averageFps: number, signal?: AbortSignal): Promise<boolean> {
  const times = await packetTimes(path, signal)
  if (times.length < MIN_SAMPLES) return ratesSuggestVfr(nominalFps, averageFps)
  return deltasIndicateVfr(times)
}

/** Read the first 600 video packet timestamps and decide. */
export async function confirmVfr(path: string): Promise<boolean> {
  return deltasIndicateVfr(await packetTimes(path))
}

async function packetTimes(path: string, signal?: AbortSignal): Promise<number[]> {
  const stdout = await runFfprobe([
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=pts_time',
    '-read_intervals',
    '%+#600',
    '-of',
    'csv=p=0',
    path
  ], signal)
  return stdout
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n))
}
