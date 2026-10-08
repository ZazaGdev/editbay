import { BLACK_SCREEN, findClip, trackCount, trackName, type Clip, type ProjectMedia, type SoundClip, type Timeline } from './project'
import { textName } from './text'
import { shapeName } from './shape'

/**
 * What a clip is called on the timeline. Pure, so which cut of a recording a
 * clip is does not have to be worked out in the middle of drawing one.
 *
 * Three cuts of the same take look identical today, which is the whole reason
 * this exists: the name alone does not tell you which one you are on.
 */

/** The file's own name, without the folders it sits in. */
export function sourceName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** What a source is called: its file's name, for a text its words, and for a plain colour what it is. */
export function mediaName(m: Pick<ProjectMedia, 'originalPath' | 'text' | 'colour' | 'shape'>): string {
  if (m.colour) return m.colour === BLACK_SCREEN ? 'Black screen' : `Colour ${m.colour}`
  if (m.shape) return shapeName(m.shape)
  return m.text ? textName(m.text) : sourceName(m.originalPath)
}

/**
 * Which cut of its recording a clip is, counting the clips of the same source
 * on the same track from the start of the sequence, from 1. Null when it is
 * the only one there, since "cut 1 of 1" says nothing.
 *
 * Counted per track rather than across the sequence: a talking head on V1 and
 * the same recording used as a cutaway on V2 are two rows of cuts, not one
 * muddled run, and each is numbered the way it reads down its own track.
 */
export function cutNumber(t: Timeline, clipId: string): number | null {
  const found = findClip(t, clipId)
  if (!found) return null
  const same = (found.track.clips as (Clip | SoundClip)[])
    .filter((c) => c.mediaId === found.clip.mediaId)
    .sort((a, b) => a.timelineStart - b.timelineStart)
  if (same.length < 2) return null
  const at = same.findIndex((c) => c.id === clipId)
  return at < 0 ? null : at + 1
}

/**
 * What a clip's name strip says: its source, which cut of it, and for a sound
 * clip of a recording with several streams, which stream it plays.
 */
export function clipLabel(t: Timeline, clipId: string): string {
  const found = findClip(t, clipId)
  if (!found) return ''
  const media = t.media.find((m) => m.id === found.clip.mediaId)
  if (!media) return ''
  const parts = [mediaName(media)]
  if (found.kind === 'audio' && trackCount(media) > 1) parts.push(trackName(media, (found.clip as SoundClip).track))
  const cut = cutNumber(t, clipId)
  if (cut !== null) parts.push(`cut ${cut}`)
  return parts.join(' · ')
}

/**
 * What every clip of the sequence is called, by id: the same words
 * `clipLabel` gives one clip, worked out in one pass. The timeline draws every
 * clip on every render, and asking `clipLabel` for each one searched the whole
 * sequence for it and sorted its track again, clip after clip.
 */
export function clipLabels(t: Timeline): Map<string, string> {
  const media = new Map(t.media.map((m) => [m.id, m] as const))
  const out = new Map<string, string>()
  const tracks = [
    ...t.videoTracks.map((r) => ({ kind: 'video' as const, clips: r.clips as (Clip | SoundClip)[] })),
    ...t.audioTracks.map((r) => ({ kind: 'audio' as const, clips: r.clips as (Clip | SoundClip)[] }))
  ]
  for (const track of tracks) {
    // Which cut each clip is, counted per source along its own track, as `cutNumber` counts.
    const bySource = new Map<string, (Clip | SoundClip)[]>()
    for (const c of track.clips) bySource.set(c.mediaId, [...(bySource.get(c.mediaId) ?? []), c])
    const cuts = new Map<string, number>()
    for (const same of bySource.values()) {
      if (same.length < 2) continue
      // A stable sort, as `cutNumber`'s is, so two clips at one frame keep the order they are stored in.
      same.sort((a, b) => a.timelineStart - b.timelineStart).forEach((c, i) => cuts.set(c.id, i + 1))
    }
    for (const c of track.clips) {
      // A clip whose source is gone keeps the first clip of that id the
      // sequence holds, as `findClip` would find it.
      if (out.has(c.id)) continue
      const m = media.get(c.mediaId)
      if (!m) {
        out.set(c.id, '')
        continue
      }
      const parts = [mediaName(m)]
      if (track.kind === 'audio' && trackCount(m) > 1) parts.push(trackName(m, (c as SoundClip).track))
      const cut = cuts.get(c.id)
      if (cut !== undefined) parts.push(`cut ${cut}`)
      out.set(c.id, parts.join(' · '))
    }
  }
  return out
}

/**
 * What a track carries, for its header: the recording its clips come from
 * when they agree, and what kind of track it is when they do not or when it
 * is empty.
 *
 * The name of the source is worth more than the word "picture" on a track
 * that holds one take, and the word is worth more than the first of five
 * names on a track that holds five.
 */
export function whatTrackCarries(t: Timeline, trackId: string): string {
  const track = [...t.videoTracks, ...t.audioTracks].find((r) => r.id === trackId)
  const kind = t.videoTracks.some((r) => r.id === trackId) ? 'picture' : 'sound'
  if (!track || track.clips.length === 0) return kind
  const sources = new Set((track.clips as (Clip | SoundClip)[]).map((c) => c.mediaId))
  if (sources.size !== 1) return kind
  const media = t.media.find((m) => m.id === [...sources][0])
  return media ? mediaName(media) : kind
}
