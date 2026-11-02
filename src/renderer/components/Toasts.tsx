import { useLayoutEffect, useState, type JSX } from 'react'
import { dismissToast, useToasts } from '../state/toasts'
import { surface, ink, space, radius, type, elevation } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

/** The gap between a toast and whatever it is sitting under. */
const CLEAR = 10

/** What sits across the top of the window, so a toast goes below all of it. */
const ABOVE = ['top-bar', 'ffmpeg-banner', 'missing-media', 'notices'].map((id) => `[data-testid="${id}"]`).join(',')

/**
 * How low the toasts sit: just under the top bar, over the top of the preview.
 * Low on the right they sat over the inspector, and covered the setting you had
 * just changed (task 2014).
 *
 * Measured rather than set to a number, because a banner or a notice that
 * waits for an answer comes and goes under the top bar, and a toast must not
 * cover the buttons on it. Measured each time the toasts change, not watched,
 * so playback redrawing the timeline costs nothing here.
 */
function useBelowTopBar(count: number): number {
  const [top, setTop] = useState(56)

  useLayoutEffect(() => {
    const measure = (): void => {
      let bottom = 0
      for (const el of document.querySelectorAll(ABOVE)) bottom = Math.max(bottom, el.getBoundingClientRect().bottom)
      setTop(bottom + CLEAR)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [count])

  return top
}

/** The short notices, at the top in the middle under the top bar, newest last. */
export function Toasts(): JSX.Element | null {
  const toasts = useToasts()
  const top = useBelowTopBar(toasts.length)
  if (toasts.length === 0) return null
  return (
    <div
      data-testid="toasts"
      style={{
        position: 'fixed',
        top,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
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
