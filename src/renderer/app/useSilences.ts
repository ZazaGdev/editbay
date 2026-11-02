/**
 * Remove silences: the tracks it listens to, the pauses it finds there, the
 * ones clicked to keep, and taking the rest out.
 */

import { useCallback, useMemo, useState } from 'react'
import { sequenceOf } from '../../shared/project'
import { defaultListenTracks, findPauses, removableStretches } from '../../shared/silences'
import type { AppLocals, EditClip } from './app-state'

export function useSilences({
  project,
  sequenceId,
  timeline,
  peaks,
  silenceOpen,
  setSilenceOpen,
  silenceSettings,
  setPlaying,
  setPlayhead,
  seek,
  editClip
}: Pick<AppLocals, 'project' | 'sequenceId' | 'timeline' | 'peaks' | 'silenceOpen' | 'setSilenceOpen' | 'silenceSettings' | 'setPlaying' | 'setPlayhead' | 'seek'> &
  Pick<EditClip, 'editClip'>) {
  /** The audio tracks ticked to listen to, for the sequence they were ticked in; its defaults otherwise. */
  const [listenChoice, setListenChoice] = useState<{ sequenceId: string; ids: string[] } | null>(null)
  /** The pauses clicked to keep, by their first frame, for the pauses as they were found then. */
  const [keptPauses, setKeptPauses] = useState<{ found: string; from: ReadonlySet<number> }>({ found: '', from: new Set() })

  // Remove silences: what it listens to, and the pauses it finds there, found
  // again whenever the sequence or a setting changes. The pauses kept by
  // clicking are forgotten then, since they may no longer be the same pauses.
  const onSequence = project ? sequenceOf(project, sequenceId).id : sequenceId
  const listen = useMemo(
    () =>
      new Set(
        listenChoice && listenChoice.sequenceId === onSequence ? listenChoice.ids : timeline ? defaultListenTracks(timeline) : []
      ),
    [listenChoice, onSequence, timeline]
  )
  const found = useMemo(
    () => (silenceOpen && timeline ? findPauses(timeline, peaks, listen, silenceSettings) : null),
    [silenceOpen, timeline, peaks, listen, silenceSettings]
  )
  const foundKey = found ? JSON.stringify(found.pauses) : ''
  const kept = keptPauses.found === foundKey ? keptPauses.from : null
  // Of the pauses not kept, those that would not close up cleanly, as when a
  // voice over lies beside a recording's microphone stream, are left in and
  // shown as such.
  const toCut = useMemo(
    () => (found && timeline ? removableStretches(timeline, found.pauses.filter((p) => kept?.has(p.from) !== true), [...listen]) : []),
    [found, kept, timeline, listen]
  )
  const pauses = useMemo(() => {
    const cutting = new Set(toCut.map((p) => p.from))
    return found?.pauses.map((p) => {
      const isKept = kept?.has(p.from) === true
      return { ...p, kept: isKept, blocked: !isKept && !cutting.has(p.from) }
    })
  }, [found, kept, toCut])

  /**
   * Hear one pause before deciding about it: the sequence plays from a second
   * before it to a second after, so the words either side are heard with it.
   * A pause on its own says nothing; it is the join that has to sound right.
   */
  const hearPause = useCallback(
    (from: number) => {
      setPlaying(false)
      setPlayhead(Math.max(0, from - (timeline?.fps ?? 30)))
      setPlaying(true)
    },
    [timeline]
  )

  /** Close Remove silences, forgetting the tracks ticked and the pauses kept. */
  const closeSilences = useCallback(() => {
    setSilenceOpen(false)
    setListenChoice(null)
    setKeptPauses({ found: '', from: new Set() })
  }, [])

  const togglePause = useCallback(
    (from: number) => {
      setKeptPauses((prev) => {
        const next = new Set(prev.found === foundKey ? prev.from : [])
        if (next.has(from)) next.delete(from)
        else next.add(from)
        return { found: foundKey, from: next }
      })
      seek(from)
    },
    [foundKey, seek]
  )

  const removeSilences = useCallback(() => {
    if (toCut.length === 0 || found?.waiting !== false) return
    editClip({ kind: 'removeStretches', stretches: toCut, listen: [...listen] })
    closeSilences()
  }, [toCut, found, editClip, closeSilences, listen])

  return { onSequence, listen, found, foundKey, toCut, pauses, hearPause, closeSilences, togglePause, removeSilences, setListenChoice, setKeptPauses }
}
