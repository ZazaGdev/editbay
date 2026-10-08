/**
 * Transcribing a long recording without whisper looping (plan 75). Given one
 * long file, whisper can get stuck after a long silence and write the same
 * phrase over and over to the end, "to find a way" for fifteen minutes. So
 * the recording is transcribed a stretch with sound at a time, split at long
 * pauses, and the words are put back on the recording's clock. A stretch
 * whose words still repeat one phrase over and over is reported, never
 * quietly cleaned: it may be a real chant or a countdown.
 *
 * Pure, so the joining and the check are tested without whisper.
 */

import { A1_ID, addSource, createTimeline, upsertTimelineMedia, type ProjectMedia, type Timeline } from './project'

/** A stretch of a recording, in its seconds, `toSec` not included. */
export interface Span {
  fromSec: number
  toSec: number
}

/** A word heard, in seconds. */
export interface SpokenAt {
  text: string
  startSec: number
  endSec: number
}

/** The stretches of `fromSec` to `toSec` outside every pause: the ones with sound in them. */
export function speechStretches(pauses: readonly Span[], fromSec: number, toSec: number): Span[] {
  const out: Span[] = []
  let at = fromSec
  for (const p of [...pauses].sort((a, b) => a.fromSec - b.fromSec)) {
    if (p.toSec <= at) continue
    if (p.fromSec >= toSec) break
    if (p.fromSec > at) out.push({ fromSec: at, toSec: p.fromSec })
    at = Math.max(at, p.toSec)
  }
  if (at < toSec) out.push({ fromSec: at, toSec })
  return out
}

function hundredths(n: number): number {
  return Math.round(n * 100) / 100
}

/** The words of each stretch, heard from its own start, put back on the recording's clock in order. */
export function joinStretchWords(parts: readonly { fromSec: number; words: readonly SpokenAt[] }[]): SpokenAt[] {
  return [...parts]
    .sort((a, b) => a.fromSec - b.fromSec)
    .flatMap((p) => p.words.map((x) => ({ text: x.text, startSec: hundredths(p.fromSec + x.startSec), endSec: hundredths(p.fromSec + x.endSec) })))
}

/** The longest phrase counted, in words. */
export const REPEAT_LONGEST = 6

/** More than this many times in a row is a loop rather than talking. */
export const REPEAT_MOST = 4

/** A word as it is compared: lower case, no punctuation. */
function plain(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

/**
 * The phrase of up to `REPEAT_LONGEST` words said more than `REPEAT_MOST`
 * times in a row, the longest run of any, or null when there is none.
 */
export function repeatedPhrase(words: readonly string[]): { phrase: string; times: number } | null {
  const said = words.map(plain).filter((x) => x !== '')
  let best: { phrase: string; times: number } | null = null
  for (let n = 1; n <= REPEAT_LONGEST; n++) {
    for (let i = 0; i + n <= said.length; i++) {
      let times = 1
      while (i + (times + 1) * n <= said.length && said.slice(i + times * n, i + (times + 1) * n).every((x, k) => x === said[i + k])) times++
      if (times > REPEAT_MOST && (!best || times > best.times)) best = { phrase: said.slice(i, i + n).join(' '), times }
    }
  }
  return best
}


/**
 * How long a window `groupStretches` makes may grow before a pause ends it,
 * in seconds, unless asked otherwise: 0, each stretch heard alone. Measured
 * (plan 75) on a 20 minute recording: a 60 s window holding 40 s of silence
 * made whisper write a sentence never said, and 180 s windows wrote one
 * twice, while stretches alone did neither. On a 51 s recording one window
 * kept a retake that the stretches alone lost. So windows are there to ask
 * for, on short files.
 */
export const WINDOW_SEC = 0

/**
 * Stretches with sound grouped into windows heard one at a time: each window
 * runs from its first stretch's start to its last one's end, pauses between
 * included, and takes the next stretch only while the window stays within
 * `longestSec`, so a long pause is never inside one. A window never splits a
 * stretch, so it is longer than `longestSec` only when one stretch is. Whisper heard in windows keeps the context it needs to write
 * a phrase said twice, which a stretch on its own can lose, while a window
 * still ends, and whisper starts afresh, every few minutes.
 */
export function groupStretches(stretches: readonly Span[], longestSec: number): Span[] {
  const out: Span[] = []
  for (const s of stretches) {
    const last = out[out.length - 1]
    if (last && longestSec > 0 && s.toSec - last.fromSec <= longestSec) last.toSec = s.toSec
    else out.push({ fromSec: s.fromSec, toSec: s.toSec })
  }
  return out
}

/**
 * Where a window is cut from the listening copy: its start and length in
 * whole frames at `fps`, given in seconds. Its words are heard from the cut's
 * own 0 s, so `startSec` is exactly what they are moved by to land on the
 * recording's clock again.
 */
export function windowCut(span: Span, fps: number): { startSec: number; lengthSec: number } {
  const a = Math.round(span.fromSec * fps)
  const b = Math.max(a + 1, Math.round(span.toSec * fps))
  return { startSec: a / fps, lengthSec: (b - a) / fps }
}

/**
 * A timeline with nothing on it but one cut window, a sound file of
 * `lengthSec`, heard whole on A1 from frame 0: what the app's own listening
 * (`transcribe` in main) is given, so whisper hears the window alone and its
 * times start at the window's start.
 */
export function windowTimeline(path: string, lengthSec: number, fps: number): Timeline {
  const m: ProjectMedia = {
    id: 'window',
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec: lengthSec,
    width: 0,
    height: 0,
    fps: 0,
    codec: 'pcm_s16le',
    hasAudio: true,
    hasVideo: false,
    audioTracks: 1,
    peaksPath: '',
    filmstripPath: ''
  }
  const t = upsertTimelineMedia(createTimeline(fps, { width: 1920, height: 1080 }, 'landscape'), m)
  return addSource(t, { mediaId: m.id, clipId: 'window', at: 0, onTrack: A1_ID, streams: [0], whole: true })
}

/**
 * The shortest stretch whose words are taken as heard, in seconds. Measured
 * (plan 75): whisper given a click or a breath between long silences writes a
 * sign-off never said, "Thank you for watching!", "I'll see you next time.",
 * and every such stretch was a fraction of a second long.
 */
export const SHORT_SOUND_SEC = 0.5

/** Why the words of a stretch are not to be trusted, reported and never deleted. */
export type Suspect =
  | { fromSec: number; toSec: number; reason: 'repeat'; phrase: string; times: number }
  | { fromSec: number; toSec: number; reason: 'short sound'; words: string }

/**
 * How much of a span has sound in it: its length less every quiet stretch
 * inside it, as Remove silences finds them. A stretch between long pauses can
 * still hold short quiet ones, so a click at the start of a file with a
 * second of quiet after it makes a stretch of 1.7 s with 0.3 s of sound.
 */
export function soundWithin(span: Span, quiet: readonly Span[]): number {
  let silent = 0
  for (const q of quiet) silent += Math.max(0, Math.min(span.toSec, q.toSec) - Math.max(span.fromSec, q.fromSec))
  return Math.max(0, span.toSec - span.fromSec - silent)
}

/**
 * What a stretch's words are suspected of: one phrase repeated over and over
 * (`repeatedPhrase`), or coming from under `SHORT_SOUND_SEC` of sound, where
 * whisper writes what it expects rather than what it heard. `soundSec` is
 * how much sound the stretch holds (`soundWithin`), its whole length when not
 * given. The words stay in the transcript either way: the agent treats them
 * as unheard.
 */
export function suspectOf(span: Span, words: readonly string[], soundSec = span.toSec - span.fromSec): Suspect[] {
  const at = { fromSec: hundredths(span.fromSec), toSec: hundredths(span.toSec) }
  const out: Suspect[] = []
  const loop = repeatedPhrase(words)
  if (loop) out.push({ ...at, reason: 'repeat', ...loop })
  if (words.length > 0 && soundSec < SHORT_SOUND_SEC) out.push({ ...at, reason: 'short sound', words: words.join(' ') })
  return out
}
