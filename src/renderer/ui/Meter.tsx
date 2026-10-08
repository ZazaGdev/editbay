import type { CSSProperties, JSX } from 'react'
import { surface, accent, motion, radius } from '../theme'

/**
 * How far something has got: a download, an export, the listening for words.
 *
 * The fill is eased, so a figure that arrives in jumps still reads as motion
 * rather than as the bar flickering.
 */
export function Meter(props: {
  /** 0 to 1. Anything outside that is held to it. */
  fraction: number
  label: string
  testid?: string | undefined
  height?: number | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const part = Math.max(0, Math.min(1, props.fraction))
  return (
    <div
      data-testid={props.testid}
      data-fraction={props.fraction}
      role="progressbar"
      aria-label={props.label}
      aria-valuenow={Math.round(part * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: props.height ?? 6,
        background: surface.sunken,
        border: `1px solid ${surface.line}`,
        borderRadius: radius.round,
        overflow: 'hidden',
        boxSizing: 'border-box',
        ...props.style
      }}
    >
      <div
        style={{
          width: `${part * 100}%`,
          height: '100%',
          background: accent.base,
          transition: `width ${motion.toast} ${motion.easeOut}`
        }}
      />
    </div>
  )
}
