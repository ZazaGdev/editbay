/**
 * Splitting a clip at a frame and joining two pieces back together, with their
 * linked clips, and splitting every track at once.
 */

import { newId } from './ids'
import { cropAtKeys } from './crop-geometry'
import { type Span, spanEnd, type TrackOf } from './tracks'
import type { Appear } from './appear'
import type { Transition } from './transitions'
import { MAIN_PICTURE } from './project-core'
import type { Timeline, Rect, Clip, SoundClip, ZoomKey } from './project'
import { findClip, linkedIds, groupOnV1, allClips } from './timeline-query'
import { openUpStretch } from './remove-clips'
import { reshape } from './move-trim'
import { startEndOf, simpleClip, zoomOf, settleKeys, withZoom } from './zoom-keys'

/** Whether `frame` is inside a clip, where a cut would leave something either side. */
export function strictlyInside(c: Span, frame: number): boolean {
  return frame > c.timelineStart && frame < spanEnd(c)
}

/**
 * Which clip S, I and O act on at `frame`: the one named when it is under
 * `frame`, otherwise the clip on the lowest video track there, otherwise the
 * clip there on the audio track nearest the top. Null when there is none, or
 * when the one named is under `frame` on its first frame, where a cut or a
 * trim would do nothing: another clip it was not asked to touch is left alone.
 */
export function clipToCut(p: Timeline, frame: number, clipId?: string | null): string | null {
  const named = clipId ? findClip(p, clipId) : null
  if (named && frame >= named.clip.timelineStart && frame < spanEnd(named.clip)) {
    return strictlyInside(named.clip, frame) ? named.clip.id : null
  }
  for (const track of [...p.videoTracks, ...p.audioTracks] as TrackOf<Span>[]) {
    const c = track.clips.find((x) => strictlyInside(x, frame))
    if (c) return c.id
  }
  return null
}

/**
 * The two pieces a clip is cut into at `frame`: the first ends there, the
 * second starts there as a new clip, with `link` when it is linked. The first
 * keeps the transition at the clip's start and the second the one at its end.
 * The new cut gets neither: a copy of the whole clip carried its transition in
 * onto the new cut, and left its transition out on the cut too, so every split
 * put a transition where there had been none.
 */
function pieces<T extends Span>(c: T, rest: Omit<T, 'link'>, frame: number, link: string | undefined): T[] {
  const at = c.sourceIn + (frame - c.timelineStart)
  const second = { ...rest, id: newId(), sourceIn: at, timelineStart: frame, ...(link !== undefined ? { link } : {}) } as unknown as T
  return asTwoPieces({ ...c, sourceOut: at }, second)
}

/**
 * A clip covered in the middle by another, as a drop or a move over it does,
 * leaves two pieces of itself on one track under one link, and its linked
 * sound across the gap: trimming one piece then trimmed the far one and the
 * sound too (audit 2026-10-01). Each such gap is put right as a split would
 * leave it: the linked clips cut at its two edges, the far side's pieces
 * linked among themselves, and what is under the gap, the sound still heard
 * there, on its own.
 */
export function relinkCovered(t: Timeline): Timeline {
  let next = t
  // One gap at a time, each making a new link, so it ends: a link with pieces apart is only left by a cover.
  for (let guard = 0; guard < 64; guard++) {
    const gap = splitLink(next)
    if (!gap) return next
    next = closeLinkGap(next, gap)
  }
  return next
}

/** The first link with two pieces of it apart on one track: the link, the track, and the gap between the first two. */
function splitLink(t: Timeline): { link: string; trackId: string; from: number; to: number } | null {
  for (const r of [...t.videoTracks, ...t.audioTracks] as TrackOf<Span>[]) {
    const byLink = new Map<string, Span[]>()
    for (const c of r.clips) if (c.link !== undefined) byLink.set(c.link, [...(byLink.get(c.link) ?? []), c])
    for (const [link, list] of byLink) {
      if (list.length < 2) continue
      const sorted = [...list].sort((a, b) => a.timelineStart - b.timelineStart)
      return { link, trackId: r.id, from: spanEnd(sorted[0]!), to: sorted[1]!.timelineStart }
    }
  }
  return null
}

function closeLinkGap(t: Timeline, gap: { link: string; trackId: string; from: number; to: number }): Timeline {
  const fresh = newId()
  const side = <T extends Span>(c: T): T => {
    if (spanEnd(c) <= gap.from) return c
    const { link: _old, ...rest } = c
    if (c.timelineStart >= gap.to) return { ...rest, link: fresh } as unknown as T
    return rest as unknown as T
  }
  const cut = <T extends Span>(c: T, frame: number): T[] => {
    if (!(c.timelineStart < frame && frame < spanEnd(c))) return [c]
    const { link: _old, ...rest } = c
    return pieces(c, rest, frame, c.link)
  }
  const track = <T extends Span>(r: TrackOf<T>): TrackOf<T> => {
    if (!r.clips.some((c) => c.link === gap.link)) return r
    const covered = r.id === gap.trackId
    const clips = r.clips.flatMap((c) => {
      if (c.link !== gap.link) return [c]
      // The covered track's own pieces are apart already: only which side they are on.
      if (covered) return [side(c)]
      return cut(c, gap.from)
        .flatMap((x) => cut(x, gap.to))
        .map(side)
    })
    return { ...r, clips }
  }
  return {
    ...t,
    videoTracks: t.videoTracks.map((r) => track(r as TrackOf<Span>) as unknown as (typeof t.videoTracks)[number]),
    audioTracks: t.audioTracks.map((r) => track(r as TrackOf<Span>) as unknown as (typeof t.audioTracks)[number])
  }
}

/**
 * Two pieces of one clip, each made as a copy of it, given what belongs to
 * their ends alone: the first keeps the clip's start, its transition in and
 * its coming in; the second its end, its transition out and its going out.
 * Every edit that leaves two clips where there was one goes through here: a
 * split, a stretch taken out by Remove silences, a clip put in across another
 * or over the middle of it. A copy of the whole clip on both sides put a
 * transition, a fade or a Simple zoom's whole move at every new cut.
 */
export function asTwoPieces<T extends Span>(first: T, second: T): [T, T] {
  const { transitionOut: _out, exit: _exit, ...head } = first as T & { transitionOut?: unknown; exit?: unknown }
  const { transitionIn: _in, enter: _enter, ...tail } = second as T & { transitionIn?: unknown; enter?: unknown }
  return splitSimple(head as T, tail as T)
}

/**
 * A crop worked out between two others, on even pixels, each side rounded
 * inward so it stays inside whatever the two it came from were inside.
 */
function evenInside(r: Rect): Rect {
  return {
    x: Math.ceil(r.x / 2) * 2,
    y: Math.ceil(r.y / 2) * 2,
    w: Math.max(2, Math.floor((r.x + r.w) / 2) * 2 - Math.ceil(r.x / 2) * 2),
    h: Math.max(2, Math.floor((r.y + r.h) / 2) * 2 - Math.ceil(r.y / 2) * 2)
  }
}

/**
 * The two pieces of a Simple zoom: the first ends on the picture its last
 * frame showed and the second starts on the one its first frame showed, so
 * nothing jumps at the cut. Anything else is left as it is.
 */
function splitSimple<T extends Span>(head: T, tail: T): [T, T] {
  const [a, b] = [head, tail] as unknown as [Clip, Clip]
  const keys = a.transform?.keys
  const ease = a.transform?.simple
  if (ease === undefined || !keys || keys.length === 0) return [head, tail]
  const { start, end } = startEndOf(a)
  const before = evenInside(cropAtKeys(a.transform.crop, keys, a.sourceOut - 1))
  const after = evenInside(cropAtKeys(a.transform.crop, keys, b.sourceIn))
  return [simpleClip(a, start, before, ease), simpleClip(b, after, end, ease)] as unknown as [T, T]
}

/**
 * Cut a clip in two at `frame`, with the clips linked to it that are under
 * `frame` too, unless it is cut on its own: the one named when it is there,
 * otherwise the one `clipToCut` finds. The first pieces stay linked to each
 * other and the second pieces are linked to each other. A cut on an edge
 * would leave an empty clip, so it does nothing.
 */
export function splitClip(p: Timeline, frame: number, clipId?: string, alone = false): Timeline {
  const target = clipToCut(p, frame, clipId)
  if (!target) return p
  // Alone is for the clip selected alone. Another clip cut in its place takes its linked clips with it.
  const lone = alone && target === clipId
  const members = lone ? [target] : linkedIds(p, target)
  const cutting = new Set(members.filter((id) => strictlyInside(findClip(p, id)!.clip, frame)))
  // A linked clip that starts past the frame is not cut, but it is what plays
  // with the second pieces: in an L-cut the next shot's sound, in a J-cut its
  // picture. Left on the old link it stayed with the sliver before the cut,
  // and a ripple delete of the sliver took it too (audit 2026-10-08).
  const later = new Set(members.filter((id) => !cutting.has(id) && findClip(p, id)!.clip.timelineStart >= frame))
  const link = cutting.size + later.size > 1 ? newId() : undefined
  const cut = <T extends Span>(c: T): T[] => {
    if (later.has(c.id)) return [{ ...c, link } as T]
    if (!cutting.has(c.id)) return [c]
    const { link: _old, ...rest } = c
    return pieces(c, rest, frame, link)
  }
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) }))
  }
}

/**
 * The clip right before or right after one on its own track, touching it, or
 * null when there is a gap or nothing there: what a join at that edge would
 * join it with.
 */
export function joinNeighbour(p: Timeline, clipId: string, side: 'previous' | 'next'): string | null {
  const found = findClip(p, clipId)
  if (!found) return null
  const c = found.clip as Span
  const other = (found.track.clips as Span[]).find((x) =>
    side === 'next' ? x.timelineStart === spanEnd(c) : spanEnd(x) === c.timelineStart && x.id !== c.id
  )
  return other?.id ?? null
}

/**
 * Whether `second` carries straight on from `first`: one track, one recording
 * and stream, touching, and nothing left out, or exactly `removed` frames of
 * the recording left out between them.
 */
function continues(p: Timeline, first: string, second: string, removed = 0): boolean {
  const a = findClip(p, first)
  const b = findClip(p, second)
  if (!a || !b || a.kind !== b.kind || a.track.id !== b.track.id) return false
  if (a.clip.mediaId !== b.clip.mediaId) return false
  if (a.kind === 'audio' && (a.clip as SoundClip).track !== (b.clip as SoundClip).track) return false
  return b.clip.timelineStart === spanEnd(a.clip) && b.clip.sourceIn === a.clip.sourceOut + removed
}

/**
 * How many frames of its recording were taken out between two clips side by
 * side, which a join bringing them back puts in again: 0 when the second
 * carries straight on, or when they are not two pieces of one recording in
 * order at all.
 */
export function removedBetween(p: Timeline, first: string, second: string): number {
  const a = findClip(p, first)
  const b = findClip(p, second)
  if (!a || !b || a.clip.mediaId !== b.clip.mediaId) return 0
  const removed = b.clip.sourceIn - a.clip.sourceOut
  return removed > 0 && continues(p, first, second, removed) ? removed : 0
}

/**
 * The pairs a join of `first` and `second` joins: that pair, and each clip
 * linked to either paired with the one that carries straight on from it at
 * the same cut. Null when one of them that is cut there too, ending or
 * starting on the cut, has no such partner, which would leave the group out of
 * step. One not cut there, as the next shot's sound in an L-cut that S left
 * past the frame, needs none (audit 2026-10-10).
 */
function joinPairs(p: Timeline, first: string, second: string, alone: boolean, removed = 0): [string, string][] | null {
  if (alone) return [[first, second]]
  const firsts = linkedIds(p, first)
  const seconds = linkedIds(p, second)
  const all = [...new Set([...firsts, ...seconds])]
  const cut = spanEnd(findClip(p, first)!.clip)
  const atCut = (id: string): boolean => {
    const c = findClip(p, id)!.clip
    return spanEnd(c) === cut || c.timelineStart === cut
  }
  const pairs: [string, string][] = []
  const used = new Set<string>()
  for (const x of all) {
    if (used.has(x)) continue
    const y = all.find((z) => !used.has(z) && z !== x && continues(p, x, z, removed))
    if (!y) continue
    pairs.push([x, y])
    used.add(x)
    used.add(y)
  }
  return all.every((x) => used.has(x) || !atCut(x)) ? pairs : null
}

/**
 * The links a join makes one: each second piece's link becomes its first
 * piece's, so the clips linked to either, such as a sound S left on the
 * second piece's link, stay one group with the joined clip. Not when that
 * would put two clips of the group on one track, as joining a picture alone
 * leaves its two sound pieces.
 */
function mergedLinks(p: Timeline, pairs: readonly [string, string][]): Map<string, string> {
  const merged = new Map<string, string>()
  const gone = new Set(pairs.map(([, y]) => y))
  for (const [x, y] of pairs) {
    const a = findClip(p, x)!.clip.link
    const b = findClip(p, y)!.clip.link
    if (a === undefined || b === undefined || a === b) continue
    const tracks = (link: string) =>
      [...p.videoTracks, ...p.audioTracks].filter((r) => (r.clips as Span[]).some((c) => c.link === link && !gone.has(c.id))).map((r) => r.id)
    const ta = tracks(a)
    if (tracks(b).some((r) => ta.includes(r))) continue
    merged.set(b, a)
  }
  return merged
}

/**
 * Why two clips cannot be joined into one, or null when they can: they must
 * sit next to each other on one track, come from the same recording, and the
 * second must carry straight on from the first. Joining across a stretch
 * that was taken out would play it again, so that is refused, unless
 * `bringBack` says to put it back. The clips linked to them must join at the
 * same cut too, with as much taken out between them, unless the clip was
 * taken on its own.
 */
export function joinRefusal(p: Timeline, first: string, second: string, alone = false, bringBack = false): string | null {
  const a = findClip(p, first)
  const b = findClip(p, second)
  if (!a || !b) return 'There is no clip there to join with.'
  if (a.kind !== b.kind || a.track.id !== b.track.id || b.clip.timelineStart !== spanEnd(a.clip)) {
    return 'Only two clips right next to each other on one track can be joined.'
  }
  if (a.clip.mediaId !== b.clip.mediaId) return 'These come from different recordings, so they cannot be one clip.'
  if (a.kind === 'audio' && (a.clip as SoundClip).track !== (b.clip as SoundClip).track) {
    return 'These play different tracks of the recording, so they cannot be one clip.'
  }
  const removed = bringBack ? removedBetween(p, first, second) : 0
  if (b.clip.sourceIn !== a.clip.sourceOut + removed) {
    return b.clip.sourceIn > a.clip.sourceOut
      ? 'Something was taken out between these, and joining them would play it again. Join, bringing back what was cut, puts it back.'
      : 'The second of these plays earlier footage than the first ends on, so they cannot be one clip.'
  }
  if (!joinPairs(p, first, second, alone, removed)) {
    return 'A clip linked to one of these is not cut at the same place, so joining would put the group out of step. Select the clip alone with Alt to join just it.'
  }
  return null
}

/**
 * A joined picture's zoom keyframes: both pieces', which are on the same
 * recording's frames, so the zoom plays across the join as it did across the
 * cut. Where both have one on a frame, as a split leaves the keyframes either
 * side of it on both halves, the first piece's stays.
 */
function withJoinedKeys<T extends Span>(joined: T, second: T): T {
  // A sound clip has no pictures to join.
  if ((joined as Partial<Clip>).transform === undefined) return joined
  const first = joined as unknown as Clip
  const other = second as unknown as Clip
  // Every picture's own zoom: the main one's, and each further one the second piece has too.
  const pictures = [MAIN_PICTURE, ...first.layers.filter((l) => other.layers.some((x) => x.id === l.id)).map((l) => l.id)]
  return pictures.reduce((c, pic) => joinedPicture(c, other, pic), first) as unknown as T
}

/** One picture's zoom across a join, as `withJoinedKeys` says. */
function joinedPicture(joined: Clip, second: Clip, picture: string): Clip {
  const za = zoomOf(joined, picture)
  const zb = zoomOf(second, picture)
  if ((za.simple !== undefined) !== (zb.simple !== undefined)) return joinedAsKeys(joined, second, picture)
  const b = zb.keys
  if (!b || b.length === 0) return joined
  const byFrame = new Map<number, ZoomKey>()
  for (const k of [...b, ...(za.keys ?? [])]) byFrame.set(k.at, k)
  const keys = [...byFrame.values()].sort((x, y) => x.at - y.at)
  return settleKeys(withZoom(joined, picture, { ...za, keys }))
}

/**
 * A Simple piece joined to one that is not, or the other way round: one
 * Simple zoom cannot play what the two did, so the joined clip gets keyframes
 * put by hand that do. The first piece's picture up to its last frame, held
 * there, and the second's from its first frame on, whatever each was.
 */
function joinedAsKeys(joined: Clip, second: Clip, picture: string = MAIN_PICTURE): Clip {
  const cut = second.sourceIn
  const za = zoomOf(joined, picture)
  const zb = zoomOf(second, picture)
  const a = za.keys
  const b = zb.keys
  const steering = (b ?? []).filter((k) => k.at <= cut).pop()
  const keys: ZoomKey[] = [
    ...(a ?? []).filter((k) => k.at < cut - 1),
    { at: cut - 1, crop: evenInside(cropAtKeys(za.crop, a, cut - 1)), ease: 'hold' },
    { at: cut, crop: evenInside(cropAtKeys(zb.crop, b, cut)), ...(steering?.ease ? { ease: steering.ease } : {}) },
    ...(b ?? []).filter((k) => k.at > cut)
  ]
  return settleKeys(withZoom(joined, picture, { crop: za.crop, keys }))
}


/**
 * Join clips at their cuts, as one edit: every cut between two of the clips
 * named, on any track, that `joinRefusal` allows, with the clips linked to
 * them joining at the same cut. The joined clip is the first piece made as
 * long as both, keeping everything of the first piece, its transition in,
 * and the second piece's transition out; a transition on the cut goes. It
 * plays exactly as the two did, since the second carried straight on.
 */
export function joinClips(p: Timeline, clipIds: readonly string[], alone = false, bringBack = false): Timeline {
  const named = new Set(clipIds)
  let out = p
  for (;;) {
    let found: [string, string][] | null = null
    for (const id of named) {
      const next = joinNeighbour(out, id, 'next')
      if (next === null || !named.has(next) || joinRefusal(out, id, next, alone, bringBack) !== null) continue
      const removed = bringBack ? removedBetween(out, id, next) : 0
      if (removed > 0) out = broughtBack(out, joinPairs(out, id, next, alone, removed)!, removed)
      found = joinPairs(out, id, next, alone)
      if (found) break
    }
    if (!found) return out
    const ends = new Map(found.map(([x, y]) => [x, findClip(out, y)!.clip] as const))
    const gone = new Set(found.map(([, y]) => y))
    const links = mergedLinks(out, found)
    const joined = <T extends Span & { transitionIn?: Transition; transitionOut?: Transition; exit?: Appear }>(x: T): T[] => {
      if (gone.has(x.id)) return []
      const c = x.link !== undefined && links.has(x.link) ? { ...x, link: links.get(x.link) } : x
      const end = ends.get(c.id) as T | undefined
      if (!end) return [c]
      const { transitionOut: _cut, exit: _exit, ...rest } = c
      const whole = {
        ...rest,
        sourceOut: end.sourceOut,
        ...(end.transitionOut ? { transitionOut: end.transitionOut } : {}),
        ...(end.exit ? { exit: end.exit } : {})
      } as T
      return [withJoinedKeys(whole, end)]
    }
    out = {
      ...out,
      videoTracks: out.videoTracks.map((r) => ({ ...r, clips: r.clips.flatMap(joined) })),
      audioTracks: out.audioTracks.map((r) => ({ ...r, clips: r.clips.flatMap(joined) }))
    }
    for (const y of gone) named.delete(y)
  }
}

/**
 * What was taken out between each pair put back: the first of each pair made
 * `removed` frames longer, and everything from the cut on moved later to make
 * room, on every track when the pair is on V1, as a ripple trim does, and
 * only on the pairs' own tracks otherwise, so an overlay put back does not
 * move the video under it. The pairs then carry straight on.
 */
function broughtBack(p: Timeline, pairs: readonly [string, string][], removed: number): Timeline {
  const firsts = new Set(pairs.map(([x]) => x))
  const at = Math.min(...pairs.map(([x]) => spanEnd(findClip(p, x)!.clip)))
  const tracks = new Set(pairs.map(([x]) => findClip(p, x)!.track.id))
  const onV1 = pairs.some(([x]) => groupOnV1(p, x))
  const leave = new Set(firsts)
  if (!onV1) {
    for (const r of [...p.videoTracks, ...p.audioTracks] as TrackOf<Span>[]) {
      if (!tracks.has(r.id)) for (const c of r.clips) leave.add(c.id)
    }
  }
  return reshape(openUpStretch(p, at, removed, leave), firsts, (c) => ({ ...c, sourceOut: c.sourceOut + removed }))
}

/**
 * Cut every clip running across `frame`, on every video and audio track: Split
 * every track. The second pieces of each linked group are linked to each
 * other, as `splitClip` does for the one group it cuts, so a picture and its
 * sound stay one clip either side of the cut. A clip whose edge is already on
 * `frame` is left alone, since cutting there would leave an empty clip.
 */
export function splitEverything(p: Timeline, frame: number): Timeline {
  const crossing = allClips(p).filter((c) => strictlyInside(c, frame))
  if (crossing.length === 0) return p
  const cutting = new Set(crossing.map((c) => c.id))
  const wasCut = new Set(crossing.flatMap((c) => (c.link === undefined ? [] : [c.link])))
  /**
   * What each group leaves after the frame: the second piece of every clip
   * cut, and every clip of it that begins past the frame and so is not cut at
   * all. Counted this way rather than by what is cut, because in a J-cut the
   * sound of the shot coming in is cut while its picture, which starts later,
   * is not: counting only the cut would leave that picture linked to the
   * sliver of sound before the cut and its own sound linked to nothing.
   */
  const after = new Map<string, number>()
  for (const c of allClips(p)) {
    if (c.link === undefined || !wasCut.has(c.link)) continue
    if (cutting.has(c.id) || c.timelineStart >= frame) after.set(c.link, (after.get(c.link) ?? 0) + 1)
  }
  const links = new Map<string, string>()
  for (const [link, n] of after) if (n > 1) links.set(link, newId())
  const cut = <T extends Span>(c: T): T[] => {
    // A clip past the frame is not cut, but it belongs with the second pieces.
    if (!cutting.has(c.id)) {
      const moved = c.link !== undefined && c.timelineStart >= frame ? links.get(c.link) : undefined
      return moved === undefined ? [c] : [{ ...c, link: moved } as T]
    }
    const { link: old, ...rest } = c
    return pieces(c, rest, frame, old === undefined ? undefined : links.get(old))
  }
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.flatMap(cut) }))
  }
}
