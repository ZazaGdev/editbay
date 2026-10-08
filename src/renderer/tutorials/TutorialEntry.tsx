import { useState, type JSX } from 'react'
import { sections, type Step, type Tutorial } from '../../shared/tutorials'
import { accent, ink, meaning, radius, space, surface, type } from '../theme'
import { Markdown, MarkdownLine } from './Markdown'

export type View = 'steps' | 'details'

/**
 * The steps ticked off, by entry, for as long as the app is open. Kept out of
 * the window's state so closing it to try a step does not lose the ticks.
 */
const ticked = new Map<string, Set<number>>()

/**
 * One tutorial: a sentence, then Steps and Details as two tabs (plan 101).
 *
 * Steps comes first because that is what someone opening help wants; the
 * prose is one click away for whoever wants the why.
 */
export function TutorialEntry(props: {
  tutorial: Tutorial
  view: View
  onView: (v: View) => void
  onShowMe: (step: Step) => void
}): JSX.Element {
  const { tutorial } = props
  const parts = sections(tutorial.body)
  const [, redraw] = useState(0)
  const done = ticked.get(tutorial.id) ?? new Set<number>()
  const hasDetails = parts.details !== ''
  const view = hasDetails && parts.steps.length > 0 ? props.view : 'steps'

  const toggle = (i: number): void => {
    const next = new Set(done)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    ticked.set(tutorial.id, next)
    redraw((n) => n + 1)
  }

  return (
    <>
      <h2 style={{ font: type.title, color: ink.primary, margin: `0 0 ${space.xs}px` }}>{tutorial.title}</h2>
      {parts.lede !== '' ? (
        <div data-testid="tutorial-lede" style={{ margin: `0 0 ${space.md}px` }}>
          <Markdown body={parts.lede} />
        </div>
      ) : null}

      {parts.steps.length > 0 && hasDetails ? (
        <div
          role="tablist"
          style={{
            display: 'inline-flex',
            background: surface.sunken,
            border: `1px solid ${surface.lineStrong}`,
            borderRadius: radius.chip,
            padding: 2,
            marginBottom: space.md
          }}
        >
          {(['steps', 'details'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              data-testid="tutorial-view"
              data-view={v}
              aria-selected={view === v}
              onClick={() => props.onView(v)}
              style={{
                font: type.meta,
                color: view === v ? ink.primary : ink.secondary,
                background: view === v ? surface.control : 'transparent',
                border: 'none',
                borderRadius: radius.chip,
                padding: `3px ${space.md}px`,
                cursor: 'pointer'
              }}
            >
              {v === 'steps' ? 'Steps' : 'Details'}
            </button>
          ))}
        </div>
      ) : null}

      {parts.steps.length > 0 && view === 'steps' ? (
        <ol data-testid="tutorial-steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {parts.steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              index={i}
              last={i === parts.steps.length - 1}
              done={done.has(i)}
              onTick={() => toggle(i)}
              onShowMe={() => props.onShowMe(step)}
            />
          ))}
        </ol>
      ) : null}

      {hasDetails && (view === 'details' || parts.steps.length === 0) ? (
        <div data-testid="tutorial-details">
          <Markdown body={parts.details} />
        </div>
      ) : null}
    </>
  )
}

function StepRow(props: {
  step: Step
  index: number
  last: boolean
  done: boolean
  onTick: () => void
  onShowMe: () => void
}): JSX.Element {
  return (
    <li
      data-testid="tutorial-step"
      data-done={props.done}
      style={{
        display: 'grid',
        gridTemplateColumns: '30px 1fr auto',
        gap: space.sm,
        paddingBottom: props.last ? 0 : space.lg,
        position: 'relative'
      }}
    >
      {props.last ? null : (
        <span
          aria-hidden
          style={{ position: 'absolute', left: 10, top: 26, bottom: 2, width: 2, background: surface.lineStrong }}
        />
      )}
      <button
        data-testid="tutorial-step-tick"
        aria-pressed={props.done}
        aria-label={props.done ? `Step ${props.index + 1} done` : `Tick off step ${props.index + 1}`}
        title={props.done ? 'Done. Click to undo' : 'Tick this step off'}
        onClick={props.onTick}
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.round,
          border: `2px solid ${props.done ? meaning.done : accent.base}`,
          background: props.done ? meaning.done : 'transparent',
          color: props.done ? ink.onAccent : accent.bright,
          font: type.meta,
          fontWeight: 600,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          cursor: 'pointer'
        }}
      >
        {props.done ? '✓' : props.index + 1}
      </button>
      <div style={{ font: type.body, color: props.done ? ink.muted : ink.secondary, lineHeight: 1.65, paddingTop: 1 }}>
        <MarkdownLine text={props.step.text} />
      </div>
      {props.step.show ? (
        <button
          data-testid="tutorial-show-me"
          onClick={props.onShowMe}
          style={{
            font: type.meta,
            color: accent.bright,
            background: 'transparent',
            border: `1px solid ${accent.washLine}`,
            borderRadius: radius.chip,
            padding: `2px ${space.sm}px`,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            alignSelf: 'start'
          }}
        >
          Show me
        </button>
      ) : (
        <span />
      )}
    </li>
  )
}
