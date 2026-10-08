/**
 * The command handling: what each action of the keymap does, whichever key,
 * button, menu or search ran it.
 */

import {
  closeUpClipBlockers,
  closeUpStart,
  closingOn,
  cropOf,
  findClip,
  findVideoClip,
  framingOf,
  isDrawn,
  joinNeighbour,
  joinRefusal,
  newId,
  removeClipsRefusal,
  removedBetween,
  trimToFrameBlockers,
  v1Clips,
  MAIN_PICTURE,
  pipOf
} from '../../shared/project'
import { OUT_OF_THE_WAY_HOLD } from '../../shared/box-keys'
import { keyLabel, type ActionId } from '../../shared/keymap'
import { nextCut, previousCut } from '../../shared/cuts'
import { nextMarker, previousMarker } from '../../shared/markers'
import { captionEnd } from '../../shared/captions'
import { editedAt, nextAfterRemoved, trimToPlayhead, trimToPlayheadRefusal } from '../../shared/playback'
import { neighbourKey, shownCrop, sourceFrameAt, toggleKeyEdit } from '../../shared/zoom-edit'
import { copyClips } from '../../shared/clipboard'
import { groupRefusal } from '../../shared/groups'
import { MAX_AUDIO_TRACKS, MAX_VIDEO_TRACKS, spanEnd } from '../../shared/tracks'
import { showToast } from '../state/toasts'
import { guidesTurned } from '../state/useSettings'
import { inTheWay } from './edit-words'
import { isTextClip } from './clip-checks'
import type { AppState } from './app-state'

/**
 * What every action does. The keymap decides which key reaches which.
 * `shift` makes a nudge bigger; `key` is the key pressed, when one was, and
 * whether it is repeating as it is held.
 */
export function runAction(app: AppState, action: ActionId, shift = false, key?: { code: string; repeat: boolean }): void {
  const { timeline, phase, cancelStart, stopRecording, startRecording, togglePlay, seek, playheadSent, total, playhead, editClip,
    addTransitionAtPlayhead, kHeld, playing, rate, setRate, setPlaying, canPlay, setLoopOn, selectedCaption, selected, selectedAlone, marks, setMarks,
    removing, selectedTransition, setSelectedTransition, range, selectAfterRemoved, setSelectedCaption, gap, closeGap, selectedClips, setSilenceOpen,
    select, silenceOpen, closeSilences, captionMove, setCaptionMove, shapeDrawing, setShapeDrawing, proj, zoomBy, fitTimeline, setView,
    setWindowSettings, windowSettings, setFullscreen, nudge, framing, picture, copiedFraming, keys, applyFraming, zoomEnd, setCopiedCrop, copiedCrop,
    setClipboard, pasteAt, setJoinAsk, setShortcutsOpen, setTutorialsOpen, setSettingsOpen, setPaletteOpen, save, setExportOpen, setCaptionsOpen,
    addText, addBlackScreen, saveFrame, saveTranscript, setVersionsAsked } = app
  const fps = Math.round(timeline?.fps ?? 30)
  // While a take records, R or Space stops and keeps it, Esc throws it
  // away, and nothing else happens. While the microphone opens, any of
  // the three means never mind; while it is saved, nothing happens.
  if (phase.current !== null) {
    const stops = action === 'recordVoice' || action === 'playPause' || action === 'deselect'
    if (phase.current === 'starting' && stops) cancelStart.current = true
    if (phase.current === 'recording' && stops) void stopRecording(action !== 'deselect')
    return
  }
  const step = shift ? 20 : 2
  switch (action) {
    case 'recordVoice':
      void startRecording()
      break
    case 'playPause':
      togglePlay()
      break
    case 'stepBack':
      seek(playheadSent.current - 1)
      break
    case 'stepForward':
      seek(playheadSent.current + 1)
      break
    case 'jumpBack':
      seek(playheadSent.current - fps)
      break
    case 'jumpForward':
      seek(playheadSent.current + fps)
      break
    case 'goToStart':
      seek(0)
      break
    case 'goToEnd':
      seek(total)
      break
    case 'previousCut':
      if (timeline) seek(previousCut(timeline, playhead))
      break
    case 'nextCut':
      if (timeline) seek(nextCut(timeline, playhead))
      break
    case 'previousMarker': {
      const to = timeline ? previousMarker(timeline.markers, playhead) : null
      if (to) seek(to.frame)
      break
    }
    case 'nextMarker': {
      const to = timeline ? nextMarker(timeline.markers, playhead) : null
      if (to) seek(to.frame)
      break
    }
    case 'addVideoTrack':
    case 'addAudioTrack': {
      if (!timeline) break
      const video = action === 'addVideoTrack'
      if (video ? timeline.videoTracks.length >= MAX_VIDEO_TRACKS : timeline.audioTracks.length >= MAX_AUDIO_TRACKS) {
        showToast({ kind: 'track', text: video ? `A sequence has at most ${MAX_VIDEO_TRACKS} video tracks.` : `A sequence has at most ${MAX_AUDIO_TRACKS} audio tracks.` })
        break
      }
      editClip({ kind: 'addTrack', trackKind: video ? 'video' : 'audio', trackId: newId() })
      break
    }
    case 'addMarker':
      // While playing too: the whole point is marking a moment as it goes by.
      if (timeline) editClip({ kind: 'addMarker', frame: playhead })
      break
    case 'addPictureTransition':
      addTransitionAtPlayhead('picture')
      break
    case 'addSoundTransition':
      addTransitionAtPlayhead('sound')
      break
    case 'shuttleForward': {
      if (kHeld.current) {
        seek(playhead + 1)
        break
      }
      // Held down, it is one press: faster each time it is pressed again, not while it is held.
      if (key?.repeat) break
      // Up to 3x: Chromium silences sound above 4x, and a player eased around 4 goes over it.
      const faster = [1, 1.5, 2, 3]
      if (playing && rate > 0) setRate(faster.find((r) => r > rate + 1e-9) ?? 3)
      else {
        setRate(1)
        setPlaying(canPlay)
      }
      break
    }
    case 'shuttleBack': {
      if (kHeld.current) {
        seek(playhead - 1)
        break
      }
      if (key?.repeat) break
      const faster = [1, 2, 4]
      if (playing && rate < 0) setRate(-(faster.find((r) => r > -rate + 1e-9) ?? 4))
      else {
        setRate(-1)
        setPlaying(playhead > 0)
      }
      break
    }
    case 'shuttleStop':
      if (key) kHeld.current = key.code
      setPlaying(false)
      break
    case 'toggleLoop':
      setLoopOn((on) => !on)
      break
    case 'split':
      // A caption selected is cut at the playhead, the words either side going to each piece,
      // when the playhead is inside it; otherwise S cuts the clip there, as it does for a clip selected elsewhere.
      {
        const c = selectedCaption ? timeline?.captions.clips.find((x) => x.id === selectedCaption) : undefined
        if (c && playhead > c.timelineStart && playhead < captionEnd(c)) {
          editClip({ kind: 'splitCaption', captionId: c.id, frame: playhead })
          break
        }
      }
      // The selected clip when it is under the playhead, otherwise the one on the lowest video track there.
      editClip({ kind: 'split', frame: playhead, ...(selected ? { clipId: selected } : {}), ...(selectedAlone ? { alone: true } : {}) })
      break
    case 'splitAll':
      // Held down it is one press, as Delete is: every repeat would push
      // an undo step that cuts nothing, and a hundred of them throw the
      // history away.
      if (key?.repeat || !timeline) break
      editClip({ kind: 'splitAll', frame: playhead })
      break
    case 'markIn':
      // Held down it is one mark, not a step of undo for every repeat.
      // In at or after Out is no range at all, so Out goes with it.
      if (!key?.repeat && playhead !== marks.in) setMarks({ in: playhead })
      break
    case 'markOut': {
      // One frame past the playhead, so the frame you are looking at is in the range.
      const out = Math.min(total, playhead + 1)
      if (!key?.repeat && out !== marks.out) setMarks({ out })
      break
    }
    case 'clearMarks':
      if (marks.in !== null || marks.out !== null) setMarks({ in: null, out: null })
      break
    case 'trimStartToPlayhead': {
      if (!timeline) break
      const edit = trimToPlayhead(timeline, playhead, 'start', selected, selectedAlone)
      if (!edit || edit.kind !== 'trimToFrame') {
        showToast({ kind: 'refused', text: trimToPlayheadRefusal(timeline, playhead, 'start') })
        break
      }
      const blockers = trimToFrameBlockers(timeline, edit.clipId, edit.edge, edit.frame, edit.alone === true)
      if (blockers.length > 0) {
        showToast({ kind: 'refused', text: `This trim cannot close up: ${inTheWay(timeline, blockers)}.` })
        break
      }
      const target = findClip(timeline, edit.clipId)
      const closes = closingOn(timeline, edit.clipId, edit.alone === true) ?? (edit.alone === true ? null : target?.clip)
      editClip(edit)
      // Closed up, the clip still starts where it did, and now begins with
      // the frame you were looking at, so park the playhead on it.
      // Trimmed alone, its start has come to the playhead.
      if (closes) seek(closes.timelineStart)
      break
    }
    case 'trimEndToPlayhead': {
      if (!timeline) break
      const edit = trimToPlayhead(timeline, playhead, 'end', selected, selectedAlone)
      if (!edit) {
        showToast({ kind: 'refused', text: trimToPlayheadRefusal(timeline, playhead, 'end') })
        break
      }
      if (edit.kind === 'trimToFrame') {
        const blockers = trimToFrameBlockers(timeline, edit.clipId, edit.edge, edit.frame, edit.alone === true)
        if (blockers.length > 0) {
          showToast({ kind: 'refused', text: `This trim cannot close up: ${inTheWay(timeline, blockers)}.` })
          break
        }
      }
      editClip(edit)
      break
    }
    case 'deleteClip':
      // Held down it is one press: a repeat would walk down the track,
      // taking a row of clips and a hundred undo steps with it.
      if (key?.repeat || removing.current) break
      if (selectedTransition) {
        // What is picked out is what Delete takes. Without this the press
        // falls through to whatever clip was selected before the
        // transition was, and takes a whole clip away instead.
        editClip({ kind: 'removeTransition', ...selectedTransition })
        setSelectedTransition(null)
      } else if (range) {
        // A marked range takes Delete, whatever is selected: the shading
        // says so. The marks go with it, so the next press is ordinary,
        // and what was selected goes too, since the range may have taken
        // it away. Through `selectAfterRemoved`, so a second press while
        // this one is still on its way to main is ignored.
        selectAfterRemoved(editClip({ kind: 'removeRange', from: range.from, to: range.to }), null, false)
        seek(range.from)
      } else if (selectedCaption) {
        editClip({ kind: 'removeCaption', captionId: selectedCaption })
        setSelectedCaption(null)
      } else if (gap) closeGap(gap)
      else if (selectedClips.length > 1) {
        // Several at once, as one edit and one undo step. Nothing is left
        // selected: stepping on to the next clip means nothing for a row.
        const all = { kind: 'removeClips' as const, clipIds: selectedClips, ...(selectedAlone ? { alone: true } : {}) }
        selectAfterRemoved(editClip(all), null, false)
      } else if (selectedClips.length === 1) {
        // The one clip still there, which a Remove silences under the
        // selection may have left as the only one of several.
        const only = selectedClips[0]!
        // Worked out before the edit: Delete pressed again then takes the next clip.
        // Not for a text: the next text on its track is often far off, and
        // selecting it pulled the playhead there. Deleting a text leaves the
        // playhead where it is, with nothing selected.
        const next = timeline && !isTextClip(timeline, only) ? nextAfterRemoved(timeline, only, selectedAlone) : null
        const done = editClip({ kind: 'removeClip', clipId: only, ...(selectedAlone ? { alone: true } : {}) })
        selectAfterRemoved(done, next, selectedAlone)
      }
      break
    case 'closeUp':
      if (key?.repeat || removing.current) break
      if (selectedTransition) {
        // Nothing of the sequence closes up for a transition: taking one
        // off puts the hard cut back and moves nothing.
        editClip({ kind: 'removeTransition', ...selectedTransition })
        setSelectedTransition(null)
      } else if (range) {
        // Cutting every track at both edges leaves nothing running across
        // the range, so this can never push a clip out of step.
        selectAfterRemoved(editClip({ kind: 'removeRange', from: range.from, to: range.to, closeUp: true }), null, false)
        seek(range.from)
      } else if (selectedCaption) {
        // A caption is only taken away: nothing of the sequence closes up for one.
        editClip({ kind: 'removeCaption', captionId: selectedCaption })
        setSelectedCaption(null)
      } else if (gap) closeGap(gap)
      else if (selectedClips.length > 1) {
        // Closing up takes one stretch out of the sequence, so several
        // clips can only come out that way when they cover one between
        // them, and when nothing would be left out of step.
        const refusal = timeline ? removeClipsRefusal(timeline, selectedClips) : null
        if (timeline && refusal) {
          showToast({
            kind: 'refused',
            text:
              refusal.why === 'apart'
                ? 'Only clips that follow one another can be removed closing up. Delete takes these away leaving gaps.'
                : `These cannot be removed closing up: ${inTheWay(timeline, refusal.clips)}. Delete leaves gaps instead.`
          })
          break
        }
        // The playhead goes to the join, where the first of them began:
        // everything after has slid up under the time it was on.
        const join = timeline ? closeUpStart(timeline, selectedClips) : null
        selectAfterRemoved(editClip({ kind: 'removeClips', clipIds: selectedClips, closeUp: true }), null, false, join)
        if (join !== null) seek(join)
      } else if (selectedClips.length === 1) {
        const only = selectedClips[0]!
        const blockers = timeline ? closeUpClipBlockers(timeline, only) : []
        if (timeline && blockers.length > 0) {
          showToast({ kind: 'refused', text: `This cannot be removed closing up: ${inTheWay(timeline, blockers)}. Delete leaves a gap instead.` })
          break
        }
        // Closing up always takes the whole group, so what is left is selected as a group too.
        const next = timeline ? nextAfterRemoved(timeline, only) : null
        const join = timeline ? closeUpStart(timeline, [only]) : null
        selectAfterRemoved(editClip({ kind: 'closeUpClip', clipId: only }), next, false, join)
        if (join !== null) seek(join)
      }
      break
    case 'removeSilences':
      if (timeline && v1Clips(timeline).length > 0) setSilenceOpen(true)
      break
    case 'selectNextClip':
    case 'selectPreviousClip': {
      if (!timeline) break
      // On the selected clip's track; with none selected, the first track with a clip, from the playhead.
      const found = selected ? findClip(timeline, selected) : null
      const track = found ? found.track : [...timeline.videoTracks, ...timeline.audioTracks].find((r) => r.clips.length > 0)
      if (!track) break
      const clips = [...(track.clips as { id: string; timelineStart: number }[])].sort((a, b) => a.timelineStart - b.timelineStart)
      const here = found ? clips.findIndex((c) => c.id === found.clip.id) : -1
      const next =
        action === 'selectNextClip'
          ? here >= 0
            ? clips[here + 1]
            : clips.find((c) => c.timelineStart >= playheadSent.current)
          : here >= 0
            ? clips[here - 1]
            : [...clips].reverse().find((c) => c.timelineStart < playheadSent.current)
      if (!next) break
      select(next.id)
      seek(next.timelineStart)
      break
    }
    case 'deselect':
      // Esc closes Remove silences first, leaving the selection as it was,
      // and ends moving a caption the same way, keeping it selected.
      if (silenceOpen) closeSilences()
      else if (captionMove) setCaptionMove(null)
      else if (shapeDrawing) setShapeDrawing(null)
      else select(null)
      break
    case 'undo':
      proj.undo()
      break
    case 'redo':
      proj.redo()
      break
    case 'zoomIn':
      zoomBy(1)
      break
    case 'zoomOut':
      zoomBy(-1)
      break
    case 'fitTimeline':
      fitTimeline()
      break
    case 'toggleView':
      setView((v) => (v === 'source' ? 'program' : 'source'))
      break
    case 'toggleGuides':
      setWindowSettings(guidesTurned(windowSettings, !windowSettings.guides))
      break
    case 'toggleSnapping':
      setWindowSettings({ snapping: !windowSettings.snapping })
      showToast({ kind: 'snapping', text: windowSettings.snapping ? 'Snapping is off.' : 'Snapping is on.' })
      break
    case 'fullscreen':
      setFullscreen((f) => !f)
      break
    case 'nudgeLeft':
      nudge(-step, 0)
      break
    case 'nudgeRight':
      nudge(step, 0)
      break
    case 'nudgeUp':
      nudge(0, -step)
      break
    case 'nudgeDown':
      nudge(0, step)
      break
    case 'toggleZoomKey': {
      const at = framing ? editedAt(framing, playhead, selected) : null
      const edit = at && !isDrawn(at.media) ? toggleKeyEdit(at.clip, playhead, picture) : null
      if (edit) editClip(edit)
      else showToast({ kind: 'refused', text: 'Put the playhead on a picture clip to pin its zoom there.' })
      break
    }
    case 'moveOutOfTheWay':
    case 'fadeOutOfTheWay': {
      // Plan 97: over the marked range, or a second and a half from the playhead.
      const at = framing ? editedAt(framing, playhead, selected) : null
      const pip = at && framing ? pipOf(framing, at.clip.id) : null
      if (!at || !pip) {
        showToast({ kind: 'refused', text: 'Select a clip with a picture in picture, with the playhead on it, to move its box out of the way.' })
        break
      }
      const c = at.clip
      const from = range ? range.from : playhead
      const to = range ? range.to - 1 : playhead + Math.round(OUT_OF_THE_WAY_HOLD * framing!.fps)
      const onRecording = (f: number): number => c.sourceIn + f - c.timelineStart
      const how = action === 'fadeOutOfTheWay' ? 'fade' : 'slide'
      editClip({ kind: 'moveOutOfTheWay', clipId: c.id, from: onRecording(from), to: onRecording(to), how, ...(pip.picture === MAIN_PICTURE ? {} : { picture: pip.picture }) })
      showToast({ kind: 'out-of-the-way', text: how === 'fade' ? 'The box fades out and back in.' : 'The box slides to a free corner and back.' })
      break
    }
    case 'previousZoomKey':
    case 'nextZoomKey': {
      const at = framing ? editedAt(framing, playhead, selected) : null
      const to = at ? neighbourKey(at.clip, playhead, action === 'previousZoomKey' ? 'previous' : 'next', picture) : null
      if (to !== null) seek(to)
      break
    }
    case 'copyFraming': {
      const framing = timeline && selected ? framingOf(timeline, selected) : null
      if (!framing) {
        showToast({ kind: 'framing', text: 'Select a picture clip to copy its framing.' })
        break
      }
      copiedFraming.current = framing
      showToast({
        kind: 'framing',
        text: `Copied this clip's framing. Select another clip and press ${keyLabel(keys.keymap, 'pasteFraming') || 'Paste framing'} to paste it there.`
      })
      break
    }
    case 'pasteFraming': {
      const framing = copiedFraming.current
      if (!framing) {
        showToast({ kind: 'framing', text: "Nothing to paste yet: copy a clip's framing first." })
        break
      }
      applyFraming(framing, 'Select a picture clip to paste the framing onto.')
      break
    }
    case 'copyCrop': {
      const chosen = timeline && selected ? findVideoClip(timeline, selected)?.clip : undefined
      const found = timeline && selected ? cropOf(timeline, selected, picture, chosen ? sourceFrameAt(chosen, playhead) : undefined) : null
      // The picture's crop as the Crop section shows it: a Simple zoom's chosen end, or the playhead's.
      const crop = found && chosen ? { ...found, crop: shownCrop(chosen, playhead, picture, zoomEnd) } : found
      if (!crop) {
        showToast({ kind: 'crop', text: 'Select a picture clip to copy its crop.' })
        break
      }
      setCopiedCrop(crop)
      showToast({ kind: 'crop', text: `Copied the crop, ${crop.crop.w} by ${crop.crop.h}. Select other clips and paste it onto them.` })
      break
    }
    case 'pasteCrop': {
      if (!copiedCrop) {
        showToast({ kind: 'crop', text: "Nothing to paste yet: copy a clip's crop first." })
        break
      }
      // Onto the picture chosen, by position: Picture 2 chosen pastes onto
      // each clip's Picture 2, and a clip without one is left out.
      const chosen = timeline && selected ? findVideoClip(timeline, selected)?.clip : undefined
      const slot = chosen ? chosen.layers.findIndex((l) => l.id === picture) + 1 : 0
      const onto = timeline
        ? selectedClips.filter((id) => cropOf(timeline, id) !== null && (slot === 0 || findVideoClip(timeline, id)?.clip.layers[slot - 1] !== undefined))
        : []
      if (onto.length === 0) {
        showToast({ kind: 'crop', text: slot === 0 ? 'Select a picture clip to paste the crop onto.' : `Select a clip with a Picture ${slot + 1} to paste the crop onto.` })
        break
      }
      // One edit for all of them, so one undo puts them all back.
      editClip({ kind: 'setCropOn', clipIds: onto, crop: copiedCrop, ...(slot > 0 ? { slot } : {}) })
      break
    }
    case 'copyClips':
    case 'cutClips': {
      const copied = timeline && selectedClips.length > 0 ? copyClips(timeline, selectedClips, selectedAlone) : null
      if (!copied) {
        showToast({ kind: 'paste', text: `Select a clip to ${action === 'cutClips' ? 'cut' : 'copy'} it.` })
        break
      }
      setClipboard(copied)
      if (action === 'copyClips') {
        showToast({ kind: 'paste', text: `Copied ${copied.clips.length === 1 ? 'a clip' : `${copied.clips.length} clips`}. Move the playhead and paste with ${keyLabel(keys.keymap, 'pasteClips') || 'Paste'}.` })
        break
      }
      // Cut: taken away as Delete takes them, leaving a gap, in a step of its own.
      if (removing.current) break
      selectAfterRemoved(
        editClip({ kind: 'removeClips', clipIds: selectedClips, ...(selectedAlone ? { alone: true } : {}) }),
        null,
        false
      )
      break
    }
    case 'pasteClips':
      void pasteAt(playhead)
      break
    case 'groupClips': {
      if (!timeline) break
      const why = groupRefusal(timeline, selectedClips)
      if (why) {
        showToast({ kind: 'refused', text: why })
        break
      }
      void editClip({ kind: 'groupClips', clipIds: selectedClips, groupId: newId() })
      break
    }
    case 'ungroupClips': {
      if (!timeline) break
      if (!selectedClips.some((id) => findClip(timeline, id)?.clip.group !== undefined)) {
        showToast({ kind: 'refused', text: 'Nothing selected is a group of clips.' })
        break
      }
      void editClip({ kind: 'ungroupClips', clipIds: selectedClips })
      break
    }
    case 'joinClips': {
      if (!timeline) break
      const alone = selectedAlone
      const refused = (text: string): void => showToast({ kind: 'refused', text })
      if (selectedClips.length > 1) {
        // Every cut between two of them that can be joined, as one edit.
        const cuts = selectedClips.flatMap((id) => {
          const next = joinNeighbour(timeline, id, 'next')
          return next !== null && selectedClips.includes(next) ? [[id, next] as const] : []
        })
        const why = cuts.map(([a, b]) => joinRefusal(timeline, a, b, alone, true))
        const back = cuts.reduce((n, [a, b]) => n + (joinRefusal(timeline, a, b, alone, true) === null ? removedBetween(timeline, a, b) : 0), 0)
        if (cuts.length === 0) refused('None of these sit right next to each other on one track, so there is no cut between them to join.')
        else if (why.every((w) => w !== null)) refused(why[0]!)
        else if (back > 0) setJoinAsk({ clipIds: selectedClips, frames: back, alone, select: null })
        else editClip({ kind: 'joinClips', clipIds: selectedClips, ...(alone ? { alone: true } : {}) })
        break
      }
      // One clip: the cut at its edge nearest the playhead. None: the cut on V1 nearest it.
      let pair: [string, string] | null = null
      const only = selectedClips[0]
      const found = only ? findClip(timeline, only) : null
      if (found) {
        const c = found.clip
        const prev = joinNeighbour(timeline, c.id, 'previous')
        const next = joinNeighbour(timeline, c.id, 'next')
        const nearStart = Math.abs(playhead - c.timelineStart) <= Math.abs(playhead - spanEnd(c))
        const before: [string, string] | null = prev ? [prev, c.id] : null
        const after: [string, string] | null = next ? [c.id, next] : null
        pair = nearStart ? (before ?? after) : (after ?? before)
      } else {
        let best = Infinity
        for (const c of v1Clips(timeline)) {
          const next = joinNeighbour(timeline, c.id, 'next')
          const away = Math.abs(spanEnd(c) - playhead)
          if (next && away < best) {
            best = away
            pair = [c.id, next]
          }
        }
      }
      if (!pair) {
        refused('There is no cut here to join: the clip has nothing right next to it.')
        break
      }
      const why = joinRefusal(timeline, pair[0], pair[1], alone && found !== null, true)
      if (why) {
        refused(why)
        break
      }
      const back = removedBetween(timeline, pair[0], pair[1])
      if (back > 0) {
        setJoinAsk({ clipIds: pair, frames: back, alone: alone && found !== null, select: found && found.clip.id === pair[1] ? pair[0] : null })
        break
      }
      void editClip({ kind: 'joinClips', clipIds: pair, ...(alone && found !== null ? { alone: true } : {}) })
      // The joined clip is the first piece: selected, if the second one was.
      if (found && found.clip.id === pair[1]) select(pair[0], alone)
      break
    }
    case 'searchSources':
      // The Sources panel brought back first if it was folded away, then its search.
      setWindowSettings({ binFolded: false })
      window.setTimeout(() => {
        const box = document.querySelector('[data-testid="sources-search"]') as HTMLInputElement | null
        box?.focus()
        box?.select()
      }, 0)
      break
    case 'showShortcuts':
      setShortcutsOpen(true)
      break
    case 'showTutorials':
      setTutorialsOpen(true)
      break
    case 'showSettings':
      setSettingsOpen(true)
      break
    case 'commandPalette':
      setPaletteOpen(true)
      break
    case 'newProject':
      proj.newProject()
      break
    case 'openProject':
      proj.open()
      break
    case 'save':
      save(false)
      break
    case 'saveAs':
      save(true)
      break
    case 'export':
      setExportOpen(true)
      break
    case 'makeCaptions':
      setCaptionsOpen(true)
      break
    case 'addText':
      void addText()
      break
    case 'addBlackScreen':
      void addBlackScreen()
      break
    case 'saveFrame':
      void saveFrame()
      break
    case 'saveTranscript':
      void saveTranscript()
      break
    case 'earlierVersions':
      setVersionsAsked((n) => n + 1)
      break
  }
}
