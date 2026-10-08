/**
 * Plan 92: where the Inspector's sections are. Any of them can sit beside the
 * timeline, on its left or its right, and the Inspector's picker hides the
 * ones not ticked. All of it is how the person likes the window, kept with the
 * window's own settings and never with a project.
 */

export type SectionSide = 'left' | 'right'
/** Where a section can be put: beside the timeline, or back in the Inspector only. */
export type SectionPlace = SectionSide | 'inspector'

/** Every section the Inspector can show, in the order it shows them. */
export const SECTION_NAMES: readonly string[] = [
  'Colour',
  'Text',
  'Shape',
  'Frame',
  'Picture in picture',
  'Zoom',
  'Crop',
  'Look',
  'Blur',
  'Tools',
  'Sound',
  'Linked',
  'Source',
  'Caption',
  'How captions look'
]

export interface SectionLayout {
  /** The sections beside the timeline on each side, top to bottom. */
  left: string[]
  right: string[]
  /**
   * Ticked off in the Inspector's picker, so hidden there. A section put beside
   * the timeline is ticked off as it goes, and ticked back on when it is taken
   * away: kept in the Inspector, out of sight until wanted in both places.
   */
  hidden: string[]
  leftWidth: number
  rightWidth: number
  /** A section beside the timeline's share of that side's height. One not here has a share of 1. */
  shares: Record<string, number>
}

export const DOCK_WIDTH = 260
export const DOCK_MIN = 200
export const DOCK_MAX = 480

export const DEFAULT_SECTION_LAYOUT: SectionLayout = {
  left: [],
  right: [],
  hidden: [],
  leftWidth: DOCK_WIDTH,
  rightWidth: DOCK_WIDTH,
  shares: {}
}

function names(raw: unknown, taken: Set<string>): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const n of raw) {
    if (typeof n !== 'string' || !SECTION_NAMES.includes(n) || taken.has(n)) continue
    taken.add(n)
    out.push(n)
  }
  return out
}

function width(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, raw))) : DOCK_WIDTH
}

/** As stored: names the Inspector knows, each on one side at most, widths that fit, shares above nothing. */
export function cleanSectionLayout(raw: unknown): SectionLayout {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const docked = new Set<string>()
  const left = names(r.left, docked)
  const right = names(r.right, docked)
  const hidden = names(r.hidden, new Set())
  const rawShares = typeof r.shares === 'object' && r.shares !== null && !Array.isArray(r.shares) ? (r.shares as Record<string, unknown>) : {}
  const shares = Object.fromEntries(
    Object.entries(rawShares).filter((e): e is [string, number] => docked.has(e[0]) && typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0)
  )
  return { left, right, hidden, leftWidth: width(r.leftWidth), rightWidth: width(r.rightWidth), shares }
}

/** Which side of the timeline a section is on, or null when it is in the Inspector only. */
export function sideOf(layout: SectionLayout, name: string): SectionSide | null {
  if (layout.left.includes(name)) return 'left'
  if (layout.right.includes(name)) return 'right'
  return null
}

/**
 * A section put somewhere: on a side of the timeline, at `index` among the
 * sections there (the end when left out), or taken away from beside it.
 */
export function placeSection(layout: SectionLayout, name: string, to: SectionPlace, index?: number): SectionLayout {
  const from = sideOf(layout, name)
  const lists = { left: [...layout.left], right: [...layout.right] }
  let at = index
  if (from) {
    const was = lists[from].indexOf(name)
    lists[from].splice(was, 1)
    if (from === to && at !== undefined && was < at) at--
  }
  if (to !== 'inspector') {
    const list = lists[to]
    list.splice(Math.max(0, Math.min(at ?? list.length, list.length)), 0, name)
  }
  let hidden = layout.hidden
  if (!from && to !== 'inspector' && !hidden.includes(name)) hidden = [...hidden, name]
  if (from && to === 'inspector') hidden = hidden.filter((n) => n !== name)
  const shares = { ...layout.shares }
  if (from !== to) delete shares[name]
  return { ...layout, ...lists, hidden, shares }
}

/** A section beside the timeline moved one place up or down its side. */
export function stepSection(layout: SectionLayout, name: string, by: -1 | 1): SectionLayout {
  const side = sideOf(layout, name)
  if (!side) return layout
  const list = [...layout[side]]
  const i = list.indexOf(name)
  const j = i + by
  if (j < 0 || j >= list.length) return layout
  list.splice(i, 1)
  list.splice(j, 0, name)
  return { ...layout, [side]: list }
}

/** A section ticked on or off in the Inspector's picker. */
export function showSection(layout: SectionLayout, name: string, shown: boolean): SectionLayout {
  const hidden = layout.hidden.filter((n) => n !== name)
  return { ...layout, hidden: shown ? hidden : [...hidden, name] }
}

/** The Inspector showing this one section and no other. */
export function showOnly(layout: SectionLayout, name: string): SectionLayout {
  return { ...layout, hidden: SECTION_NAMES.filter((n) => n !== name) }
}

/** Every section ticked on again. */
export function showAll(layout: SectionLayout): SectionLayout {
  return { ...layout, hidden: [] }
}
