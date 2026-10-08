/**
 * The fixed numbers of a picture's framing and of a blurred background, in
 * output pixels, which the preview draws with and the export writes, so the
 * two are the same size however big the frame is.
 */

/** How far a blurred background is blurred: its standard deviation, a fiftieth of the frame's longer side. */
export function blurSigma(frameW: number, frameH: number): number {
  return Math.max(1, Math.round(Math.max(frameW, frameH) / 50))
}

/** A picture in picture's shadow: how soft, how far down, and how dark. */
export function shadowOf(frameW: number, frameH: number): { sigma: number; dy: number; alpha: number } {
  const short = Math.min(frameW, frameH)
  return { sigma: Math.max(1, Math.round(short / 80)), dy: Math.max(1, Math.round(short / 120)), alpha: 0.5 }
}

/** A border's colour when none is chosen. */
export const DEFAULT_BORDER_COLOUR = '#ffffff'
