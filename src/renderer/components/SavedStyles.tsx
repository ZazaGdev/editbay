/**
 * Plan 99: your own caption styles, or your own text styles, in their panel:
 * each as a small button that puts it on, with an x that forgets it, and
 * Save as my style to keep the look you have now. Kept with the app's
 * settings, so every project has them.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { cleanStyleName, nextStyleName, removeStyle, saveStyle, type SavedStyle } from '../../shared/saved-styles'
import type { AppSettings } from '../../shared/types'
import { Button } from '../ui/Button'
import { ink, radius, surface, type } from '../theme'

type Key = 'savedCaptionStyles' | 'savedTextStyles'

/** What each panel was last told, so a style saved in one window of the Inspector shows in the other at once. */
const listeners = new Set<() => void>()
const known: Partial<Record<Key, SavedStyle<unknown>[]>> = {}

/** One of the two lists of saved styles, read from the settings and kept there. */
export function useSavedStyles<S>(key: Key): { list: SavedStyle<S>[]; store: (next: SavedStyle<S>[]) => void } {
  const [, redraw] = useState(0)
  useEffect(() => {
    const on = (): void => redraw((n) => n + 1)
    listeners.add(on)
    if (known[key] === undefined)
      void window.api.appSettings().then((s: AppSettings) => {
        known[key] = s[key] as SavedStyle<unknown>[]
        listeners.forEach((l) => l())
      })
    return () => void listeners.delete(on)
  }, [key])
  const store = useCallback(
    (next: SavedStyle<S>[]): void => {
      known[key] = next as SavedStyle<unknown>[]
      listeners.forEach((l) => l())
      void window.api.setAppSettings({ [key]: next } as Partial<AppSettings>).then((s: AppSettings) => {
        known[key] = s[key] as SavedStyle<unknown>[]
        listeners.forEach((l) => l())
      })
    },
    [key]
  )
  return { list: (known[key] ?? []) as SavedStyle<S>[], store }
}

export function SavedStyles<S>(props: {
  /** Which list, and what its test ids start with. */
  which: Key
  testid: string
  /** What a new one is offered as: "My caption style". */
  baseName: string
  /** The look there is now, as it would be kept. */
  current: () => S
  /** Put a saved look on. */
  onUse: (style: S) => void
}): JSX.Element {
  const { list, store } = useSavedStyles<S>(props.which)
  const [naming, setNaming] = useState<string | null>(null)
  const save = (): void => {
    const name = cleanStyleName(naming ?? '')
    setNaming(null)
    if (name !== '') store(saveStyle(list, name, props.current()))
  }
  return (
    <div data-testid={props.testid} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {list.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {list.map((s) => (
            <span
              key={s.id}
              style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${surface.lineStrong}`, borderRadius: radius.chip, font: type.meta, color: ink.primary }}
            >
              <button
                data-testid={`${props.testid}-use`}
                data-name={s.name}
                title={`Use ${s.name}`}
                onClick={() => props.onUse(s.style)}
                style={{ background: 'none', border: 'none', color: 'inherit', font: type.meta, padding: '2px 4px 2px 8px', cursor: 'pointer' }}
              >
                {s.name}
              </button>
              <button
                data-testid={`${props.testid}-remove`}
                data-name={s.name}
                aria-label={`Forget ${s.name}`}
                title={`Forget ${s.name}`}
                onClick={() => store(removeStyle(list, s.id))}
                style={{ background: 'none', border: 'none', color: ink.muted, font: type.meta, padding: '2px 6px 2px 2px', cursor: 'pointer' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {naming === null ? (
        <Button
          testid={`${props.testid}-save`}
          size="small"
          icon="save"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setNaming(nextStyleName(list, props.baseName))}
          title="Keep this look under a name, to put on in one click in any project"
        >
          Save as my style
        </Button>
      ) : (
        <span style={{ display: 'flex', gap: 4, width: '100%' }}>
          <span className="ui-field__box" style={{ height: 24, flex: 1 }}>
            <input
              data-testid={`${props.testid}-name`}
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
          <Button testid={`${props.testid}-confirm`} size="small" variant="primary" onClick={save}>
            Save
          </Button>
        </span>
      )}
    </div>
  )
}
