import type { FontFigures } from './font-file'
import type { FacesFound } from './face-follow'
import type { SavedLayout } from './saved-layouts'
import type { SourceFolder } from './source-folders'
import type { CopiedCrop, DrawnText, Ease, Framing, PipChange, Gap, PictureStyle, Project, Rect, SimpleChange, TrackFile, TrackKind, TransitionSide, ZoomKey, ZoomPreset } from './project'
import type { TextStyle } from './text'
import type { Appear } from './appear'
import type { SavedShape, ShapeStyle } from './shape'
import type { SavedCaptionStyle, SavedTextStyle } from './saved-styles'
import type { VoiceStrength } from './voice'
import type { BreathAmount } from './voice-care'
import type { BackgroundColour, BackgroundRemoval, ColourAdjust, FoundBackground } from './looks'
import type { BlurBox } from './blur'
import type { KeptVersion } from './versions'
import type { CopiedClips } from './clipboard'
import type { NamedLayout, Place } from './layout'
import type { OutOfTheWay } from './box-keys'
import type { Overrides } from './keymap'
import type { Workspace } from './workspace'
import type { CaptionAt, CaptionStyleChange, Stretch, TimedWord } from './captions'
import type { AssetKind } from './asset-clip'
import type { Chapter, Marker } from './markers'

/** `queued` is waiting its turn: files are imported one at a time, in the order they came. */
export type AssetStatus = 'queued' | 'probing' | 'conforming' | 'analysing' | 'ready' | 'failed'

export interface MediaAsset {
  id: string
  originalPath: string
  /** The file the editor plays and renders from. Equals originalPath when no conform was needed. */
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
  /** How many audio tracks the original file has. */
  /** Its playable file's colours are by BT.601. */
  bt601?: true
  audioTracks?: number
  /** How many channels each audio track has. */
  trackChannels?: number[]
  /** Each audio track's name as the file gives it, '' where it gives none. */
  trackNames?: string[]
  /** Chapters the file carries, which OBS writes one of per press of its hotkey. */
  chapters?: Chapter[]
  /** The second audio track onwards, each copied on its own. */
  trackFiles?: TrackFile[]
  /** Those tracks while their copies are still being made: a waveform each, no sound file yet. */
  copying?: TrackFile[]
  /** Where the playable file's time starts as ffmpeg counts it. */
  startSec?: number
  /** False for a sound file, which has no picture. */
  hasVideo?: boolean
  /** A picture rather than a recording. */
  still?: boolean
  /** An animation's frames and how many a second it plays, for a GIF that moves. */
  frames?: number
  frameRate?: number
  /** Words drawn over the video, for a text, which the bin does not list. */
  text?: TextStyle
  /** A shape drawn over the video, which the bin does not list either. */
  shape?: ShapeStyle
  /** One plain colour, for a black screen, which the bin does not list either. */
  colour?: string
  status: AssetStatus
  error?: string
  /** What ffmpeg said about a failure, for anyone who wants more than the plain words. */
  errorDetails?: string
}

/** What an import is doing within its status. */
export type ImportStage = 'reading' | 'converting' | 'waveform' | 'filmstrip' | 'tracks'

export interface ImportProgress {
  id: string
  status: AssetStatus
  /** 0 to 1 within the current stage, or undefined when the stage has no measurable progress. */
  fraction?: number
  message?: string
  stage?: ImportStage
  /** For the tracks stage: how many audio tracks are being copied. */
  tracks?: number
}

/** A video file in the folder OBS records to. */
export interface Recording {
  path: string
  name: string
  size: number
  /** When it was last written, in milliseconds since 1970. */
  modifiedAt: number
  /** Still being written: its size or time changed in the last few seconds. */
  recording: boolean
}

/** A file in one of your folders in Sources. */
export interface FolderFile {
  path: string
  name: string
  size: number
  modifiedAt: number
  /** Where it is under the entry's folder, as "sub/folder", or '' for the folder itself. Given by a search. */
  under?: string
}

/**
 * One level of one of your folders: its subfolders, by their path under the
 * entry's folder, and its files. Null files when it cannot be read, as when
 * its drive is not plugged in: not the same as empty.
 */
export interface FolderListing {
  folder: string | null
  dirs: { name: string; under: string }[]
  files: FolderFile[] | null
  /** Files past what is listed. */
  more: number
}

/** What a search found in one of your folders and below it, and whether it stopped before the end. */
export interface FolderSearch {
  files: FolderFile[]
  cut: boolean
}

/** The newest recordings, and where they came from. */
export interface RecordingsListing {
  /** The folder listed, or null when none is known. */
  folder: string | null
  /** Read from OBS's own settings, rather than chosen by hand. */
  fromObs: boolean
  recordings: Recording[]
}

export interface FfmpegStatus {
  ok: boolean
  message: string
}

/**
 * A change to the clips or the shape of one sequence. `alone` acts on the
 * clip named without the clips linked to it, as Alt+click selects it.
 */
export type ClipEdit =
  /**
   * A source put on the timeline: dropped on the track `onTrack` at the frame
   * `at`, or at the end of V1 with Add to timeline when neither is given.
   * `streams` are its streams with sound in them. `clipId` names the new
   * picture, or the sound clip of a source with no picture, so the window can
   * select it.
   */
  | {
      kind: 'addSource'
      mediaId: string
      clipId: string
      at?: number
      onTrack?: string
      streams?: number[]
      /** Ctrl held: the sequence opens up for it rather than it covering what is there. */
      insert?: boolean
      /** Dropped past the last track: `onTrack` names a new track of this kind. */
      newTrack?: TrackKind
      /** The whole recording, whatever is marked on it. */
      whole?: boolean
      /** Its background taken out as it lands, in the same undo step: an effect on a green screen (plan 90). */
      removeBackground?: BackgroundRemoval
    }
  /** Take a clip away, leaving a gap. */
  | { kind: 'removeClip'; clipId: string; alone?: boolean }
  /** Take a clip and its linked clips away, closing up the stretch they covered. */
  | { kind: 'closeUpClip'; clipId: string }
  /**
   * Take several clips away at once, leaving gaps: Delete with more than one
   * selected. With `closeUp`, the stretch they cover comes out of the sequence
   * too, which needs them to cover one between them.
   */
  | { kind: 'removeClips'; clipIds: string[]; alone?: boolean; closeUp?: boolean }
  /** Not heard, in the preview and in the export: a decision about the edit. */
  | { kind: 'setTrackMuted'; trackId: string; muted: boolean }
  | { kind: 'setTrackDuck'; trackId: string; duck: boolean }
  /** Nothing on it can be changed, and nothing can be dropped on it. */
  | { kind: 'setTrackLocked'; trackId: string; locked: boolean }
  /** What the track is called instead of V1 or A1. Empty gives its number back. */
  | { kind: 'setTrackName'; trackId: string; name: string }
  /** Not drawn, in the preview and in the export: mute for pictures. */
  | { kind: 'setTrackHidden'; trackId: string; hidden: boolean }
  /** Take a gap's time out of the sequence. */
  | { kind: 'closeUpGap'; gap: Gap }
  /** Take stretches of the sequence out through V1's pictures, closing up, as Remove silences does. */
  | { kind: 'removeStretches'; stretches: { from: number; to: number }[] }
  /**
   * A clip to another time, and track of its kind, covering what it lands on;
   * with `insert`, Ctrl held, taken out and put in instead. `newTrack` makes
   * the track `trackId` first: the lane past the last track.
   */
  | {
      kind: 'moveClip'
      clipId: string
      trackId: string
      start: number
      alone?: boolean
      insert?: boolean
      newTrack?: boolean
      /** The rest of a selection it was dragged in, which moves with it by as much. */
      with?: string[]
    }
  /** `closeUp`, a plain edge drag on V1 since plan 82 (Ctrl trims only): the sequence closes up or opens up with the trim, when the clip's group is on V1. */
  | { kind: 'setClipIn'; clipId: string; frame: number; alone?: boolean; closeUp?: boolean }
  | { kind: 'setClipOut'; clipId: string; frame: number; alone?: boolean; closeUp?: boolean }
  /** The clip named when it is under `frame`, otherwise the one S finds there. */
  | { kind: 'split'; frame: number; clipId?: string; alone?: boolean }
  /** Every clip running across the frame, on every track, cut there. */
  | { kind: 'splitAll'; frame: number }
  /**
   * The marked range taken out of every track, `to` not included: leaving a
   * gap, or with `closeUp` moving everything after it up by its length.
   */
  | { kind: 'removeRange'; from: number; to: number; closeUp?: boolean }
  /** I and O: a clip trimmed to `frame`, closing up when it is on V1. */
  | { kind: 'trimToFrame'; clipId: string; edge: 'start' | 'end'; frame: number; alone?: boolean }
  | { kind: 'unlink'; clipId: string }
  /** The clips named, and what each is linked to, made one linked group. */
  | { kind: 'link'; clipIds: string[] }
  | { kind: 'addTrack'; trackKind: TrackKind; trackId: string }
  /** Only an empty track goes, and never V1 or A1. */
  | { kind: 'removeTrack'; trackId: string }
  /**
   * The main picture's crop, or a layer's when `picture` names one. With
   * `from`, the crop shown when it was changed, a zoom moves and scales as
   * `from` became `rect`, keeping its motion (task 122).
   */
  | { kind: 'setCrop'; clipId: string; rect: Rect; picture?: string; from?: Rect }
  /**
   * A zoom keyframe on a frame of the recording, added or changed to this crop.
   * This and the zoom edits below are for the main picture unless `picture`
   * names a further one.
   */
  | { kind: 'setZoomKey'; clipId: string; at: number; crop: Rect; picture?: string }
  | { kind: 'removeZoomKey'; clipId: string; at: number; picture?: string }
  | { kind: 'moveZoomKey'; clipId: string; from: number; to: number; picture?: string }
  | { kind: 'setZoomEase'; clipId: string; at: number; ease: Ease; picture?: string }
  /**
   * Plan 97: a picture's box pinned on a frame of the recording, its place and
   * opacity; the box moved out of the way between two frames and back; and its
   * box keyframes taken off. The zoom edits above that remove, move or ease a
   * keyframe do the same to a box keyframe on that frame.
   */
  | { kind: 'setBoxKey'; clipId: string; at: number; place: Place; opacity?: number; picture?: string }
  | { kind: 'moveOutOfTheWay'; clipId: string; from: number; to: number; how: OutOfTheWay; picture?: string }
  | { kind: 'clearBoxKeys'; clipId: string; picture?: string }
  /** Every zoom keyframe of a clip at once; an empty list takes the zoom off. */
  | { kind: 'setZoomKeys'; clipId: string; keys: ZoomKey[]; picture?: string }
  | { kind: 'clearZoomKeys'; clipId: string; picture?: string }
  /** A Simple zoom's Start, End or ease changed. */
  | { kind: 'setSimpleZoom'; clipId: string; change: SimpleChange; picture?: string }
  /** A Simple zoom made keyframes put by hand. */
  | { kind: 'useKeyframes'; clipId: string; picture?: string }
  /** Keyframes made a Simple zoom, from the pictures on the clip's first and last frames. */
  | { kind: 'useSimpleZoom'; clipId: string; picture?: string }
  /**
   * A one-click zoom from frame `from` of the recording, and back out by `to`
   * for `inOut`: how far in, on what point, and how quickly, as `PresetOptions` says.
   */
  | {
      kind: 'zoomPreset'
      clipId: string
      preset: ZoomPreset
      from: number
      to: number
      picture?: string
      scale?: number
      point?: { x: number; y: number }
      ramp?: number
    }
  /** A look on a picture clip, from `LOOKS`, or null for the recording's own colour. */
  | { kind: 'setLook'; clipId: string; look: string | null }
  /** Take out a green, blue or black background, or put it back with null (plan 90). */
  | { kind: 'setRemoveBackground'; clipId: string; removal: BackgroundRemoval | null }
  /** How strongly the look is on, 0 to 100 (plan 85). */
  | { kind: 'setLookStrength'; clipId: string; strength: number }
  /** Some of the four sliders, each -100 to 100, 0 for as recorded (plan 85). */
  | { kind: 'setColourAdjust'; clipId: string; change: ColourAdjust }
  /** The whole picture blurred by 1 to 100, or sharp with null (plan 85). */
  | { kind: 'setBlur'; clipId: string; amount: number | null }
  /** A clip's blurred boxes, all of them (plan 85). */
  | { kind: 'setBlurBoxes'; clipId: string; boxes: BlurBox[] }
  /** A picture in picture's corners, border and shadow, by its picture's id; null for a plain box. */
  | { kind: 'setPictureStyle'; clipId: string; picture: string; style: PictureStyle | null }
  /** A picture in picture's corner, size, margin or shape, as `setPip` changes them. */
  | { kind: 'setPip'; clipId: string; change: PipChange }
  /** The bars round a clip's pictures filled with the picture blurred, or black. */
  | { kind: 'setBlurFill'; clipId: string; on: boolean }
  /** An overlay turned, or made more or less see-through. Either left out stays as it is. */
  | { kind: 'setOverlay'; clipId: string; rotation?: number; opacity?: number }
  /** How a text or a picture comes in or goes out: a fade or a pop, or null for straight in or out. */
  | { kind: 'setAppear'; clipId: string; side: 'in' | 'out'; appear: Appear | null }
  /** Another clip's pictures and layout, pasted: the crops scaled to this clip's recording. */
  | { kind: 'setFraming'; clipId: string; framing: Framing }
  /** The same, onto every selected picture clip at once. */
  | { kind: 'setFramingOn'; clipIds: string[]; framing: Framing }
  /**
   * Every cut between two of the clips named joined, with their linked clips
   * unless `alone`: see `joinClips`. With `bringBack`, what was taken out
   * between two pieces of a recording is put back first.
   */
  | { kind: 'joinClips'; clipIds: string[]; alone?: boolean; bringBack?: boolean }
  /** The clips named, side by side on one track, made one clip keeping the cuts between them: see `groups.ts`. */
  | { kind: 'groupClips'; clipIds: string[]; groupId: string }
  /** Every group a clip named is in taken apart, each piece keeping what it shows. */
  | { kind: 'ungroupClips'; clipIds: string[] }
  /**
   * An edit to one picture's place or crop, made, and the place or crop it
   * changed then put on the same picture of each clip in `also`: several
   * selected clips moved or cropped at once. See `on-selected.ts`.
   */
  | { kind: 'onSelected'; edit: ClipEdit; also: string[] }
  /**
   * Another clip's crop alone, pasted onto the same picture of every clip
   * named: the same share of each recording. `slot` is which picture by
   * position, 0 or absent for the main one, 1 for Picture 2.
   */
  | { kind: 'setCropOn'; clipIds: string[]; crop: CopiedCrop; slot?: number }
  /**
   * A crop of its own for the same picture of each clip named, in one step,
   * as Centre on face gives every clip (task 100). `slot` as for `setCropOn`.
   */
  | { kind: 'setCropsOn'; crops: { clipId: string; crop: Rect }[]; slot?: number }
  /**
   * Where a picture sits. `reshapeCrop` is the aspect lock: the crop follows the
   * place's shape. `fromCrop` is the crop when the drag began, which every
   * movement reshapes, so a drag back to where it started gives back its crop.
   */
  | { kind: 'setPlace'; clipId: string; picture: string; place: Place; reshapeCrop: boolean; fromCrop?: Rect }
  | { kind: 'addLayer'; clipId: string; layerId: string }
  | { kind: 'removeLayer'; clipId: string; layerId: string }
  | { kind: 'applyLayout'; clipId: string; layout: NamedLayout }
  | { kind: 'swapPictures'; clipId: string }
  | { kind: 'applyLayoutToSource'; clipId: string }
  /** A sound clip's volume and mute. */
  | { kind: 'setClipAudio'; clipId: string; gain: number; muted: boolean }
  /** Every other sound clip of the same recording and stream as this clip's sound, the same volume and mute. */
  | { kind: 'applySoundToSource'; clipId: string }
  /** A colour on a clip and on everything linked to it, or null to take it off. */
  | { kind: 'setClipMark'; clipId: string; mark: string | null }
  /**
   * A transition on a clip's edge, and on the same edge of the clips linked to
   * it unless `alone`. `transitionKind` is the kind wanted; a linked sound
   * takes its own default curve, because a wipe means nothing to a sound.
   */
  | { kind: 'addTransition'; clipId: string; side: TransitionSide; transitionKind?: string; length: number; alone?: boolean }
  /** How long a transition is and where it sits across the cut, as a drag leaves it. */
  | { kind: 'setTransition'; clipId: string; side: TransitionSide; length: number; before: number; alone?: boolean }
  /** Which kind a transition is, changed without taking it off first. This clip's only. */
  | { kind: 'setTransitionKind'; clipId: string; side: TransitionSide; transitionKind: string }
  | { kind: 'removeTransition'; clipId: string; side: TransitionSide; alone?: boolean }
  /** A sound clip's fade from or to silence, as its fade handle drags it: `length` frames, 0 for none. */
  | { kind: 'setFade'; clipId: string; side: TransitionSide; length: number }
  /** Clean up noise on a sound clip, or not: it plays its track cleaned of hiss and hum. */
  | { kind: 'setClipDenoise'; clipId: string; on: boolean }
  /** Enhance voice on a sound clip at a strength, or off with null. */
  | { kind: 'setClipVoice'; clipId: string; voice: VoiceStrength | null }
  | { kind: 'setShape'; presetId: string }
  /** Which of its recording's audio tracks a sound clip plays. */
  | { kind: 'setSoundTrack'; clipId: string; track: number }
  /**
   * Captions made from the words heard, in place of every caption the
   * sequence had, and the audio tracks listened to for them, for next time.
   */
  | {
      kind: 'setCaptions'
      words: TimedWord[]
      listenTo: string[]
      /** The listening they came from, when they were heard on the sequence as it was before edits made meanwhile. */
      heardId?: string
      /** Plan 78: only these stretches were listened to, and only the captions starting inside them are replaced. */
      within?: Stretch[]
    }
  /** A caption dragged to start at `start`, covering what it lands on. */
  | { kind: 'moveCaption'; captionId: string; start: number }
  /** A caption's edge dragged to the frame `frame` of the sequence, its words keeping their share of it. */
  | { kind: 'trimCaption'; captionId: string; edge: 'start' | 'end'; frame: number }
  | { kind: 'splitCaption'; captionId: string; frame: number }
  | { kind: 'removeCaption'; captionId: string }
  /** A caption's words as typed. */
  | { kind: 'setCaptionWords'; captionId: string; text: string }
  /** How every caption of the sequence looks. */
  | { kind: 'setCaptionStyle'; style: CaptionStyleChange }
  /** One caption put where it was dragged, or given back to the style with null. */
  | { kind: 'placeCaption'; captionId: string; at: CaptionAt | null }
  /** Every caption that follows the style moved there, and those placed by hand too when asked. */
  | { kind: 'relocateCaptions'; at: CaptionAt; includeHand: boolean }
  /** Every caption's words grouped again by the rule, keeping each word as it is. */
  | { kind: 'regroupCaptions' }
  /** A note left on a frame of the sequence. A frame that has one already keeps it. */
  | { kind: 'addMarker'; frame: number; name?: string }
  | { kind: 'moveMarker'; markerId: string; frame: number }
  | { kind: 'renameMarker'; markerId: string; name: string }
  /** One of the five colours a clip can be marked with, or null for none. */
  | { kind: 'colourMarker'; markerId: string; colour: string | null }
  | { kind: 'removeMarker'; markerId: string }
  /** Every marker at once, for bringing a recording's chapters in as one undo step. */
  | { kind: 'setMarkers'; markers: Marker[] }
  /** The range marked with In and Out on the sequence: an end set, or null to clear it, or left out to keep it. */
  | { kind: 'setSequenceMarks'; in?: number | null; out?: number | null }

/**
 * Every change the renderer can ask for. Applied in main, where the document
 * lives. A clip edit names the sequence it is for; the other four change the
 * list of sequences. All of them are undoable.
 */
export type ProjectEdit =
  | (ClipEdit & {
      sequenceId: string
      /**
       * Put this transition on every cut the edit makes, for anyone who has
       * asked for one on all of them. Left off unless that setting is on.
       */
      autoTransition?: { kind?: string; length: number }
    })
  | { kind: 'addSequence'; id: string; presetId: string }
  | { kind: 'duplicateSequence'; sequenceId: string; id: string }
  | { kind: 'renameSequence'; sequenceId: string; name: string }
  | { kind: 'removeSequence'; sequenceId: string }
  /**
   * A saved setup picked from the shape list: the sequence changed to its
   * shape, then its framing given to the clips named, as one undo step.
   */
  | { kind: 'applySetup'; sequenceId: string; presetId: string; clipIds: string[]; framing: Framing }
  /**
   * The part of a recording worth having, marked before it goes anywhere near
   * the timeline. Null clears one. A project edit rather than a clip edit:
   * the recording belongs to the project, and a clip edit's changes to the
   * sources are thrown away.
   */
  | { kind: 'setSourceMarks'; mediaId: string; in?: number | null; out?: number | null }
  /**
   * Soften breaths and Remove mouth clicks for one track of a recording, for
   * every clip that plays it (plan 81). A field left out stays as it is.
   */
  | { kind: 'setVoiceCare'; mediaId: string; track: number; breaths?: BreathAmount | null; clicks?: boolean }
  /**
   * A new text on a sequence, with the picture the window drew of it: a
   * source of its own and a clip of it, in one step. A project edit, since
   * the source belongs to the project.
   */
  | { kind: 'addText'; sequenceId: string; mediaId: string; clipId: string; at: number; style: TextStyle; drawn: DrawnText }
  /** A text's words or style changed, with the picture drawn again from them. */
  | { kind: 'setText'; mediaId: string; style: TextStyle; drawn: DrawnText }
  /** Task 34: several texts restyled at once, as one undo step, each with its picture drawn again. */
  | { kind: 'setTexts'; texts: { mediaId: string; style: TextStyle; drawn: DrawnText }[] }
  /** Task 34: one caption style put on the captions of every sequence, each keeping where its captions sit. */
  | { kind: 'captionStyleEverywhere'; style: CaptionStyleChange }
  /** A shape drawn on the Output view, at its place there, as a clip of its own at `at`. */
  | { kind: 'addShape'; sequenceId: string; mediaId: string; clipId: string; at: number; style: ShapeStyle; drawn: DrawnText; place: Place }
  /** A shape's look or its lines changed, with the picture drawn again; `placed` puts that clip exactly there. */
  | { kind: 'setShapeStyle'; mediaId: string; style: ShapeStyle; drawn: DrawnText; placed?: { clipId: string; place: Place } }
  | {
      kind: 'addColour'
      sequenceId: string
      mediaId: string
      clipId: string
      at: number
      colour: string
      drawn: DrawnText
      /** Frames long; a few seconds when not given. */
      length?: number
      /** The track it goes on, as a gap filled from its menu; worked out when not given. */
      trackId?: string
    }
  | { kind: 'setColour'; mediaId: string; colour: string; drawn: DrawnText }
  /**
   * Copied clips pasted at a frame of a sequence, as `pasteClips` places
   * them. A project edit, since a pasted text is a new source. `ids` are the
   * new ids to give, in order, so the window knows what it pasted.
   */
  | { kind: 'pasteClips'; sequenceId: string; copied: CopiedClips; at: number; ids: string[] }

export interface PeaksData {
  peaksPerSecond: number
  durationSec: number
  peaks: Int16Array
}

export interface ExportProgress {
  stage: 'segment' | 'join' | 'done' | 'failed' | 'cancelled'
  /** 0 to 1 across the whole export, every sequence of it. */
  fraction: number
  clipIndex?: number
  clipLabel?: string
  clipCount?: number
  message?: string
  /** When several sequences are exported, which one this is, counted from 1, and its name. */
  sequenceIndex?: number
  sequenceCount?: number
  sequenceName?: string
}

/** The shape is not part of the request: it is the sequence's, so the two cannot disagree. */
export interface ExportRequest {
  sequenceId: string
  /** Every sequence, one after another, each in its own shape, rather than only `sequenceId`. */
  allSequences?: boolean
  /**
   * Only this part of the sequence, in frames, `to` not included: the range
   * marked with In and Out, or the stretch the selected clips cover. Not with
   * every sequence, whose ranges are their own.
   */
  range?: { from: number; to: number }
  mode: 'join' | 'batch'
  outputDir: string
  filenamePattern: string
  /**
   * What to do with a file that is already there: write over it, or keep it
   * and write beside it as "name (2).mp4". Written over when not said.
   */
  existing?: 'replace' | 'keepBoth'
  /** Also write the captions beside a joined video as an SRT file of the same name. */
  subtitleFile?: boolean
  /** Also write every word of the captions beside a joined video as a text file of the same name. */
  transcriptFile?: boolean
  /** Sharpen the picture a little: a light grain cleanup, then a light sharpen. */
  sharpen?: boolean
  /** Encode on the graphics card: faster, a little larger. Made the usual way where the card cannot. */
  fast?: boolean
  /**
   * The video's name, without its extension, as typed in the Export window, in
   * place of the one it would be given. One video of one sequence only.
   */
  fileName?: string
}

/** Plan 96: a clip saved into the assets folder, or why it was not. */
export interface SavedAsset {
  ok: boolean
  path?: string
  kind?: AssetKind
  error?: string
}

/** What an export would write, worked out without writing anything. */
export interface ExportPreview {
  /** Every file it would write, in order. */
  outputs: string[]
  /** Those of them that are already there. */
  existing: string[]
  /** Sequences left out because there is nothing on them, by name. */
  empty: string[]
  /** Why it cannot run, when it cannot. */
  error?: string
}

export interface ExportResult {
  ok: boolean
  outputs: string[]
  /** A plain account of what went wrong. */
  error?: string
  /** ffmpeg's own words, for when the plain account is not enough. */
  details?: string
  /** Stopped because you asked, which is not a failure. */
  cancelled?: boolean
  /** Refused because another export is still running, which carries on. */
  busy?: boolean
  /** Something to know about a finished export, such as a transcript not written because nothing was said. */
  notes?: string[]
  /** Task 47: the lines the video's description must carry for the files it uses, none when empty. */
  credits?: string[]
}

/** How saving a transcript on its own ended. */
export interface TranscriptResult {
  ok: boolean
  /** The file written. */
  path?: string
  cancelled?: boolean
  error?: string
  details?: string
}

/** What the window shows about the open document besides its contents. */
export interface ProjectStatus {
  name: string
  path: string | null
  /** The edit differs from what is on disk. Where you are in it never counts. */
  changed: boolean
  /** Sources whose file cannot be found anywhere. */
  offline: string[]
  /** Sources being rebuilt because the app's cache no longer holds them. */
  rebuilding: string[]
}

/**
 * Everything a window needs when a whole document arrives: a new project, an
 * opened file, a restored recovery copy. `docId` names this document, so a
 * workspace sent for the one before it can be told apart and ignored.
 */
export interface OpenedDocument {
  docId: number
  project: Project
  workspace: Workspace
  status: ProjectStatus
}

/** What the Recent menu offers to go back to (plan 84): the open project's versions, newest first, and work never saved. */
export interface EarlierVersions {
  name: string
  versions: KeptVersion[]
  unsaved: KeptVersion[]
}

export interface RecentProject {
  path: string
  name: string
  /** False once the file has been moved or deleted. */
  exists: boolean
}

/** Whether the speech engine is on this computer, and whether it is being downloaded now. */
export interface SpeechStatus {
  ready: boolean
  downloading: boolean
}

/** How far the speech engine's download, or a transcription, has got. */
export interface SpeechProgress {
  stage: 'download' | 'transcribe'
  /** 0 to 1. */
  fraction: number
}

/** How a download of the speech engine ended. */
export interface SpeechDownloadResult {
  ok: boolean
  /** Stopped because you asked, which is not a failure. */
  cancelled?: boolean
  error?: string
}

/** The words heard in a sequence, at its frames, or why there are none. */
export interface TranscribeResult {
  ok: boolean
  words?: TimedWord[]
  /** Which listening the words came from, to pass back with them when they are put on the sequence. */
  heardId?: string
  cancelled?: boolean
  error?: string
  /** What the engine or ffmpeg said, for when the plain account is not enough. */
  details?: string
}

/** The app's own settings, kept with its keymap rather than in any project. */
/** A voice over take, stopped and saved: its WAV, and the source it became, or why it did not. */
export interface FinishedTake {
  path: string
  asset: MediaAsset | null
  why?: string
}

export interface AppSettings {
  /** Save a project that has a file on its own, a little after each change. */
  saveAutomatically: boolean
  /** The microphone a voice over is recorded from, by the id the window knows it by, or null for the system's default. */
  microphoneId: string | null
  /** Whether the sequence plays silent while a voice over is recorded, for recording without headphones. */
  muteWhileRecording: boolean
  /**
   * How long the next transition you add will be, in seconds, and which kind
   * it will be: whatever you last left one at. Premiere calls this a
   * preference and puts it in a dialog; a figure that learns from what you do
   * needs no dialog. Yours rather than a project's, so it follows you.
   */
  transitionSeconds: number
  transitionPictureKind: string
  transitionSoundKind: string
  /**
   * Put a transition on every cut as it is made, rather than only where one is
   * asked for. Off unless it is turned on: a cut is a cut until you say
   * otherwise, and this is the kind of setting that surprises anyone who
   * forgot it was on.
   *
   * Only the cuts an edit makes. Existing cuts are left alone, and one taken
   * off stays off.
   */
  transitionOnEveryCut: boolean
  /**
   * Your own folders in Sources, in their order, the same in every project.
   * Recordings among them follows OBS's own folder when it has none chosen.
   */
  sourceFolders: SourceFolder[]
  /** Task 47: files marked by hand as needing a credit in a video's description, by path, with the line. */
  credits: Record<string, string>
  /**
   * Where an export goes in a project that has not chosen a folder of its
   * own, or null for beside the project file. A project that has exported
   * keeps the folder it used.
   */
  exportFolder: string | null
  /** One file or one per clip, for a project that has never been exported. */
  exportMode: 'join' | 'batch'
  /** How files are named, for a project that has never been exported. */
  exportPattern: string
  /** What to do when a file an export would write is already there: ask, or do this without asking. */
  exportExisting: 'ask' | 'replace' | 'keepBoth'
  /** Show the exported file in its folder when an export finishes. */
  showAfterExport: boolean
  /** Framings saved under a name, applied to any picture clip in one click, in any project. */
  savedLayouts: SavedLayout[]
  /** Shape styles saved under a name, offered in the Shape menu of every project. */
  savedShapes: SavedShape[]
  /** Plan 99: caption styles saved under a name, for the captions of every project. */
  savedCaptionStyles: SavedCaptionStyle[]
  /** And text styles, for the texts of every project, kept apart from the caption ones. */
  savedTextStyles: SavedTextStyle[]
  /** The shape last chosen for a sequence, which a new project starts on. */
  lastShape: string
  /**
   * Bugs and notes 2, note 26: how the text last changed looks, which a new
   * text starts as, in any project. Null until a text has been changed. Its
   * words are not kept: a new text still says "Your text".
   */
  textStyle: TextStyle | null
  /**
   * Plan 93: the framing of the recording last framed, in any project, with
   * the width and height of its recording. Given to a recording of that size
   * put on a project where nothing is framed yet, and offered for any other.
   */
  lastFraming: Framing | null
}

/** A recovery copy the app is offering to restore after it did not close cleanly. */
/**
 * Something main needs you to know.
 *
 * `waits` decides which of the window's two ways of saying it is used. One
 * that waits keeps an OK and stays until it is pressed; one that does not
 * fades by itself like any other passing notice.
 *
 * The split is by what the message is for, not by how bad it sounds. Something
 * that simply refused to happen can fade: nothing was lost and nothing is being
 * asked of you. Something that reports work at risk, or that needs a decision,
 * waits, because a message about work you might lose must not go by while you
 * are looking somewhere else.
 */
export interface Notice {
  text: string
  waits: boolean
}

export interface RecoveryOffer {
  name: string
  /** When the copy was written, in milliseconds since 1970. */
  writtenAt: number
  /** Offered at an earlier launch and never restored or discarded, rather than left by a crash just now. */
  unanswered: boolean
}

export interface EditbayApi {
  ffmpegStatus(): Promise<FfmpegStatus>
  /** Whether an export can be encoded on the graphics card here. */
  exportOnGpu(): Promise<boolean>
  /**
   * A recording's lighter copy for the preview, made if it is not there yet:
   * its path, or null for a source that gets none or a copy that failed.
   */
  lighterCopy(mediaId: string): Promise<string | null>
  /** The plain background the picture a clip starts on, `from` seconds into its source, stands on: green, blue, black or another colour (plan 98). */
  mediaBackground(mediaId: string, from: number): Promise<FoundBackground | null>
  /** The faces on a recording from `from` to `to` seconds, each sample on a frame at `fps` (plan 100, Follow face). */
  mediaFaces(mediaId: string, from: number, to: number, fps: number): Promise<FacesFound>
  /** Stop making lighter copies, the one being made and those waiting: they are no longer wanted. */
  stopLighterCopies(): Promise<void>
  pickFiles(): Promise<string[]>
  importFiles(paths: string[]): Promise<MediaAsset[]>
  listAssets(): Promise<MediaAsset[]>
  pathForFile(file: File): string
  onImportProgress(handler: (p: ImportProgress) => void): () => void
  onAssetChanged(handler: (a: MediaAsset) => void): () => void
  /** A source that left the bin: cancelled, or removed. */
  onAssetRemoved(handler: (id: string) => void): () => void
  /** Take a waiting import off the queue, or stop one that is under way, and drop its card. */
  cancelImport(id: string): Promise<void>
  /** Import a source that failed again, under the same id. */
  retryImport(id: string): Promise<void>
  /**
   * Take a source out of the bin and the project, when no clip in any
   * sequence uses it or it failed. The file on disk is untouched. False when
   * it is in use.
   */
  removeSource(id: string): Promise<boolean>
  /** Show a source's own file in its folder. */
  showSource(id: string): Promise<void>

  /** The newest recordings in the Recordings entry's folder, or OBS's. */
  recordings(): Promise<RecordingsListing>
  /** Ask for another folder for Recordings, bringing Recordings back to Sources if it was taken out. Null when nothing was chosen. */
  chooseRecordingsFolder(): Promise<RecordingsListing | null>
  /** A recording that appeared while the app was open, and has finished. */
  onRecordingFinished(handler: (r: Recording) => void): () => void

  /** One level of one of your folders in Sources, by the entry's id and the path under its folder ('' for the folder itself). */
  listFolder(id: string, under: string): Promise<FolderListing>
  /** The files named with `words` in one of your folders and below it. */
  searchFolder(id: string, words: string): Promise<FolderSearch>
  /**
   * Task 103: media files copied into a folder of a Sources entry, `under` a
   * path below it, the originals left where they are. A name already taken
   * there gets " (2)" and so on rather than being replaced. The copies' paths.
   */
  copyIntoFolder(id: string, under: string, paths: string[]): Promise<string[]>
  /** Ask for a folder to add to Sources, or to point an entry at, starting in `from` when given. Null when nothing was chosen. */
  pickSourceFolder(from?: string): Promise<string | null>
  /** Task 44: a suggested free pack's page opened in the browser, by its id. */
  openPack(id: string): Promise<boolean>
  /** Whether a file in the effects folder stands on a green, blue or black background (plan 90). */
  effectBackground(path: string): Promise<BackgroundColour | null>

  currentProject(): Promise<Project>
  /** The open document in full, for a window that is just starting. */
  session(): Promise<OpenedDocument>
  /** Edits and undo name the document they were made in, and are dropped if it is no longer open. */
  /**
   * `continuing` marks a later movement of a drag, whose first movement
   * recorded the undo point. Main works out where the other rows go from the
   * document as it was when the drag began, not from the last movement.
   */
  applyEdit(docId: number, edit: ProjectEdit, continuing?: boolean): Promise<Project>
  setProject(docId: number, project: Project): Promise<Project>
  /** False when you chose to keep the current project instead. */
  /** Something in the window broke while drawing: main is told, so the next launch does not open this project by itself. */
  windowCrashed(detail: string): Promise<void>
  newProject(): Promise<boolean>
  /** Open `path`, or ask for one. False when nothing was opened. */
  openProject(path?: string): Promise<boolean>
  saveProject(saveAs: boolean): Promise<string | null>
  /** Call the document something, from the top bar. Empty or unchanged does nothing. */
  renameProject(name: string): Promise<void>
  /** One audio track's waveform, the first unless `track` names another, counted from 0. */
  loadPeaks(mediaId: string, track?: number): Promise<PeaksData>
  /** Keep a text's drawn picture in the cache under its key, and say where it went. */
  saveText(key: string, png: Uint8Array): Promise<string>
  /** Which of these drawn texts' pictures are not on disk, as after the cache is cleared. */
  missingTexts(paths: string[]): Promise<string[]>
  relinkMedia(mediaId: string): Promise<Project>
  onProjectChanged(handler: (p: Project) => void): () => void
  onProjectOpened(handler: (d: OpenedDocument) => void): () => void
  onProjectStatus(handler: (s: ProjectStatus) => void): () => void
  setWorkspace(docId: number, workspace: Workspace): Promise<void>

  recentProjects(): Promise<RecentProject[]>
  forgetRecent(path: string): Promise<RecentProject[]>
  /** The open project's earlier versions, and the unsaved work of projects never saved (plan 84). */
  earlierVersions(): Promise<EarlierVersions>
  /** Open an earlier version in place of the open document, as changed. False when it was not opened. */
  openEarlierVersion(id: string): Promise<boolean>
  recoveryOffer(): Promise<RecoveryOffer | null>
  restoreRecovery(): Promise<void>
  discardRecovery(): Promise<void>
  /** Messages for you that have not been shown yet. Each is handed out once. */
  takeNotices(): Promise<Notice[]>
  onNotice(handler: () => void): () => void

  /** Ask for a folder, starting in `from` when given. */
  pickExportFolder(from?: string): Promise<string | null>
  /** Where an export goes when none has been chosen: beside the project file, or in Videos. */
  defaultExportFolder(): Promise<string>
  previewExport(request: ExportRequest): Promise<ExportPreview>
  startExport(request: ExportRequest): Promise<ExportResult>
  /** The frame at `frame` as a PNG in `outputDir`, as the export would draw it: a cover image. */
  /** Plan 96: these clips of the sequence saved into the assets folder as they play. */
  saveAsAsset(sequenceId: string, clipIds: string[]): Promise<SavedAsset>
  saveFrame(request: { sequenceId: string; frame: number; outputDir: string; sharpen?: boolean }): Promise<{ ok: boolean; path?: string; error?: string }>
  /**
   * The transcript of a sequence, or of part of it, alone as a `.txt` in
   * `outputDir`, never over a file already there: from its captions, or
   * listened to when it has none. Stopped by `cancelExport`.
   */
  saveTranscript(request: { sequenceId: string; range?: { from: number; to: number }; outputDir: string; fileName?: string }): Promise<TranscriptResult>
  cancelExport(): Promise<void>
  revealPath(path: string): Promise<void>
  /** Open a file in the program Windows opens it with. */
  openPath(path: string): Promise<void>
  copyText(text: string): Promise<void>
  onExportProgress(handler: (p: ExportProgress) => void): () => void

  loadKeymap(): Promise<Overrides>
  saveKeymap(overrides: Overrides): Promise<Overrides>

  appSettings(): Promise<AppSettings>
  /** Change some of the app's settings. Resolves to all of them, as kept. */
  setAppSettings(change: Partial<AppSettings>): Promise<AppSettings>
  /** The figures a font installed on this PC is laid out by, for captions, or null when it is not installed. */
  captionFontFor(family: string): Promise<FontFigures | null>
  /** How many bytes the media cache takes on the disk. */
  cacheSize(): Promise<number>
  /** Remove from the media cache all that the open project does not use. Resolves to the bytes freed. */
  freeCache(): Promise<number>

  /** Start saving a voice over take at the microphone's rate. Resolves to the path its WAV will have. */
  voiceBegin(sampleRate: number): Promise<string>
  /** Add 16-bit mono samples to the take. */
  voiceChunk(samples: Uint8Array): Promise<void>
  /**
   * Stop the take, make its WAV, `drop` samples left off its head or `pad` of
   * silence put before it, and import it into the project it was begun on.
   * Null when nothing was being recorded, or nothing was left of it.
   */
  voiceFinish(line: { drop: number; pad: number }): Promise<FinishedTake | null>
  /** Throw the take away. */
  voiceCancel(): Promise<void>

  speechStatus(): Promise<SpeechStatus>
  /** Download the speech engine and its model, once, checked against what the app expects. */
  downloadSpeech(): Promise<SpeechDownloadResult>
  cancelSpeechDownload(): Promise<void>
  /** Listen to a sequence's sound on these audio tracks, and give back every word heard, at its frames. */
  /** Listen to a sequence on these tracks, the whole of it or only these stretches. */
  transcribe(sequenceId: string, trackIds: string[], stretches?: Stretch[]): Promise<TranscribeResult>
  cancelTranscribe(): Promise<void>
  onSpeechProgress(handler: (p: SpeechProgress) => void): () => void
}

declare global {
  interface Window {
    api: EditbayApi
  }
}
