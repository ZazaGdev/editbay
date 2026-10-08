/**
 * Selecting clips, gaps and captions, and what the selection is made of: the
 * clips it takes, the timeline the framing tools read, and the other clips a
 * change to the leading clip's picture is also made on.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ClipEdit } from '../../shared/types'
import { findClip, findVideoClip, trackOf, type Gap, type Timeline as TimelineData } from '../../shared/project'
import { playheadInto } from '../../shared/playback'
import { captionAt } from '../../shared/captions'
import { gapAt } from '../../shared/tracks'
import { groupedIds, groupPieces, standInTimeline } from '../../shared/groups'
import type { AppLocals } from './app-state'

/** The edits to a picture's place or crop, which several selected clips take together (note 32). */
const ON_SELECTED: ReadonlySet<ClipEdit['kind']> = new Set(['setCrop', 'setZoomKey', 'setSimpleZoom', 'setPlace', 'setPip'])

export function useSelecting({
  stateNow,
  setPlayhead,
  playheadStore,
  timeline,
  selected,
  setSelected,
  alsoSelected,
  setAlsoSelected,
  selectedAlone,
  setSelectedAlone,
  gap,
  setGap,
  selectedCaption,
  setSelectedCaption,
  setSelectedTransition
}: Pick<
  AppLocals,
  | 'stateNow'
  | 'setPlayhead'
  | 'playheadStore'
  | 'timeline'
  | 'selected'
  | 'setSelected'
  | 'alsoSelected'
  | 'setAlsoSelected'
  | 'selectedAlone'
  | 'setSelectedAlone'
  | 'gap'
  | 'setGap'
  | 'selectedCaption'
  | 'setSelectedCaption'
  | 'setSelectedTransition'
>) {
  /** Select a clip, with the clips linked to it unless `alone`, or nothing. */
  const select = useCallback((clipId: string | null, alone = false) => {
    setSelected(clipId)
    setAlsoSelected([])
    setSelectedAlone(clipId !== null && alone)
    setGap(null)
    setSelectedCaption(null)
    setSelectedTransition(null)
  }, [])

  /**
   * Move the playhead into a clip unless it is already inside it, for a clip
   * just dropped onto the timeline. Selecting a clip never does this: the
   * playhead and the view stay where they are.
   *
   * `inTimeline` is the sequence to find the clip in, for a clip selected the
   * moment an edit lands, before the window has the new document.
   *
   * Never while the preview plays, where the playhead belongs to playback.
   */
  const showClip = useCallback((clipId: string, inTimeline?: TimelineData) => {
    if (stateNow.current.playing) return
    const t = inTimeline ?? stateNow.current.timeline
    const found = t ? findClip(t, clipId) : null
    if (found) setPlayhead(playheadInto(found.clip, stateNow.current.playhead))
  }, [])

  /**
   * Framing the selected picture clip begins: the Inspector's picture
   * sections, the monitor or the nudge keys. Selecting leaves the playhead
   * where it is, so it may be in another clip, whose picture the monitor shows
   * and its crop box would edit. The playhead goes into the selected clip
   * first, so framing always edits the clip selected. True when it moved.
   */
  const frameSelected = useCallback((): boolean => {
    const now = stateNow.current
    if (now.playing || !selected || !now.timeline) return false
    const found = findVideoClip(now.timeline, selected)
    if (!found) return false
    const into = playheadInto(found.clip, now.playhead)
    if (into === now.playhead) return false
    setPlayhead(into)
    // Now, not after the render: the Crop numbers read it as their visit begins.
    playheadStore.set(into)
    return true
  }, [selected, playheadStore])

  /**
   * A plain press on a clip already in a selection of several: it leads, so
   * the Inspector shows it, and the rest stay selected, so a drag takes them
   * all. If the press turns out to be a click, the timeline narrows it then.
   */
  const leadSelection = useCallback(
    (clipId: string) => {
      // As any press on a clip does, a gap, a caption or a transition picked
      // out is let go, or Delete would take that instead of the clips.
      setGap(null)
      setSelectedCaption(null)
      setSelectedTransition(null)
      if (clipId === selected) return
      setAlsoSelected([...(selected ? [selected] : []), ...alsoSelected].filter((id) => id !== clipId))
      setSelected(clipId)
    },
    [selected, alsoSelected]
  )

  /**
   * Shift+click: a clip joins the selection, or leaves it when it was already
   * in. The one added leads, so the Inspector shows the clip just pressed.
   * Taking away the leading clip leaves the one pressed before it leading.
   */
  const toggleSelected = useCallback(
    (clipId: string, alone = false) => {
      setGap(null)
      setSelectedCaption(null)
      if (selected === null) {
        setSelected(clipId)
        setAlsoSelected([])
        setSelectedAlone(alone)
        return
      }
      const rest = alsoSelected.filter((id) => id !== clipId)
      if (clipId === selected) {
        const lead = rest[rest.length - 1] ?? null
        setSelected(lead)
        setAlsoSelected(rest.slice(0, -1))
        return
      }
      if (alsoSelected.includes(clipId)) {
        setAlsoSelected(rest)
        return
      }
      setAlsoSelected([...alsoSelected, selected])
      setSelected(clipId)
    },
    [selected, alsoSelected]
  )

  /**
   * A box drawn over the timeline: the clips it touched, added to what was
   * selected with Shift held. The clip that leads, which the Inspector and the
   * monitor show, is the first picture the box took, or its first clip when it
   * took none, rather than whichever track happened to be read last. With
   * Shift, the clip already leading goes on leading if it is still selected.
   */
  const selectMany = useCallback(
    (clipIds: string[], add: boolean) => {
      setGap(null)
      setSelectedCaption(null)
      const already = add ? [...(selected === null ? [] : [selected]), ...alsoSelected] : []
      const all = [...already, ...clipIds.filter((id) => !already.includes(id))]
      const found = timeline ? all.flatMap((id) => { const f = findClip(timeline, id); return f ? [{ id, kind: f.kind, start: f.clip.timelineStart }] : [] }) : []
      const first = (of: typeof found): string | undefined => [...of].sort((a, b) => a.start - b.start)[0]?.id
      const lead = (add && selected !== null && all.includes(selected) ? selected : undefined) ?? first(found.filter((c) => c.kind === 'video')) ?? first(found) ?? null
      setSelected(lead)
      setAlsoSelected(all.filter((id) => id !== lead))
      if (!add) setSelectedAlone(false)
    },
    [timeline, selected, alsoSelected]
  )

  const selectGap = useCallback((g: Gap) => {
    setSelected(null)
    setAlsoSelected([])
    setSelectedAlone(false)
    setGap(g)
    setSelectedCaption(null)
  }, [])

  const selectCaption = useCallback((id: string) => {
    setSelected(null)
    setAlsoSelected([])
    setSelectedAlone(false)
    setGap(null)
    setSelectedCaption(id)
  }, [])

  /** Where the selected caption started, to find it again once grouping the words again has renamed every caption. */
  const captionFrom = useRef<number | null>(null)
  // A caption an edit or an undo has taken away is not selected any more,
  // unless another caption now stands where it began, as after a regroup.
  useEffect(() => {
    if (!selectedCaption || !timeline) return
    const c = timeline.captions.clips.find((x) => x.id === selectedCaption)
    if (c) captionFrom.current = c.timelineStart
    else setSelectedCaption((captionFrom.current === null ? undefined : captionAt(timeline.captions.clips, captionFrom.current)?.id) ?? null)
  }, [timeline, selectedCaption])

  // A selected gap that an edit or an undo has filled, or made longer or
  // shorter, is not the one selected any more.
  useEffect(() => {
    if (!gap || !timeline) return
    const found = trackOf(timeline, gap.trackId)
    const now = found ? gapAt(found.track.clips, gap.from) : null
    if (!now || now.from !== gap.from || now.to !== gap.to) setGap(null)
  }, [timeline, gap])

  /** Every selected clip, each with the clips linked to it, or each alone when selected on its own. */
  const selectedIds = useMemo(() => {
    if (!timeline || !selected) return new Set<string>()
    const ids = [selected, ...alsoSelected]
    // A piece of a group is the whole group, as one clip is (plan 80).
    return new Set(selectedAlone ? ids : ids.flatMap((id) => groupedIds(timeline, id)))
  }, [timeline, selected, alsoSelected, selectedAlone])

  /**
   * The selected clips themselves, leading clip first, without the clips
   * linked to them, and with every picture of a group one of them is in.
   */
  const selectedClips = useMemo(() => {
    if (selected === null || !timeline) return []
    const ids = [selected, ...alsoSelected].filter((id) => findClip(timeline, id))
    if (selectedAlone) return ids
    const out = [...ids]
    for (const id of ids) for (const c of groupPieces(timeline, id)) if (!out.includes(c.id)) out.push(c.id)
    return out
  }, [timeline, selected, alsoSelected, selectedAlone])

  /**
   * The timeline as the framing tools read it: with a piece of a group
   * selected, the group is one clip spanning it, framed as the group is
   * (plan 80), so its crop box, zoom and Inspector are the group's. Playback
   * and the timeline itself read the pieces.
   */
  const framing = useMemo(
    () => (timeline && selected && !selectedAlone ? (standInTimeline(timeline, selected) ?? timeline) : timeline),
    [timeline, selected, selectedAlone]
  )

  /**
   * The other selected picture clips a change to the selected one's picture
   * is also made on: every selected clip but it and the pieces of its own
   * group, which follow it anyway. None when it is taken on its own.
   */
  const alsoChanged = useMemo(() => {
    if (!timeline || !selected || selectedAlone) return []
    const own = new Set(groupPieces(timeline, selected).map((c) => c.id))
    return selectedClips.filter((id) => id !== selected && !own.has(id) && findVideoClip(timeline, id) !== null)
  }, [timeline, selected, selectedAlone, selectedClips])
  const onSelection = useCallback(
    (e: ClipEdit): ClipEdit =>
      ON_SELECTED.has(e.kind) && 'clipId' in e && e.clipId === selected && alsoChanged.length > 0 ? { kind: 'onSelected', edit: e, also: alsoChanged } : e,
    [selected, alsoChanged]
  )

  /**
   * Whether Link would do anything from a clip's menu: the clip is one of the
   * selection, and the selection holds more than one group.
   */
  const canLink = (clipId: string): boolean => {
    if (!timeline || !selectedIds.has(clipId)) return false
    const groups = new Set(selectedClips.map((id) => findClip(timeline, id)?.clip.link ?? `alone:${id}`))
    return groups.size > 1
  }

  return { select, showClip, frameSelected, leadSelection, toggleSelected, selectMany, selectGap, selectCaption, selectedIds, selectedClips, framing, alsoChanged, onSelection, canLink }
}
