import { newId } from './ids'
import {
  addTrack,
  allClips,
  editSequence,
  findClip,
  isDrawn,
  linkedIds,
  timelineOf,
  type Clip,
  type Project,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from './project'
import { hasRoom, MAX_AUDIO_TRACKS, MAX_VIDEO_TRACKS, spanEnd, type Span, type TrackOf } from './tracks'

/**
 * Clips copied, cut and pasted: what a copy holds, and where a paste puts it.
 * A copy is whole clips with every setting, so a paste is the same clips again
 * at another time, never a reference back to the ones copied. See plan 63.
 */

/** One clip copied: what it is, which track it was on, and how far after the first copied clip it starts. */
export interface CopiedClip {
  kind: 'video' | 'audio'
  /** Its track's index among the tracks of its kind: 0 is V1, or A1. */
  track: number
  /** Frames after the earliest copied clip's start. */
  offset: number
  clip: Clip | SoundClip
}

export interface CopiedClips {
  clips: CopiedClip[]
  /** The text sources of the copied texts, which a paste copies too, so each pasted text is its own. */
  texts: ProjectMedia[]
}

/**
 * The clips named, and those linked to them unless taken on their own, as a
 * copy. Clips on a locked track are left out, as they cannot be selected.
 * Null when nothing is left to copy.
 */
export function copyClips(t: Timeline, clipIds: readonly string[], alone = false): CopiedClips | null {
  const ids = new Set<string>()
  for (const id of clipIds) for (const x of alone ? [id] : linkedIds(t, id)) ids.add(x)
  const found = [...ids].map((id) => findClip(t, id)).filter((f) => f !== null && !f.track.locked)
  if (found.length === 0) return null
  const first = Math.min(...found.map((f) => f!.clip.timelineStart))
  const clips: CopiedClip[] = found.map((f) => ({ kind: f!.kind, track: f!.index, offset: f!.clip.timelineStart - first, clip: f!.clip }))
  const textIds = new Set(clips.filter((c) => c.kind === 'video').map((c) => c.clip.mediaId))
  // A text or a shape copied is a new source of its own, so changing the copy leaves the first as it is.
  const texts = t.media.filter((m) => textIds.has(m.id) && isDrawn(m))
  return { clips, texts }
}

/** What a paste did: the ids of the clips it placed, and how many it had no room for. */
export interface Pasted {
  project: Project
  placed: string[]
  left: number
}

/**
 * The copied clips again at `at`, keeping their spacing, each with a new id.
 * A group copied together is linked again among its copies, never to the
 * clips it was copied from, a grouped clip's copies make a group of their
 * own in the same way, and a copied text is a new text source of its
 * own. Each clip goes on the track it came from when that stretch is free
 * there, and otherwise on the next free track, upwards for pictures and
 * downwards for sound, with a new track added when none is free. Nothing is
 * ever overwritten: a clip with no track left for it is left out and counted.
 */
export function pasteClips(p: Project, sequenceId: string, copied: CopiedClips, at: number, ids: () => string = newId): Pasted {
  const start = Math.max(0, Math.round(at))
  // New text sources, one per copied text, and the new id each copy of it plays.
  const textIds = new Map(copied.texts.map((m) => [m.id, ids()] as const))
  const media = [...p.media, ...copied.texts.map((m) => ({ ...m, id: textIds.get(m.id)! }))]
  const links = new Map<string, string>()
  const groups = new Map<string, string>()
  const placed: string[] = []
  let left = 0
  const next = editSequence({ ...p, media }, sequenceId, (t0) => {
    let t = t0
    // Pictures before sound, higher tracks first, so what came off the higher
    // tracks does not take the room the lower ones' copies want.
    const order = [...copied.clips].sort((a, b) => (a.kind === b.kind ? b.track - a.track : a.kind === 'video' ? -1 : 1))
    for (const c of order) {
      const length = spanEnd(c.clip) - c.clip.timelineStart
      const from = start + c.offset
      const video = c.kind === 'video'
      const tracks = (): TrackOf<Span>[] => (video ? t.videoTracks : t.audioTracks)
      const free = (i: number): boolean => {
        const r = tracks()[i]
        return r !== undefined && !r.locked && hasRoom(r.clips, from, length)
      }
      // Its own track, then onwards, then a new one.
      let index = -1
      for (let i = Math.min(c.track, tracks().length - 1); i < tracks().length; i++) {
        if (i >= 0 && free(i)) {
          index = i
          break
        }
      }
      if (index < 0) {
        const most = video ? MAX_VIDEO_TRACKS : MAX_AUDIO_TRACKS
        if (tracks().length >= most) {
          left += 1
          continue
        }
        t = addTrack(t, video ? 'video' : 'audio', ids())
        index = tracks().length - 1
      }
      const id = ids()
      const link = c.clip.link === undefined ? undefined : (links.get(c.clip.link) ?? links.set(c.clip.link, ids()).get(c.clip.link)!)
      const group = c.clip.group === undefined ? undefined : (groups.get(c.clip.group) ?? groups.set(c.clip.group, ids()).get(c.clip.group)!)
      const { link: _old, group: _oldGroup, ...rest } = c.clip
      const copy = {
        ...rest,
        id,
        timelineStart: from,
        mediaId: textIds.get(c.clip.mediaId) ?? c.clip.mediaId,
        ...(link !== undefined ? { link } : {}),
        ...(group !== undefined ? { group } : {})
      }
      if (video) {
        t = { ...t, videoTracks: t.videoTracks.map((r, i) => (i === index ? { ...r, clips: sortByStart([...r.clips, copy as Clip]) } : r)) }
      } else {
        t = { ...t, audioTracks: t.audioTracks.map((r, i) => (i === index ? { ...r, clips: sortByStart([...r.clips, copy as SoundClip]) } : r)) }
      }
      placed.push(id)
    }
    return t
  })
  // A group that lost some of its clips is still linked among those that landed.
  // A text left out takes its new source with it.
  const landed = new Set(allClips(timelineOf(next, sequenceId)).map((c) => c.mediaId))
  const project = { ...next, media: next.media.filter((m) => ![...textIds.values()].includes(m.id) || landed.has(m.id)) }
  return { project, placed, left }
}

function sortByStart<T extends { timelineStart: number }>(clips: T[]): T[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

