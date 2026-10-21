/**
 * A picture's box moving in an export (plan 97): the finished box, frame and
 * shadow and all, scaled and faded frame by frame where its keyframes change
 * its size or its opacity, and laid over where they put it. By `boxAtKeys`'s
 * own arithmetic, as the preview moves it.
 */

import { boxAtKeys, boxMoves } from './box-keys'
import type { BoxKey, Rect } from './project'
import { keyedValue } from './render-moves'

/** A box's keyframes on a piece's clock: the recording's frame the piece starts on, and how many frames it is. */
export interface BoxClock {
  keys: BoxKey[]
  first: number
  frames: number
  /** Frames of the recording a frame of the piece moves on, the clip's speed (plan 105). Absent for 1. */
  speed?: number
}

/** The keyframes a piece needs, those inside it and one either side, when they move the box within it. */
export function boxClock(keys: readonly BoxKey[] | undefined, clock: { first: number; frames: number; speed?: number } | undefined): BoxClock | undefined {
  if (!keys || !clock || !boxMoves(keys)) return undefined
  const lastFrame = clock.first + (Math.max(1, clock.frames) - 1) * (clock.speed ?? 1)
  let lo = 0
  for (let i = 0; i < keys.length; i++) if (keys[i]!.at <= clock.first) lo = i
  let hi = keys.length - 1
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i]!.at >= lastFrame) hi = i
  const used = keys.slice(lo, Math.max(lo, hi) + 1)
  return boxMoves(used) ? { keys: used, ...clock } : undefined
}

function even(n: number): number {
  return Math.max(2, Math.ceil(n / 2) * 2)
}

/** A number written short, to six places. */
function short(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * What a moving box needs, laid over in a frame `width` by `height`: the
 * filters for the finished box before it is laid over, and the overlay's `x`
 * and `y`. `box` is its own place in pixels and `reach` how far its frame and
 * shadow reach out of it. The recording's frame is the piece's first and as
 * many on as the frame's time in the piece says.
 *
 * Its size is worked out on every frame only when the keyframes change it,
 * and its opacity, set frame by frame, only when they change that; a box that
 * only slides is laid over at a moving place and nothing more.
 */
export function movingBox(
  m: BoxClock,
  box: Rect,
  reach: number,
  width: number,
  height: number,
  fps: number,
  colours: { toRgb: string; toVideo: string }
): { before: string; x: string; y: string } {
  // By the frame's time rather than `n`, which `overlay` counts from 1.
  const step = m.speed ?? 1
  const f = step === 1 ? `(t*${fps}+${m.first})` : `(t*${fps}*${step}+${m.first})`
  const of = (get: (k: BoxKey) => number): string => `(${keyedValue(f, m.keys, get)})`
  const sizes = m.keys.map((k) => ({ sx: (k.place.w * width) / box.w, sy: (k.place.h * height) / box.h }))
  const scaled = sizes.some((s) => Math.abs(s.sx - 1) * box.w >= 1 || Math.abs(s.sy - 1) * box.h >= 1)
  const sx = scaled ? `(${width}*${of((k) => k.place.w)}/${box.w})` : '1'
  const sy = scaled ? `(${height}*${of((k) => k.place.h)}/${box.h})` : '1'
  const before: string[] = []
  if (scaled) {
    // Scaled whole, then put in the top left corner of a clear frame as large
    // as it ever gets, so what is laid over keeps one size.
    const most = (get: (s: { sx: number; sy: number }) => number, side: number): number => even(Math.max(...sizes.map(get), 1) * (side + 2 * reach) + 2)
    before.push(
      `scale=w='max(2,trunc(iw*${sx}/2)*2)':h='max(2,trunc(ih*${sy}/2)*2)':eval=frame`,
      `pad=w=${most((s) => s.sx, box.w)}:h=${most((s) => s.sy, box.h)}:x=0:y=0:color=black@0:eval=frame`
    )
  }
  const opacities = Array.from({ length: Math.max(1, m.frames) }, (_, i) => boxAtKeys({ x: 0, y: 0, w: 1, h: 1 }, m.keys, m.first + i * step).opacity)
  if (opacities.some((o) => o < 1)) {
    // Set just before each frame where it changes, by the same sums the preview draws with.
    const steps: string[] = []
    let was = -1
    opacities.forEach((o, i) => {
      const v = Number(o.toFixed(4))
      if (v === was) return
      steps.push(`${(i === 0 ? 0 : (i - 0.5) / fps).toFixed(6)} colorchannelmixer aa ${short(v)}`)
      was = v
    })
    before.push(
      colours.toRgb,
      'format=rgba',
      `sendcmd=c='${steps.join(';')}'`,
      `colorchannelmixer=aa=${short(Number(opacities[0]!.toFixed(4)))}`,
      colours.toVideo,
      'format=yuva420p'
    )
  }
  // The frame's corner, which is `reach` up and left of the box's own, where the keyframes put the box.
  const x = `${width}*${of((k) => k.place.x)}-${reach}*${sx}`
  const y = `${height}*${of((k) => k.place.y)}-${reach}*${sy}`
  return { before: before.join(','), x, y }
}
