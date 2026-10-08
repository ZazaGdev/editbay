/**
 * Making captions: listening for them, here rather than in the Captions
 * window so closing it leaves the listening running, and putting the words
 * heard on the caption track.
 */

import { useEffect, useRef } from 'react'
import { timelineOf } from '../../shared/project'
import type { Stretch, TimedWord } from '../../shared/captions'
import { showToast } from '../state/toasts'
import type { AppLocals } from './app-state'

export function useCaptionMaking({
  project,
  proj,
  phase,
  undo,
  captionsOpen,
  setCaptionsOpen,
  setCaptionsError,
  speech
}: Pick<AppLocals, 'project' | 'proj' | 'phase' | 'undo' | 'captionsOpen' | 'setCaptionsOpen' | 'setCaptionsError' | 'speech'>) {
  /**
   * The words heard, on the caption track of the sequence they were made for
   * in place of every caption there was, as one edit, so one undo takes them
   * all away again. `heardId` names the sequence as it was heard, so edits
   * made while it listened carry the words with their footage.
   */
  const madeCaptions = (words: TimedWord[], listenTo: string[], forSequence: string, heardId?: string, within?: Stretch[]): void => {
    if (!project) return
    // Never while a voice over records: everything that could change the sequence is held.
    // The words wait for it rather than being lost.
    if (phase.current !== null) {
      showToast({
        kind: 'captions-waiting',
        text: 'The captions are ready. Put them on once the voice over has stopped.',
        sticky: true,
        action: { label: 'Put them on', run: () => madeCaptionsNow.current(words, listenTo, forSequence, heardId, within) }
      })
      return
    }
    if (!project.sequences.some((q) => q.id === forSequence)) {
      showToast({ kind: 'captions', text: 'The captions were not put on: the sequence they were made for is gone.', sticky: true })
      return
    }
    const had = new Set(timelineOf(project, forSequence).captions.clips.map((c) => c.id))
    const done = proj.edit({
      kind: 'setCaptions',
      words,
      listenTo,
      sequenceId: forSequence,
      ...(heardId ? { heardId } : {}),
      ...(within && within.length > 0 ? { within } : {})
    })
    const at = proj.step()
    setCaptionsOpen(false)
    void done.then((p) => {
      const clips = timelineOf(p, forSequence).captions.clips
      // For part of the sequence, the captions it made; for all of it, every caption.
      const made = within && within.length > 0 ? clips.filter((c) => !had.has(c.id)).length : clips.length
      const said = made === 1 ? 'Made 1 caption' : `Made ${made} captions`
      if (proj.step() === at) showToast({ kind: 'captions', text: within && within.length > 0 ? `${said} for part of the sequence. The rest are as they were.` : `${said}.`, undo })
    })

  }
  /** The latest madeCaptions, for a listening that finishes renders after it began. */
  const madeCaptionsNow = useRef(madeCaptions)
  madeCaptionsNow.current = madeCaptions

  /**
   * Listen for captions, here rather than in the Captions window, so closing
   * the window leaves it running. What went wrong is kept for the window, and
   * said in a notice when the window is closed.
   */
  const listenForCaptions = async (forSequence: string, listenTo: string[], stretches?: Stretch[]): Promise<void> => {
    setCaptionsError(null)
    const result = await speech.transcribe(forSequence, listenTo, stretches)
    if (result.cancelled) return
    const trouble =
      !result.ok || !result.words
        ? { text: result.error ?? 'The captions could not be made.', ...(result.details ? { details: result.details } : {}) }
        : result.words.length === 0
          ? { text: 'No speech was heard on the tracks chosen.' }
          : null
    if (trouble) {
      setCaptionsError(trouble)
      if (!captionsOpenNow.current)
        showToast({ kind: 'captions', text: trouble.text, sticky: true, action: { label: 'Open', run: () => setCaptionsOpen(true) } })
      return
    }
    madeCaptionsNow.current(result.words!, listenTo, forSequence, result.heardId, stretches)
  }

  // The speech model finished downloading with the Captions window closed: say so, and offer the way back to it.
  const wasDownloading = useRef(false)
  const captionsOpenNow = useRef(captionsOpen)
  captionsOpenNow.current = captionsOpen
  useEffect(() => {
    if (speech.downloading) {
      wasDownloading.current = true
      return
    }
    if (!wasDownloading.current) return
    wasDownloading.current = false
    if (captionsOpenNow.current) return
    showToast(
      speech.ready
        ? {
            kind: 'speech',
            text: 'The speech model is downloaded.',
            sticky: true,
            action: { label: 'Make captions', run: () => phase.current === null && setCaptionsOpen(true) }
          }
        : { kind: 'speech', text: speech.downloadError ?? 'The speech model was not downloaded.', sticky: true }
    )
  }, [speech.downloading, speech.ready, speech.downloadError])

  return { listenForCaptions }
}
