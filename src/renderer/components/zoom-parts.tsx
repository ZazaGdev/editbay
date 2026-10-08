import { useEffect, useRef, useState, type JSX } from 'react'
import type { ZoomPreset } from '../../shared/project'
import type { ClipEdit } from '../../shared/types'
import { ink, radius, space, type, wash } from '../theme'
import { Segmented } from '../ui/Segmented'
import { ZOOM_AMOUNTS, type ZoomAmount, type ZoomSpeed } from '../state/useSettings'

export type Edit = (e: ClipEdit, continuing?: boolean) => void

/** A one click zoom, as the Zoom group asks for it: the window adds how far and how quick. */
export type PresetEdit = Extract<ClipEdit, { kind: 'zoomPreset' }>

/**
 * Plan 75: how far the one click zooms go and how quickly, both remembered,
 * and the zoom just made while it can still be aimed with a click on a view.
 */
export interface ZoomTools {
  /** In per cent: 125, 150 or 200. */
  amount: ZoomAmount
  speed: ZoomSpeed
  onAmount: (amount: ZoomAmount) => void
  onSpeed: (speed: ZoomSpeed) => void
  /** Make a one click zoom, which the window then lets you aim. */
  onPreset: (e: PresetEdit) => void
  /** The one click zoom that can be aimed now, if any. */
  aiming: ZoomPreset | null
  onAimEnd: () => void
}

const SPEED_NAMES: { id: ZoomSpeed; label: string; title: string }[] = [
  { id: 'quick', label: 'Quick', title: 'Half a second' },
  { id: 'normal', label: 'Normal', title: 'A second' },
  { id: 'slow', label: 'Slow', title: 'Two seconds' }
]

const mono = { font: type.mono, fontVariantNumeric: 'tabular-nums' } as const

/** How long typing has to pause before the number is put on the picture. */
const TYPING_PAUSE_MS = 250

/** The Zoom group's quiet notice, for a question or a clip that stays still. */
export const callout: React.CSSProperties = {
  font: type.meta,
  color: ink.primary,
  background: wash.attention,
  border: `1px solid ${wash.attentionLine}`,
  borderRadius: radius.control,
  padding: space.sm
}

export const note: React.CSSProperties = { font: type.meta, color: ink.muted, margin: 0 }

/** How far the one click zooms go, and for Zoom in and Zoom in and out how quickly. Both remembered. */
export function AmountRow(props: { tools: ZoomTools; speed?: boolean }): JSX.Element {
  const { tools } = props
  return (
    <div style={{ display: 'grid', gridTemplateColumns: props.speed ? '1fr 1fr' : '1fr', gap: 6, marginTop: 2 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: type.meta, color: ink.muted }}>How far</span>
        <Segmented
          testid="zoom-amount"
          label="How far the one click zooms go"
          size="small"
          stretch
          chosen={String(tools.amount)}
          onChoose={(id) => tools.onAmount(Number(id) as ZoomAmount)}
          choices={ZOOM_AMOUNTS.map((a) => ({ id: String(a), label: `${a}%`, title: `${a}% of the most the picture can show` }))}
        />
      </div>
      {props.speed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: type.meta, color: ink.muted }}>How quick</span>
          <Segmented
            testid="zoom-speed"
            label="How quickly Zoom in and Zoom in and out get there"
            size="small"
            stretch
            chosen={tools.speed}
            onChoose={(id) => tools.onSpeed(id as ZoomSpeed)}
            choices={SPEED_NAMES}
          />
        </div>
      )}
    </div>
  )
}

/**
 * A number of the zoom, typed. As a crop number is: put on the picture after
 * a pause in typing, on Enter and on leaving, the up and down arrows stepping
 * it at once (ten steps with Shift), one visit one undo step, and Escape
 * putting back what it was.
 */
export function ZoomNumber(props: {
  label: string
  value: number
  step: number
  testid: string
  title: string
  onEnter: () => void
  onLeave: () => void
  onApply: (n: number, continuing: boolean) => void
  onRevert: () => void
}): JSX.Element {
  const [text, setText] = useState(String(props.value))
  const focused = useRef(false)
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

  return (
    <label className="ui-field" title={props.title}>
      <span className="ui-field__label">{props.label}</span>
      <span className="ui-field__box" style={{ height: 24 }}>
        <input
          data-testid={props.testid}
          type="number"
          step={props.step}
          value={text}
          onFocus={() => {
            focused.current = true
            applied.current = null
            cancelled.current = false
            props.onEnter()
          }}
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => {
              const n = parse(t)
              if (n !== null) apply(n)
            }, TYPING_PAUSE_MS)
          }}
          onBlur={() => {
            window.clearTimeout(timer.current)
            if (!cancelled.current) {
              const n = parse(text)
              if (n !== null) apply(n)
            }
            focused.current = false
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
              const input = e.currentTarget
              window.setTimeout(() => input.blur(), 0)
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              window.clearTimeout(timer.current)
              const from = parse(text) ?? props.value
              const next = from + (e.key === 'ArrowUp' ? props.step : -props.step) * (e.shiftKey ? 10 : 1)
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
