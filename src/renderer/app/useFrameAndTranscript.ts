/**
 * Saving the frame at the playhead as an image, and the transcript as a text
 * file, in the folder exports go to.
 */

import { useCallback, useRef, useState } from 'react'
import { sequenceOf, timelineOf } from '../../shared/project'
import { showToast } from '../state/toasts'
import type { AppLocals, ExportSettings } from './app-state'

export function useFrameAndTranscript({
  project,
  sequenceId,
  playhead,
  speech,
  exportFolder,
  exportSharpen,
  exportFileNames
}: Pick<AppLocals, 'project' | 'sequenceId' | 'playhead' | 'speech'> & Pick<ExportSettings, 'exportFolder' | 'exportSharpen' | 'exportFileNames'>) {
  /**
   * The frame at the playhead as an image, a cover, in the folder
   * exports go to: exactly as the export draws it, text and captions and all.
   */
  const saveFrame = useCallback(async (): Promise<void> => {
    if (!project) return
    const outputDir = exportFolder ?? (await window.api.defaultExportFolder())
    // Sharpened as the video would be, when Sharpen is on for exports.
    const r = await window.api.saveFrame({ sequenceId: sequenceOf(project, sequenceId).id, frame: playhead, outputDir, ...(exportSharpen ? { sharpen: true } : {}) })
    if (r.ok && r.path) {
      const saved = r.path
      showToast({
        kind: 'frame',
        text: `Saved the frame as ${saved.split(/[\\/]/).pop()}.`,
        action: { label: 'Show in folder', run: () => void window.api.revealPath(saved) }
      })
    } else showToast({ kind: 'frame', text: r.error ?? 'The frame could not be saved.' })
  }, [project, exportFolder, sequenceId, playhead])

  /**
   * The transcript alone, as a text file in the folder exports go to: from
   * the captions at once when there are some, or listened to when there are
   * none, which takes a while, so it is shown and can be stopped.
   */
  const [transcriptSaving, setTranscriptSaving] = useState(false)
  // Set at once, not at the next render, so a second press never starts a second one.
  const savingTranscript = useRef(false)
  const { check: speechCheck, download: speechDownload } = speech
  const saveTranscript = useCallback(
    async (range?: { from: number; to: number }): Promise<void> => {
      if (!project || savingTranscript.current) return
      const id = sequenceOf(project, sequenceId).id
      const listens = timelineOf(project, id).captions.clips.length === 0
      if (listens && !(await speechCheck())) {
        showToast({
          kind: 'transcript',
          text: 'With no captions, the transcript listens to the speech, and the speech model it needs is not downloaded yet.',
          action: { label: 'Download it', run: () => void speechDownload() }
        })
        return
      }
      savingTranscript.current = true
      setTranscriptSaving(true)
      if (listens) {
        showToast({ kind: 'transcript', text: 'Listening to the speech for the transcript.', action: { label: 'Stop', run: () => void window.api.cancelExport() } })
      }
      try {
        const outputDir = exportFolder ?? (await window.api.defaultExportFolder())
        const fileName = exportFileNames[id]
        const r = await window.api.saveTranscript({ sequenceId: id, outputDir, ...(range ? { range } : {}), ...(fileName ? { fileName } : {}) })
        if (r.ok && r.path) {
          const saved = r.path
          showToast({
            kind: 'transcript',
            text: `Saved the transcript as ${saved.split(/[\\/]/).pop()}.`,
            action: { label: 'Show in folder', run: () => void window.api.revealPath(saved) }
          })
        } else if (!r.cancelled) showToast({ kind: 'transcript', text: r.error ?? 'The transcript could not be saved.' })
      } finally {
        savingTranscript.current = false
        setTranscriptSaving(false)
      }
    },
    [project, sequenceId, exportFolder, exportFileNames, speechCheck, speechDownload]
  )

  return { saveFrame, saveTranscript, transcriptSaving }
}
