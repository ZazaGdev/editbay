import { useEffect, useRef, type JSX } from 'react'
import { drawOnto, mixFor, type DrawPlan } from '../preview/compositor'
import { washColour, washRise } from '../../shared/transitions'
import { ink, pictureColours, radius } from '../theme'

const W = 36
const H = 22
/** One pass: the first picture held, the transition, the next held. */
const HOLD_MS = 350
const MOVE_MS = 1000

/** A small picture with a letter on it, so a push reads differently from a wipe. */
function tile(fill: string, letter: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = W * 3
  c.height = H * 3
  const ctx = c.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = ink.primary
  ctx.font = `bold ${c.height * 0.62}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, c.width / 2, c.height / 2 + 2)
  return c
}

let tiles: [HTMLCanvasElement, HTMLCanvasElement] | null = null

/** The plan for one moment of `kind`, `p` from 0 to 1, drawn the way the monitor draws it. */
function planAt(kind: string, p: number): DrawPlan {
  const frame = { x: 0, y: 0, w: W, h: H }
  const from = { x: 0, y: 0, w: W * 3, h: H * 3 }
  const colour = washColour(kind)
  if (colour) {
    // A dip hands over in the middle: out to the colour, then in from it.
    return p < 0.5
      ? { frame, steps: [{ from, to: frame, source: 0, wash: { colour, alpha: washRise(kind, p * 2) } }] }
      : { frame, steps: [{ from, to: frame, source: 1, wash: { colour, alpha: (1 - p) * 2 } }] }
  }
  const mix = mixFor(kind, p, frame, 1080)
  return {
    frame,
    steps: [
      { from, to: frame, source: 0, mix: mix.out },
      { from, to: frame, source: 1, mix: mix.into }
    ]
  }
}

/**
 * A transition kind playing over and over, small, from one picture to the
 * next: drawn by the monitor's own code, so it moves as the real one will.
 */
export function TransitionThumb(props: { kind: string }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const scale = window.devicePixelRatio || 1
    el.width = Math.round(W * scale)
    el.height = Math.round(H * scale)
    const ctx = el.getContext('2d')
    if (!ctx) return
    tiles ??= [tile(pictureColours[1], 'A'), tile(pictureColours[0], 'B')]
    const sources = tiles
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (still) {
      drawOnto(ctx, sources, planAt(props.kind, 0.5), scale)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const t = (now - start) % (HOLD_MS * 2 + MOVE_MS)
      const p = Math.min(1, Math.max(0, (t - HOLD_MS) / MOVE_MS))
      drawOnto(ctx, sources, planAt(props.kind, p), scale)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [props.kind])
  return (
    <canvas
      ref={canvas}
      data-testid={`transition-thumb-${props.kind}`}
      aria-hidden="true"
      style={{ width: W, height: H, borderRadius: radius.chip, flex: 'none', display: 'block' }}
    />
  )
}
