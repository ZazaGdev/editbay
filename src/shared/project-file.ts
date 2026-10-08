import { cleanShapeStyle } from './shape'
import { cleanAppear } from './appear'
import type { PlatformPath } from 'node:path'
import {
  SCHEMA_VERSION,
  SIMPLE_EASES,
  DEFAULT_PRESET_ID,
  FIRST_SEQUENCE_ID,
  A1_ID,
  V1_ID,
  EASES,
  cleanOverlay,
  cleanPictureStyle,
  settleKeys,
  shapeName,
  trackCount,
  type AudioTrack,
  type Clip,
  type Ease,
  type GroupFrame,
  type Layer,
  type ZoomKey,
  type Project,
  type ProjectMedia,
  type Rect,
  type Sequence,
  type SequenceMarks,
  type SoundClip,
  type VideoTrack
} from './project'
import { FULL_PLACE, isFullFrame, type LayoutKind, type Place } from './layout'
import { cleanMark } from './marks'
import { cleanCare } from './voice-care'
import { cleanAdjust, cleanBackground, cleanLook, cleanStrength } from './looks'
import { cleanAmount, cleanBoxes } from './blur'
import { cleanTextStyle } from './text'
import { cleanColour } from './project'
import { cleanTransition, type KindSet } from './transitions'
import { cleanTrackName } from './tracks'
import { cleanCaptionAt, cleanCaptionStyle, emptyCaptions, type CaptionClip, type Captions } from './captions'
import { cleanMarkers } from './markers'
import { isVoiceStrength } from './voice'
import { PRESETS } from './presets'
import { cleanWorkspace, type Workspace } from './workspace'
import { cleanBoxKeys } from './box-keys'

/**
 * The `.editbay` file: the project and the workspace, joined on write and
 * split on read.
 *
 * In memory the two stay apart. The project is what edits and undo work on;
 * the workspace is where you are in it. Only the file holds both.
 *
 * Path arithmetic is handed in rather than imported, so this module stays free
 * of Node and the tests can pin it to Windows rules on any machine.
 */

export type PathApi = Pick<PlatformPath, 'relative' | 'resolve' | 'parse' | 'isAbsolute' | 'dirname'>

export interface ProjectFile {
  project: Project
  workspace: Workspace
  /** Where each source was relative to the project file when it was saved, by media id. */
  relativePaths: Map<string, string>
  /** The schema the file was written with, before it was brought up to date. */
  fileSchema: number
}

/** Where the file is being written, so sources on the same drive can be stored relative to it. */
export interface FileLocation {
  path: PathApi
  projectPath: string
}

/**
 * `target` relative to the folder `projectDir`, or null when there is no such
 * path. Windows cannot express a path on another drive relative to this one,
 * so those stay absolute.
 */
export function relativeMediaPath(path: PathApi, projectDir: string, target: string): string | null {
  if (!path.isAbsolute(target) || !path.isAbsolute(projectDir)) return null
  if (path.parse(target).root.toLowerCase() !== path.parse(projectDir).root.toLowerCase()) return null
  const rel = path.relative(projectDir, target)
  return rel === '' ? null : rel
}

/**
 * Where to look for a source's original, best first: beside the project file
 * where it was saved relative to it, then where it was when saved. Moving a
 * folder that holds both the project and its footage then just works.
 */
export function mediaPathCandidates(
  path: PathApi,
  projectPath: string,
  originalPath: string,
  relativePath: string | undefined
): string[] {
  const out: string[] = []
  if (relativePath) out.push(path.resolve(path.dirname(projectPath), relativePath))
  if (!out.some((p) => p.toLowerCase() === originalPath.toLowerCase())) out.push(originalPath)
  return out
}

/**
 * A source whose original turned up at `found`. A file that plays as it is
 * moves with it; a conformed one keeps playing from the cache.
 */
export function withOriginalAt(m: ProjectMedia, found: string): ProjectMedia {
  if (found === m.originalPath) return m
  return m.conformed ? { ...m, originalPath: found } : { ...m, originalPath: found, playablePath: found }
}

/**
 * The file's text. Sources on the project's drive also carry a path relative
 * to it. Cache paths never do: they are rebuilt when missing rather than found.
 */
export function joinProjectFile(project: Project, workspace: Workspace, location?: FileLocation): string {
  const media = project.media.map((m) => {
    if (!location) return m
    const rel = relativeMediaPath(location.path, location.path.dirname(location.projectPath), m.originalPath)
    return rel === null ? m : { ...m, relativePath: rel }
  })
  return JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION, media, workspace }, null, 2)
}

const DEFAULT_OUTPUT = { width: 1080, height: 1920 }

function validShape(presetId: unknown): string {
  // Saved before the shape was a setting, or naming one that has since been
  // retired: vertical is what those projects were effectively using.
  return typeof presetId === 'string' && PRESETS.some((x) => x.id === presetId) ? presetId : DEFAULT_PRESET_ID
}

function validOutput(output: unknown): { width: number; height: number } {
  const o = output as { width?: unknown; height?: unknown } | null | undefined
  return o && typeof o.width === 'number' && typeof o.height === 'number' ? { width: o.width, height: o.height } : DEFAULT_OUTPUT
}

/** Whether a stored value has x, y, w and h. */
function isRectLike(r: unknown): boolean {
  const x = r as Partial<Place> | null
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.x === 'number' &&
    typeof x.y === 'number' &&
    typeof x.w === 'number' &&
    typeof x.h === 'number'
  )
}

function isLayer(l: unknown): l is Layer {
  const x = l as Partial<Layer> | null
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    isRectLike(x.crop) &&
    isRectLike(x.place) &&
    // Its own zoom, checked as the main picture's is: a damaged one is refused with the file.
    areKeysOrAbsent(x.keys)
  )
}

const LAYOUTS: LayoutKind[] = ['single', 'split', 'pip', 'custom']

/** Whether a stored clip is placed somewhere: an id, a source, a stretch of it and a start. */
function isSpan(c: unknown): boolean {
  const x = c as Partial<SoundClip> | null
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    typeof x.mediaId === 'string' &&
    typeof x.sourceIn === 'number' &&
    typeof x.sourceOut === 'number' &&
    typeof x.timelineStart === 'number' &&
    (x.link === undefined || typeof x.link === 'string')
  )
}

/** A group's framing as a file stores it. */
function isGroupFrame(f: unknown): f is GroupFrame {
  const x = f as Partial<GroupFrame> | null
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.mediaId === 'string' &&
    isRectLike(x.crop) &&
    isRectLike(x.place) &&
    areKeysOrAbsent(x.keys) &&
    (x.simple === undefined || SIMPLE_EASES.includes(x.simple))
  )
}

/** A clip on a video track as schema 6 stores it. */
function isVideoClip(c: unknown): c is Clip {
  const x = c as Partial<Clip> | null
  return (
    isSpan(c) &&
    typeof x?.transform?.crop?.w === 'number' &&
    isRectLike(x.transform.place) &&
    Array.isArray(x.layers) &&
    x.layers.every(isLayer) &&
    isZoomOrAbsent((x.transform as { zoom?: unknown }).zoom) &&
    areKeysOrAbsent(x.transform.keys) &&
    LAYOUTS.includes(x.layout as LayoutKind)
  )
}

/**
 * A clip's one move, as a file up to schema 9 stores it: the crop it ends on,
 * the frame of the clip it begins at, and how many frames it takes, 0 for a
 * cut. Its start is the clip's own crop. Opened, it becomes zoom keyframes.
 */
interface OldZoom {
  crop: Rect
  at: number
  length: number
}

/**
 * A clip's old move, as a file stores it, or nothing for a clip that stays
 * still. A damaged one is refused with the file rather than dropped: dropped,
 * the move would be gone for good at the next save.
 */
function isZoomOrAbsent(z: unknown): boolean {
  if (z === undefined) return true
  const x = z as Partial<OldZoom> | null
  return typeof x?.at === 'number' && typeof x.length === 'number' && x.length >= 0 && isRectLike(x.crop)
}

/**
 * A clip's zoom keyframes, as a file stores them, or none. A damaged one is
 * refused with the file, as a damaged move is.
 */
function areKeysOrAbsent(keys: unknown): boolean {
  if (keys === undefined) return true
  return (
    Array.isArray(keys) &&
    keys.every((k) => {
      const x = k as Partial<ZoomKey> | null
      return (
        typeof x === 'object' &&
        x !== null &&
        typeof x.at === 'number' &&
        Number.isFinite(x.at) &&
        isRectLike(x.crop) &&
        (x.ease === undefined || EASES.includes(x.ease as Ease))
      )
    })
  )
}

/**
 * A video clip's zoom as it is kept now. Keyframes stored are put in order,
 * one to a frame, on whole frames. A move from a file up to schema 9 becomes
 * keyframes on the recording's frames that give the same crop on every frame
 * of the clip, eased as it was:
 *
 * - a move with a length: a keyframe where it begins, on the clip's crop,
 *   and one where it ends, on the move's crop;
 * - a cut part way in: a keyframe on the clip's first frame, on its crop,
 *   that holds, and one on the cut's frame, on the move's crop;
 * - a cut on the first frame: no keyframes, and the clip's crop becomes the
 *   move's, which is all that clip ever showed.
 *
 * A move that went nowhere was drawn as no move, and stays none.
 */
function keyedClip(c: Clip): Clip {
  const { zoom, keys: stored, simple: storedSimple, boxKeys: storedBox, ...plainTransform } = c.transform as Clip['transform'] & { zoom?: OldZoom }
  // The box's keyframes (plan 97) tidied, and dropped when none make sense.
  const box = cleanBoxKeys(storedBox)
  const kept = box ? { ...plainTransform, boxKeys: box } : plainTransform
  // A Simple zoom's mark is kept only when it is one: anything else opens as keyframes put by hand.
  const transform = storedSimple !== undefined && SIMPLE_EASES.includes(storedSimple) ? { ...kept, simple: storedSimple } : kept
  let keys: ZoomKey[] = []
  let crop = transform.crop
  if (stored !== undefined) {
    keys = keysInOrder(stored)
  } else if (zoom !== undefined) {
    const d = Math.max(
      Math.abs(zoom.crop.x - crop.x),
      Math.abs(zoom.crop.y - crop.y),
      Math.abs(zoom.crop.w - crop.w),
      Math.abs(zoom.crop.h - crop.h)
    )
    if (d >= 1) {
      if (zoom.length > 0) {
        keys = [
          { at: c.sourceIn + zoom.at, crop },
          { at: c.sourceIn + zoom.at + zoom.length, crop: zoom.crop }
        ]
      } else if (zoom.at > 0) {
        keys = [
          { at: c.sourceIn, crop, ease: 'hold' },
          { at: c.sourceIn + zoom.at, crop: zoom.crop }
        ]
      } else {
        crop = zoom.crop
      }
    }
  }
  // A further picture's own zoom, which only files from after it could have one hold.
  const layers = c.layers.map((l) => {
    const { keys: lk, simple: ls, boxKeys: lb, ...rest } = l
    const inOrder = lk === undefined ? [] : keysInOrder(lk)
    const layerBox = cleanBoxKeys(lb)
    return {
      ...rest,
      ...(layerBox ? { boxKeys: layerBox } : {}),
      ...(inOrder.length > 0 ? { keys: inOrder } : {}),
      ...(inOrder.length > 0 && ls !== undefined && SIMPLE_EASES.includes(ls) ? { simple: ls } : {})
    }
  })
  return settleKeys({ ...c, transform: { ...transform, crop, ...(keys.length > 0 ? { keys } : {}) }, layers })
}

/** Keyframes as stored, put in order, one to a frame, on whole frames, a Smooth ease left unsaid. */
function keysInOrder(stored: readonly ZoomKey[]): ZoomKey[] {
  const byFrame = new Map<number, ZoomKey>()
  for (const k of stored) {
    const at = Math.round(k.at)
    byFrame.set(at, { at, crop: k.crop, ...(k.ease !== undefined && k.ease !== 'smooth' ? { ease: k.ease } : {}) })
  }
  return [...byFrame.values()].sort((a, b) => a.at - b.at)
}

/** Every clip on these video tracks with its zoom as it is kept now. */
function keyedTracks(tracks: VideoTrack[]): VideoTrack[] {
  return tracks.map((r) => ({ ...r, clips: r.clips.map(keyedClip) }))
}

function isSoundClip(c: unknown): c is SoundClip {
  const x = c as Partial<SoundClip> | null
  return isSpan(c) && typeof x?.track === 'number' && typeof x.gain === 'number' && typeof x.muted === 'boolean'
}

/**
 * A sequence's tracks of one kind, as schema 6 stores them. A damaged one is
 * refused with the file: dropped, it would be gone for good at the next save.
 */
function validTracks<T>(raw: unknown, isClip: (c: unknown) => c is T, kinds: KindSet): { id: string; clips: T[] }[] {
  const ok =
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((r) => {
      const x = r as { id?: unknown; clips?: unknown } | null
      return typeof x === 'object' && x !== null && typeof x.id === 'string' && Array.isArray(x.clips) && x.clips.every(isClip)
    }) &&
    new Set(raw.map((r) => (r as { id: string }).id)).size === raw.length
  if (!ok) throw new Error('this project has a damaged track in it')
  return (raw as { id: string; clips: T[]; muted?: unknown; locked?: unknown; name?: unknown; hidden?: unknown; duck?: unknown }[]).map((r) => ({
    id: r.id,
    // A mark naming a colour the app no longer has is dropped rather than
    // refused: a colour taken out of the list must never stop a project
    // opening, and an undrawable mark is the same as none.
    clips: r.clips.map((c) => {
      const mark = cleanMark((c as { mark?: unknown }).mark)
      // A damaged transition is no transition on that edge, as a damaged mark
      // is no mark: the cut it decorated is still there and the file opens.
      const stored = c as { transitionIn?: unknown; transitionOut?: unknown }
      const into = cleanTransition(stored.transitionIn, kinds)
      const outOf = cleanTransition(stored.transitionOut, kinds)
      // `effects` was an empty list nothing ever wrote to, taken out at schema
      // 9. Dropped on the way in, so a file saved again does not carry it on.
      const { effects: _gone, look: storedLook, lookStrength: storedStrength, adjust: storedAdjust, blur: storedBlurAmount, blurBoxes: storedBoxes, denoise: storedDenoise, voice: storedVoice, blurFill: storedBlur, removeBackground: storedRemoval, ...rest } = c as Record<string, unknown>
      // A blurred background is on or absent, and only a picture has one; a
      // picture's frame is tidied, and dropped where it does nothing.
      const blurFill = kinds === 'picture' && storedBlur === true ? { blurFill: true } : {}
      const layers = Array.isArray(rest.layers)
        ? {
            layers: (rest.layers as Record<string, unknown>[]).map((l) => {
              const { style: storedStyle, ...plain } = l
              const style = cleanPictureStyle(storedStyle)
              return style ? { ...plain, style } : plain
            })
          }
        : {}
      // Clean up noise is on or absent, and only a sound has it.
      const denoise = kinds === 'sound' && storedDenoise === true ? { denoise: true } : {}
      // Enhance voice is one of its strengths or absent, and only a sound has it.
      const voice = kinds === 'sound' && isVoiceStrength(storedVoice) ? { voice: storedVoice } : {}
      // A look the app no longer has is dropped, as a mark is: the clip's
      // picture is still there in its own colour. Only a picture has one.
      const look = kinds === 'picture' ? cleanLook(storedLook) : undefined
      // Its strength and the four sliders, tidied, and dropped where they do nothing (plan 85).
      const lookStrength = look !== undefined ? cleanStrength(storedStrength) : undefined
      const removal = kinds === 'picture' ? cleanBackground(storedRemoval) : undefined
      const adjust = kinds === 'picture' ? cleanAdjust(storedAdjust) : undefined
      // Blur on the whole picture and in boxes, tidied, and dropped where damaged (plan 85).
      const blurAmount = kinds === 'picture' ? cleanAmount(storedBlurAmount) : undefined
      const blurBoxes = kinds === 'picture' ? cleanBoxes(storedBoxes) : undefined
      // An overlay's turn and opacity, tidied, and dropped where they do nothing.
      const transform = rest.transform as ({ rotation?: unknown; opacity?: unknown } & Record<string, unknown>) | undefined
      const picture =
        kinds === 'picture' && transform
          ? (() => {
              const { rotation: _r, opacity: _o, style: storedStyle, ...kept } = transform
              const style = cleanPictureStyle(storedStyle)
              return { transform: { ...kept, ...cleanOverlay(transform), ...(style ? { style } : {}) } }
            })()
          : {}
      // A text's or a picture's coming in and going out, dropped when damaged.
      const { enter: storedEnter, exit: storedExit } = rest
      delete rest.enter
      delete rest.exit
      const enter = kinds === 'picture' ? cleanAppear(storedEnter) : undefined
      const exit = kinds === 'picture' ? cleanAppear(storedExit) : undefined
      // A group's id, and on a picture its framing (plan 80): a damaged one
      // is dropped, the group then framed again from what its pieces show.
      const { group: storedGroup, groupFrame: storedFrame } = rest
      delete rest.group
      delete rest.groupFrame
      const group = typeof storedGroup === 'string' && storedGroup !== '' ? { group: storedGroup } : {}
      const groupFrame = kinds === 'picture' && typeof storedGroup === 'string' && isGroupFrame(storedFrame) ? { groupFrame: storedFrame } : {}
      return {
        ...group,
        ...groupFrame,
        ...rest,
        ...layers,
        ...picture,
        ...denoise,
        ...voice,
        ...blurFill,
        mark,
        ...(look === undefined ? {} : { look }),
        ...(lookStrength === undefined ? {} : { lookStrength }),
        ...(adjust === undefined ? {} : { adjust }),
        ...(removal === undefined ? {} : { removeBackground: removal }),
        ...(blurAmount === undefined ? {} : { blur: blurAmount }),
        ...(blurBoxes === undefined ? {} : { blurBoxes }),
        ...(enter ? { enter } : {}),
        ...(exit ? { exit } : {}),
        transitionIn: into,
        transitionOut: outOf
      } as T
    }),
    // Absent unless set: a file written before these existed reads the same
    // as one that says false, and neither carries a key it does not need.
    ...(r.muted === true ? { muted: true } : {}),
    ...(r.locked === true ? { locked: true } : {}),
    ...(r.hidden === true ? { hidden: true } : {}),
    // Only a sound track ducks.
    ...(r.duck === true && kinds === 'sound' ? { duck: true } : {}),
    ...(cleanTrackName(r.name) === undefined ? {} : { name: cleanTrackName(r.name)! })
  }))
}

function isCaptionClip(c: unknown): c is CaptionClip {
  const x = c as Partial<CaptionClip> | null
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    typeof x.timelineStart === 'number' &&
    typeof x.length === 'number' &&
    Array.isArray(x.words) &&
    x.words.every((w) => {
      const y = w as Partial<CaptionClip['words'][number]> | null
      return typeof y === 'object' && y !== null && typeof y.text === 'string' && typeof y.start === 'number' && typeof y.length === 'number'
    })
  )
}

/**
 * A sequence's captions as schema 7 stores them. Damaged captions are refused
 * with the file, as a damaged track is: dropped, they would be gone for good
 * at the next save.
 */
function validCaptions(raw: unknown): Captions {
  if (raw === undefined) return emptyCaptions()
  const x = raw as Partial<Captions> | null
  if (typeof x !== 'object' || x === null || !Array.isArray(x.clips) || !x.clips.every(isCaptionClip)) {
    throw new Error('this project has damaged captions in it')
  }
  return {
    // A position that cannot be read is dropped and the caption follows the
    // style: where it sat is a nicety, unlike its words.
    clips: x.clips.map((c) => {
      const { at, ...rest } = c
      const clean = at === undefined ? null : cleanCaptionAt(at)
      return clean ? { ...rest, at: clean } : rest
    }),
    style: cleanCaptionStyle(x.style),
    listenTo: Array.isArray(x.listenTo) ? x.listenTo.filter((id): id is string => typeof id === 'string') : [],
    edited: x.edited === true
  }
}

/** One of the recording's tracks a clip played before schema 6, and how loud. */
interface TrackLevel {
  index: number
  gain: number
}

function isTrackLevel(t: unknown): t is TrackLevel {
  const x = t as Partial<TrackLevel> | null
  return typeof x === 'object' && x !== null && typeof x.index === 'number' && typeof x.gain === 'number'
}

/** A V1 clip as files before schema 6 store it: with a sound of its own. */
type OldClip = Omit<Clip, 'link'> & { audio: { gain: number; muted: boolean; tracks: TrackLevel[] } }

/**
 * Whether a clip stored before schema 6 has what the editor reads from it. A
 * damaged one is refused with the file: opened, it would stop the window
 * drawing, and every launch after would reopen it.
 */
function isOldClip(c: unknown): boolean {
  const x = c as Partial<OldClip> | null
  return isSpan(c) && typeof x?.transform?.crop?.w === 'number' && typeof x.audio?.gain === 'number'
}

/**
 * A stored V1 clip from before schema 6 brought up to date as it stood then.
 * One from before layers has its main picture fill the frame, no layers and
 * the Single layout; one from before a clip could choose its recording's
 * tracks plays its first. A damaged layer, place or choice of tracks is
 * refused with the file, as a damaged clip is.
 */
function upToDateClip(c: OldClip): OldClip {
  const stored = c as OldClip & {
    transform: { place?: unknown; zoom?: unknown }
    layers?: unknown
    layout?: unknown
    audio: { tracks?: unknown }
  }
  const tracks = stored.audio.tracks
  if (tracks !== undefined && (!Array.isArray(tracks) || !tracks.every(isTrackLevel))) {
    throw new Error('this project has a damaged clip in it')
  }
  const place = stored.transform.place
  if (place !== undefined && !isRectLike(place)) throw new Error('this project has a damaged clip in it')
  if (!isZoomOrAbsent(stored.transform.zoom)) throw new Error('this project has a damaged clip in it')
  if (!areKeysOrAbsent((stored.transform as { keys?: unknown }).keys)) throw new Error('this project has a damaged clip in it')
  const layers = stored.layers
  if (layers !== undefined && (!Array.isArray(layers) || !layers.every(isLayer))) {
    throw new Error('this project has a damaged layer in it')
  }
  const kept = (layers as Layer[] | undefined) ?? []
  const layout = LAYOUTS.includes(stored.layout as LayoutKind)
    ? (stored.layout as LayoutKind)
    : kept.length > 0
      ? 'custom'
      : 'single'
  return {
    ...c,
    transform: { ...c.transform, place: (place as Place | undefined) ?? FULL_PLACE },
    layers: kept,
    layout,
    audio: {
      gain: c.audio.gain,
      muted: typeof c.audio.muted === 'boolean' ? c.audio.muted : false,
      tracks: (tracks as TrackLevel[] | undefined) ?? [{ index: 0, gain: 1 }]
    }
  }
}

/** A clip on an audio row, as schema 5 stores it: a sound clip with no link. */
function isOldSoundClip(c: unknown): boolean {
  const x = c as Partial<SoundClip> | null
  return isSpan(c) && typeof x?.track === 'number' && typeof x.gain === 'number' && typeof x.muted === 'boolean'
}

/** A picture on a video row, as schema 5 stores it: a crop and a place, and nothing else. */
function isOldPicture(c: unknown): boolean {
  const x = c as { crop?: unknown; place?: unknown } | null
  return isSpan(c) && isRectLike(x?.crop) && isRectLike(x?.place)
}

/** Schema 5's rows of one kind; none in a file from before them. A damaged one is refused with the file. */
function oldRows<T>(rows: unknown, isClip: (c: unknown) => boolean): { id: string; clips: T[] }[] {
  if (rows === undefined) return []
  const ok =
    Array.isArray(rows) &&
    rows.every((r) => {
      const x = r as { id?: unknown; clips?: unknown } | null
      return typeof x === 'object' && x !== null && typeof x.id === 'string' && Array.isArray(x.clips) && x.clips.every(isClip)
    })
  if (!ok) throw new Error('this project has a damaged row in it')
  return rows as { id: string; clips: T[] }[]
}

/**
 * The tracks a sequence stored before schema 6 has now. V1's clips stay on
 * V1, one after another as they were, and each one's sound becomes linked
 * sound clips, one for each of its recording's tracks it played, heard
 * exactly as before: each at the clip's volume times the track's level, and
 * muted if the clip was. The first track a clip played goes on A1, the second
 * on A2, and so on; the audio rows follow them, so where no clip played more
 * than one track, A2 is still A2. The video rows keep their places above V1,
 * their pictures filling the frame on the Single layout, or Custom when they
 * do not. The new ids are made from the old ones, so opening the same file
 * twice gives the same document.
 */
function upgradedTracks(
  stored: { clips?: unknown; audioRows?: unknown; videoRows?: unknown },
  media: ProjectMedia[]
): { videoTracks: VideoTrack[]; audioTracks: AudioTrack[] } {
  const raw = stored.clips
  if (!Array.isArray(raw) || !raw.every(isOldClip)) throw new Error('this project has a damaged clip in it')
  const old = (raw as OldClip[]).map(upToDateClip)
  const sounds: SoundClip[][] = []
  let running = 0
  const v1: Clip[] = old.map((c) => {
    const m = media.find((x) => x.id === c.mediaId)
    const played = m ? c.audio.tracks.filter((t) => Math.round(t.index) >= 0 && Math.round(t.index) < trackCount(m)) : []
    const link = played.length > 0 ? c.id : undefined
    played.forEach((t, i) => {
      ;(sounds[i] ??= []).push({
        id: `${c.id}.${Math.round(t.index) + 1}`,
        mediaId: c.mediaId,
        track: Math.round(t.index),
        sourceIn: c.sourceIn,
        sourceOut: c.sourceOut,
        timelineStart: running,
        gain: c.audio.gain * t.gain,
        muted: c.audio.muted,
        ...(link !== undefined ? { link } : {})
      })
    })
    const { audio: _sound, ...picture } = c
    const clip: Clip = { ...picture, timelineStart: running, ...(link !== undefined ? { link } : {}) }
    running += c.sourceOut - c.sourceIn
    return clip
  })
  const pictures = oldRows<{ id: string; mediaId: string; sourceIn: number; sourceOut: number; timelineStart: number; crop: Clip['transform']['crop']; place: Place }>(
    stored.videoRows,
    isOldPicture
  ).map((r) => ({
    id: r.id,
    clips: r.clips.map(
      (c): Clip => ({
        id: c.id,
        mediaId: c.mediaId,
        sourceIn: c.sourceIn,
        sourceOut: c.sourceOut,
        timelineStart: c.timelineStart,
        transform: { mode: 'crop', crop: c.crop, place: c.place },
        layers: [],
        layout: isFullFrame(c.place) ? 'single' : 'custom'
      })
    )
  }))
  const rows = oldRows<SoundClip>(stored.audioRows, isOldSoundClip)
  // Named as a new sequence's are, unless an old row already has that name.
  const taken = new Set([V1_ID, ...rows.map((r) => r.id), ...pictures.map((r) => r.id)])
  const free = (base: string): string => {
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`
    taken.add(name)
    return name
  }
  const own: AudioTrack[] = (sounds.length > 0 ? sounds : [[]]).map((clips, i) => ({ id: free(i === 0 ? A1_ID : `a${i + 1}`), clips }))
  return {
    videoTracks: [{ id: V1_ID, clips: v1 }, ...pictures.map((r) => (r.id === V1_ID ? { ...r, id: free('v2') } : r))],
    audioTracks: [...own, ...rows]
  }
}

/** The range a sequence has marked, when it has one worth keeping. */
function storedMarks(raw: unknown): { marks?: SequenceMarks } {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>
  const frame = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
  const markIn = frame(r.in)
  const markOut = frame(r.out)
  const out = markOut !== undefined && (markIn === undefined || markOut > markIn) ? markOut : undefined
  if (markIn === undefined && out === undefined) return {}
  return { marks: { ...(markIn !== undefined ? { in: markIn } : {}), ...(out !== undefined ? { out } : {}) } }
}

/**
 * The sequences a file stores. One that is not whole is refused with the
 * file rather than dropped: dropped, it would be gone for good at the next
 * save, without anyone having chosen that.
 */
function storedSequences(raw: unknown[], schema: number, media: ProjectMedia[]): Sequence[] {
  const out: Sequence[] = []
  for (const item of raw) {
    const s = item as (Partial<Sequence> & { clips?: unknown; audioRows?: unknown; videoRows?: unknown }) | null
    const whole = schema >= 6 ? s !== null && typeof s === 'object' : Array.isArray(s?.clips)
    if (!s || typeof s.id !== 'string' || !whole || out.some((x) => x.id === s.id)) {
      throw new Error('this project has a damaged sequence in it')
    }
    const presetId = validShape(s.presetId)
    const read =
      schema >= 6
        ? {
            videoTracks: validTracks(s.videoTracks, isVideoClip, 'picture'),
            audioTracks: validTracks(s.audioTracks, isSoundClip, 'sound')
          }
        : upgradedTracks(s, media)
    const tracks = { ...read, videoTracks: keyedTracks(read.videoTracks) }
    out.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() !== '' ? s.name : shapeName(presetId),
      nameFollowsShape: typeof s.nameFollowsShape === 'boolean' ? s.nameFollowsShape : false,
      presetId,
      output: validOutput(s.output),
      ...tracks,
      // A file from before captions has none.
      captions: schema >= 7 ? validCaptions(s.captions) : emptyCaptions(),
      // Nor did one from before markers, and a damaged list of them is simply
      // no markers. A caption is content and its loss stops the file opening;
      // a marker is a note about the content and its loss is not worth that.
      markers: schema >= 8 ? cleanMarkers(s.markers) : [],
      // A damaged range is simply no range: it is a choice about the cut, not the cut.
      ...storedMarks(s.marks)
    })
  }
  return out
}

/**
 * Read a project file, checking it is one and bringing it up to date.
 * A document from a newer app is refused rather than half understood.
 *
 * A file from before sequences holds one timeline, which becomes the first
 * sequence, and where you were in it becomes where you are in that sequence.
 * A file saved before the workspace existed opens with the default one.
 */
export function splitProjectFile(text: string): ProjectFile {
  const raw = JSON.parse(text) as Record<string, unknown> & { workspace?: unknown }
  const hasSequences = Array.isArray(raw.sequences)
  if (typeof raw.schemaVersion !== 'number' || !Array.isArray(raw.media) || (!hasSequences && !Array.isArray(raw.clips))) {
    throw new Error('this file is not a Editbay project')
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`this project was made by a newer version of the app (schema ${raw.schemaVersion})`)
  }

  // A source that is not one at all, such as null, is refused in words, rather than with a TypeError.
  if (!(raw.media as unknown[]).every((m) => typeof m === 'object' && m !== null && typeof (m as { id?: unknown }).id === 'string' && (m as { id: string }).id !== '')) {
    throw new Error('this project has a damaged source in it')
  }
  const relativePaths = new Map<string, string>()
  const mark = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
  const media = (raw.media as (ProjectMedia & { relativePath?: unknown })[]).map((stored) => {
    // Copies on their way when it was saved are not on their way now: the
    // source is opened as one whose copies are missing, and they are made.
    const { relativePath, markIn: storedIn, markOut: storedOut, copying: _gone, addedAt: storedAt, ...m } = stored
    if (typeof relativePath === 'string' && relativePath !== '') relativePaths.set(m.id, relativePath)
    // A damaged mark goes rather than taking the file down with it: a
    // recording is perfectly usable without one, unlike a damaged clip.
    const markIn = mark(storedIn)
    const markOut = mark(storedOut)
    // A date that is not one is no date: the source goes under Earlier.
    const addedAt = typeof storedAt === 'number' && Number.isFinite(storedAt) && storedAt > 0 ? storedAt : undefined
    // A text's style made safe: a damaged one still draws, with defaults where it is damaged.
    const text = m.text !== undefined ? { text: cleanTextStyle(m.text) } : {}
    // A shape's the same way: a damaged one still draws, as a new one of its kind starts.
    const shape = m.shape !== undefined ? { shape: cleanShapeStyle(m.shape) } : {}
    // A colour that is not one is black, rather than a source nothing can draw.
    const { colour: storedColour, care: storedCare, ...plain } = m
    const colour = storedColour !== undefined ? { colour: cleanColour(storedColour) ?? '#000000' } : {}
    // Soften breaths and Remove mouth clicks by track, tidied; damaged, the track plays as recorded.
    const care = cleanCare(storedCare)
    return {
      ...plain,
      ...(care ? { care } : {}),
      ...text,
      ...shape,
      ...colour,
      ...(addedAt !== undefined ? { addedAt } : {}),
      ...(markIn !== undefined ? { markIn } : {}),
      ...(markOut !== undefined && (markIn === undefined || markOut > markIn) ? { markOut } : {})
    }
  })

  let sequences: Sequence[]
  let workspace = raw.workspace
  if (hasSequences) {
    sequences = storedSequences(raw.sequences as unknown[], raw.schemaVersion, media)
    if (sequences.length === 0) throw new Error('this project has no timeline in it')
  } else {
    const presetId = validShape(raw.presetId)
    sequences = [
      {
        id: FIRST_SEQUENCE_ID,
        name: shapeName(presetId),
        nameFollowsShape: true,
        presetId,
        output: validOutput(raw.output),
        ...(() => {
          const read = upgradedTracks({ clips: raw.clips }, media)
          return { ...read, videoTracks: keyedTracks(read.videoTracks) }
        })(),
        captions: emptyCaptions(),
        markers: []
      }
    ]
    const old = (typeof workspace === 'object' && workspace !== null ? workspace : {}) as Record<string, unknown>
    workspace = { ...old, activeSequenceId: FIRST_SEQUENCE_ID, timelines: { [FIRST_SEQUENCE_ID]: old.timeline } }
  }

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled',
    fps: typeof raw.fps === 'number' ? raw.fps : 30,
    media,
    sequences
  }

  refuseImpossible(project)
  return { project, workspace: cleanWorkspace(workspace, project), relativePaths, fileSchema: raw.schemaVersion }
}

/** The most frames a clip may reach: a day at 240 fps, far past any recording, well short of where numbers stop being exact. */
const MOST_FRAMES = 240 * 3600 * 24

/**
 * A project that could not have been saved by the app is refused in words
 * (audit 2026-10-01): a frame rate of nothing, two sources or two clips with
 * one id, a clip of a source the project does not have, or one that ends
 * before it starts or runs out to numbers no recording reaches. Opened, each
 * of these broke something later and far from its cause.
 */
function refuseImpossible(p: Project): void {
  if (!(Number.isFinite(p.fps) && p.fps > 0 && p.fps <= 240)) throw new Error('this project has a frame rate it cannot be played at')
  const sources = new Set(p.media.map((m) => m.id))
  if (sources.size !== p.media.length) throw new Error('this project has two sources under one name')
  for (const s of p.sequences) {
    const ids = new Set<string>()
    for (const track of [...s.videoTracks, ...s.audioTracks]) {
      for (const c of track.clips as { id: string; mediaId: string; sourceIn: number; sourceOut: number; timelineStart: number }[]) {
        const frame = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= MOST_FRAMES
        if (!sources.has(c.mediaId)) throw new Error('this project has a clip of a source it does not have')
        if (!frame(c.sourceIn) || !frame(c.sourceOut) || !frame(c.timelineStart) || c.sourceOut <= c.sourceIn) {
          throw new Error('this project has a clip that ends before it starts, or runs past any recording')
        }
        if (ids.has(c.id)) throw new Error('this project has two clips under one name')
        ids.add(c.id)
      }
    }
  }
}
