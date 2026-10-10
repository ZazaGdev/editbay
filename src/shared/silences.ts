import { allClips, asTwoPieces, closeUpStretch, newId, v1Clips, type SoundClip, type Timeline } from './project'
import { closeUpStarts, spanEnd, type Span } from './tracks'
import { onV1 as picturesOnV1 } from './remove-clips'
import { peaksKey } from './sound'
import type { PeaksData } from './types'

/**
 * Removing silences: finding the pauses in the talking head's sound, and
 * taking them out of the sequence through V1's pictures, closing up. Pure, so
 * what counts as a pause and what taking one out leaves are tested without a
 * window.
 */

/** A stretch of the sequence, in frames, `to` not included. */
export interface Stretch {
  from: number
  to: number
}

export interface SilenceSettings {
  /** Quieter than this, in dB of full scale, going by the peaks: a pause. */
  levelDb: number
  /** The shortest quiet run that is a pause, in seconds. */
  shortestSec: number
  /** How much of each pause stays, in seconds: half after the speech before it, half before the speech after. */
  leaveSec: number
}

export const DEFAULT_SILENCE_SETTINGS: SilenceSettings = { levelDb: -40, shortestSec: 0.5, leaveSec: 0.2 }

/** A 16-bit sample at full scale. */
const FULL_SCALE = 32768

/**
 * The audio tracks listened to unless others are ticked: those holding a
 * heard sound clip linked to a picture on V1, the talking head's own sound.
 * Music, voice overs and a recording's muted streams are left out.
 */
export function defaultListenTracks(t: Timeline): string[] {
  const links = new Set(v1Clips(t).flatMap((c) => (c.link === undefined ? [] : [c.link])))
  return t.audioTracks
    .filter((r) => r.clips.some((c) => !c.muted && c.link !== undefined && links.has(c.link)))
    .map((r) => r.id)
}

/**
 * The loudest peak of a sound clip over one frame of the sequence, from the
 * part of its recording that frame plays. Past the end of the waveform it is
 * silent.
 */
export function clipPeakAt(data: PeaksData, c: SoundClip, frame: number, fps: number): number {
  const n = c.sourceIn + (frame - c.timelineStart)
  // Worked out from whole numbers, so a frame's edge on a bucket's edge is never a hair out.
  const first = Math.floor((n * data.peaksPerSecond) / fps + 1e-9)
  const last = Math.max(first + 1, Math.ceil(((n + 1) * data.peaksPerSecond) / fps - 1e-9))
  let loudest = 0
  for (let b = first; b < last; b++) {
    const lo = data.peaks[b * 2]
    const hi = data.peaks[b * 2 + 1]
    if (lo === undefined || hi === undefined) break
    loudest = Math.max(loudest, Math.abs(lo), Math.abs(hi))
  }
  return loudest
}

/** Walks a track's clips frame by frame, forwards only: the clip holding each frame asked for, if any. */
export function walker<T extends Span>(clips: readonly T[]): (frame: number) => T | null {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
  let i = 0
  return (frame) => {
    while (i < sorted.length && spanEnd(sorted[i]!) <= frame) i++
    const c = sorted[i]
    return c && c.timelineStart <= frame ? c : null
  }
}

/**
 * The pauses in the sound on the tracks listened to, as the stretches to take
 * out: of each quiet run at least the shortest pause long, all but the length
 * to leave, of which the odd frame goes before the speech after.
 *
 * A frame is quiet when it is under a picture on V1, some clip on a track
 * listened to is there, and every one there is quieter than the level set,
 * its gain counted. A muted clip on a track listened to counts as heard:
 * ticking its track says it holds the voice. A frame with no sound listened
 * to, or whose waveform has not loaded, is never quiet, so a picture with no
 * sound of its own, a gap on V1 and anything past V1's end are never cut.
 * `waiting` says a waveform that would count has not loaded yet.
 */
export function findPauses(
  t: Timeline,
  peaks: ReadonlyMap<string, PeaksData>,
  listen: ReadonlySet<string>,
  s: SilenceSettings
): { pauses: Stretch[]; waiting: boolean } {
  const pictures = v1Clips(t)
  const tracks = t.audioTracks.filter((r) => listen.has(r.id))
  const end = pictures.reduce((m, c) => Math.max(m, spanEnd(c)), 0)
  const underPictures = (c: Span): boolean => pictures.some((p) => p.timelineStart < spanEnd(c) && spanEnd(p) > c.timelineStart)
  const waiting = tracks.some((r) => r.clips.some((c) => !peaks.has(peaksKey(c.mediaId, c.track)) && underPictures(c)))

  const loudest = FULL_SCALE * Math.pow(10, s.levelDb / 20)
  const shortest = Math.max(1, Math.round(s.shortestSec * t.fps))
  const leave = Math.max(0, Math.round(s.leaveSec * t.fps))
  const picture = walker(pictures)
  const sounds = tracks.map((r) => walker(r.clips))

  const quiet = (frame: number): boolean => {
    if (!picture(frame)) return false
    let heard = false
    for (const at of sounds) {
      const c = at(frame)
      if (!c) continue
      const data = peaks.get(peaksKey(c.mediaId, c.track))
      if (!data || clipPeakAt(data, c, frame, t.fps) * c.gain >= loudest) return false
      heard = true
    }
    return heard
  }

  const pauses: Stretch[] = []
  let run = -1
  for (let f = 0; f <= end; f++) {
    // Every walker is asked about every frame in order, as it needs.
    const q = f < end && quiet(f)
    if (q && run < 0) run = f
    if (!q && run >= 0) {
      if (f - run >= shortest) {
        const from = run + Math.floor(leave / 2)
        const to = f - Math.ceil(leave / 2)
        if (to > from) pauses.push({ from, to })
      }
      run = -1
    }
  }
  return { pauses, waiting }
}

/**
 * The stretches that can be taken out, in order: whole frames, not empty,
 * each lying wholly under pictures on V1, and none overlapping one before it.
 */
function usable(t: Timeline, stretches: readonly Stretch[]): Stretch[] {
  const pictures = [...v1Clips(t)].sort((a, b) => a.timelineStart - b.timelineStart)
  const covered = (s: Stretch): boolean => {
    let at = s.from
    for (const c of pictures) if (c.timelineStart <= at && spanEnd(c) > at) at = spanEnd(c)
    return at >= s.to
  }
  const out: Stretch[] = []
  const sorted = stretches
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to))
    .map((s) => ({ from: Math.round(s.from), to: Math.round(s.to) }))
    .sort((a, b) => a.from - b.from)
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (s.to <= s.from || (last && s.from < last.to) || !covered(s)) continue
    out.push(s)
  }
  return out
}

/**
 * Take one stretch out of the sequence through V1's pictures. Every clip on V1,
 * with the clips linked to it, where any of the group overlaps the stretch, is
 * cut at its edges and loses what is inside; so a J-cut's sound leading in is
 * cut with its picture, and an L-cut's running on with its own. Of a group
 * with pieces left on both sides, those after it get a link of their own, as
 * a split makes them. Then the stretch closes up, as Shift+Delete on V1 does:
 * what starts after it moves earlier, what starts inside it moves to its
 * start, and what runs across it, like music under the whole cut, stays whole.
 *
 * Null when it cannot close up cleanly: when a clip left whole across the
 * stretch is in the way of one moving up on the same track, such as a voice
 * over beside a recording's microphone stream. The one moving up would be
 * pushed along past it, out of step with its picture, so the stretch stays.
 */
function removeStretch(t: Timeline, s: Stretch): Timeline | null {
  const group = (c: Span): string => c.link ?? `#${c.id}`
  const onV1 = new Set(v1Clips(t).map(group))
  const all = allClips(t)
  const cutting = new Set(all.filter((c) => onV1.has(group(c)) && c.timelineStart < s.to && spanEnd(c) > s.from).map(group))
  const before = new Map<string, number>()
  const after = new Map<string, number>()
  for (const c of all) {
    const g = group(c)
    if (!cutting.has(g)) continue
    if (c.timelineStart < s.from) before.set(g, (before.get(g) ?? 0) + 1)
    if (spanEnd(c) > s.to) after.set(g, (after.get(g) ?? 0) + 1)
  }
  // The link the side after the stretch takes, when some of the group is left before it too. A side of one clip needs none.
  const afterLinks = new Map<string, string | undefined>()
  for (const g of cutting) {
    const n = after.get(g) ?? 0
    if ((before.get(g) ?? 0) > 0 && n > 0) afterLinks.set(g, n > 1 ? newId() : undefined)
  }
  const cut = <T extends Span>(c: T): T[] => {
    const g = group(c)
    if (!cutting.has(g)) return [c]
    const head = c.timelineStart < s.from ? { ...c, sourceOut: Math.min(c.sourceOut, c.sourceIn + (s.from - c.timelineStart)) } : null
    let tail: T | null = null
    if (spanEnd(c) > s.to) {
      const start = Math.max(c.timelineStart, s.to)
      const { link: old, ...rest } = c
      const link = afterLinks.has(g) ? afterLinks.get(g) : old
      tail = {
        ...rest,
        // A clip with nothing left before the stretch keeps its id.
        id: head ? newId() : c.id,
        sourceIn: c.sourceIn + (start - c.timelineStart),
        timelineStart: start,
        ...(link !== undefined ? { link } : {})
      } as T
    }
    // Left on both sides, each piece keeps only its own end's transition, as a split does.
    if (head && tail) return asTwoPieces(head, tail)
    return head ? [head] : tail ? [tail] : []
  }
  const pieces = {
    ...t,
    videoTracks: t.videoTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) })),
    audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) }))
  }
  const meant = closeUpStarts(allClips(pieces), s.from, s.to - s.from, new Set(), picturesOnV1(pieces))
  const next = closeUpStretch(pieces, s.from, s.to - s.from)
  return allClips(next).every((c) => c.timelineStart === meant.get(c.id)) ? next : null
}

/** Take out the stretches that can be, from the last to the first: the sequence after, and which came out, in order. */
function apply(t: Timeline, stretches: readonly Stretch[]): { timeline: Timeline; removed: Stretch[] } {
  const kept = usable(t, stretches)
  const removed: Stretch[] = []
  let next = t
  for (let i = kept.length - 1; i >= 0; i--) {
    const after = removeStretch(next, kept[i]!)
    if (!after) continue
    next = after
    removed.unshift(kept[i]!)
  }
  return { timeline: next, removed }
}

/**
 * Of these stretches, the ones `removeStretches` would take out: whole
 * frames under pictures on V1, none overlapping another, and each closing up
 * cleanly once those after it are out.
 */
export function removableStretches(t: Timeline, stretches: readonly Stretch[]): Stretch[] {
  return apply(t, stretches).removed
}

/**
 * Take stretches out of the sequence, closing up, as one edit: each as
 * `removeStretch` does, from the last to the first, so each is taken from
 * where it was found. Those that cannot be taken out are left out.
 */
export function removeStretches(t: Timeline, stretches: readonly Stretch[]): Timeline {
  return apply(t, stretches).timeline
}

/**
 * The three named ways to judge a pause, so the panel offers a decision
 * rather than three decibel figures with nothing to hear them against.
 *
 * Each is a whole `SilenceSettings`: the numbers are still there, behind the
 * name, and typing in one of them simply leaves none of the three chosen.
 */
export interface PauseJudgement {
  id: 'careful' | 'normal' | 'tight'
  name: string
  /** What it is for, in a line. */
  what: string
  settings: SilenceSettings
}

export const PAUSE_JUDGEMENTS: PauseJudgement[] = [
  {
    id: 'careful',
    name: 'Careful',
    what: 'Only the long silences, with a breath left at each end.',
    settings: { levelDb: -45, shortestSec: 0.8, leaveSec: 0.3 }
  },
  {
    id: 'normal',
    name: 'Normal',
    what: 'The pauses between sentences, cut to a natural gap.',
    settings: DEFAULT_SILENCE_SETTINGS
  },
  {
    id: 'tight',
    name: 'Tight',
    what: 'Every gap in the talking, cut close.',
    settings: { levelDb: -35, shortestSec: 0.3, leaveSec: 0.1 }
  }
]

/**
 * Which of the three a set of numbers is, or null for numbers typed by hand.
 * Worked out from the numbers rather than kept beside them, so the two can
 * never disagree about which one is chosen.
 */
export function judgementOf(s: SilenceSettings): PauseJudgement['id'] | null {
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
  const found = PAUSE_JUDGEMENTS.find(
    (j) => same(j.settings.levelDb, s.levelDb) && same(j.settings.shortestSec, s.shortestSec) && same(j.settings.leaveSec, s.leaveSec)
  )
  return found?.id ?? null
}

/**
 * What the sequence is afterwards: how long it is now, how long it would be
 * with these stretches taken out, and how much shorter that is, all in frames.
 *
 * The one number Remove silences never gave: what you gain by pressing it.
 */
export function whatYouGetBack(
  t: Timeline,
  stretches: readonly Stretch[]
): { now: number; after: number; saved: number } {
  const now = allClips(t).reduce((m, c) => Math.max(m, spanEnd(c)), 0)
  const saved = stretches.reduce((sum, s) => sum + Math.max(0, s.to - s.from), 0)
  return { now, after: Math.max(0, now - saved), saved: Math.min(now, saved) }
}
