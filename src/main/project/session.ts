import { basename } from 'node:path'
import { textKey } from '../../shared/text'
import { MEDIA_FIELDS } from '../../shared/source-paths'
import { stripProjectExt } from '../../shared/project-ext'
import { PRESETS } from '../../shared/presets'
import { lockedTrackChanged } from '../../shared/tracks'
import type { ClipEdit, ProjectEdit } from '../../shared/types'
import type { MediaAsset } from '../../shared/types'
import {
  createProject,
  placeSource,
  removeClip,
  removeClips,
  closeUpClip,
  closeUpGap,
  moveClipTo,
  prepareDrop,
  rippleTrim,
  setClipIn,
  setClipOut,
  splitClip,
  splitEverything,
  liftRange,
  removeRange,
  trimToFrame,
  unlinkClip,
  linkClips,
  addTrack,
  removeTrack,
  setSequenceMarks,
  setSourceMarksOn,
  setClipMark,
  addTransition,
  setTransition,
  setTransitionKind,
  removeTransition,
  fillNewCuts,
  setTrackHidden,
  setTrackLocked,
  setTrackMuted,
  setTrackDuck,
  setFade,
  setClipDenoise,
  setClipVoice,
  setTrackName,
  setCrop,
  setZoomKey,
  removeZoomKey,
  moveZoomKey,
  setZoomEase,
  setZoomKeys,
  clearZoomKeys,
  zoomPreset,
  settleZoomKeys,
  setSimpleZoom,
  useKeyframes,
  useSimpleZoom,
  setLook,
  setRemoveBackground,
  setLookStrength,
  setColourAdjust,
  setBlur,
  setBlurBoxes,
  setPictureStyle,
  setBlurFill,
  isText,
  isColour,
  addTextTo,
  setTextOn,
  addShapeTo,
  setShapeOn,
  isShape,
  addColourTo,
  setColourOn,
  setOverlay,
  setAppear,
  setFraming,
  setFramingOn,
  setCropOn,
  setCropsOn,
  setPip,
  joinClips,
  setClipAudio,
  applySoundToSource,
  setShape,
  setPlace,
  addLayer,
  removeLayer,
  applyLayout,
  swapPictures,
  applyLayoutToSource,
  upsertMedia,
  withEditsOf,
  withoutMedia,
  clipsUsing,
  addSequence,
  duplicateSequence,
  renameSequence,
  removeSequence,
  setSequenceShape,
  applySetup,
  outputFor,
  DEFAULT_PRESET_ID,
  UNTITLED,
  editSequence,
  setSoundTrack,
  setCaptions,
  setCaptionsHeard,
  setCaptionsWithin,
  setCaptionsWithinHeard,
  moveCaption,
  trimCaption,
  splitCaptionAt,
  removeCaption,
  setCaptionWords,
  setCaptionStyle,
  placeCaption,
  relocateCaptions,
  regroupCaptions,
  addMarkerAt,
  moveMarker,
  renameMarker,
  colourMarker,
  removeMarker,
  setMarkers,
  followSpeech,
  findClip,
  MAIN_PICTURE,
  pipOf,
  setVoiceCare,
  type Clip,
  type Project,
  type ProjectMedia,
  type Timeline
} from '../../shared/project'
import { defaultWorkspace, type Workspace } from '../../shared/workspace'
import { removeStretches } from '../../shared/silences'
import { mirrorPicture } from '../../shared/on-selected'
import { firstFrame, frameOf, groupClips, groupPieces, innerEdge, settleGroups, standInTimeline, ungroupClips, withGroupFrame } from '../../shared/groups'
import { serialiseProject } from './store'
import { pasteClips } from '../../shared/clipboard'
import { newId } from '../../shared/ids'
import { shapeKey } from '../../shared/shape'
import { heardTimeline } from '../speech/heard'
import { captionStyleEverywhere, setTextsOn } from '../../shared/apply-to-all'
import { clearBoxKeys, moveBoxKey, moveOutOfTheWay, pinBoxWith, removeBoxKey, setBoxEase, setBoxKey } from '../../shared/box-keys'

const DEFAULT_FPS = 30
const DEFAULT_OUTPUT = { width: 1080, height: 1920 }
export { UNTITLED }
/** The shape a new project starts on: the one last chosen, from the app's settings. */
let startShape = DEFAULT_PRESET_ID

let current: Project = blankProject()
let currentPath: string | null = null
let workspace: Workspace = defaultWorkspace()
/**
 * The document as it was last saved or opened, serialised. Null means there is
 * nothing on disk that it matches, as for a restored recovery copy.
 */
let savedText: string | null = serialiseProject(current)
/** The workspace as last written to the project file, so closing knows whether to write it. */
let savedWorkspaceText: string | null = null
/**
 * Which document is open. It changes whenever a whole document replaces the
 * last one, so work that finishes late, or a workspace sent just before, can
 * tell it belongs to a document that is no longer there.
 */
let docId = 1
/**
 * The document as it was before the drag now under way made its first edit.
 * Every movement after the first is applied to this, not to the last
 * movement's result: worked out movement by movement, a trim dragged into a
 * limit and back, with linked clips that stop at different places, or one
 * that closes up the rest of the sequence, would keep what the limit took.
 */
let dragBase: Project | null = null

export function getProject(): Project {
  return current
}

export function getProjectPath(): string | null {
  return currentPath
}

/**
 * The document's file has been renamed on disk, and is the same file with the
 * same contents. Only where it is changes, so nothing here about what has been
 * saved is touched.
 */
export function setProjectPath(path: string): void {
  currentPath = path
}

export function getDocId(): number {
  return docId
}

export function getWorkspace(): Workspace {
  return workspace
}

export function setWorkspace(ws: Workspace): void {
  workspace = ws
}

/** A project file's name without its folder or extension, old or new. */
export function nameFromPath(path: string): string {
  return stripProjectExt(basename(path))
}

/**
 * What an opened document is called. A stored name is kept, so a copied file
 * keeps the name it was given, but one that was never named takes the file's.
 */
export function nameOnOpen(storedName: string, path: string): string {
  return storedName === UNTITLED || storedName.trim() === '' ? nameFromPath(path) : storedName
}

/**
 * Replace the document from within the editor: undo, redo, relink.
 *
 * The name is kept. It follows the file, and an undo snapshot taken before
 * the first save would otherwise put "Untitled" back.
 *
 * So are the sources. Nothing you can undo changes them: they arrive by
 * import, relink and rebuild, all of which happen here. An undo snapshot
 * taken before a relink would otherwise point its clips back at the files
 * that had gone, and one taken before an import would drop a source the bin
 * still offers. One taken before a source was removed from the bin does not
 * bring it back, unless it brings back a clip that uses it.
 *
 * A source that does come back is the one this document had, with the files
 * it had: the window names the source, never where it is (audit 2026-10-01).
 * A snapshot with a source this document never had is not taken at all.
 */
export function setProject(p: Project): Project {
  for (const m of current.media) held.set(m.id, m)
  const back = p.media.filter((m) => !current.media.some((x) => x.id === m.id))
  if (back.some((m) => !held.has(m.id))) return current
  dragBase = null
  let next: Project = p.name === current.name ? p : { ...p, name: current.name }
  for (const m of back) next = { ...next, media: next.media.map((x) => (x.id === m.id ? itsOwnFiles(x, held.get(m.id)!) : x)) }
  const here = new Set(current.media.map((m) => m.id))
  const removed = next.media.filter((m) => !here.has(m.id) && clipsUsing(next, m.id) === 0)
  for (const m of removed) next = withoutMedia(next, m.id)
  // upsertMedia also pulls each clip back inside its source, which matters
  // when the snapshot's clips were cut against a longer file.
  // A text is the other way round: its source is made and changed by edits,
  // so the snapshot's is the one it had then, and one it does not have yet is
  // one an edit since made.
  for (const m of current.media) {
    // A colour is made and changed by edits too: the snapshot's, unless it is the same colour.
    if (isColour(m)) {
      const then = next.media.find((x) => x.id === m.id)
      if (then?.colour === m.colour) next = upsertMedia(next, m)
    } else if (isShape(m)) {
      // A shape as a text: the snapshot's, unless it is the same shape, whose picture is as it is now.
      const then = next.media.find((x) => x.id === m.id)
      if (then?.shape && m.shape && shapeKey(then.shape) === shapeKey(m.shape)) next = upsertMedia(next, m)
    } else if (!isText(m)) {
      // What edits set on a recording, its marks and its breaths and clicks,
      // as the snapshot had it; what the app made or found since, as it is now.
      next = upsertMedia(next, withEditsOf(m, next.media.find((x) => x.id === m.id)))
    } else {
      // The same words and style as the snapshot's: its picture as it is now,
      // which may have been drawn again since, somewhere else.
      const then = next.media.find((x) => x.id === m.id)
      if (then?.text && m.text && textKey(then.text) === textKey(m.text)) next = upsertMedia(next, m)
    }
  }
  current = next
  return current
}

/** Every source this document has had, as it last was here: what an undo may bring back. */
const held = new Map<string, ProjectMedia>()

/** The sources taken out of the bin that an undo may still bring back, whose files have to stay. */
export function heldMedia(): ProjectMedia[] {
  return [...held.values()]
}

/** `m` as a snapshot has it, but with the files `known` had, and none it did not. */
function itsOwnFiles(m: ProjectMedia, known: ProjectMedia): ProjectMedia {
  const out: Record<string, unknown> = { ...m }
  for (const [key, kind] of Object.entries(MEDIA_FIELDS)) {
    if (kind !== 'file') continue
    const was = known[key as keyof ProjectMedia]
    if (was === undefined) delete out[key]
    else out[key] = was
  }
  return out as unknown as ProjectMedia
}

/**
 * Take a whole new document: a new project, an opened file, a restored copy.
 * `saved` says whether it matches what is on disk, which decides whether
 * closing it asks about unsaved changes.
 */
export function adoptDocument(p: Project, path: string | null, ws: Workspace, saved: boolean): Project {
  held.clear()
  current = p
  currentPath = path
  workspace = ws
  dragBase = null
  savedText = saved ? serialiseProject(p) : null
  savedWorkspaceText = saved && path ? JSON.stringify(ws) : null
  docId += 1
  return current
}

/** An empty, unsaved project with the app's starting settings. */
export function blankProject(): Project {
  return createProject(UNTITLED, DEFAULT_FPS, outputFor(startShape, DEFAULT_OUTPUT), startShape)
}

/** The shape the next new project starts on. One this build does not have is ignored. */
export function setStartShape(presetId: string): void {
  if (PRESETS.some((p) => p.id === presetId)) startShape = presetId
}

export function resetProject(): Project {
  return adoptDocument(blankProject(), null, defaultWorkspace(), true)
}

/**
 * Record that `saved` is now on disk at `path`.
 *
 * The name comes from what was written, not from the path. Saving used to
 * rename the document after its file every time, which quietly undid a name
 * given in the top bar. Choosing a file still names the project after it, and
 * that now happens in the caller, where the choosing does.
 *
 * `saved` is what was written, which is not always the current document: an
 * edit that arrived while the file was being written is still unsaved.
 */
export function markSaved(path: string, saved: Project, savedWorkspace: Workspace): Project {
  currentPath = path
  current = { ...current, name: saved.name }
  savedText = serialiseProject(saved)
  savedWorkspaceText = JSON.stringify(savedWorkspace)
  return current
}

/**
 * Call the document something. Kept in the project file, so it survives a
 * save and comes back when the file is opened.
 *
 * Outside undo, like every other use of the name: `setProject` holds the name
 * through an undo so a snapshot from before the first save cannot put
 * "Untitled" back, and a name you typed is no different.
 */
export function renameProject(name: string): Project {
  current = { ...current, name }
  return current
}

/** Whether the edit differs from what is on disk. Where you are in it never counts. */
export function isChanged(): boolean {
  return savedText === null || serialiseProject(current) !== savedText
}

/** Whether the workspace differs from the one in the project file. */
export function isWorkspaceChanged(): boolean {
  return savedWorkspaceText !== JSON.stringify(workspace)
}

export function projectName(): string {
  return current.name
}

/** An asset from the media pipeline, reduced to what the project stores. */
export function mediaFromAsset(a: MediaAsset): ProjectMedia {
  return {
    id: a.id,
    originalPath: a.originalPath,
    playablePath: a.playablePath,
    conformed: a.conformed,
    conformReasons: a.conformReasons,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    fps: a.fps,
    codec: a.codec,
    hasAudio: a.hasAudio,
    peaksPath: a.peaksPath,
    filmstripPath: a.filmstripPath,
    ...(a.audioTracks !== undefined ? { audioTracks: a.audioTracks } : {}),
    ...(a.trackNames !== undefined ? { trackNames: a.trackNames } : {}),
    ...(a.trackChannels !== undefined ? { trackChannels: a.trackChannels } : {}),
    ...(a.bt601 ? { bt601: true as const } : {}),
    // Kept only when the file has some: a project has no use for an empty list
    // on every source, and its absence is what "not read yet" looks like.
    ...(a.chapters !== undefined && a.chapters.length > 0 ? { chapters: a.chapters } : {}),
    ...(a.trackFiles !== undefined ? { trackFiles: a.trackFiles } : {}),
    ...(a.copying !== undefined ? { copying: a.copying } : {}),
    ...(a.startSec !== undefined && a.startSec !== 0 ? { startSec: a.startSec } : {}),
    ...(a.hasVideo === false ? { hasVideo: false } : {}),
    ...(a.still === true ? { still: true } : {}),
    ...(a.frames !== undefined && a.frameRate !== undefined ? { frames: a.frames, frameRate: a.frameRate } : {})
  }
}

export function addAsset(a: MediaAsset): Project {
  const known = current.media.some((x) => x.id === a.id)
  // Dated the first time it comes in, for the Source bin's days.
  const m = known ? mediaFromAsset(a) : { ...mediaFromAsset(a), addedAt: Date.now() }
  current = upsertMedia(current, m)
  // A drag's next movement is applied to the document as the drag began, which must have it too.
  if (dragBase) dragBase = upsertMedia(dragBase, m)
  return current
}

/**
 * Take a source out of the project, as Remove from bin does: not an edit, so
 * not undone. False, with nothing changed, when a clip in any sequence uses it.
 */
export function removeMedia(id: string): boolean {
  const next = withoutMedia(current, id)
  if (next === current) return !current.media.some((m) => m.id === id)
  for (const m of current.media) if (m.id === id) held.set(id, m)
  current = next
  if (dragBase) dragBase = withoutMedia(dragBase, id)
  return true
}

/**
 * Swap in a new description of a source, keeping its id so every clip still
 * points at it: a relinked file, or one rebuilt after the cache lost it. The
 * clips are pulled back inside a source that came back shorter.
 */
export function replaceMedia(m: ProjectMedia): Project {
  current = upsertMedia(current, m)
  if (dragBase) dragBase = upsertMedia(dragBase, m)
  return current
}

/** Apply one edit from the renderer. Pure functions do the work; this only routes. */
export function applyEditTo(p: Project, edit: ProjectEdit): Project {
  switch (edit.kind) {
    case 'addSequence':
      return addSequence(p, edit.id, edit.presetId)
    case 'duplicateSequence':
      return duplicateSequence(p, edit.sequenceId, edit.id)
    case 'renameSequence':
      return renameSequence(p, edit.sequenceId, edit.name)
    case 'removeSequence':
      return removeSequence(p, edit.sequenceId)
    case 'setShape':
      // At the project level, because a sequence's name can follow its shape.
      return setSequenceShape(p, edit.sequenceId, edit.presetId)
    case 'applySetup':
      return applySetup(p, edit.sequenceId, edit.presetId, edit.clipIds, edit.framing)
    case 'addText':
      return addTextTo(p, edit.sequenceId, { mediaId: edit.mediaId, clipId: edit.clipId, at: edit.at, style: edit.style, drawn: edit.drawn })
    case 'setText':
      return setTextOn(p, edit.mediaId, edit.style, edit.drawn)
    case 'setTexts':
      return setTextsOn(p, edit.texts)
    case 'captionStyleEverywhere':
      return captionStyleEverywhere(p, edit.style)
    case 'addShape':
      return addShapeTo(p, edit.sequenceId, { mediaId: edit.mediaId, clipId: edit.clipId, at: edit.at, style: edit.style, drawn: edit.drawn, place: edit.place })
    case 'setShapeStyle':
      return setShapeOn(p, edit.mediaId, edit.style, edit.drawn, edit.placed)
    case 'addColour':
      return addColourTo(p, edit.sequenceId, {
        mediaId: edit.mediaId,
        clipId: edit.clipId,
        at: edit.at,
        colour: edit.colour,
        drawn: edit.drawn,
        ...(edit.length !== undefined ? { length: edit.length } : {}),
        ...(edit.trackId !== undefined ? { trackId: edit.trackId } : {})
      })
    case 'setColour':
      return setColourOn(p, edit.mediaId, edit.colour, edit.drawn)
    case 'pasteClips': {
      const ids = [...edit.ids]
      return pasteClips(p, edit.sequenceId, edit.copied, edit.at, () => ids.shift() ?? newId()).project
    }
    case 'setVoiceCare':
      return setVoiceCare(p, edit.mediaId, edit.track, {
        ...(edit.breaths !== undefined ? { breaths: edit.breaths } : {}),
        ...(edit.clicks !== undefined ? { clicks: edit.clicks } : {})
      })
    case 'setSourceMarks':
      return setSourceMarksOn(p, edit.mediaId, {
        ...(edit.in !== undefined ? { in: edit.in } : {}),
        ...(edit.out !== undefined ? { out: edit.out } : {})
      })
    default:
      return editSequence(p, edit.sequenceId, (t) => {
        const after = applyClipEdit(t, edit)
        // A transition on every cut this edit just made, for anyone who has
        // asked for that. Inside the same edit, so it is one undo step.
        return edit.autoTransition ? fillNewCuts(t, after, edit.autoTransition) : after
      })
  }
}

/** The edits that change the captions themselves, which the captions do not then follow. */
const CAPTION_EDITS: ReadonlySet<ClipEdit['kind']> = new Set([
  'setCaptions',
  'moveCaption',
  'trimCaption',
  'splitCaption',
  'removeCaption',
  'setCaptionWords',
  'setCaptionStyle',
  'placeCaption',
  'relocateCaptions',
  'regroupCaptions'
])

/**
 * Apply a clip edit to a timeline. Whatever it does to the clips, the
 * captions stay with the speech they were heard from.
 */
/**
 * The locked track that refused the last edit, waiting to be told to the
 * window. A refusal nobody is told about is the thing a lock must not be: the
 * edit does not happen and nothing on screen says why.
 */
let refusedBy: string | null = null

/** The locked track that refused the last edit, once. */
export function takeLockRefusal(): string | null {
  const track = refusedBy
  refusedBy = null
  return track
}

export function applyClipEdit(p: Timeline, edit: ClipEdit): Timeline {
  // Every clip's zoom settled after any edit, looked at rather than asked of
  // each kind: a split, a trim, a slip or a join can each leave keyframes a
  // clip cannot reach, or change which crop its first frame shows. Only the
  // clips the edit changed, so one on a locked track is never touched here.
  const next = settleGroups(settleZoomKeys(groupAware(p, edit), p), p)
  // The lock, checked by looking rather than by asking each kind of edit what
  // it touches. A list of kinds is a list to forget to add to, and a lock that
  // misses one edit is worse than no lock at all. Setting the lock itself is
  // the one edit allowed to change a locked track.
  const locked = edit.kind === 'setTrackLocked' ? null : lockedTrackChanged(p, next)
  if (locked !== null) {
    refusedBy = locked
    return p
  }
  return CAPTION_EDITS.has(edit.kind) ? next : followSpeech(p, next)
}

/**
 * The edits to a picture's main zoom and crop, which on a piece of a group are
 * made on the group's stand in, so they span the whole group.
 */
const GROUP_FRAMING: ReadonlySet<ClipEdit['kind']> = new Set([
  'setCrop',
  'setZoomKey',
  'removeZoomKey',
  'moveZoomKey',
  'setZoomEase',
  'setZoomKeys',
  'clearZoomKeys',
  'setSimpleZoom',
  'useKeyframes',
  'useSimpleZoom',
  'zoomPreset',
  'setPlace'
])

/** The edits a group takes as one: made on every picture piece of it. */
const EVERY_PIECE: ReadonlySet<ClipEdit['kind']> = new Set(['setLook', 'setRemoveBackground', 'setLookStrength', 'setColourAdjust', 'setBlur', 'setBlurBoxes', 'setBlurFill', 'setClipMark', 'setFraming', 'applyLayout', 'setPip'])

/**
 * A clip edit, with a group taken as one clip (plan 80). A zoom or crop edit
 * on a grouped picture is made on the group's stand in and kept as the
 * group's framing; a look, a mark or a layout on every piece. Any other edit
 * that changes a grouped piece's framing, as a pasted crop does, has the
 * group's framing read again from what its pieces now show.
 */
function groupAware(p: Timeline, edit: ClipEdit): Timeline {
  // The same change on several selected clips: made on the one, then followed by the rest.
  if (edit.kind === 'onSelected') return withSelected(p, groupAware(p, edit.edit), edit)
  const clipId = 'clipId' in edit && typeof edit.clipId === 'string' ? edit.clipId : null
  // A cut inside a group is not an edge to trim: the group's ends are.
  if (clipId !== null) {
    const edge = edit.kind === 'setClipIn' ? 'start' : edit.kind === 'setClipOut' ? 'end' : edit.kind === 'trimToFrame' ? edit.edge : null
    if (edge !== null && innerEdge(p, clipId, edge)) return p
  }
  const picture = 'picture' in edit ? edit.picture : undefined
  if (clipId !== null && GROUP_FRAMING.has(edit.kind) && (picture === undefined || picture === MAIN_PICTURE)) {
    const stand = standInTimeline(p, clipId)
    const group = findClip(p, clipId)?.clip.group
    if (stand && group !== undefined) {
      const one = findClip(clipEdit(stand, edit), clipId)
      return one && one.kind === 'video' ? withGroupFrame(p, group, frameOf(one.clip as Clip)) : p
    }
  }
  if (clipId !== null && EVERY_PIECE.has(edit.kind)) {
    const pieces = groupPieces(p, clipId)
    if (pieces.length > 1) return reframed(p, pieces.reduce((t, c) => clipEdit(t, { ...edit, clipId: c.id } as ClipEdit), p))
  }
  return reframed(p, clipEdit(p, edit))
}

/** The groups whose pieces an edit framed anew, each given the framing its pieces now show. */
function reframed(before: Timeline, after: Timeline): Timeline {
  const framing = (c: Clip): string => JSON.stringify([c.transform.crop, c.transform.place, c.transform.keys, c.transform.simple])
  const touched = new Set<string>()
  for (const r of after.videoTracks) {
    for (const c of r.clips) {
      if (c.group === undefined) continue
      const was = findClip(before, c.id)
      if (was && was.kind === 'video' && framing(was.clip as Clip) !== framing(c)) touched.add(c.group)
    }
  }
  let out = after
  for (const group of touched) {
    const first = out.videoTracks.flatMap((r) => r.clips).find((c) => c.group === group)
    const pieces = first ? groupPieces(out, first.id) : []
    if (pieces.length > 1) out = withGroupFrame(out, group, firstFrame(out, pieces))
  }
  return out
}

function clipEdit(p: Timeline, edit: ClipEdit): Timeline {
  switch (edit.kind) {
    case 'addSource': {
      const drop = {
        mediaId: edit.mediaId,
        clipId: edit.clipId,
        ...(edit.at !== undefined ? { at: edit.at } : {}),
        ...(edit.onTrack !== undefined ? { onTrack: edit.onTrack } : {}),
        ...(edit.streams !== undefined ? { streams: edit.streams } : {}),
        ...(edit.whole === true ? { whole: true } : {})
      }
      const placed = placeSource(prepareDrop(p, drop, { insert: edit.insert === true, ...(edit.newTrack ? { newTrack: edit.newTrack } : {}) }), drop)
      // Refused, it leaves no track made and nothing opened up for it.
      if (placed.refused) return p
      return edit.removeBackground ? setRemoveBackground(placed.timeline, edit.clipId, edit.removeBackground) : placed.timeline
    }
    case 'removeClip':
      return removeClip(p, edit.clipId, edit.alone === true)
    case 'closeUpClip':
      return closeUpClip(p, edit.clipId)
    case 'removeClips':
      return removeClips(p, edit.clipIds, { alone: edit.alone === true, closeUp: edit.closeUp === true })
    case 'closeUpGap':
      return closeUpGap(p, edit.gap)
    case 'removeStretches':
      return removeStretches(p, edit.stretches)
    case 'moveClip':
      return moveClipTo(p, edit.clipId, edit.trackId, edit.start, {
        alone: edit.alone === true,
        insert: edit.insert === true,
        newTrack: edit.newTrack === true,
        ...(edit.with ? { with: edit.with } : {})
      })
    // A trim that closes up but is held back, as by a voice over left whole
    // across the cut, is made as a plain trim instead: the drag still does something (plan 82).
    // So is one that would move a clip on a locked track, which nothing moves (audit 2026-10-01).
    case 'setClipIn': {
      const closed = edit.closeUp ? rippleTrim(p, edit.clipId, 'start', edit.frame, edit.alone === true) : p
      return closed !== p && lockedTrackChanged(p, closed) === null ? closed : setClipIn(p, edit.clipId, edit.frame, edit.alone === true)
    }
    case 'setClipOut': {
      const closed = edit.closeUp ? rippleTrim(p, edit.clipId, 'end', edit.frame, edit.alone === true) : p
      return closed !== p && lockedTrackChanged(p, closed) === null ? closed : setClipOut(p, edit.clipId, edit.frame, edit.alone === true)
    }
    case 'split':
      return splitClip(p, edit.frame, edit.clipId, edit.alone === true)
    case 'splitAll':
      return splitEverything(p, edit.frame)
    case 'removeRange':
      // The marks go with the range they marked, in the same undo step, so
      // the next Delete is an ordinary one and an undo brings both back.
      return setSequenceMarks(
        edit.closeUp === true ? removeRange(p, edit.from, edit.to) : liftRange(p, edit.from, edit.to),
        { in: null, out: null }
      )
    case 'setSequenceMarks':
      return setSequenceMarks(p, {
        ...(edit.in !== undefined ? { in: edit.in } : {}),
        ...(edit.out !== undefined ? { out: edit.out } : {})
      })
    case 'trimToFrame':
      return trimToFrame(p, edit.clipId, edit.edge, edit.frame, edit.alone === true)
    case 'unlink':
      return unlinkClip(p, edit.clipId)
    case 'link':
      return linkClips(p, edit.clipIds)
    case 'addTrack':
      return addTrack(p, edit.trackKind, edit.trackId)
    case 'removeTrack':
      return removeTrack(p, edit.trackId)
    case 'setTrackMuted':
      return setTrackMuted(p, edit.trackId, edit.muted)
    case 'setTrackDuck':
      return setTrackDuck(p, edit.trackId, edit.duck)
    case 'setFade':
      return setFade(p, edit.clipId, edit.side, edit.length)
    case 'setClipDenoise':
      return setClipDenoise(p, edit.clipId, edit.on)
    case 'setClipVoice':
      return setClipVoice(p, edit.clipId, edit.voice)
    case 'setTrackLocked':
      return setTrackLocked(p, edit.trackId, edit.locked)
    case 'setTrackName':
      return setTrackName(p, edit.trackId, edit.name)
    case 'setTrackHidden':
      return setTrackHidden(p, edit.trackId, edit.hidden)
    case 'setCrop':
      return setCrop(p, edit.clipId, edit.rect, edit.picture, edit.from)
    case 'setZoomKey':
      // A small box is pinned where it is on that frame too (plan 97).
      return pinBoxWith(setZoomKey(p, edit.clipId, edit.at, edit.crop, edit.picture), edit.clipId, edit.at, edit.picture)
    // A box keyframe on the same frame goes, moves or eases with it (plan 97).
    case 'removeZoomKey':
      return removeBoxKey(removeZoomKey(p, edit.clipId, edit.at, edit.picture), edit.clipId, edit.at, edit.picture)
    case 'moveZoomKey':
      return moveBoxKey(moveZoomKey(p, edit.clipId, edit.from, edit.to, edit.picture), edit.clipId, edit.from, edit.to, edit.picture)
    case 'setZoomEase':
      return setBoxEase(setZoomEase(p, edit.clipId, edit.at, edit.ease, edit.picture), edit.clipId, edit.at, edit.ease, edit.picture)
    case 'setBoxKey':
      return setBoxKey(p, edit.clipId, edit.at, edit.place, edit.opacity, edit.picture)
    case 'moveOutOfTheWay':
      return moveOutOfTheWay(p, edit.clipId, edit.from, edit.to, edit.how, edit.picture)
    case 'clearBoxKeys':
      return clearBoxKeys(p, edit.clipId, edit.picture)
    case 'setZoomKeys':
      return setZoomKeys(p, edit.clipId, edit.keys, edit.picture)
    case 'clearZoomKeys':
      return clearZoomKeys(p, edit.clipId, edit.picture)
    case 'setSimpleZoom':
      return setSimpleZoom(p, edit.clipId, edit.change, edit.picture)
    case 'useKeyframes':
      return useKeyframes(p, edit.clipId, edit.picture)
    case 'useSimpleZoom':
      return useSimpleZoom(p, edit.clipId, edit.picture)
    case 'zoomPreset':
      return zoomPreset(p, edit.clipId, edit.preset, edit.from, edit.to, edit.picture, {
        ...(edit.scale !== undefined ? { scale: edit.scale } : {}),
        ...(edit.point !== undefined ? { point: edit.point } : {}),
        ...(edit.ramp !== undefined ? { ramp: edit.ramp } : {})
      })

    case 'setLook':
      return setLook(p, edit.clipId, edit.look)
    case 'setRemoveBackground':
      return setRemoveBackground(p, edit.clipId, edit.removal)
    case 'setLookStrength':
      return setLookStrength(p, edit.clipId, edit.strength)
    case 'setColourAdjust':
      return setColourAdjust(p, edit.clipId, edit.change)
    case 'setBlur':
      return setBlur(p, edit.clipId, edit.amount)
    case 'setBlurBoxes':
      return setBlurBoxes(p, edit.clipId, edit.boxes)
    case 'setPictureStyle':
      return setPictureStyle(p, edit.clipId, edit.picture, edit.style)
    case 'setBlurFill':
      return setBlurFill(p, edit.clipId, edit.on)
    case 'setAppear':
      return setAppear(p, edit.clipId, edit.side, edit.appear)
    case 'setOverlay':
      return setOverlay(p, edit.clipId, {
        ...(edit.rotation !== undefined ? { rotation: edit.rotation } : {}),
        ...(edit.opacity !== undefined ? { opacity: edit.opacity } : {})
      })
    case 'setFraming':
      return setFraming(p, edit.clipId, edit.framing)
    case 'setFramingOn':
      return setFramingOn(p, edit.clipIds, edit.framing)
    case 'setCropOn':
      return setCropOn(p, edit.clipIds, edit.crop, edit.slot)
    case 'setCropsOn':
      return setCropsOn(p, edit.crops, edit.slot)
    case 'setPip':
      return setPip(p, edit.clipId, edit.change)
    case 'joinClips':
      return joinClips(p, edit.clipIds, edit.alone === true, edit.bringBack === true)
    case 'groupClips':
      return groupClips(p, edit.clipIds, edit.groupId)
    case 'ungroupClips':
      return ungroupClips(p, edit.clipIds)
    case 'setPlace':
      return setPlace(p, edit.clipId, edit.picture, edit.place, edit.reshapeCrop, edit.fromCrop)
    case 'addLayer':
      return addLayer(p, edit.clipId, edit.layerId)
    case 'removeLayer':
      return removeLayer(p, edit.clipId, edit.layerId)
    case 'applyLayout':
      return applyLayout(p, edit.clipId, edit.layout)
    case 'swapPictures':
      return swapPictures(p, edit.clipId)
    case 'applyLayoutToSource':
      return applyLayoutToSource(p, edit.clipId)
    case 'setClipAudio':
      return setClipAudio(p, edit.clipId, { gain: edit.gain, muted: edit.muted })
    case 'applySoundToSource':
      return applySoundToSource(p, edit.clipId)
    case 'setClipMark':
      return setClipMark(p, edit.clipId, edit.mark)
    case 'addTransition':
      return addTransition(p, edit.clipId, edit.side, {
        ...(edit.transitionKind === undefined ? {} : { kind: edit.transitionKind }),
        length: edit.length,
        ...(edit.alone === true ? { alone: true } : {})
      })
    case 'setTransition':
      return setTransition(p, edit.clipId, edit.side, {
        length: edit.length,
        before: edit.before,
        ...(edit.alone === true ? { alone: true } : {})
      })
    case 'setTransitionKind':
      return setTransitionKind(p, edit.clipId, edit.side, edit.transitionKind)
    case 'removeTransition':
      return removeTransition(p, edit.clipId, edit.side, edit.alone === true)
    case 'setShape':
      return setShape(p, edit.presetId)
    case 'setSoundTrack':
      return setSoundTrack(p, edit.clipId, edit.track)
    case 'setCaptions': {
      const heard = edit.heardId ? heardTimeline(edit.heardId) : null
      if (edit.within) {
        return heard
          ? setCaptionsWithinHeard(p, heard, edit.words, edit.listenTo, edit.within)
          : setCaptionsWithin(p, edit.words, edit.listenTo, edit.within)
      }
      return heard ? setCaptionsHeard(p, heard, edit.words, edit.listenTo) : setCaptions(p, edit.words, edit.listenTo)
    }
    case 'moveCaption':
      return moveCaption(p, edit.captionId, edit.start)
    case 'trimCaption':
      return trimCaption(p, edit.captionId, edit.edge, edit.frame)
    case 'splitCaption':
      return splitCaptionAt(p, edit.captionId, edit.frame)
    case 'removeCaption':
      return removeCaption(p, edit.captionId)
    case 'setCaptionWords':
      return setCaptionWords(p, edit.captionId, edit.text)
    case 'setCaptionStyle':
      return setCaptionStyle(p, edit.style)
    case 'placeCaption':
      return placeCaption(p, edit.captionId, edit.at)
    case 'relocateCaptions':
      return relocateCaptions(p, edit.at, edit.includeHand)
    case 'regroupCaptions':
      return regroupCaptions(p)
    case 'addMarker':
      return addMarkerAt(p, edit.frame, edit.name ?? '')
    case 'moveMarker':
      return moveMarker(p, edit.markerId, edit.frame)
    case 'renameMarker':
      return renameMarker(p, edit.markerId, edit.name)
    case 'colourMarker':
      return colourMarker(p, edit.markerId, edit.colour)
    case 'removeMarker':
      return removeMarker(p, edit.markerId)
    case 'setMarkers':
      return setMarkers(p, edit.markers)
    case 'onSelected':
      return withSelected(p, clipEdit(p, edit.edit), edit)
  }
}

/** An `onSelected` edit's picture, once made on its own clip, put on the others. */
function withSelected(before: Timeline, after: Timeline, edit: Extract<ClipEdit, { kind: 'onSelected' }>): Timeline {
  const inner = edit.edit
  if (!('clipId' in inner) || typeof inner.clipId !== 'string') return after
  // A picture in picture's corner and size are its small picture's place.
  const picture =
    inner.kind === 'setPip'
      ? (pipOf(before, inner.clipId)?.picture ?? MAIN_PICTURE)
      : 'picture' in inner && typeof inner.picture === 'string'
        ? inner.picture
        : MAIN_PICTURE
  return mirrorPicture(before, after, inner.clipId, picture, edit.also)
}

/**
 * Apply one edit. `continuing` marks a later movement of a drag, which is
 * applied to the document as it was before the drag began: the window sends
 * each movement measured from where the drag began, so the drag lands where
 * one edit straight there would have put it, however it got there.
 */
export function applyEdit(edit: ProjectEdit, continuing = false): Project {
  if (!continuing || dragBase === null) dragBase = current
  current = applyEditTo(continuing ? dragBase : current, edit)
  return current
}
