import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { MAIN_PICTURE, PRESET_SCALE, clipLength, type Clip, type ProjectMedia, type Rect, type Timeline, type ZoomPreset, type Ease } from '../../shared/project'
import {
  EASE_NAMES,
  MAX_SCALE,
  cropAtPlayhead,
  keyAtPlayhead,
  keysInClip,
  cropEdit,
  neighbourKey,
  pastOwnPixels,
  playheadInside,
  scaleOf,
  shapeOf,
  sourceFrameAt,
  timelineFrameOf,
  toggleKeyEdit,
  withCentre,
  withScale
} from '../../shared/zoom-edit'
import { withKey, type Keymap } from '../../shared/keymap'
import { accent, ink, meaning, radius, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { ContextMenu, MenuHeading, MenuSeparator, type MenuAt } from './ContextMenu'
import { MenuItem } from './DropMenu'
import { usePlayheadRead, type PlayheadStore } from '../state/playheadStore'
import { ZOOM_SPEEDS } from '../state/useSettings'
import { AmountRow, ZoomNumber, callout, type Edit, type PresetEdit, type ZoomTools } from './zoom-parts'
import { HelpTip } from '../ui/HelpTip'
import { Select } from '../ui/Select'

/**
 * Plan 60: the Keyframes pane. Scale and Position of the main picture at the
 * playhead, the diamond that pins them there as a keyframe, the arrows to the
 * keyframes either side, a strip of the clip with a diamond for each, and
 * three zooms made in one click.
 *
 * With no keyframes Scale and Position frame the whole clip. With keyframes
 * they, the Crop numbers and the crop box all change the keyframe at the
 * playhead, making one there if there is none.
 *
 * Its own component, reading the playhead from the store rather than as a
 * prop, so the Inspector around it is not drawn again on every frame of
 * playback, and so it can move elsewhere in the panel without a rewrite.
 */
export function KeyframeZoom(props: {
  clip: Clip
  media: ProjectMedia
  timeline: Timeline
  playhead: PlayheadStore | undefined
  /** The range marked with In and Out on the sequence, `out` not included. */
  marks: { in: number | null; out: number | null }
  keymap?: Keymap | undefined
  picture: string
  onEdit: Edit
  onSeek: (frame: number) => void
  tools?: ZoomTools | undefined
}): JSX.Element {
  const { clip, media, timeline, picture, tools } = props
  const own = picture === MAIN_PICTURE ? {} : { picture }
  const amount = tools?.amount ?? Math.round(PRESET_SCALE * 100)
  const seconds = tools ? ZOOM_SPEEDS[tools.speed] : 0.5
  const took = seconds === 1 ? 'a second' : seconds === 2 ? 'two seconds' : 'half a second'
  const start = clip.timelineStart
  const end = start + clipLength(clip)
  // Outside the clip every frame reads the same, so playing elsewhere draws nothing again.
  const playhead = usePlayheadRead(props.playhead, (f) => Math.min(end, Math.max(start - 1, f)))
  const inside = playheadInside(clip, playhead)
  const crop = cropAtPlayhead(clip, playhead, picture)
  const key = keyAtPlayhead(clip, playhead, picture)
  const previous = neighbourKey(clip, playhead, 'previous', picture)
  const next = neighbourKey(clip, playhead, 'next', picture)
  // The keyframe the playhead is moving away from, with one after it to go
  // to: how it gets there is shown and chosen here, not only in the strip's
  // right click menu, so a Jump that blinks is plain to see (task 97).
  const along = keysInClip(clip, picture)
  const from = inside ? along.filter((k) => k.at <= sourceFrameAt(clip, playhead)).pop() : undefined
  const leaving = from !== undefined && along.some((k) => k.at > from.at) ? from : undefined
  const shape = shapeOf(clip, picture)
  const scale = scaleOf(crop, media.width, media.height, shape)
  const place = (clip.layers.find((l) => l.id === picture) ?? clip.transform).place
  const softer = timeline.output.width > 0 && pastOwnPixels(crop, place, timeline.output.width)
  const fps = timeline.fps

  /** Where a visit to one of the numbers started: the crop and the playhead it works from. */
  const visit = useRef<{ crop: Rect; playhead: number } | null>(null)
  const put = (rect: Rect, continuing: boolean): void => {
    const at = visit.current?.playhead ?? playhead
    props.onEdit(cropEdit(clip, at, rect, picture), continuing)
  }
  const field = {
    onEnter: () => {
      visit.current = { crop, playhead }
    },
    onLeave: () => {
      visit.current = null
    },
    onRevert: () => {
      if (visit.current) put(visit.current.crop, true)
    }
  }
  const base = (): Rect => visit.current?.crop ?? crop
  const centreX = Math.round(crop.x + crop.w / 2)
  const centreY = Math.round(crop.y + crop.h / 2)

  const make = (e: PresetEdit): void => (tools ? tools.onPreset(e) : props.onEdit(e))
  const preset = (kind: ZoomPreset): void => {
    // The same button again, while its zoom can be aimed: done aiming, on the point it has.
    if (tools?.aiming === kind) {
      tools.onAimEnd()
      return
    }
    const at = sourceFrameAt(clip, playhead)
    let to = at
    if (kind === 'inOut') {
      const { in: markIn, out: markOut } = props.marks
      const ranged = markIn !== null && markOut !== null && markOut > markIn && markIn < end && markOut > start
      if (ranged) {
        make({ kind: 'zoomPreset', clipId: clip.id, preset: kind, from: sourceFrameAt(clip, markIn), to: sourceFrameAt(clip, markOut - 1), ...own })
        return
      }
      // A second in, a second held and a second out at Normal.
      to = at + 3 * Math.round(fps)
    }
    make({ kind: 'zoomPreset', clipId: clip.id, preset: kind, from: at, to, ...own })
  }
  const ranged = props.marks.in !== null && props.marks.out !== null && props.marks.out > props.marks.in

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
        <ZoomNumber
          label="Scale %"
          testid="zoom-scale"
          value={Math.round(scale)}
          step={5}
          title={`How close in the picture is: 100% is the most of the recording its shape can show, ${MAX_SCALE}% the closest`}
          {...field}
          onApply={(n, continuing) => put(withScale(base(), n, media.width, media.height, shape), continuing)}
        />
        <ZoomNumber
          label="X"
          testid="zoom-x"
          value={centreX}
          step={2}
          title="Where the middle of what is shown is, across the recording, in its pixels"
          {...field}
          onApply={(n, continuing) => {
            const b = base()
            put(withCentre(b, n, b.y + b.h / 2, media.width, media.height), continuing)
          }}
        />
        <ZoomNumber
          label="Y"
          testid="zoom-y"
          value={centreY}
          step={2}
          title="Where the middle of what is shown is, down the recording, in its pixels"
          {...field}
          onApply={(n, continuing) => {
            const b = base()
            put(withCentre(b, b.x + b.w / 2, n, media.width, media.height), continuing)
          }}
        />
      </div>
      {softer && (
        <p data-testid="zoom-softer" style={{ font: type.meta, color: ink.muted, margin: 0 }}>
          Past the recording's own pixels, so softer.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Button
          testid="zoom-previous"
          size="small"
          variant="ghost"
          icon="left"
          disabled={previous === null}
          whyDisabled="No keyframe before the playhead"
          title={withKeyOf('The keyframe before', props.keymap, 'previousZoomKey')}
          onClick={() => previous !== null && props.onSeek(previous)}
        />
        <Button
          testid="zoom-key"
          size="small"
          pressed={key !== undefined}
          data={{ 'data-on': key ? 'yes' : 'no' }}
          disabled={!inside}
          whyDisabled="Put the playhead on this clip first"
          title={withKeyOf(
            key ? 'Take off the keyframe at the playhead' : 'Pin the framing at the playhead as a keyframe',
            props.keymap,
            'toggleZoomKey'
          )}
          onClick={() => {
            const edit = toggleKeyEdit(clip, playhead, picture)
            if (edit) props.onEdit(edit)
          }}
        >
          <Diamond filled={key !== undefined} />
          {key ? 'Keyframe' : 'Add keyframe'}
        </Button>
        <Button
          testid="zoom-next"
          size="small"
          variant="ghost"
          icon="right"
          disabled={next === null}
          whyDisabled="No keyframe after the playhead"
          title={withKeyOf('The keyframe after', props.keymap, 'nextZoomKey')}
          onClick={() => next !== null && props.onSeek(next)}
        />
      </div>

      <KeyStrip clip={clip} picture={picture} playhead={playhead} fps={fps} onEdit={props.onEdit} onSeek={props.onSeek} />

      {leaving && (
        <div data-testid="zoom-ease-row" data-ease={leaving.ease ?? 'smooth'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ font: type.meta, color: ink.muted }}>To the next keyframe</span>
          <Select
            label="How the picture gets to the next keyframe"
            testid="zoom-ease-select"
            value={leaving.ease ?? 'smooth'}
            choices={EASE_NAMES.map((n) => ({ value: n.ease, label: n.label }))}
            onChange={(v) => props.onEdit({ kind: 'setZoomEase', clipId: clip.id, at: leaving.at, ease: v as Ease, ...own })}
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <Button
          testid="zoom-punch"
          size="small"
          pressed={tools?.aiming === 'punch'}
          disabled={!inside}
          whyDisabled="Put the playhead on this clip first"
          title={`Jump to ${amount}% on the frame at the playhead, which hides a jump cut. Then click the picture where it should close in`}
          onClick={() => preset('punch')}
        >
          Punch in
        </Button>
        <Button
          testid="zoom-in"
          size="small"
          pressed={tools?.aiming === 'in'}
          disabled={!inside}
          whyDisabled="Put the playhead on this clip first"
          title={`Ease in to ${amount}% over ${took} from the playhead. Then click the picture where it should close in`}
          onClick={() => preset('in')}
        >
          Zoom in
        </Button>
        <Button
          testid="zoom-in-out"
          size="small"
          pressed={tools?.aiming === 'inOut'}
          disabled={!inside && !ranged}
          whyDisabled="Put the playhead on this clip first, or mark In and Out"
          title={
            ranged
              ? `Ease in to ${amount}% at In, hold, and ease back out by Out`
              : `Ease in to ${amount}%, hold, and ease back out, over three seconds from the playhead`
          }
          onClick={() => preset('inOut')}
        >
          Zoom in and out
        </Button>
      </div>
      {tools && tools.aiming !== null && (
        <div data-testid="zoom-aiming" role="status" style={callout}>
          Click the picture, in the Source or Output view, where it should close in. Enter when it is right.
        </div>
      )}
      {tools && <AmountRow tools={tools} speed />}
      <HelpTip text="Keyframes stay on the frames of the recording they were put on. Trimming the clip does not move them." tutorial="217-zoom-with-keyframes" />
    </>
  )
}

function withKeyOf(text: string, keymap: Keymap | undefined, id: 'toggleZoomKey' | 'previousZoomKey' | 'nextZoomKey'): string {
  return keymap ? withKey(text, keymap, id) : text
}

/** A keyframe's mark: filled when there is one, hollow when there is not. */
function Diamond(props: { filled: boolean; size?: number }): JSX.Element {
  const size = props.size ?? 8
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        transform: 'rotate(45deg)',
        border: `1.5px solid ${props.filled ? accent.bright : ink.secondary}`,
        background: props.filled ? accent.bright : 'transparent',
        boxSizing: 'border-box',
        flexShrink: 0
      }}
    />
  )
}

/**
 * The clip end to end, a diamond for each of its keyframes and a line for the
 * playhead. Click a diamond to go to it, drag it to move it, Delete to take
 * it off, and right click for how it gets to the next one.
 */
function KeyStrip(props: { clip: Clip; picture: string; playhead: number; fps: number; onEdit: Edit; onSeek: (frame: number) => void }): JSX.Element {
  const { clip } = props
  const own = props.picture === MAIN_PICTURE ? {} : { picture: props.picture }
  const length = clipLength(clip)
  const keys = keysInClip(clip, props.picture)
  const strip = useRef<HTMLDivElement>(null)
  /** The keyframe picked on the strip, by its frame of the recording, for Delete. */
  const [picked, setPicked] = useState<number | null>(null)
  /** A keyframe being dragged: where it was, and where it is now. */
  const [dragging, setDragging] = useState<{ from: number; to: number; x: number; moved: boolean } | null>(null)
  const [menu, setMenu] = useState<{ at: MenuAt; key: number } | null>(null)
  // A keyframe taken off or moved is no longer the one picked.
  useEffect(() => {
    if (picked !== null && !keys.some((k) => k.at === picked)) setPicked(null)
  }, [keys, picked])

  const share = (sourceFrame: number): number => (length > 0 ? (sourceFrame - clip.sourceIn + 0.5) / length : 0)
  const frameAtX = (clientX: number): number => {
    const r = strip.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return clip.sourceIn
    const along = Math.floor(((clientX - r.left) / r.width) * length)
    return clip.sourceIn + Math.min(length - 1, Math.max(0, along))
  }
  const menuKey = menu ? keys.find((k) => k.at === menu.key) : undefined

  return (
    <div
      ref={strip}
      data-testid="zoom-strip"
      title="The clip, with a diamond for each keyframe. Click one to go to it, drag it to move it, right click for more"
      style={{
        position: 'relative',
        height: 20,
        marginTop: 2,
        background: surface.sunken,
        border: `1px solid ${surface.line}`,
        borderRadius: radius.chip,
        touchAction: 'none'
      }}
    >
      {props.playhead >= clip.timelineStart && props.playhead < clip.timelineStart + length && (
        <span
          data-testid="zoom-strip-playhead"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${share(sourceFrameAt(clip, props.playhead)) * 100}%`,
            width: 1,
            background: meaning.playhead,
            pointerEvents: 'none'
          }}
        />
      )}
      {keys.map((k) => {
        const at = dragging?.from === k.at ? dragging.to : k.at
        return (
          // Not a <button>: the window takes the focus off a button clicked
          // with the mouse, and Delete has to reach the diamond picked.
          <span
            key={k.at}
            role="button"
            tabIndex={0}
            data-testid="zoom-strip-key"
            data-at={k.at}
            data-ease={k.ease ?? 'smooth'}
            data-picked={picked === k.at ? 'yes' : 'no'}
            aria-label={`Keyframe at ${((k.at - clip.sourceIn) / props.fps).toFixed(2)} s into the clip`}
            onPointerDown={(e: ReactPointerEvent<HTMLSpanElement>) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.currentTarget.focus()
              e.currentTarget.setPointerCapture(e.pointerId)
              setPicked(k.at)
              setDragging({ from: k.at, to: k.at, x: e.clientX, moved: false })
            }}
            onPointerMove={(e) => {
              if (!dragging || dragging.from !== k.at) return
              const moved = dragging.moved || Math.abs(e.clientX - dragging.x) > 3
              if (moved) setDragging({ ...dragging, moved, to: frameAtX(e.clientX) })
            }}
            onPointerUp={() => {
              if (!dragging || dragging.from !== k.at) return
              setDragging(null)
              if (dragging.moved && dragging.to !== dragging.from) {
                props.onEdit({ kind: 'moveZoomKey', clipId: clip.id, from: dragging.from, to: dragging.to, ...own })
                setPicked(dragging.to)
                props.onSeek(timelineFrameOf(clip, dragging.to))
              } else props.onSeek(timelineFrameOf(clip, k.at))
            }}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={(e) => {
              // Taken here, before the window's keys: Delete there takes the clip off.
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                e.stopPropagation()
                props.onEdit({ kind: 'removeZoomKey', clipId: clip.id, at: k.at, ...own })
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setPicked(k.at)
              setMenu({ at: { x: e.clientX, y: e.clientY }, key: k.at })
            }}
            style={{
              position: 'absolute',
              top: '50%',
              left: `${share(at) * 100}%`,
              width: 14,
              height: 14,
              margin: '-7px 0 0 -7px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: dragging?.from === k.at && dragging.moved ? 'grabbing' : 'pointer',
              outline: picked === k.at ? `1px solid ${accent.base}` : 'none',
              borderRadius: radius.handle
            }}
          >
            <Diamond filled size={9} />
          </span>
        )
      })}
      {menu && menuKey && (
        <ContextMenu at={menu.at} onClose={() => setMenu(null)} testid="zoom-key-menu">
          <MenuHeading>To the next keyframe</MenuHeading>
          {EASE_NAMES.map((n) => (
            <MenuItem
              key={n.ease}
              testid="zoom-ease"
              label={n.label}
              title={n.title}
              current={(menuKey.ease ?? 'smooth') === n.ease}
              onClick={() => {
                setMenu(null)
                props.onEdit({ kind: 'setZoomEase', clipId: clip.id, at: menuKey.at, ease: n.ease, ...own })
              }}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            testid="zoom-key-remove"
            label="Remove this keyframe"
            hint="Delete"
            onClick={() => {
              setMenu(null)
              props.onEdit({ kind: 'removeZoomKey', clipId: clip.id, at: menuKey.at, ...own })
            }}
          />
          <MenuItem
            testid="zoom-keys-clear"
            label="Remove all"
            danger
            title="Take every keyframe off: the picture stays on the framing of the clip's first frame"
            onClick={() => {
              setMenu(null)
              props.onEdit({ kind: 'clearZoomKeys', clipId: clip.id, ...own })
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}
