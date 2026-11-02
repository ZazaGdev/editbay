import { at, flag, list, noOverlaps, notNegative, object, refuse, seconds, stretch, text } from './edit-list-fields'
import type { LayerClock } from './edit-list-layers'
import { hasRoom, MAX_AUDIO_TRACKS, spanEnd, spanHolds, spanLength } from './tracks'
import { secondsToFrames } from './time'
import {
  A1_ID,
  MAX_GAIN,
  addTrack,
  hasPicture,
  mediaDurationFrames,
  newId,
  setFade,
  splitClip,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from './project'

/**
 * Sound in an edit list (task 1188): sound-only clips laid on the cut, such as
 * a sound effect when a picture comes in or a music bed under the voice, and
 * the reel's own sound raised or lowered over a stretch, such as a quieter
 * second voice. Each lands as the app would leave it by hand: a sound clip on
 * a track of its own, with its volume and its fades, and the reel's sound cut
 * at a stretch's edges with its volume changed between them.
 */

export interface EditSound {
  /** A sound file. A path that is not whole is taken from the list's own folder. */
  path: string
  /** Where it comes in, on the reel's main recording's clock, as a layer's `fromSec`. */
  fromSec: number
  /** Where it stops, on the same clock; it plays to its own end when left out. */
  toSec?: number
  /** Where in the file it starts, in seconds of the file. 0 when left out. */
  startSec?: number
  /** Its volume, in dB from the file's own level: -8 is quieter. 0 when left out. */
  gainDb?: number
  /** A fade from silence over its start, and to silence over its end, in seconds. */
  fadeInSec?: number
  fadeOutSec?: number
  why?: string
  /** A marker where it comes in, named from `why` or the file's name. */
  mark?: boolean
}

/** A song under the whole cut, or a part of it: its times are in seconds of the cut, which may run over several reels. */
export interface EditMusic {
  path: string
  /** Where it comes in and stops, in seconds of the cut. The whole cut when left out. */
  fromCutSec?: number
  toCutSec?: number
  startSec?: number
  gainDb?: number
  fadeInSec?: number
  fadeOutSec?: number
  why?: string
}

/** The reel's own sound raised or lowered between two moments of its main recording's clock. */
export interface EditGain {
  fromSec: number
  toSec: number
  gainDb: number
  why?: string
}

/** The loudest a gain may make a sound: the app's volume goes to 400%, +12 dB. */
const MOST_DB = 20 * Math.log10(MAX_GAIN)

function gainDb(raw: unknown, where: string): number {
  const db = seconds(raw, where)
  if (db > MOST_DB + 1e-9) refuse(where, `is louder than Editbay's volume goes, +${MOST_DB.toFixed(1)} dB`)
  return db
}

function why(raw: unknown, where: string): { why?: string } {
  return raw === undefined ? {} : { why: typeof raw === 'string' ? raw : refuse(where, 'must be text') }
}

function fades(o: Record<string, unknown>, where: string): { fadeInSec?: number; fadeOutSec?: number } {
  const out: { fadeInSec?: number; fadeOutSec?: number } = {}
  for (const key of ['fadeInSec', 'fadeOutSec'] as const) {
    if (o[key] === undefined) continue
    const sec = notNegative(o[key], at(where, key))
    if (sec === 0) refuse(at(where, key), 'must be more than 0 seconds; leave it out for no fade')
    out[key] = sec
  }
  return out
}

/** What a sound and a song share: the file, where in it to start, its volume and fades. */
function played(o: Record<string, unknown>, where: string): Pick<EditSound, 'path' | 'startSec' | 'gainDb' | 'fadeInSec' | 'fadeOutSec' | 'why'> {
  return {
    path: text(o.path, at(where, 'path')),
    ...(o.startSec !== undefined ? { startSec: notNegative(o.startSec, at(where, 'startSec')) } : {}),
    ...(o.gainDb !== undefined ? { gainDb: gainDb(o.gainDb, at(where, 'gainDb')) } : {}),
    ...fades(o, where),
    ...why(o.why, at(where, 'why'))
  }
}

export function readSound(raw: unknown, where: string): EditSound {
  const o = object(raw, where, ['path', 'fromSec'], ['toSec', 'startSec', 'gainDb', 'fadeInSec', 'fadeOutSec', 'why', 'mark'])
  const fromSec = notNegative(o.fromSec, at(where, 'fromSec'))
  let toSec: number | undefined
  if (o.toSec !== undefined) {
    toSec = notNegative(o.toSec, at(where, 'toSec'))
    if (toSec <= fromSec) refuse(where, `ends at ${toSec} s, which is not after where it starts, ${fromSec} s`)
  }
  const { path, ...rest } = played(o, where)
  return {
    path,
    fromSec,
    ...(toSec !== undefined ? { toSec } : {}),
    ...rest,
    ...(o.mark !== undefined ? { mark: flag(o.mark, at(where, 'mark')) } : {})
  }
}

export function readMusic(raw: unknown, where: string): EditMusic {
  const o = object(raw, where, ['path'], ['fromCutSec', 'toCutSec', 'startSec', 'gainDb', 'fadeInSec', 'fadeOutSec', 'why'])
  const fromCutSec = o.fromCutSec === undefined ? undefined : notNegative(o.fromCutSec, at(where, 'fromCutSec'))
  const toCutSec = o.toCutSec === undefined ? undefined : notNegative(o.toCutSec, at(where, 'toCutSec'))
  if (toCutSec !== undefined && toCutSec <= (fromCutSec ?? 0)) refuse(where, `ends at ${toCutSec} s of the cut, which is not after where it starts, ${fromCutSec ?? 0} s`)
  const { path, ...rest } = played(o, where)
  return { path, ...(fromCutSec !== undefined ? { fromCutSec } : {}), ...(toCutSec !== undefined ? { toCutSec } : {}), ...rest }
}

export function readGains(raw: unknown, where: string): EditGain[] {
  const gains = list(raw, where).map((g, i) => {
    const w = `${where}[${i}]`
    const o = object(g, w, ['fromSec', 'toSec', 'gainDb'], ['why'])
    const db = gainDb(o.gainDb, at(w, 'gainDb'))
    if (db === 0) refuse(at(w, 'gainDb'), 'is 0 dB, which changes nothing')
    return { ...stretch(o, w), gainDb: db, ...why(o.why, at(w, 'why')) }
  })
  noOverlaps(gains, where)
  return gains
}

/** Sound effects are on tracks so named, and songs on `music` ones. */
export const SOUND_TRACK = 'sound'
export const MUSIC_TRACK = 'music'

const level = (db: number | undefined): number => Math.pow(10, (db ?? 0) / 20)

/**
 * One sound clip of a sound-only file, from `startSec` into it, at `a` for
 * `length` frames or to the file's end, on the lowest track named `prefix`
 * that already plays this file and has room, or a new one: the same sound
 * stays on one track. Faded as asked, each fade at most half the clip as the
 * app's fade handles allow.
 */
function laySound(
  t: Timeline,
  m: ProjectMedia,
  s: { startSec?: number; gainDb?: number; fadeInSec?: number; fadeOutSec?: number },
  a: number,
  length: number | null,
  limit: number,
  prefix: string,
  where: string
): Timeline {
  if (hasPicture(m)) refuse(at(where, 'path'), `${m.originalPath} has a picture: lay it as a layer, which brings its sound with it`)
  if (!m.hasAudio) refuse(at(where, 'path'), `${m.originalPath} has no sound`)
  const whole = mediaDurationFrames(m, t.fps)
  const from = secondsToFrames(s.startSec ?? 0, t.fps)
  if (from >= whole) refuse(at(where, 'startSec'), `is past the end of ${m.originalPath}, ${m.durationSec.toFixed(2)} s`)
  const n = length ?? whole - from
  if (n < 1) refuse(where, 'is shorter than one frame of the cut')
  if (from + n > whole) refuse(where, `plays ${(n / t.fps).toFixed(2)} s from ${s.startSec ?? 0} s into ${m.originalPath}, which ends at ${m.durationSec.toFixed(2)} s`)
  if (a + n > limit) refuse(where, `runs ${((a + n - limit) / t.fps).toFixed(2)} s past the end of the cut it is in; start it earlier or give it an earlier end`)
  for (const key of ['fadeInSec', 'fadeOutSec'] as const) {
    const sec = s[key]
    if (sec !== undefined && secondsToFrames(sec, t.fps) * 2 > n) refuse(at(where, key), `is more than half of the ${(n / t.fps).toFixed(2)} s it plays for`)
  }

  const ours = t.audioTracks.filter((r) => r.id.startsWith(prefix))
  let track = ours.find((r) => r.clips.every((c) => c.mediaId === m.id) && hasRoom(r.clips, a, n))?.id
  if (track === undefined) {
    if (t.audioTracks.length >= MAX_AUDIO_TRACKS) refuse(where, `needs a sound track of its own, and a sequence has at most ${MAX_AUDIO_TRACKS}`)
    let k = ours.length + 1
    while (t.audioTracks.some((r) => r.id === `${prefix}${k}`)) k++
    track = `${prefix}${k}`
    t = addTrack(t, 'audio', track)
  }
  const clip: SoundClip = { id: newId(), mediaId: m.id, track: 0, sourceIn: from, sourceOut: from + n, timelineStart: a, gain: level(s.gainDb), muted: false }
  let out: Timeline = { ...t, audioTracks: t.audioTracks.map((r) => (r.id === track ? { ...r, clips: [...r.clips, clip].sort((x, y) => x.timelineStart - y.timelineStart) } : r)) }
  if (s.fadeInSec !== undefined) out = setFade(out, clip.id, 'in', secondsToFrames(s.fadeInSec, t.fps))
  if (s.fadeOutSec !== undefined) out = setFade(out, clip.id, 'out', secondsToFrames(s.fadeOutSec, t.fps))
  return out
}

/** A reel's sounds, laid once its cuts are taken out. Returns the timeline and the markers they ask for. */
export function laySounds(
  base: Timeline,
  sounds: readonly EditSound[],
  media: readonly ProjectMedia[],
  clock: LayerClock,
  where: (i: number) => string
): { timeline: Timeline; marks: { frame: number; label: string }[] } {
  let t = base
  const marks: { frame: number; label: string }[] = []
  sounds.forEach((s, i) => {
    const w = where(i)
    const m = media[i]!
    const a = clock.start(s.fromSec, at(w, 'fromSec'))
    t = laySound(t, m, s, a, s.toSec === undefined ? null : clock.end(s.toSec) - a, clock.reelEnd, SOUND_TRACK, w)
    if (s.mark) {
      const label = s.why?.trim() ?? ''
      marks.push({ frame: a, label: label !== '' ? label : (m.originalPath.split(/[\\/]/).pop() ?? m.originalPath) })
    }
  })
  return { timeline: t, marks }
}

/** The songs, over the whole cut once every reel is laid, each on a `music` track. */
export function layMusic(base: Timeline, music: readonly EditMusic[], media: readonly ProjectMedia[], cutEnd: number, where: (i: number) => string): Timeline {
  let t = base
  music.forEach((s, i) => {
    const w = where(i)
    const a = secondsToFrames(s.fromCutSec ?? 0, t.fps)
    if (a >= cutEnd) refuse(at(w, 'fromCutSec'), `is at ${s.fromCutSec} s, after the cut ends at ${(cutEnd / t.fps).toFixed(2)} s`)
    const b = s.toCutSec === undefined ? null : secondsToFrames(s.toCutSec, t.fps)
    // Left without an end, it plays to the end of the cut or of the song, whichever comes first.
    const whole = mediaDurationFrames(media[i]!, t.fps) - secondsToFrames(s.startSec ?? 0, t.fps)
    t = laySound(t, media[i]!, s, a, b === null ? Math.min(whole, cutEnd - a) : b - a, cutEnd, MUSIC_TRACK, w)
  })
  return t
}

/**
 * The reel's own sound on A1 raised or lowered over each stretch: cut at the
 * stretch's edges as the app's Cut at playhead cuts it, with its picture, and
 * the pieces between them set louder or quieter. Run once the cuts are taken
 * out, before anything else is laid over the reel.
 */
export function setGains(base: Timeline, gains: readonly EditGain[], clock: LayerClock, where: (i: number) => string): Timeline {
  let t = base
  gains.forEach((g, i) => {
    const w = where(i)
    const a = clock.start(g.fromSec, at(w, 'fromSec'))
    const b = clock.end(g.toSec)
    if (b - a < 1) refuse(w, 'is shorter than one frame of the cut')
    for (const edge of [a, b]) {
      const under = t.audioTracks.find((r) => r.id === A1_ID)?.clips.find((c) => spanHolds(c, edge) && c.timelineStart !== edge)
      if (under) t = splitClip(t, edge, under.id)
    }
    const times = level(g.gainDb)
    t = {
      ...t,
      audioTracks: t.audioTracks.map((r) => {
        if (r.id !== A1_ID) return r
        return {
          ...r,
          clips: r.clips.map((c) => {
            if (c.timelineStart < a || spanEnd(c) > b || spanLength(c) === 0) return c
            const gain = c.gain * times
            if (gain > MAX_GAIN + 1e-9) refuse(at(w, 'gainDb'), `makes the sound louder than Editbay's volume goes, 400%`)
            return { ...c, gain: Number(gain.toFixed(6)) }
          })
        }
      })
    }
  })
  return t
}
