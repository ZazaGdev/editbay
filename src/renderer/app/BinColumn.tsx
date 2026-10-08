/**
 * The Source column, or its rail when folded away, with the divider beside
 * it, and the steady handlers the memoised bin is given.
 */

import { useMemo, type JSX } from 'react'
import { allClips } from '../../shared/project'
import { chapterMarkers } from '../../shared/markers'
import type { BackgroundColour } from '../../shared/looks'
import { SourceBin } from '../components/SourceBin'
import { Divider } from '../components/Divider'
import { Panel } from '../ui/Panel'
import { showToast } from '../state/toasts'
import { useSteady } from '../state/useSteady'
import type { BinView } from '../state/useSettings'
import { held, panel } from './styles'
import type { AppState } from './app-state'

export function BinColumn({ app }: { app: AppState }): JSX.Element {
  const { assets, fold, setWindowSettings, importPaths, addSource, selected, putEffect, timeline, editClip, binFolded, binColumn, recording, progress,
    convertingSince, revisions, usage, addedAt, windowSettings, proj, setSkimming, cancel, retry, removeSource, show } = app
  /*
   * What the bin and the Inspector are given, kept the same from one render to
   * the next. Neither shows anything that moves with the playhead, and both
   * are memoised, so they are drawn again only when one of these changes. A
   * handler written inline would be new on every render, which is every frame
   * of playback, and draw them again for nothing.
   */
  const binAssets = useMemo(() => assets.filter((a) => a.text === undefined && a.shape === undefined && a.colour === undefined), [assets])
  const binFold = useSteady(() => fold('binFolded')(true))
  const binView = useSteady((binView: BinView) => setWindowSettings({ binView }))
  const binPick = useSteady(() => void window.api.pickFiles().then(importPaths))
  const binAdd = useSteady((assetId: string) => addSource(assetId))
  // An effect over the selected clip, or the clip a selection of several leads with (plan 90).
  const binApplyEffect = useSteady((path: string, background?: BackgroundColour) => {
    if (selected) void putEffect(path, { clipId: selected }, background)
  })
  const binBringMarkers = useSteady((mediaId: string) => {
    if (!timeline) return
    const media = timeline.media.find((m) => m.id === mediaId)
    if (!media?.chapters?.length) return
    // Every clip of that recording, picture and sound alike. A picture
    // and its linked sound land on the same frame and one marker per
    // frame is the rule, so the pair gives one marker, not two.
    const clips = allClips(timeline).filter((c) => c.mediaId === mediaId)
    const markers = chapterMarkers(timeline.markers, media.chapters, clips, timeline.fps, media.startSec ?? 0)
    if (markers.length === timeline.markers.length) {
      showToast({ kind: 'note', text: 'Its markers are already on the timeline.' })
      return
    }
    editClip({ kind: 'setMarkers', markers })
  })
  return (
    <>
      {binFolded ? (
        <Panel name="Source" side="left" icon="picture" folded testid="bin-column" onFold={fold('binFolded')}>
          {null}
        </Panel>
      ) : (
      <div ref={binColumn} data-testid="bin-column" data-folded="no" style={{ ...panel, ...(recording ? held : {}) }}>
        <SourceBin
          onFold={binFold}
          // A text is not a file to bring in or find: it lives on the timeline.
          assets={binAssets}
          progress={progress}
          convertingSince={convertingSince}
          revisions={revisions}
          usage={usage}
          addedAt={addedAt}
          view={windowSettings.binView}
          onView={binView}
          rebuilding={proj.rebuildingMedia}
          onPick={binPick}
          onAdd={binAdd}
          onSkim={setSkimming}
          onBringMarkers={binBringMarkers}
          onCancel={cancel}
          onRetry={retry}
          onRemove={removeSource}
          onShow={show}
          onImport={importPaths}
          onApplyEffect={binApplyEffect}
          canApplyEffect={selected !== null}
        />
      </div>
      )}

      {binFolded ? (
        <span />
      ) : (
        <Divider
          testid="bin-divider"
          side="left"
          column={binColumn}
          size={windowSettings.binWidth}
          onSize={(binWidth) => setWindowSettings({ binWidth })}
        />
      )}
    </>
  )
}
