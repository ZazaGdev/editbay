import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildLookup, resolveKeymap, type ActionId, type Keymap, type Overrides } from '../../shared/keymap'

export interface KeymapState {
  overrides: Overrides
  keymap: Keymap
  lookup: Map<string, ActionId>
  update: (next: Overrides) => void
}

/** Your shortcuts: loaded once, merged with the defaults, saved on every change. */
export function useKeymap(): KeymapState {
  const [overrides, setOverrides] = useState<Overrides>({})

  useEffect(() => {
    void window.api.loadKeymap().then(setOverrides)
  }, [])

  const keymap = useMemo(() => resolveKeymap(overrides), [overrides])
  const lookup = useMemo(() => buildLookup(keymap), [keymap])

  const update = useCallback((next: Overrides) => {
    // Apply straight away so the window reacts, then take back whatever the
    // store actually kept, which is the cleaned version.
    setOverrides(next)
    void window.api.saveKeymap(next).then(setOverrides)
  }, [])

  return { overrides, keymap, lookup, update }
}
