/**
 * What the monitor is given: the view it shows, the sequence and the playhead,
 * and what it is told to do when a picture, a crop, a caption or a text is edited on it.
 */

import type { ReactNode } from 'react'
import type { Point, ShapeStyle } from '../../../shared/shape'
import type { Stretch } from '../../../shared/silences'
import type { Rect, Timeline } from '../../../shared/project'
import type { ClipEdit } from '../../../shared/types'
import type { Place } from '../../../shared/layout'
import type { BlurBox } from '../../../shared/blur'
import type { SafeZoneChoice } from '../../../shared/safe-zones'
import type { CaptionAt } from '../../../shared/captions'

export type MonitorView = 'source' | 'program'

export type MonitorProps = {
  timeline: Timeline
  playhead: number
  /** The view shown, or with both side by side, the one the keys and the nudges act on. */
  view: MonitorView
  /** Both views side by side when the frame is taller than wide, as the window setting says. */
  sideBySide: boolean
  /** A press in one of two views side by side makes it the one the keys act on. */
  onView: (view: MonitorView) => void
  aspectLocked: boolean
  playing: boolean
  /** The picture being edited: the main one, or a layer's id. */
  picture: string
  /** Whether the chosen picture's End is chosen, for a Simple zoom. */
  zoomEnd?: boolean | undefined
  /** The selected clip: when it is a picture under the playhead, on any track, it is the one edited. */
  selectedClipId: string | null
  /**
   * The timeline the crop box and the picture's handles read: the same, but
   * with a group of clips as one clip spanning it (plan 80). Playback reads
   * `timeline`.
   */
  framing?: Timeline
  onPositionChange: (frame: number) => void
  onEnded: () => void
  /** Where the sequence is and when, as playback starts and settles: a voice over lines up with it. */
  onClock?: (sec: number, at: number) => void
  /** The whole sequence silent, while a voice over records. */
  muted?: boolean
  /** The audio tracks listened to alone, empty when every one is heard. */
  solo?: readonly string[]
  /** How loud the preview plays, 0 to 1. What comes out of the speakers, never what is exported. */
  monitorVolume?: number
  /** Lighter copies to play in place of the recordings, by the recording's id. */
  proxies?: ReadonlyMap<string, string>
  /** Where the voice is, which a track that ducks comes down under in the preview. */
  voice?: readonly Stretch[]
  /**
   * The playhead is being dragged along the ruler. While it is, every move of
   * it is heard as well as seen.
   */
  scrubbing?: boolean
  /** How fast playing goes, and which way: 1 as recorded, below 0 backwards. */
  rate?: number
  /** Frames played over and over, or null. */
  loop?: { from: number; to: number } | null
  /** On the clock on the wall, the picture held to it, while a voice over records. */
  wallClock?: boolean
  /** Lines and shading over the Output view, or null for none. */
  guides: { thirds: boolean; safeZone: SafeZoneChoice; cover?: boolean } | null
  /** The monitor on the whole screen. Escape, or F again, leaves. */
  fullscreen: boolean
  /** Told when full screen ends on its own, as when Escape is pressed. */
  onFullscreenChange: (on: boolean) => void
  /**
   * A frame of the sequence looked at without going there: the timeline
   * skimmed under the pointer. The playhead does not move, and letting go
   * puts the picture back on it.
   */
  skim?: number | null
  /** Shown instead of the picture while the project has no sources: how to start. */
  welcome?: ReactNode
  /**
   * The caption on screen can be moved: on its own, after a double click, or
   * with every caption that follows the style, while Relocate is on.
   */
  captionMode?: 'one' | 'all' | null
  onCaptionPress?: (captionId: string) => void
  onCaptionMoveOne?: (captionId: string) => void
  /** While Relocate is on, whether captions placed by hand move with the rest. */
  relocateHandPlaced?: boolean | undefined
  onCaptionDrag?: (at: CaptionAt, continuing: boolean) => void
  /** What the monitor says while the sequence has no clips. */
  noClips?: string
  /** Edit another of the clip's pictures, from a press on it in the Output view. */
  onPicture: (picture: string) => void
  /** A picture chosen with a double click on the Output view: chosen, and its crop brought into view. */
  onPictureChosen?: ((picture: string) => void) | undefined
  /**
   * Plan 75: a one click zoom just made can be aimed. A press on either view
   * is then the point of the recording to close in on, not a drag, and the
   * point aimed at is drawn as a small target.
   */
  /** Whether a picture moved on the Output view snaps; Alt does the opposite. */
  placeSnap?: boolean | undefined
  aiming?: boolean | undefined
  aimPoint?: { x: number; y: number } | null | undefined
  onAim?: ((point: { x: number; y: number }) => void) | undefined
  onCropChange: (clipId: string, picture: string, rect: Rect, continuing: boolean) => void
  /**
   * A press on the monitor: brings the playhead into the selected clip when it
   * is elsewhere, and says so, in which case the press does nothing else, so
   * it never edits the other clip's picture that was showing.
   */
  onFraming?: (() => boolean) | undefined
  /**
   * Which of the selected clip's blurred boxes is being moved on the Source
   * view, in place of its crop (plan 85), and the boxes once one is moved.
   */
  blurBox?: number | null | undefined
  onBlurBoxes?: ((clipId: string, boxes: BlurBox[], continuing: boolean) => void) | undefined
  /** Move the picture in picture out of the way and back, sliding or fading (plan 97). */
  onOutOfTheWay?: ((how: 'slide' | 'fade') => void) | undefined
  onPlaceChange: (
    clipId: string,
    picture: string,
    place: Place,
    continuing: boolean,
    reshaped: boolean,
    fromCrop: Rect
  ) => void
  /** An overlay turned with its handle, to so many degrees. */
  onTurn?: (clipId: string, degrees: number, continuing: boolean) => void
  /** A shape picked from the Shape menu, drawn by dragging on the Output view: where the drag went, in output pixels. */
  shapeDraw?: {
    /** Which pick from the Shape menu this is. */
    id: number
    style: ShapeStyle
    bent: number
    onDrawn: (a: Point, b: Point, path: Point[]) => void
    /** Let go, and put on as this clip: its outline stays until its picture is drawn, then `onLanded` (task 86). */
    landing?: string | undefined
    onLanded?: () => void
  } | null
  /** A selected line or arrow's ends and bend dragged to new places, in output pixels. */
  onShapeLine?: (clipId: string, from: Point, to: Point, bend: Point | null) => void
  /** Any edit of a clip: the picture in picture's toolbar and its snap into a corner. */
  onClipEdit?: (e: ClipEdit, continuing?: boolean) => void
  /** A text's words being typed on the Output view, and which text. */
  textEdit?: { clipId: string; words: string } | null
  /** A text double clicked on the Output view: type into it. */
  onTextEditStart?: (clipId: string) => void
  onTextWords?: (words: string) => void
  onTextEditEnd?: (words: string | null) => void
}
