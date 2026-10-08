/**
 * The range marked with In and Out, and the stretch the selected clips cover.
 */

import { useCallback, useMemo } from 'react'
import { findClip, marksOf } from '../../shared/project'
import { spanEnd } from '../../shared/tracks'
import type { AppLocals, EditClip, Selecting } from './app-state'

export function useMarks({ timeline, total, editClip, selectedClips }: Pick<AppLocals, 'timeline' | 'total'> & Pick<EditClip, 'editClip'> & Pick<Selecting, 'selectedClips'>) {
  /**
   * The range marked with In and Out on the sequence on screen, `out` not
   * included. On the sequence and changed by an edit, so a mark pressed by
   * mistake undoes: see `SequenceMarks`.
   */
  const marks = useMemo(() => (timeline ? marksOf(timeline) : { in: null, out: null }), [timeline])
  /**
   * Mark a range, as an edit. Only the end pressed is sent, and main works
   * the rest out against the document as it is then: In and Out pressed
   * quickly would otherwise send marks read before the first had come back.
   */
  const setMarks = useCallback(
    (next: { in?: number | null; out?: number | null }) => {
      editClip({ kind: 'setSequenceMarks', ...next })
    },
    [editClip]
  )

  /** The stretch the selected clips cover, first start to last end, for exporting only that. */
  const selectedSpan = useMemo(() => {
    const clips = timeline ? selectedClips.map((id) => findClip(timeline, id)?.clip).filter((c) => c !== undefined) : []
    if (clips.length === 0) return null
    return { from: Math.min(...clips.map((c) => c.timelineStart)), to: Math.max(...clips.map((c) => spanEnd(c))) }
  }, [timeline, selectedClips])

  const range = useMemo(() => {
    if (marks.in === null && marks.out === null) return null
    const from = Math.min(marks.in ?? 0, total)
    const to = Math.min(marks.out ?? total, total)
    return to > from ? { from, to } : null
  }, [marks, total])

  return { marks, setMarks, selectedSpan, range }
}
