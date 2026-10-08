/**
 * The middle column under the recording being looked through: the monitor
 * and the transport bar below it.
 */

import type { JSX } from 'react'
import { allClips, findVideoClip, targetAspect, type Timeline as TimelineData } from '../../shared/project'
import { cropEdit } from '../../shared/zoom-edit'
import { boxKeysOf } from '../../shared/box-keys'
import { SourceStrip } from '../components/SourceStrip'
import { Monitor } from '../components/Monitor'
import { Transport } from '../components/Transport'
import { Welcome } from '../components/Welcome'
import { PLAYBACK_SPEEDS } from '../state/useSettings'
import type { AppState } from './app-state'

export function MonitorArea({ app, timeline }: { app: AppState; timeline: TimelineData }): JSX.Element {
  const { skimming, peaks, proj, setSkimming, addSource, frameSelected, framing, playhead, view, windowSettings, setView, aspectLocked, playing,
    picture, zoomEnd, aiming, aimAt, choosePicture, setWindowSettings, selected, lookingAt, captionMove, relocateHandPlaced, selectedCaption, select,
    setSelectedCaption, setCaptionMove, editClip, followEngine, onEnded, onClock, recording, recordSettings, soloList, monitorVolume, lighterCopies,
    voice, scrubbing, rate, loopRange, fullscreen, setFullscreen, assets, keys, status, importPaths, setTutorialsOpen, resized, blurBox, shapeDrawing,
    shapeDrawn, shapeLanded, shapeLine, textEdit, startTextEdit, setTextEdit, endTextEdit, setMonitorVolume, total, canPlay, phase, run, togglePlay, seek, level,
    changeRecordSettings, loopOn } = app
  return (
    <>
      {skimming !== null && timeline?.media.some((m) => m.id === skimming) && (
        <SourceStrip
          media={timeline.media.find((m) => m.id === skimming)!}
          fps={timeline.fps}
          peaks={peaks}
          onMark={(marks) => void proj.edit({ kind: 'setSourceMarks', mediaId: skimming, ...marks })}
          onAdd={(whole) => {
            setSkimming(null)
            addSource(skimming, undefined, undefined, whole ? { whole: true } : {})
          }}
          onClose={() => setSkimming(null)}
        />
      )}
      <Monitor
        onFraming={frameSelected}
        timeline={timeline}
        framing={framing ?? timeline}
        playhead={playhead}
        view={view}
        sideBySide={windowSettings.sideBySide}
        onView={setView}
        aspectLocked={aspectLocked}
        playing={playing}
        picture={picture}
        zoomEnd={zoomEnd}
        placeSnap={windowSettings.placeSnap}
        aiming={aiming !== null}
        aimPoint={aiming?.point ?? null}
        onAim={aimAt}
        onPicture={choosePicture}

        onPictureChosen={(id) => {
          choosePicture(id)
          // Choosing a picture on the view is usually the step before
          // cropping or placing it: its crop is brought into view. A Crop
          // folded by hand stays folded, as every hand fold does (F11).
          requestAnimationFrame(() =>
            document.querySelector('[data-inspector-group][data-group="Crop"]')?.scrollIntoView({ block: 'nearest' })
          )
        }}
        selectedClipId={selected}
        skim={playing ? null : lookingAt}
        captionMode={captionMove}
        relocateHandPlaced={relocateHandPlaced}
        onCaptionPress={(id) => {

          if (id === selectedCaption) return
          select(null)
          setSelectedCaption(id)
          setCaptionMove(null)
        }}
        onCaptionMoveOne={(id) => {
          // Always this one: from Relocate too, which it turns off.
          select(null)
          setSelectedCaption(id)
          setCaptionMove('one')
        }}
        onCaptionDrag={(at, continuing) => {
          if (captionMove === 'all') editClip({ kind: 'relocateCaptions', at, includeHand: relocateHandPlaced }, continuing)
          else if (captionMove === 'one' && selectedCaption) editClip({ kind: 'placeCaption', captionId: selectedCaption, at }, continuing)
        }}
        onPositionChange={followEngine}
        onEnded={onEnded}
        onClock={onClock}
        muted={recording !== null && recordSettings.muteWhileRecording}
        solo={soloList}
        monitorVolume={monitorVolume}
        proxies={lighterCopies}
        voice={voice}
        scrubbing={scrubbing}
        rate={recording !== null ? 1 : rate}
        loop={recording !== null ? null : loopRange}
        wallClock={recording !== null}
        guides={
          windowSettings.guides
            ? { thirds: windowSettings.thirds, safeZone: windowSettings.safeZone, cover: windowSettings.coverGuide }
            : null
        }
        fullscreen={fullscreen}
        onFullscreenChange={setFullscreen}
        welcome={
          // Nothing brought in and nothing made here: a text counts as a start.
          assets.length === 0 && !(timeline && allClips(timeline).length > 0) ? (
            // Held while a take records, as the rest of the window is.
            <div style={{ display: 'contents', pointerEvents: recording ? 'none' : undefined }}>
              <Welcome
                keymap={keys.keymap}
                name={status?.name ?? ''}
                onRename={(name) => void window.api.renameProject(name)}
                onAddFiles={() => void window.api.pickFiles().then(importPaths)}
                onOpenProject={() => proj.open()}
                onOpenRecent={(path) => proj.open(path)}
                onImport={(path) => importPaths([path])}
                onTutorials={() => setTutorialsOpen(true)}
              />
            </div>
          ) : undefined
        }
        noClips={
          assets.some((a) => a.status === 'ready')
            ? 'Drag a source onto the timeline, or press Add to timeline.'
            : assets.some((a) => a.status !== 'failed')
              ? 'Your files are being prepared. Put one on the timeline once it is ready.'
              : 'None of your files could be imported. The bin says why.'
        }
        onCropChange={(clipId, pic, rect, continuing) => {
          // A picture's box is its crop at the playhead: for a picture
          // that zooms, the keyframe there, made if there is none, and
          // for a Simple zoom its Start or End, whichever is chosen.
          const c = findVideoClip(framing ?? timeline, clipId)?.clip
          editClip(c ? cropEdit(c, playhead, rect, pic, zoomEnd) : { kind: 'setCrop', clipId, rect, picture: pic }, continuing)
        }}
        onPlaceChange={(clipId, pic, place, continuing, reshaped, fromCrop) => {
          // A box with keyframes is moved on the frame under the playhead, a
          // keyframe made there if there is none (plan 97).
          const keyed = findVideoClip(framing ?? timeline, clipId)?.clip
          if (keyed && (boxKeysOf(keyed, pic)?.length ?? 0) > 0) {
            void editClip({ kind: 'setBoxKey', clipId, at: keyed.sourceIn + playhead - keyed.timelineStart, place, picture: pic }, continuing)
            return
          }
          // A text's box moved or scaled by hand: drawn again at its new size once let go.
          resized.current = clipId
          void editClip(
            { kind: 'setPlace', clipId, picture: pic, place, reshapeCrop: aspectLocked && reshaped, fromCrop },
            continuing
          )
        }}
        onOutOfTheWay={(how) => run(how === 'fade' ? 'fadeOutOfTheWay' : 'moveOutOfTheWay')}
        onTurn={(clipId, degrees, continuing) => editClip({ kind: 'setOverlay', clipId, rotation: degrees }, continuing)}
        blurBox={blurBox}
        onBlurBoxes={(clipId, boxes, continuing) => void editClip({ kind: 'setBlurBoxes', clipId, boxes }, continuing)}
        shapeDraw={
          shapeDrawing
            ? {
                id: shapeDrawing.id,
                style: shapeDrawing.style,
                bent: shapeDrawing.bent,
                onDrawn: (a, b, path) => void shapeDrawn(a, b, path),
                landing: shapeDrawing.landing,
                onLanded: () => {
                  if (shapeDrawing.landing) shapeLanded(shapeDrawing.landing)
                }
              }
            : null
        }
        onShapeLine={shapeLine}
        onClipEdit={(e, continuing) => void editClip(e, continuing)}
        textEdit={textEdit}
        onTextEditStart={startTextEdit}
        onTextWords={(words) => setTextEdit((t) => (t ? { ...t, words } : t))}
        onTextEditEnd={endTextEdit}
      />
      <Transport
        monitorVolume={monitorVolume}
        onMonitorVolume={setMonitorVolume}
        playing={playing}
        playhead={playhead}
        total={total}
        fps={timeline.fps}
        view={view}
        canPlay={canPlay}
        onPlayPause={() => (phase.current !== null ? run('playPause') : togglePlay())}
        keymap={keys.keymap}
        onStep={(frames) => seek(playhead + frames)}
        onHome={() => seek(0)}
        onEnd={() => seek(total)}
        onSeek={seek}
        onView={setView}
        guides={{ guides: windowSettings.guides, thirds: windowSettings.thirds, safeZone: windowSettings.safeZone, coverGuide: windowSettings.coverGuide }}
        placeSnap={windowSettings.placeSnap}
        onPlaceSnap={(placeSnap) => setWindowSettings({ placeSnap })}
        onGuides={setWindowSettings}
        onFullscreen={() => setFullscreen(true)}
        recording={recording}
        onRecord={() => run('recordVoice')}
        sideBySide={windowSettings.sideBySide}
        canSideBySide={targetAspect(timeline) !== null && timeline.output.height > timeline.output.width}
        verticalFrame={timeline.output.height > timeline.output.width}
        onSideBySide={(sideBySide) => setWindowSettings({ sideBySide })}
        speed={windowSettings.speed}
        speeds={PLAYBACK_SPEEDS}
        onSpeed={(speed) => setWindowSettings({ speed })}
        rate={playing && recording === null ? rate : null}
        loop={loopOn}
        onLoop={() => run('toggleLoop')}
        level={level}
        record={recordSettings}
        onRecordSettings={changeRecordSettings}
      />
    </>
  )
}
