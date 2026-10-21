import { captureFfmpeg } from './ffmpeg/run'
import { previewSoundFile } from '../shared/sound'
import type { ProjectMedia } from '../shared/project'
import type { SoundPcmRequest } from '../shared/types'

/** The longest stretch decoded in one go, in seconds: the engine asks for a couple at a time. */
const MOST_SEC = 10
/** How far before the stretch ffmpeg is sent, to be trimmed off exactly. */
const PRE_ROLL_SEC = 0.5

/**
 * Plan 106: a stretch of one of a recording's sound tracks, decoded for the
 * preview's sound engine. Stereo 32-bit float, interleaved, at the rate
 * asked for, exactly `frames` samples long: silence where the file has none,
 * before its start or past its end, so a stretch always fills its place.
 *
 * The file is the one the preview's players play for that track, found here
 * from the recording: the window never names a file.
 */
export async function soundPcm(m: ProjectMedia, req: SoundPcmRequest): Promise<Float32Array | null> {
  const file = previewSoundFile(m, req.track, req.denoise, req.voice)
  if (!file) return null
  const rate = req.rate
  const frames = req.frames
  const out = new Float32Array(frames * 2)
  // Before the file's first sample: silence up to it.
  const lead = req.fromSec < 0 ? Math.min(frames, Math.round(-req.fromSec * rate)) : 0
  const want = frames - lead
  if (want <= 0) return out
  const from = Math.max(0, req.fromSec)
  // Sought a little early and trimmed to the sample: sought straight to the
  // place, an AAC track came out as much as 11 ms off at some places, which
  // at a cut is sound played twice or skipped.
  const early = Math.min(PRE_ROLL_SEC, from)
  const { stdout } = await captureFfmpeg(
    [
    '-v', 'error', '-nostdin',
    '-ss', (from - early).toFixed(6), '-i', file.path,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-af', `atrim=start=${early.toFixed(6)},asetpts=PTS-STARTPTS`,
    '-ac', '2', '-ar', String(rate),
    '-t', (want / rate + 0.05).toFixed(6),
    '-f', 'f32le', 'pipe:1'
    ],
    { maxStdout: frames * 8 + rate * 8 }
  )
  const got = Math.min(want, Math.floor(stdout.length / 8))
  const view = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4))
  out.set(view.subarray(0, got * 2), lead * 2)
  // One side on both, as the export's pan does (task 1188).
  if (req.side) {
    const from = req.side === 'left' ? 0 : 1
    for (let i = 0; i < frames; i++) out[i * 2 + 1 - from] = out[i * 2 + from]!
  }
  return out
}

/** A request as it came over IPC, checked: null for anything that is not one. */
export function cleanPcmRequest(raw: unknown): SoundPcmRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (typeof r.mediaId !== 'string' || !num(r.track) || !num(r.fromSec) || !num(r.frames) || !num(r.rate)) return null
  if (!Number.isInteger(r.track) || r.track < 0 || !Number.isInteger(r.frames) || r.frames <= 0) return null
  if (!(r.rate >= 8000 && r.rate <= 192000) || r.frames > MOST_SEC * r.rate) return null
  const voice = r.voice === 'light' || r.voice === 'normal' || r.voice === 'strong' ? r.voice : undefined
  const side = r.side === 'left' || r.side === 'right' ? r.side : undefined
  return { mediaId: r.mediaId, track: r.track, denoise: r.denoise === true, ...(voice ? { voice } : {}), ...(side ? { side } : {}), fromSec: r.fromSec, frames: r.frames, rate: r.rate }
}
