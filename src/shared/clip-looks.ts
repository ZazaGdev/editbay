/**
 * How a clip's picture looks: a picture in picture's box style, the blurred fill,
 * looks, background removal, blur and colour adjustments.
 */

import { cleanLook, cleanStrength, type BackgroundRemoval, cleanBackground, type ColourAdjust, cleanAdjust } from './looks'
import { cleanAmount, type BlurBox, cleanBoxes } from './blur'
import { clamp } from './project-core'
import type { PictureStyle, Timeline } from './project'
import { updateVideoClip } from './timeline-query'

/**
 * The most a picture's corners are rounded and its border is wide, in output
 * pixels. The radius is drawn at no more than half the box's shorter side, so
 * a large one is how a box is made a circle.
 */
export const MAX_CORNER_PX = 2000
export const MAX_BORDER_PX = 40

/**
 * A picture's style, tidied: whole pixels within bounds, a colour that is
 * one, and nothing kept that does nothing. Undefined for a plain box.
 */
export function cleanPictureStyle(raw: unknown): PictureStyle | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const px = (v: unknown, most: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 0, most)) : 0)
  const radius = px(r.radius, MAX_CORNER_PX)
  const border = px(r.border, MAX_BORDER_PX)
  const colour = typeof r.borderColour === 'string' && /^#[0-9a-f]{6}$/i.test(r.borderColour) ? r.borderColour.toLowerCase() : undefined
  const style: PictureStyle = {
    ...(radius > 0 ? { radius } : {}),
    ...(border > 0 ? { border, ...(colour && colour !== '#ffffff' ? { borderColour: colour } : {}) } : {}),
    ...(r.shadow === true ? { shadow: true } : {})
  }
  return Object.keys(style).length > 0 ? style : undefined
}

/**
 * A picture in picture's frame: its corners, border and shadow, on a
 * clip's picture by its id, `main` for its main picture. Null takes it off.
 */
export function setPictureStyle(p: Timeline, clipId: string, picture: string, style: PictureStyle | null): Timeline {
  const clean = cleanPictureStyle(style)
  return updateVideoClip(p, clipId, (c) => {
    if (picture === 'main') {
      const { style: _was, ...transform } = c.transform
      return { ...c, transform: clean ? { ...transform, style: clean } : transform }
    }
    return {
      ...c,
      layers: c.layers.map((l) => {
        if (l.id !== picture) return l
        const { style: _was, ...rest } = l
        return clean ? { ...rest, style: clean } : rest
      })
    }
  })
}

/** Fill the bars round a clip's pictures with the picture blurred, or with black again. */
export function setBlurFill(p: Timeline, clipId: string, on: boolean): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const { blurFill: _was, ...rest } = c
    return on ? { ...rest, blurFill: true } : rest
  })
}

/**
 * A look on a clip's pictures, or null to give it its own colour back. Only
 * this clip: a look belongs to the picture, and its linked sound has none.
 */
export function setLook(p: Timeline, clipId: string, look: string | null): Timeline {
  const clean = cleanLook(look)
  return updateVideoClip(p, clipId, (c) => {
    // A look taken off takes its strength with it; another look keeps it.
    const { look: _gone, lookStrength, ...rest } = c
    if (clean === undefined) return rest
    return { ...rest, look: clean, ...(lookStrength !== undefined ? { lookStrength } : {}) }
  })
}

/** How strongly a clip's look is on, 0 to 100; 100 is full and stored as nothing. */
export function setLookStrength(p: Timeline, clipId: string, strength: number): Timeline {
  const clean = cleanStrength(strength)
  return updateVideoClip(p, clipId, (c) => {
    const { lookStrength: _gone, ...rest } = c
    return clean === undefined ? rest : { ...rest, lookStrength: clean }
  })
}

/** Take out a clip's green, blue or black background, or put it back with null (plan 90). */
export function setRemoveBackground(p: Timeline, clipId: string, removal: BackgroundRemoval | null): Timeline {
  const clean = cleanBackground(removal)
  return updateVideoClip(p, clipId, (c) => {
    // A text, a shape or a colour is drawn by the app and has no background to
    // take out, even as a piece of a group whose recordings do.
    const m = p.media.find((x) => x.id === c.mediaId)
    if (m && (m.text !== undefined || m.shape !== undefined || m.colour !== undefined)) return c
    const { removeBackground: _gone, ...rest } = c
    return clean === undefined ? rest : { ...rest, removeBackground: clean }
  })
}

/** Blur the whole of a clip's picture by 1 to 100, or make it sharp again with null or 0. */
export function setBlur(p: Timeline, clipId: string, amount: number | null): Timeline {
  const clean = cleanAmount(amount)
  return updateVideoClip(p, clipId, (c) => {
    const { blur: _gone, ...rest } = c
    return clean === undefined ? rest : { ...rest, blur: clean }
  })
}

/** A clip's blurred boxes, all of them at once: added, moved, sized or taken away. */
export function setBlurBoxes(p: Timeline, clipId: string, boxes: readonly BlurBox[]): Timeline {
  const clean = cleanBoxes(boxes)
  return updateVideoClip(p, clipId, (c) => {
    const { blurBoxes: _gone, ...rest } = c
    return clean === undefined ? rest : { ...rest, blurBoxes: clean }
  })
}

/**
 * Move some of a clip's four sliders, each -100 to 100; 0 puts one back to
 * as recorded. The others stay where they are.
 */
export function setColourAdjust(p: Timeline, clipId: string, change: ColourAdjust): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const { adjust: was, ...rest } = c
    const adjust = cleanAdjust({ ...was, ...change })
    return adjust === undefined ? rest : { ...rest, adjust }
  })
}
