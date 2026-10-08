/**
 * A project's sequences: making a project and its first timeline, adding,
 * copying, renaming and removing a sequence, its marks, its output shape, and its
 * markers.
 */

import { newId } from './ids'
import { PRESETS, presetById } from './presets'
import {
  type Marker, addMarker as addMarkerTo, moveMarker as moveMarkerIn, renameMarker as renameMarkerIn,
  colourMarker as colourMarkerIn, removeMarker as removeMarkerFrom, cleanMarkers
} from './markers'
import { type Span, isHidden } from './tracks'
import { type Captions, emptyCaptions } from './captions'
import { V1_ID, A1_ID, DEFAULT_PRESET_ID, SCHEMA_VERSION, FIRST_SEQUENCE_ID } from './project-core'
import type { VideoTrack, AudioTrack, Project, Timeline, Sequence, SequenceMarks } from './project'
import { mapClips, mediaOf } from './timeline-query'
import type { Framing } from './zoom-keys'
import { setFramingOn, relaidOut } from './framing-layouts'

/** The tracks a sequence starts with: an empty V1 and an empty A1, no captions and no markers. */
function emptyTracks(): { videoTracks: VideoTrack[]; audioTracks: AudioTrack[]; captions: Captions; markers: Marker[] } {
  return {
    videoTracks: [{ id: V1_ID, clips: [] }],
    audioTracks: [{ id: A1_ID, clips: [] }],
    captions: emptyCaptions(),
    markers: []
  }
}

/** What a sequence in this shape is called until you rename it. */
export function shapeName(presetId: string): string {
  return PRESETS.find((x) => x.id === presetId)?.name ?? 'Sequence'
}

/** The size a sequence in this shape renders at, or `fallback` for a shape with none. */
export function outputFor(presetId: string, fallback: { width: number; height: number }): { width: number; height: number } {
  const preset = PRESETS.find((x) => x.id === presetId)
  return preset && preset.width !== null && preset.height !== null
    ? { width: preset.width, height: preset.height }
    : fallback
}

/** An empty project holding one empty sequence. */
export function createProject(
  name: string,
  fps: number,
  output: { width: number; height: number },
  presetId: string = DEFAULT_PRESET_ID
): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    fps,
    media: [],
    sequences: [
      {
        id: FIRST_SEQUENCE_ID,
        name: shapeName(presetId),
        nameFollowsShape: true,
        presetId,
        output,
        ...emptyTracks()
      }
    ]
  }
}

/** An empty timeline with no sources, for building one up piece by piece. */
export function createTimeline(
  fps: number,
  output: { width: number; height: number },
  presetId: string = DEFAULT_PRESET_ID
): Timeline {
  return { fps, output, presetId, media: [], ...emptyTracks() }
}

/** A sequence, or the first one when there is no sequence by that id. */
export function sequenceOf(p: Project, sequenceId: string): Sequence {
  const found = p.sequences.find((s) => s.id === sequenceId) ?? p.sequences[0]
  if (!found) throw new Error('a project always has a sequence')
  return found
}

/** One sequence seen as a timeline. The first one when there is no sequence by that id. */
export function timelineOf(p: Project, sequenceId: string): Timeline {
  const s = sequenceOf(p, sequenceId)
  return {
    fps: p.fps,
    output: s.output,
    presetId: s.presetId,
    media: p.media,
    videoTracks: s.videoTracks,
    audioTracks: s.audioTracks,
    captions: s.captions,
    markers: s.markers,
    ...(s.marks ? { marks: s.marks } : {})
  }
}

/**
 * Write a timeline back into its sequence. Only the tracks, the captions and
 * the shape: the sources are the project's, and a clip edit never changes them.
 */
export function withTimeline(p: Project, sequenceId: string, t: Timeline): Project {
  return {
    ...p,
    sequences: p.sequences.map((s) =>
      s.id === sequenceId
        ? {
            ...withoutMarks(s),
            videoTracks: t.videoTracks,
            audioTracks: t.audioTracks,
            captions: t.captions,
            markers: t.markers,
            presetId: t.presetId,
            output: t.output,
            ...(t.marks ? { marks: t.marks } : {})
          }
        : s
    )
  }
}

function withoutMarks<T extends { marks?: SequenceMarks }>(x: T): Omit<T, 'marks'> {
  const { marks: _marks, ...rest } = x
  return rest
}

/** The range marked on a sequence, each end null when it is not marked. */
export function marksOf(t: Timeline): { in: number | null; out: number | null } {
  return { in: t.marks?.in ?? null, out: t.marks?.out ?? null }
}

/**
 * Mark a range on a sequence: set either end, or clear it with null, and an
 * end left out stays as it is. Worked out against the document as it is when
 * the edit arrives, so In and Out pressed in quick succession both land. Whole
 * frames, not before the start. An end set at or past the other makes no
 * range, so the other one goes; both set that way, Out goes. The same
 * timeline back when nothing changes.
 */
export function setSequenceMarks(t: Timeline, marks: { in?: number | null; out?: number | null }): Timeline {
  const frame = (n: number | null | undefined, was: number | undefined): number | undefined =>
    n === undefined ? was : n === null || !Number.isFinite(n) ? undefined : Math.max(0, Math.round(n))
  let markIn = frame(marks.in, t.marks?.in)
  let markOut = frame(marks.out, t.marks?.out)
  if (markIn !== undefined && markOut !== undefined && markOut <= markIn) {
    if (marks.in !== undefined) markOut = undefined
    else markIn = undefined
  }
  if (markIn === t.marks?.in && markOut === t.marks?.out) return t
  const rest = withoutMarks(t)
  if (markIn === undefined && markOut === undefined) return rest
  return { ...rest, marks: { ...(markIn !== undefined ? { in: markIn } : {}), ...(markOut !== undefined ? { out: markOut } : {}) } }
}

/**
 * Apply a clip edit to one sequence. An edit for a sequence that has gone does
 * nothing: falling back to another would apply it where nobody asked.
 */
export function editSequence(p: Project, sequenceId: string, edit: (t: Timeline) => Timeline): Project {
  if (!p.sequences.some((s) => s.id === sequenceId)) return p
  return withTimeline(p, sequenceId, edit(timelineOf(p, sequenceId)))
}

/** `base`, or `base 2`, `base 3` and so on: the first no other sequence is called. */
export function uniqueSequenceName(p: Project, base: string, exceptId?: string): string {
  const taken = new Set(p.sequences.filter((s) => s.id !== exceptId).map((s) => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/** An empty sequence in a shape, named after it, placed last. */
export function addSequence(p: Project, id: string, presetId: string): Project {
  if (p.sequences.some((s) => s.id === id)) return p
  const shape = PRESETS.some((x) => x.id === presetId) ? presetId : DEFAULT_PRESET_ID
  const sequence: Sequence = {
    id,
    name: uniqueSequenceName(p, shapeName(shape)),
    nameFollowsShape: true,
    presetId: shape,
    output: outputFor(shape, sequenceOf(p, FIRST_SEQUENCE_ID).output),
    ...emptyTracks()
  }
  return { ...p, sequences: [...p.sequences, sequence] }
}

/**
 * A copy of a sequence, placed after it. Its clips and captions are new ones
 * with new ids, so from here on trimming one never trims the other, and its
 * linked clips are linked to each other with links of their own.
 */
export function duplicateSequence(p: Project, sequenceId: string, id: string): Project {
  const source = p.sequences.find((s) => s.id === sequenceId)
  if (!source || p.sequences.some((s) => s.id === id)) return p
  const base = source.nameFollowsShape ? shapeName(source.presetId) : source.name
  const links = new Map<string, string>()
  const relink = <T extends Span>(c: T): T => {
    if (c.link === undefined) return { ...c, id: newId() }
    let link = links.get(c.link)
    if (link === undefined) {
      link = newId()
      links.set(c.link, link)
    }
    return { ...c, id: newId(), link }
  }
  const copy: Sequence = {
    ...source,
    id,
    name: uniqueSequenceName(p, base),
    videoTracks: source.videoTracks.map((r) => ({ ...r, clips: r.clips.map(relink) })),
    audioTracks: source.audioTracks.map((r) => ({ ...r, clips: r.clips.map(relink) })),
    captions: { ...source.captions, clips: source.captions.clips.map((c) => ({ ...c, id: newId() })) }
  }
  const at = p.sequences.indexOf(source) + 1
  return { ...p, sequences: [...p.sequences.slice(0, at), copy, ...p.sequences.slice(at)] }
}

/** The longest a project's name may be. Long enough for a sentence, short enough for a title bar. */
export const MAX_PROJECT_NAME = 64
/** What a project is called until it is given a name. */
export const UNTITLED = 'Untitled'

/**
 * A typed project name made fit to store: the spaces tidied and the length
 * held. Null for one that comes out empty, because a name cleared is not a
 * name and the project keeps the one it had.
 *
 * Nothing is taken out for the sake of a filename. The export is named after
 * this and runs it through `sanitiseFilename`, so a colon here is already
 * safe, and refusing one would be refusing a perfectly good title.
 */
export function cleanProjectName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_NAME).trim()
  return name === '' ? null : name
}

/**
 * Name a sequence yourself. From then on its name no longer follows its shape.
 * Its own name again, or an empty one, changes nothing. A name another
 * sequence has is numbered, since joined exports are named after it.
 */
export function renameSequence(p: Project, sequenceId: string, name: string): Project {
  const trimmed = name.trim()
  const current = p.sequences.find((s) => s.id === sequenceId)
  if (!current || trimmed === '' || trimmed === current.name) return p
  const unique = uniqueSequenceName(p, trimmed, sequenceId)
  return {
    ...p,
    sequences: p.sequences.map((s) => (s.id === sequenceId ? { ...s, name: unique, nameFollowsShape: false } : s))
  }
}

/** Take a sequence away. The last one stays: a project always has one. */
export function removeSequence(p: Project, sequenceId: string): Project {
  if (p.sequences.length <= 1) return p
  return { ...p, sequences: p.sequences.filter((s) => s.id !== sequenceId) }
}

/**
 * Change one sequence's shape, reshaping its crops, and let its name follow
 * when it still carries its shape's name.
 */
export function setSequenceShape(p: Project, sequenceId: string, presetId: string): Project {
  if (!p.sequences.some((s) => s.id === sequenceId)) return p
  const next = editSequence(p, sequenceId, (t) => setShape(t, presetId))
  return {
    ...next,
    sequences: next.sequences.map((s) =>
      s.id === sequenceId && s.nameFollowsShape
        ? { ...s, name: uniqueSequenceName(next, shapeName(presetId), s.id) }
        : s
    )
  }
}

/**
 * A saved setup: the sequence changed to its shape, then its framing given to
 * the clips named. One edit, so one undo puts the shape and every crop back.
 */
export function applySetup(p: Project, sequenceId: string, presetId: string, clipIds: readonly string[], framing: Framing): Project {
  if (!PRESETS.some((x) => x.id === presetId)) return p
  const shaped = setSequenceShape(p, sequenceId, presetId)
  return editSequence(shaped, sequenceId, (t) => setFramingOn(t, clipIds, framing))
}

/**
 * Width over height of the timeline's output shape, or null when it has none.
 * The handoff preset has none: it keeps each clip's crop exactly as drawn.
 */
export function targetAspect(p: Timeline): number | null {
  const preset = PRESETS.find((x) => x.id === p.presetId)
  if (!preset || preset.width === null || preset.height === null) return null
  return preset.width / preset.height
}

/**
 * The video tracks whose pictures are seen, lowest first: every one that is
 * not hidden, or, without a frame to place pictures in as under Handoff, V1
 * alone, so a hidden V1 leaves black rather than promoting V2 into a frame
 * that was never laid out for it. The one rule the preview and the export
 * both draw by (audit 2026-10-01), where each used to write its own.
 */
export function shownTracks(p: Timeline, framed = targetAspect(p) !== null): VideoTrack[] {
  return (framed ? p.videoTracks : p.videoTracks.slice(0, 1)).filter((r) => !isHidden(r))
}

/**
 * Change the output shape, and lay every clip on every video track out again
 * for the new frame, reshaping each crop around the point it was framing. One
 * edit, so a single undo puts every crop back.
 *
 * Handoff has no size, so nothing is laid out for it: the clips keep their
 * pictures, and changing back to a shape with a size lays them out from the
 * frame they had before.
 */
export function setShape(p: Timeline, presetId: string): Timeline {
  const preset = presetById(presetId)
  const output =
    preset.width !== null && preset.height !== null ? { width: preset.width, height: preset.height } : p.output
  const next: Timeline = { ...p, presetId, output }
  if (targetAspect(next) === null) return next
  const { width: oldW, height: oldH } = p.output
  return mapClips(
    next,
    (c) => relaidOut(c, mediaOf(next, c.mediaId), oldW, oldH, output.width, output.height),
    (c) => c
  )
}


/**
 * Markers of a sequence. Each one is the pure list function of `markers.ts`
 * applied to the timeline, so the rules about one marker per frame live in one
 * place and every way of reaching them obeys the same ones.
 */
export function addMarkerAt(t: Timeline, frame: number, name = ''): Timeline {
  return { ...t, markers: addMarkerTo(t.markers, frame, name) }
}

export function moveMarker(t: Timeline, markerId: string, frame: number): Timeline {
  return { ...t, markers: moveMarkerIn(t.markers, markerId, frame) }
}

export function renameMarker(t: Timeline, markerId: string, name: string): Timeline {
  return { ...t, markers: renameMarkerIn(t.markers, markerId, name) }
}

export function colourMarker(t: Timeline, markerId: string, colour: string | null): Timeline {
  return { ...t, markers: colourMarkerIn(t.markers, markerId, colour) }
}

export function removeMarker(t: Timeline, markerId: string): Timeline {
  return { ...t, markers: removeMarkerFrom(t.markers, markerId) }
}

/** Every marker replaced at once, made safe on the way in as a stored list is. */
export function setMarkers(t: Timeline, markers: Marker[]): Timeline {
  return { ...t, markers: cleanMarkers(markers) }
}
