import type { JSX } from 'react'
import type { Fit } from '../../shared/crop-geometry'
import { SAFE_ZONE_CHOICES, safeFractions, type SafeZoneChoice } from '../../shared/safe-zones'
import { surface, ink, wash, radius, type } from '../theme'

const LINE = surface.overlayLineStrong
const SHADE = wash.keepClear

/**
 * The part of a frame Instagram's profile grid shows of a cover, 3:4, as
 * large as fits and centred, as fractions of the frame.
 */
export function coverBox(frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  if (!(frameW > 0) || !(frameH > 0)) return { x: 0, y: 0, w: 1, h: 1 }
  const tall = frameW / frameH < 3 / 4
  const w = tall ? 1 : (frameH * 3) / 4 / frameW
  const h = tall ? (frameW * 4) / 3 / frameH : 1
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/**
 * Lines and shading over the output frame, for placing things: the centre and
 * the thirds, and on a vertical frame the parts an app covers with its buttons
 * and caption. Drawn in the monitor's pixels over the frame as it is fitted,
 * and never in the way of a drag.
 */
export function Guides(props: {
  /** The output frame as the monitor fits it. */
  fit: Fit
  frameWidth: number
  frameHeight: number
  thirds: boolean
  safeZone: SafeZoneChoice
  /** The 3:4 box Instagram's profile grid shows of a cover. */
  cover?: boolean
}): JSX.Element {
  const { fit } = props
  const grid = props.cover === true ? coverBox(props.frameWidth, props.frameHeight) : null
  const safe = safeFractions(props.safeZone, props.frameWidth, props.frameHeight)
  const at = (fx: number, fy: number): { left: number; top: number } => ({
    left: fit.offsetX + fx * fit.width,
    top: fit.offsetY + fy * fit.height
  })
  const vertical = (fx: number, dashed: boolean): JSX.Element => (
    <div
      key={`v${fx}`}
      data-testid="guide-line"
      style={{
        position: 'absolute',
        ...at(fx, 0),
        width: 0,
        height: fit.height,
        borderLeft: `1px ${dashed ? 'dashed' : 'solid'} ${LINE}`
      }}
    />
  )
  const horizontal = (fy: number, dashed: boolean): JSX.Element => (
    <div
      key={`h${fy}`}
      data-testid="guide-line"
      style={{
        position: 'absolute',
        ...at(0, fy),
        width: fit.width,
        height: 0,
        borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${LINE}`
      }}
    />
  )
  const shade = (key: string, x: number, y: number, w: number, h: number): JSX.Element => (
    <div
      key={key}
      data-testid="safe-shade"
      style={{
        position: 'absolute',
        ...at(x, y),
        width: w * fit.width,
        height: h * fit.height,
        background: SHADE
      }}
    />
  )

  return (
    <div
      data-testid="guides"
      data-thirds={props.thirds ? 'yes' : 'no'}
      data-safe={safe ? props.safeZone : 'none'}
      style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
    >
      {safe && (
        <>
          {shade('top', 0, 0, 1, safe.top)}
          {shade('bottom', 0, 1 - safe.bottom, 1, safe.bottom)}
          {shade('left', 0, safe.top, safe.left, 1 - safe.top - safe.bottom)}
          {shade('right', 1 - safe.right, safe.top, safe.right, 1 - safe.top - safe.bottom)}
          {/* In the shaded band at the top, off the part being framed, and readable over any picture. */}
          <span
            data-testid="safe-label"
            style={{
              position: 'absolute',
              ...at(safe.left, 0),
              margin: 4,
              padding: '1px 6px',
              borderRadius: radius.chip,
              background: surface.overlay,
              font: type.meta,
              color: ink.primary,
              whiteSpace: 'nowrap'
            }}
          >
            Keep clear of {props.safeZone === 'all' ? 'all three' : SAFE_ZONE_CHOICES.find((c) => c.id === props.safeZone)?.name}
          </span>
        </>
      )}
      {grid && (
        <>
          {/* What the grid leaves out, shaded, and the box it keeps outlined. */}
          {shade('cover-top', 0, 0, 1, grid.y)}
          {shade('cover-bottom', 0, grid.y + grid.h, 1, 1 - grid.y - grid.h)}
          {shade('cover-left', 0, grid.y, grid.x, grid.h)}
          {shade('cover-right', grid.x + grid.w, grid.y, 1 - grid.x - grid.w, grid.h)}
          <div
            data-testid="cover-guide"
            style={{
              position: 'absolute',
              ...at(grid.x, grid.y),
              width: grid.w * fit.width,
              height: grid.h * fit.height,
              border: `1px solid ${LINE}`,
              boxSizing: 'border-box'
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                margin: 4,
                padding: '1px 6px',
                borderRadius: radius.chip,
                background: surface.overlay,
                font: type.meta,
                color: ink.primary,
                whiteSpace: 'nowrap'
              }}
            >
              Instagram grid, 3:4
            </span>
          </div>
        </>
      )}
      {props.thirds && (
        <>
          {vertical(1 / 3, true)}
          {vertical(2 / 3, true)}
          {horizontal(1 / 3, true)}
          {horizontal(2 / 3, true)}
          {vertical(0.5, false)}
          {horizontal(0.5, false)}
        </>
      )}
    </div>
  )
}
