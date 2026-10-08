import { useEffect, useRef, useState, type JSX } from 'react'
import {
  MAIN_PICTURE,
  MAX_BORDER_PX,
  cornerPlace,
  findVideoClip,
  isOverlay,
  isText,
  pipOf,
  targetAspect,
  type Clip,
  type PictureStyle,
  type PipChange,
  type ProjectMedia,
  type Timeline
} from '../../shared/project'
import { DEFAULT_BORDER_COLOUR } from '../../shared/picture-style'
import { FULL_PLACE, isSideBySide, viewOf, viewsOf } from '../../shared/layout'
import {
  PIP_CORNERS,
  PIP_MAX_MARGIN,
  PIP_MAX_SIZE,
  PIP_MIN_SIZE,
  pipCorner,
  pipShape,
  type PipCorner,
  type PipShape
} from '../../shared/pip'
import type { ClipEdit } from '../../shared/types'
import { accent, ink, radius, space, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Segmented } from '../ui/Segmented'
import { Field } from '../ui/Field'

type Edit = (e: ClipEdit, continuing?: boolean) => void

const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, font: type.meta, color: ink.primary, minHeight: 28 } as const
const dim = { color: ink.muted } as const
const mono = { font: type.mono, fontVariantNumeric: 'tabular-nums' } as const

export const CORNER_NAMES: Record<PipCorner | 'custom', string> = {
  tl: 'Top left',
  tr: 'Top right',
  bl: 'Bottom left',
  br: 'Bottom right',
  custom: 'Custom'
}

/**
 * Whether a clip can have a picture in picture at all: a recording holding
 * two views, which the layout lays out, or a recording on a track above V1,
 * which is put in a corner over what is under it. A text or an image placed
 * freely has its own box and is not one.
 */
export function canHavePip(t: Timeline, clip: Clip, media: ProjectMedia | undefined): boolean {
  if (!media || targetAspect(t) === null || isText(media) || media.colour !== undefined || isOverlay(media)) return false
  if (pipOf(t, clip.id)) return true
  const onTop = (findVideoClip(t, clip.id)?.index ?? 0) > 0
  return (onTop && clip.layers.length === 0) || (isSideBySide(media.width, media.height) && clip.layout === 'single')
}

/**
 * A drag of a slider is one undo step: its first change starts one, the rest
 * carry it on, until the pointer or the key is let go.
 */
function useSliderStep(): { continuing: () => boolean; end: () => void } {
  const going = useRef(false)
  return {
    continuing: () => {
      const was = going.current
      going.current = true
      return was
    },
    end: () => {
      going.current = false
    }
  }
}

/** A slider with its figure, whose drag is one undo step. */
function Slider(props: { testid: string; label: string; min: number; max: number; value: number; unit: string; onChange: (n: number, continuing: boolean) => void }): JSX.Element {
  const step = useSliderStep()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
      <input
        type="range"
        data-testid={props.testid}
        aria-label={props.label}
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value), step.continuing())}
        onPointerUp={step.end}
        onKeyUp={step.end}
        onBlur={step.end}
        className="ui-range"
        style={{ width: 110 }}
      />
      <span data-testid={`${props.testid}-value`} style={{ ...mono, width: 42, textAlign: 'right' }}>
        {props.value}
        {props.unit}
      </span>
    </span>
  )
}

/** Four buttons in the shape of a frame, one per corner, the one it is in picked out. */
export function CornerPicker(props: { testid: string; chosen: PipCorner | 'custom'; onPick: (c: PipCorner) => void }): JSX.Element {
  return (
    <div
      data-testid={props.testid}
      data-corner={props.chosen}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 4,
        width: 84,
        padding: 4,
        boxSizing: 'border-box',
        border: `1px solid ${surface.lineStrong}`,
        borderRadius: radius.control,
        background: surface.canvas
      }}
    >
      {PIP_CORNERS.map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`${props.testid}-${c}`}
          aria-label={CORNER_NAMES[c]}
          aria-pressed={props.chosen === c}
          title={CORNER_NAMES[c]}
          onClick={() => props.onPick(c)}
          className="ui-focusable"
          style={{
            height: 26,
            padding: 0,
            borderRadius: radius.chip,
            cursor: 'pointer',
            background: props.chosen === c ? accent.base : surface.control,
            border: `1px solid ${props.chosen === c ? accent.bright : surface.lineStrong}`
          }}
        />
      ))}
    </div>
  )
}

/**
 * Everything about a clip's small picture, in one place: on or off, which
 * view it is, its corner, size and margin, its shape, border and shadow. The
 * same settings are on the toolbar beside it on the Output view; both write
 * the same place and style, so each shows what the other did.
 */
type BoxShapeId = 'square' | 'tall' | 'wide' | 'own' | 'custom'

/** The box shapes a camera box is usually given, and its view's own. */
const BOX_SHAPES: { id: 'square' | 'tall' | 'wide' | 'own'; label: string; title: string; aspect: number | 'own' }[] = [
  { id: 'square', label: 'Square', title: 'A square box, 1 by 1', aspect: 1 },
  { id: 'tall', label: 'Tall', title: 'Taller than wide, 9 by 16', aspect: 9 / 16 },
  { id: 'wide', label: 'Wide', title: 'Wider than tall, 16 by 9', aspect: 16 / 9 },
  { id: 'own', label: 'As recorded', title: 'The shape of the view it shows', aspect: 'own' }
]

/**
 * The small picture's box: one of the usual shapes, or its width and height
 * typed, each on its own (bugs and notes 2, note 34). The picture fills the
 * box, cropped to fit rather than stretched.
 */
function BoxShape(props: {
  width: number
  height: number
  /** Its view's own shape, width over height. */
  own: number
  onAspect: (aspect: number | 'own') => void
  onWidth: (w: number) => void
  onHeight: (h: number) => void
}): JSX.Element {
  const aspect = props.width / Math.max(1, props.height)
  const near = (a: number): boolean => Math.abs(a - aspect) / aspect < 0.02
  const chosen = BOX_SHAPES.find((s) => near(s.aspect === 'own' ? props.own : s.aspect))?.id ?? null
  const [w, setW] = useState(String(props.width))
  const [h, setH] = useState(String(props.height))
  useEffect(() => setW(String(props.width)), [props.width])
  useEffect(() => setH(String(props.height)), [props.height])
  const take = (typed: string, was: number, then: (n: number) => void, back: (s: string) => void): void => {
    const n = Math.round(Number(typed))
    if (Number.isFinite(n) && n >= 16 && n !== was) then(n)
    else back(String(was))
  }
  return (
    <>
      <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
        <span style={dim}>Box</span>
        <Segmented
          testid="pip-box"
          label="The box's shape"
          size="small"
          // A shape of its own, typed or dragged, is none of these.
          chosen={chosen ?? 'custom'}
          onChoose={(id: BoxShapeId) => {
            const s = BOX_SHAPES.find((x) => x.id === id)
            if (s) props.onAspect(s.aspect)
          }}
          choices={BOX_SHAPES.map((s): { id: BoxShapeId; label: string; title: string } => ({ id: s.id, label: s.label, title: s.title }))}
        />
      </div>
      <div style={row}>
        <span style={dim}>Width, height</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Field label="Its width, in output pixels" hideLabel kind="number" value={w} onChange={setW} onCommit={(v) => take(v, props.width, props.onWidth, setW)} unit="px" testid="pip-width" style={{ width: 76 }} height={24} />
          <Field label="Its height, in output pixels" hideLabel kind="number" value={h} onChange={setH} onCommit={(v) => take(v, props.height, props.onHeight, setH)} unit="px" testid="pip-height" style={{ width: 76 }} height={24} />
        </span>
      </div>
    </>
  )
}

export function PipSection(props: { timeline: Timeline; clip: Clip; media: ProjectMedia; onEdit: Edit; onPicture: (picture: string) => void }): JSX.Element {
  const { timeline: t, clip, media } = props
  const { width: W, height: H } = t.output
  const pip = pipOf(t, clip.id)
  const onTop = (findVideoClip(t, clip.id)?.index ?? 0) > 0
  const where = pip ? pipCorner(pip.place, W, H) : null
  const shape = pip ? pipShape(pip.style, pip.place, W, H) : 'square'
  const style: PictureStyle = pip?.style ?? {}
  const [lastBorder, setLastBorder] = useState(style.border ?? 4)
  const change = (c: Parameters<typeof setPipEdit>[1], continuing = false): void => props.onEdit(setPipEdit(clip.id, c), continuing)
  const setStyle = (next: PictureStyle): void => {
    if (pip) props.onEdit({ kind: 'setPictureStyle', clipId: clip.id, picture: pip.picture, style: next })
  }

  const turn = (on: boolean): void => {
    if (onTop && clip.layers.length === 0) {
      props.onEdit({ kind: 'setPlace', clipId: clip.id, picture: MAIN_PICTURE, place: on ? cornerPlace(media, clip.transform.crop, W, H) : FULL_PLACE, reshapeCrop: true })
      return
    }
    props.onEdit({ kind: 'applyLayout', clipId: clip.id, layout: on ? 'pip' : 'single' })
    props.onPicture(MAIN_PICTURE)
  }

  // Which of a two-view recording's views is the small one: the right, as a layout starts, or the left once swapped.
  const views = viewsOf(media.width, media.height)
  const smallIsRight = pip ? viewOf(pip.crop, media.width, media.height).x === views[views.length - 1]!.x : true
  const view = pip ? viewOf(pip.crop, media.width, media.height) : { w: 16, h: 9 }

  return (
    <div data-testid="pip-section" data-on={pip ? 'yes' : 'no'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={row}>
        <span style={dim}>Picture in picture</span>
        <Check testid="pip-on" checked={pip !== null} onChange={turn}>
          On
        </Check>
      </div>
      {pip && (
        <>
          {pip.twoViews && (
            <div style={row}>
              <span style={dim}>Small picture</span>
              <Segmented
                testid="pip-which"
                label="Which view is the small picture"
                size="small"
                chosen={smallIsRight ? 'right' : 'left'}
                onChoose={(v: 'right' | 'left') => {
                  if ((v === 'right') !== smallIsRight) props.onEdit({ kind: 'swapPictures', clipId: clip.id })
                }}
                choices={[
                  { id: 'right' as const, label: 'Right view', title: 'The right half of the recording, usually the camera' },
                  { id: 'left' as const, label: 'Left view', title: 'The left half of the recording' }
                ]}
              />
            </div>
          )}
          <div style={{ ...row, alignItems: 'flex-start', marginTop: 4 }}>
            <span style={{ ...dim, paddingTop: 6 }}>Where</span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <CornerPicker testid="pip-corner" chosen={where!.corner} onPick={(corner) => change({ corner })} />
              <span data-testid="pip-where" style={dim}>
                {CORNER_NAMES[where!.corner]}
              </span>
            </span>
          </div>
          <div style={row}>
            <span style={dim}>Size</span>
            <Slider
              testid="pip-size"
              label="Its width, as a share of the frame's"
              min={Math.round(PIP_MIN_SIZE * 100)}
              max={Math.round(PIP_MAX_SIZE * 100)}
              value={Math.round(pip.place.w * 100)}
              unit="%"
              onChange={(n, continuing) => change({ size: n / 100 }, continuing)}
            />
          </div>
          <BoxShape
            width={Math.round(pip.place.w * W)}
            height={Math.round(pip.place.h * H)}
            own={view.w / view.h}
            onAspect={(aspect) => change({ aspect })}
            onWidth={(w) => change({ size: w / W, aspect: w / Math.max(1, pip.place.h * H) })}
            onHeight={(h) => change({ aspect: (pip.place.w * W) / Math.max(1, h) })}
          />
          <div style={row} title={where!.corner === 'custom' ? 'Pick a corner to set how far in it sits' : undefined}>
            <span style={dim}>Margin</span>
            <Slider
              testid="pip-margin"
              label="How far in from the edges it sits, in pixels"
              min={0}
              max={PIP_MAX_MARGIN}
              value={where!.margin}
              unit="px"
              onChange={(n, continuing) => change({ margin: n, ...(where!.corner === 'custom' ? { corner: 'tr' as const } : {}) }, continuing)}
            />
          </div>
          <div style={row}>
            <span style={dim}>Shape</span>
            <Segmented
              testid="pip-shape"
              label="Its shape"
              size="small"
              chosen={shape}
              onChoose={(s: PipShape) => change({ shape: s })}
              choices={[
                { id: 'square' as PipShape, label: 'Square' },
                { id: 'rounded' as PipShape, label: 'Rounded' },
                { id: 'circle' as PipShape, label: 'Circle', title: 'A round box, square, for a camera' }
              ]}
            />
          </div>
          <div style={row}>
            <span style={dim}>Border</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
              <Check
                testid="pip-border"
                checked={(style.border ?? 0) > 0}
                onChange={(on) => {
                  const { border: _b, ...rest } = style
                  setStyle(on ? { ...rest, border: lastBorder } : rest)
                }}
              >
                <span style={mono}>{style.border ?? lastBorder} px</span>
              </Check>
              <input
                type="range"
                data-testid="pip-border-width"
                aria-label="How wide its border is, in pixels"
                min={1}
                max={Math.min(20, MAX_BORDER_PX)}
                value={style.border ?? lastBorder}
                onChange={(e) => {
                  const border = Number(e.target.value)
                  setLastBorder(border)
                  setStyle({ ...style, border })
                }}
                className="ui-range"
                style={{ width: 60 }}
              />
              <input
                type="color"
                data-testid="pip-border-colour"
                aria-label="The border's colour"
                value={style.borderColour ?? DEFAULT_BORDER_COLOUR}
                onChange={(e) => setStyle({ ...style, borderColour: e.target.value, border: style.border ?? lastBorder })}
                className="ui-colour"
                style={{ width: 28, height: 20 }}
              />
            </span>
          </div>
          <div style={row}>
            <span style={dim}>Shadow</span>
            <Check
              testid="pip-shadow"
              checked={style.shadow === true}
              onChange={(on) => {
                const { shadow: _s, ...rest } = style
                setStyle(on ? { ...rest, shadow: true } : rest)
              }}
            >
              Under it
            </Check>
          </div>
          <Button
            testid="pip-same-for-all"
            size="small"
            onClick={() => props.onEdit({ kind: 'applyLayoutToSource', clipId: clip.id })}
            style={{ marginTop: 6, alignSelf: 'flex-start' }}
            title="Give every other clip of this recording on this track the same picture in picture"
          >
            Same for every clip of this recording
          </Button>
        </>
      )}
    </div>
  )
}

/** The edit that changes a picture in picture. */
export function setPipEdit(clipId: string, change: PipChange): ClipEdit {
  return { kind: 'setPip', clipId, change }
}
