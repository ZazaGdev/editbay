/**
 * The tracks of a sequence: clips placed at times of their own, with gaps
 * between them, never overlapping on one track. V1 is a track like every
 * other. All pure: the editing, the timeline and the tests read the same
 * answers from here.
 *
 * Times are whole frames at the project rate, as everywhere else.
 */

/** What this file needs of any clip, on any track. */
export interface Span {
  id: string
  mediaId: string
  sourceIn: number
  /** Exclusive. */
  sourceOut: number
  timelineStart: number
  /** Shared by the clips that came onto the timeline together. */
  link?: string
  /**
   * How many frames of the recording one frame of the timeline plays (plan
   * 105): 4 a time-lapse, 0.5 slow motion. Absent for 1. `sourceIn` and
   * `sourceOut` stay frames of the recording; the clip's length on the
   * timeline is what `spanLength` makes of them at this speed.
   */
  speed?: number
}

/** A track of clips, by id. */
export interface TrackOf<T extends Span> {
  id: string
  clips: T[]
  /**
   * Not heard, in the preview and in the export alike. Saved with the project,
   * because it is a decision about the edit rather than about listening.
   */
  muted?: boolean
  /**
   * Nothing on it can be selected, moved, trimmed or taken away, and nothing
   * can be dropped on it. Saved with the project: a track locked to keep it
   * safe should still be locked tomorrow.
   */
  locked?: boolean
  /**
   * What you called it, instead of V1 or A1. Absent until it is named, so a
   * track never carries an empty label and a file written before this reads
   * exactly as one written after.
   */
  name?: string
  /**
   * Not drawn, in the preview and in the export alike: the picture track's
   * answer to mute. Saved with the project, for the same reason mute is.
   */
  hidden?: boolean
  /**
   * Comes down under everything heard on the other tracks: the music under
   * the voice. Saved with the project, since the export does it too.
   */
  duck?: boolean
}

/** Whether a track is locked against every edit. */
export function isLocked<T extends Span>(track: TrackOf<T> | undefined): boolean {
  return track?.locked === true
}

/**
 * The locked track an edit changed, by its id, or null when it changed none.
 *
 * Worked out by making the edit and looking at what came out, rather than by
 * asking each kind of edit which tracks it touches. A list of kinds is a list
 * to forget to add to, and a lock that misses one edit is worse than no lock:
 * it says the work is safe when it is not.
 */
export function lockedTrackChanged(
  before: { videoTracks: TrackOf<Span>[]; audioTracks: TrackOf<Span>[] },
  after: { videoTracks: TrackOf<Span>[]; audioTracks: TrackOf<Span>[] }
): string | null {
  const was = [...before.videoTracks, ...before.audioTracks]
  const now = new Map([...after.videoTracks, ...after.audioTracks].map((r) => [r.id, r]))
  for (const track of was) {
    if (!isLocked(track)) continue
    const then = now.get(track.id)
    // Gone, or its clips are not the ones it had: either way it changed.
    if (!then || !sameClips(track.clips, then.clips)) return track.id
  }
  return null
}

/**
 * Whether two lists of clips are the same clips, the same in every way. Only
 * their place in time was compared, so a fade, a volume, a link taken off or
 * put on, a group, a crop or a look went through on a locked track (audit
 * 2026-10-19); taking its link off let the next move leave it behind, the one
 * thing a lock is for.
 */
function sameClips(a: readonly Span[], b: readonly Span[]): boolean {
  return a.length === b.length && a.every((c, i) => sameValue(c, b[i]))
}

/** Whether two values hold the same, whatever order their fields were written in; a field left undefined is one that is not there. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameValue(x, (b as unknown[])[i]))
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const k of keys) if (!sameValue(x[k], y[k])) return false
  return true
}

/** Whether a track is silent, whatever its clips say. */
export function isMuted<T extends Span>(track: TrackOf<T> | undefined): boolean {
  return track?.muted === true
}

/** Whether a track's pictures are left out, in the preview and in the export alike. */
export function isHidden<T extends Span>(track: TrackOf<T> | undefined): boolean {
  return track?.hidden === true
}

/** The longest a track's name may be. Longer than the header can draw, and far shorter than a sentence. */
export const MAX_TRACK_NAME = 24

/**
 * A typed track name made fit to store: the spaces tidied and the length held.
 * Undefined for one that comes out empty, because a name cleared is a name
 * removed and the track goes back to being V1.
 */
export function cleanTrackName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TRACK_NAME).trim()
  return name === '' ? undefined : name
}

/** The most tracks of each kind a sequence has. */
export const MAX_VIDEO_TRACKS = 8
export const MAX_AUDIO_TRACKS = 16

/** A clip's speed: 1 when it has none of its own. */
export function speedOf(c: { speed?: number }): number {
  return c.speed ?? 1
}

/**
 * A length of the timeline, in frames, as frames of the clip's recording at
 * its speed. Not rounded: at 0.5x one frame of the timeline is half a frame
 * of the recording, and a clip at a speed of its own keeps its ends wherever
 * its frames of the timeline put them, so a split or a trim lands exactly
 * where it was asked to and the pieces still add up.
 */
export function toSource(c: { speed?: number }, frames: number): number {
  const s = speedOf(c)
  return s === 1 ? frames : frames * s
}

/** A length of the clip's recording, in frames, as frames of the timeline at its speed. */
export function toTimeline(c: { speed?: number }, frames: number): number {
  const s = speedOf(c)
  return s === 1 ? frames : Math.round(frames / s)
}

/** The frame of its recording a clip shows on `frame` of the timeline, part way between two at a speed of its own. */
export function sourceAt(c: Span, frame: number): number {
  return c.sourceIn + toSource(c, frame - c.timelineStart)
}

/** The frame of the timeline a clip shows `sourceFrame` of its recording on. */
export function timelineAt(c: Span, sourceFrame: number): number {
  return c.timelineStart + toTimeline(c, sourceFrame - c.sourceIn)
}

/** How many frames of the timeline a clip covers: its recording's frames at its speed, never less than one. */
export function spanLength(c: Span): number {
  const s = speedOf(c)
  return s === 1 ? c.sourceOut - c.sourceIn : Math.max(1, Math.round((c.sourceOut - c.sourceIn) / s))
}

export function spanEnd(c: Span): number {
  return c.timelineStart + spanLength(c)
}

/** Whether a clip covers `frame`. */
export function spanHolds(c: Span, frame: number): boolean {
  return frame >= c.timelineStart && frame < spanEnd(c)
}

function byStart<T extends Span>(clips: T[]): T[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

/** Whether `length` frames from `start` are free on a track, leaving out the clips named. */
export function hasRoom(clips: Span[], start: number, length: number, except: ReadonlySet<string> = new Set()): boolean {
  const end = start + length
  return clips.every((c) => except.has(c.id) || spanEnd(c) <= start || c.timelineStart >= end)
}

/**
 * Put a clip on a track, covering what is already there, as Premiere does. A
 * clip it covers completely is removed; one it covers partly loses the covered
 * part; one it lands in the middle of is cut in two around it, the second piece
 * with a new id, each given its own ends by `pair`. The track comes back in
 * time order.
 */
export function placeCovering<T extends Span>(clips: T[], clip: T, newId: () => string, pair: (first: T, second: T) => [T, T] = (a, b) => [a, b]): T[] {
  const start = clip.timelineStart
  const end = spanEnd(clip)
  const out: T[] = []
  for (const c of clips) {
    if (c.id === clip.id) continue
    const cStart = c.timelineStart
    const cEnd = spanEnd(c)
    if (cEnd <= start || cStart >= end) {
      out.push(c)
      continue
    }
    const head = cStart < start ? { ...c, sourceOut: sourceAt(c, start) } : null
    const tail = cEnd > end ? { ...c, id: head ? newId() : c.id, sourceIn: sourceAt(c, end), timelineStart: end } : null
    if (head && tail) out.push(...pair(head, tail))
    else if (head) out.push(head)
    else if (tail) out.push(tail)
  }
  out.push(clip)
  return byStart(out)
}

/**
 * The earliest a clip's head may be trimmed to, as a timeline frame: not
 * before the clip before it on its track, not before the timeline's start,
 * and not before its recording's start.
 */
export function headLimit(clips: Span[], clip: Span): number {
  const before = clips.filter((c) => c.id !== clip.id && spanEnd(c) <= clip.timelineStart)
  const neighbour = before.length > 0 ? Math.max(...before.map(spanEnd)) : 0
  return Math.max(neighbour, clip.timelineStart - toTimeline(clip, clip.sourceIn))
}

/**
 * The latest a clip's tail may be trimmed to, as a timeline frame: not past
 * the clip after it on its track, and not past its recording's end.
 */
export function tailLimit(clips: Span[], clip: Span, mediaFrames: number): number {
  const after = clips.filter((c) => c.id !== clip.id && c.timelineStart >= spanEnd(clip))
  const neighbour = after.length > 0 ? Math.min(...after.map((c) => c.timelineStart)) : Infinity
  return Math.min(neighbour, clip.timelineStart + toTimeline(clip, mediaFrames - clip.sourceIn))
}

/**
 * A track's clips in time order, with any that would overlap the one before
 * moved right to start where it ends. Only a start moves; a length never does.
 */
export function settleTrack<T extends Span>(clips: T[]): T[] {
  let end = 0
  return byStart(clips).map((c) => {
    const next = c.timelineStart < end ? { ...c, timelineStart: end } : c
    end = spanEnd(next)
    return next
  })
}

/**
 * Where something that started at `start` starts once the `length` frames
 * from `at` are taken out of the sequence: earlier by that much when it
 * started after them, at `at` when it started inside them, where it was
 * when it started before.
 */
export function closedUpStart(start: number, at: number, length: number): number {
  if (start < at) return start
  if (start < at + length) return at
  return start - length
}

/**
 * Where every clip starts once the `length` frames from `at` are taken out
 * of the sequence, by id, leaving out the clips named in `leave`. A linked
 * group moves as one, so its picture and sound stay in step: by where its
 * clip named in `anchors` goes, its picture on V1, or else by where its
 * earliest clip goes. A J-cut's sound starts before its picture, and moving
 * the group by the sound left black on V1 (audit 2026-10-10).
 */
export function closeUpStarts(clips: Span[], at: number, length: number, leave: ReadonlySet<string>, anchors: ReadonlySet<string> = new Set()): Map<string, number> {
  const earliest = new Map<string, number>()
  for (const c of clips) {
    if (leave.has(c.id) || c.link === undefined) continue
    earliest.set(c.link, Math.min(earliest.get(c.link) ?? Infinity, c.timelineStart))
  }
  const anchored = new Map<string, number>()
  for (const c of clips) {
    if (leave.has(c.id) || c.link === undefined || !anchors.has(c.id)) continue
    anchored.set(c.link, Math.min(anchored.get(c.link) ?? Infinity, c.timelineStart))
  }
  for (const [link, start] of anchored) earliest.set(link, start)
  const out = new Map<string, number>()
  for (const c of clips) {
    if (leave.has(c.id)) continue
    const first = c.link === undefined ? c.timelineStart : (earliest.get(c.link) ?? c.timelineStart)
    out.set(c.id, c.timelineStart + (closedUpStart(first, at, length) - first))
  }
  return out
}

/** A track with each clip moved to where `starts` says, then settled so that none overlaps. */
export function withStarts<T extends Span>(track: TrackOf<T>, starts: ReadonlyMap<string, number>): TrackOf<T> {
  return {
    ...track,
    clips: settleTrack(track.clips.map((c) => ({ ...c, timelineStart: Math.max(0, starts.get(c.id) ?? c.timelineStart) })))
  }
}

/**
 * Whether a gap from `from` to `to` on one track can be closed up: nothing on
 * any other track starts, ends or lies inside that stretch. A clip running
 * right across it, like music under the whole cut, is no trouble.
 */
export function gapClosable(others: Span[], from: number, to: number): boolean {
  return others.every((c) => spanEnd(c) <= from || c.timelineStart >= to || (c.timelineStart <= from && spanEnd(c) >= to))
}

/** The empty stretch on a track around `frame`, between the clips either side of it, or null when a clip is there or none comes after. */
export function gapAt(clips: Span[], frame: number): { from: number; to: number } | null {
  if (clips.some((c) => spanHolds(c, frame))) return null
  const after = clips.filter((c) => c.timelineStart > frame)
  if (after.length === 0) return null
  const before = clips.filter((c) => spanEnd(c) <= frame)
  return {
    from: before.length > 0 ? Math.max(...before.map(spanEnd)) : 0,
    to: Math.min(...after.map((c) => c.timelineStart))
  }
}

/** How close, in pixels, an edge has to come to something before it snaps to it. */
export const SNAP_PX = 8

/**
 * How far, in frames, an edge reaches for something to snap to: `SNAP_PX`
 * at this zoom while snapping is on, and nothing at all while it is off.
 * Below zero rather than zero, so an edge that happens to sit on a target
 * does not count as caught and draw a guide line for a snap that is off.
 */
export function snapReach(on: boolean, pxPerFrame: number): number {
  return on ? SNAP_PX / pxPerFrame : -1
}

/**
 * Every frame an edge can snap to: the start and end of every clip on every
 * track, leaving out the clips being dragged, and the playhead.
 */
export function snapTargets(tracks: Span[][], playhead: number, except: ReadonlySet<string> = new Set()): number[] {
  const out = new Set<number>([0, playhead])
  for (const track of tracks) {
    for (const c of track) {
      if (except.has(c.id)) continue
      out.add(c.timelineStart)
      out.add(spanEnd(c))
    }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * What a caption's edge may snap to: every clip's edges on every track, the
 * other captions' and the playhead. A trimmed edge never snaps to the frame it
 * began on, `edgeAt`, as a clip's does not, or a trim of a few frames, which is
 * how words are retimed, would snap straight back to a caption that touches it.
 */
export function captionTargets(
  tracks: Span[][],
  captions: { id: string; timelineStart: number; length: number }[],
  playhead: number,
  except: string,
  edgeAt?: number
): number[] {
  const spans = captions.map((c) => ({ id: c.id, mediaId: '', sourceIn: 0, sourceOut: c.length, timelineStart: c.timelineStart }))
  const all = snapTargets([...tracks, spans], playhead, new Set([except]))
  return edgeAt === undefined ? all : all.filter((f) => f !== edgeAt)
}

/**
 * An edge at `frame` moved onto the nearest target within `within` frames,
 * or left where it is. Worked out in frames, so it lands exactly on a cut
 * however far out the timeline is zoomed.
 */
export function snapFrame(frame: number, targets: number[], within: number): number {
  return snapFrameTo(frame, targets, within).frame
}

/**
 * Where a snap lands, and what it caught. Snapping is silent without this:
 * the edge jumps and nothing says what pulled it, which is the same as a bug
 * until you work it out.
 */
export interface Snapped {
  frame: number
  /** The target it caught, or null when nothing was in reach. */
  caught: number | null
}

/** `snapFrame`, saying what it caught. */
export function snapFrameTo(frame: number, targets: number[], within: number): Snapped {
  let best = frame
  let caught: number | null = null
  let distance = within
  for (const t of targets) {
    const d = Math.abs(t - frame)
    if (d <= distance) {
      best = t
      caught = t
      distance = d
    }
  }
  return { frame: best, caught }
}

/**
 * How far `frame` has to move to land on the nearest target within `within`
 * frames: 0 when it is on one already, null when none is in reach.
 */
export function nearestShift(frame: number, targets: number[], within: number): number | null {
  let best: number | null = null
  for (const t of targets) {
    const d = t - frame
    if (Math.abs(d) <= within && (best === null || Math.abs(d) < Math.abs(best))) best = d
  }
  return best
}

/**
 * Where a clip `length` frames long being moved to `start` lands: its start
 * or its end snapped onto the nearest target within `within` frames,
 * whichever is closer, or where it was put. An edge already on a target
 * keeps it there.
 */
export function snapMove(start: number, length: number, targets: number[], within: number): number {
  return snapMoveTo(start, length, targets, within).frame
}

/** `snapMove`, saying which edge caught what. */
export function snapMoveTo(start: number, length: number, targets: number[], within: number): Snapped {
  const ends = [start, start + length]
  const shifts = ends.map((at) => nearestShift(at, targets, within))
  const found = shifts.filter((d): d is number => d !== null)
  if (found.length === 0) return { frame: start, caught: null }
  const shift = found.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
  const which = shifts.findIndex((d) => d === shift)
  const landed = Math.max(0, start + shift)
  // Held at 0 by the start of the sequence rather than by a target: nothing was caught.
  if (landed !== start + shift) return { frame: landed, caught: null }
  return { frame: landed, caught: (ends[which] ?? start) + shift }
}

/**
 * What a trim's moving edge may snap to: only what stays put while the trim
 * moves it, and never the frame the edge itself started on, or a trim of a
 * few frames would snap straight back.
 *
 * A trim that closes up moves the clip's end on screen, and everything after
 * it on every track, so only what starts before the part that moves stays
 * put. A plain trim moves only its own edge, and those of the clips linked to
 * it, named in `moving`.
 */
export function trimTargets(
  tracks: Span[][],
  clip: Span,
  edge: 'start' | 'end',
  playhead: number,
  opts: { closesUp: boolean; moving: ReadonlySet<string> }
): number[] {
  const out = new Set<number>([0, playhead])
  const add = (c: Span): void => {
    out.add(c.timelineStart)
    out.add(spanEnd(c))
  }
  if (opts.closesUp) {
    const stillUntil = edge === 'start' ? clip.timelineStart : spanEnd(clip)
    for (const track of tracks) for (const c of track) if (!opts.moving.has(c.id) && c.timelineStart < stillUntil) add(c)
  } else {
    for (const track of tracks) for (const c of track) if (!opts.moving.has(c.id)) add(c)
  }
  out.delete(!opts.closesUp && edge === 'start' ? clip.timelineStart : spanEnd(clip))
  return [...out].sort((a, b) => a - b)
}

/**
 * Where a trim drag has taken an edge, as a frame of its recording, moved so
 * that the edge it moves on screen lands on a target within reach.
 *
 * `frame` is the edge's frame of the recording the pointer asks for, and
 * `startAt`, `inAt` and `outAt` the clip as the drag found it. A trim that
 * closes up moves the clip's end on screen either way; a plain one moves its
 * start for a head trim and its end for a tail trim.
 */
export function snapTrim(t: {
  closesUp: boolean
  edge: 'start' | 'end'
  frame: number
  startAt: number
  inAt: number
  outAt: number
  targets: number[]
  within: number
  /** The clip's speed (plan 105). Absent for 1. */
  speed?: number
}): number {
  return snapTrimTo(t).frame
}

/** `snapTrim`, saying what the moving edge caught. */
export function snapTrimTo(t: {
  closesUp: boolean
  edge: 'start' | 'end'
  frame: number
  startAt: number
  inAt: number
  outAt: number
  targets: number[]
  within: number
  speed?: number
}): Snapped {
  // Frames of the recording as frames of the timeline, at the clip's speed (plan 105).
  const s = t.speed ?? 1
  const onScreen = Math.round(t.closesUp && t.edge === 'start' ? t.startAt + (t.outAt - t.frame) / s : t.startAt + (t.frame - t.inAt) / s)
  const shift = nearestShift(onScreen, t.targets, t.within)
  if (shift === null) return { frame: t.frame, caught: null }
  // A head trim that closes up moves the clip's end the other way from its first frame.
  return { frame: t.closesUp && t.edge === 'start' ? t.frame - shift * s : t.frame + shift * s, caught: onScreen + shift }
}
