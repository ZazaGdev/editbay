import { PRESETS } from './presets'
import {
  A1_ID,
  FIRST_SEQUENCE_ID,
  MAIN_PICTURE,
  addMarkerAt,
  addTrack,
  cornerPlace,
  createProject,
  findClip,
  findVideoClip,
  hasPicture,
  linkClips,
  moveClip,
  newId,
  outputFor,
  placeSource,
  removeClip,
  removeTrack,
  removeZoomKey,
  renameMarker,
  setClipIn,
  setClipOut,
  setCrop,
  setPip,
  setPlace,
  setZoomEase,
  setZoomKey,
  splitEverything,
  settleZoomKeys,
  sourceFrames,
  targetAspect,
  timelineOf,
  trackCount,
  upsertMedia,
  v1End,
  withTimeline,
  zoomPreset,
  type Clip,
  type Project,
  type ProjectMedia,
  type Rect,
  type SourceDrop,
  type Timeline
} from './project'
import { removableStretches, removeStretches } from './silences'
import { cropInView, isSideBySide, viewOf, viewsOf } from './layout'
import { cropAtKeys } from './crop-geometry'
import { markerAt } from './markers'
import { secondsToFrames } from './time'
import type { PipCorner } from './pip'

/**
 * The edit list: a rough cut described in plain JSON, written by a person or
 * an agent, that the command line tool turns into a project (plan 74). The
 * format is documented in `docs/edit-list.md`, and this is its one
 * definition.
 *
 * Every time is in seconds of the main source's own clock. Reading a list
 * checks only what the list itself can show to be wrong; what needs the
 * sources, such as a cut past the end of the recording, is checked when the
 * project is made from it.
 */

export type CutReason = 'pause' | 'retake' | 'false-start' | 'other'
export const CUT_REASONS: readonly CutReason[] = ['pause', 'retake', 'false-start', 'other']

export type CornerAt = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export const CORNERS: readonly CornerAt[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export type ZoomHow = 'cut' | 'smooth'
export const ZOOM_HOWS: readonly ZoomHow[] = ['cut', 'smooth']

/** One half of a side-by-side recording, such as the owner's OBS canvas with the screen left and the camera right. */
export type ViewSide = 'left' | 'right'
export const VIEW_SIDES: readonly ViewSide[] = ['left', 'right']

export interface EditSource {
  id: string
  path: string
  /** Where this file's 0 s sits on the main source's clock. */
  offsetSec: number
}

export interface EditCut {
  fromSec: number
  toSec: number
  why: CutReason
  /** What was said in it, for the report. */
  words?: string
  /** A marker at the join, named from `why` and `words`. */
  mark?: boolean
}

export interface EditZoom {
  fromSec: number
  toSec: number
  /** The part of the main picture to show, as fractions of its width and height. */
  rect: { x: number; y: number; w: number; h: number }
  how: ZoomHow
  why?: string
  /** A marker where the zoom starts, named from `why`. */
  mark?: boolean
}

export interface EditMarker {
  atSec: number
  label: string
}

/**
 * A change of framing for a stretch of a reel (plan 75): which half of a
 * side-by-side main recording fills the frame, and whether the corner shows.
 * Outside every shot the reel's own `view` and `corner` hold.
 */
export interface EditShot {
  fromSec: number
  toSec: number
  view?: ViewSide
  /** False hides the corner for the shot. */
  corner?: boolean
  why: string
  /** A marker where the shot starts, named from `why`. */
  mark?: boolean
}

/**
 * One main recording and what is done to it, laid on the timeline as a
 * whole: the body of a version 1 list, or one of a version 2 list's reels.
 * Every time in it is on its main recording's clock.
 */
export interface EditReel {
  sources: EditSource[]
  /** The source that fills the frame, and whose clock every time is on. */
  main: string
  /** The source whose sound is heard. */
  sound: string
  /** Which of the sound source's audio tracks, from 0. Its first when left out. */
  soundTrack?: number
  /**
   * Which half of a side-by-side main recording fills the frame. Left out,
   * the frame starts on the middle of the whole canvas, as a source dropped
   * in the app does. A zoom's `rect` is then in fractions of this half.
   */
  view?: ViewSide
  /** `view` is which half of a side-by-side corner recording the box shows. */
  corner?: { source: string; at: CornerAt; view?: ViewSide }
  range?: { fromSec: number; toSec: number }
  cuts: EditCut[]
  zooms: EditZoom[]
  markers: EditMarker[]
  /** Only in a version 2 list's reels. */
  shots?: EditShot[]
}

/** Version 1: one reel, written at the top level. */
export interface EditListV1 extends Omit<EditReel, 'shots'> {
  version: 1
  shape: string
}

/** Version 2 (plan 75): reels laid end to end in the order given, each with sources of its own. */
export interface EditListV2 {
  version: 2
  shape: string
  reels: EditReel[]
}

export type EditList = EditListV1 | EditListV2

/** The reels of a list: a version 1 list is one. */
export function reelsOf(list: EditList): EditReel[] {
  if (list.version === 2) return list.reels
  const { version: _v, shape: _s, ...reel } = list
  return [reel]
}

/**
 * The cuts as `build` reports them: every stretch taken out, by reel and in
 * order, with why and what was said in it, so the words written for the
 * report are in the report whether or not the cut was marked.
 */
export function cutsReport(list: EditList): { reel: number; fromSec: number; toSec: number; why: CutReason; words?: string }[] {
  return reelsOf(list).flatMap((r, reel) =>
    [...r.cuts]
      .sort((a, b) => a.fromSec - b.fromSec)
      .map((c) => ({ reel, fromSec: c.fromSec, toSec: c.toSec, why: c.why, ...(c.words !== undefined && c.words.trim() !== '' ? { words: c.words.trim() } : {}) }))
  )
}

/** A list that cannot be read or honoured. The message starts with the field it is about. */
export class EditListError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditListError'
  }
}

function refuse(where: string, why: string): never {
  throw new EditListError(where === '' ? why : `${where}: ${why}`)
}

type Fields = Record<string, unknown>

/** An object, with nothing in it but the fields named: a misspelt field would otherwise be lost without a word. */
function object(raw: unknown, where: string, required: readonly string[], optional: readonly string[] = []): Fields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse(where, 'must be an object')
  const o = raw as Fields
  for (const key of Object.keys(o)) {
    if (!required.includes(key) && !optional.includes(key)) {
      refuse(at(where, key), `is not a field of the edit list here; expected ${[...required, ...optional].join(', ')}`)
    }
  }
  for (const key of required) if (!(key in o)) refuse(at(where, key), 'is missing')
  return o
}

function at(where: string, key: string): string {
  return where === '' ? key : `${where}.${key}`
}

function seconds(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) refuse(where, 'must be a number of seconds')
  return raw
}

function notNegative(raw: unknown, where: string): number {
  const n = seconds(raw, where)
  if (n < 0) refuse(where, 'must not be negative')
  return n
}

function text(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') refuse(where, 'must be some text')
  return raw
}

function oneOf<T extends string>(raw: unknown, where: string, allowed: readonly T[]): T {
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) refuse(where, `must be one of ${allowed.join(', ')}`)
  return raw as T
}

function flag(raw: unknown, where: string): boolean {
  if (typeof raw !== 'boolean') refuse(where, 'must be true or false')
  return raw
}

function list(raw: unknown, where: string): unknown[] {
  if (!Array.isArray(raw)) refuse(where, 'must be a list')
  return raw
}

/** A stretch from `fromSec` to `toSec`, which must come after it. */
function stretch(o: Fields, where: string): { fromSec: number; toSec: number } {
  const fromSec = notNegative(o.fromSec, at(where, 'fromSec'))
  const toSec = notNegative(o.toSec, at(where, 'toSec'))
  if (toSec <= fromSec) refuse(where, `ends at ${toSec} s, which is not after where it starts, ${fromSec} s`)
  return { fromSec, toSec }
}

/** None of these stretches overlapping another; the later one of a pair is named, with the one it overlaps. */
function noOverlaps(items: readonly { fromSec: number; toSec: number }[], name: string): void {
  const order = items.map((s, i) => ({ s, i })).sort((a, b) => a.s.fromSec - b.s.fromSec)
  for (let k = 1; k < order.length; k++) {
    const before = order[k - 1]!
    const now = order[k]!
    if (now.s.fromSec < before.s.toSec) {
      const [first, second] = before.i < now.i ? [before.i, now.i] : [now.i, before.i]
      refuse(`${name}[${second}]`, `overlaps ${name}[${first}]`)
    }
  }
}

function readSource(raw: unknown, where: string): EditSource {
  const o = object(raw, where, ['id', 'path', 'offsetSec'])
  return { id: text(o.id, at(where, 'id')), path: text(o.path, at(where, 'path')), offsetSec: seconds(o.offsetSec, at(where, 'offsetSec')) }
}

function readCut(raw: unknown, where: string): EditCut {
  const o = object(raw, where, ['fromSec', 'toSec', 'why'], ['words', 'mark'])
  const span = stretch(o, where)
  const why = oneOf(o.why, at(where, 'why'), CUT_REASONS)
  return {
    ...span,
    why,
    ...(o.words !== undefined ? { words: typeof o.words === 'string' ? o.words : refuse(at(where, 'words'), 'must be text') } : {}),
    ...(o.mark !== undefined ? { mark: flag(o.mark, at(where, 'mark')) } : {})
  }
}

function fraction(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) refuse(where, 'must be a fraction from 0 to 1')
  return raw
}

function readZoom(raw: unknown, where: string): EditZoom {
  const o = object(raw, where, ['fromSec', 'toSec', 'rect', 'how'], ['why', 'mark'])
  const span = stretch(o, where)
  const r = object(o.rect, at(where, 'rect'), ['x', 'y', 'w', 'h'])
  const rw = at(where, 'rect')
  const rect = { x: fraction(r.x, at(rw, 'x')), y: fraction(r.y, at(rw, 'y')), w: fraction(r.w, at(rw, 'w')), h: fraction(r.h, at(rw, 'h')) }
  if (rect.w === 0) refuse(at(rw, 'w'), 'must be more than 0')
  if (rect.h === 0) refuse(at(rw, 'h'), 'must be more than 0')
  // A little over 1 is rounding in whatever wrote it, not a rectangle off the picture.
  if (rect.x + rect.w > 1 + 1e-6 || rect.y + rect.h > 1 + 1e-6) refuse(rw, 'reaches past the edge of the picture')
  return {
    ...span,
    rect,
    how: oneOf(o.how, at(where, 'how'), ZOOM_HOWS),
    ...(o.why !== undefined ? { why: typeof o.why === 'string' ? o.why : refuse(at(where, 'why'), 'must be text') } : {}),
    ...(o.mark !== undefined ? { mark: flag(o.mark, at(where, 'mark')) } : {})
  }
}

function readMarker(raw: unknown, where: string): EditMarker {
  const o = object(raw, where, ['atSec', 'label'])
  return { atSec: notNegative(o.atSec, at(where, 'atSec')), label: text(o.label, at(where, 'label')) }
}

const REEL_FIELDS = ['sources', 'main', 'sound', 'cuts', 'zooms', 'markers'] as const
const REEL_OPTIONAL = ['soundTrack', 'view', 'corner', 'range'] as const

function readShot(raw: unknown, where: string, hasCorner: boolean): EditShot {
  const o = object(raw, where, ['fromSec', 'toSec', 'why'], ['view', 'corner', 'mark'])
  const span = stretch(o, where)
  const why = text(o.why, at(where, 'why'))
  // The corner shows outside every shot already, so only hiding it, or a view, changes anything.
  if (o.view === undefined && o.corner !== false) refuse(where, 'changes nothing: give it a view, or corner: false')
  const view = o.view === undefined ? undefined : oneOf(o.view, at(where, 'view'), VIEW_SIDES)
  let corner: boolean | undefined
  if (o.corner !== undefined) {
    corner = flag(o.corner, at(where, 'corner'))
    if (!hasCorner) refuse(at(where, 'corner'), 'the reel has no corner picture to show or hide')
  }
  return {
    ...span,
    ...(view !== undefined ? { view } : {}),
    ...(corner !== undefined ? { corner } : {}),
    why,
    ...(o.mark !== undefined ? { mark: flag(o.mark, at(where, 'mark')) } : {})
  }
}

/**
 * One reel's fields, from `o`. `where` is put before every field a refusal
 * names: '' for a version 1 list, `reels[1]` for a reel of a version 2 one.
 */
function readReel(o: Fields, where: string, withShots: boolean): EditReel {
  const f = (key: string): string => at(where, key)
  const sources = list(o.sources, f('sources')).map((s, i) => readSource(s, f(`sources[${i}]`)))
  if (sources.length === 0) refuse(f('sources'), 'must name at least one file')
  const ids = new Set<string>()
  sources.forEach((s, i) => {
    if (ids.has(s.id)) refuse(f(`sources[${i}].id`), `"${s.id}" is used by another source`)
    ids.add(s.id)
  })
  const known = (id: unknown, field: string): string => {
    const name = text(id, field)
    if (!ids.has(name)) refuse(field, `"${name}" is not the id of any of the sources`)
    return name
  }
  const main = known(o.main, f('main'))
  const sound = known(o.sound, f('sound'))
  // The main source is the clock: its own offset against itself can only be 0.
  const mainIndex = sources.findIndex((s) => s.id === main)
  if (sources[mainIndex]!.offsetSec !== 0) refuse(f(`sources[${mainIndex}].offsetSec`), 'must be 0 for the main source, whose clock every time is on')

  let soundTrack: number | undefined
  if (o.soundTrack !== undefined) {
    if (typeof o.soundTrack !== 'number' || !Number.isInteger(o.soundTrack) || o.soundTrack < 0) refuse(f('soundTrack'), 'must be a whole number from 0')
    soundTrack = o.soundTrack
  }

  const view = o.view === undefined ? undefined : oneOf(o.view, f('view'), VIEW_SIDES)

  let corner: EditReel['corner']
  if (o.corner !== undefined) {
    const c = object(o.corner, f('corner'), ['source', 'at'], ['view'])
    const source = known(c.source, f('corner.source'))
    if (source === main) refuse(f('corner.source'), 'is the main source, which already fills the frame')
    corner = { source, at: oneOf(c.at, f('corner.at'), CORNERS), ...(c.view !== undefined ? { view: oneOf(c.view, f('corner.view'), VIEW_SIDES) } : {}) }
  }

  let range: EditReel['range']
  if (o.range !== undefined) range = stretch(object(o.range, f('range'), ['fromSec', 'toSec']), f('range'))

  const cuts = list(o.cuts, f('cuts')).map((c, i) => readCut(c, f(`cuts[${i}]`)))
  noOverlaps(cuts, f('cuts'))
  const zooms = list(o.zooms, f('zooms')).map((z, i) => readZoom(z, f(`zooms[${i}]`)))
  noOverlaps(zooms, f('zooms'))
  const markers = list(o.markers, f('markers')).map((m, i) => readMarker(m, f(`markers[${i}]`)))
  let shots: EditShot[] | undefined
  if (withShots && o.shots !== undefined) {
    shots = list(o.shots, f('shots')).map((x, i) => readShot(x, f(`shots[${i}]`), corner !== undefined))
    noOverlaps(shots, f('shots'))
  }

  return {
    sources,
    main,
    sound,
    ...(soundTrack !== undefined ? { soundTrack } : {}),
    ...(view !== undefined ? { view } : {}),
    ...(corner ? { corner } : {}),
    ...(range ? { range } : {}),
    cuts,
    zooms,
    markers,
    ...(shots ? { shots } : {})
  }
}

/**
 * Read an edit list, from the file's text or from what it parsed to. Anything
 * malformed is refused with an `EditListError` whose message starts with the
 * field, as `cuts[2].toSec` or `reels[1].cuts[2].toSec`, so whoever wrote it
 * can find it.
 */
export function readEditList(raw: unknown): EditList {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch (err) {
      refuse('', `the edit list is not JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse('', 'the edit list must be an object')
  if ((value as Fields).version === 2) {
    const o = object(value, '', ['version', 'shape', 'reels'])
    const shape = oneOf(o.shape, 'shape', PRESETS.map((p) => p.id))
    const reels = list(o.reels, 'reels').map((r, i) => readReel(object(r, `reels[${i}]`, REEL_FIELDS, [...REEL_OPTIONAL, 'shots']), `reels[${i}]`, true))
    if (reels.length === 0) refuse('reels', 'must hold at least one reel')
    return { version: 2, shape, reels }
  }
  const o = object(value, '', ['version', 'shape', ...REEL_FIELDS], REEL_OPTIONAL)
  if (o.version !== 1) refuse('version', 'must be 1 or 2')
  const shape = oneOf(o.shape, 'shape', PRESETS.map((p) => p.id))
  return { version: 1, shape, ...readReel(o, '', false) }
}

/**
 * What the tool learned about a source by probing it, which is all a project
 * needs to place it before the app has imported it.
 */
export interface SourceFacts {
  durationSec: number
  width: number
  height: number
  fps: number
  codec: string
  hasAudio: boolean
  hasVideo: boolean
  /** How many audio tracks it has; OBS records up to six. */
  audioTracks: number
}

/**
 * The rate a project made from an edit list is at: the rate a new project in
 * the app starts at (`DEFAULT_FPS` in the session), so it is one the app
 * could have made.
 */
export const PROJECT_FPS = 30

/** How far a zoom may come in: the same 400% the Inspector stops at. */
const MOST_ZOOM = 4

/** What a cut's marker is called, from why it was cut. */
const REASON_NAMES: Record<CutReason, string> = { pause: 'Pause', retake: 'Retake', 'false-start': 'False start', other: 'Cut' }

const PIP_CORNERS_BY_NAME: Record<CornerAt, PipCorner> = { 'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br' }

/** A stretch of the main source taken out, in its frames, and which entry of the list takes it out. */
interface Removed {
  from: number
  to: number
  by: string
}

/**
 * A source as the project first holds it: described from its probe, and
 * marked as conformed into a cache that holds nothing yet. Opening the
 * project then takes every source through the app's own import, exactly as
 * after the cache is cleared (`reopen.ts`), so the waveform, filmstrip,
 * converted copy and track copies are the app's own.
 */
function unimported(id: string, path: string, f: SourceFacts): ProjectMedia {
  return {
    id,
    originalPath: path,
    playablePath: '',
    conformed: true,
    conformReasons: [],
    durationSec: f.durationSec,
    width: f.width,
    height: f.height,
    fps: f.fps,
    codec: f.codec,
    hasAudio: f.hasAudio,
    peaksPath: '',
    filmstripPath: '',
    audioTracks: f.hasAudio ? Math.max(1, f.audioTracks) : 0,
    ...(f.hasVideo ? {} : { hasVideo: false })
  }
}

/** Frames of the main source at the project rate, from its seconds. */
function frames(sec: number): number {
  return secondsToFrames(sec, PROJECT_FPS)
}

/** Put a source on the timeline as a drop does, or refuse with why it could not go. */
function place(t: Timeline, drop: SourceDrop, where: string): Timeline {
  const { timeline, refused } = placeSource(t, drop)
  if (refused !== null) refuse(where, refused)
  return timeline
}

/**
 * A source other than the main one, put on the timeline whole, lined up so
 * its frames sit against the main source's by its offset, and cut to the
 * main source's length: the stretches taken out later are taken out through
 * V1, and anything past V1's end would hang off the cut.
 */
function lineUp(t: Timeline, clipId: string, trackId: string, offset: number, mainEnd: number, where: string): Timeline {
  const length = (x: Timeline): number => {
    const c = findClip(x, clipId)!.clip
    return c.sourceOut - c.sourceIn
  }
  if (offset >= mainEnd || offset + length(t) <= 0) refuse(where, 'puts this source wholly before or after the main source, so none of it would be seen or heard')
  let next = t
  if (offset < 0) {
    // Placed at 0 and trimmed at the head, it would start late: it starts at 0, from its own frame -offset.
    next = setClipIn(next, clipId, -offset)
    next = moveClip(next, clipId, trackId, 0)
  }
  const c = findClip(next, clipId)!.clip
  if (c.timelineStart + length(next) > mainEnd) next = setClipOut(next, clipId, c.sourceIn + (mainEnd - c.timelineStart))
  return next
}

/** Where a frame of the main source lands in the cut: earlier by everything taken out before it. A frame taken out lands on the join. */
function landing(removed: readonly Removed[], frame: number): number {
  let out = 0
  for (const r of removed) out += Math.max(0, Math.min(frame, r.to) - r.from)
  return frame - out
}

/** Stretches taken out, merged where they touch or overlap. */
function merged(stretches: readonly Removed[]): Removed[] {
  const out: Removed[] = []
  for (const s of [...stretches].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/** Whether any of a stretch is kept, given the merged stretches taken out. */
function anyKept(removed: readonly Removed[], from: number, to: number): boolean {
  let at = from
  for (const r of removed) if (r.from <= at && r.to > at) at = r.to
  return at < to
}

/** The entries that take out any of a stretch, for saying why something in it cannot be honoured. */
function takenOutBy(stretches: readonly Removed[], from: number, to: number): string {
  return stretches.filter((r) => r.from < to && r.to > from).map((r) => r.by).join(' and ')
}

/**
 * One half of a side-by-side recording, in its pixels, as the app's layout
 * code divides it. Refused for a recording that is not side by side, where
 * there is no half to choose.
 */
function viewRect(m: ProjectMedia, side: ViewSide, where: string): Rect {
  if (!isSideBySide(m.width, m.height)) {
    refuse(where, `${m.originalPath} is ${m.width}x${m.height}, not a side-by-side recording at least three times as wide as it is tall, so it has no ${side} half to show`)
  }
  return viewsOf(m.width, m.height)[side === 'left' ? 0 : 1]!
}

/**
 * The zoom a rectangle of the main picture asks for, as the one-click zoom
 * makes it: how far in and on what point. The rectangle is in fractions of
 * `within`, the half the list chose or the whole recording, and is fitted to
 * the picture's shape by growing it around its middle, so all of it is shown.
 */
function zoomFor(c: Clip, m: ProjectMedia, rect: EditZoom['rect'], within: Rect, from: number, where: string): { scale: number; point: { x: number; y: number }; base: Rect } {
  const base = cropAtKeys(c.transform.crop, c.transform.keys, from)
  const aspect = base.w / base.h
  const view = viewOf(base, m.width, m.height)
  const full = cropInView(view, aspect)
  const r = { x: within.x + rect.x * within.w, y: within.y + rect.y * within.h, w: rect.w * within.w, h: rect.h * within.h }
  if (viewOf(r, m.width, m.height).x !== view.x) refuse(where, 'is on the other half of a side-by-side recording from the one the frame shows')
  const w = r.w / r.h > aspect ? r.w : r.h * aspect
  const scale = full.w / w
  if (scale < 1 + 1e-6) refuse(where, 'shows as much of the picture as the frame already does, or more, so it is not a punch-in')
  if (scale > MOST_ZOOM + 1e-6) refuse(where, `is closer than Editbay zooms, ${Math.round(MOST_ZOOM * 100)}%: make it at least ${Math.round(100 / MOST_ZOOM)}% of what the frame shows`)
  return { scale, point: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, base }
}

/** Where one reel landed in the cut, in frames of the sequence, `endFrame` not included. */
export interface ReelPlaced {
  startFrame: number
  endFrame: number
}

/** The project an edit list makes, and where each of its reels landed. */
export interface BuiltEditList {
  project: Project
  reels: ReelPlaced[]
}

/**
 * The id a source has in the project. A version 1 list's ids are kept as
 * they are; a version 2 list's are per reel, so they are given the reel's
 * number, `reel2.cam`.
 */
export function mediaIdOf(list: EditList, reel: number, sourceId: string): string {
  return list.version === 1 ? sourceId : `reel${reel + 1}.${sourceId}`
}

/**
 * One reel laid on a timeline of its own, from frame 0, with the app's own
 * editing code: the main source whole on V1 with its sound linked on A1, the
 * other sources lined up against it, the shots' framing, the zooms put on as
 * the one-click zooms put them, and then the range and the cuts taken out
 * through V1 as Remove silences takes pauses out. Markers go on last, where
 * their moments land in the cut. `where` is put before every field a
 * refusal names.
 */
function layReel(base: Timeline, reel: EditReel, media: ReadonlyMap<string, ProjectMedia>, where: string, shape: string): Timeline {
  const f = (key: string): string => (where === '' ? key : `${where}.${key}`)
  const byId = (id: string): ProjectMedia => media.get(id)!
  const indexOf = (id: string): number => reel.sources.findIndex((s) => s.id === id)
  const main = byId(reel.main)
  if (!hasPicture(main)) refuse(f('main'), `${main.originalPath} has no picture to fill the frame with`)
  const sound = byId(reel.sound)
  const track = reel.soundTrack ?? 0
  if (!sound.hasAudio) refuse(f('sound'), `${sound.originalPath} has no sound`)
  const tracks = trackCount(sound)
  if (track >= tracks) refuse(f('soundTrack'), `${sound.originalPath} has ${tracks} audio track${tracks === 1 ? '' : 's'}, counted from 0`)

  let t = base
  if (reel.corner && targetAspect(t) === null) refuse(f('corner'), `the ${shape} shape has no frame to put a corner picture in`)

  // What is taken out, in frames of the main source: before and after the
  // range, past which nothing is kept, and each cut.
  const end = sourceFrames(main, PROJECT_FPS)
  const from = reel.range ? frames(reel.range.fromSec) : 0
  const to = reel.range ? Math.min(end, frames(reel.range.toSec)) : end
  if (from >= end) refuse(f('range'), `starts at ${reel.range!.fromSec} s, after the main source ends at ${main.durationSec} s`)
  const stretches: Removed[] = []
  if (from > 0) stretches.push({ from: 0, to: from, by: f('range') })
  if (to < end) stretches.push({ from: to, to: end, by: f('range') })
  reel.cuts.forEach((c, i) => {
    const a = Math.min(end, frames(c.fromSec))
    const b = Math.min(end, frames(c.toSec))
    if (b <= a && frames(c.fromSec) < end) refuse(f(`cuts[${i}]`), `is shorter than one frame at ${PROJECT_FPS} fps, so it would take nothing out`)
    if (b > a) stretches.push({ from: a, to: b, by: f(`cuts[${i}]`) })
  })
  const removed = merged(stretches)
  if (!anyKept(removed, 0, end)) refuse(f('cuts'), 'the range and the cuts leave nothing of the main source')

  // The main source whole, from the timeline's start, so its frames and the timeline's are the same until the cuts.
  const mainClip = newId()
  t = place(t, { mediaId: main.id, clipId: mainClip, at: 0, whole: true, streams: reel.sound === main.id ? [track] : [] }, f('main'))
  // One half of a side-by-side recording: the largest crop of the frame's shape in it, centred, as the app frames a view.
  const aspect = (v: Rect): number => targetAspect(t) ?? v.w / v.h
  const mainView = reel.view ? viewRect(main, reel.view, f('view')) : null
  if (mainView) t = setCrop(t, mainClip, cropInView(mainView, aspect(mainView)))
  const together = [mainClip]
  const offsetOf = (id: string): number => frames(reel.sources[indexOf(id)]!.offsetSec)

  // Sound from another source, not the one in the corner: its picture is not wanted.
  if (reel.sound !== main.id && reel.sound !== reel.corner?.source) {
    const clipId = newId()
    const soundId = hasPicture(sound) ? `${clipId}.${track + 1}` : clipId
    const before = new Set(t.videoTracks.map((r) => r.id))
    t = place(t, { mediaId: sound.id, clipId, at: Math.max(0, offsetOf(reel.sound)), onTrack: A1_ID, streams: [track], whole: true }, f('sound'))
    if (hasPicture(sound)) {
      t = removeClip(t, clipId, true)
      for (const r of t.videoTracks) if (!before.has(r.id)) t = removeTrack(t, r.id)
    }
    t = lineUp(t, soundId, A1_ID, offsetOf(reel.sound), end, f(`sources[${indexOf(reel.sound)}].offsetSec`))
    together.push(soundId)
  }

  // The corner source on a track of its own over V1, in the corner box Picture in picture uses, moved to the corner asked for.
  if (reel.corner) {
    const corner = byId(reel.corner.source)
    if (!hasPicture(corner)) refuse(f('corner.source'), `${corner.originalPath} has no picture to put in the corner`)
    const clipId = newId()
    const trackId = 'v2'
    t = addTrack(t, 'video', trackId)
    t = place(t, { mediaId: corner.id, clipId, at: Math.max(0, offsetOf(reel.corner.source)), onTrack: trackId, streams: reel.sound === reel.corner.source ? [track] : [], whole: true }, f('corner'))
    t = lineUp(t, clipId, trackId, offsetOf(reel.corner.source), end, f(`sources[${indexOf(reel.corner.source)}].offsetSec`))
    // The half asked for, whole: the corner box takes its shape, and the crop is fitted to the box inside it.
    if (reel.corner.view) t = setCrop(t, clipId, viewRect(corner, reel.corner.view, f('corner.view')))
    const { width: W, height: H } = t.output
    t = setPlace(t, clipId, MAIN_PICTURE, cornerPlace(corner, findVideoClip(t, clipId)!.clip.transform.crop, W, H), true)
    t = setPip(t, clipId, { corner: PIP_CORNERS_BY_NAME[reel.corner.at] })
    together.push(clipId)
  }
  t = linkClips(t, together)

  // The shots (plan 75): every track cut at each shot's edges with the app's
  // own split, which keeps a picture and its sound linked, then the pieces
  // inside the shot framed on its half, and the corner's pieces taken off
  // where the shot hides it.
  const shots = (reel.shots ?? []).map((s, i) => {
    const w = f(`shots[${i}]`)
    const a = frames(s.fromSec)
    const b = Math.min(end, frames(s.toSec))
    if (a >= end) refuse(w, `starts at ${s.fromSec} s, after the main source ends at ${main.durationSec} s`)
    if (b - a < 1) refuse(w, `is shorter than one frame at ${PROJECT_FPS} fps`)
    if (!anyKept(removed, a, b)) refuse(w, `falls inside ${takenOutBy(stretches, a, b)}, taken out, so it would never be seen`)
    return { a, b, shot: s, where: w, view: s.view ? viewRect(main, s.view, `${w}.view`) : null }
  })
  for (const s of shots) {
    t = splitEverything(t, s.a)
    t = splitEverything(t, s.b)
  }
  const inside = (c: { timelineStart: number }, s: { a: number; b: number }): boolean => c.timelineStart >= s.a && c.timelineStart < s.b
  for (const s of shots) {
    if (s.view) for (const c of t.videoTracks[0]!.clips.filter((x) => inside(x, s))) t = setCrop(t, c.id, cropInView(s.view, aspect(s.view)))
    if (s.shot.corner === false) {
      for (const c of t.videoTracks.find((r) => r.id === 'v2')?.clips.filter((x) => inside(x, s)) ?? []) t = removeClip(t, c.id, true)
    }
  }

  // The zooms, on the piece of the main picture each falls in. Keyframes are
  // on the recording's frames, so the cuts leave them where they are.
  reel.zooms.forEach((z, i) => {
    const w = f(`zooms[${i}]`)
    const a = frames(z.fromSec)
    const b = Math.min(end, frames(z.toSec))
    if (a >= end) refuse(w, `starts at ${z.fromSec} s, after the main source ends at ${main.durationSec} s`)
    if (b - a < 1) refuse(w, `is shorter than one frame at ${PROJECT_FPS} fps`)
    if (!anyKept(removed, a, b)) refuse(w, `falls inside ${takenOutBy(stretches, a, b)}, taken out, so it would never be seen`)
    for (const s of shots) {
      if ((a < s.a && s.a < b) || (a < s.b && s.b < b)) refuse(w, `crosses the edge of ${s.where}, which frames the picture differently on either side of it`)
    }
    const piece = t.videoTracks[0]!.clips.find((c) => c.timelineStart <= a && a < c.timelineStart + c.sourceOut - c.sourceIn)!
    const pieceEnd = piece.sourceOut
    // How many frames the one-click zoom eases over each way: half a second, less for a short zoom, as `zoomPreset` works it out.
    if (z.how === 'smooth' && Math.min(Math.round(PROJECT_FPS / 2), Math.floor((Math.min(b, pieceEnd - 1) - a) / 2)) < 1) {
      refuse(w, 'is too short to ease in and out of; make it a cut zoom, or longer')
    }
    const within = shots.find((s) => s.view && a >= s.a && a < s.b)?.view ?? mainView ?? { x: 0, y: 0, w: main.width, h: main.height }
    const zoom = zoomFor(piece, main, z.rect, within, a, `${w}.rect`)
    const keyed = new Set((piece.transform.keys ?? []).map((k) => k.at))
    if (z.how === 'cut') {
      t = zoomPreset(t, piece.id, 'punch', a, b, undefined, { scale: zoom.scale, point: zoom.point })
      // Holds the close picture, and jumps back out on its last frame, unless it runs to the end of its piece.
      if (b < pieceEnd) t = setZoomKey(t, piece.id, b, zoom.base)
      t = setZoomEase(t, piece.id, a, 'hold')
      // A zoom that ends where this one starts already holds until here: the punch's hold on the frame before would end it a frame early.
      if (keyed.has(a) && !keyed.has(a - 1)) t = removeZoomKey(t, piece.id, a - 1)
    } else {
      t = zoomPreset(t, piece.id, 'inOut', a, b, undefined, { scale: zoom.scale, point: zoom.point })
    }
  })

  // The range and the cuts taken out through V1, as Remove silences takes pauses out.
  const out = removed.map((r) => ({ from: r.from, to: r.to }))
  if (removableStretches(t, out).length !== out.length) refuse(f('cuts'), 'Editbay could not take every cut out of the timeline')
  t = settleZoomKeys(removeStretches(t, out), t)

  // Markers, where their moments land in the cut. Two on one frame share it, both named.
  const mark = (frame: number, label: string): void => {
    t = markOn(t, frame, label)
  }
  reel.cuts.forEach((c, i) => {
    if (!c.mark) return
    const a = frames(c.fromSec)
    if (a >= to || frames(c.toSec) <= from) refuse(f(`cuts[${i}].mark`), 'the cut is outside the part of the main source kept, so there is no join to mark')
    const words = c.words?.trim() ?? ''
    mark(landing(removed, Math.max(a, from)), `${REASON_NAMES[c.why]}${words !== '' ? `: "${words}"` : ''}`)
  })
  for (const z of reel.zooms) {
    const why = z.why?.trim() ?? ''
    if (z.mark) mark(landing(removed, frames(z.fromSec)), why !== '' ? `Zoom: ${why}` : 'Zoom')
  }
  for (const s of shots) if (s.shot.mark) mark(landing(removed, Math.max(s.a, from)), `Shot: ${s.shot.why.trim()}`)
  reel.markers.forEach((m, i) => {
    const w = f(`markers[${i}]`)
    const at = frames(m.atSec)
    if (at >= end) refuse(w, `is at ${m.atSec} s, after the main source ends at ${main.durationSec} s`)
    const gone = stretches.find((r) => at >= r.from && at < r.to)
    if (gone) refuse(w, `is at ${m.atSec} s, inside ${gone.by}, which is taken out`)
    mark(landing(removed, at), m.label.trim())
  })
  return t
}

/** A marker on a frame, or, where one is already, both names on it: the app keeps one marker a frame. */
function markOn(t: Timeline, frame: number, label: string): Timeline {
  const here = markerAt(t.markers, frame)
  return here ? renameMarker(t, here.id, `${here.name} / ${label}`) : addMarkerAt(t, frame, label)
}

/**
 * A reel's timeline put after everything on `t`: its clips moved later by
 * `at`, onto the track of the same id, made when `t` has none, and its
 * markers with them. The clips keep their ids and links, which are new for
 * every reel, so nothing of one reel is linked to another.
 */
function appendReel(t: Timeline, reel: Timeline, at: number): Timeline {
  const later = <T extends { timelineStart: number }>(c: T): T => ({ ...c, timelineStart: c.timelineStart + at })
  const join = <T extends { id: string; clips: C[] }, C extends { timelineStart: number }>(mine: T[], theirs: T[]): T[] => {
    const out = [...mine]
    for (const r of theirs) {
      const i = out.findIndex((x) => x.id === r.id)
      if (i < 0) out.push({ ...r, clips: r.clips.map(later) })
      else out[i] = { ...out[i]!, clips: [...out[i]!.clips, ...r.clips.map(later)] }
    }
    return out
  }
  let next: Timeline = { ...t, videoTracks: join(t.videoTracks, reel.videoTracks), audioTracks: join(t.audioTracks, reel.audioTracks) }
  for (const m of reel.markers) next = markOn(next, m.frame + at, m.name)
  return next
}

/**
 * A project made from an edit list: each reel laid by `layReel`, one after
 * another in the order given. `facts` holds what probing found about each
 * source file, by its path. Anything the list asks that cannot be done is
 * refused with an `EditListError` naming the entry, never quietly left out.
 */
export function buildFromEditList(list: EditList, facts: ReadonlyMap<string, SourceFacts>, name: string): BuiltEditList {
  const reels = reelsOf(list)
  const where = (r: number): string => (list.version === 1 ? '' : `reels[${r}]`)
  const at = (r: number, key: string): string => (where(r) === '' ? key : `${where(r)}.${key}`)
  const media: ProjectMedia[] = []
  const perReel = reels.map((reel, r) => {
    const own = new Map<string, ProjectMedia>()
    reel.sources.forEach((s, i) => {
      const found = facts.get(s.path)
      if (!found) refuse(at(r, `sources[${i}]`), `${s.path} was not probed`)
      const m = unimported(mediaIdOf(list, r, s.id), s.path, found)
      own.set(s.id, m)
      media.push(m)
    })
    return own
  })
  const first = perReel[0]!.get(reels[0]!.main)!
  const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
  const output = outputFor(list.shape, { width: even(first.width), height: even(first.height) })
  let project = createProject(name, PROJECT_FPS, output, list.shape)
  for (const m of media) project = upsertMedia(project, m)
  const empty = timelineOf(project, FIRST_SEQUENCE_ID)

  let t = empty
  const placed: ReelPlaced[] = []
  reels.forEach((reel, r) => {
    const laid = layReel(empty, reel, perReel[r]!, where(r), list.shape)
    const start = v1End(t)
    t = r === 0 ? laid : appendReel(t, laid, start)
    placed.push({ startFrame: start, endFrame: start + v1End(laid) })
  })
  return { project: withTimeline(project, FIRST_SEQUENCE_ID, t), reels: placed }
}

/** The project alone: see `buildFromEditList`. */
export function projectFromEditList(list: EditList, facts: ReadonlyMap<string, SourceFacts>, name: string): Project {
  return buildFromEditList(list, facts, name).project
}
