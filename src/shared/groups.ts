import { cropAtKeys } from './crop-geometry'
import { allClips, findClip, linkedIds, settleKeys, simpleKeys, zoomOf, type Clip, type GroupFrame, type Rect, type SoundClip, type Timeline, type ZoomKey } from './project'
import { spanEnd } from './tracks'

/**
 * Plan 80 (bugs and notes 2, note 29): neighbouring clips on one track made
 * one, keeping the cuts between them.
 *
 * The pieces stay ordinary clips, so playback, the export and everything else
 * that reads a clip reads them as before. Each carries the group's id, and
 * each picture piece the group's framing (`GroupFrame`): the main picture as
 * one clip spanning the whole group would have it. After every edit
 * `settleGroups` works each piece's own framing out of the group's, its zoom
 * keyframes moved onto the piece's own recording frames, so a zoom runs
 * across the cuts as if the group were one shot.
 *
 * An edit to a grouped picture's framing is made on a stand in clip spanning
 * the group (`standInTimeline`), by the edit code that exists, and what it
 * leaves on the stand in kept as the group's framing (`frameOf`).
 */

/** The picture pieces of the group a clip is in, picture or sound, in order: none when it is in no group. */
export function groupPieces(p: Timeline, clipId: string): Clip[] {
  const group = findClip(p, clipId)?.clip.group
  if (group === undefined) return []
  for (const r of p.videoTracks) {
    const pieces = r.clips.filter((c) => c.group === group)
    if (pieces.length > 0) return [...pieces].sort((a, b) => a.timelineStart - b.timelineStart)
  }
  return []
}

/**
 * The clips that go with a clip wherever it goes: its linked clips, and when
 * it is in a group every piece of the group with theirs. Selecting, moving,
 * copying and deleting take all of these; trimming takes the linked ones only.
 */
export function groupedIds(p: Timeline, clipId: string): string[] {
  const pieces = groupPieces(p, clipId)
  if (pieces.length === 0) return linkedIds(p, clipId)
  return [...new Set([clipId, ...pieces.flatMap((c) => linkedIds(p, c.id))])]
}

/** The picture clips named, or linked to one named, with every piece of any group one of them is in. */
function picturesOf(p: Timeline, clipIds: readonly string[]): Clip[] {
  const ids = new Set<string>()
  for (const id of clipIds) {
    for (const x of linkedIds(p, id)) ids.add(x)
    for (const c of groupPieces(p, id)) ids.add(c.id)
  }
  const out: Clip[] = []
  for (const r of p.videoTracks) for (const c of r.clips) if (ids.has(c.id)) out.push(c)
  return out
}

/** Why the clips named cannot be grouped into one clip, or null when they can. */
export function groupRefusal(p: Timeline, clipIds: readonly string[]): string | null {
  const pictures = picturesOf(p, clipIds)
  if (pictures.length < 2) return 'Select two or more pictures side by side on one track to group them.'
  const tracks = new Set(pictures.map((c) => findClip(p, c.id)!.track.id))
  if (tracks.size > 1) return 'Only clips on one track can be grouped into one clip.'
  // A group is framed on its pieces' recording frames end to end, which a speed of their own would break (plan 105).
  if (pictures.some((c) => c.speed !== undefined)) return 'Clips at a speed of their own cannot be grouped. Set them back to 1x first.'
  const sorted = [...pictures].sort((a, b) => a.timelineStart - b.timelineStart)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.timelineStart !== spanEnd(sorted[i - 1]!)) {
      return 'Only clips right next to each other, with nothing between them, can be grouped into one clip.'
    }
  }
  const groups = new Set(sorted.map((c) => c.group ?? `alone:${c.id}`))
  if (groups.size === 1 && sorted[0]!.group !== undefined) return 'These are one group already.'
  return null
}

/** A crop from one recording's pixels to another's: the same place in it, kept to the crop's own shape and inside the picture. */
export function mapCrop(r: Rect, from: { width: number; height: number }, to: { width: number; height: number }): Rect {
  if (from.width === to.width && from.height === to.height) return r
  const aspect = r.w / Math.max(1, r.h)
  let w = (r.w * to.width) / from.width
  let h = w / aspect
  if (h > to.height) {
    h = to.height
    w = h * aspect
  }
  w = Math.min(to.width, Math.max(2, Math.round(w / 2) * 2))
  h = Math.min(to.height, Math.max(2, Math.round(h / 2) * 2))
  const cx = ((r.x + r.w / 2) * to.width) / from.width
  const cy = ((r.y + r.h / 2) * to.height) / from.height
  const x = Math.round(Math.min(to.width - w, Math.max(0, cx - w / 2)))
  const y = Math.round(Math.min(to.height - h, Math.max(0, cy - h / 2)))
  return { x, y, w, h }
}

function sizeOf(p: Timeline, mediaId: string): { width: number; height: number } {
  const m = p.media.find((x) => x.id === mediaId)
  return { width: m?.width ?? 1, height: m?.height ?? 1 }
}

function sameCrop(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * The framing a group starts with, from what its pieces showed. A Simple zoom
 * on the first piece becomes one across the whole group, from its Start to
 * the last piece's End. Otherwise each piece keeps what it showed: its own
 * keyframes, moved onto the group's frames, and a keyframe on its first frame
 * holding what it started on. Pieces that all showed one still picture give
 * a still.
 */
export function firstFrame(p: Timeline, pieces: readonly Clip[]): GroupFrame {
  const first = pieces[0]!
  const last = pieces[pieces.length - 1]!
  const start = first.timelineStart
  const ref = sizeOf(p, first.mediaId)
  const into = (c: Clip, r: Rect): Rect => mapCrop(r, sizeOf(p, c.mediaId), ref)
  const base = { mediaId: first.mediaId, place: first.transform.place }
  const zf = zoomOf(first)
  if (zf.simple !== undefined && zf.keys && zf.keys.length > 0) {
    const zl = zoomOf(last)
    const end = zl.simple !== undefined && zl.keys && zl.keys.length > 0 ? zl.keys[zl.keys.length - 1]!.crop : cropAtKeys(zl.crop, zl.keys, last.sourceOut - 1)
    return { ...base, crop: zf.keys[0]!.crop, keys: [{ at: 0, crop: zf.keys[0]!.crop }, { at: 1, crop: into(last, end) }], simple: zf.simple }
  }
  const byFrame = new Map<number, ZoomKey>()
  for (const c of pieces) {
    const g = c.timelineStart - start
    const z = zoomOf(c)
    const inside = (z.keys ?? []).filter((k) => k.at >= c.sourceIn && k.at < c.sourceOut)
    const steering = (z.keys ?? []).filter((k) => k.at <= c.sourceIn).pop()
    const opening = into(c, cropAtKeys(z.crop, z.keys, c.sourceIn))
    // A still piece holds; a moving one carries on as its keyframes say.
    const ease = z.keys && z.keys.length > 0 ? steering?.ease : 'hold'
    byFrame.set(g, { at: g, crop: opening, ...(ease !== undefined ? { ease } : {}) })
    for (const k of inside) byFrame.set(k.at - c.sourceIn + g, { ...k, at: k.at - c.sourceIn + g, crop: into(c, k.crop) })
  }
  const keys = [...byFrame.values()].sort((a, b) => a.at - b.at)
  if (keys.every((k) => sameCrop(k.crop, keys[0]!.crop))) return { ...base, crop: keys[0]!.crop }
  return { ...base, crop: keys[0]!.crop, keys }
}

/**
 * The clips named, with their linked clips and the pieces of any group one of
 * them is in, made one group with the id given, framed as `firstFrame` says.
 * Nothing changes when `groupRefusal` has a reason.
 */
export function groupClips(p: Timeline, clipIds: readonly string[], groupId: string): Timeline {
  if (groupRefusal(p, clipIds) !== null) return p
  const pieces = picturesOf(p, clipIds).sort((a, b) => a.timelineStart - b.timelineStart)
  const frame = firstFrame(p, pieces)
  const pictures = new Set(pieces.map((c) => c.id))
  const members = new Set(pieces.flatMap((c) => linkedIds(p, c.id)))
  const put = <T extends Clip | SoundClip>(c: T): T => {
    if (!members.has(c.id)) return c
    return (pictures.has(c.id) ? { ...c, group: groupId, groupFrame: frame } : { ...c, group: groupId }) as T
  }
  return settleGroups({
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.map(put) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.map(put) }))
  })
}

/** A clip out of its group, keeping the framing it has now. */
function loose<T extends Clip | SoundClip>(c: T): T {
  const { group: _group, groupFrame: _frame, ...rest } = c as Clip
  return rest as unknown as T
}

/** Every group a clip named is in taken apart: its pieces stay, each keeping what it shows. */
export function ungroupClips(p: Timeline, clipIds: readonly string[]): Timeline {
  const groups = new Set(clipIds.flatMap((id) => {
    const g = findClip(p, id)?.clip.group
    return g === undefined ? [] : [g]
  }))
  if (groups.size === 0) return p
  const take = <T extends Clip | SoundClip>(c: T): T => (c.group !== undefined && groups.has(c.group) ? loose(c) : c)
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.map(take) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.map(take) }))
  }
}

/**
 * The clip one clip spanning the whole group would be, under the id of the
 * piece named: from the first piece's first frame for the group's length, on
 * the recording the group's crops are in, framed as the group is. Null for a
 * clip in no group.
 */
export function standIn(p: Timeline, clipId: string): Clip | null {
  const pieces = groupPieces(p, clipId)
  const first = pieces[0]
  const last = pieces[pieces.length - 1]
  if (!first || !last || pieces.length < 2) return null
  const frame = first.groupFrame ?? firstFrame(p, pieces)
  const length = spanEnd(last) - first.timelineStart
  const { keys: _keys, simple: _simple, ...transform } = first.transform
  const { transitionOut: _t, exit: _e, ...clip } = first
  return {
    ...clip,
    id: clipId,
    mediaId: frame.mediaId,
    sourceOut: first.sourceIn + length,
    transform: {
      ...transform,
      crop: frame.crop,
      place: frame.place,
      ...(frame.keys ? { keys: frame.keys.map((k) => ({ ...k, at: k.at + first.sourceIn })) } : {}),
      ...(frame.simple !== undefined ? { simple: frame.simple } : {})
    },
    ...(last.transitionOut ? { transitionOut: last.transitionOut } : {}),
    ...(last.exit ? { exit: last.exit } : {})
  }
}

/** The group's framing read back off its stand in, after an edit was made on it. */
export function frameOf(c: Clip): GroupFrame {
  const z = zoomOf(c)
  return {
    mediaId: c.mediaId,
    crop: z.crop,
    place: c.transform.place,
    ...(z.keys ? { keys: z.keys.map((k) => ({ ...k, at: k.at - c.sourceIn })) } : {}),
    ...(z.simple !== undefined ? { simple: z.simple } : {})
  }
}

/**
 * The timeline with the group of the clip named drawn as its stand in, one
 * clip under that clip's id where the pictures of the group were. What reads
 * a clip's framing, the Inspector and the crop box, reads this; the sound and
 * every other track are as they are. Null for a clip in no group.
 */
export function standInTimeline(p: Timeline, clipId: string): Timeline | null {
  const found = findClip(p, clipId)
  if (!found || found.kind !== 'video') return null
  const one = standIn(p, clipId)
  if (!one) return null
  const group = found.clip.group
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => {
      if (!r.clips.some((c) => c.group === group)) return r
      const at = r.clips.findIndex((c) => c.group === group)
      const rest = r.clips.filter((c) => c.group !== group)
      return { ...r, clips: [...rest.slice(0, at), one, ...rest.slice(at)] }
    })
  }
}

/** A group's framing put on every picture piece of it. */
export function withGroupFrame(p: Timeline, group: string, frame: GroupFrame): Timeline {
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) =>
      r.clips.some((c) => c.group === group) ? { ...r, clips: r.clips.map((c) => (c.group === group ? { ...c, groupFrame: frame } : c)) } : r
    )
  }
}

/**
 * Every group made true again after an edit.
 *
 * A group is its pieces side by side on one track; where an edit has left
 * them apart it keeps its longest run of neighbours, and a piece left out
 * leaves the group with its linked clips. A group of one is no group.
 *
 * Each picture piece's framing is then worked out from the group's: a Simple
 * zoom made again from its Start and End over the group's frames as they are
 * now, and every keyframe moved onto the piece's own recording frames. Given
 * the timeline before the edit, keyframes put by hand stay on the first
 * piece's footage when its head is trimmed. A piece whose framing comes out
 * as it was is left as the same object, so nothing on a locked track reads as
 * changed.
 */
export function settleGroups(p: Timeline, before?: Timeline): Timeline {
  const now = piecesByGroup(p)
  const orphans = allClips(p).some((c) => c.group !== undefined && !now.has(c.group))
  if (now.size === 0 && !orphans) return p
  // Worked out once, not asked of the whole sequence once per piece: with an
  // hour's cut in one group every edit cost tens of milliseconds (audit 2026-10-19).
  const byLink = new Map<string, string[]>()
  for (const c of allClips(p)) if (c.link !== undefined) byLink.set(c.link, [...(byLink.get(c.link) ?? []), c.id])
  const was = before && before.media === p.media ? piecesByGroup(before) : null
  const kept = new Map<string, Clip>()
  const members = new Set<string>()
  for (const [group, pieces] of now) {
    // A group the edit did not touch is as it was settled, piece for piece.
    const settled = (was && samePieces(pieces, was.get(group)) ? keptAsTheyAre(pieces) : null) ?? settledGroup(p, pieces, before)
    for (const piece of settled) {
      kept.set(piece.id, piece)
      members.add(piece.id)
      if (piece.link !== undefined) for (const id of byLink.get(piece.link) ?? []) members.add(id)
    }
  }
  const video = (c: Clip): Clip => {
    const next = kept.get(c.id)
    if (next) return next
    return c.group === undefined ? c : loose(c)
  }
  const sound = (c: SoundClip): SoundClip => (c.group === undefined || members.has(c.id) ? c : loose(c))
  // A track whose clips all come out as they were is the same track, and a
  // timeline whose tracks all do is the same timeline.
  const track = <T extends Clip | SoundClip, R extends { clips: T[] }>(r: R, fn: (c: T) => T): R => {
    const clips = r.clips.map(fn)
    return clips.every((c, i) => c === r.clips[i]) ? r : { ...r, clips }
  }
  const videoTracks = p.videoTracks.map((r) => track(r, video))
  const audioTracks = p.audioTracks.map((r) => track(r, sound))
  if (videoTracks.every((r, i) => r === p.videoTracks[i]) && audioTracks.every((r, i) => r === p.audioTracks[i])) return p
  return { ...p, videoTracks, audioTracks }
}

/** A group's pieces where they are, each with the index of its video track, in track order and then in the order of the track's clips. */
type Placed = { track: number; clip: Clip }

/** Every group's pieces, found in one pass over the video tracks. */
function piecesByGroup(p: Timeline): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>()
  p.videoTracks.forEach((r, track) => {
    for (const clip of r.clips) {
      if (clip.group === undefined) continue
      const was = out.get(clip.group)
      if (was) was.push({ track, clip })
      else out.set(clip.group, [{ track, clip }])
    }
  })
  return out
}

/** Whether a group's pieces are the very same clips on the same tracks as before the edit. */
function samePieces(now: readonly Placed[], was: readonly Placed[] | undefined): boolean {
  return was !== undefined && was.length === now.length && now.every((x, i) => x.track === was[i]!.track && x.clip === was[i]!.clip)
}

/**
 * The pieces of a group the edit left alone, as they are, when they are one
 * run of neighbours on one track, as a settled group always is; null when
 * they are not, and so want settling after all.
 */
function keptAsTheyAre(pieces: readonly Placed[]): Clip[] | null {
  if (pieces.length < 2 || pieces.some((x) => x.track !== pieces[0]!.track)) return null
  const run = pieces.map((x) => x.clip).sort((a, b) => a.timelineStart - b.timelineStart)
  return run.every((c, i) => i === 0 || c.timelineStart === spanEnd(run[i - 1]!)) ? run : null
}

/** The pieces a group keeps, each framed from the group: none when it is no group any more. */
function settledGroup(p: Timeline, placed: readonly Placed[], before?: Timeline): Clip[] {
  const group = placed[0]!.clip.group!
  // The track with most of it, and on that its longest run of neighbours.
  let best: Clip[] = []
  for (const track of new Set(placed.map((x) => x.track))) {
    const pieces = placed.filter((x) => x.track === track).map((x) => x.clip).sort((a, b) => a.timelineStart - b.timelineStart)
    let run: Clip[] = []
    for (const c of pieces) {
      if (run.length > 0 && c.timelineStart === spanEnd(run[run.length - 1]!)) run.push(c)
      else run = [c]
      if (run.length > best.length) best = run
    }
  }
  if (best.length < 2) return []
  const first = best[0]!
  const last = best[best.length - 1]!
  const start = first.timelineStart
  const length = spanEnd(last) - start
  let frame = best.find((c) => c.groupFrame)?.groupFrame ?? firstFrame(p, best)
  let keys = frame.keys
  if (keys && keys.length > 0 && frame.simple !== undefined) {
    keys = simpleKeys(keys[0]!.crop, keys[keys.length - 1]!.crop, frame.simple, 0, length)
  } else if (keys && keys.length > 0 && before) {
    // Keyframes put by hand stay on the first piece's footage.
    const was = findClip(before, first.id)
    const wasPieces = was && was.clip.group === group ? groupPieces(before, first.id) : []
    if (was && wasPieces.length > 0) {
      const shift = -(was.clip.timelineStart - wasPieces[0]!.timelineStart + first.sourceIn - was.clip.sourceIn)
      if (shift !== 0) keys = keys.map((k) => ({ ...k, at: k.at + shift }))
    }
  }
  const crop = keys && keys.length > 0 ? cropAtKeys(frame.crop, keys, 0) : frame.crop
  frame = { ...frame, crop, ...(keys ? { keys } : {}) }
  const ref = sizeOf(p, frame.mediaId)
  return best.map((c) => {
    const g = c.timelineStart - start
    const own = (r: Rect): Rect => mapCrop(r, ref, sizeOf(p, c.mediaId))
    const shift = c.sourceIn - g
    const { keys: _keys, simple: _simple, ...transform } = c.transform
    const next = settleKeys({
      ...c,
      groupFrame: frame,
      transform: {
        ...transform,
        crop: own(keys && keys.length > 0 ? cropAtKeys(frame.crop, keys, g) : frame.crop),
        place: frame.place,
        ...(keys && keys.length > 0 ? { keys: keys.map((k) => ({ ...k, at: k.at + shift, crop: own(k.crop) })) } : {})
      }
    })
    return sameClip(next, c) ? c : next
  })
}

/**
 * Whether a piece framed again comes out as it was: field by field, and only
 * a field that is not the same object compared by what it holds. Writing out
 * the whole clip twice for every piece cost more than the framing itself.
 */
function sameClip(a: Clip, b: Clip): boolean {
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const k of keys) {
    if (x[k] === y[k]) continue
    if (typeof x[k] !== 'object' || typeof y[k] !== 'object' || JSON.stringify(x[k]) !== JSON.stringify(y[k])) return false
  }
  return true
}

/** Whether a clip's edge is a cut inside its group, which is not a trim handle. */
export function innerEdge(p: Timeline, clipId: string, edge: 'start' | 'end'): boolean {
  const found = findClip(p, clipId)
  if (!found || found.clip.group === undefined) return false
  const c = found.clip
  const at = edge === 'start' ? c.timelineStart : spanEnd(c)
  const pieces = found.kind === 'video' ? groupPieces(p, clipId) : []
  if (found.kind === 'video') return pieces.some((x) => x.id !== c.id && (edge === 'start' ? spanEnd(x) === at : x.timelineStart === at))
  // A sound piece: its picture's edge, where that is inside the group.
  const picture = linkedIds(p, clipId).map((id) => findClip(p, id)).find((f) => f?.kind === 'video')
  return picture ? innerEdge(p, picture.clip.id, edge) : false
}
