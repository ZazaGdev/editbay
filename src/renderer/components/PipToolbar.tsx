import { useState, type JSX } from 'react'
import type { PictureStyle } from '../../shared/project'
import { PIP_MAX_SIZE, PIP_MIN_SIZE, type PipCorner, type PipShape } from '../../shared/pip'
import type { ClipEdit } from '../../shared/types'
import { accent, elevation, ink, radius, surface, type } from '../theme'
import { CORNER_NAMES, CornerPicker, setPipEdit } from './PipSection'

/** The toolbar's height and its gap from the picture, in screen pixels. */
const BAR_H = 36
const GAP = 10
/** A step of the minus and plus buttons, as a share of the frame's width. */
const SIZE_STEP = 0.02
const NEXT_SHAPE: Record<PipShape, PipShape> = { square: 'rounded', rounded: 'circle', circle: 'square' }
const SHAPE_NAMES: Record<PipShape, string> = { square: 'Square', rounded: 'Rounded', circle: 'Circle' }

/**
 * The small picture's own toolbar, beside it on the Output view while it is
 * the picture being edited: snap to a corner, smaller and larger, its shape,
 * its border and its shadow. The Inspector's Picture in picture section has
 * the same and more; each shows what the other did, since both write the one
 * place and style.
 */
export function PipToolbar(props: {
  clipId: string
  picture: string
  /** The small picture's box on screen, in the Output view's own pixels, and the Output view's width and height. */
  box: { left: number; top: number; width: number; height: number }
  area: { width: number; height: number }
  size: number
  corner: PipCorner | 'custom'
  shape: PipShape
  style: PictureStyle | undefined
  onEdit: (e: ClipEdit) => void
  /** Move it out of the way and back (plan 97). */
  onOutOfTheWay?: (how: 'slide' | 'fade') => void
}): JSX.Element {
  const [picking, setPicking] = useState(false)
  const [away, setAway] = useState(false)
  const style = props.style ?? {}
  const width = (props.onOutOfTheWay ? 8 : 7) * 32 + 12
  const below = props.box.top + props.box.height + GAP + BAR_H <= props.area.height
  const top = below ? props.box.top + props.box.height + GAP : Math.max(0, props.box.top - GAP - BAR_H)
  const left = Math.max(4, Math.min(props.area.width - width - 4, props.box.left + props.box.width / 2 - width / 2))
  const setStyle = (next: PictureStyle): void => props.onEdit({ kind: 'setPictureStyle', clipId: props.clipId, picture: props.picture, style: next })
  const resize = (by: number): void =>
    props.onEdit(setPipEdit(props.clipId, { size: Math.min(PIP_MAX_SIZE, Math.max(PIP_MIN_SIZE, props.size + by)) }))

  const button = (testid: string, label: string, on: boolean | null, onClick: () => void, face: JSX.Element | string): JSX.Element => (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      title={label}
      {...(on !== null ? { 'aria-pressed': on } : {})}
      onClick={onClick}
      className="ui-focusable"
      style={{
        minWidth: 30,
        height: 28,
        padding: '0 6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: type.body,
        color: ink.primary,
        cursor: 'pointer',
        borderRadius: radius.control,
        border: `1px solid ${on ? accent.washLine : surface.lineStrong}`,
        background: on ? accent.pressed : surface.control
      }}
    >
      {face}
    </button>
  )
  const icon = (d: JSX.Element): JSX.Element => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {d}
    </svg>
  )

  return (
    <div
      data-testid="pip-toolbar"
      // A press here is on the toolbar, not a press on the picture under it.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        zIndex: 4,
        left,
        top,
        display: 'flex',
        gap: 4,
        padding: 4,
        background: surface.raised,
        border: `1px solid ${surface.lineStrong}`,
        borderRadius: radius.panel,
        boxShadow: elevation.over
      }}
    >
      {button('pip-toolbar-corner', `Snap to a corner, now ${CORNER_NAMES[props.corner]}`, picking, () => setPicking((p) => !p), icon(
        <>
          <rect x="1" y="1" width="12" height="12" rx="2" />
          <rect x="8" y="2.5" width="3.5" height="3" fill="currentColor" stroke="none" />
        </>
      ))}
      {button('pip-toolbar-smaller', 'Smaller', null, () => resize(-SIZE_STEP), '-')}
      <span data-testid="pip-toolbar-size" style={{ minWidth: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: type.monoSmall, color: ink.secondary }}>
        {Math.round(props.size * 100)}%
      </span>
      {button('pip-toolbar-larger', 'Larger', null, () => resize(SIZE_STEP), '+')}
      {button('pip-toolbar-shape', `Shape: ${SHAPE_NAMES[props.shape]}, click for ${SHAPE_NAMES[NEXT_SHAPE[props.shape]]}`, null, () => props.onEdit(setPipEdit(props.clipId, { shape: NEXT_SHAPE[props.shape] })), icon(
        props.shape === 'circle' ? <circle cx="7" cy="7" r="5.5" /> : <rect x="1.5" y="3" width="11" height="8" rx={props.shape === 'rounded' ? 3 : 0.5} />
      ))}
      {button('pip-toolbar-border', 'Border', (style.border ?? 0) > 0, () => {
        const { border: _b, ...rest } = style
        setStyle((style.border ?? 0) > 0 ? rest : { ...rest, border: 4 })
      }, icon(<rect x="2" y="2" width="10" height="10" rx="2" strokeWidth="2.5" />))}
      {button('pip-toolbar-shadow', 'Shadow', style.shadow === true, () => {
        const { shadow: _s, ...rest } = style
        setStyle(style.shadow === true ? rest : { ...rest, shadow: true })
      }, icon(
        <>
          <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" />
          <path d="M4 12.5h8.5V4" />
        </>
      ))}
      {props.onOutOfTheWay &&
        button('pip-toolbar-away', 'Move out of the way and back', away, () => setAway((a) => !a), icon(
          <>
            <rect x="1.5" y="7" width="5" height="5" rx="1" />
            <path d="M5 4.5h6.5M9.5 2.5l2 2-2 2" />
          </>
        ))}
      {away && props.onOutOfTheWay && (
        <div
          data-testid="pip-toolbar-away-choices"
          style={{ position: 'absolute', right: 0, top: below ? BAR_H + 4 : -40, display: 'flex', gap: 4, padding: 4, background: surface.raised, border: `1px solid ${surface.lineStrong}`, borderRadius: radius.panel }}
        >
          {button('pip-toolbar-away-slide', 'Slide to a free corner and back, over In to Out or a second and a half', null, () => {
            setAway(false)
            props.onOutOfTheWay?.('slide')
          }, 'Slide')}
          {button('pip-toolbar-away-fade', 'Fade out and back in, over In to Out or a second and a half', null, () => {
            setAway(false)
            props.onOutOfTheWay?.('fade')
          }, 'Fade')}
        </div>
      )}
      {picking && (
        <div style={{ position: 'absolute', left: 0, top: below ? BAR_H + 4 : -84, padding: 4, background: surface.raised, border: `1px solid ${surface.lineStrong}`, borderRadius: radius.panel }}>
          <CornerPicker
            testid="pip-toolbar-corners"
            chosen={props.corner}
            onPick={(corner) => {
              setPicking(false)
              props.onEdit(setPipEdit(props.clipId, { corner }))
            }}
          />
        </div>
      )}
    </div>
  )
}
