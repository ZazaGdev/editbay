import { useRef, type JSX, type PointerEvent } from 'react'
import type { CaptionAt } from '../../shared/captions'
import { accent, ink, radius, surface, type } from '../theme'
import { HelpTip } from '../ui/HelpTip'

/**
 * The caption on screen, over the Output view: a press selects it, a double
 * click starts moving it, and while it is being moved, or while Relocate is
 * on, a drag puts its middle somewhere else on the frame.
 *
 * It works out nothing about where the words are: it is handed the box the
 * caption's layout takes, the same layout the canvas draws and the export
 * writes, and hands back the new middle as shares of the frame.
 */
export function CaptionBox(props: {
  /** The words' box on the frame, in frame pixels. */
  box: { x: number; y: number; w: number; h: number }
  frameWidth: number
  frameHeight: number
  /** The frame fitted into the Output view, in its own pixels. */
  fit: { offsetX: number; offsetY: number; width: number; height: number }
  /** Moving this caption alone, or every caption that follows the style, or neither. */
  mode: 'one' | 'all' | null
  /**
   * The box a drag starts from, when not the one drawn: while Relocate is on,
   * where the style puts a caption, since the drag moves the style. The box
   * itself is always drawn on the words.
   */
  from?: { x: number; y: number; w: number; h: number } | undefined
  /** While Relocate is on, a caption placed on its own that the drag will leave where it is. */
  staysPut?: boolean | undefined
  onPress: () => void
  onDoubleClick: () => void
  /** `continuing` for every movement of a drag after the first, which share one undo step. */
  onDrag: (at: CaptionAt, continuing: boolean) => void
}): JSX.Element {
  const moved = useRef(false)
  const k = props.fit.width / props.frameWidth
  const left = props.fit.offsetX + props.box.x * k
  const top = props.fit.offsetY + props.box.y * k
  const width = props.box.w * k
  const height = props.box.h * k
  const moving = props.mode !== null

  const press = (e: PointerEvent): void => {
    e.stopPropagation()
    if (!moving) {
      props.onPress()
      return
    }
    e.preventDefault()
    const from = { x: e.clientX, y: e.clientY }
    const start = props.from ?? props.box
    const middle = {
      x: (start.x + start.w / 2) / props.frameWidth,
      y: (start.y + start.h / 2) / props.frameHeight
    }
    moved.current = false
    // Listened for from the press itself, not once something has rendered:
    // a press let go before then would leave the box following the pointer.
    const move = (m: globalThis.PointerEvent): void => {
      const at = {
        x: Math.min(1, Math.max(0, middle.x + (m.clientX - from.x) / props.fit.width)),
        y: Math.min(1, Math.max(0, middle.y + (m.clientY - from.y) / props.fit.height))
      }
      props.onDrag(at, moved.current)
      moved.current = true
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      data-testid="caption-box"
      data-mode={props.mode ?? 'none'}
      data-stays={props.staysPut === true ? 'yes' : 'no'}
      onPointerDown={press}
      onDoubleClick={(e) => {
        e.stopPropagation()
        props.onDoubleClick()
      }}
      title={
        props.mode === 'all'
          ? props.staysPut === true
            ? 'Placed on its own, so moving every caption leaves it here. Double click to move it alone'
            : 'Drag to move every caption that follows the style. Double click to move this one alone'
          : props.mode === 'one'
            ? 'Drag to move this caption. Escape when it is where you want it'
            : 'Double click to move this caption on its own'
      }
      style={{
        position: 'absolute',
        zIndex: 3,
        left,
        top,
        width,
        height,
        boxSizing: 'border-box',
        border: moving ? `1px dashed ${accent.bright}` : '1px solid transparent',
        background: moving && props.staysPut !== true ? accent.tint : 'transparent',
        // A caption the drag leaves where it is, drawn fainter, and saying why.
        opacity: props.staysPut === true ? 0.6 : 1,
        cursor: moving ? 'move' : 'pointer',
        touchAction: 'none'
      }}
    >
      {props.staysPut === true && (
        <span
          data-testid="caption-box-note"
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 4,
            padding: '2px 6px',
            whiteSpace: 'nowrap',
            font: type.meta,
            color: ink.primary,
            background: surface.overlay,
            borderRadius: radius.chip,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          Placed on its own
          <HelpTip
            testid="caption-own-help"
            text="Placed on its own: turn on moving these too, or double click to move it alone."
            tutorial="545-move-captions-on-the-picture"
          />
        </span>
      )}
    </div>
  )
}
