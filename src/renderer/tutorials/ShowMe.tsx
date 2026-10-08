import { useEffect, useRef, useState, type JSX } from 'react'
import { inlines } from '../../shared/markdown'
import { NEEDS, type Step } from '../../shared/tutorials'
import { accent, elevation, ink, radius, space, surface, type } from '../theme'
import { controlBox, elementFor, selectFor, showOnOutput, type Picker } from './show-target'

/** How long the highlight stays before the tutorial comes back on its own. */
const STAY_MS = 4000

/** How long a control that comes with a selection is waited for, before Show me says where to look instead. */
const WAIT_MS = 1500

/**
 * Show me, over the editor while the tutorials window steps aside (plan 101).
 *
 * The control the step names is ringed and everything else dimmed. A control
 * that only appears once you act, a menu item, has the nearest control on
 * screen ringed instead, and the callout says what to do with it. When even
 * that is not on screen, the callout still shows, in the middle, so it says
 * where to look rather than nothing.
 *
 * A step about a kind of thing (task 84), a sound clip or a caption, first
 * finds one: the one selected, or else the one nearest the playhead, which it
 * selects when the control lives in the Inspector. With none at all the
 * callout says what to drop or make first, and nothing is ringed.
 *
 * A click anywhere, Escape (handled by the window) or a few seconds bring the
 * tutorial back.
 */
export function ShowMe(props: { step: Step; pick?: Picker | undefined; onDone: () => void }): JSX.Element {
  const show = props.step.show!
  /** Undefined while it is still being looked for. */
  const [found, setFound] = useState<{ box: DOMRect | null; hint?: string; fallback?: boolean } | undefined>(undefined)

  const onDone = useRef(props.onDone)
  onDone.current = props.onDone
  const pick = useRef(props.pick)
  pick.current = props.pick

  useEffect(() => {
    let within: string | null = null
    if (show.on) {
      const el = elementFor(show.on, pick.current?.playhead() ?? 0)
      if (!el) {
        setFound({ box: null, hint: NEEDS[show.on] })
        return
      }
      if (pick.current) {
        selectFor(show.on, el, pick.current)
        showOnOutput(show.target, el, pick.current)
      }
      // Looked for again by its id each time, because selecting it may draw it afresh.
      const owner = el.closest<HTMLElement>('[data-clip-id], [data-caption-id]')
      within = owner?.dataset['clipId']
        ? `[data-clip-id="${CSS.escape(owner.dataset['clipId'])}"]`
        : owner?.dataset['captionId']
          ? `[data-caption-id="${CSS.escape(owner.dataset['captionId'])}"]`
          : null
      if (!within) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        within = `[data-show-me-element]`
        el.setAttribute('data-show-me-element', '')
      }
    } else if (pick.current) {
      showOnOutput(show.target, null, pick.current)
    }
    const until = performance.now() + WAIT_MS
    let frame = 0
    const look = (): void => {
      const near = within ? document.querySelector<HTMLElement>(within) : null
      const box = controlBox(show.target, near)
      if (box) return setFound({ box })
      if (performance.now() <= until) {
        frame = requestAnimationFrame(look)
        return
      }
      // The control is not there, in this mode: the switch to it, with the words for what to do.
      setFound({ box: show.or ? controlBox(show.or, near) : null, fallback: true })
    }
    // A frame first, so a selection just made is drawn before it is looked for.
    frame = requestAnimationFrame(look)
    return () => {
      cancelAnimationFrame(frame)
      document.querySelector('[data-show-me-element]')?.removeAttribute('data-show-me-element')
    }
  }, [])

  useEffect(() => {
    if (found === undefined) return
    const timer = window.setTimeout(() => onDone.current(), found.hint ? STAY_MS * 1.5 : STAY_MS)
    return () => window.clearTimeout(timer)
  }, [found])

  if (found === undefined) {
    return <div data-testid="show-me" data-looking="yes" style={{ position: 'fixed', inset: 0, zIndex: 89 }} />
  }
  const box = found.box
  // With a fallback named, the step's words are for the fallback, and the control itself only needs "Here".
  const say = show.or && !found.fallback ? undefined : show.say
  const words = found.hint ?? say ?? (box ? 'Here' : inlines(props.step.text).map((p) => p.text).join(''))

  const below = box ? box.bottom + 80 < innerHeight : false
  const callout = box
    ? {
        left: Math.max(space.sm, Math.min(box.left, innerWidth - 320)),
        top: below ? box.bottom + space.md : Math.max(space.sm, box.top - 64)
      }
    : { left: '50%', top: '40%', transform: 'translate(-50%, -50%)' }
  // The pointer on the callout's edge nearest the control, over the control's middle or near its start.
  const pointerLeft = box ? Math.max(10, Math.min(280, box.left + Math.min(box.width / 2, 24) - (callout.left as number) - 5)) : 0

  return (
    <>
      {/* Takes the click that brings the tutorial back, so it never lands on the editor. */}
      <div
        data-testid="show-me"
        onClick={() => onDone.current()}
        style={{ position: 'fixed', inset: 0, zIndex: 89, cursor: 'pointer' }}
      />
      {box ? (
        <div
          data-testid="show-me-ring"
          style={{
            position: 'fixed',
            left: box.left - 5,
            top: box.top - 5,
            width: box.width + 10,
            height: box.height + 10,
            border: `2px solid ${accent.bright}`,
            borderRadius: radius.control,
            boxShadow: `0 0 0 9999px ${surface.scrim}`,
            pointerEvents: 'none',
            zIndex: 90
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: surface.scrim, pointerEvents: 'none', zIndex: 90 }} />
      )}
      <div
        data-testid="show-me-callout"
        data-found={box ? 'yes' : 'no'}
        data-hint={found.hint ? 'yes' : 'no'}
        style={{
          position: 'fixed',
          ...callout,
          maxWidth: 300,
          zIndex: 91,
          // A dark card like a menu, with the accent down its edge (task 83): the amber it had jarred.
          background: surface.raised,
          color: ink.primary,
          border: `1px solid ${surface.lineStrong}`,
          borderLeft: `3px solid ${accent.base}`,
          boxShadow: elevation.over,
          font: type.body,
          fontWeight: 600,
          padding: `${space.sm}px ${space.md}px`,
          borderRadius: radius.control,
          pointerEvents: 'none'
        }}
      >
        {box && (
          <div
            data-testid="show-me-pointer"
            style={{
              position: 'absolute',
              left: pointerLeft,
              ...(below ? { top: -6 } : { bottom: -6 }),
              width: 10,
              height: 10,
              background: surface.raised,
              ...(below
                ? { borderLeft: `1px solid ${surface.lineStrong}`, borderTop: `1px solid ${surface.lineStrong}` }
                : { borderRight: `1px solid ${surface.lineStrong}`, borderBottom: `1px solid ${surface.lineStrong}` }),
              transform: 'rotate(45deg)'
            }}
          />
        )}
        {words}
        <div style={{ font: type.meta, fontWeight: 400, color: ink.secondary, marginTop: 2 }}>Click anywhere to go back to the tutorial</div>
      </div>
    </>
  )
}
