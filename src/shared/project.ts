import { newId } from './ids'
import type { ColourAdjust, BackgroundRemoval } from './looks'
import type { BlurBox } from './blur'
import type { Chapter, Marker } from './markers'
import type { TrackOf } from './tracks'
import type { Place, LayoutKind } from './layout'
import type { Captions } from './captions'
import type { VoiceStrength } from './voice'
import type { VoiceCare } from './voice-care'
import type { TextStyle } from './text'
import type { Appear } from './appear'
import type { ShapeStyle } from './shape'
import type { Transition, TransitionSide } from './transitions'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** What the project stores about one source file. Mirrors MediaAsset minus its status. */
export interface ProjectMedia {
  id: string
  originalPath: string
  playablePath: string
  conformed: boolean
  conformReasons: string[]
  durationSec: number
  width: number
  height: number
  fps: number
  codec: string
  hasAudio: boolean
  peaksPath: string
  filmstripPath: string
  /**
   * How many audio tracks the original file has; OBS records up to six.
   * Unknown for sources imported before this was counted, which are taken to
   * have one.
   */
  audioTracks?: number
  /** Each audio track's name as the file gives it, '' where it gives none. */
  trackNames?: string[]
  /** How many channels each audio track has, as the original has them. Absent for a source brought in before this was kept. */
  trackChannels?: number[]
  /**
   * Chapters the recording carries, earliest first, in its own seconds.
   * Absent for a source imported before they were read, and empty for a file
   * that has none, which is most of them.
   */
  chapters?: Chapter[]
  /** False for a sound file, which has no picture. Every source had one before sound files could be imported. */
  hasVideo?: boolean
  /**
   * The playable file's colours are by the older SD matrix, BT.601, as it
   * says: turned into BT.709 at the head of every export (audit 2026-10-01).
   * Absent for BT.709, or a file that says nothing, which is taken as BT.709.
   */
  bt601?: true
  /**
   * A picture rather than a recording: one frame, no sound, and no length of
   * its own. Its `durationSec` is `STILL_SEC`, a length for the timeline's
   * limits to be measured against, never shown as its length.
   */
  still?: boolean
  /**
   * Words drawn over the video, and how they look. A text is a picture
   * underneath: `still`, with the picture the window drew from this as its
   * playable file. It has no file of its own, so no original path.
   */
  text?: TextStyle
  /**
   * One plain colour filling the frame, as `#rrggbb`: a black screen under an
   * end card. Like a text, a still whose picture the window made, at the
   * sequence's size, with no file of its own.
   */
  colour?: string
  /**
   * A shape drawn over the video: an arrow, a line, a box or a circle, and
   * how it looks. Like a text, a still whose picture the window drew from
   * this, with no file of its own.
   */
  shape?: ShapeStyle
  /**
   * An animation, as an animated GIF is: its frames unpacked beside its
   * playable file, which is the first of them, `0001.png`, and played at
   * `frameRate` a second, looping. Absent for a picture that stands still.
   */
  frames?: number
  frameRate?: number
  /**
   * Plan 88: an animation that plays once from where it lands and then holds
   * its last frame, as a shape drawing itself on does, rather than looping.
   */
  once?: boolean
  /**
   * A recording's first audio track on its own, for the preview, made the
   * first time a sound clip needs it: a player given the recording itself
   * would read its picture for nothing. Starts at the playable file's start,
   * as ffmpeg counts it.
   */
  soundCopy?: string
  /**
   * A track of the recording with its hiss and hum taken down, made the first
   * time a sound clip playing that track has Clean up noise on, by track.
   * Starts where the track copies start, so it is read the same way.
   */
  cleaned?: { track: number; path: string }[]
  /**
   * A track of the recording with Enhance voice run over it, made the first
   * time a sound clip playing that track asks for it, by track and by recipe
   * (`voiceRecipe`): its strength, and whether it was made from the cleaned
   * copy. Starts where the track copies start, so it is read the same way.
   */
  enhanced?: { track: number; recipe: string; path: string }[]
  /**
   * Soften breaths and Remove mouth clicks, by track of the recording (plan
   * 81): they belong to the mic, not to one clip, so every clip playing the
   * track has them. Absent for none.
   */
  care?: VoiceCare[]
  /**
   * A track with its care run over it, together with Clean up noise and
   * Enhance voice as the clip asks, by track and by recipe (`careRecipe`).
   * Starts where the track copies start, so it is read the same way.
   */
  treated?: { track: number; recipe: string; path: string }[]
  /**
   * Where the playable file's time starts as ffmpeg counts it, which the export
   * and the track copies follow. A player counts from 0 instead, so a file
   * whose sound starts a little before its picture, as AAC's usually does, is
   * this far apart between the two. 0 when unknown.
   */
  startSec?: number
  /**
   * The second audio track onwards, each copied on its own into the cache,
   * starting at the recording's start. `trackFiles[0]` is track 2: the first
   * track is the playable file. Read them through `trackFile`.
   */
  trackFiles?: TrackFile[]
  /**
   * The second track onwards while their copies are still being made, just
   * after import: each one's waveform is there, its sound file not yet. The
   * source can be cut meanwhile; what needs the sound, the export and
   * captions, waits for it. Never saved: a project opened again makes any
   * copies it lacks, as it does after the cache is cleared.
   */
  copying?: TrackFile[]
  /**
   * When it came into the project, in milliseconds since 1970, which the
   * Source bin groups by day. Absent for one brought in before this was kept.
   */
  addedAt?: number
  /**
   * The part of the recording worth having, marked before it goes anywhere
   * near the timeline, in frames of the recording at the project's rate,
   * `markOut` not included.
   *
   * The recording's own, not a sequence's: a second pass through the same 28
   * minutes starts where the first one left off. Either may be set on its own,
   * as the sequence's marks are: In alone means In to the end.
   */
  markIn?: number
  markOut?: number
}

/** One audio track of a recording, as a sound file of its own, and its waveform. */
export interface TrackFile {
  path: string
  peaksPath: string
}

/**
 * How a picture gets from one zoom keyframe to the next. Absent is `smooth`,
 * the ease every move had before keyframes: flat at both ends. `linear` is
 * steady, `in` starts slowly, `out` ends slowly, and `hold` stays put and
 * jumps on the next keyframe's frame, which is how a cut is made.
 */
export type Ease = 'smooth' | 'linear' | 'in' | 'out' | 'hold'

/**
 * One zoom keyframe of a clip's main picture: the crop it shows on a frame,
 * and how it gets from there to the next keyframe.
 *
 * `at` is a frame of the **recording**, at the project rate, the unit
 * `sourceIn` counts in, rather than of the clip. A zoom belongs to what was
 * filmed: a split leaves each half reading the same keyframes, and a trimmed
 * start leaves the zoom where it was on the picture.
 *
 * Only the main picture moves. A layer stays where it is put: two pictures
 * moving at once is a different feature and nobody asked for it.
 */
export interface ZoomKey {
  at: number
  /** In the recording's own pixels, like every other crop. */
  crop: Rect
  ease?: Ease
}

/**
 * Where a picture's box is on a frame of the recording, and how see-through
 * (plan 97): a face cam sliding out of the way and back. On the recording's
 * frames as a zoom keyframe is, beside the picture's zoom keyframes rather
 * than in them, so a zoom edit never moves the box and a box edit never bends
 * the zoom; the same diamonds stand for both.
 */
export interface BoxKey {
  at: number
  place: Place
  /** 0 to 1. Absent for fully drawn. */
  opacity?: number
  ease?: Ease
}

/**
 * How a Simple zoom gets from its Start picture to its End picture: `smooth`
 * starts and ends gently, `linear` is steady, and `cut` stays on Start and
 * jumps to End halfway, which hides a jump cut.
 */
export type SimpleEase = 'smooth' | 'linear' | 'cut'

/**
 * Another picture of a clip's own source, drawn over its main picture: a
 * crop of the recording, and the place in the frame it fills.
 */
export interface Layer {
  /** Unique within its clip. Splitting a clip gives both halves the same ids. */
  id: string
  crop: Rect
  place: Place
  /** Its box's rounded corners, border and shadow, as a picture in picture. Absent for a plain box. */
  style?: PictureStyle
  /** Its own zoom keyframes, kept as the main picture's are in `transform.keys`. Absent for none. */
  keys?: ZoomKey[]
  /** Present, its zoom is a Simple one, as `transform.simple` says for the main picture. */
  simple?: SimpleEase
  /** Its box's keyframes, sorted by `at` (plan 97). Absent for a box that stays on `place`. */
  boxKeys?: BoxKey[]
}

/**
 * How a picture in picture's box is framed, in output pixels: its corners
 * rounded, a border round it, and a shadow under it. Each absent for none.
 */
export interface PictureStyle {
  radius?: number
  border?: number
  /** `#rrggbb`. White when there is a border and no colour. */
  borderColour?: string
  shadow?: true
}

/**
 * A clip on a video track: a picture of a recording, at a time of its own.
 * Its main picture is a crop and a place in the frame, and it may have more
 * pictures of the same recording as layers. It has no sound of its own: its
 * recording's sound is on sound clips linked to it.
 */
export interface Clip {
  id: string
  mediaId: string
  /** Frames at the project rate, measured from the start of the source. */
  sourceIn: number
  /** Exclusive. */
  sourceOut: number
  /** Where it starts in the sequence. */
  timelineStart: number
  /** The main picture: its crop, and its place in the frame, full frame unless laid out. */
  transform: {
    mode: 'crop'
    crop: Rect
    place: Place
    /**
     * The main picture's zoom keyframes, sorted by `at`, no two on one frame,
     * all of the shape of `crop`. Absent or empty, the picture stays on `crop`
     * for the whole clip. With keyframes, `crop` is kept equal to the crop on
     * the clip's first frame, so whatever reads it as "the picture" reads
     * something true.
     */
    keys?: ZoomKey[]
    /**
     * Present, the zoom is a Simple one: a Start picture on the clip's first
     * frame and an End picture on its last, and `keys` are made from those two
     * wherever the clip's ends are, so a trim stretches or squeezes the move.
     * Absent with keyframes, they are keyframes put by hand, which stay on the
     * recording's frames. Absent without, the picture stays still.
     */
    simple?: SimpleEase
    /**
     * An overlay's turn, in degrees clockwise about its box's centre, in
     * (-180, 180]. Absent for none, and for anything that is not an overlay.
     */
    rotation?: number
    /** An overlay's opacity, 0 to 1. Absent for fully drawn. */
    opacity?: number
    /**
     * The main picture's frame, as a picture in picture. Drawn when the clip
     * lies over another track, a recording in a corner; on the bottom track
     * the main picture is the frame itself and it is kept but not drawn.
     */
    style?: PictureStyle
    /** The main picture's box keyframes, sorted by `at` (plan 97). Absent for a box that stays on `place`. */
    boxKeys?: BoxKey[]
  }
  /** More pictures of the same source, drawn over the main one in order. */
  layers: Layer[]
  /** How the pictures are laid out, so a change of shape can lay them out again. */
  layout: LayoutKind
  /** Shared by the clips that came onto the timeline together, a picture and its sound. */
  link?: string
  /** A colour from `CLIP_MARKS`, meaning whatever you decided it means. Absent until marked. */
  mark?: string
  /** A look from `LOOKS`, on every picture of the clip. Absent for the recording's own colour. */
  look?: string
  /** How strongly the look is on, 0 to 100. Absent for full (plan 85). */
  lookStrength?: number
  /** Brightness, contrast, saturation and warmth on top of the look, each -100 to 100. Absent for none moved. */
  adjust?: ColourAdjust
  /** Its green, blue or black background taken out, so what is under it shows. Absent for none (plan 90). */
  removeBackground?: BackgroundRemoval
  /** The whole picture blurred, by 1 to 100. Absent for sharp (plan 85). */
  blur?: number
  /** Boxes on the recording blurred, as shares of its frame. Absent for none (plan 85). */
  blurBoxes?: BlurBox[]
  /**
   * Where a picture does not fill its box, the bars are the same picture,
   * enlarged to cover the box and blurred, rather than black. Absent for black.
   */
  blurFill?: true
  /**
   * A transition over this clip's start. At a cut it belongs to the incoming
   * clip, and it stretches the outgoing one just as far: see `transitions.ts`,
   * which works out what it covers. Absent until one is put there.
   */
  transitionIn?: Transition
  /** A transition over this clip's end. */
  transitionOut?: Transition
  /** How a text or a picture comes in: a fade or a pop over its first frames. Absent for straight in. */
  enter?: Appear
  /** How a text or a picture goes out, over its last frames. Absent for straight out. */
  exit?: Appear
  /**
   * The group this clip is a piece of, with its neighbours on the track: see
   * `groups.ts`. Absent for a clip on its own.
   */
  group?: string
  /**
   * The group's framing, the same on every picture piece of it: the picture
   * as one clip spanning the whole group would have it. Each piece's own
   * transform is worked out from it after every edit.
   */
  groupFrame?: GroupFrame
}

/**
 * How a group of clips is framed as one: the main picture's crop and place,
 * and its zoom, with keyframes on the group's own frames, 0 its first.
 */
export interface GroupFrame {
  /** The recording the crops are in, the first piece's when the group was made. */
  mediaId: string
  crop: Rect
  place: Place
  keys?: ZoomKey[]
  simple?: SimpleEase
}

/**
 * A clip on an audio track: one of a recording's audio tracks, placed at a
 * time of its own. A recording's own sound, music, or a voice over.
 */
export interface SoundClip {
  id: string
  mediaId: string
  /** Which of the recording's audio tracks it plays, from 0. */
  track: number
  /** Frames at the project rate, measured from the start of the source. */
  sourceIn: number
  /** Exclusive. */
  sourceOut: number
  timelineStart: number
  gain: number
  muted: boolean
  /** Shared by the clips that came onto the timeline together, a picture and its sound. */
  link?: string
  /** The group its picture is a piece of: see `Clip.group`. */
  group?: string
  /** A colour from `CLIP_MARKS`, meaning whatever you decided it means. Absent until marked. */
  mark?: string
  /**
   * Plays its track's cleaned copy, with the hiss and hum taken down, in the
   * preview and the export alike. Absent when off.
   */
  denoise?: true
  /**
   * Plays its track with Enhance voice at this strength, from a copy made
   * for it, in the preview and the export alike; from the cleaned copy when
   * Clean up noise is on too. Absent when off.
   */
  voice?: VoiceStrength
  /** A fade over this clip's start, against the sound before it or against silence. */
  transitionIn?: Transition
  /** A fade over this clip's end. */
  transitionOut?: Transition
}

/** A video track: pictures at times of their own, never overlapping. */
export type VideoTrack = TrackOf<Clip>

/** An audio track: sound clips at times of their own, never overlapping. */
export type AudioTrack = TrackOf<SoundClip>

/** Which kind of track: pictures or sound. */
export type TrackKind = 'video' | 'audio'

/**
 * One sequence as editing, playback and export see it: its own tracks and
 * shape, with the project's sources and frame rate. Every clip edit, the
 * render plan and the preview work on this, and never need to know that a
 * project can hold more than one.
 */
export interface Timeline {
  fps: number
  output: { width: number; height: number }
  /**
   * The output shape. One setting per sequence, that the crop box, the aspect
   * lock, Reset crop, a new clip's starting crop and the export all follow.
   */
  presetId: string
  media: ProjectMedia[]
  /** V1 first, then V2 and up, each drawn over the ones before it. Never empty. */
  videoTracks: VideoTrack[]
  /** A1 first, then A2 and down. Never empty. */
  audioTracks: AudioTrack[]
  /** The caption track, above the top video track, and how its captions look. */
  captions: Captions
  /** Notes left on frames of the sequence, earliest first. Never on the same frame twice. */
  markers: Marker[]
  /** The range marked with In and Out, absent when nothing is marked. See `SequenceMarks`. */
  marks?: SequenceMarks
}

/**
 * The range marked on a sequence with In and Out, `out` not included. Either
 * may be missing: In alone is In to the end, Out alone the start to Out.
 *
 * Kept on the sequence and changed by an edit, so it undoes and is saved with
 * the project. It used to be kept with the playhead as where you are looking,
 * and a mark pressed by mistake over a range set with care could not be got
 * back. A range is a decision about what to take out, which Delete then acts
 * on, and that is an edit.
 */
export interface SequenceMarks {
  in?: number
  out?: number
}

/** One of a project's timelines: a cut in a shape, over the project's sources. */
export interface Sequence {
  id: string
  name: string
  /** The name follows the shape until you rename it. */
  nameFollowsShape: boolean
  presetId: string
  output: { width: number; height: number }
  videoTracks: VideoTrack[]
  audioTracks: AudioTrack[]
  captions: Captions
  markers: Marker[]
  marks?: SequenceMarks
}

export interface Project {
  schemaVersion: number
  name: string
  fps: number
  /** Shared by every sequence: one source bin per project. */
  media: ProjectMedia[]
  /** Never empty. */
  sequences: Sequence[]
}

export { newId }
export type { TransitionSide }

// What moved out of this file, by what it does. Everything that was exported
// here still is, so every file goes on importing from this one.
export {
  SCHEMA_VERSION, FIRST_SEQUENCE_ID, V1_ID, A1_ID, DEFAULT_PRESET_ID, EASES, SIMPLE_EASES, MAIN_PICTURE
} from './project-core'
export {
  MEDIA_OWNER, withEditsOf, trackCount, trackFile, trackPeaks, trackName, upsertTimelineMedia, clipsUsing,
  withoutMedia, upsertMedia, clipsCutShort, sourceFrames, markedSpan, isMarked, setSourceMarksOn
} from './project-media'
export {
  MAX_CORNER_PX, MAX_BORDER_PX, cleanPictureStyle, setPictureStyle, setBlurFill, setLook, setLookStrength,
  setRemoveBackground, setBlur, setBlurBoxes, setColourAdjust
} from './clip-looks'
export {
  shapeName, outputFor, createProject, createTimeline, sequenceOf, timelineOf, withTimeline, marksOf,
  setSequenceMarks, editSequence, uniqueSequenceName, addSequence, duplicateSequence, MAX_PROJECT_NAME,
  UNTITLED, cleanProjectName, renameSequence, removeSequence, setSequenceShape, applySetup, targetAspect,
  shownTracks, setShape, addMarkerAt, moveMarker, renameMarker, colourMarker, removeMarker, setMarkers
} from './sequences'
export {
  STILL_SEC, STILL_LANDS_SEC, isStill, isAnimated, framesPattern, framePath, animationFrame, animationAt,
  isText, addTextTo, isShape, isDrawn, addShapeTo, setShapeOn, isColour, cleanColour, BLACK_SCREEN,
  COLOUR_LANDS_SEC, addColourTo, setColourOn, setTextOn, isOverlay, cleanOverlay, setOverlay, setAppear
} from './drawn-media'
export type { DrawnText } from './drawn-media'
export {
  mediaDurationFrames, clipLength, v1Clips, v1End, besidesV1, allClips, timelineDuration, transitionsOf,
  shownSpansOf, hasPicture, trackOf, findClip, findVideoClip, findSoundClip, linkedIds, groupOnV1, groupsOnV1,
  pictureAt
} from './timeline-query'
export type { TrackTransitions, FoundClip } from './timeline-query'
export { placeSource, addSource, prepareDrop, addClip } from './place-source'
export type { SourceDrop } from './place-source'
export {
  removeClip, closeUpStretch, closeUpBlockers, openUpStretch, closeUpClip, closeUpClipBlockers, closeUpStart,
  removeClipsRefusal, removeClips, gapCanClose, gapPartsGroup, closeUpGap, liftRange, removeRange
} from './remove-clips'
export type { ClipsRefusal, Gap } from './remove-clips'
export {
  plannedMove, moveClip, setClipIn, setClipOut, rippleTrim, rippleTrimBlockers, rearrangeClip, moveClipTo,
  trimStart, trimEnd, trimToFrame, closingOn, trimToFrameBlockers
} from './move-trim'
export type { Landing } from './move-trim'
export {
  clipToCut, asTwoPieces, splitClip, joinNeighbour, removedBetween, joinRefusal, joinClips, splitEverything
} from './split-join'
export {
  linkClips, unlinkClip, addTrack, setTrackMuted, setTrackDuck, setTrackLocked, setTrackName, setTrackHidden,
  trackLabel, removeTrack
} from './track-edits'
export {
  setClipDenoise, cleanedFile, setClipVoice, treatedFile, enhancedFile, playedCopy, wantingVoiceCopy,
  wantingCareCopy, setVoiceCare, wantingCleanCopy, setSoundTrack, setClipMark, MAX_GAIN, setClipAudio,
  applySoundToSource, playedByPicture, wantingSoundCopy, listenTracks
} from './sound-edits'
export type { VoiceCopyWanted, CareCopyWanted } from './sound-edits'
export {
  addTransition, setTransition, setTransitionKind, removeTransition, setFade, fillNewCuts
} from './transition-edits'
export {
  setCaptions, setCaptionsHeard, stretchedTimeline, setCaptionsWithin, setCaptionsWithinHeard, moveCaption,
  trimCaption, splitCaptionAt, removeCaption, setCaptionWords, setCaptionStyle, placeCaption, relocateCaptions,
  regroupCaptions, followSpeech
} from './timeline-captions'
export {
  setCrop, framingOf, settleKeys, zoomOf, withZoom, simpleKeys, startEndOf, settleZoomKeys, mapCrops,
  setZoomKey, removeZoomKey, moveZoomKey, setZoomEase, setZoomKeys, clearZoomKeys, setSimpleZoom, useKeyframes,
  useSimpleZoom, simpleLoses, PRESET_SCALE, zoomPreset
} from './zoom-keys'
export type { Framing, PictureZoom, SimpleChange, ZoomPreset, PresetOptions } from './zoom-keys'
export {
  setFraming, framingRefusal, setFramingOn, cropOf, setCropOn, setCropsOn, setPlace, addLayer, removeLayer, pipOf, setPip,
  applyLayout, swapPictures, applyLayoutToSource, cornerPlace, isCornerPlace, hasLayout
} from './framing-layouts'
export type { CopiedCrop, PipChange } from './framing-layouts'
