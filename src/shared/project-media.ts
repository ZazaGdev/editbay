/**
 * A project's sources: which of a source's fields edits set, its audio tracks and
 * their files, adding and replacing a source, taking one out, and its marks.
 */

import type { Span } from './tracks'
import type { ProjectMedia, TrackFile, Timeline, Project } from './project'
import { isStill, stillSpan } from './drawn-media'
import { mediaDurationFrames, clampToMedia, mapClips } from './timeline-query'

/**
 * Which of a source's fields edits set, and so Undo and Redo put back as the
 * snapshot had them, and which the app keeps up itself, the files it found
 * or made and what it read from them, which stay as they are now. Every field
 * is listed, so one added to `ProjectMedia` stops the build until it is
 * placed here. A text, a colour and a shape are their own edits, whole, and
 * are put back in their own way.
 */
export const MEDIA_OWNER: Record<keyof ProjectMedia, 'edit' | 'app'> = {
  id: 'app',
  originalPath: 'app',
  playablePath: 'app',
  conformed: 'app',
  conformReasons: 'app',
  durationSec: 'app',
  width: 'app',
  height: 'app',
  fps: 'app',
  codec: 'app',
  hasAudio: 'app',
  peaksPath: 'app',
  filmstripPath: 'app',
  audioTracks: 'app',
  trackNames: 'app',
  trackChannels: 'app',
  chapters: 'app',
  hasVideo: 'app',
  bt601: 'app',
  still: 'app',
  text: 'edit',
  colour: 'edit',
  shape: 'edit',
  frames: 'app',
  frameRate: 'app',
  once: 'app',
  soundCopy: 'app',
  cleaned: 'app',
  enhanced: 'app',
  care: 'edit',
  treated: 'app',
  startSec: 'app',
  trackFiles: 'app',
  copying: 'app',
  addedAt: 'app',
  markIn: 'edit',
  markOut: 'edit'
}

/**
 * A source as it is now, with what edits set on it as `then` had it: absent
 * where `then` had none, or where there is no `then` at all.
 */
export function withEditsOf(now: ProjectMedia, then: ProjectMedia | undefined): ProjectMedia {
  const out: Record<string, unknown> = { ...now }
  for (const [key, owner] of Object.entries(MEDIA_OWNER)) {
    if (owner !== 'edit') continue
    const was = then?.[key as keyof ProjectMedia]
    if (was === undefined) delete out[key]
    else out[key] = was
  }
  return out as unknown as ProjectMedia
}

/** How many audio tracks a source has that can play. None when it has no sound. */
export function trackCount(m: ProjectMedia): number {
  return m.hasAudio ? Math.max(1, m.audioTracks ?? 1) : 0
}

/**
 * The file one of a source's audio tracks plays from, and its waveform. The
 * first track is the playable file; the rest are their own copies. Null for a
 * track the source does not have, or whose copy was never made.
 */
export function trackFile(m: ProjectMedia, index: number): TrackFile | null {
  if (index < 0 || index >= trackCount(m)) return null
  if (index === 0) return { path: m.playablePath, peaksPath: m.peaksPath }
  return m.trackFiles?.[index - 1] ?? null
}

/**
 * Where one of a source's tracks keeps its waveform: its copy's, or, while
 * that copy is still being made, the one read from the recording ahead of it.
 * Null for a track it does not have.
 */
export function trackPeaks(m: ProjectMedia, index: number): string | null {
  if (index < 0 || index >= trackCount(m)) return null
  if (index === 0) return m.peaksPath
  return (m.trackFiles?.[index - 1] ?? m.copying?.[index - 1])?.peaksPath ?? null
}

/** What a track is called: its name in the file, or its number. */
export function trackName(m: ProjectMedia, index: number): string {
  const named = m.trackNames?.[index]?.trim()
  return named ? named : `Track ${index + 1}`
}

/**
 * Add or replace a source, in a timeline on its own.
 *
 * A replacement can be shorter than the one the clips were cut against, which
 * happens on relink and whenever a file is re-conformed, so every clip that
 * points at it is pulled back inside. Only their ends move, so none comes to
 * overlap another. A sound clip on a track its file no longer has, as after a
 * relink to a file with fewer, plays the first instead of nothing. One whose
 * track's copy is only missing, as while a cleared cache is rebuilt, keeps its
 * track: the copy comes back, and moving it would change what is heard.
 */
export function upsertTimelineMedia(p: Timeline, m: ProjectMedia): Timeline {
  const i = p.media.findIndex((x) => x.id === m.id)
  if (i < 0) return { ...p, media: [...p.media, m] }
  const media = [...p.media]
  media[i] = m
  const frames = mediaDurationFrames(m, p.fps)
  const inside = <T extends Span>(c: T): T => (c.mediaId === m.id ? clampToMedia(c, frames) : c)
  return mapClips(
    { ...p, media },
    inside,
    (c) => {
      const x = inside(c)
      return x.mediaId === m.id && x.track > 0 && x.track >= trackCount(m) ? { ...x, track: 0 } : x
    }
  )
}

/**
 * How many times a source is on the timeline, in every sequence. A picture
 * and the sound that came on with it count once, as they were put there once.
 */
export function clipsUsing(p: Project, mediaId: string): number {
  let n = 0
  for (const s of p.sequences) {
    const placed = new Set<string>()
    for (const track of [...s.videoTracks, ...s.audioTracks]) {
      for (const c of track.clips) if (c.mediaId === mediaId) placed.add(c.link ?? c.id)
    }
    n += placed.size
  }
  return n
}

/** The project without a source that no clip uses. Unchanged when a clip in any sequence still does. */
export function withoutMedia(p: Project, mediaId: string): Project {
  if (clipsUsing(p, mediaId) > 0 || !p.media.some((m) => m.id === mediaId)) return p
  return { ...p, media: p.media.filter((m) => m.id !== mediaId) }
}

/**
 * Add or replace a source of the project, and pull the clips back inside it
 * in every sequence, since they all share it.
 */
export function upsertMedia(p: Project, given: ProjectMedia): Project {
  const i = p.media.findIndex((x) => x.id === given.id)
  // When a source came in stays when it is described again, relinked or
  // rebuilt: it came in when it first did.
  const was = i < 0 ? undefined : p.media[i]!.addedAt
  const m = given.addedAt === undefined && was !== undefined ? { ...given, addedAt: was } : given
  const media = i < 0 ? [...p.media, m] : p.media.map((x, j) => (j === i ? m : x))
  if (i < 0) return { ...p, media }
  const sequences = p.sequences.map((s) => {
    const t = upsertTimelineMedia(
      {
        fps: p.fps,
        output: s.output,
        presetId: s.presetId,
        media: p.media,
        videoTracks: s.videoTracks,
        audioTracks: s.audioTracks,
        markers: s.markers,
        captions: s.captions
      },
      m
    )
    return { ...s, videoTracks: t.videoTracks, audioTracks: t.audioTracks }
  })
  return { ...p, media, sequences }
}

/**
 * How long a recording is, in frames at the project's rate. The length the
 * marks are measured against, and what a clip of the whole thing takes.
 */
/**
 * How many of a source's clips, a picture and its sound counting once, run
 * past `durationSec` and would be cut short by a file that long standing in
 * for it, in every sequence (audit 2026-10-01).
 */
export function clipsCutShort(p: Project, mediaId: string, durationSec: number): number {
  const frames = Math.max(1, Math.round(durationSec * p.fps))
  const cut = new Set<string>()
  for (const s of p.sequences) {
    for (const track of [...s.videoTracks, ...s.audioTracks]) {
      for (const c of track.clips) if (c.mediaId === mediaId && c.sourceOut > frames) cut.add(`${s.id}:${c.link ?? c.id}`)
    }
  }
  return cut.size
}

export function sourceFrames(m: ProjectMedia, fps: number): number {
  return Math.max(1, Math.round(m.durationSec * fps))
}

/**
 * The part of a recording worth having: what its marks say, or the whole of
 * it when neither is set. `to` is not included, and both are held inside the
 * recording, so a mark left behind by a shorter version of the same file
 * cannot ask for frames that are not there.
 */
export function markedSpan(m: ProjectMedia, fps: number): { from: number; to: number } {
  // A picture is never marked: it has nothing to choose between.
  if (isStill(m)) return stillSpan(m, fps)
  const length = sourceFrames(m, fps)
  const from = Math.max(0, Math.min(length - 1, Math.round(m.markIn ?? 0)))
  const to = Math.max(from + 1, Math.min(length, Math.round(m.markOut ?? length)))
  return { from, to }
}

/** Whether any part of a recording has been marked at all. */
export function isMarked(m: ProjectMedia): boolean {
  return m.markIn !== undefined || m.markOut !== undefined
}

/**
 * Mark a recording, or clear one of its marks with null. In at or after Out is
 * no span at all, so setting one past the other clears the other, exactly as
 * the sequence's own marks do.
 */
export function setSourceMarksOn(
  p: Project,
  mediaId: string,
  marks: { in?: number | null; out?: number | null }
): Project {
  const found = p.media.find((m) => m.id === mediaId)
  if (!found || isStill(found)) return p
  const length = sourceFrames(found, p.fps)
  const at = (value: number | null | undefined, was: number | undefined): number | undefined => {
    if (value === undefined) return was
    if (value === null) return undefined
    return Math.max(0, Math.min(length, Math.round(value)))
  }
  let markIn = at(marks.in, found.markIn)
  let markOut = at(marks.out, found.markOut)
  if (markIn !== undefined && markOut !== undefined && markOut <= markIn) {
    // The one just set stays; the other goes, since together they say nothing.
    if (marks.in !== undefined && marks.in !== null) markOut = undefined
    else markIn = undefined
  }
  const media = p.media.map((m) => {
    if (m.id !== mediaId) return m
    const { markIn: _in, markOut: _out, ...rest } = m
    return { ...rest, ...(markIn !== undefined ? { markIn } : {}), ...(markOut !== undefined ? { markOut } : {}) }
  })
  return { ...p, media }
}
