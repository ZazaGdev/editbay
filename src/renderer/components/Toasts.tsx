import { useEffect, useState, type JSX } from 'react'
import { dismissToast, useToasts } from '../state/toasts'
import { surface, ink, space, radius, type, elevation } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

/** The gap between a toast and whatever it is sitting above. */
const CLEAR = 10

/**
 * How high the toasts sit: just above the timeline, which is where the work
 * is. They used to be centred over it, so the thing they were telling you
 * about was the thing they covered.
 *
 * Measured from the timeline rather than set to a number, because the panel
 * grows when the silence review opens and shrinks again when it closes.
 */
function useAboveTimeline(): number {
  const [bottom, setBottom] = useState(CLEAR)

  useEffect(() => {
    const panel = document.querySelector('[data-testid="timeline-panel"]')
    const measure = (): void => {
      const r = panel?.getBoundingClientRect()
      setBottom(r ? Math.max(CLEAR, window.innerHeight - r.top + CLEAR) : CLEAR)
    }
    measure()
    window.addEventListener('resize', measure)
    const watch = panel ? new ResizeObserver(measure) : null
    if (panel) watch?.observe(panel)
    return () => {
      window.removeEventListener('resize', measure)
      watch?.disconnect()
    }
  }, [])

  return bottom
}

/** The short notices, low on the right and clear of the timeline, newest last. */
export function Toasts(): JSX.Element | null {
  const toasts = useToasts()
  const bottom = useAboveTimeline()
  if (toasts.length === 0) return null
  return (
    <div
      data-testid="toasts"
      style={{
        position: 'fixed',
        bottom,
        right: space.lg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: space.sm,
        // Over a window's scrim, so what a window's own button did can be
        // read and acted on while the window is open; under a context menu.
        zIndex: 75,
        pointerEvents: 'none',
        maxWidth: 'min(420px, calc(100vw - 32px))'
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          data-kind={t.kind}
          role="status"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: space.md,
            padding: `${space.sm}px ${space.sm}px ${space.sm}px ${space.md}px`,
            borderRadius: radius.panel,
            background: surface.raised,
            border: `1px solid ${surface.lineStrong}`,
            color: ink.primary,
            font: type.body,
            boxShadow: elevation.over
          }}
        >
          <span>{t.text}</span>
          {t.action && (
            <Button
              size="small"
              testid="toast-action"
              onClick={() => {
                dismissToast(t.id)
                t.action?.run()
              }}
            >
              {t.action.label}
            </Button>
          )}
          {t.undo && (
            <Button
              size="small"
              testid="toast-undo"
              onClick={() => {
                dismissToast(t.id)
                t.undo?.()
              }}
            >
              Undo
            </Button>
          )}
          {(t.sticky || t.lasting || t.dismissLabel !== undefined) &&
            (t.dismissLabel === undefined ? (
              <IconButton
                icon="close"
                label="Dismiss"
                size="small"
                variant="ghost"
                testid="toast-dismiss"
                onClick={() => dismissToast(t.id)}
              />
            ) : (
              <Button size="small" testid="toast-dismiss" title="Dismiss" onClick={() => dismissToast(t.id)}>
                {t.dismissLabel}
              </Button>
            ))}
        </div>
      ))}
    </div>
  )
}
