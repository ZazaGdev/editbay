import { FIRST_SEQUENCE_ID, allClips, timelineDuration, timelineOf, type Project, type Timeline } from './project'
import { ZOOM_LEVELS, DEFAULT_ZOOM, DEFAULT_TRACK_SIZE, heldTrackHeight, isTrackSize, type TrackSize } from './timeline-layout'

/**
 * Where you are in a project, as opposed to what the project is.
 *
 * None of this is an edit: moving the playhead or zooming never marks the
 * project changed and never goes through undo. It is saved alongside the
 * project so that reopening it puts you back where you were.
 */

export type WorkspaceView = 'source' | 'program'
export type ExportMode = 'join' | 'batch'

/**
 * What belongs to a timeline. Kept apart from the rest so that when a project
 * holds several timelines, this block becomes one per timeline and nothing
 * else in the file moves.
 */
export interface TimelineWorkspace {
  playhead: number
  selectedClipId: string | null
  zoom: number
  view: WorkspaceView
  /**
   * How tall each track has been dragged to, by its id, for the tracks that
   * have been. Everything else takes the height its kind gets from the size
   * control.
   *
   * Here and not on the track itself, because it is how you are looking at the
   * sequence rather than a decision about the edit: it never goes through undo,
   * and a locked track can still be made taller to read its waveform.
   */
  trackHeights: Record<string, number>
}

export interface ExportSettings {
  folder: string | null
  mode: ExportMode
  filenamePattern: string
  /** Whether a joined export also writes its captions beside it as a subtitle file. */
  subtitleFile: boolean
  /** Whether a joined export also writes every word of its captions beside it as a text file. */
  transcriptFile: boolean
  /** Whether an export sharpens the picture a little. */
  sharpen: boolean
  /** Whether an export is encoded on the graphics card, where it can be. */
  fast: boolean
  /** The name typed for a sequence's one video, by the sequence's id, for those given one. */
  fileNames: Record<string, string>
}

export interface Workspace {
  /** The sequence on screen. Where you are, not an edit: switching never marks the project changed. */
  activeSequenceId: string
  /** Where you are in each sequence, by its id. One with no entry starts at the beginning. */
  timelines: Record<string, TimelineWorkspace>
  aspectLocked: boolean
  /**
   * How tall the timeline's tracks are drawn. Where you are, not an edit: it
   * belongs to the window rather than to the cut, and it never goes through
   * undo.
   */
  trackSize: TrackSize
  /**
   * How loud the preview is played, 0 to 1. Listening, not editing: it changes
   * what comes out of the speakers and nothing that is exported, so it belongs
   * to the window like `trackSize` and never goes through undo.
   *
   * It only ever turns the preview down. A clip set above 100% is made louder
   * by `PreviewLoudness`, which is a different thing entirely.
   */
  monitorVolume: number
  export: ExportSettings
}

export const DEFAULT_FILENAME_PATTERN = '{project}_{index}_{clip}'

/** Where a sequence you have not been in yet starts. */
export function defaultTimelineWorkspace(): TimelineWorkspace {
  return { playhead: 0, selectedClipId: null, zoom: DEFAULT_ZOOM, view: 'source', trackHeights: {} }
}

/** What the app starts with, and what a project saved before the workspace existed gets. */
export function defaultWorkspace(activeSequenceId: string = FIRST_SEQUENCE_ID): Workspace {
  return {
    activeSequenceId,
    timelines: {},
    aspectLocked: true,
    trackSize: DEFAULT_TRACK_SIZE,
    monitorVolume: 1,
    export: { folder: null, mode: 'join', filenamePattern: DEFAULT_FILENAME_PATTERN, subtitleFile: false, transcriptFile: false, sharpen: false, fast: false, fileNames: {} }
  }
}

/** Where you are in one sequence. */
export function timelineWorkspaceOf(ws: Workspace, sequenceId: string): TimelineWorkspace {
  return ws.timelines[sequenceId] ?? defaultTimelineWorkspace()
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

/**
 * A stored workspace, made safe for the project it was stored with.
 *
 * Every field is checked on its own, so one that is wrong or out of date, such
 * as a selected clip that has since been deleted, falls back to its default
 * and takes nothing else with it. Nothing here ever throws: a workspace is a
 * convenience, and it must never stop a project from opening.
 */
export function cleanWorkspace(raw: unknown, project: Project): Workspace {
  const d = defaultWorkspace()
  const r = record(raw)
  const stored = record(r.timelines)
  const e = record(r.export)

  const first = project.sequences[0]?.id ?? FIRST_SEQUENCE_ID
  const active =
    typeof r.activeSequenceId === 'string' && project.sequences.some((s) => s.id === r.activeSequenceId)
      ? r.activeSequenceId
      : first

  // Only sequences that exist, and only where something was stored: a
  // sequence that has since been removed takes its place with it.
  const timelines: Record<string, TimelineWorkspace> = {}
  for (const s of project.sequences) {
    if (typeof stored[s.id] === 'object' && stored[s.id] !== null) {
      timelines[s.id] = cleanTimelineWorkspace(stored[s.id], timelineOf(project, s.id))
    }
  }

  return {
    activeSequenceId: active,
    timelines,
    aspectLocked: typeof r.aspectLocked === 'boolean' ? r.aspectLocked : d.aspectLocked,
    trackSize: isTrackSize(r.trackSize) ? r.trackSize : d.trackSize,
    monitorVolume:
      typeof r.monitorVolume === 'number' && Number.isFinite(r.monitorVolume)
        ? Math.min(1, Math.max(0, r.monitorVolume))
        : d.monitorVolume,
    export: {
      folder: typeof e.folder === 'string' && e.folder !== '' ? e.folder : d.export.folder,
      mode: e.mode === 'join' || e.mode === 'batch' ? e.mode : d.export.mode,
      filenamePattern:
        typeof e.filenamePattern === 'string' && e.filenamePattern.trim() !== ''
          ? e.filenamePattern
          : d.export.filenamePattern,
      subtitleFile: typeof e.subtitleFile === 'boolean' ? e.subtitleFile : d.export.subtitleFile,
      transcriptFile: typeof e.transcriptFile === 'boolean' ? e.transcriptFile : d.export.transcriptFile,
      sharpen: typeof e.sharpen === 'boolean' ? e.sharpen : d.export.sharpen,
      fast: typeof e.fast === 'boolean' ? e.fast : d.export.fast,
      fileNames:
        typeof e.fileNames === 'object' && e.fileNames !== null
          ? Object.fromEntries(Object.entries(e.fileNames as Record<string, unknown>).filter((x): x is [string, string] => typeof x[1] === 'string' && x[1].trim() !== ''))
          : d.export.fileNames
    }
  }
}

/** Where you are in one timeline, made safe for that timeline. Field by field, and never throws. */
export function cleanTimelineWorkspace(raw: unknown, timeline: Timeline): TimelineWorkspace {
  const d = defaultTimelineWorkspace()
  const t = record(raw)
  const total = timelineDuration(timeline)
  const playhead = wholeNumber(t.playhead)
  // A fraction of a step is kept: Ctrl+wheel zooms between the steps.
  const zoom = typeof t.zoom === 'number' && Number.isFinite(t.zoom) ? t.zoom : null
  const selected = typeof t.selectedClipId === 'string' ? t.selectedClipId : null
  return {
    playhead: playhead === null ? d.playhead : Math.max(0, Math.min(total, playhead)),
    selectedClipId: selected !== null && allClips(timeline).some((c) => c.id === selected) ? selected : null,
    zoom: zoom !== null && zoom >= 0 && zoom <= ZOOM_LEVELS - 1 ? zoom : d.zoom,
    view: t.view === 'source' || t.view === 'program' ? t.view : d.view,
    trackHeights: cleanTrackHeights(t.trackHeights, timeline)
  }
}

/** The heights stored for tracks that are still there, each held between the two ends. */
function cleanTrackHeights(raw: unknown, timeline: Timeline): Record<string, number> {
  const stored = record(raw)
  const out: Record<string, number> = {}
  for (const track of [...timeline.videoTracks, ...timeline.audioTracks]) {
    const px = stored[track.id]
    if (typeof px === 'number' && Number.isFinite(px)) out[track.id] = heldTrackHeight(px)
  }
  return out
}
