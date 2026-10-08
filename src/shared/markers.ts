import { newId } from './ids'
import { cleanMark } from './marks'

/**
 * Markers: a note left on a frame of the sequence, so a moment worth keeping
 * can be found again.
 *
 * A marker belongs to the sequence and not to a clip. It stays on its frame
 * when a clip under it moves, which is the behaviour that makes it useful for
 * "the good bit is about here" and the wrong one for "this clip needs a
 * reshoot". Clips carry `mark` for the second thing, from plan 24.
 *
 * All pure, so where a key lands you and what a stored file gives back are
 * tested without a window.
 */

/**
 * A chapter of a recording: where it starts, in the recording's own seconds,
 * and what it is called.
 *
 * OBS writes one of these for every press of its chapter hotkey while it
 * records, in its Hybrid MP4 format. They are the reason to have this type at
 * all: a moment flagged while playing is already a note when the file lands.
 */
export interface Chapter {
  atSec: number
  /** The title the file gives it, or '' where it gives none. */
  title: string
}

export interface Marker {
  id: string
  /** The frame of the sequence it sits on. Never below zero. */
  frame: number
  /** What it is called, empty until it is named. */
  name: string
  /** One of `CLIP_MARKS`, or absent for a marker of no particular colour. */
  colour?: string
}

/** Markers in the order they are drawn and jumped through: earliest first. */
export function inOrder(markers: readonly Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
}

/** The marker on a frame, or null. */
export function markerAt(markers: readonly Marker[], frame: number): Marker | null {
  return markers.find((m) => m.frame === frame) ?? null
}

/**
 * A marker added at `frame`.
 *
 * A frame that already has one is left alone rather than given a second. Two
 * markers on one frame cannot both be seen or both be reached, so the only
 * thing a second one does is sit under the first and surprise you later.
 */
export function addMarker(markers: readonly Marker[], frame: number, name = ''): Marker[] {
  const at = Math.max(0, Math.round(frame))
  if (markerAt(markers, at)) return [...markers]
  return inOrder([...markers, { id: newId(), frame: at, name }])
}

/** A marker moved to `frame`, or the list unchanged when another is already there. */
export function moveMarker(markers: readonly Marker[], id: string, frame: number): Marker[] {
  const at = Math.max(0, Math.round(frame))
  const here = markerAt(markers, at)
  if (here && here.id !== id) return [...markers]
  return inOrder(markers.map((m) => (m.id === id ? { ...m, frame: at } : m)))
}

/** A marker renamed. Whitespace at either end goes: a name of spaces is no name. */
export function renameMarker(markers: readonly Marker[], id: string, name: string): Marker[] {
  return markers.map((m) => (m.id === id ? { ...m, name: name.trim() } : m))
}

/** A marker recoloured, or its colour taken off when `colour` names none. */
export function colourMarker(markers: readonly Marker[], id: string, colour: unknown): Marker[] {
  const wanted = cleanMark(colour)
  return markers.map((m) => {
    if (m.id !== id) return m
    const { colour: _was, ...rest } = m
    return wanted === undefined ? rest : { ...rest, colour: wanted }
  })
}

export function removeMarker(markers: readonly Marker[], id: string): Marker[] {
  return markers.filter((m) => m.id !== id)
}

/**
 * The first marker after `frame`, or null when there is none.
 *
 * Strictly after, so pressing the key again from where it just left you goes
 * on to the next one rather than standing still.
 */
export function nextMarker(markers: readonly Marker[], frame: number): Marker | null {
  return inOrder(markers).find((m) => m.frame > frame) ?? null
}

/** The last marker before `frame`, or null. Strictly before, for the same reason. */
export function previousMarker(markers: readonly Marker[], frame: number): Marker | null {
  const before = inOrder(markers).filter((m) => m.frame < frame)
  return before[before.length - 1] ?? null
}

/**
 * A stored list of markers made safe for the project it was stored with.
 *
 * Anything that is not a marker is dropped rather than throwing. Markers are a
 * convenience: a damaged one must cost its own note and nothing else, where a
 * damaged caption stops the project opening because a caption is content.
 */
export function cleanMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: Marker[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const m = item as Record<string, unknown>
    if (typeof m.frame !== 'number' || !Number.isFinite(m.frame)) continue
    const frame = Math.max(0, Math.round(m.frame))
    // One per frame, as adding them enforces: a file edited by hand does not
    // get to break the rule the app keeps.
    if (seen.has(frame)) continue
    seen.add(frame)
    const colour = cleanMark(m.colour)
    out.push({
      id: typeof m.id === 'string' && m.id !== '' ? m.id : newId(),
      frame,
      name: typeof m.name === 'string' ? m.name.trim() : '',
      ...(colour === undefined ? {} : { colour })
    })
  }
  return inOrder(out)
}

/** A clip of a recording, as turning its chapters into markers needs it. */
export interface ChapterPlacement {
  /** The first frame of the recording this clip shows. */
  sourceIn: number
  /** One past the last frame of the recording it shows. */
  sourceOut: number
  /** Where that first frame sits in the sequence. */
  timelineStart: number
}

/**
 * A recording's chapters as markers of the sequence, added to the markers it
 * already has.
 *
 * A chapter is a moment in the recording; a marker is a frame of the sequence.
 * The two are the same thing only when the whole recording is on the timeline
 * once, from its start, which after any cutting it is not. So each chapter is
 * placed through every clip of that recording: one used twice gives two
 * markers, and one whose chapter has been cut out gives none.
 *
 * `startSec` is where the recording's own time begins as ffmpeg counts it,
 * which is not always zero, and a chapter's seconds are on that same clock.
 * Ignoring it puts every marker a few frames out on a file whose sound starts
 * before its picture, which is most of them.
 *
 * A frame that already has a marker keeps the one it has, so bringing the same
 * chapters in twice changes nothing the second time.
 */
export function chapterMarkers(
  markers: readonly Marker[],
  chapters: readonly Chapter[],
  clips: readonly ChapterPlacement[],
  fps: number,
  startSec = 0
): Marker[] {
  if (!(fps > 0)) return [...markers]
  let out = [...markers]
  for (const chapter of [...chapters].sort((a, b) => a.atSec - b.atSec)) {
    const inSource = Math.round((chapter.atSec - startSec) * fps)
    for (const clip of clips) {
      if (inSource < clip.sourceIn || inSource >= clip.sourceOut) continue
      out = addMarker(out, clip.timelineStart + (inSource - clip.sourceIn), chapter.title)
    }
  }
  return inOrder(out)
}
