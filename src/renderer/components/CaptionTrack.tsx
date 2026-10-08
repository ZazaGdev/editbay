import { memo, useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { captionEnd, captionText, type CaptionClip, type CaptionStyle } from '../../shared/captions'
import { MIN_CLIP_WIDTH, handleWidthFor, type PxSpan } from '../../shared/timeline-layout'
import { snapFrame, snapMove } from '../../shared/tracks'
import type { ClipEdit } from '../../shared/types'
import { surface, accent, caption, radius, type } from '../theme'

/** How tall the caption track is. */
export const CAPTION_TRACK_HEIGHT = 30

const DRAG_THRESHOLD_PX = 6

/** A caption being moved or trimmed: where it began, and what it snaps to. */
interface Grab {
  id: string
  /** The body moves it; an edge trims it. */
  part: 'body' | 'start' | 'end'
  startX: number
  /** Where it started and ended when the drag began. */
  from: number
  to: number
  targets: number[]
  moved: boolean
}

/**
 * The caption track, above the top video track: each caption a block with
 * its words, as the style writes them. Clicked, a caption is selected; dragged
 * by its body it moves, by an edge it is trimmed, its words keeping their share
 * of it, each drag one undo step, snapping as clips do unless Alt is held. An
 * empty stretch moves the playhead there, as one on any track does.
 *
 * Only the captions near the part in view are drawn, as the clips' filmstrips
 * are, and only when something about them changes: an hour of captions drawn
 * whole on every frame of playback was thousands of elements each time (audit
 * 2026-10-01).
 */
export const CaptionTrack = memo(function CaptionTrack(props: {
  clips: CaptionClip[]
  style: CaptionStyle
  pxPerFrame: number
  selectedId: string | null
  onSelect: (id: string) => void
  /** A press on an empty stretch of the track, at a frame. */
  onPressEmpty: (frame: number) => void
  /** `continuing` marks every movement of a drag after the first. */
  onEdit: (e: ClipEdit, continuing: boolean) => void
  /**
   * Every edge a caption's edge may snap to, apart from those of the caption
   * named, and the playhead; for a trim, never the frame its edge began on.
   */
  targets: (except: string, edgeAt?: number) => number[]
  /** How near an edge has to come to snap, in frames. */
  snapWithin: number
  /** The stretch of the track drawn, in pixels. */
  drawn: PxSpan
}): JSX.Element {
  const [grab, setGrab] = useState<Grab | null>(null)
  /** What was last sent in this drag, so a movement that changes nothing sends nothing. */
  const sent = useRef<number | null>(null)

  useEffect(() => {
    if (!grab) return
    const move = (e: globalThis.PointerEvent): void => {
      const dx = e.clientX - grab.startX
      if (!grab.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      if (!grab.moved) setGrab({ ...grab, moved: true })
      const delta = Math.round(dx / props.pxPerFrame)
      let frame: number
      if (grab.part === 'body') {
        const raw = Math.max(0, grab.from + delta)
        frame = e.altKey ? raw : snapMove(raw, grab.to - grab.from, grab.targets, props.snapWithin)
      } else {
        const raw = Math.max(0, (grab.part === 'start' ? grab.from : grab.to) + delta)
        frame = e.altKey ? raw : snapFrame(raw, grab.targets, props.snapWithin)
      }
      if (frame === sent.current) return
      const first = sent.current === null
      if (first && frame === (grab.part === 'end' ? grab.to : grab.from)) return
      props.onEdit(
        grab.part === 'body'
          ? { kind: 'moveCaption', captionId: grab.id, start: frame }
          : { kind: 'trimCaption', captionId: grab.id, edge: grab.part, frame },
        !first
      )
      sent.current = frame
    }
    const up = (): void => setGrab(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [grab, props])

  const pressEmpty = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const box = e.currentTarget.getBoundingClientRect()
    props.onPressEmpty(Math.max(0, Math.round((e.clientX - box.left) / props.pxPerFrame)))
  }

  const begin = (c: CaptionClip, part: Grab['part']) => (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    // Words being typed are applied to their own caption first, and the keys come back to the editor.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    props.onSelect(c.id)
    sent.current = null
    const edgeAt = part === 'start' ? c.timelineStart : part === 'end' ? captionEnd(c) : undefined
    setGrab({ id: c.id, part, startX: e.clientX, from: c.timelineStart, to: captionEnd(c), targets: props.targets(c.id, edgeAt), moved: false })
  }

  return (
    <div
      data-testid="caption-track"
      onPointerDown={pressEmpty}
      style={{
        position: 'relative',
        height: CAPTION_TRACK_HEIGHT,
        boxSizing: 'border-box',
        borderTop: `1px solid ${surface.line}`,
        background: surface.canvas
      }}
    >
      {props.clips.map((c, i) => {
        // Far from the view, unless it is the one being dragged, which would lose its pointer.
        const left = c.timelineStart * props.pxPerFrame
        if (grab?.id !== c.id && (left > props.drawn.to || left + Math.max(MIN_CLIP_WIDTH, c.length * props.pxPerFrame) < props.drawn.from)) return null
        const selected = c.id === props.selectedId
        const text = captionText(c, props.style)
        // A short caption is drawn wider than it is, but never over the next, which would hide its end.
        const next = props.clips[i + 1]
        const room = next ? (next.timelineStart - c.timelineStart) * props.pxPerFrame : Infinity
        const width = Math.max(1, Math.min(room, Math.max(MIN_CLIP_WIDTH, c.length * props.pxPerFrame)))
        const handle = {
          position: 'absolute' as const,
          top: 0,
          width: handleWidthFor(width),
          height: '100%',
          cursor: 'ew-resize',
          background: selected ? accent.base : caption.header,
          opacity: 0.9
        }
        return (
          <div
            key={c.id}
            data-testid="caption"
            data-caption-id={c.id}
            data-start={c.timelineStart}
            data-length-frames={c.length}
            data-text={text}
            data-selected={selected ? 'yes' : 'no'}
            title={text}
            onPointerDown={begin(c, 'body')}
            style={{
              position: 'absolute',
              left,
              top: 3,
              width,
              height: CAPTION_TRACK_HEIGHT - 6,
              boxSizing: 'border-box',
              borderRadius: radius.chip,
              overflow: 'hidden',
              background: selected ? caption.fillSelected : caption.fill,
              outline: selected ? `2px solid ${accent.base}` : `1px solid ${caption.line}`,
              outlineOffset: -1,
              opacity: grab?.id === c.id && grab.moved && grab.part === 'body' ? 0.6 : 1,
              cursor: 'grab',
              userSelect: 'none'
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                top: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                font: type.label,
                color: caption.ink,
                pointerEvents: 'none'
              }}
            >
              {text}
            </span>
            <div data-testid="caption-trim-start" onPointerDown={begin(c, 'start')} style={{ ...handle, left: 0 }} />
            <div data-testid="caption-trim-end" onPointerDown={begin(c, 'end')} style={{ ...handle, right: 0 }} />
          </div>
        )
      })}
    </div>
  )
})
