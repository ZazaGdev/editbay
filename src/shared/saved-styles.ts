/**
 * Plan 99: caption styles and text styles saved under a name, kept with the
 * app's settings so every project has them, as saved shape styles are (plan
 * 83). The two lists are separate: saving or using one never touches the other.
 */

import { newId } from './ids'
import { DEFAULT_CAPTION_STYLE, cleanCaptionStyle, type CaptionStyle, type CaptionStyleChange } from './captions'
import { captionLook } from './apply-to-all'
import { DEFAULT_TEXT, cleanTextStyle, type TextStyle } from './text'

/** A look of your own, named. */
export interface SavedStyle<S> {
  id: string
  name: string
  style: S
}

/** A caption style keeps how captions look, not where they sit. */
export type SavedCaptionStyle = SavedStyle<CaptionStyleChange>
/** A text style keeps everything but the words. */
export type SavedTextStyle = SavedStyle<TextStyle>

export const MAX_SAVED_STYLES = 40
export const MAX_STYLE_NAME = 60

export function cleanStyleName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_STYLE_NAME).trim()
}

/** A caption style as it is kept: its look, made safe. */
export function captionStyleToSave(style: CaptionStyle): CaptionStyleChange {
  return captionLook(cleanCaptionStyle(style))
}

/** A text style as it is kept: made safe, without its words. */
export function textStyleToSave(style: TextStyle): TextStyle {
  return { ...cleanTextStyle(style), text: DEFAULT_TEXT.text }
}

function cleanList<S>(raw: unknown, clean: (style: unknown) => S): SavedStyle<S>[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedStyle<S>[] = []
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue
    const r = x as Record<string, unknown>
    const id = typeof r.id === 'string' && r.id !== '' ? r.id : null
    const name = typeof r.name === 'string' ? cleanStyleName(r.name) : ''
    if (!id || name === '' || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, style: clean(r.style) })
    if (out.length >= MAX_SAVED_STYLES) break
  }
  return out
}

/** Saved caption styles read back from the settings: a damaged one goes, the rest stay. */
export function cleanSavedCaptionStyles(raw: unknown): SavedCaptionStyle[] {
  return cleanList(raw, (s) => captionStyleToSave({ ...cleanCaptionStyle(s), height: DEFAULT_CAPTION_STYLE.height, across: DEFAULT_CAPTION_STYLE.across }))
}

export function cleanSavedTextStyles(raw: unknown): SavedTextStyle[] {
  return cleanList(raw, (s) => textStyleToSave(cleanTextStyle(s)))
}

/** A style saved under a name, last in the list; one of the same name is replaced where it is. */
export function saveStyle<S>(list: readonly SavedStyle<S>[], name: string, style: S, id: string = newId()): SavedStyle<S>[] {
  const clean = cleanStyleName(name)
  if (clean === '') return [...list]
  const same = list.findIndex((s) => s.name.toLowerCase() === clean.toLowerCase())
  if (same >= 0) return list.map((s, i) => (i === same ? { ...s, style } : s))
  return [...list, { id, name: clean, style }].slice(-MAX_SAVED_STYLES)
}

export function removeStyle<S>(list: readonly SavedStyle<S>[], id: string): SavedStyle<S>[] {
  return list.filter((s) => s.id !== id)
}

/** The name a new saved style is offered: "My caption style", numbered past any taken. */
export function nextStyleName(list: readonly SavedStyle<unknown>[], base: string): string {
  const taken = new Set(list.map((s) => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
