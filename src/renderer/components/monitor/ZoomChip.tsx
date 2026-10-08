/** How far a zoomed view of the monitor is zoomed in, at its top right, and the button that fits it again (task 53). */

import type { JSX } from 'react'
import { surface, ink, radius, type } from '../../theme'
import { Button } from '../../ui/Button'

export function ZoomChip(props: { testid: string; resetTestid: string; scale: number; onReset: () => void }): JSX.Element {
  return (
    <div
      data-testid={props.testid}
      data-zoom={props.scale.toFixed(2)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        zIndex: 6,
        right: 8,
        top: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 4px 2px 8px',
        borderRadius: radius.chip,
        background: surface.overlay,
        color: ink.primary,
        font: type.monoSmall
      }}
    >
      {Math.round(props.scale * 100)}%
      <Button testid={props.resetTestid} size="small" onClick={props.onReset} title="Fit the whole picture in the view again">
        Reset
      </Button>
    </div>
  )
}
