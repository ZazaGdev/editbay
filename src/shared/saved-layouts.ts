import { newId } from './ids'
import { PRESETS } from './presets'
import { MAX_LAYERS, type LayoutKind, type Place } from './layout'
import { cleanOverlay, cleanPictureStyle, type Framing, type Layer, type Rect } from './project'

/**
 * Plan 68: framings saved under a name, such as "Game + facecam", and applied
 * to any picture clip in one click. Yours rather than a project's: kept with
 * the app's settings, so every project has them.
 */
export interface SavedLayout {
  id: string
  name: string
  /** What Copy framing copies, applied the way Paste framing applies it. */
  framing: Framing
}

/** The longest a layout's name may be. */
export const MAX_LAYOUT_NAME = 60
/** The most layouts kept: a list longer than this is no quicker than framing by hand. */
export const MAX_SAVED_LAYOUTS = 50

const LAYOUT_KINDS: readonly LayoutKind[] = ['single', 'split', 'pip', 'custom']

/** A name as it is kept: trimmed, one space between words, and no longer than the most. */
export function cleanLayoutName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_LAYOUT_NAME).trim()
}

function rect(raw: unknown): Rect | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (!n(r.x) || !n(r.y) || !n(r.w) || !n(r.h) || !(r.w > 0) || !(r.h > 0)) return null
  return { x: r.x, y: r.y, w: r.w, h: r.h }
}

/** A stored framing, or null when any part of it is damaged: half a layout is worse than none. */
export function cleanFraming(raw: unknown): Framing | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const crop = rect(r.crop)
  const place = rect(r.place) as Place | null
  const size = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  const [width, height, frameW, frameH] = [size(r.width), size(r.height), size(r.frameW), size(r.frameH)]
  if (!crop || !place || width === null || height === null || frameW === null || frameH === null) return null
  if (!LAYOUT_KINDS.includes(r.layout as LayoutKind) || !Array.isArray(r.layers) || r.layers.length > MAX_LAYERS) return null
  const layers: Layer[] = []
  for (const l of r.layers as unknown[]) {
    const x = l as Record<string, unknown> | null
    const lc = rect(x?.crop)
    const lp = rect(x?.place) as Place | null
    if (!x || typeof x.id !== 'string' || x.id === '' || !lc || !lp) return null
    const style = cleanPictureStyle(x.style)
    layers.push({ id: x.id, crop: lc, place: lp, ...(style ? { style } : {}) })
  }
  return {
    crop,
    place,
    layers,
    layout: r.layout as LayoutKind,
    width,
    height,
    frameW,
    frameH,
    ...cleanOverlay({ rotation: r.rotation, opacity: r.opacity })
  }
}

/** The layouts as stored, each checked: a damaged one goes and the rest stay, one to a name. */
export function cleanSavedLayouts(raw: unknown): SavedLayout[] {
  if (!Array.isArray(raw)) return []
  const out: SavedLayout[] = []
  for (const item of raw) {
    const x = item as Record<string, unknown> | null
    const name = typeof x?.name === 'string' ? cleanLayoutName(x.name) : ''
    const framing = cleanFraming(x?.framing)
    if (!x || typeof x.id !== 'string' || x.id === '' || name === '' || !framing) continue
    if (out.some((l) => l.id === x.id || sameName(l.name, name))) continue
    out.push({ id: x.id, name, framing })
    if (out.length === MAX_SAVED_LAYOUTS) break
  }
  return out
}

function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase()
}

/** The layout of this name, whatever its capitals, if there is one. */
export function layoutNamed(list: readonly SavedLayout[], name: string): SavedLayout | undefined {
  const wanted = cleanLayoutName(name)
  return list.find((l) => sameName(l.name, wanted))
}

/**
 * A framing saved under a name: a new layout at the end, or, under a name
 * already there, that layout with the new framing, where it was in the list.
 * Unchanged when the name is empty or the list is full.
 */
export function saveLayout(list: readonly SavedLayout[], name: string, framing: Framing, id: string = newId()): SavedLayout[] {
  const clean = cleanLayoutName(name)
  if (clean === '') return [...list]
  const had = layoutNamed(list, clean)
  if (had) return list.map((l) => (l.id === had.id ? { ...l, framing } : l))
  if (list.length >= MAX_SAVED_LAYOUTS) return [...list]
  return [...list, { id, name: clean, framing }]
}

/** A layout given a new framing, keeping its name and place in the list. */
export function updateLayout(list: readonly SavedLayout[], id: string, framing: Framing): SavedLayout[] {
  return list.map((l) => (l.id === id ? { ...l, framing } : l))
}

/** A layout renamed. Refused (unchanged) for an empty name or one another layout has. */
export function renameLayout(list: readonly SavedLayout[], id: string, name: string): SavedLayout[] {
  const clean = cleanLayoutName(name)
  const taken = list.some((l) => l.id !== id && sameName(l.name, clean))
  if (clean === '' || taken) return [...list]
  return list.map((l) => (l.id === id ? { ...l, name: clean } : l))
}

/** A layout taken off the list. */
export function removeLayout(list: readonly SavedLayout[], id: string): SavedLayout[] {
  return list.filter((l) => l.id !== id)
}

/** A layout put back where it was, as Undo after a delete does. */
export function restoreLayout(list: readonly SavedLayout[], layout: SavedLayout, index: number): SavedLayout[] {
  if (list.some((l) => l.id === layout.id)) return [...list]
  const at = Math.min(Math.max(0, index), list.length)
  return [...list.slice(0, at), layout, ...list.slice(at)]
}

/** A name for a new layout that no other has: "Layout 1", "Layout 2" and so on. */
export function nextLayoutName(list: readonly SavedLayout[]): string {
  for (let n = list.length + 1; ; n++) {
    const name = `Layout ${n}`
    if (!layoutNamed(list, name)) return name
  }
}

/**
 * The shape a layout was saved in, found from the size of the frame it was
 * saved on, or null for one saved under Handoff, which has no shape to set.
 */
export function layoutShape(layout: SavedLayout): string | null {
  const { frameW, frameH } = layout.framing
  return PRESETS.find((p) => p.width === frameW && p.height === frameH)?.id ?? null
}
