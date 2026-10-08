import { moves } from './crop-geometry'
import { isFullFrame } from './layout'
import { lookOf } from './looks'
import type { Clip, SoundClip } from './project'

/**
 * What has been done to a clip, as the small marks on its name strip say:
 * a zoom, a look, a picture framed other than filling the frame, and a
 * sound worked on. So a scan down the timeline shows which clips carry an
 * effect without opening each one.
 */

export type ClipMarkKind = 'zoom' | 'look' | 'framing' | 'sound'

export interface ClipMark {
  kind: ClipMarkKind
  /** What the mark says on hover, in plain words. */
  title: string
  /** The Inspector section a click on the mark opens. */
  section: string
}

const LAYOUT_WORDS: Record<Clip['layout'], string> = {
  single: '',
  split: 'Split',
  pip: 'Picture in picture',
  custom: 'Pictures placed by hand'
}

/**
 * A picture clip's marks, in the order they are drawn. A text or an image is
 * always somewhere in the frame of its own, so being placed is no news there.
 */
export function pictureMarks(c: Clip, freelyPlaced = false): ClipMark[] {
  const out: ClipMark[] = []
  // Any picture's zoom: the main one's, or a further picture's own.
  const zooming = [c.transform.keys ?? [], ...c.layers.map((l) => l.keys ?? [])].filter((keys) => moves(keys))
  const count = zooming.reduce((n, keys) => n + keys.length, 0)
  if (zooming.length > 0) {
    out.push({ kind: 'zoom', title: zooming.length === 1 ? `Zooms, with ${count} keyframes` : `${zooming.length} pictures zoom, with ${count} keyframes`, section: 'Zoom' })
  }
  const look = c.look ? lookOf(c.look) : null
  // The look and how strongly, and whether the sliders are moved (plan 85).
  const colour = [
    ...(look ? [`${look.name}${c.lookStrength !== undefined ? ` at ${c.lookStrength}%` : ''}`] : []),
    ...(c.adjust ? ['colour adjusted'] : []),
    ...(c.blur !== undefined ? ['blurred'] : []),
    ...(c.blurBoxes ? [c.blurBoxes.length === 1 ? 'a blurred box' : `${c.blurBoxes.length} blurred boxes`] : [])
  ]
  // Only blurred: the Blur section holds that, not Look.
  const onlyBlur = !look && !c.adjust
  if (colour.length > 0) out.push({ kind: 'look', title: `Look: ${colour.join(', ')}`, section: onlyBlur ? 'Blur' : 'Look' })
  const framing: string[] = []
  if (LAYOUT_WORDS[c.layout] !== '' && (c.layers.length > 0 || c.layout !== 'custom')) framing.push(LAYOUT_WORDS[c.layout])
  else if (!freelyPlaced && !isFullFrame(c.transform.place)) framing.push('Placed in the frame')
  if (c.transform.style) framing.push('a frame round the picture')
  if (c.blurFill) framing.push('bars filled with the picture, blurred')
  if (framing.length > 0) out.push({ kind: 'framing', title: capital(framing.join(', ')), section: 'Frame' })
  return out
}

/** A sound clip's marks: noise cleaned up, the voice enhanced, a volume other than 100%. Muted has its own word. */
export function soundMarks(c: SoundClip): ClipMark[] {
  const said: string[] = []
  if (c.denoise) said.push('noise cleaned up')
  if (c.voice) said.push(`voice enhanced, ${c.voice}`)
  if (Math.abs(c.gain - 1) > 1e-3) said.push(`volume ${Math.round(c.gain * 100)}%`)
  return said.length > 0 ? [{ kind: 'sound', title: capital(said.join(', ')), section: 'Sound' }] : []
}

/**
 * Whether a clip's marks fit on its name strip as they are, or go down to one
 * "fx" and a count: each mark needs its width, and the name needs a little room.
 */
export function marksFit(count: number, widthPx: number): boolean {
  return widthPx >= 56 + count * 14
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
