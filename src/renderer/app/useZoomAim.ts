/**
 * Plan 75: the one click zooms of the Inspector, and aiming the one just made
 * with a click on a view.
 */

import { useEffect, useMemo, useState } from 'react'
import type { PresetEdit, ZoomTools } from '../components/ZoomGroup'
import { ZOOM_SPEEDS } from '../state/useSettings'
import { useSteady } from '../state/useSteady'
import { isTypingTarget } from './fields'
import type { AppLocals, EditClip } from './app-state'

export function useZoomAim({
  proj,
  selected,
  timeline,
  windowSettings,
  setWindowSettings,
  editClip
}: Pick<AppLocals, 'proj' | 'selected' | 'timeline' | 'windowSettings' | 'setWindowSettings'> & Pick<EditClip, 'editClip'>) {
  /**
   * Plan 75: the one click zoom just made, while a click on a view can still
   * aim it, and the point it was aimed at. Aimed, it is sent again with the
   * point, in the same undo step. Any other edit, an undo, or another clip
   * ends it, as do Enter, Escape and its button pressed again.
   */
  const [aim, setAim] = useState<{ edit: PresetEdit; step: number; point: { x: number; y: number } | null } | null>(null)
  const aiming = aim !== null && aim.step === proj.step() && aim.edit.clipId === selected ? aim : null
  const zoomPresetMade = useSteady((e: PresetEdit) => {
    const fps = timeline?.fps ?? 30
    const edit: PresetEdit = {
      ...e,
      scale: windowSettings.zoomAmount / 100,
      ...(e.preset === 'punch' ? {} : { ramp: Math.max(1, Math.round(ZOOM_SPEEDS[windowSettings.zoomSpeed] * fps)) })
    }
    if (editClip(edit)) setAim({ edit, step: proj.step(), point: null })
  })
  const aimAt = useSteady((point: { x: number; y: number }) => {
    if (!aiming) return
    editClip({ ...aiming.edit, point }, true)
    setAim({ ...aiming, point })
  })
  const endAim = useSteady(() => setAim(null))
  const zoomTools = useMemo<ZoomTools>(
    () => ({
      amount: windowSettings.zoomAmount,
      speed: windowSettings.zoomSpeed,
      onAmount: (zoomAmount) => setWindowSettings({ zoomAmount }),
      onSpeed: (zoomSpeed) => setWindowSettings({ zoomSpeed }),
      onPreset: zoomPresetMade,
      aiming: aiming?.edit.preset ?? null,
      onAimEnd: endAim
    }),
    [windowSettings.zoomAmount, windowSettings.zoomSpeed, aiming?.edit.preset, zoomPresetMade, endAim, setWindowSettings]
  )
  // Enter or Escape: done aiming, on the point it has. Heard first, so Escape clears nothing else.
  const aimingNow = aiming !== null
  useEffect(() => {
    if (!aimingNow) return
    const down = (e: KeyboardEvent): void => {
      if ((e.key !== 'Enter' && e.key !== 'Escape') || isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setAim(null)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [aimingNow])

  return { aiming, aimAt, zoomTools }
}
