/**
 * Every track's waveform, loaded once each, loaded again for a source that
 * comes back, and let go for a source no longer in the project.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { trackCount, trackPeaks } from '../../shared/project'
import { isPeaksKeyOf, peaksKey } from '../../shared/sound'
import type { AppLocals } from './app-state'

export function usePeaks({ project, peaks, setPeaks, missingMedia, rebuildingMedia }: Pick<AppLocals, 'project' | 'peaks' | 'setPeaks' | 'missingMedia' | 'rebuildingMedia'>) {
  const [revisions, setRevisions] = useState<Map<string, number>>(new Map())
  const unavailable = useRef<Set<string>>(new Set())

  // A source that comes back, rebuilt or relinked, has a waveform and
  // filmstrip that were not there before: drop what was loaded for it, so
  // both are fetched again.
  useEffect(() => {
    const now = new Set([...missingMedia, ...rebuildingMedia])
    const back = [...unavailable.current].filter((id) => !now.has(id))
    unavailable.current = now
    if (back.length === 0) return
    setPeaks((prev) => {
      const next = new Map(prev)
      for (const key of prev.keys()) {
        if (back.some((id) => isPeaksKeyOf(key, id))) next.delete(key)
      }
      return next
    })
    setRevisions((prev) => {
      const next = new Map(prev)
      for (const id of back) next.set(id, (next.get(id) ?? 0) + 1)
      return next
    })
  }, [missingMedia, rebuildingMedia])

  // Every track's waveform: the first for the timeline, the rest for clips
  // that play them and for telling which tracks are silent.
  // Each asked once while its answer is on the way: the first used to be asked
  // again on every step of a drag until it came (audit 2026-10-01).
  const peaksAsked = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!project) return
    for (const m of project.media) {
      if (rebuildingMedia.includes(m.id)) continue
      for (let i = 0; i < Math.max(1, trackCount(m)); i++) {
        const key = peaksKey(m.id, i)
        if (peaks.has(key) || peaksAsked.current.has(key) || (i > 0 && !trackPeaks(m, i))) continue
        peaksAsked.current.add(key)
        void window.api
          .loadPeaks(m.id, i)
          .then((data) => setPeaks((prev) => new Map(prev).set(key, data)))
          .catch(() => undefined)
          .finally(() => peaksAsked.current.delete(key))
      }
    }
  }, [project, peaks, rebuildingMedia])

  // Those of sources no longer in the project are let go: another project's
  // waveforms were kept for as long as the app ran (audit 2026-10-01).
  const mediaIds = useMemo(() => (project ? project.media.map((m) => m.id).join(',') : ''), [project])
  useEffect(() => {
    const here = new Set(mediaIds.split(','))
    setPeaks((prev) => {
      const gone = [...prev.keys()].filter((key) => ![...here].some((id) => isPeaksKeyOf(key, id)))
      if (gone.length === 0) return prev
      const next = new Map(prev)
      for (const key of gone) next.delete(key)
      return next
    })
  }, [mediaIds])

  return { revisions }
}
