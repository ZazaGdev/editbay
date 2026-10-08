/**
 * Recording a voice over: the microphone opening, the take recording while
 * the sequence plays, and the take put on the timeline when it stops.
 */

import { useCallback, useEffect, useRef } from 'react'
import { findClip, newId, sequenceOf, timelineOf } from '../../shared/project'
import { startTake, type Take } from '../voiceover/recorder'
import type { VoiceOverState } from '../components/Transport'
import { showToast } from '../state/toasts'
import type { AppLocals, AppSettings, Selecting } from './app-state'

export function useVoiceOver({
  phase,
  takeRef,
  cancelStart,
  recording,
  setRecording,
  timeline,
  project,
  playhead,
  sequenceId,
  total,
  proj,
  setPlaying,
  recordSettings,
  select
}: Pick<
  AppLocals,
  'phase' | 'takeRef' | 'cancelStart' | 'recording' | 'setRecording' | 'timeline' | 'project' | 'playhead' | 'sequenceId' | 'total' | 'proj' | 'setPlaying'
> &
  Pick<AppSettings, 'recordSettings'> &
  Pick<Selecting, 'select'>) {
  /** The preview's clock, as it starts and settles: a take lines up with the last before it stops. */
  const onClock = useCallback((sec: number, at: number) => takeRef.current?.take.anchor(sec, at), [])

  const enterPhase = useCallback((next: VoiceOverState | null) => {
    phase.current = next?.phase ?? null
    setRecording(next)
  }, [])

  /** The document open now, for a take that took a while to start or to save. */
  const docNow = useRef(proj.docId)
  docNow.current = proj.docId

  /**
   * Record a voice over: the microphone opens, and the sequence plays from
   * the playhead, when there is anything left to play. Recording goes on past
   * the end until it is stopped. Everything is held from the moment this is
   * asked for, so nothing moves while the microphone opens.
   */
  const startRecording = useCallback(async () => {
    if (phase.current !== null || !timeline || !project) return
    const startFrame = playhead
    const onSequence = sequenceOf(project, sequenceId).id
    const doc = proj.docId
    cancelStart.current = false
    setPlaying(false)
    enterPhase({ phase: 'starting' })
    let take: Take
    try {
      take = await startTake({ deviceId: recordSettings.microphoneId, startSec: startFrame / timeline.fps })
    } catch (err) {
      enterPhase(null)
      showToast({ kind: 'refused', text: err instanceof Error ? err.message : String(err) })
      return
    }
    if (cancelStart.current || docNow.current !== doc) {
      await take.cancel().catch(() => undefined)
      enterPhase(null)
      return
    }
    takeRef.current = { take, startFrame, sequenceId: onSequence, docId: doc }
    enterPhase({ phase: 'recording', elapsed: 0, level: 0 })
    if (take.fellBack) showToast({ kind: 'refused', text: 'The microphone chosen is not there, so the default one is recording.' })
    // Stopped before the microphone was asked for, so this starts playback
    // afresh, and the take hears where it started from.
    if (startFrame < total) setPlaying(true)
  }, [timeline, project, playhead, sequenceId, recordSettings.microphoneId, total, proj.docId, enterPhase])

  /**
   * Stop recording. Kept, the take is imported and lands on the first free
   * audio track at the frame where recording began, selected; thrown away,
   * it leaves no file.
   */
  const stopRecording = useCallback(
    async (keep: boolean) => {
      const now = takeRef.current
      if (!now || phase.current !== 'recording') return
      takeRef.current = null
      const { take, startFrame, sequenceId: onSequence } = now
      setPlaying(false)
      // Held until it is in place: an edit meanwhile would move the frame it goes to.
      enterPhase({ phase: 'saving' })
      try {
        if (!keep) {
          await take.cancel()
          return
        }
        const name = take.path.split(/[\\/]/).pop() ?? take.path
        let done
        try {
          done = await take.stop()
        } catch (err) {
          const why = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          showToast({ kind: 'refused', text: `The voice over could not be saved: ${why}.` })
          return
        }
        if (!done) return
        if (!done.asset) {
          showToast({ kind: 'refused', text: `The voice over is saved as ${name} in Voice overs, but not added: ${done.why ?? 'it did not import'}.` })
          return
        }
        const clipId = newId()
        const p = await proj.edit({ kind: 'addSource', mediaId: done.asset.id, clipId, at: startFrame, streams: [0], sequenceId: onSequence })
        // Selected, but the playhead is left at the end of the take, where it
        // was stopped, rather than thrown back to where the take began.
        if (findClip(timelineOf(p, onSequence), clipId)) select(clipId)
      } finally {
        enterPhase(null)
      }
    },
    [proj, select, enterPhase]
  )

  /** The latest stopRecording, for the timer and the effect below, which must not start again on every render. */
  const stopRef = useRef(stopRecording)
  stopRef.current = stopRecording

  // Another project opened, or a new one started, while a take records: the
  // take is kept on disk, beside the project it was recorded for, and not
  // put into the one now open.
  useEffect(() => {
    const now = takeRef.current
    if (now && now.docId !== proj.docId) void stopRef.current(true)
  }, [proj.docId])

  // The time and the level, as the take goes; and if a piece of it could not
  // be written, as when the disk is full, it stops there rather than going on
  // recording nothing.
  useEffect(() => {
    if (recording?.phase !== 'recording') return
    const timer = window.setInterval(() => {
      const take = takeRef.current?.take
      if (!take) return
      const failed = take.failure()
      if (failed) {
        showToast({ kind: 'refused', text: `The voice over could not be written: ${failed}. Recording stopped.` })
        void stopRef.current(true)
        return
      }
      setRecording((r) => (r?.phase === 'recording' ? { ...r, elapsed: take.elapsed(), level: take.level() } : r))
    }, 100)
    return () => window.clearInterval(timer)
  }, [recording?.phase])

  return { onClock, startRecording, stopRecording }
}
