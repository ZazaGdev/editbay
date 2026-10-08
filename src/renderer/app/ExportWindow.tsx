/**
 * The Export dialog, given the sequence on screen, every sequence of the
 * project, and how this project exports.
 */

import type { JSX } from 'react'
import { besidesV1, hasLayout, sequenceOf, timelineDuration, timelineOf, v1Clips, type Project, type Timeline as TimelineData } from '../../shared/project'
import { exportNames } from '../../shared/render-plan'
import { ExportDialog } from '../components/ExportDialog'
import type { AppState } from './app-state'

export function ExportWindow({ app, timeline, project }: { app: AppState; timeline: TimelineData; project: Project }): JSX.Element {
  const { exportAll, range, selectedSpan, saveTranscript, transcriptSaving, speech, sequenceId, exportFolder, exportMode, exportPattern,
    setExportFolder, setExportMode, setExportPattern, exportSubtitles, setExportSubtitles, exportTranscript, setExportTranscript, exportSharpen,
    setExportSharpen, exportFast, setExportFast, exportFileNames, setExportFileNames, exportPrefs, exportRun, setExportOpen, setExportAll } = app
  return (
    <ExportDialog
      startWithAll={exportAll}
      marked={range}
      selectedSpan={selectedSpan}
      onSaveTranscript={(range) => void saveTranscript(range ?? undefined)}
      transcriptSaving={transcriptSaving}
      speech={speech}
      timeline={timeline}
      sequenceId={sequenceOf(project, sequenceId).id}
      sequences={project.sequences.map((s) => {
        const t = timelineOf(project, s.id)
        return {
          id: s.id,
          name: s.name,
          presetId: s.presetId,
          frames: timelineDuration(t),
          besidesV1: besidesV1(t),
          hasLayers: v1Clips(t).some(hasLayout),
          hasCaptions: t.captions.clips.length > 0
        }
      })}
      fps={project.fps}
      folder={exportFolder}
      mode={exportMode}
      pattern={exportPattern}
      onFolder={setExportFolder}
      onMode={setExportMode}
      onPattern={setExportPattern}
      subtitleFile={exportSubtitles}
      onSubtitleFile={setExportSubtitles}
      transcriptFile={exportTranscript}
      onTranscriptFile={setExportTranscript}
      sharpen={exportSharpen}
      onSharpen={setExportSharpen}
      fast={exportFast}
      onFast={setExportFast}
      fileName={exportFileNames[sequenceOf(project, sequenceId).id] ?? null}
      defaultFileName={exportNames(project, sequenceOf(project, sequenceId).id).joined}
      onFileName={(name) => {
        const id = sequenceOf(project, sequenceId).id
        setExportFileNames(({ [id]: _was, ...rest }) => (name === null ? rest : { ...rest, [id]: name }))
      }}
      existing={exportPrefs.exportExisting}
      run={exportRun}
      onClose={() => {
        setExportOpen(false)
        setExportAll(false)
      }}
    />
  )
}
