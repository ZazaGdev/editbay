import { useState, type JSX } from 'react'
import { keyDraggedTo, keyMarks, timelineZoom } from '../../shared/zoom-edit'
import type { Clip } from '../../shared/project'
import { snapFrameTo } from '../../shared/tracks'
import { formatTimecode } from '../../shared/time'
import { accent, ink, radius, surface, type } from '../theme'

/** How close two keyframes' diamonds may be on screen before they are drawn as one, in pixels. */
const KEY_MARK = 11
/**
 * How much of the clip a diamond takes to press, in pixels: more than the
 * diamond drawn, so a press near it takes the keyframe and not the clip under
 * it (task 96).
 */
const KEY_GRAB = 18

/**
 * A diamond along the bottom edge for each zoom keyframe on the clip's own
 * frames, on every clip that has any: faint, and bright on the clip selected.
 * Along the bottom rather than the top, where the name is. A Simple zoom has
 * two, its Start and End, on the clip's first frame and its last. A click
 * goes to one, and a drag of a single keyframe's diamond moves it, as in the
 * Zoom group's strip, with its time shown while it goes and snapping as a
 * clip's edge does. A Simple zoom's ends and a merged mark only go, since
 * neither is one keyframe to move.
 */
export function ClipKeyframes(props: {
  clip: Clip
  /** The chosen picture on the clip selected, whose zoom its diamonds show. */
  zoomPicture: string | undefined
  /** How wide the clip is drawn. */
  width: number
  pxPerFrame: number
  fps: number
  selected: boolean
  /** Where a moved keyframe may snap on the sequence, asked when the drag starts, and how near is near, in frames. */
  snap: { targets: () => number[]; within: number }
  /** Told what a drag caught, and told null when it caught nothing or ended. */
  onSnap?: ((frame: number | null) => void) | undefined
  onSelect: (alone: boolean) => void
  onKeyframe: (frame: number) => void
  onKeyframeMove?: ((clipId: string, picture: string, from: number, to: number) => void) | undefined
}): JSX.Element | null {
  const c = props.clip
  const zoom = timelineZoom(c, props.zoomPicture)
  // A keyframe's diamond being dragged: the frame it started on, where it is now, the press, and what it may snap to.
  const [drag, setDrag] = useState<{ from: number; to: number; x: number; moved: boolean; targets: number[] } | null>(null)
  if (!zoom || props.width < KEY_MARK) return null
  const marks = keyMarks(zoom.frames, props.pxPerFrame, KEY_MARK - 2)
  const onSequence = (sourceFrame: number): number => c.timelineStart + sourceFrame - c.sourceIn
  const end = (): void => {
    setDrag(null)
    props.onSnap?.(null)
  }

  return (
    <>
      {marks.map((k) => {
        const movable = !zoom.simple && k.count === 1 && props.onKeyframeMove !== undefined
        const dragging = drag?.from === k.at && drag.moved
        const at = drag?.from === k.at ? drag.to : k.at
        return (
          <span
            key={k.at}
            data-testid="clip-keyframe"
            data-at={k.at}
            data-count={k.count}
            data-simple={zoom.simple ? (k.at === c.sourceIn ? 'start' : 'end') : undefined}
            data-dragging={dragging ? 'yes' : undefined}
            title={
              zoom.simple
                ? `The Simple zoom's ${k.at === c.sourceIn ? 'Start' : 'End'}. Click to go to it`
                : k.count > 1
                  ? `${k.count} zoom keyframes, close together. Click to go to the first`
                  : 'A zoom keyframe. Click to go to it, drag it left or right to move it'
            }
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              props.onSelect(e.altKey)
              props.onKeyframe(onSequence(k.at))
              if (!movable) return
              e.currentTarget.setPointerCapture(e.pointerId)
              // The keyframe's own frame is no target: the playhead was just put on it.
              const targets = props.snap.targets().filter((f) => f !== onSequence(k.at))
              setDrag({ from: k.at, to: k.at, x: e.clientX, moved: false, targets })
            }}
            onPointerMove={(e) => {
              if (!drag || drag.from !== k.at) return
              const moved = drag.moved || Math.abs(e.clientX - drag.x) > 3
              if (!moved) return
              const raw = keyDraggedTo(c, k.at, e.clientX - drag.x, props.pxPerFrame)
              // Alt held lets it go anywhere, as on a clip's edge.
              const caught = e.altKey ? null : snapFrameTo(onSequence(raw), drag.targets, props.snap.within)
              // Caught, it lands on that frame of the recording, still kept on the clip.
              const to = caught && caught.caught !== null ? keyDraggedTo(c, caught.frame - c.timelineStart + c.sourceIn, 0, props.pxPerFrame) : raw
              props.onSnap?.(caught && caught.caught !== null && onSequence(to) === caught.frame ? caught.frame : null)
              setDrag({ ...drag, moved, to })
            }}
            onPointerUp={() => {
              if (!drag || drag.from !== k.at) return
              end()
              if (drag.moved && drag.to !== drag.from) {
                props.onKeyframeMove?.(c.id, zoom.picture, drag.from, drag.to)
                props.onKeyframe(onSequence(drag.to))
              }
            }}
            onPointerCancel={end}
            style={{
              position: 'absolute',
              left: Math.min(props.width - KEY_GRAB, Math.max(0, (at - c.sourceIn + 0.5) * props.pxPerFrame - KEY_GRAB / 2)),
              bottom: 0,
              width: KEY_GRAB,
              height: KEY_GRAB,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: dragging ? 'grabbing' : movable ? 'ew-resize' : 'pointer',
              opacity: props.selected ? 1 : 0.55,
              // Over the trim handles too: a keyframe on the clip's first or last frame sits on one.
              zIndex: 4
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: k.count > 1 ? 9 : 7,
                height: k.count > 1 ? 9 : 7,
                transform: 'rotate(45deg)',
                background: accent.bright,
                outline: `1px solid ${surface.well}`,
                // A run of them drawn as one, with a second outline to say there is more than one.
                boxShadow: k.count > 1 ? `0 0 0 2px ${accent.washLine}` : 'none'
              }}
            />
            {dragging && (
              <span
                data-testid="clip-keyframe-time"
                style={{
                  position: 'absolute',
                  bottom: KEY_GRAB + 2,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '1px 5px',
                  borderRadius: radius.chip,
                  background: surface.raised,
                  border: `1px solid ${surface.line}`,
                  color: ink.primary,
                  font: type.monoSmall,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none'
                }}
              >
                {formatTimecode(onSequence(drag.to), props.fps)}
              </span>
            )}
          </span>
        )
      })}
    </>
  )
}
