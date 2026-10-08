/**
 * The timeline's panel: the painter's banner over it, Remove silences above
 * the tracks, and the timeline itself with its sequence tabs.
 */

import type { JSX } from 'react'
import { sequenceOf, trackCount, trackName, v1Clips } from '../../shared/project'
import { nextLayoutName } from '../../shared/saved-layouts'
import { heldTrackHeight, nextTrackSize } from '../../shared/timeline-layout'
import { showSection, sideOf } from '../../shared/section-layout'
import { MAIN_PICTURE } from '../../shared/project'
import { withKey } from '../../shared/keymap'
import { Icon } from '../ui/Icon'
import { Button } from '../ui/Button'
import { SilencePanel } from '../components/SilencePanel'
import { Timeline } from '../components/Timeline'
import { SequenceTabs } from '../components/SequenceTabs'
import { useSteady } from '../state/useSteady'
import { accent, ink, radius, space, surface } from '../theme'
import { banner, held, panel } from './styles'
import type { AppState } from './app-state'

export function TimelinePanel({ app }: { app: AppState }): JSX.Element {
  const { recording, painter, setPainter, silenceOpen, timeline, found, listen, setListenChoice, onSequence, silenceSettings, setWindowSettings,
    pauses, toCut, total, togglePause, setKeptPauses, foundKey, hearPause, removeSilences, closeSilences, project, playing, sequenceId,
    switchSequence, addSequence, duplicateSequence, proj, removeSequence, chooseShape, shapeSetups, pickSetup, saveSetup, savedLayouts, playhead,
    selectedIds, selectedAlone, gap, missingMedia, rebuildingMedia, revisions, peaks, toggleSelected, alsoSelected, leadSelection, select, selectMany,
    selectGap, selectedCaption, selectCaption, seek, setScrubbing, setMarkerMenu, selectedTransition, setSelectedTransition, setTransitionMenu,
    trackHeights, windowSettings, timelineRoom, timelineTracks, paintOnto, setTrackHeights, transitionDefaults, rememberTransition, renamingMarker,
    setRenamingMarker, editClip, zoom, zoomBy, zoomTo, addSource, putEffect, range, run, keys, solo, setClipMenu, setGapMenu, setLookingAt, setSolo,
    fitTimeline, trackSize, setTrackSize, picture, timelineShapes, addText, addBlackScreen } = app
  const timelineAddText = useSteady(() => void addText())
  const timelineAddBlackScreen = useSteady(() => void addBlackScreen())
  // A keyframe's diamond dragged on the timeline (notes 2, item 15): the same
  // edit as a drag in the Zoom group's strip.
  const moveKeyframe = useSteady((clipId: string, picture: string, from: number, to: number): void =>
    void editClip({ kind: 'moveZoomKey', clipId, from, to, ...(picture === MAIN_PICTURE ? {} : { picture }) })
  )
  // A press on a clip's effect mark (item 17): its section opened, even one
  // folded or ticked off by hand, since this press asks for it by name, and
  // brought into view once the Inspector shows the clip just selected.
  const openEffectSection = useSteady((section: string): void => {
    const layout = windowSettings.sections
    setWindowSettings({
      inspectorFolds: { ...windowSettings.inspectorFolds, [section]: false },
      dockFolds: { ...windowSettings.dockFolds, [section]: false },
      ...(layout.hidden.includes(section) && sideOf(layout, section) === null ? { sections: showSection(layout, section, true) } : {})
    })
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector(`[data-inspector-group][data-group="${section}"]`)?.scrollIntoView({ block: 'nearest' })
      )
    )
  })
  return (
    <div data-testid="timeline-panel" style={{ gridColumn: '1 / -1', ...panel, position: 'relative', overflowY: 'visible', ...(recording ? held : {}) }}>
      {/*
        Over the top of the timeline rather than above it: pushed in, it
        took height from the monitor and the Inspector, and the Paint
        button slid out from under the second click of a double click.
      */}
      {painter && (
        <div
          data-testid="painter-banner"
          data-painting={painter.how}
          role="status"
          style={{
            ...banner,
            position: 'absolute',
            zIndex: 6,
            top: space.sm,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100% - 32px)',
            padding: `${space.xs}px ${space.sm}px`,
            borderRadius: radius.chip,
            background: surface.raised,
            border: `1px solid ${accent.washLine}`,
            boxShadow: `inset 0 0 0 999px ${accent.wash}`,
            color: ink.primary
          }}
        >
          <Icon name="paint" />
          <span style={{ flex: 1 }}>
            {painter.how === 'sticky'
              ? 'Painting a framing: every picture clip you press takes it. Esc to stop.'
              : 'Painting a framing: the next picture clip you press takes it. Esc to stop.'}
          </span>
          <Button testid="painter-stop" size="small" onClick={() => setPainter(null)}>
            Stop
          </Button>
        </div>
      )}
      {silenceOpen && timeline && found && (
        <SilencePanel
          tracks={timeline.audioTracks.map((r, i) => ({
            id: r.id,
            label: `A${i + 1}`,
            title:
              [
                ...new Set(
                  r.clips.map((c) => {
                    const m = timeline.media.find((x) => x.id === c.mediaId)
                    const name = m?.originalPath.split(/[\\/]/).pop() ?? ''
                    return m && trackCount(m) > 1 ? `${name}, ${trackName(m, c.track)}` : name
                  })
                )
              ].join('; ') || 'Nothing on it'
          }))}
          listen={listen}
          onListen={(id, on) => {
            const ids = timeline.audioTracks.map((r) => r.id).filter((x) => (x === id ? on : listen.has(x)))
            setListenChoice({ sequenceId: onSequence, ids })
          }}
          settings={silenceSettings}
          onSettings={(change) => setWindowSettings({ silence: { ...silenceSettings, ...change } })}
          pauses={pauses ?? []}
          cutCount={toCut.length}
          cutFrames={toCut.reduce((sum, p) => sum + (p.to - p.from), 0)}
          total={total}
          fps={timeline.fps}
          waiting={found.waiting}
          onTogglePause={togglePause}
          onKeepAll={() => setKeptPauses({ found: foundKey, from: new Set((pauses ?? []).map((p) => p.from)) })}
          onTakeAll={() => setKeptPauses({ found: foundKey, from: new Set() })}
          onHear={hearPause}
          onRemove={removeSilences}
          onClose={closeSilences}
        />
      )}
      {project && timeline && (
        <Timeline
          timeline={timeline}
          playing={playing}
          header={
            <SequenceTabs
              sequences={project.sequences}
              activeId={sequenceOf(project, sequenceId).id}
              onSwitch={(id) => switchSequence(id)}
              onAdd={addSequence}
              onDuplicate={duplicateSequence}
              onRename={(id, name) => void proj.edit({ kind: 'renameSequence', sequenceId: id, name })}
              onRemove={removeSequence}
              presetId={timeline.presetId}
              onShape={chooseShape}
              setups={shapeSetups}
              onPickSetup={pickSetup}
              onSaveSetup={saveSetup}
              nextSetupName={nextLayoutName(savedLayouts)}
            />
          }
          playhead={playhead}
          selectedIds={selectedIds}
          selectedAlone={selectedAlone}
          selectedGap={gap}
          missingMedia={missingMedia}
          rebuildingMedia={rebuildingMedia}
          revisions={revisions}
          peaks={peaks}
          onSelect={(id, alone, add) =>
            add === true && id !== null
              ? toggleSelected(id, alone)
              : id !== null && alsoSelected.length > 0 && selectedIds.has(id)
                ? leadSelection(id)
                : select(id, alone)
          }
          onSelectMany={selectMany}
          onClickClip={(id) => {
            // A press kept the selection in case it became a drag. It was
            // a click, so it is this clip now, as a click always was.
            // The playhead and the view stay where they are.
            if (alsoSelected.length > 0) select(id, selectedAlone)
          }}
          onSelectGap={selectGap}
          selectedCaptionId={selectedCaption}
          onSelectCaption={selectCaption}
          onSeek={seek}
          onScrubPlayhead={setScrubbing}
          onMarkerMenu={(m, at) => setMarkerMenu({ markerId: m.id, at })}
          selectedTransition={selectedTransition}
          onSelectTransition={(at) => {
            // Clearing the clip selection first, so Delete has one thing
            // to act on rather than two. `select` clears the transition
            // too, which is why it comes first.
            if (at) select(null)
            setSelectedTransition(at)
          }}
          onTransitionMenu={(which, at) => setTransitionMenu({ ...which, at })}
          trackHeights={trackHeights}
          tracksHeight={windowSettings.timelineHeight}
          tracksRoom={timelineRoom}
          tracksBox={timelineTracks}
          onPaint={painter ? paintOnto : undefined}
          onEffectMark={painter ? undefined : openEffectSection}
          onKeyframeMove={moveKeyframe}
          onTrackHeight={(trackId, px) =>
            setTrackHeights((was) => {
              // Zero puts it back to the height its kind gets from the size control.
              if (px <= 0) {
                const { [trackId]: _was, ...rest } = was
                return rest
              }
              return { ...was, [trackId]: heldTrackHeight(px) }
            })
          }
          transitionFrames={Math.max(1, Math.round(transitionDefaults.seconds * timeline.fps))}
          transitionKinds={transitionDefaults}
          onTransitionFrames={(frames) => rememberTransition({ seconds: frames / timeline.fps })}
          renamingMarkerId={renamingMarker}
          onRenameDone={() => setRenamingMarker(null)}
          onEdit={editClip}
          zoom={zoom}
          onZoom={zoomBy}
          onZoomTo={zoomTo}
          onDropSource={(mediaId, trackId, frame, how) => addSource(mediaId, frame, trackId, how)}
          onDropEffect={(path, trackId, frame, how) => void putEffect(path, { trackId, frame, ...how })}
          range={range}
          onRemoveSilences={() => run('removeSilences')}
          canRemoveSilences={v1Clips(timeline).length > 0}
          removeSilencesTitle={withKey(
            'Remove silences: find the pauses in the talking and take them out',
            keys.keymap,
            'removeSilences'
          )}
          solo={solo}
          onClipMenu={(clipId, at) => setClipMenu({ clipId, at })}
          onGapMenu={(g, at) => setGapMenu({ gap: g, at })}
          onSkim={windowSettings.skim ? setLookingAt : undefined}
          onSolo={(trackId, on) =>
            setSolo((was) => {
              const next = new Set(was)
              if (on) next.add(trackId)
              else next.delete(trackId)
              return next
            })
          }
          onFit={fitTimeline}
          trackSize={trackSize}
          onTrackSize={() => setTrackSize(nextTrackSize(trackSize))}
          fitTitle={withKey('Fit the whole edit on screen', keys.keymap, 'fitTimeline')}
          addTrackTitles={{
            video: withKey('Add a video track, above the others', keys.keymap, 'addVideoTrack'),
            audio: withKey('Add an audio track, below the others', keys.keymap, 'addAudioTrack')
          }}
          overview={windowSettings.overview}
          picture={picture}
          showClipKeys={windowSettings.clipKeys}
          onOverview={(overview) => setWindowSettings({ overview })}
          snapping={windowSettings.snapping}
          onSnapping={(snapping) => setWindowSettings({ snapping })}
          onAddText={timelineAddText}
          shapes={timelineShapes}
          onAddBlackScreen={timelineAddBlackScreen}
          snapTitle={withKey(
            windowSettings.snapping ? 'Snapping is on: press to turn it off. Alt frees one drag.' : 'Snapping is off: press to turn it on',
            keys.keymap,
            'toggleSnapping'
          )}
          {...(pauses ? { pauses, onTogglePause: togglePause } : {})}
        />
      )}
    </div>
  )
}
