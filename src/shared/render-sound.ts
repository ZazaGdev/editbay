/**
 * The sound of one segment of an export: which sound clips are heard over it,
 * how each is read, faded and ducked, and how they are mixed.
 */

import { playedCopy, trackFile, type Clip, type SoundClip, type Timeline } from './project'
import { spanEnd, isMuted, sourceAt, speedOf } from './tracks'
import { soundHeard } from './speed'
import { shownSpans, soundKind, transitionWindows, type Shown, type TransitionWindow } from './transitions'
import { toStereo } from './sound'
import { framesToSeconds } from './time'
import { duckExpression, voiceStretches } from './ducking'
import type { Stretch } from './silences'
import type { PeaksData } from './types'

export const AUDIO_RATE = 48000
export const AUDIO_CHANNELS = 2
export const AUDIO_BITRATE = '192k'

/** A level as ffmpeg is given it: no more digits than it can use. */
export function level(n: number): string {
  return String(Number(n.toFixed(6)))
}

/** The segments' sound: in floating point, never clipped before it is levelled (audit 2026-10-01). */
const AUDIO_FORMAT = `aformat=sample_fmts=flt:sample_rates=${AUDIO_RATE}:channel_layouts=stereo`

/**
 * How long a sound is faded up at its own beginning and down at its own end,
 * in seconds.
 *
 * A cut lands wherever the edit put it, which is almost never where the
 * waveform crosses zero, so the sample either side of it is a step: that step
 * is the click. Five milliseconds is long enough to remove it and far too
 * short to hear as a fade, which is the point. It is not a crossfade and it is
 * not an effect you would ever want to set.
 */
const DECLICK_SEC = 0.005

/**
 * The fades on one sound's chain: up at its own first frame, down at its own
 * last. A piece that is only the middle of a longer sound gets neither, so a
 * sound carrying on under a picture cut is not dipped at the seam.
 *
 * On a sound shorter than three fades the fade is shortened to a third of it,
 * so a two frame sound is not all fade and the two never overlap.
 */
function declick(h: Heard): string {
  if (!h.opens && !h.closes) return ''
  const d = Math.min(DECLICK_SEC, h.lengthSec / 3)
  if (!(d > 0)) return ''
  const parts: string[] = []
  if (h.opens) parts.push(`afade=t=in:st=0:d=${level(d)}`)
  if (h.closes) parts.push(`afade=t=out:st=${level(h.lengthSec - d)}:d=${level(d)}`)
  return `,${parts.join(',')}`
}

/** The transition fades on one sound's chain, in the time of what is read. */
function transitionFades(h: Heard): string {
  if (h.fades.length === 0) return ''
  return h.fades.map((f) => `,afade=t=${f.dir}:curve=${f.curve}:st=${level(f.atSec)}:d=${level(f.durSec)}`).join('')
}

/** A sound clip heard over a segment: where it is read from, and where it goes. */
/**
 * How much earlier than a piece a sound running on from the piece before is
 * read, the extra then cut off. A compressed sound, as a recording's own sound
 * and every stream copy are, comes out of a seek wrong for its first moment,
 * so two pieces of one sound read from exactly where the other ended click
 * where they meet. Read from earlier, the wrong moment is in what is cut off.
 */
const PRE_ROLL_SEC = 0.1

/**
 * One fade on a sound, in the time of what is read rather than of the piece:
 * `leadSec` of it comes before the piece's own first sample and is trimmed off
 * after the fades are applied.
 *
 * Read time rather than piece time because `afade` refuses to start before
 * zero, and a crossfade at a cut is split in two by the picture's own segment
 * boundary at that cut, so the second half always begins part way through its
 * curve. Reading from earlier and trimming afterwards is what makes that
 * expressible, and it is exact where an expression evaluated per frame of
 * audio would only be close.
 */
interface Fade {
  dir: 'in' | 'out'
  /** An `afade` curve name. */
  curve: string
  atSec: number
  durSec: number
}

export interface Heard {
  /** Its file, or null when it is read from input 0, the picture underneath's own recording. */
  path: string | null
  /** How many channels its track has in the original, when known: one is spread to both sides at its own level. */
  channels?: number
  /** One side of it played on both, as its clip asks (task 1188). Absent for both as recorded. */
  side?: 'left' | 'right'
  /** Where in its file the read starts, in seconds, as ffmpeg counts. Never below zero. */
  fromSec: number
  /** Its clip's speed, which what is read is stretched to first (plan 105). Absent for 1. */
  speed?: number
  /** How much is read, in seconds. */
  readSec: number
  /**
   * Silence put in front of what is read, in seconds, where the recording does
   * not reach back as far as a transition asks. A picture holds its first
   * frame there; a sound has nothing to hold, so it has silence.
   */
  padSec: number
  /**
   * How much of the front, silence and all, comes before the piece's own first
   * sample and is cut off again once the fades are applied.
   */
  headSec: number
  /** The fades over it, in read time. Empty for a sound with no transition on it. */
  fades: Fade[]
  /** How much of it, in seconds. */
  lengthSec: number
  /** How far into the segment it starts, in samples at the export's rate. */
  delay: number
  gain: number
  /** Whether it runs the whole of the segment. */
  whole: boolean
  /**
   * Whether this piece holds the sound clip's own first frame, rather than
   * carrying on a sound that began in an earlier piece. Only a real beginning
   * is faded in: a sound running under a picture cut must not dip there.
   */
  opens: boolean
  /** Whether this piece holds the sound clip's own last frame. The mirror of `opens`. */
  closes: boolean
  /**
   * How far down it is ducked under the voice, as a `volume` expression in the
   * segment's own time, or null when it is not ducked over this piece.
   */
  duck: string | null
}

/**
 * Every heard sound clip over a stretch, in track order: A1's first.
 *
 * By its shown span and not by `spanEnd`, so a sound stretched past its own
 * last frame by a crossfade is still in the mix over that stretch. Without
 * that, the outgoing sound is simply missing over the transition and what you
 * hear is a fade to silence and then a fade up, which is nearly right and
 * wrong.
 */
export function heardOver(timeline: Timeline, from: number, to: number, only?: ReadonlySet<string>): SoundClip[] {
  return timeline.audioTracks.flatMap((track) => {
    if (isMuted(track)) return []
    const shown = shownSpans(track.clips, 'sound')
    return track.clips.filter((c) => {
      const at = shown.get(c.id) ?? { from: c.timelineStart, to: spanEnd(c) }
      // A sound too fast or too slow to be heard, unless kept, is silent (plan 105).
      if (c.muted || !soundHeard(c) || at.from >= to || at.to <= from) return false
      if (only && !only.has(c.id)) return false
      const m = timeline.media.find((x) => x.id === c.mediaId)
      return m !== undefined && trackFile(m, c.track) !== null
    })
  })
}

/** Every transition over the sounds of a sequence, and every clip's shown span, worked out once. */
export interface SoundShape {
  shown: Map<string, Shown>
  windows: TransitionWindow[]
  /** The clips on tracks that duck, and where the voice they duck under is. */
  ducked: Set<string>
  voice: Stretch[]
}

export function soundShape(timeline: Timeline, peaks: ReadonlyMap<string, PeaksData>): SoundShape {
  const shown = new Map<string, Shown>()
  const windows: TransitionWindow[] = []
  const ducked = new Set<string>()
  for (const track of timeline.audioTracks) {
    for (const [id, at] of shownSpans(track.clips, 'sound')) shown.set(id, at)
    windows.push(...transitionWindows(track.clips, 'sound'))
    if (track.duck === true) for (const c of track.clips) ducked.add(c.id)
  }
  return { shown, windows, ducked, voice: ducked.size > 0 ? voiceStretches(timeline, peaks) : [] }
}

/**
 * How each heard sound clip over a stretch is read. One playing the first
 * track of the picture underneath's own recording, from the same frame, for
 * the whole stretch, is read from that recording's input, as a clip's sound
 * always was, and adds no input: unless it runs on from the piece before,
 * when it is read on its own from a little earlier, so the pieces meet
 * without a click.
 */
export function heardInputs(
  timeline: Timeline,
  base: Clip | null,
  from: number,
  to: number,
  sounds: SoundClip[],
  shape: SoundShape
): Heard[] {
  const fps = timeline.fps
  return sounds.map((c) => {
    const span = shape.shown.get(c.id) ?? { from: c.timelineStart, to: spanEnd(c) }
    const start = Math.max(from, span.from)
    const end = Math.min(to, span.to)
    const whole = start === from && end === to
    // At a speed of its own a sound is always read from its own file, to be stretched to it (plan 105).
    const speed = speedOf(c)
    const sameFrame = speed === 1 && base !== null && base.mediaId === c.mediaId && base.speed === undefined && base.sourceIn - base.timelineStart === c.sourceIn - c.timelineStart
    const m = timeline.media.find((x) => x.id === c.mediaId)!
    // Enhanced or cleaned, the copy the preview plays too.
    const cleaned = playedCopy(m, c)
    // Where the source is at `start`, carried past the clip's own edges by the
    // transitions over it. Before the recording begins there is nothing to
    // read, so the read starts at zero and silence fills the rest.
    const wantedSec = framesToSeconds(sourceAt(c, start), fps)
    const runsOn = span.from < from
    const runsOff = span.to > to
    // Every fade over this piece, as far back as the earliest one begins: that
    // much is read before the piece and trimmed off once they are applied.
    const over = shape.windows.filter((w) => w.from < to && w.to > from && (w.fromClipId === c.id || w.toClipId === c.id))
    const earliest = over.reduce((at, w) => Math.min(at, w.from), start)
    // How far back of the piece is wanted: to the earliest fade over it, or a
    // tenth of a second for a sound carrying on from the piece before, whose
    // first moment out of a seek is wrong and has to be thrown away.
    const headSec = round6(Math.max(framesToSeconds(start - earliest, fps), runsOn ? PRE_ROLL_SEC : 0))
    // The read cannot go back past the start of the recording; what it misses
    // is silence in front of it, so the fades still land where they should.
    // What is read is stretched to the clip's speed first thing, so all after
    // it, the silence in front included, is in the piece's own seconds.
    const readFrom = wantedSec - headSec * speed
    const padSec = round6(Math.max(0, -readFrom) / speed)
    const fades: Fade[] = over.map((w) => {
      const dir = w.toClipId === c.id ? 'in' : 'out'
      return {
        dir,
        curve: soundKind(w.kind)?.curve ?? 'tri',
        // In read time: what is read begins `headSec` before the piece does.
        atSec: round6(framesToSeconds(w.from - start, fps) + headSec),
        durSec: round6(framesToSeconds(w.to - w.from, fps))
      }
    })
    // A fade at an edge is the real thing; the five millisecond declick would
    // be a second fade on the same edge, so it steps aside there.
    const fadedAtStart = over.some((w) => w.from <= start)
    const fadedAtEnd = over.some((w) => w.to >= end)
    const lengthSec = Math.ceil(framesToSeconds(end - start, fps) * 1e6) / 1e6
    return {
      // Cleaned of noise, it is always read from its cleaned copy, never out of
      // the picture's own recording; and a sound with a fade on it takes the
      // chain that writes fades, which the one read out of the picture has not.
      ...(m.trackChannels?.[c.track] !== undefined ? { channels: m.trackChannels[c.track]! } : {}),
      ...(c.channel ? { side: c.channel } : {}),
      path: cleaned ?? (c.track === 0 && whole && sameFrame && !runsOn && headSec === 0 && over.length === 0 ? null : trackFile(m, c.track)!.path),
      fromSec: round6(Math.max(0, readFrom)),
      readSec: round6((lengthSec + headSec - padSec) * speed),
      ...(speed !== 1 ? { speed } : {}),
      padSec,
      headSec,
      fades,
      lengthSec,
      delay: Math.round(framesToSeconds(start - from, fps) * AUDIO_RATE),
      gain: c.gain,
      duck: shape.ducked.has(c.id)
        ? duckExpression(shape.voice, fps, framesToSeconds(from, fps), framesToSeconds(to, fps), {
            fromSec: framesToSeconds(start, fps),
            toSec: framesToSeconds(end, fps)
          })
        : null,
      whole,
      opens: !runsOn && !fadedAtStart,
      closes: !runsOff && !fadedAtEnd
    }
  })
}

/** A number of seconds with no more digits than ffmpeg can use. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * The sound of a segment, from the sounds heard over it. One read from the
 * picture underneath's own recording, for the whole segment, keeps the single
 * chain a clip's sound always had. Otherwise each is set to its level,
 * resampled, and only then delayed to where it starts in the segment, to the
 * sample; they are summed, never averaged, and padded with silence to the
 * segment's length, which the command's bounds end.
 */
export function soundGraph(heard: Heard[], inputOf: (h: Heard) => number): string {
  const only = heard[0]
  if (heard.length === 1 && only && only.path === null && only.whole) {
    // The first audio track, named: OBS records several, and ffmpeg's own
    // choice of stream is not something to rely on. The fades come last, so
    // they act on the samples that reach the file. Padded, as the mixed path
    // is: a recording's sound often stops a little before its picture, and a
    // piece whose sound runs short leaves a hole in the joined file that pulls
    // all the sound after it early.
    return `[0:a:0]volume=${only.gain},aresample=async=1,apad,${toStereo(only.channels, only.side)},${AUDIO_FORMAT}${declick(only)}${ducking(only)}[a]`
  }
  const parts = heard.map((h, i) => {
    // The head that is read before the piece and trimmed off again: what was
    // actually read, plus the silence in front of it where the recording did
    // not reach that far back.
    const head = Math.round(h.headSec * AUDIO_RATE)
    return (
      `[${inputOf(h)}:a:0]${h.speed !== undefined ? `${tempoFilters(h.speed)},` : ''}volume=${level(h.gain)},aresample=${AUDIO_RATE}:async=1:first_pts=0,${toStereo(h.channels, h.side)},` +
      `aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo` +
      (h.padSec > 0 ? `,adelay=${Math.round(h.padSec * AUDIO_RATE)}S:all=1` : '') +
      // Before the head is trimmed off, because a crossfade split by the
      // picture's own cut begins part way through its curve, and a fade
      // cannot be told to start before the samples it is given.
      transitionFades(h) +
      (head > 0 ? `,atrim=start_sample=${head},asetpts=N/SR/TB` : '') +
      // After it, so the declick is timed from the sound's own first sample
      // rather than from the extra read in front of it.
      declick(h) +
      `${h.delay > 0 ? `,adelay=${h.delay}S:all=1` : ''}` +
      // Last, once the sound starts where it does in the segment, so the
      // expression's time is the segment's.
      `${ducking(h)}[s${i}]`
    )
  })
  const labels = heard.map((_, i) => `[s${i}]`).join('')
  const mixed = heard.length > 1 ? `${labels}amix=inputs=${heard.length}:duration=longest:normalize=0,` : `${labels}`
  parts.push(`${mixed}apad,${AUDIO_FORMAT}[a]`)
  return parts.join(';')
}

/**
 * A sound played at `speed` with its pitch kept (plan 105). `atempo` goes no
 * slower than half speed in one step, so slower is several halvings and the
 * rest.
 */
export function tempoFilters(speed: number): string {
  const steps: number[] = []
  let left = speed
  while (left < 0.5) {
    steps.push(0.5)
    left /= 0.5
  }
  steps.push(left)
  return steps.map((s) => `atempo=${round6(s)}`).join(',')
}

/** A ducked sound's curve under the voice, worked out afresh for every block of samples. */
function ducking(h: Heard): string {
  return h.duck === null ? '' : `,volume=eval=frame:volume='${h.duck}'`
}
