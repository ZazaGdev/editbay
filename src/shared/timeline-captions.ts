/**
 * A sequence's captions on its timeline: setting them from speech, moving,
 * trimming, splitting and restyling them, and keeping each word with the sound it
 * was heard from after an edit.
 */

import { newId } from './ids'
import { spanEnd, type Span } from './tracks'
import {
  type TimedWord, groupWords, type Stretch, mergeStretches, captionsWithin, type CaptionClip, captionEnd,
  retimeCaption, splitCaption, editCaptionWords, type CaptionStyleChange, cleanCaptionStyle, type CaptionStyle,
  wordsOf, type CaptionAt, cleanCaptionAt
} from './captions'
import { clamp } from './project-core'
import type { Timeline, SoundClip, TrackKind, Clip } from './project'
import { allClips } from './timeline-query'
import { listenTracks } from './sound-edits'

/**
 * Captions made from the words heard, grouped as the sequence's style says,
 * in place of every caption it had. None runs past the last clip: a word said
 * as the sequence ends would otherwise add black to its end. The tracks
 * listened to are kept for next time, and the captions are as made, not yet
 * edited by hand.
 */
export function setCaptions(p: Timeline, words: TimedWord[], listenTo: string[]): Timeline {
  const end = allClips(p).reduce((e, c) => Math.max(e, spanEnd(c)), 0)
  const heard = words
    .filter((w) => typeof w.text === 'string' && w.text.trim() !== '' && Number.isFinite(w.start) && Number.isFinite(w.length))
    .map((w) => ({ text: w.text.trim(), start: Math.max(0, Math.round(w.start)), length: Math.max(1, Math.round(w.length)) }))
    .filter((w) => w.start < end)
    .map((w) => ({ ...w, length: Math.min(w.length, end - w.start) }))
  return {
    ...p,
    captions: {
      ...p.captions,
      clips: groupWords(heard, p.captions.style, p.fps),
      listenTo: listenTo.filter((id) => p.audioTracks.some((r) => r.id === id)),
      edited: false
    }
  }
}

/**
 * The words heard on `heard`, the sequence as it was when the listening began,
 * put on `p`, the same sequence now. Edits made while it listened moved the
 * footage the words were said over, so the captions are made where they were
 * heard and then carried with that footage, as every edit carries them. A
 * word whose footage was taken out meanwhile goes with it.
 */
export function setCaptionsHeard(p: Timeline, heard: Timeline, words: TimedWord[], listenTo: string[]): Timeline {
  const made = setCaptions(heard, words, listenTo)
  const now = setCaptions(p, [], listenTo)
  return followSpeech(made, { ...now, captions: { ...now.captions, clips: made.captions.clips } })
}

/**
 * Plan 78: the sequence's sound on these stretches only, played one after
 * another from its start, for listening to part of it. Every sound clip is cut
 * to what of it lies in a stretch and moved up to where that stretch begins
 * in the joined sound. The pictures are left as they are: only sound is heard.
 */
export function stretchedTimeline(t: Timeline, stretches: readonly Stretch[]): Timeline {
  const parts = mergeStretches(stretches)
  const audioTracks = t.audioTracks.map((r) => {
    const clips: SoundClip[] = []
    let offset = 0
    for (const s of parts) {
      for (const c of r.clips) {
        const from = Math.max(c.timelineStart, s.from)
        const to = Math.min(spanEnd(c), s.to)
        if (to <= from) continue
        const { transitionIn: _in, transitionOut: _out, ...rest } = c as SoundClip & { transitionIn?: unknown; transitionOut?: unknown }
        clips.push({
          ...rest,
          id: `${c.id}@${s.from}`,
          sourceIn: c.sourceIn + (from - c.timelineStart),
          sourceOut: c.sourceIn + (to - c.timelineStart),
          timelineStart: offset + (from - s.from)
        } as SoundClip)
      }
      offset += s.to - s.from
    }
    return { ...r, clips }
  })
  return { ...t, audioTracks }
}

/**
 * Plan 78: captions made from words heard on some stretches of the sequence,
 * in place of the captions starting inside them; every other caption, fixed by
 * hand or not, stays as it is. New words starting before the end of the last
 * caption kept before them are left out, and a new caption ends where the
 * next kept one begins, so nothing overlaps. Each stretch is grouped on its
 * own, so no caption runs from one into the next.
 */
export function setCaptionsWithin(p: Timeline, words: TimedWord[], listenTo: string[], stretches: readonly Stretch[]): Timeline {
  const parts = mergeStretches(stretches)
  const replaced = new Set(captionsWithin(p.captions.clips, parts).map((c) => c.id))
  const kept = p.captions.clips.filter((c) => !replaced.has(c.id))
  const made: CaptionClip[] = []
  for (const s of parts) {
    const before = kept.filter((c) => c.timelineStart < s.from).reduce((e, c) => Math.max(e, captionEnd(c)), 0)
    const next = kept.filter((c) => c.timelineStart >= s.to).reduce((m, c) => Math.min(m, c.timelineStart), Infinity)
    const heard = setCaptions(
      p,
      words.filter((w) => w.start >= Math.max(s.from, before) && w.start < s.to),
      listenTo
    ).captions.clips
    for (const c of heard) {
      const end = Math.min(captionEnd(c), next)
      if (end <= c.timelineStart) continue
      const length = end - c.timelineStart
      made.push({ ...c, length, words: c.words.filter((w) => w.start < length).map((w) => ({ ...w, length: Math.min(w.length, length - w.start) })) })
    }
  }
  return {
    ...p,
    captions: {
      ...p.captions,
      clips: [...kept, ...made].sort((a, b) => a.timelineStart - b.timelineStart),
      listenTo: listenTo.filter((id) => p.audioTracks.some((r) => r.id === id))
    }
  }
}

/** `setCaptionsWithin` on the sequence as it was heard, carried to the sequence as it is now, as `setCaptionsHeard` does. */
export function setCaptionsWithinHeard(p: Timeline, heard: Timeline, words: TimedWord[], listenTo: string[], stretches: readonly Stretch[]): Timeline {
  const made = setCaptionsWithin(heard, words, listenTo, stretches)
  const now = { ...p, captions: { ...p.captions, listenTo: made.captions.listenTo } }
  return followSpeech(made, { ...now, captions: { ...now.captions, clips: made.captions.clips } })
}

/** A timeline with its captions changed by hand, so making them again asks first. */
function byHand(p: Timeline, clips: CaptionClip[]): Timeline {
  return { ...p, captions: { ...p.captions, clips: [...clips].sort((a, b) => a.timelineStart - b.timelineStart), edited: true } }
}

function captionOf(p: Timeline, captionId: string): CaptionClip | undefined {
  return p.captions.clips.find((c) => c.id === captionId)
}

/**
 * The last frame captions may run to: the end of the clips, or where a caption
 * already ends past them. A caption past the clips would add black to the end.
 */
function captionsEnd(p: Timeline, c: CaptionClip): number {
  return Math.max(allClips(p).reduce((e, x) => Math.max(e, spanEnd(x)), 0), captionEnd(c))
}

/** Where the captions either side of one end and start. */
function neighbours(p: Timeline, c: CaptionClip): { before: number; after: number } {
  const others = p.captions.clips.filter((x) => x.id !== c.id)
  return {
    before: others.filter((x) => captionEnd(x) <= c.timelineStart).reduce((m, x) => Math.max(m, captionEnd(x)), 0),
    after: others.filter((x) => x.timelineStart >= captionEnd(c)).reduce((m, x) => Math.min(m, x.timelineStart), captionsEnd(p, c))
  }
}

/**
 * A caption moved to start at `start`. It stops against the captions either
 * side, by design, so a nudge of its timing never takes the words
 * next door, and at the end of the clips.
 */
export function moveCaption(p: Timeline, captionId: string, start: number): Timeline {
  const c = captionOf(p, captionId)
  if (!c) return p
  const { before, after } = neighbours(p, c)
  const to = clamp(Math.round(start), before, Math.max(before, after - c.length))
  if (to === c.timelineStart) return p
  return byHand(p, p.captions.clips.map((x) => (x.id === captionId ? { ...x, timelineStart: to } : x)))
}

/**
 * A caption's edge moved to `frame`, its words keeping their share of it: how
 * a caption is retimed when its highlight leads or trails the words. It stops
 * at the captions either side, at the sequence's start and the clips' end, and
 * at a frame a word.
 */
export function trimCaption(p: Timeline, captionId: string, edge: 'start' | 'end', frame: number): Timeline {
  const c = captionOf(p, captionId)
  if (!c) return p
  const f = Math.round(frame)
  const end = captionEnd(c)
  const least = Math.max(1, c.words.length)
  const { before, after } = neighbours(p, c)
  let start = c.timelineStart
  let stop = end
  if (edge === 'start') start = clamp(f, before, end - least)
  else stop = clamp(f, c.timelineStart + least, after)
  if (start === c.timelineStart && stop === end) return p
  const retimed = retimeCaption(c, start, stop - start)
  return byHand(p, p.captions.clips.map((x) => (x.id === captionId ? retimed : x)))
}

/** A caption cut in two at `frame`, the words said either side going to each piece. */
export function splitCaptionAt(p: Timeline, captionId: string, frame: number): Timeline {
  const c = captionOf(p, captionId)
  const pieces = c ? splitCaption(c, Math.round(frame)) : null
  if (!pieces) return p
  return byHand(p, p.captions.clips.flatMap((x) => (x.id === captionId ? pieces : [x])))
}

export function removeCaption(p: Timeline, captionId: string): Timeline {
  if (!captionOf(p, captionId)) return p
  return byHand(p, p.captions.clips.filter((x) => x.id !== captionId))
}

/**
 * A caption's words as typed: a word changed keeps its timing, one added
 * shares the time of the word beside it, and one deleted gives its time to
 * its neighbours. With nothing typed, the caption goes.
 */
export function setCaptionWords(p: Timeline, captionId: string, text: string): Timeline {
  const c = captionOf(p, captionId)
  if (!c) return p
  const typed = editCaptionWords(c, text)
  // More words than it has frames for grows it: only into the room before the next caption.
  const room = neighbours(p, c).after - c.timelineStart
  if (typed && typed.length > room && typed.words.length > room) return p
  const edited = typed && typed.length > room ? retimeCaption(typed, c.timelineStart, room) : typed
  if (edited && JSON.stringify(edited.words) === JSON.stringify(c.words)) return p
  return byHand(p, edited ? p.captions.clips.map((x) => (x.id === captionId ? edited : x)) : p.captions.clips.filter((x) => x.id !== captionId))
}

/**
 * How every caption of the sequence looks. Another number of words at a time
 * groups the same words again, each at the frames it had.
 */
export function setCaptionStyle(p: Timeline, change: CaptionStyleChange): Timeline {
  const style = cleanCaptionStyle({ ...p.captions.style, ...change })
  const regroup = style.wordsPerCaption !== p.captions.style.wordsPerCaption
  return {
    ...p,
    captions: { ...p.captions, style, clips: regroup ? groupKeepingPlaces(p.captions.clips, style, p.fps) : p.captions.clips }
  }
}

/**
 * The captions' words grouped again, each new caption keeping the place of
 * the caption its first word was in, so grouping again never throws away
 * where a caption was put by hand.
 */
function groupKeepingPlaces(clips: CaptionClip[], style: CaptionStyle, fps: number): CaptionClip[] {
  const placed = clips.filter((c) => c.at)
  return groupWords(wordsOf(clips), style, fps).map((c) => {
    const from = placed.find((o) => o.timelineStart <= c.timelineStart && c.timelineStart < captionEnd(o))
    return from?.at ? { ...c, at: from.at } : c
  })
}

/**
 * One caption put where it is dragged, as shares of the frame, or given back
 * to the style with null. Only that caption: this is how one is moved without
 * disturbing the rest.
 */
export function placeCaption(p: Timeline, captionId: string, at: CaptionAt | null): Timeline {
  const clean = at === null ? null : cleanCaptionAt(at)
  if (at !== null && clean === null) return p
  if (!p.captions.clips.some((c) => c.id === captionId)) return p
  const clips = p.captions.clips.map((c) => {
    if (c.id !== captionId) return c
    if (clean === null) {
      const { at: _gone, ...rest } = c
      return rest
    }
    return { ...c, at: clean }
  })
  return { ...p, captions: { ...p.captions, clips, edited: true } }
}

/**
 * Every caption that follows the style moved to `at`, by moving the style.
 * One placed by hand stays where it was put, unless `includeHand`, when it is
 * given back to the style and goes with the rest.
 */
export function relocateCaptions(p: Timeline, at: CaptionAt, includeHand: boolean): Timeline {
  const clean = cleanCaptionAt(at)
  if (!clean) return p
  // Held just inside the frame: the style takes a share between its edges, and
  // one dragged right to an edge would otherwise go back to the middle.
  const inside = (n: number): number => Math.min(0.999, Math.max(0.001, n))
  const style = cleanCaptionStyle({ ...p.captions.style, across: inside(clean.x), height: inside(clean.y) })
  const clips = includeHand
    ? p.captions.clips.map((c) => {
        const { at: _gone, ...rest } = c
        return rest
      })
    : p.captions.clips
  return { ...p, captions: { ...p.captions, style, clips } }
}

/**
 * The captions grouped again from their own words, as a change of the words at
 * a time does, for captions made before the rule they are grouped by now. A
 * word fixed by hand keeps its fix; a caption split or trimmed by hand is
 * grouped again with the rest, which is the point.
 */
export function regroupCaptions(p: Timeline): Timeline {
  if (p.captions.clips.length === 0) return p
  return { ...p, captions: { ...p.captions, clips: groupKeepingPlaces(p.captions.clips, p.captions.style, p.fps) } }
}

/** What a word was heard from, to find it again after an edit: a clip, and the frame of its recording under the word. */
interface Anchor {
  clipId: string
  kind: TrackKind
  mediaId: string
  /** Which of its recording's streams, for a sound clip. */
  stream: number | null
  source: number
}

/** A track's clips in time order, to find the one at a frame by halving. */
function laneOf<T extends Span>(clips: readonly T[]): T[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

/** The clip of a lane playing at `frame`, if any: clips on a track never overlap. */
function clipAt<T extends Span>(lane: readonly T[], frame: number): T | undefined {
  let lo = 0
  let hi = lane.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = lane[mid]!
    if (frame < c.timelineStart) hi = mid - 1
    else if (frame >= spanEnd(c)) lo = mid + 1
    else return c
  }
  return undefined
}

/**
 * What was heard at `frame`: the sound clip there on a track Make captions
 * listens to, else on any other audio track, else the picture there, lowest
 * track first. Muted clips count: a word is no less said for being quiet.
 * `audio` and `video` are the sequence's tracks, each in time order, the
 * listened ones first.
 */
function anchorAt(audio: readonly SoundClip[][], video: readonly Clip[][], frame: number): Anchor | null {
  for (const lane of audio) {
    const c = clipAt(lane, frame)
    if (c) return { clipId: c.id, kind: 'audio', mediaId: c.mediaId, stream: c.track, source: c.sourceIn + (frame - c.timelineStart) }
  }
  for (const lane of video) {
    const c = clipAt(lane, frame)
    if (c) return { clipId: c.id, kind: 'video', mediaId: c.mediaId, stream: null, source: c.sourceIn + (frame - c.timelineStart) }
  }
  return null
}

/** The clips of a sequence after an edit, by id and by kind, to look a word's clip up in. */
interface AfterClips {
  byId: ReadonlyMap<string, Clip | SoundClip>
  audio: readonly SoundClip[]
  video: readonly Clip[]
}

/**
 * Where the frame of a recording an anchor names is in the sequence now: in
 * the same clip, wherever it went, or in a clip that has come to play it: a
 * new piece of it, as the second half of a cut is, or one grown over it, as
 * the first of two joined clips is. Null when nothing plays it any more: taken
 * out, trimmed away or covered. `before` holds the clips there were, so one
 * that already played the same frame, a copy of the take, is never taken for it.
 */
function whereNow(after: AfterClips, a: Anchor, before: ReadonlyMap<string, Clip | SoundClip>): number | null {
  const plays = (c: Clip | SoundClip): boolean => c.mediaId === a.mediaId && c.sourceIn <= a.source && a.source < c.sourceOut
  const heard = (c: Clip | SoundClip): boolean => plays(c) && (a.stream === null || ('track' in c && c.track === a.stream))
  // Nearly every word is still in its own clip: looked up at once, not searched for.
  const own = after.byId.get(a.clipId)
  const sameKind = own !== undefined && ('track' in own) === (a.kind === 'audio')
  const same = sameKind && plays(own) ? own : undefined
  const was = (c: Clip | SoundClip): Clip | SoundClip | undefined => before.get(c.id)
  const clips: readonly (Clip | SoundClip)[] = a.kind === 'audio' ? after.audio : after.video
  const piece = same ?? clips.find((c) => heard(c) && !(was(c) && heard(was(c)!)))
  return piece ? piece.timelineStart + (a.source - piece.sourceIn) : null
}

/**
 * Whether an edit left every clip where it was in time, playing what it
 * played: none added or taken away, none moved, trimmed, slipped or set to
 * another stream. Then no word can have moved, and captions need no looking
 * at, which is most edits made while dragging: a crop, a level, a fade.
 */
function sameTiming(before: Timeline, after: Timeline): boolean {
  const was = new Map<string, Span & { mediaId: string; track?: number }>()
  for (const c of allClips(before)) was.set(c.id, c)
  const now = allClips(after)
  if (now.length !== was.size) return false
  for (const c of now) {
    const w = was.get(c.id)
    if (
      !w ||
      w.timelineStart !== c.timelineStart ||
      w.sourceIn !== c.sourceIn ||
      w.sourceOut !== c.sourceOut ||
      w.mediaId !== c.mediaId ||
      w.track !== ('track' in c ? c.track : undefined)
    ) {
      return false
    }
  }
  return true
}

/**
 * The captions of `before` carried to `after`, the same sequence once an edit
 * has been made to its clips: every word stays with the sound it was heard
 * from, wherever the edit put it. A word whose sound was taken out, trimmed
 * away or covered goes with it. A caption whose words went different ways is
 * cut where they part, and one that lands over another gives way to it. A
 * word over nothing at all stays where it was.
 */
export function followSpeech(before: Timeline, after: Timeline): Timeline {
  const old = before.captions.clips
  if (old.length === 0 || sameTiming(before, after)) return after
  const listened = new Set(listenTracks(before))
  const ids = new Map(allClips(before).map((c) => [c.id, c]))
  const audio = [...before.audioTracks.filter((r) => listened.has(r.id)), ...before.audioTracks.filter((r) => !listened.has(r.id))].map((r) => laneOf(r.clips))
  const video = before.videoTracks.map((r) => laneOf(r.clips))
  const placed: AfterClips = {
    byId: new Map(allClips(after).map((c) => [c.id, c])),
    audio: after.audioTracks.flatMap((r) => r.clips),
    video: after.videoTracks.flatMap((r) => r.clips)
  }
  let changed = false
  const pieces: CaptionClip[] = []
  for (const c of old) {
    const moved = c.words.map((w, i) => {
      const at = c.timelineStart + w.start
      const anchor = anchorAt(audio, video, at)
      const now = anchor ? whereNow(placed, anchor, ids) : at
      return now === null ? null : { i, text: w.text, start: now, length: w.length, by: now - at }
    })
    if (moved.every((m) => m !== null && m.by === 0)) {
      pieces.push(c)
      continue
    }
    changed = true
    // Runs of words that moved alike stay one caption; a caption is cut where they part.
    const runs: NonNullable<(typeof moved)[number]>[][] = []
    for (const m of moved) {
      if (!m) continue
      const run = runs.at(-1)
      if (run && run.at(-1)!.by === m.by) run.push(m)
      else runs.push([m])
    }
    runs.forEach((run, k) => {
      const first = run[0]!
      const last = run.at(-1)!
      // It keeps its own start and end, and the run-on to the caption after, where it keeps its first or last word.
      const start = first.i === 0 ? c.timelineStart + first.by : first.start
      const end = last.i === c.words.length - 1 ? captionEnd(c) + last.by : last.start + last.length
      pieces.push({
        id: k === 0 ? c.id : newId(),
        timelineStart: start,
        length: Math.max(1, end - start),
        words: run.map((m) => ({ text: m.text, start: m.start - start, length: m.length }))
      })
    })
  }
  if (!changed) return after
  // Two that now overlap: the earlier gives way, losing any words said once the later begins.
  const sorted = pieces.sort((a, b) => a.timelineStart - b.timelineStart)
  const clips: CaptionClip[] = []
  for (const c of sorted) {
    const prev = clips.at(-1)
    if (prev && captionEnd(prev) > c.timelineStart) {
      const room = c.timelineStart - prev.timelineStart
      const words = prev.words.filter((w) => w.start < room).map((w) => ({ ...w, length: Math.min(w.length, room - w.start) }))
      clips.pop()
      if (words.length > 0 && room > 0) clips.push({ ...prev, length: room, words })
    }
    clips.push(c)
  }
  return { ...after, captions: { ...after.captions, clips } }
}
