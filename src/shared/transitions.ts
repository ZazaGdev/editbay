import { spanEnd, speedOf, type Span } from './tracks'

/**
 * Transitions: a window over a seam, inside which both clips it touches are
 * shown past their own edge.
 *
 * Plan 29. A transition is stored on the clip whose edge it covers, so it
 * trims and moves with that clip for free, but the window it makes belongs to
 * the seam and stretches the clip on the other side of the cut just as far.
 * Nothing here is a function of one clip on its own: give it a track's clips
 * and it gives back the windows over them.
 *
 * Nothing written to the project file ever overlaps. `timelineStart`,
 * `sourceIn` and `sourceOut` are untouched by any of this, so the rule that a
 * track's clips never overlap still holds and every edit goes on reading
 * `spanEnd`. The longer span is worked out on demand, here and nowhere else.
 *
 * All pure, so the arithmetic the drawing, the export and the preview must
 * agree on is one function they all call, tested without a window.
 */

export interface Transition {
  kind: string
  /** How long it lasts, in frames of the sequence. At least 1. */
  length: number
  /** How much of it falls before the seam, 0 to length. Half of length is centred. */
  before: number
}

/** What this file needs of a clip: its span, and what is on its edges. */
export interface Transitioned extends Span {
  transitionIn?: Transition
  transitionOut?: Transition
}

/** Which set of kinds a track's transitions come from. */
export type KindSet = 'picture' | 'sound'

/** Which edge of a clip a transition sits on. */
export type TransitionSide = 'in' | 'out'

export interface PictureKind {
  id: string
  name: string
  /** The `xfade` transition it renders as between two clips. */
  xfade: string
  /** Whether it means anything without a clip on the other side of the cut. */
  needsNeighbour: boolean
  /** The colour it dips through, for the kinds that dip through one. */
  colour?: 'black' | 'white'
  /**
   * Plan 79: the family a kind that comes in several directions belongs to,
   * such as Wipe, and which direction it is: the menu offers the family, and
   * the direction beside it.
   */
  family?: string
  direction?: 'left' | 'right' | 'up' | 'down'
  /**
   * How far into its run to the colour a dip waits before the colour starts
   * coming up, 0 to 1: a flash stays on the picture and goes white at the last
   * moment before the cut, then fades back as a dip does.
   */
  late?: number
}

/**
 * The picture kinds, out of the 58 `xfade` offers: each one is a line in the
 * export and a drawing routine in the preview, and the preview is what limits
 * the number. The first seven are Premiere's own defaults; plan 79 added the
 * missing directions and what short form edits use most, each drawn in the
 * preview by `xfade`'s own formula. Plan 95 added the stylised ones: Zoom
 * out, RGB split and Spin are a dissolve with the export's own zoom, colour
 * shift or turn laid on it (`blendFilters`), and Flash is a dip to white that
 * comes up late.
 */
export const PICTURE_KINDS: readonly PictureKind[] = [
  { id: 'dissolve', name: 'Dissolve', xfade: 'fade', needsNeighbour: true },
  { id: 'toBlack', name: 'Dip to black', xfade: 'fadeblack', needsNeighbour: false, colour: 'black' },
  { id: 'toWhite', name: 'Dip to white', xfade: 'fadewhite', needsNeighbour: false, colour: 'white' },
  { id: 'flash', name: 'Flash', xfade: 'fadewhite', needsNeighbour: false, colour: 'white', late: 0.75 },
  { id: 'wipeLeft', name: 'Wipe left', xfade: 'wipeleft', needsNeighbour: true, family: 'Wipe', direction: 'left' },
  { id: 'wipeRight', name: 'Wipe right', xfade: 'wiperight', needsNeighbour: true, family: 'Wipe', direction: 'right' },
  { id: 'wipeUp', name: 'Wipe up', xfade: 'wipeup', needsNeighbour: true, family: 'Wipe', direction: 'up' },
  { id: 'wipeDown', name: 'Wipe down', xfade: 'wipedown', needsNeighbour: true, family: 'Wipe', direction: 'down' },
  { id: 'pushLeft', name: 'Push left', xfade: 'slideleft', needsNeighbour: true, family: 'Push', direction: 'left' },
  { id: 'pushRight', name: 'Push right', xfade: 'slideright', needsNeighbour: true, family: 'Push', direction: 'right' },
  { id: 'pushUp', name: 'Push up', xfade: 'slideup', needsNeighbour: true, family: 'Push', direction: 'up' },
  { id: 'pushDown', name: 'Push down', xfade: 'slidedown', needsNeighbour: true, family: 'Push', direction: 'down' },
  { id: 'coverLeft', name: 'Cover left', xfade: 'coverleft', needsNeighbour: true, family: 'Cover', direction: 'left' },
  { id: 'coverRight', name: 'Cover right', xfade: 'coverright', needsNeighbour: true, family: 'Cover', direction: 'right' },
  { id: 'coverUp', name: 'Cover up', xfade: 'coverup', needsNeighbour: true, family: 'Cover', direction: 'up' },
  { id: 'coverDown', name: 'Cover down', xfade: 'coverdown', needsNeighbour: true, family: 'Cover', direction: 'down' },
  { id: 'revealLeft', name: 'Reveal left', xfade: 'revealleft', needsNeighbour: true, family: 'Reveal', direction: 'left' },
  { id: 'revealRight', name: 'Reveal right', xfade: 'revealright', needsNeighbour: true, family: 'Reveal', direction: 'right' },
  { id: 'revealUp', name: 'Reveal up', xfade: 'revealup', needsNeighbour: true, family: 'Reveal', direction: 'up' },
  { id: 'revealDown', name: 'Reveal down', xfade: 'revealdown', needsNeighbour: true, family: 'Reveal', direction: 'down' },
  { id: 'circleOpen', name: 'Circle open', xfade: 'circleopen', needsNeighbour: true },
  { id: 'circleClose', name: 'Circle close', xfade: 'circleclose', needsNeighbour: true },
  { id: 'iris', name: 'Iris', xfade: 'circlecrop', needsNeighbour: true },
  { id: 'box', name: 'Box', xfade: 'rectcrop', needsNeighbour: true },
  { id: 'zoomIn', name: 'Zoom in', xfade: 'zoomin', needsNeighbour: true },
  { id: 'zoomOut', name: 'Zoom out', xfade: 'fade', needsNeighbour: true },
  { id: 'blur', name: 'Blur', xfade: 'fade', needsNeighbour: true },
  { id: 'pixelate', name: 'Pixelate', xfade: 'pixelize', needsNeighbour: true },
  { id: 'rgbSplit', name: 'RGB split', xfade: 'fade', needsNeighbour: true },
  { id: 'spin', name: 'Spin', xfade: 'fade', needsNeighbour: true }
]

/**
 * The picture kinds as the menu offers them: a kind of its own, or a family
 * whose kinds differ only by direction, listed once with its directions.
 */
export function transitionFamilies(): ({ kind: PictureKind } | { family: string; kinds: PictureKind[] })[] {
  const out: ({ kind: PictureKind } | { family: string; kinds: PictureKind[] })[] = []
  for (const k of PICTURE_KINDS) {
    if (!k.family) {
      out.push({ kind: k })
      continue
    }
    const had = out.find((x) => 'family' in x && x.family === k.family) as { family: string; kinds: PictureKind[] } | undefined
    if (had) had.kinds.push(k)
    else out.push({ family: k.family, kinds: [k] })
  }
  return out
}

/** How a family's direction reads in its menu. */
export const DIRECTION_NAMES: Record<NonNullable<PictureKind['direction']>, string> = { left: 'Left', right: 'Right', up: 'Up', down: 'Down' }

export interface SoundKind {
  id: string
  name: string
  /** The `afade` curve it renders as. */
  curve: string
  /** What Premiere calls the same thing, for anyone arriving from it. */
  premiere: string
}

/**
 * The sound kinds, named for what they sound like rather than for the maths.
 * Even is Premiere's default and the one to reach for: two sounds crossfaded
 * on it stay at the same loudness all the way through.
 */
export const SOUND_KINDS: readonly SoundKind[] = [
  { id: 'even', name: 'Even', curve: 'qsin', premiere: 'Constant Power' },
  { id: 'linear', name: 'Linear', curve: 'tri', premiere: 'Constant Gain' },
  { id: 'smooth', name: 'Smooth', curve: 'exp', premiere: 'Exponential Fade' }
]

export const DEFAULT_PICTURE_KIND = 'dissolve'
export const DEFAULT_SOUND_KIND = 'even'

/** How long a transition is when nothing has said otherwise, in seconds. Premiere's figure. */
export const DEFAULT_TRANSITION_SECONDS = 1

/** The shortest a transition can be. */
export const MIN_TRANSITION_FRAMES = 1

export function pictureKind(id: unknown): PictureKind | null {
  return PICTURE_KINDS.find((k) => k.id === id) ?? null
}

export function soundKind(id: unknown): SoundKind | null {
  return SOUND_KINDS.find((k) => k.id === id) ?? null
}

/** What a kind is called, or the id itself for one this build does not have. */
export function kindName(id: string, kinds: KindSet): string {
  const found = kinds === 'picture' ? pictureKind(id) : soundKind(id)
  return found?.name ?? id
}

/** Every kind of one sort, for a menu. */
export function kindsOf(kinds: KindSet): readonly { id: string; name: string }[] {
  return kinds === 'picture' ? PICTURE_KINDS : SOUND_KINDS
}

/** The default kind of one sort. */
export function defaultKind(kinds: KindSet): string {
  return kinds === 'picture' ? DEFAULT_PICTURE_KIND : DEFAULT_SOUND_KIND
}

/**
 * The colour a picture kind dips through, or null for one that blends the two
 * pictures instead. A sound kind never dips through anything.
 */
export function washColour(kind: string): 'black' | 'white' | null {
  return pictureKind(kind)?.colour ?? null
}

/**
 * The kind as it will actually be drawn and rendered. A kind that means
 * nothing without a clip on the other side, put where there is none, becomes
 * a dip to black rather than being refused; a sound kind is a curve either
 * way, so it is never changed. A kind this build does not have becomes the
 * default of its sort, so a file from a later version opens rather than
 * drawing nothing.
 */
export function resolvedKind(kind: string, kinds: KindSet, hasPartner: boolean): string {
  if (kinds === 'sound') return soundKind(kind) ? kind : DEFAULT_SOUND_KIND
  const found = pictureKind(kind)
  if (!found) return hasPartner ? DEFAULT_PICTURE_KIND : 'toBlack'
  return found.needsNeighbour && !hasPartner ? 'toBlack' : found.id
}

export type Alignment = 'centre' | 'beforeCut' | 'afterCut'

/** What the alignment is called, for a menu. */
export const ALIGNMENTS: readonly { id: Alignment; name: string }[] = [
  { id: 'centre', name: 'Centre at cut' },
  { id: 'beforeCut', name: 'End at cut' },
  { id: 'afterCut', name: 'Start at cut' }
]

/** Where `before` sits for a named alignment. */
export function beforeFor(a: Alignment, length: number): number {
  if (a === 'centre') return Math.round(length / 2)
  return a === 'beforeCut' ? length : 0
}

/**
 * The alignment a transition is on, or null for anything else, which Premiere
 * calls Custom Start. Read back out of `before` rather than stored beside it,
 * so the name and the number can never disagree.
 */
export function alignmentOf(t: Transition): Alignment | null {
  return ALIGNMENTS.find((a) => beforeFor(a.id, t.length) === t.before)?.id ?? null
}

/** The same transition put on an alignment. */
export function aligned(t: Transition, a: Alignment): Transition {
  return { ...t, before: beforeFor(a, t.length) }
}

/**
 * A transition made safe on its own, before anything is known about the clips
 * around it: a whole length of at least one frame, and `before` inside it.
 * The clamps that need the track are applied when the window is worked out.
 */
export function tidyTransition(t: Transition): Transition {
  const length = Math.max(MIN_TRANSITION_FRAMES, Math.round(t.length))
  return { kind: t.kind, length, before: Math.min(length, Math.max(0, Math.round(t.before))) }
}

/**
 * A stored transition made safe for the project it was stored with, or
 * undefined for anything that is not one.
 *
 * Dropped rather than thrown on: a damaged transition costs that one edge and
 * nothing else, as a damaged marker costs its own note. A caption is content
 * and its loss stops the file opening; a transition is a decoration on a cut
 * that is still there.
 */
export function cleanTransition(raw: unknown, kinds: KindSet): Transition | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const t = raw as Record<string, unknown>
  if (typeof t.length !== 'number' || !Number.isFinite(t.length) || t.length < 1) return undefined
  if (typeof t.before !== 'number' || !Number.isFinite(t.before)) return undefined
  if (typeof t.kind !== 'string' || t.kind === '') return undefined
  const known = kinds === 'picture' ? pictureKind(t.kind) !== null : soundKind(t.kind) !== null
  return tidyTransition({ kind: known ? t.kind : defaultKind(kinds), length: t.length, before: t.before })
}

/** One transition as everything downstream sees it: where it falls, and what lies under it. */
export interface TransitionWindow {
  /** The clip that stores it, and which of its two edges. */
  clipId: string
  side: TransitionSide
  /** The kind as it will be drawn and rendered, a fallback already applied. */
  kind: string
  /** The seam it straddles: the storing clip's own edge. */
  cut: number
  /** Where it starts, clamped. */
  from: number
  /** One past where it ends, clamped. */
  to: number
  /** The clip its picture starts on, or null where it starts on nothing. */
  fromClipId: string | null
  /** The clip its picture ends on, or null. */
  toClipId: string | null
  /**
   * Where the picture changes hands, for a window that dips through a colour:
   * the first clip is shown up to it and the second from it, and at no frame
   * are both wanted. Null where both are shown over the whole of it, which is
   * every blend, and null where there is only one clip to show.
   */
  splitAt: number | null
  /** Its length and offset as stored, before the clamps, for the menu and the handles. */
  stored: Transition
}

/** Whether both clips under a window are wanted at once. */
export function blends(w: TransitionWindow): boolean {
  return w.fromClipId !== null && w.toClipId !== null && w.splitAt === null
}

/** Whether a window covers a clip at all, on either side of its split. */
export function windowHolds(w: TransitionWindow, clipId: string): boolean {
  return w.fromClipId === clipId || w.toClipId === clipId
}

function byStart<T extends Span>(clips: readonly T[]): T[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

/**
 * Every transition over a track, in the order they fall.
 *
 * A seam's transition is the pair of slots at it. Where exactly one is filled
 * and both clips touch, it joins the two. Where both are filled, or where
 * there is no clip on the other side, each is a fade of its own clip: the
 * clamps then push the two off each other onto their own sides of the cut,
 * which is how "a fade out and then a fade in" works with no special case.
 *
 * Clamped here and nowhere else, so what is drawn is always what renders. The
 * clamps, in order: inside its own clip; inside the clip on the other side;
 * never over a clip it does not belong to; never before the start of the
 * sequence; never over another window, the earlier one winning where two meet
 * in a gap; and never shorter than a frame.
 */
export function transitionWindows(clips: readonly Transitioned[], kinds: KindSet): TransitionWindow[] {
  const order = byStart(clips)
  const out: TransitionWindow[] = []
  order.forEach((c, i) => {
    const before = order[i - 1]
    const after = order[i + 1]
    // Touching, not merely nearby: a clip with a gap in front of it has nothing
    // on the other side of its head, and its transition is a fade from black.
    const previous = before && spanEnd(before) === c.timelineStart ? before : undefined
    const next = after && after.timelineStart === spanEnd(c) ? after : undefined
    if (c.transitionIn) {
      // Both slots filled at one seam: each is a fade of its own clip, and the
      // clamps push the two onto their own sides of the cut.
      const partner = previous && previous.transitionOut === undefined ? previous : null
      out.push(
        made(c, 'in', tidyTransition(c.transitionIn), kinds, {
          cut: c.timelineStart,
          partner,
          // Back as far as the far edge of the clip it joins, or, joining
          // nothing, no further than the clip in front of it.
          low: Math.max(0, partner ? partner.timelineStart : before ? spanEnd(before) : 0),
          high: spanEnd(c)
        })
      )
    }
    if (c.transitionOut) {
      const partner = next && next.transitionIn === undefined ? next : null
      out.push(
        made(c, 'out', tidyTransition(c.transitionOut), kinds, {
          cut: spanEnd(c),
          partner,
          low: c.timelineStart,
          high: partner ? spanEnd(partner) : after ? after.timelineStart : Infinity
        })
      )
    }
  })
  out.sort((a, b) => a.from - b.from || a.cut - b.cut)
  // Two fades reaching into one gap from either side, and meeting in it: they
  // meet in the middle of what they share, so neither disappears and no frame
  // on a track ever has two of them on it. Squeezed so hard that there is not a
  // frame each, the later one is not drawn at all; the transition is still on
  // its clip, and the clip's own menu still takes it off.
  const settled: TransitionWindow[] = []
  for (const w of out) {
    const last = settled[settled.length - 1]
    if (!last || w.from >= last.to) {
      settled.push(w)
      continue
    }
    const meet = Math.floor((w.from + last.to) / 2)
    if (meet <= last.from || meet >= w.to) continue
    settled[settled.length - 1] = cutTo(last, last.from, meet)
    settled.push(cutTo(w, meet, w.to))
  }
  return settled
}

/** A window held between two frames, its handover brought inside with it. */
function cutTo(w: TransitionWindow, from: number, to: number): TransitionWindow {
  if (from === w.from && to === w.to) return w
  return { ...w, from, to, splitAt: w.splitAt === null ? null : Math.min(to - 1, Math.max(from + 1, w.splitAt)) }
}

/** One window, clamped against the clips around it. */
function made(
  c: Transitioned,
  side: TransitionSide,
  stored: Transition,
  kinds: KindSet,
  at: { cut: number; partner: Transitioned | null; low: number; high: number }
): TransitionWindow {
  const { cut, partner } = at
  const kind = resolvedKind(stored.kind, kinds, partner !== null)
  let from = Math.max(at.low, cut - stored.before)
  let to = Math.min(at.high, cut - stored.before + stored.length)
  // Never shorter than a frame. Its own clip is at least a frame long and the
  // cut is one of its edges, so there is always a frame on the clip's side.
  if (to - from < 1) {
    if (side === 'in') to = from + 1
    else from = to - 1
  }
  const outgoing = side === 'in' ? (partner?.id ?? null) : c.id
  const incoming = side === 'in' ? c.id : (partner?.id ?? null)
  // A dip through a colour hands the picture over on the cut, so it is darkest
  // there however much of it falls before (task 1092); one that ends or starts
  // at the cut, in the middle, so it still goes down and comes back. Only when
  // there are two pictures to hand over between.
  const dips = kinds === 'picture' && washColour(kind) !== null && outgoing !== null && incoming !== null
  return {
    clipId: c.id,
    side,
    kind,
    cut,
    from,
    to,
    fromClipId: outgoing,
    toClipId: incoming,
    splitAt: dips ? (cut > from && cut < to ? cut : from + Math.round((to - from) / 2)) : null,
    stored
  }
}

/** A place on a track a transition can go: the frame, and the clip that would store it. */
export interface Seam {
  at: number
  clipId: string
  side: TransitionSide
}

/**
 * Every seam on a track: each clip's start and end, named by the clip that
 * would store a transition there.
 *
 * A clip's own start wins over the end of the clip before it, because a
 * transition at a cut belongs to the incoming clip, which is where Premiere
 * puts it and what makes it move with the clip you would expect.
 */
export function seamsOn(clips: readonly Transitioned[]): Seam[] {
  const out = new Map<number, Seam>()
  for (const c of clips) out.set(spanEnd(c), { at: spanEnd(c), clipId: c.id, side: 'out' })
  for (const c of clips) out.set(c.timelineStart, { at: c.timelineStart, clipId: c.id, side: 'in' })
  return [...out.values()].sort((a, b) => a.at - b.at)
}

/**
 * The seam nearest a frame that has no transition on it yet, or null when the
 * track has none. `within` limits how far away it may be, in frames.
 */
export function nearestSeam(clips: readonly Transitioned[], kinds: KindSet, frame: number, within = Infinity): Seam | null {
  const windows = transitionWindows(clips, kinds)
  let best: Seam | null = null
  for (const seam of seamsOn(clips)) {
    const away = Math.abs(seam.at - frame)
    if (away > within) continue
    if (windows.some((w) => w.from <= seam.at && seam.at <= w.to)) continue
    if (!best || away < Math.abs(best.at - frame)) best = seam
  }
  return best
}

/** Where a clip is shown from and to, its transitions counted. Exclusive at the end. */
export interface Shown {
  from: number
  to: number
}

/**
 * Every clip's shown span on a track, by id: its own span, stretched by the
 * windows it lies under.
 *
 * This, and never `spanEnd`, is what the timeline draws, what the export cuts
 * into stretches and what the preview's players are told. `spanEnd` stays what
 * the edits, the snapping and the overlap checks read, and the two are named
 * apart so that a caller cannot reach for the wrong one by accident.
 */
export function shownSpans(clips: readonly Transitioned[], kinds: KindSet, oneAtATime = false): Map<string, Shown> {
  const out = new Map<string, Shown>()
  for (const c of clips) out.set(c.id, { from: c.timelineStart, to: spanEnd(c) })
  for (const w of transitionWindows(clips, kinds)) {
    // An engine that can only show one picture at a time, as the preview is
    // until it learns to blend two, hands over in the middle of every window
    // rather than overlapping. Nothing then covers the same frame twice.
    const handover = w.splitAt ?? (oneAtATime && w.fromClipId !== null && w.toClipId !== null ? middleOf(w) : null)
    if (w.fromClipId !== null) {
      const at = out.get(w.fromClipId)
      // The first clip is shown until the handover, or until the end of the
      // window where there is no handover.
      if (at) at.to = Math.max(at.to, handover ?? w.to)
    }
    if (w.toClipId !== null) {
      const at = out.get(w.toClipId)
      if (at) at.from = Math.min(at.from, handover ?? w.from)
    }
  }
  return out
}

/** The frame in the middle of a window, where a dip hands the picture over. */
function middleOf(w: TransitionWindow): number {
  return w.from + Math.round((w.to - w.from) / 2)
}

/**
 * The colour over a clip's picture at a frame, and how much of it, or null
 * where none is. The same over both clips of a dip at a cut, whichever of
 * the two is drawn at that frame.
 */
export function washOver(
  windows: readonly TransitionWindow[],
  clipId: string,
  frame: number
): { colour: 'black' | 'white'; alpha: number } | null {
  for (const w of windows) {
    const colour = washColour(w.kind)
    if (colour === null || frame < w.from || frame >= w.to) continue
    // Over either clip, not only the one handed to: where a dip hands over
    // away from the cut both are on the player's screen there, and the one
    // drawn on top must not show through bright (task 1092).
    if (!windowHolds(w, clipId)) continue
    const alpha = washAt(w, frame)
    if (alpha > 0) return { colour, alpha }
  }
  return null
}

/** One clip's shown span. */
export function shownSpan(clips: readonly Transitioned[], clip: Transitioned, kinds: KindSet): Shown {
  return shownSpans(clips, kinds).get(clip.id) ?? { from: clip.timelineStart, to: spanEnd(clip) }
}

/**
 * How far through a window a frame is, from 0 on its first frame to just under
 * 1 on its last. Timed as ffmpeg times a fade over the same stretch, so the
 * preview and the export agree frame by frame.
 */
function through(from: number, to: number, frame: number): number {
  const length = to - from
  if (!(length > 0)) return 0
  return Math.min(1, Math.max(0, (frame - from) / length))
}

/**
 * How much of the colour is over the picture at a frame, from 0 for none to 1
 * for all of it. Zero for a window that blends two pictures instead of dipping
 * through a colour.
 *
 * A window with a picture on both sides goes to the colour over its first half
 * and comes back over its second, which is what `xfade`'s own `fadeblack`
 * does. One with a picture on one side only goes one way.
 */
export function washAt(w: TransitionWindow, frame: number): number {
  if (washColour(w.kind) === null || frame < w.from || frame >= w.to) return 0
  if (w.splitAt !== null) {
    return frame < w.splitAt ? washRise(w.kind, through(w.from, w.splitAt, frame)) : 1 - through(w.splitAt, w.to, frame)
  }
  // Nothing on one side: towards the colour when the picture is what runs out,
  // away from it when the picture is what arrives.
  return w.toClipId === null ? washRise(w.kind, through(w.from, w.to, frame)) : 1 - through(w.from, w.to, frame)
}

/**
 * How much of the colour is up when a dip is `r` of the way through going to
 * it, 0 to 1: straight up for a dip, and only over the last part for a kind
 * that comes up late, as the export's fade does when it starts late.
 */
export function washRise(kind: string, r: number): number {
  const late = pictureKind(kind)?.late ?? 0
  return Math.min(1, Math.max(0, (r - late) / (1 - late)))
}

/**
 * Plan 95: the stylised kinds' own numbers, which the preview draws by and the
 * export writes into its filters, so the two cannot drift apart. Each is a
 * function of how far through the window a frame is, 0 to 1.
 */

/** `xfade`'s smoothstep from 0 to 1: slow out, quick through the middle, slow in. */
export function eased(q: number): number {
  const t = Math.min(1, Math.max(0, q))
  return t * t * (3 - 2 * t)
}

/** How enlarged the next picture starts in a zoom out, pulling back from it to its own size. */
export const ZOOM_OUT_FROM = 4

/** How enlarged the next picture is through a zoom out. */
export function zoomOutAt(q: number): number {
  return 1 + (ZOOM_OUT_FROM - 1) * (1 - eased(q))
}

/** How far a spin has turned, in radians clockwise: one whole turn, eased. */
export function spinAt(q: number): number {
  return 2 * Math.PI * eased(q)
}

/**
 * How far an RGB split pulls red left and blue right, in whole pixels of a
 * frame `width` wide: none at either end, 3 % of the width at the middle.
 */
export function rgbSplitAt(q: number, width: number): number {
  return Math.round(0.03 * width * (1 - Math.abs(2 * Math.min(1, Math.max(0, q)) - 1)))
}

/** How blurred a blur transition is at its middle, as a share of the frame's width. */
export const BLUR_PEAK = 0.015

/**
 * How blurred both pictures are through a blur transition, as the deviation
 * of a gaussian in whole pixels of a frame `width` wide: none at either end,
 * the most at the middle, rising and falling smoothly. The same both ways, so
 * it softens the picture rather than smearing it sideways (task 1092).
 */
export function blurAt(q: number, width: number): number {
  return Math.round(BLUR_PEAK * width * Math.sin(Math.PI * Math.min(1, Math.max(0, q))) * 10) / 10
}

/** Two pictures of one track being mixed at a frame, and how far through it is. */
export interface Blending {
  /** The clip the window starts on, drawn underneath. */
  fromClipId: string
  /** The clip it turns into, drawn over it. */
  toClipId: string
  kind: string
  /** 0 on the window's first frame, approaching 1 on its last. */
  p: number
}

/**
 * The two pictures being mixed at a frame, or null where one picture is enough.
 *
 * Only a blend: a dip through a colour hands the picture over in the middle of
 * its window and never wants two at once, and a transition with nothing on the
 * other side has only one picture to show.
 */
export function blendAt(windows: readonly TransitionWindow[], frame: number): Blending | null {
  for (const w of windows) {
    if (frame < w.from || frame >= w.to) continue
    if (w.splitAt !== null || w.fromClipId === null || w.toClipId === null) continue
    if (washColour(w.kind) !== null) continue
    return { fromClipId: w.fromClipId, toClipId: w.toClipId, kind: w.kind, p: through(w.from, w.to, frame) }
  }
  return null
}

/**
 * A fade curve's gain at `p`, from silence at 0 to full at 1, matching
 * ffmpeg's own `afade` curves so that what is heard in the preview is what
 * lands in the file.
 */
export function curveGain(curve: string, p: number): number {
  const at = Math.min(1, Math.max(0, p))
  if (curve === 'qsin') return Math.sin((at * Math.PI) / 2)
  if (curve === 'exp') return Math.pow(0.1, (1 - at) * 5)
  return at
}

/**
 * What a sound clip's loudness is multiplied by at a frame: 1 anywhere no fade
 * covers it, and the curve where one does.
 *
 * Both fades of a crossfade are worked out from the same window, so two sounds
 * on an Even crossfade come to exactly the same loudness at its middle.
 */
export function fadeGainAt(windows: readonly TransitionWindow[], clipId: string, frame: number): number {
  let gain = 1
  for (const w of windows) {
    if (frame < w.from || frame >= w.to) continue
    const curve = soundKind(w.kind)?.curve ?? 'tri'
    const p = through(w.from, w.to, frame)
    if (w.fromClipId === clipId) gain *= curveGain(curve, 1 - p)
    if (w.toClipId === clipId) gain *= curveGain(curve, p)
  }
  return gain
}

/**
 * How many frames at each end of a clip's shown span have no footage behind
 * them, and are the same frame held: Premiere's "insufficient media", which it
 * marks with diagonal bars and fills with the last frame it has.
 */
export function heldFrames(clip: Transitioned, shown: Shown, sourceFrames: number): { head: number; tail: number } {
  // The footage either side, as frames of the timeline at the clip's speed (plan 105).
  const s = speedOf(clip)
  return {
    head: Math.max(0, clip.timelineStart - shown.from - Math.floor(clip.sourceIn / s + 1e-9)),
    tail: Math.max(0, shown.to - spanEnd(clip) - Math.floor(Math.max(0, sourceFrames - clip.sourceOut) / s + 1e-9))
  }
}

/**
 * How many frames at each end of one window hold a frame for want of footage.
 *
 * Both clips under it, not only the one that stores it: at a cut the outgoing
 * one can run out of tail while the incoming one has all the head it needs,
 * and the hatching has to be on the end that is short.
 */
export function heldInWindow(
  clips: readonly Transitioned[],
  kinds: KindSet,
  w: TransitionWindow,
  sourceFrames: (clip: Transitioned) => number
): { head: number; tail: number } {
  return heldInWindows(clips, kinds, [w], sourceFrames).get(w)!
}

/**
 * `heldInWindow` for every window of a track at once, keyed by the window.
 * What each clip is shown for is worked out once for the track: worked out
 * again for each window, a timeline with a transition on every cut took a
 * quarter of a second to draw, and it draws on every frame (audit 2026-10-08).
 */
export function heldInWindows(
  clips: readonly Transitioned[],
  kinds: KindSet,
  windows: readonly TransitionWindow[],
  sourceFrames: (clip: Transitioned) => number
): Map<TransitionWindow, { head: number; tail: number }> {
  const shown = shownSpans(clips, kinds)
  const byId = new Map(clips.map((c) => [c.id, c] as const))
  const at = (id: string | null): { head: number; tail: number } => {
    const clip = id === null ? undefined : byId.get(id)
    const span = clip ? shown.get(clip.id) : undefined
    return clip && span ? heldFrames(clip, span, sourceFrames(clip)) : { head: 0, tail: 0 }
  }
  // The clip that arrives runs short at the window's start, where it is being
  // shown before its own first frame, and the one that leaves runs short at
  // its end. Each end is hatched against whichever of the two is held there.
  return new Map(windows.map((w) => [w, { head: at(w.toClipId ?? w.fromClipId).head, tail: at(w.fromClipId ?? w.toClipId).tail }] as const))
}
