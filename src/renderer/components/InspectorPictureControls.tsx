/** The Picture panel's smaller controls: a crop number, a picture's frame, and an overlay's place, turn, opacity and how it appears. */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Clip, PictureStyle } from '../../shared/project'
import { DEFAULT_BORDER_COLOUR } from '../../shared/picture-style'
import { MAIN_PICTURE, MAX_BORDER_PX, MAX_CORNER_PX } from '../../shared/project'
import { placeInFrame, type FrameSide } from '../../shared/layout'
import { APPEAR_KINDS, DEFAULT_APPEAR_SECONDS, MAX_APPEAR_SECONDS } from '../../shared/appear'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Select } from '../ui/Select'
import { dim, mono, row, type Edit } from './inspector-parts'

/**
 * One number of a crop, typed. Enter or leaving the field applies it; Escape
 * puts back what it was. A number that cannot be read is put back too.
 */
/** How long typing has to pause before a crop number is put on the picture. */
const CROP_TYPING_PAUSE_MS = 250

/**
 * One of the crop's numbers. What is typed is put on the picture a moment
 * after the typing pauses, without leaving the field, and the arrow keys
 * step it by 2, or 20 with Shift, at once. A visit to the field is one undo
 * step however many changes it makes. The text is never rewritten while the
 * field has focus, since a number half typed would be clamped under the
 * fingers: it is tidied to the crop's own number on leaving. Escape puts
 * back the crop the field was entered with.
 */
export function CropNumber(props: {
  label: string
  value: number
  testid: string
  /** The field is entered, and left: the crop at entry is what the numbers work from. */
  onEnter: () => void
  onLeave: () => void
  /** A number to put on the crop; `continuing` joins it to this visit's undo step. */
  onApply: (n: number, continuing: boolean) => void
  /** Escape: the crop the field was entered with, back as it was. */
  onRevert: () => void
  /** The selected clips do not agree on this number: shown as Mixed until one is typed. */
  mixed?: boolean | undefined
}): JSX.Element {
  const [text, setText] = useState(String(props.value))
  const focused = useRef(false)
  /** The number this visit last put on the crop, or null while it has changed nothing. */
  const applied = useRef<number | null>(null)
  const cancelled = useRef(false)
  const timer = useRef(0)
  useEffect(() => {
    if (!focused.current) setText(String(props.value))
  }, [props.value])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const parse = (t: string): number | null => {
    const n = Number(t)
    return t.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null
  }
  const apply = (n: number): void => {
    if (n === (applied.current ?? props.value)) return
    props.onApply(n, applied.current !== null)
    applied.current = n
  }
  const soon = (t: string): void => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const n = parse(t)
      if (n !== null) apply(n)
    }, CROP_TYPING_PAUSE_MS)
  }

  return (
    <label className="ui-field">
      <span className="ui-field__label">{props.label}</span>
      <span className="ui-field__box" style={{ height: 24 }}>
      <input
        data-testid={props.testid}
        type="number"
        step={2}
        value={props.mixed === true && !focused.current ? '' : text}
        placeholder={props.mixed === true ? 'Mixed' : undefined}
        onFocus={() => {
          focused.current = true
          setText(String(props.value))
          applied.current = null
          cancelled.current = false
          props.onEnter()
        }}
        onChange={(e) => {
          setText(e.target.value)
          soon(e.target.value)
        }}
        onBlur={() => {
          window.clearTimeout(timer.current)
          if (!cancelled.current) {
            const n = parse(text)
            if (n !== null) apply(n)
          }
          focused.current = false
          // The crop's own number again: the one taken, or the old one when
          // nothing could be, as a width larger than the recording.
          setText(String(props.value))
          props.onLeave()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            window.clearTimeout(timer.current)
            cancelled.current = true
            if (applied.current !== null) props.onRevert()
            applied.current = null
            // Put back first, so leaving the field applies nothing.
            const input = e.currentTarget
            window.setTimeout(() => input.blur(), 0)
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Stepped here rather than by the browser, and put on the picture at once.
            e.preventDefault()
            window.clearTimeout(timer.current)
            const from = parse(text) ?? props.value
            const next = from + (e.key === 'ArrowUp' ? 2 : -2) * (e.shiftKey ? 10 : 1)
            setText(String(next))
            apply(next)
          }
        }}
        className="ui-field__input"
        style={{ ...mono, width: '100%', minWidth: 0, textAlign: 'right' }}
      />
      </span>
    </label>
  )
}

/** A clip on a video track: its pictures, their layout and place in the frame, and their crops. */
/**
 * An overlay's turn and opacity: the angle typed, or put upright again, and
 * how see-through it is. The handle above its box on the Output view turns
 * it too; these are for a number exactly.
 */
/** A whole number of pixels typed in, put in on Enter or on leaving the box. */
function PixelField(props: { testid: string; label: string; value: number; most: number; onCommit: (n: number) => void }): JSX.Element {
  const [typed, setTyped] = useState<string | null>(null)
  const commit = (text: string): void => {
    setTyped(null)
    const n = Math.round(Number(text))
    if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.max(0, Math.min(props.most, n)))
  }
  return (
    <span className="ui-field__box" style={{ height: 24, width: 48 }}>
      <input
        data-testid={props.testid}
        aria-label={props.label}
        inputMode="numeric"
        value={typed ?? String(props.value)}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          if (e.key === 'Escape') setTyped(null)
          e.stopPropagation()
        }}
        className="ui-field__input"
        style={{ ...mono, width: '100%', minWidth: 0, textAlign: 'right' }}
      />
    </span>
  )
}

/** A picture in picture's corners, border and shadow, in output pixels. */
export function FrameControls(props: { clipId: string; picture: string; style: PictureStyle | undefined; onEdit: Edit }): JSX.Element {
  const s = props.style ?? {}
  const set = (change: { radius?: number; border?: number; borderColour?: string; shadow?: boolean }): void => {
    const { shadow: _was, ...rest } = s
    const shadow = change.shadow ?? s.shadow === true
    props.onEdit({ kind: 'setPictureStyle', clipId: props.clipId, picture: props.picture, style: { ...rest, ...change, ...(shadow ? { shadow: true } : {}) } as PictureStyle })
  }
  return (
    <>
      <div style={{ ...row, marginTop: 6 }}>
        <span style={dim}>Corners</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <PixelField testid="picture-radius" label="How round its corners are, in pixels" value={s.radius ?? 0} most={MAX_CORNER_PX} onCommit={(radius) => set({ radius })} />
          <span style={dim}>px</span>
        </span>
      </div>
      <div style={row}>
        <span style={dim}>Border</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <PixelField testid="picture-border" label="How wide its border is, in pixels" value={s.border ?? 0} most={MAX_BORDER_PX} onCommit={(border) => set({ border })} />
          <span style={dim}>px</span>
          <input
            type="color"
            data-testid="picture-border-colour"
            aria-label="The border's colour"
            value={s.borderColour ?? DEFAULT_BORDER_COLOUR}
            // A colour picked with no border gives it one to show on.
            onChange={(e) => set({ borderColour: e.target.value, ...(s.border ? {} : { border: 4 }) })}
            style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'none' }}
          />
        </span>
      </div>
      <div style={row}>
        <span style={dim}>Shadow</span>
        <Check testid="picture-shadow" checked={s.shadow === true} onChange={(on) => set({ shadow: on })}>
          Under it
        </Check>
      </div>
    </>
  )
}

/** The buttons that line a text or an image up with the frame, three across and three down. */
const FRAME_SIDES: { side: FrameSide; label: string; title: string }[][] = [
  [
    { side: 'left', label: 'Left', title: 'To the frame’s left side, a little in from the edge' },
    { side: 'centre', label: 'Centre', title: 'In the middle across' },
    { side: 'right', label: 'Right', title: 'To the frame’s right side, a little in from the edge' }
  ],
  [
    { side: 'top', label: 'Top', title: 'To the top, a little in from the edge' },
    { side: 'middle', label: 'Middle', title: 'In the middle down' },
    { side: 'bottom', label: 'Bottom', title: 'To the bottom, a little in from the edge' }
  ]
]

/**
 * How a text or a picture comes in or goes out: None, Fade or Pop, and how
 * long it takes, in seconds. A kind picked starts at the usual length.
 */
function AppearRow(props: { clip: Clip; side: 'in' | 'out'; fps: number; onEdit: Edit }): JSX.Element {
  const { clip, side, fps } = props
  const now = side === 'in' ? clip.enter : clip.exit
  const seconds = now ? Math.round((now.length / fps) * 100) / 100 : DEFAULT_APPEAR_SECONDS
  const [typed, setTyped] = useState<string | null>(null)
  const set = (kind: string, sec: number): void => {
    const length = Math.max(1, Math.round(Math.min(MAX_APPEAR_SECONDS, sec) * fps))
    props.onEdit({ kind: 'setAppear', clipId: clip.id, side, appear: kind === 'fade' || kind === 'pop' ? { kind, length } : null })
  }
  const commit = (text: string): void => {
    setTyped(null)
    const n = Number(text.replace(',', '.'))
    if (now && Number.isFinite(n) && n > 0 && n !== seconds) set(now.kind, n)
  }
  const word = side === 'in' ? 'Comes in' : 'Goes out'
  return (
    <div style={{ ...row, marginTop: side === 'in' ? 6 : 0 }}>
      <span style={dim}>{word}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Select
          testid={`appear-${side}`}
          label={side === 'in' ? 'How it comes in' : 'How it goes out'}
          value={now?.kind ?? 'none'}
          blurOnChange
          height={24}
          onChange={(kind) => set(kind, seconds)}
          choices={[{ value: 'none', label: 'None' }, ...APPEAR_KINDS.map((k) => ({ value: k.id, label: k.label }))]}
        />
        {now && (
          <>
            <span className="ui-field__box" style={{ height: 24, width: 48 }}>
              <input
                data-testid={`appear-${side}-seconds`}
                aria-label={`${word}, over this many seconds`}
                inputMode="decimal"
                value={typed ?? String(seconds)}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(e.currentTarget.value)
                  if (e.key === 'Escape') setTyped(null)
                  e.stopPropagation()
                }}
                className="ui-field__input"
                style={{ ...mono, width: '100%', minWidth: 0, textAlign: 'right' }}
              />
            </span>
            <span style={dim}>s</span>
          </>
        )}
      </span>
    </div>
  )
}

export function OverlayControls(props: { clip: Clip; frame: { width: number; height: number }; fps: number; onEdit: Edit }): JSX.Element {
  const { clip } = props
  const rotation = clip.transform.rotation ?? 0
  const opacity = Math.round((clip.transform.opacity ?? 1) * 100)
  const [typed, setTyped] = useState<string | null>(null)
  const dragging = useRef(false)
  const moved = useRef(false)
  const commit = (text: string): void => {
    setTyped(null)
    const n = Number(text)
    if (Number.isFinite(n) && n !== rotation) props.onEdit({ kind: 'setOverlay', clipId: clip.id, rotation: n })
  }
  const lineUp = (side: FrameSide): void =>
    props.onEdit({
      kind: 'setPlace',
      clipId: clip.id,
      picture: MAIN_PICTURE,
      place: placeInFrame(clip.transform.place, side, props.frame.width, props.frame.height),
      reshapeCrop: false
    })
  return (
    <>
      {/* Where it sits in the frame: a side, a little in from the edge, or the middle, across and down. */}
      <div style={{ ...row, marginTop: 6, alignItems: 'flex-start' }}>
        <span style={{ ...dim, paddingTop: 4 }}>In the frame</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {FRAME_SIDES.map((line, i) => (
            <span key={i} style={{ display: 'inline-flex', gap: 4 }}>
              {line.map((b) => (
                <Button key={b.side} testid={`in-frame-${b.side}`} size="small" title={b.title} onClick={() => lineUp(b.side)}>
                  {b.label}
                </Button>
              ))}
            </span>
          ))}
        </span>
      </div>
      <div style={{ ...row, marginTop: 6 }}>
        <span style={dim}>Turn</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="ui-field__box" style={{ height: 24, width: 56 }}>
          <input
            data-testid="overlay-rotation"
            aria-label="Turn, in degrees clockwise"
            inputMode="decimal"
            value={typed ?? String(Math.round(rotation * 10) / 10)}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value)
              if (e.key === 'Escape') setTyped(null)
              e.stopPropagation()
            }}
            className="ui-field__input"
            style={{ ...mono, width: '100%', minWidth: 0, textAlign: 'right' }}
          />
          </span>
          <span style={dim}>deg</span>
          <Button
            testid="overlay-upright"
            size="small"
            disabled={rotation === 0}
            whyDisabled="It is upright already"
            title="Put it upright again"
            onClick={() => props.onEdit({ kind: 'setOverlay', clipId: clip.id, rotation: 0 })}
          >
            Upright
          </Button>
        </span>
      </div>
      <div style={row}>
        <span style={dim}>Opacity</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity}
            data-testid="overlay-opacity"
            data-value={opacity}
            title="How see-through it is. Double click to draw it fully again"
            onPointerDown={() => {
              dragging.current = true
              moved.current = false
            }}
            onPointerUp={(e) => {
              dragging.current = false
              e.currentTarget.blur()
            }}
            onDoubleClick={() => props.onEdit({ kind: 'setOverlay', clipId: clip.id, opacity: 1 })}
            onChange={(e) => {
              // One undo step for a whole drag of the slider.
              const continuing = dragging.current && moved.current
              moved.current = true
              props.onEdit({ kind: 'setOverlay', clipId: clip.id, opacity: Number(e.target.value) / 100 }, continuing)
            }}
          />
          <span style={{ ...mono, minWidth: 34, textAlign: 'right' }}>{opacity}%</span>
        </span>
      </div>
      <AppearRow clip={clip} side="in" fps={props.fps} onEdit={props.onEdit} />
      <AppearRow clip={clip} side="out" fps={props.fps} onEdit={props.onEdit} />
    </>
  )
}
