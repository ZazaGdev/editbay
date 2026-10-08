/**
 * How an export is written: the encoder settings of every segment, the join
 * that puts them together, and levelling the finished sound.
 */

import { AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_RATE, level } from './render-sound'

/** The longest filter graph passed on the command line; a longer one goes in a file. */
export const MAX_INLINE_GRAPH = 16000

/**
 * A command whose filter graph is too long for a command line, with the graph
 * moved to a file named `name`, and the file to write. Null when it fits.
 */
export function graphToFile(args: string[], name: string): { args: string[]; file: { name: string; content: string } } | null {
  const at = args.indexOf('-filter_complex')
  const graph = at >= 0 ? args[at + 1] : undefined
  if (graph === undefined || graph.length <= MAX_INLINE_GRAPH) return null
  return {
    args: [...args.slice(0, at), '-/filter_complex', name, ...args.slice(at + 2)],
    file: { name, content: graph }
  }
}

/**
 * A picture sharpened a little: grain cleaned up lightly first, so the sharpen
 * does not bring it out, then the brightness sharpened. Chosen by eye on soft
 * webcam footage, at the strength that crisped it without looking crunchy.
 */
export const SHARPEN = 'format=yuv420p,hqdn3d=1.5:1.5:2:2,unsharp=5:5:0.8:3:3:0'

/**
 * The primaries and transfer a segment is in, said on its frames as well as to
 * the encoder. Not the matrix or the range: ffmpeg 9 takes those as a request
 * and converts the picture to meet it, which moved a red by 13 levels. The
 * encoder's own options still set those two.
 */
export const TAGGED = 'setparams=color_primaries=bt709:color_trc=bt709'

/** How every segment is written: bounded, encoded, and where to. */
export function encodeArgs(durationSec: string, frames: number, crf: number, final: boolean, output: string, fast = false): string[] {
  const args = [
    // Bounded twice: a duration alone rounds, and an exact frame count is what
    // makes the joined file add up.
    '-t', durationSec,
    '-frames:v', String(frames),
    // On the graphics card: its constant quality mode, at the same number the
    // processor's would use, which comes out close in quality and a little larger.
    ...(fast
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0']
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf)]),
    '-pix_fmt', 'yuv420p',
    // Said in the file, so a player reads it as BT.709 at video range, which
    // is what it is, rather than guessing from its size.
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'
  ]

  if (final) {
    args.push('-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ar', String(AUDIO_RATE), '-ac', String(AUDIO_CHANNELS))
    args.push('-movflags', '+faststart')
  } else {
    // Uncompressed, because compressed audio does not concatenate cleanly:
    // every AAC segment carries priming and padding, so copy-joining a run of
    // them inserts a few milliseconds at each cut and the sound walks out of
    // sync across a long timeline. In floating point, so a sum over full scale
    // is kept for the levelling to bring down rather than clipped here first.
    args.push('-c:a', 'pcm_f32le', '-ar', String(AUDIO_RATE), '-ac', String(AUDIO_CHANNELS))
  }

  args.push('-y', output)
  return args
}

/**
 * Levelling the finished sound.
 *
 * Every export otherwise comes out as loud as its recording happened to be,
 * so two videos made a week apart play back at different volumes and the
 * viewer reaches for the slider. -14 LUFS integrated with true peak at -1 dBTP
 * is the usual target for short form video, and it is what idea 56 asks for.
 */
export interface LoudnessTarget {
  /** Integrated loudness, in LUFS. */
  i: number
  /** True peak ceiling, in dBTP. */
  tp: number
  /** Loudness range. */
  lra: number
}

export const LOUDNESS_TARGET: LoudnessTarget = { i: -14, tp: -1, lra: 11 }

/**
 * Below this, there is nothing on the track worth levelling: an export with no
 * sound, or only a noise floor. Lifting that to -14 would raise the hiss by
 * fifty decibels, which is the one way this feature can do real harm.
 */
const LOUDNESS_FLOOR = -50

/** What the first pass found. Every figure comes from ffmpeg as a string. */
export interface LoudnessMeasurement {
  i: number
  tp: number
  lra: number
  threshold: number
  offset: number
}

/** Levelling the sound of a joined export: measured first, then applied to the join. */
export interface LoudnessJob {
  /**
   * The measuring pass. It reads the same list the join reads, ignores the
   * picture and writes nothing: ffmpeg prints the figures on stderr.
   */
  measureArgs: string[]
  target: LoudnessTarget
}

function loudnormMeasure(target: LoudnessTarget): string {
  return `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`
}

export function loudnessJob(listPath: string, target: LoudnessTarget): LoudnessJob {
  return {
    measureArgs: ['-f', 'concat', '-safe', '0', '-i', listPath, '-vn', '-af', loudnormMeasure(target), '-f', 'null', '-'],
    target
  }
}

/**
 * The figures out of a measuring pass, or null when there are none to be had.
 *
 * ffmpeg prints a JSON object at the very end of stderr. Only the tail of
 * stderr is kept, and a run that warned a great deal could in principle push
 * the object out of it, so this returns null rather than throwing on anything
 * it does not recognise: an export that cannot be levelled still has to happen.
 */
export function parseLoudnorm(stderr: string): LoudnessMeasurement | null {
  const blocks = stderr.match(/\{[^{}]*\}/g)
  const last = blocks?.[blocks.length - 1]
  if (last === undefined) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(last) as Record<string, unknown>
  } catch {
    return null
  }
  // Silence reads as the string "-inf", which is not a number JavaScript knows,
  // so it arrives here as NaN and the finite check below throws the whole
  // measurement out. A missing key does the same.
  const num = (key: string): number => Number(raw[key])
  const out = {
    i: num('input_i'),
    tp: num('input_tp'),
    lra: num('input_lra'),
    threshold: num('input_thresh'),
    offset: num('target_offset')
  }
  return Object.values(out).every((n) => Number.isFinite(n)) ? out : null
}

/**
 * The filter that levels the sound, given what the first pass measured, or
 * null when it should be left alone.
 *
 * `linear=true` asks for one gain over the whole programme rather than a
 * compressor riding the level, which is what "equally loud" should mean.
 * ffmpeg falls back to the dynamic mode by itself when that single gain would
 * clip, and that is an acceptable outcome: it still lands near the target.
 */
export function loudnormFilter(target: LoudnessTarget, m: LoudnessMeasurement): string | null {
  if (m.i < LOUDNESS_FLOOR) return null
  // A mix louder than full scale, which floating point keeps rather than
  // clipping, can measure above 0 LUFS, and loudnorm refuses a measurement
  // there. Turned down a whole number of dB first, the measurements with it,
  // it lands where it would have.
  const over = Math.max(m.i, m.threshold)
  const down = over > -1 ? Math.ceil(over) + 6 : 0
  return (
    `${down > 0 ? `volume=-${down}dB,` : ''}` +
    `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}` +
    `:measured_I=${level(m.i - down)}:measured_TP=${level(m.tp - down)}:measured_LRA=${level(m.lra)}` +
    `:measured_thresh=${level(m.threshold - down)}:offset=${level(m.offset)}:linear=true`
  )
}

/**
 * The join's arguments with a sound filter added, right after its input, so
 * everything about how it is encoded stays where it was written.
 */
export function withAudioFilter(args: string[], filter: string): string[] {
  const input = args.indexOf('-i')
  if (input < 0) throw new Error('these arguments have no input to put a filter after')
  return [...args.slice(0, input + 2), '-af', filter, ...args.slice(input + 2)]
}

/** A path as the concat demuxer wants it: forward slashes, single quotes escaped. */
export function concatListLine(path: string): string {
  return `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
}

/**
 * The join: the picture copied, never re-encoded, so the deliverable is one
 * generation from the source, and the sound encoded here, once. Every sound
 * is already in the segments.
 */
export function joinArgs(listPath: string, output: string, fps: number): string[] {
  // Each frame's time put back on the frame it is, in 90 kHz ticks: the
  // segments' Matroska counts whole milliseconds, so at 30 fps the frames
  // came out 33 and 34 ms by turns, and some editors took the file for
  // variable frame rate. Every time there is within half a millisecond of its
  // frame, so rounding to the nearest frame finds it exactly. `prescale`
  // has the times in 90 kHz ticks before the sums, so TB is the one they are
  // counted in: without it ffmpeg 9 hands over times already in ticks and TB
  // still in milliseconds, and every frame came out 90 times too long.
  const tick = 90000 / fps
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c:v', 'copy',
    '-bsf:v', `setts=time_base=1/90000:prescale=1:pts=round(PTS*TB*${fps})*${tick}:dts=round(DTS*TB*${fps})*${tick}:duration=round(DURATION*TB*${fps})*${tick}`,
    '-video_track_timescale', '90000',
    '-c:a', 'aac',
    '-b:a', AUDIO_BITRATE,
    '-ar', String(AUDIO_RATE),
    '-ac', String(AUDIO_CHANNELS),
    '-movflags', '+faststart',
    '-y', output
  ]
}
