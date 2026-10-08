import { useRef, useState, type JSX } from 'react'
import { DRAW_ON_CHOICES, MAX_RADIUS, MAX_STROKE, cleanShapeName, shapeName, type ShapeStyle } from '../../shared/shape'
import { Segmented } from '../ui/Segmented'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { ink, type } from '../theme'

const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, font: type.meta, color: ink.primary, padding: '3px 0' } as const
const dim = { color: ink.muted } as const
const mono = { font: type.monoSmall, color: ink.secondary } as const

/**
 * A slider that is one undo step for a whole drag, as the Opacity slider is:
 * the first change of a drag begins a step and the rest carry it on.
 */
function Slider(props: {
  testid: string
  label: string
  min: number
  max: number
  value: number
  shown: string
  onChange: (value: number, continuing: boolean) => void
}): JSX.Element {
  const dragging = useRef(false)
  const moved = useRef(false)
  return (
    <div style={row}>
      <span style={dim}>{props.label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={1}
          value={props.value}
          data-testid={props.testid}
          data-value={props.value}
          aria-label={props.label}
          onPointerDown={() => {
            dragging.current = true
            moved.current = false
          }}
          onPointerUp={(e) => {
            dragging.current = false
            e.currentTarget.blur()
          }}
          onChange={(e) => {
            const continuing = dragging.current && moved.current
            moved.current = true
            props.onChange(Number(e.target.value), continuing)
          }}
        />
        <span style={{ ...mono, minWidth: 40, textAlign: 'right' }}>{props.shown}</span>
      </span>
    </div>
  )
}

/**
 * A shape's own settings, in the Inspector: its outline, its fill, its
 * corners, its arrowheads and bend, its shadow, and saving its look as a
 * style of your own for the Shape menu of every project.
 */
export function ShapePanel(props: {
  style: ShapeStyle
  onChange: (style: ShapeStyle, continuing: boolean) => void
  /** Bend a straight line into a curve, or straighten a curved one. */
  onBend: (on: boolean) => void
  /** Save its look under a name. */
  onSave: (name: string) => void
  /** The name a new saved style is offered. */
  suggestedName: string
}): JSX.Element {
  const { style } = props
  const set = (change: Partial<ShapeStyle>, continuing = false): void => props.onChange({ ...style, ...change }, continuing)
  const line = style.kind === 'line'
  // A pen stroke is all outline, as a line is: no fill, and never no width (plan 88).
  const stroked = line || style.kind === 'pen'
  const [naming, setNaming] = useState<string | null>(null)
  const save = (): void => {
    const name = cleanShapeName(naming ?? '')
    setNaming(null)
    if (name !== '') props.onSave(name)
  }
  return (
    <div data-testid="shape-panel" data-kind={shapeName(style)}>
      <div style={row}>
        <span style={dim}>Outline</span>
        <input
          type="color"
          aria-label="The outline's colour"
          data-testid="shape-stroke"
          value={style.stroke}
          onChange={(e) => set({ stroke: e.target.value })}
          className="ui-colour"
          style={{ width: 28, height: 20 }}
        />
      </div>
      <Slider
        testid="shape-stroke-width"
        label={stroked ? 'Width' : 'Outline width'}
        min={stroked ? 1 : 0}
        max={MAX_STROKE}
        value={style.strokeWidth}
        shown={style.strokeWidth === 0 ? 'none' : `${style.strokeWidth} px`}
        onChange={(v, continuing) => set({ strokeWidth: v }, continuing)}
      />
      {!stroked && (
        <>
          <div style={row}>
            <Check testid="shape-fill-on" checked={style.fill !== null} onChange={(on) => set({ fill: on ? (style.fill ?? style.stroke) : null })}>
              Fill
            </Check>
            {style.fill !== null && (
              <input
                type="color"
                aria-label="The fill's colour"
                data-testid="shape-fill"
                value={style.fill}
                onChange={(e) => set({ fill: e.target.value })}
                className="ui-colour"
                style={{ width: 28, height: 20 }}
              />
            )}
          </div>
          {style.fill !== null && (
            <Slider
              testid="shape-fill-opacity"
              label="Fill opacity"
              min={0}
              max={100}
              value={Math.round(style.fillOpacity * 100)}
              shown={`${Math.round(style.fillOpacity * 100)}%`}
              onChange={(v, continuing) => set({ fillOpacity: v / 100 }, continuing)}
            />
          )}
        </>
      )}
      {style.kind === 'box' && (
        <Slider
          testid="shape-radius"
          label="Corners"
          min={0}
          max={Math.min(MAX_RADIUS, Math.floor(Math.min(style.width, style.height) / 2))}
          value={Math.round(style.radius)}
          shown={`${Math.round(style.radius)} px`}
          onChange={(v, continuing) => set({ radius: v }, continuing)}
        />
      )}
      {line && (
        <>
          <div style={row}>
            <span style={dim}>Arrowheads</span>
            <span style={{ display: 'inline-flex', gap: 10 }}>
              <Check testid="shape-start-head" checked={style.startHead} onChange={(on) => set({ startHead: on })}>
                Start
              </Check>
              <Check testid="shape-end-head" checked={style.endHead} onChange={(on) => set({ endHead: on })}>
                End
              </Check>
            </span>
          </div>
          <div style={row}>
            <span style={dim}>{style.bend ? 'Curved' : 'Straight'}</span>
            <Button testid="shape-bend" size="small" onClick={() => props.onBend(!style.bend)} title={style.bend ? 'Make it a straight line again' : 'Bend it into a curve; drag its middle handle on the Output view to shape it'}>
              {style.bend ? 'Straighten' : 'Bend'}
            </Button>
          </div>
        </>
      )}
      <div style={row}>
        <Check testid="shape-shadow" checked={style.shadow} onChange={(on) => set({ shadow: on })}>
          Shadow
        </Check>
      </div>
      {/* Plan 88: the outline drawing itself on, from where it starts, over this long. */}
      <span style={{ ...dim, font: type.meta, marginTop: 4 }}>Draw on</span>
      <Segmented
        testid="shape-draw-on"
        label="How long the outline takes to draw itself on"
        size="small"
        stretch
        chosen={String(DRAW_ON_CHOICES.find((c) => Math.abs(c.seconds - (style.drawOn ?? 0)) < 1e-6)?.seconds ?? '')}
        onChoose={(v) => set({ drawOn: Number(v) })}
        choices={DRAW_ON_CHOICES.map((c) => ({ id: String(c.seconds), label: c.name, title: c.seconds === 0 ? 'Shown whole from the start' : `Drawn on over ${c.seconds} s` }))}
      />
      <div style={{ ...row, marginTop: 4 }}>
        {naming === null ? (
          <Button testid="shape-save" size="small" icon="save" onClick={() => setNaming(props.suggestedName)} title="Keep this look as a style of your own, in the Shape menu of every project">
            Save as my style
          </Button>
        ) : (
          <span style={{ display: 'flex', gap: 4, width: '100%' }}>
            <span className="ui-field__box" style={{ height: 24, flex: 1 }}>
              <input
                data-testid="shape-save-name"
                aria-label="The style's name"
                autoFocus
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                  if (e.key === 'Escape') setNaming(null)
                  e.stopPropagation()
                }}
                className="ui-field__input"
                style={{ width: '100%', minWidth: 0 }}
              />
            </span>
            <Button testid="shape-save-confirm" size="small" variant="primary" onClick={save}>
              Save
            </Button>
          </span>
        )}
      </div>
    </div>
  )
}
