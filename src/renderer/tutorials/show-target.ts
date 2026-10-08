import type { Need } from '../../shared/tutorials'

/**
 * Finding what a Show me step is about on screen (task 84): the elements of
 * the kind it needs, the one nearest the playhead, and the part of a control
 * that is really drawn once it is scrolled into view.
 */

const CLIP = '[data-testid="clip"]'

/** Each kind's elements, and whether Show me selects one before looking for the control. */
const KINDS: Record<Need, { find: () => HTMLElement[]; select?: 'clip' | 'caption' }> = {
  picture: { find: () => all(`${CLIP}[data-source="video"], ${CLIP}[data-source="still"]`), select: 'clip' },
  video: { find: () => all(`${CLIP}[data-source="video"]`), select: 'clip' },
  above: {
    find: () => all(`[data-testid="track"]:not([data-track-id="v1"]) ${CLIP}[data-source="video"]`),
    select: 'clip'
  },
  overlay: { find: () => all(`${CLIP}[data-source="still"], ${CLIP}[data-source="text"], ${CLIP}[data-source="shape"]`), select: 'clip' },
  text: { find: () => all(`${CLIP}[data-source="text"]`), select: 'clip' },
  shape: { find: () => all(`${CLIP}[data-source="shape"]`), select: 'clip' },
  sound: { find: () => all('[data-testid="sound-clip"]'), select: 'clip' },
  linked: { find: () => all(`${CLIP}[data-source="video"]`).filter((el) => el.dataset['link'] !== ''), select: 'clip' },
  group: { find: () => all(CLIP).filter((el) => el.dataset['group'] !== ''), select: 'clip' },
  // The clip that starts where another on its track ends: the cut is at its start.
  cut: {
    find: () =>
      all(CLIP).filter((el) => {
        const start = Number(el.dataset['start'])
        const track = el.closest('[data-testid="track"]')
        return [...(track?.querySelectorAll<HTMLElement>(CLIP) ?? [])].some(
          (o) => o !== el && Number(o.dataset['start']) + Number(o.dataset['lengthFrames']) === start
        )
      })
  },
  caption: { find: () => all('[data-testid="caption"]'), select: 'caption' },
  transition: { find: () => all('[data-testid="clip-transition"]') },
  marker: { find: () => all('[data-testid="marker"]') },
  keyframes: { find: () => all('[data-testid="clip-keyframe"]'), select: 'clip' },
  // A clip too narrow for its marks shows one "fx" instead.
  marked: { find: () => all('[data-testid="clip-mark-effect"], [data-testid="clip-effects"]') },
  many: { find: () => all('[data-testid="bin-sort"]') },
  days: { find: () => all('[data-testid="bin-group-toggle"]') },
  asset: { find: () => all('[data-testid="asset"]') },
  // An effect's own button, or, with the assets folder shut, the folder.
  effect: {
    find: () => {
      const open = all('[data-testid="effect-more"]')
      return open.length > 0 ? open : all('[data-testid="source-folder"][data-kind="effects"]')
    }
  },
  missing: { find: () => all('[data-testid="missing-media"]') }
}

function all(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)]
}

/** What Show me needs from the app to select things. */
export interface Picker {
  playhead: () => number
  selectClip: (clipId: string) => void
  selectCaption: (captionId: string) => void
  /** The monitor on its Output view, with the playhead moved to `frame` when given. */
  toOutput: (frame?: number) => void
}

/** Controls drawn over the Output view, which are only there with the picture or caption under the playhead. */
const ON_OUTPUT: ReadonlySet<string> = new Set(['monitor-picture', 'caption-box'])

/** For a control on the Output view: that view, and the playhead inside the element when it is not already. */
export function showOnOutput(target: string, el: HTMLElement | null, pick: Picker): void {
  if (!ON_OUTPUT.has(target)) return
  if (!el) return pick.toOutput()
  const inside = distance(el, pick.playhead()) === 0
  const start = Number(el.dataset['start'])
  pick.toOutput(inside || !Number.isFinite(start) ? undefined : start)
}

/** How far an element lies from the playhead, in frames: 0 when the playhead is inside it. */
function distance(el: HTMLElement, playhead: number): number {
  el = el.dataset['start'] === undefined ? (el.closest<HTMLElement>('[data-start]') ?? el) : el
  const start = Number(el.dataset['start'])
  const length = Number(el.dataset['lengthFrames'])
  if (!Number.isFinite(start)) return Infinity
  const end = start + (Number.isFinite(length) ? length : 0)
  return playhead < start ? start - playhead : playhead >= end ? playhead - end + 1 : 0
}

/**
 * The element of this kind the step is about: one already selected, or else
 * the one nearest the playhead, the owner's choice ("the closest to where the
 * user stands"). Null when there is none.
 */
export function elementFor(need: Need, playhead: number): HTMLElement | null {
  const found = KINDS[need].find()
  if (found.length === 0) return null
  const selected = found.find((el) => (el.closest<HTMLElement>('[data-selected]') ?? el).dataset['selected'] === 'yes')
  if (selected) return selected
  return [...found].sort((a, b) => distance(a, playhead) - distance(b, playhead))[0]!
}

/** Select the element, when its kind is one the app selects and it is not selected yet. */
export function selectFor(need: Need, el: HTMLElement, pick: Picker): void {
  const how = KINDS[need].select
  // A keyframe's diamond selects the clip it is on.
  const clip = how === 'clip' ? el.closest<HTMLElement>('[data-clip-id]') : null
  if ((clip ?? el).dataset['selected'] === 'yes') return
  if (clip?.dataset['clipId']) pick.selectClip(clip.dataset['clipId'])
  if (how === 'caption' && el.dataset['captionId']) pick.selectCaption(el.dataset['captionId'])
}

/** The part of an element inside every scrolled panel around it and the window, or null when none of it is. */
export function visibleBox(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  let left = r.left
  let top = r.top
  let right = r.right
  let bottom = r.bottom
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (s.display === 'none' || s.visibility === 'hidden') return null
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const b = p.getBoundingClientRect()
      if (s.overflowX !== 'visible') {
        left = Math.max(left, b.left)
        right = Math.min(right, b.right)
      }
      if (s.overflowY !== 'visible') {
        top = Math.max(top, b.top)
        bottom = Math.min(bottom, b.bottom)
      }
    }
  }
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  right = Math.min(right, innerWidth)
  bottom = Math.min(bottom, innerHeight)
  // Less than a few pixels showing is a sliver, not a control anyone can find.
  if (right - left < 4 || bottom - top < 4) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

/** Bring an element into view in the panels that scroll it, nearest edge first. */
export function bringIntoView(el: Element): void {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/**
 * The box of a control with this test id: `within` first when given, as a
 * clip's own handles are looked for inside that clip, then the first drawn
 * anywhere. Brought into view before it is measured.
 */
export function controlBox(target: string, within?: HTMLElement | null): DOMRect | null {
  const sel = `[data-testid="${CSS.escape(target)}"]`
  const candidates: Element[] = []
  if (within) {
    if (within.matches(sel)) candidates.push(within)
    candidates.push(...within.querySelectorAll(sel))
  }
  candidates.push(...document.querySelectorAll(sel))
  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    bringIntoView(el)
    const box = visibleBox(el)
    if (box) return box
  }
  return null
}
