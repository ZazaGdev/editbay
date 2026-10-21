/**
 * What the timeline is given: the sequence, the selection, and what it tells
 * the window when something on it is pressed, dragged or edited.
 */

import type { ReactNode, RefObject } from 'react'
import type { SavedShape } from '../../../shared/shape'
import type { ShapePick } from '../ShapeMenu'
import type { Gap, Timeline as TimelineData, TrackKind } from '../../../shared/project'
import type { TransitionSide } from '../../../shared/transitions'
import type { TrackSize } from '../../../shared/timeline-layout'
import type { ClipEdit, PeaksData } from '../../../shared/types'
import type { Marker } from '../../../shared/markers'
import type { PlayheadStore } from '../../state/playheadStore'

export interface TimelineProps {
  timeline: TimelineData
  /**
   * The playhead, as a store rather than a frame: a tick of playback then
   * draws again only the line, the head and the timecode that follow it, never
   * the whole timeline (audit 2026-10-19, fix first 4). Read it with `get()`
   * in a handler.
   */
  playhead: PlayheadStore
  /** Whether the sequence is playing: the timeline then scrolls on a little before the playhead reaches its right edge. */
  playing?: boolean
  /** The selected clip and the clips linked to it, drawn selected together. */
  selectedIds: ReadonlySet<string>
  /** Whether the selected clip is selected on its own, without the clips linked to it. */
  selectedAlone: boolean
  /** A selected gap, drawn highlighted, which Delete closes. */
  selectedGap: Gap | null
  missingMedia: string[]
  rebuildingMedia: string[]
  revisions: Map<string, number>
  peaks: Map<string, PeaksData>
  /**
   * A clip clicked: with its linked clips, or on its own with Alt held. With
   * `add`, Shift held, it joins the selection or leaves it. Null clears the
   * selection.
   */
  onSelect: (clipId: string | null, alone: boolean, add?: boolean) => void
  /** The clips a box drawn over the timeline touched, with `add` for Shift held. */
  onSelectMany?: (clipIds: string[], add: boolean) => void
  /**
   * A press on a clip that turned out to be a click rather than a drag, which
   * narrows a selection of several to that clip. The playhead stays put.
   */
  onClickClip?: (clipId: string) => void
  onSelectGap: (gap: Gap) => void
  /** A right click on a gap, which is selected first: its menu, where the pointer is. */
  onGapMenu?: ((gap: Gap, at: { x: number; y: number }) => void) | undefined
  /** The selected caption, drawn selected. */
  selectedCaptionId: string | null
  onSelectCaption: (id: string) => void
  onSeek: (frame: number) => void
  /** The playhead is being dragged along the ruler, or has stopped being. */
  onScrubPlayhead?: (on: boolean) => void
  /** A marker's flag right-clicked on the ruler, for the menu on it. */
  onMarkerMenu?: (marker: Marker, at: { x: number; y: number }) => void
  /** The marker whose name is being typed on the ruler, or null. */
  renamingMarkerId?: string | null
  onRenameDone?: () => void
  /** `continuing` marks every movement of a drag after the first. */
  onEdit: (e: ClipEdit, continuing?: boolean) => void
  /** Which step of zoom, or a point between two, as Ctrl+wheel leaves it. */
  zoom: number
  onZoom: (delta: number) => void
  /** Ctrl+wheel: zoom to this, which may lie between two steps. */
  onZoomTo?: (zoom: number) => void
  /** Shown in place of the title: the sequence tabs. */
  header?: ReactNode
  /**
   * A source dragged from the bin and let go over a track, at a frame of the
   * timeline: with `insert` to open up the sequence for it, with `newTrack` onto
   * a track of that kind to make, named `trackId`.
   */
  onDropSource?: (mediaId: string, trackId: string, frame: number, opts: { insert: boolean; newTrack?: TrackKind }) => void
  /** A file from the effects folder let go over a track, at a frame (plan 90). */
  onDropEffect?: (path: string, trackId: string, frame: number, opts: { newTrack?: TrackKind }) => void
  /**
   * The pauses Remove silences found, shaded across every track while it is
   * open: to be taken out, kept by a click, or blocked, left in because taking
   * it out would push a clip out of step.
   */
  pauses?: { from: number; to: number; kept: boolean; blocked: boolean }[]
  /** A pause clicked: kept, or to be taken out again. */
  onTogglePause?: (from: number) => void
  /** The range marked with In and Out, `to` not included: shown on the ruler and tinted across the tracks. */
  range?: { from: number; to: number } | null
  /**
   * Open Remove silences, which finds the pauses and takes them out. It sits
   * here, with the other edits, rather than under the monitor, which is for
   * looking rather than cutting.
   */
  onRemoveSilences: () => void
  /** False while V1 has nothing on it to take pauses out of. */
  canRemoveSilences: boolean
  /** What a key does, for the tooltips, read from the keymap as it is set. */
  removeSilencesTitle: string
  /** Zoom so the whole edit is on screen at once, and go back to its start. */
  onFit: () => void
  /** What Fit's key is, read from the keymap as it is set. */
  fitTitle: string
  /** What the add-track buttons beside the tracks say on hover, with their keys (task 62). */
  addTrackTitles: { video: string; audio: string }
  /**
   * Whether the strip showing the whole edit is drawn at all. How you like the
   * window rather than anything about the cut, so it is kept with the window's
   * own settings and never goes through undo.
   */
  overview: boolean
  onOverview: (on: boolean) => void
  /** The picture chosen on the clip selected, whose zoom that clip's diamonds show. */
  picture?: string | undefined
  /** Whether zoom keyframes are marked on the clips. */
  showClipKeys?: boolean | undefined
  /** Whether drags on the timeline snap, and turning that off and on. */
  snapping: boolean
  onSnapping: (on: boolean) => void
  /** The snapping button's tooltip, with its key. */
  snapTitle?: string
  /** Words over the video at the playhead. */
  onAddText?: () => void
  /** A black screen at the playhead, for an end card. */
  onAddBlackScreen?: () => void
  /** The Shape menu beside Add text: the shapes to draw, and your saved styles. */
  shapes?: { saved: readonly SavedShape[]; onPick: (pick: ShapePick) => void; onRemoveSaved: (id: string) => void }
  /** How tall the tracks are drawn. Where you are, not an edit. */
  trackSize: TrackSize
  /** Step to the next size. */
  onTrackSize: () => void
  /** The audio tracks being listened to alone: renderer state, never saved. */
  solo: ReadonlySet<string>
  onSolo: (trackId: string, on: boolean) => void
  /** A clip right clicked: what it is and where to open its menu. */
  onClipMenu?: ((clipId: string, at: { x: number; y: number }) => void) | undefined
  /**
   * The transition picked out, by the clip it is stored on and which edge. The
   * one faded with it is picked out too unless `alone`, because a picture and
   * its sound are one transition to anyone looking at them.
   */
  selectedTransition?: { clipId: string; side: TransitionSide; alone?: boolean } | null | undefined
  onSelectTransition?: ((at: { clipId: string; side: TransitionSide; alone?: boolean } | null) => void) | undefined
  /** A transition right clicked: which one, and where to open its menu. */
  onTransitionMenu?: ((at: { clipId: string; side: TransitionSide }, where: { x: number; y: number }) => void) | undefined
  /**
   * The most the tracks area may take, once the divider above the timeline
   * has been dragged: as tall as the tracks up to that, scrolling when they
   * need more. Null is as tall as the tracks, up to 40% of the window.
   */
  tracksHeight?: number | null | undefined
  /** The tallest the tracks may be in this window, once measured. */
  tracksRoom?: number | null | undefined
  /** The format painter is armed: a press on a picture clip gives it the framing, and nothing else. */
  onPaint?: ((clipId: string) => void) | undefined
  /** A zoom keyframe's diamond on a clip dragged along it: that keyframe moved, in the clip's own frames. */
  onKeyframeMove?: ((clipId: string, picture: string, from: number, to: number) => void) | undefined
  /** An effect mark on a clip pressed: the Inspector section it is about, opened and brought into view. */
  onEffectMark?: ((section: string) => void) | undefined
  /** The tracks area, for the divider above the timeline to measure. */
  tracksBox?: RefObject<HTMLDivElement | null> | undefined
  /** How tall each track has been dragged to, by its id. Absent for one left as it was. */
  trackHeights?: Record<string, number> | undefined
  /** A track dragged taller or shorter by its bottom edge. Zero puts it back to its kind's height. */
  onTrackHeight?: ((trackId: string, px: number) => void) | undefined
  /** How long a transition dropped on a seam is, in frames: the length last used. */
  transitionFrames?: number | undefined
  /** The kinds the seam button adds, the last used for a picture and for a sound. */
  transitionKinds?: { picture: string; sound: string } | undefined
  /** Told the length a drag left a transition at, so the next one takes it. */
  onTransitionFrames?: ((frames: number) => void) | undefined
  /**
   * The frame of the sequence under the pointer while a clip is skimmed, and
   * null when it is not. The monitor shows it; the playhead stays where it is.
   */
  onSkim?: ((frame: number | null) => void) | undefined
}
