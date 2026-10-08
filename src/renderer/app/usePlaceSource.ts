/**
 * Putting a source on the timeline, and an effect from the effects folder
 * (plan 90), which is brought in first when it is not in the project yet.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { findClip, hasPicture, newId, placeSource, prepareDrop, sequenceOf, timelineOf, trackCount, type Project, type TrackKind } from '../../shared/project'
import { isSilentPeaks, peaksKey } from '../../shared/sound'
import { samePathKey } from '../../shared/render-plan'
import { effectPlacement, type EffectPlace } from '../../shared/effects'
import type { BackgroundColour } from '../../shared/looks'
import { lastFramingFor } from '../../shared/last-framing'
import { showToast } from '../state/toasts'
import type { AppLocals, Selecting } from './app-state'

export function usePlaceSource({
  project,
  timeline,
  proj,
  sequenceId,
  peaks,
  assets,
  select,
  showClip,
  undo,
  lastFraming
}: Pick<AppLocals, 'project' | 'timeline' | 'proj' | 'sequenceId' | 'peaks' | 'assets' | 'undo' | 'lastFraming'> & Pick<Selecting, 'select' | 'showClip'>) {
  /**
   * Plan 93: a recording just put on a sequence where nothing is framed yet
   * takes the framing used last, when it is the same size as the recording
   * that framing was made on, and is offered it otherwise.
   */
  /** The recordings given the last framing here, which still count as unframed while they carry it. */
  const givenLastFraming = useRef(new Set<string>())
  const offerLastFraming = useCallback(
    async (p: Project, clipId: string): Promise<void> => {
      // Read when it is wanted, from the settings unless one is still on its way there.
      const framing = lastFraming.current ?? (await window.api.appSettings()).lastFraming
      const made = timelineOf(p, sequenceId)
      const what = lastFramingFor(made, clipId, framing, givenLastFraming.current)
      if (!what || !framing) return
      const give = (): Promise<Project> => {
        givenLastFraming.current.add(clipId)
        return proj.edit({ kind: 'setFraming', clipId, framing, sequenceId: sequenceOf(p, sequenceId).id })
      }
      if (what === 'apply') {
        void give().then(() => showToast({ kind: 'lastFraming', text: 'Framed like the recording you framed last.', undo }))
        return
      }
      showToast({ kind: 'lastFramingOffer', text: 'Use your last framing?', action: { label: 'Use', run: () => void give() }, dismissLabel: 'Dismiss' })
    },
    [proj, sequenceId, undo, lastFraming]
  )

  /**
   * Put a source on the timeline: dropped on a track at a frame, and then
   * selected, or at the end of V1 with Add to timeline. A recording's streams
   * whose waveforms are flat stay off it: OBS records every enabled stream,
   * routed or not. One whose waveform has not loaded yet counts as sound.
   * When there is no room for it, a notice says why.
   */
  const addSource = useCallback(
    (
      mediaId: string,
      at?: number,
      onTrack?: string,
      how: { insert?: boolean; newTrack?: TrackKind; whole?: boolean; removeBackground?: BackgroundColour } = {},
      /** Selected once it lands, as a drop is. Not an effect put over a clip, which leaves that clip selected. */
      selectIt = true
    ) => {
      if (!project || !timeline) return
      const m = project.media.find((x) => x.id === mediaId)
      if (!m) return
      const streams = Array.from({ length: trackCount(m) }, (_, i) => i).filter((i) => {
        const data = peaks.get(peaksKey(m.id, i))
        return !(data && isSilentPeaks(data))
      })
      const clipId = newId()
      const drop = { mediaId, clipId, streams, ...(at !== undefined ? { at } : {}), ...(onTrack !== undefined ? { onTrack } : {}) }
      const { refused } = placeSource(prepareDrop(timeline, drop, how), drop)
      if (refused) {
        showToast({ kind: 'refused', text: refused })
        return
      }
      const extra = {
        ...(how.insert ? { insert: true } : {}),
        ...(how.newTrack ? { newTrack: how.newTrack } : {}),
        ...(how.whole ? { whole: true } : {}),
        ...(how.removeBackground ? { removeBackground: { colour: how.removeBackground } } : {})
      }
      void proj.edit({ kind: 'addSource', ...drop, ...extra, sequenceId: sequenceOf(project, sequenceId).id }).then((p) => {
        // The sequence the edit made, since the window does not have it yet.
        const made = timelineOf(p, sequenceId)
        if (at !== undefined && findClip(made, clipId) && selectIt) {
          select(clipId)
          showClip(clipId, made)
        }
        // Not for an effect laid over a clip, which is no recording of the project's own.
        if (selectIt && !how.removeBackground) void offerLastFraming(p, clipId)
      })
    },
    [proj, project, timeline, sequenceId, peaks, select, showClip, offerLastFraming]
  )

  /**
   * Effects from the effects folder (plan 90) waiting to be brought in before
   * they go on the timeline, by the id of their source: where each goes, and
   * the background to take out of it, if it stands on one.
   */
  const effectJobs = useRef(new Map<string, { place: EffectPlace; background: BackgroundColour | null; name: string }>())
  const [effectsWaiting, setEffectsWaiting] = useState(0)

  /** An effect that is in the project now, put where it was meant to go. */
  const placeEffect = useCallback(
    (mediaId: string, job: { place: EffectPlace; background: BackgroundColour | null }) => {
      if (!project || !timeline) return
      const m = project.media.find((x) => x.id === mediaId)
      if (!m) return
      const picture = hasPicture(m)
      // Taken out as it lands, in the same edit, for a picture standing on green, blue or black.
      const keyed = job.background && picture ? { removeBackground: job.background } : {}
      const p = job.place
      if ('frame' in p) {
        addSource(mediaId, p.frame, p.trackId, { ...(p.newTrack ? { newTrack: p.newTrack } : {}), ...keyed })
        return
      }
      const placed = effectPlacement(timeline, p.clipId, picture, newId)
      if (!placed) {
        showToast({ kind: 'refused', text: 'The clip to put it over is no longer on the timeline.' })
        return
      }
      let onTrack = placed.onTrack
      let how: { newTrack?: TrackKind } = placed.newTrack ? { newTrack: placed.newTrack } : {}
      // The track above is taken there: a new one, rather than covering what is on it.
      if (picture && onTrack && !placed.newTrack) {
        const probe = { mediaId, clipId: newId(), streams: [0], at: placed.at, onTrack }
        if (placeSource(prepareDrop(timeline, probe, {}), probe).refused) {
          onTrack = newId()
          how = { newTrack: 'video' }
        }
      }
      addSource(mediaId, placed.at, onTrack, { ...how, ...keyed }, false)
    },
    [project, timeline, addSource]
  )

  /** An effect put on the timeline or over a clip: brought in first when it is not in the project yet. */
  const putEffect = useCallback(
    async (path: string, place: EffectPlace, told?: BackgroundColour): Promise<void> => {
      const background = told ?? (await window.api.effectBackground(path))
      const name = path.split(/[\/]/).pop() ?? path
      // Placed by the effect below, which sees the timeline as it is then rather than as it was before the wait.
      const known = assets.find((a) => samePathKey(a.originalPath) === samePathKey(path) && a.status === 'ready')
      const id = known?.id ?? (await window.api.importFiles([path]))[0]?.id
      if (!id) return
      effectJobs.current.set(id, { place, background, name })
      setEffectsWaiting((n) => n + 1)
    },
    [assets]
  )

  // Each effect brought in goes where it was meant to as soon as it is ready.
  useEffect(() => {
    for (const [id, job] of effectJobs.current) {
      const a = assets.find((x) => x.id === id)
      if (a?.status === 'failed') {
        effectJobs.current.delete(id)
        showToast({ kind: 'refused', text: `${job.name} could not be brought in, so it was not put on the timeline.` })
      } else if (a?.status === 'ready' && project?.media.some((m) => m.id === id)) {
        effectJobs.current.delete(id)
        placeEffect(id, job)
      }
    }
  }, [assets, project, placeEffect, effectsWaiting])

  return { addSource, putEffect }
}
