import { useEffect, useMemo, useState } from 'react'
import type { Timeline } from '../../shared/project'

/**
 * Plan 67: the lighter copies the preview plays while the setting is on, by
 * the id of the recording each is a copy of. Asked for, one recording at a
 * time, for every recording with a clip on a video track; main makes each one
 * once and answers with where it is. Off, there are none, and the preview
 * plays the recordings themselves again at once.
 */
export function useLighterCopies(on: boolean, timeline: Timeline | null): ReadonlyMap<string, string> {
  const [made, setMade] = useState<ReadonlyMap<string, string>>(new Map())
  // The recordings on the timeline's video tracks, as one string, so an edit that uses no new one asks for nothing.
  const wanted = useMemo(() => {
    if (!on || !timeline) return ''
    const ids = new Set(timeline.videoTracks.flatMap((r) => r.clips.map((c) => c.mediaId)))
    return [...ids].sort().join('\n')
  }, [on, timeline])

  useEffect(() => {
    if (wanted === '') return
    let gone = false
    void (async () => {
      for (const id of wanted.split('\n')) {
        if (gone) return
        const path = await window.api.lighterCopy(id).catch(() => null)
        if (gone || path === null) continue
        setMade((was) => (was.get(id) === path ? was : new Map(was).set(id, path)))
      }
    })()
    return () => {
      gone = true
    }
  }, [wanted])

  // Turned off, the copy being made stops: nothing will play it (audit 2026-10-01).
  useEffect(() => {
    if (!on) void window.api.stopLighterCopies()
  }, [on])

  return on ? made : EMPTY
}

const EMPTY: ReadonlyMap<string, string> = new Map()
