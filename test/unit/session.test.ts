import { describe, it, expect } from 'vitest'
import { applyEditTo, mediaFromAsset } from '../../src/main/project/session'
import * as session from '../../src/main/project/session'
import { defaultWorkspace } from '../../src/shared/workspace'
import {
  createProject,
  findSoundClip,
  findVideoClip,
  framingOf,
  linkedIds,
  timelineDuration,
  type Project
} from '../../src/shared/project'
import { spanEnd } from '../../src/shared/tracks'
import type { ClipEdit, MediaAsset, ProjectEdit } from '../../src/shared/types'
import { S1, clipsOf, soundsOf, firstTimeline, addClipTo } from '../project-helpers'

function asset(id: string, durationSec: number): MediaAsset {
  return {
    id,
    originalPath: `C:\\v\\${id}.mov`,
    playablePath: `C:\\c\\${id}\\conformed.mp4`,
    conformed: true,
    conformReasons: ['variable-frame-rate'],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'hevc',
    hasAudio: true,
    peaksPath: `C:\\c\\${id}\\peaks.bin`,
    filmstripPath: `C:\\c\\${id}\\filmstrip.jpg`,
    status: 'ready'
  }
}

function withClip(): Project {
  const p = createProject('t', 30, { width: 1080, height: 1920 })
  return addClipTo({ ...p, media: [mediaFromAsset(asset('a', 10))] }, 'a')
}

/** A clip edit for the first sequence. */
function edit(e: ClipEdit): ProjectEdit {
  return { ...e, sequenceId: S1 }
}

/** Where a clip is, on whatever track: its start, and its stretch of the recording. */
function at(p: Project, clipId: string): [number, number, number] {
  const t = firstTimeline(p)
  const c = findVideoClip(t, clipId)?.clip ?? findSoundClip(t, clipId)?.clip
  if (!c) throw new Error(`no clip ${clipId}`)
  return [c.timelineStart, c.sourceIn, c.sourceOut]
}

describe('mediaFromAsset', () => {
  it('keeps everything the timeline needs', () => {
    const m = mediaFromAsset(asset('a', 10))
    expect(m.id).toBe('a')
    expect(m.playablePath).toBe('C:\\c\\a\\conformed.mp4')
    expect(m.durationSec).toBe(10)
    expect(m.peaksPath).toContain('peaks.bin')
  })

  it('drops the transient status, which belongs to the import and not the project', () => {
    expect('status' in mediaFromAsset(asset('a', 10))).toBe(false)
  })
})

describe('applyEditTo', () => {
  /**
   * Something for every edit to change: V1 holding x from 0 to 300 and y from
   * 400 to 700, both of `a`, y laid out as Split with its main picture moved
   * and its sound at 200% and a transition on its head; z of
   * the two stream recording `b` from 800, its streams on A1 and a new track;
   * and an empty audio track.
   */
  function rich(): Project {
    const p = createProject('t', 30, { width: 1080, height: 1920 })
    const b = { ...mediaFromAsset(asset('b', 10)), audioTracks: 2, trackFiles: [{ path: 'C:\\c\\b\\track-2.m4a', peaksPath: 'C:\\c\\b\\track-2.bin' }] }
    // A picture, for the edits only an overlay takes.
    const pic = { ...mediaFromAsset(asset('pic', 10)), still: true, hasAudio: false }
    let next: Project = { ...p, media: [mediaFromAsset(asset('a', 10)), b, pic] }
    const steps: ClipEdit[] = [
      { kind: 'addSource', mediaId: 'a', clipId: 'x' },
      // A zoom on x, in from its frame 30 to 60, for the keyframe edits to change.
      { kind: 'setZoomKeys', clipId: 'x', keys: [{ at: 30, crop: { x: 0, y: 0, w: 540, h: 960 } }, { at: 60, crop: { x: 20, y: 20, w: 486, h: 864 } }] },
      { kind: 'addSource', mediaId: 'a', clipId: 'y', at: 400, onTrack: 'v1' },
      { kind: 'setClipAudio', clipId: 'y.1', gain: 2, muted: false },
      { kind: 'applyLayout', clipId: 'y', layout: 'split' },
      // Its main picture from the top left corner, so its two pictures show different things.
      { kind: 'setCrop', clipId: 'y', rect: { x: 0, y: 0, w: 480, h: 270 } },
      // A box keyframe on y's main picture, for the edit that takes them off (plan 97).
      { kind: 'setBoxKey', clipId: 'y', at: 10, place: { x: 0, y: 0, w: 1, h: 0.5 } },
      { kind: 'addSource', mediaId: 'b', clipId: 'z', at: 800, onTrack: 'v1' },
      // A Simple zoom on z, for the edit that makes it keyframes.
      { kind: 'setSimpleZoom', clipId: 'z', change: { end: { x: 100, y: 100, w: 800, h: 450 } } },
      { kind: 'addTrack', trackKind: 'audio', trackId: 'empty' },
      { kind: 'addSource', mediaId: 'pic', clipId: 'w', at: 1200, onTrack: 'v1' },
      // One caption, "one two three", over 10 to 48.
      { kind: 'setCaptions', words: [{ text: 'one', start: 10, length: 8 }, { text: 'two', start: 20, length: 8 }, { text: 'three', start: 40, length: 8 }], listenTo: [] },
      { kind: 'addMarker', frame: 120 },
      // A transition to change, so the edits that only ever change one that is
      // already there have something to act on.
      { kind: 'addTransition', clipId: 'y', side: 'in', length: 30 },
      // Two pieces of `a` that carry straight on from one another, for a join:
      // j1 plays 0 to 150 at 2000, j2 150 to 300 right after it.
      { kind: 'addSource', mediaId: 'a', clipId: 'j1', at: 2000, onTrack: 'v1' },
      { kind: 'setClipOut', clipId: 'j1', frame: 150 },
      { kind: 'addSource', mediaId: 'a', clipId: 'j2', at: 2400, onTrack: 'v1' },
      { kind: 'setClipIn', clipId: 'j2', frame: 150 },
      { kind: 'moveClip', clipId: 'j2', trackId: 'v1', start: 2150 },
      // A clip laid out as Picture in picture, for the edits that change its small picture.
      { kind: 'addSource', mediaId: 'a', clipId: 'pp', at: 3000, onTrack: 'v1' },
      { kind: 'applyLayout', clipId: 'pp', layout: 'pip' },
      // Two neighbours grouped into one clip, for Ungroup.
      { kind: 'addSource', mediaId: 'a', clipId: 'g1', at: 5000, onTrack: 'v1' },
      { kind: 'setClipOut', clipId: 'g1', frame: 150 },
      { kind: 'addSource', mediaId: 'a', clipId: 'g2', at: 5400, onTrack: 'v1' },
      { kind: 'moveClip', clipId: 'g2', trackId: 'v1', start: 5150 },
      { kind: 'groupClips', clipIds: ['g1', 'g2'], groupId: 'g' }
    ]
    for (const s of steps) next = applyEditTo(next, edit(s))
    return next
  }

  it('routes every edit kind to something that changes the document', () => {
    const p = rich()
    const t = firstTimeline(p)
    const yLayer = findVideoClip(t, 'y')!.clip.layers[0]!.id
    const caption = t.captions.clips[0]!.id
    const marker = t.markers[0]!.id
    // One of each kind, and the compiler says when a kind is missing here.
    const edits: { [K in ClipEdit['kind']]: Extract<ClipEdit, { kind: K }> } = {
      addSource: { kind: 'addSource', mediaId: 'a', clipId: 'n' },
      removeClip: { kind: 'removeClip', clipId: 'x' },
      closeUpClip: { kind: 'closeUpClip', clipId: 'x' },
      removeClips: { kind: 'removeClips', clipIds: ['x', 'y'] },
      closeUpGap: { kind: 'closeUpGap', gap: { trackId: 'v1', from: 300, to: 400 } },
      removeStretches: { kind: 'removeStretches', stretches: [{ from: 100, to: 130 }] },
      moveClip: { kind: 'moveClip', clipId: 'x', trackId: 'v1', start: 10 },
      setClipIn: { kind: 'setClipIn', clipId: 'x', frame: 30 },
      setClipOut: { kind: 'setClipOut', clipId: 'x', frame: 200 },
      split: { kind: 'split', frame: 100 },
      splitAll: { kind: 'splitAll', frame: 100 },
      setTrackMuted: { kind: 'setTrackMuted', trackId: 'a1', muted: true },
      setTrackDuck: { kind: 'setTrackDuck', trackId: 'a1', duck: true },
      setFade: { kind: 'setFade', clipId: 'z.2', side: 'in', length: 10 },
      setClipDenoise: { kind: 'setClipDenoise', clipId: 'z.2', on: true },
      setClipVoice: { kind: 'setClipVoice', clipId: 'z.2', voice: 'normal' },
      setTrackLocked: { kind: 'setTrackLocked', trackId: 'a1', locked: true },
      setTrackName: { kind: 'setTrackName', trackId: 'a1', name: 'Mic' },
      setTrackHidden: { kind: 'setTrackHidden', trackId: 'v1', hidden: true },
      setClipMark: { kind: 'setClipMark', clipId: 'x', mark: 'red' },
      addTransition: { kind: 'addTransition', clipId: 'y', side: 'out', length: 45 },
      setTransition: { kind: 'setTransition', clipId: 'y', side: 'in', length: 20, before: 10 },
      setTransitionKind: { kind: 'setTransitionKind', clipId: 'y', side: 'in', transitionKind: 'toBlack' },
      removeTransition: { kind: 'removeTransition', clipId: 'y', side: 'in' },
      removeRange: { kind: 'removeRange', from: 100, to: 130 },
      trimToFrame: { kind: 'trimToFrame', clipId: 'x', edge: 'end', frame: 100 },
      unlink: { kind: 'unlink', clipId: 'x' },
      link: { kind: 'link', clipIds: ['x', 'y'] },
      addTrack: { kind: 'addTrack', trackKind: 'video', trackId: 'V2' },
      removeTrack: { kind: 'removeTrack', trackId: 'empty' },
      setCrop: { kind: 'setCrop', clipId: 'x', rect: { x: 0, y: 0, w: 1080, h: 1080 } },
      setZoomKey: { kind: 'setZoomKey', clipId: 'x', at: 90, crop: { x: 100, y: 0, w: 540, h: 960 } },
      removeZoomKey: { kind: 'removeZoomKey', clipId: 'x', at: 60 },
      moveZoomKey: { kind: 'moveZoomKey', clipId: 'x', from: 60, to: 70 },
      setZoomEase: { kind: 'setZoomEase', clipId: 'x', at: 30, ease: 'linear' },
      setZoomKeys: { kind: 'setZoomKeys', clipId: 'x', keys: [{ at: 10, crop: { x: 0, y: 0, w: 540, h: 960 } }] },
      clearZoomKeys: { kind: 'clearZoomKeys', clipId: 'x' },
      setBoxKey: { kind: 'setBoxKey', clipId: 'x', at: 30, place: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } },
      moveOutOfTheWay: { kind: 'moveOutOfTheWay', clipId: 'x', from: 30, to: 90, how: 'slide' },
      clearBoxKeys: { kind: 'clearBoxKeys', clipId: 'y' },
      setSimpleZoom: { kind: 'setSimpleZoom', clipId: 'y', change: { end: { x: 100, y: 100, w: 240, h: 136 } } },
      useKeyframes: { kind: 'useKeyframes', clipId: 'z' },
      useSimpleZoom: { kind: 'useSimpleZoom', clipId: 'x' },
      zoomPreset: { kind: 'zoomPreset', clipId: 'x', preset: 'punch', from: 150, to: 150 },
      setLook: { kind: 'setLook', clipId: 'x', look: 'mono' },
      setRemoveBackground: { kind: 'setRemoveBackground', clipId: 'x', removal: { colour: 'green' } },
      setLookStrength: { kind: 'setLookStrength', clipId: 'x', strength: 40 },
      setColourAdjust: { kind: 'setColourAdjust', clipId: 'x', change: { warmth: 30 } },
      setBlur: { kind: 'setBlur', clipId: 'x', amount: 40 },
      setBlurBoxes: { kind: 'setBlurBoxes', clipId: 'x', boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1, amount: 50 }] },
      setPictureStyle: { kind: 'setPictureStyle', clipId: 'y', picture: yLayer, style: { radius: 12 } },
      setBlurFill: { kind: 'setBlurFill', clipId: 'x', on: true },
      setOverlay: { kind: 'setOverlay', clipId: 'w', rotation: 90, opacity: 0.5 },
      setAppear: { kind: 'setAppear', clipId: 'w', side: 'in', appear: { kind: 'pop', length: 15 } },
      setFraming: { kind: 'setFraming', clipId: 'x', framing: framingOf(t, 'y')! },
      setFramingOn: { kind: 'setFramingOn', clipIds: ['x', 'y'], framing: framingOf(t, 'y')! },
      joinClips: { kind: 'joinClips', clipIds: ['j1', 'j2'] },
      groupClips: { kind: 'groupClips', clipIds: ['j1', 'j2'], groupId: 'h' },
      ungroupClips: { kind: 'ungroupClips', clipIds: ['g1'] },
      onSelected: { kind: 'onSelected', edit: { kind: 'setCrop', clipId: 'x', rect: { x: 10, y: 10, w: 200, h: 356 } }, also: ['y'] },
      setPip: { kind: 'setPip', clipId: 'pp', change: { corner: 'bl' } },
      setCropOn: { kind: 'setCropOn', clipIds: ['x'], crop: { crop: { x: 100, y: 50, w: 400, h: 300 }, width: 1920, height: 1080 } },
      setCropsOn: { kind: 'setCropsOn', crops: [{ clipId: 'x', crop: { x: 100, y: 50, w: 400, h: 300 } }] },
      setPlace: { kind: 'setPlace', clipId: 'x', picture: 'main', place: { x: 0, y: 0, w: 0.5, h: 0.5 }, reshapeCrop: false },
      addLayer: { kind: 'addLayer', clipId: 'x', layerId: 'L1' },
      removeLayer: { kind: 'removeLayer', clipId: 'y', layerId: yLayer },
      applyLayout: { kind: 'applyLayout', clipId: 'x', layout: 'pip' },
      swapPictures: { kind: 'swapPictures', clipId: 'y' },
      applyLayoutToSource: { kind: 'applyLayoutToSource', clipId: 'x' },
      setClipAudio: { kind: 'setClipAudio', clipId: 'x.1', gain: 0.5, muted: true },
      applySoundToSource: { kind: 'applySoundToSource', clipId: 'x' },
      setShape: { kind: 'setShape', presetId: 'square' },
      setSoundTrack: { kind: 'setSoundTrack', clipId: 'z.2', track: 0 },
      setCaptions: { kind: 'setCaptions', words: [{ text: 'hello', start: 0, length: 10 }], listenTo: [] },
      moveCaption: { kind: 'moveCaption', captionId: caption, start: 100 },
      trimCaption: { kind: 'trimCaption', captionId: caption, edge: 'end', frame: 60 },
      splitCaption: { kind: 'splitCaption', captionId: caption, frame: 25 },
      removeCaption: { kind: 'removeCaption', captionId: caption },
      setCaptionWords: { kind: 'setCaptionWords', captionId: caption, text: 'one too three' },
      setCaptionStyle: { kind: 'setCaptionStyle', style: { wordsPerCaption: 1 } },
      placeCaption: { kind: 'placeCaption', captionId: caption, at: { x: 0.3, y: 0.2 } },
      relocateCaptions: { kind: 'relocateCaptions', at: { x: 0.4, y: 0.3 }, includeHand: true },
      regroupCaptions: { kind: 'regroupCaptions' },
      addMarker: { kind: 'addMarker', frame: 90 },
      moveMarker: { kind: 'moveMarker', markerId: marker, frame: 240 },
      renameMarker: { kind: 'renameMarker', markerId: marker, name: 'the good bit' },
      colourMarker: { kind: 'colourMarker', markerId: marker, colour: 'amber' },
      removeMarker: { kind: 'removeMarker', markerId: marker },
      setMarkers: { kind: 'setMarkers', markers: [{ id: 'fresh', frame: 450, name: 'brought in' }] },
      setSequenceMarks: { kind: 'setSequenceMarks', in: 30, out: 90 }
    }
    for (const e of Object.values(edits)) {
      expect(JSON.stringify(applyEditTo(p, edit(e))), `edit ${e.kind} did nothing`).not.toBe(JSON.stringify(p))
    }
  })

  it('moves a clip and its sound in time, leaving a gap where it was', () => {
    let p = withClip()
    p = applyEditTo(p, edit({ kind: 'addSource', mediaId: 'a', clipId: 'second' }))
    const first = clipsOf(p)[0]!.id
    const moved = applyEditTo(p, edit({ kind: 'moveClip', clipId: first, trackId: 'v1', start: 600 }))
    expect(clipsOf(moved)[1]?.id).toBe(first)
    expect(clipsOf(moved).map((c) => [c.id, c.timelineStart])).toEqual([
      ['second', 300],
      [first, 600]
    ])
    expect(soundsOf(moved).map((c) => [c.id, c.timelineStart])).toEqual([
      ['second.1', 300],
      [`${first}.1`, 600]
    ])
  })

  it('marks a range as an edit, and takes the marks away with the range Delete removes, in the same step', () => {
    let p = withClip()
    p = applyEditTo(p, edit({ kind: 'setSequenceMarks', in: 60, out: 120 }))
    expect(firstTimeline(p).marks).toEqual({ in: 60, out: 120 })
    // Out at or before In is no range, so Out goes.
    expect(firstTimeline(applyEditTo(p, edit({ kind: 'setSequenceMarks', in: 120, out: 60 }))).marks).toEqual({ in: 120 })
    expect(applyEditTo(p, edit({ kind: 'setSequenceMarks', in: 60, out: 120 }))).toEqual(p)
    expect(firstTimeline(applyEditTo(p, edit({ kind: 'setSequenceMarks', in: null, out: null }))).marks).toBeUndefined()
    // One end at a time, against the document as it is: In then Out, sent before
    // the window has heard back from the first, still marks both.
    let quick = applyEditTo(withClip(), edit({ kind: 'setSequenceMarks', in: 30 }))
    quick = applyEditTo(quick, edit({ kind: 'setSequenceMarks', out: 90 }))
    expect(firstTimeline(quick).marks).toEqual({ in: 30, out: 90 })
    // An end set past the other takes the other away.
    expect(firstTimeline(applyEditTo(quick, edit({ kind: 'setSequenceMarks', in: 120 }))).marks).toEqual({ in: 120 })
    expect(firstTimeline(applyEditTo(quick, edit({ kind: 'setSequenceMarks', out: 20 }))).marks).toEqual({ out: 20 })
    for (const closeUp of [false, true]) {
      const removed = applyEditTo(p, edit({ kind: 'removeRange', from: 60, to: 120, closeUp }))
      expect(firstTimeline(removed).marks).toBeUndefined()
    }
  })

  it('never mutates the document it was handed', () => {
    const p = withClip()
    const snapshot = JSON.stringify(p)
    applyEditTo(p, edit({ kind: 'setClipIn', clipId: clipsOf(p)[0]!.id, frame: 50 }))
    applyEditTo(p, edit({ kind: 'split', frame: 100 }))
    applyEditTo(p, edit({ kind: 'moveClip', clipId: clipsOf(p)[0]!.id, trackId: 'v1', start: 90 }))
    expect(JSON.stringify(p)).toBe(snapshot)
  })

  it('leaves the timeline consistent after a chain of edits', () => {
    let p = withClip()
    p = applyEditTo(p, edit({ kind: 'addSource', mediaId: 'a', clipId: 'b' }))
    p = applyEditTo(p, edit({ kind: 'split', frame: 100 }))
    // A head trim leaves a gap before the clip; closing up the piece after it pulls the rest left.
    p = applyEditTo(p, edit({ kind: 'setClipIn', clipId: clipsOf(p)[0]!.id, frame: 20 }))
    p = applyEditTo(p, edit({ kind: 'closeUpClip', clipId: clipsOf(p)[1]!.id }))

    expect(clipsOf(p).map((c) => [c.timelineStart, spanEnd(c)])).toEqual([
      [20, 100],
      [100, 400]
    ])
    const t = firstTimeline(p)
    // Every picture's sound is on the same frames as it, and nothing overlaps on any track.
    for (const c of clipsOf(p)) {
      const sounds = linkedIds(t, c.id).filter((id) => id !== c.id)
      expect(sounds).toHaveLength(1)
      expect(at(p, sounds[0]!)).toEqual(at(p, c.id))
    }
    for (const track of [...t.videoTracks, ...t.audioTracks]) {
      const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
      for (let i = 1; i < clips.length; i++) expect(clips[i]!.timelineStart).toBeGreaterThanOrEqual(spanEnd(clips[i - 1]!))
    }
    expect(timelineDuration(t)).toBe(400)
  })
})

describe('the tracks through the session', () => {
  /** V1 holding two 10 second clips with their sound on A1, and a 20 second song on A2 starting 5 seconds into the second. */
  function withSong(): Project {
    const p = createProject('t', 30, { width: 1080, height: 1920 })
    const song = { ...mediaFromAsset(asset('song', 20)), hasVideo: false }
    let next = addClipTo(addClipTo({ ...p, media: [mediaFromAsset(asset('a', 10)), song] }, 'a'), 'a')
    next = applyEditTo(next, edit({ kind: 'addTrack', trackKind: 'audio', trackId: 'A2' }))
    next = applyEditTo(next, edit({ kind: 'addSource', mediaId: 'song', clipId: 'vo', at: 450, onTrack: 'A2' }))
    return next
  }
  const voStart = (p: Project): number => findSoundClip(firstTimeline(p), 'vo')!.clip.timelineStart

  it('routes every track edit to something that changes the document', () => {
    const p = withSong()
    expect(voStart(p)).toBe(450)
    const edits: ClipEdit[] = [
      { kind: 'addTrack', trackKind: 'audio', trackId: 'A3' },
      { kind: 'moveClip', clipId: 'vo', trackId: 'A2', start: 10 },
      { kind: 'setClipIn', clipId: 'vo', frame: 30 },
      { kind: 'setClipOut', clipId: 'vo', frame: 100 },
      { kind: 'split', frame: 500, clipId: 'vo' },
      { kind: 'setClipAudio', clipId: 'vo', gain: 2, muted: false },
      { kind: 'removeClip', clipId: 'vo' }
    ]
    for (const e of edits) {
      expect(JSON.stringify(applyEditTo(p, edit(e))), `edit ${e.kind} did nothing`).not.toBe(JSON.stringify(p))
    }
    const emptyTrack = applyEditTo(p, edit({ kind: 'addTrack', trackKind: 'audio', trackId: 'A3' }))
    expect(firstTimeline(emptyTrack).audioTracks).toHaveLength(3)
    expect(firstTimeline(applyEditTo(emptyTrack, edit({ kind: 'removeTrack', trackId: 'A3' }))).audioTracks).toHaveLength(2)
  })

  /**
   * A 10 second recording on V1 trimmed to its first 200 frames, its sound on
   * A1 with it, and a one second beep on A1 at 250: the sound's tail can go
   * no further than 250, though the picture's could go to 300.
   */
  function linkedBeforeABeep(): Project {
    const p = createProject('t', 30, { width: 1080, height: 1920 })
    const beep = { ...mediaFromAsset(asset('beep', 1)), hasVideo: false }
    let next: Project = { ...p, media: [mediaFromAsset(asset('a', 10)), beep] }
    next = applyEditTo(next, edit({ kind: 'addSource', mediaId: 'a', clipId: 'x' }))
    next = applyEditTo(next, edit({ kind: 'setClipOut', clipId: 'x', frame: 200 }))
    next = applyEditTo(next, edit({ kind: 'addSource', mediaId: 'beep', clipId: 'beep', at: 250, onTrack: 'a1' }))
    return next
  }

  it('lands a linked trim dragged out past a limit and back where one edit straight there would, in one undo step', () => {
    const before = linkedBeforeABeep()
    expect(linkedIds(firstTimeline(before), 'x')).toEqual(['x', 'x.1'])
    session.adoptDocument(before, 'D:\\p\\linked.editbay', defaultWorkspace(), true)

    // Out past the beep: the picture and its sound stop there together.
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'x', frame: 290 }))
    expect(at(session.getProject(), 'x')).toEqual([0, 0, 250])
    expect(at(session.getProject(), 'x.1')).toEqual([0, 0, 250])

    // And back, in the same drag.
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'x', frame: 230 }), true)
    const straight = applyEditTo(before, edit({ kind: 'setClipOut', clipId: 'x', frame: 230 }))
    expect(JSON.stringify(session.getProject())).toBe(JSON.stringify(straight))
    expect(at(session.getProject(), 'x')).toEqual([0, 0, 230])
    expect(at(session.getProject(), 'x.1')).toEqual([0, 0, 230])
    expect(at(session.getProject(), 'beep')).toEqual([250, 0, 30])

    // Back to where it began: exactly the document before the drag.
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'x', frame: 200 }), true)
    expect(JSON.stringify(session.getProject())).toBe(JSON.stringify(applyEditTo(before, edit({ kind: 'setClipOut', clipId: 'x', frame: 200 }))))
    expect(firstTimeline(session.getProject())).toEqual(firstTimeline(before))

    // One undo, to the document before the drag's first movement, puts all of it back.
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'x', frame: 240 }), true)
    expect(session.isChanged()).toBe(true)
    session.setProject(before)
    expect(session.getProject()).toEqual(before)
    expect(session.isChanged()).toBe(false)
  })

  /** V1 holding x from 0 to 300 and y from 300 to 600, each with its sound on A1. */
  function twoLinked(): Project {
    const p = createProject('t', 30, { width: 1080, height: 1920 })
    let next: Project = { ...p, media: [mediaFromAsset(asset('a', 10))] }
    next = applyEditTo(next, edit({ kind: 'addSource', mediaId: 'a', clipId: 'x' }))
    next = applyEditTo(next, edit({ kind: 'addSource', mediaId: 'a', clipId: 'y' }))
    return next
  }

  it('puts back what a clip dragged over another covered, when the same drag takes it away again', () => {
    const before = twoLinked()
    session.adoptDocument(before, null, defaultWorkspace(), true)
    // Over most of y, which is covered, picture and sound alike.
    session.applyEdit(edit({ kind: 'moveClip', clipId: 'x', trackId: 'v1', start: 350 }))
    expect(at(session.getProject(), 'y')).toEqual([300, 0, 50])
    expect(at(session.getProject(), 'y.1')).toEqual([300, 0, 50])
    // And back where it began, in the same drag.
    session.applyEdit(edit({ kind: 'moveClip', clipId: 'x', trackId: 'v1', start: 0 }), true)
    expect(firstTimeline(session.getProject())).toEqual(firstTimeline(before))
  })

  it('works a drag out movement by movement when it is not marked as one, which is what the drag rule is for', () => {
    session.adoptDocument(twoLinked(), null, defaultWorkspace(), true)
    session.applyEdit(edit({ kind: 'moveClip', clipId: 'x', trackId: 'v1', start: 350 }))
    session.applyEdit(edit({ kind: 'moveClip', clipId: 'x', trackId: 'v1', start: 0 }))
    // What x covered on the way stays lost.
    expect(at(session.getProject(), 'x')).toEqual([0, 0, 300])
    expect(at(session.getProject(), 'y')).toEqual([300, 0, 50])
    expect(at(session.getProject(), 'y.1')).toEqual([300, 0, 50])
  })

  it('starts each drag from the document the drag before it left', () => {
    session.adoptDocument(twoLinked(), null, defaultWorkspace(), true)
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'y', frame: 250 }))
    session.applyEdit(edit({ kind: 'setClipOut', clipId: 'y', frame: 200 }), true)
    // A second drag, of x this time.
    session.applyEdit(edit({ kind: 'setClipIn', clipId: 'x', frame: 30 }))
    session.applyEdit(edit({ kind: 'setClipIn', clipId: 'x', frame: 60 }), true)
    expect(at(session.getProject(), 'y')).toEqual([300, 0, 200])
    expect(at(session.getProject(), 'x')).toEqual([60, 60, 300])
  })

  it('leaves a drag of a sound clip of its own where one edit straight there would', () => {
    session.adoptDocument(withSong(), null, defaultWorkspace(), true)
    session.applyEdit(edit({ kind: 'setClipIn', clipId: 'vo', frame: 30 }))
    session.applyEdit(edit({ kind: 'setClipIn', clipId: 'vo', frame: 60 }), true)
    expect(voStart(session.getProject())).toBe(510)
  })
})

describe('changing the shape through the session', () => {
  it('routes setShape and reshapes the crops', () => {
    const p = applyEditTo(withClip(), { sequenceId: S1, kind: 'setShape', presetId: 'square' })
    expect(firstTimeline(p).presetId).toBe('square')
    const crop = clipsOf(p)[0]!.transform.crop
    expect(crop.w / crop.h).toBeCloseTo(1, 1)
  })
})

describe('whether the project has unsaved changes', () => {
  it('is false for a new project', () => {
    session.resetProject()
    expect(session.isChanged()).toBe(false)
  })

  it('is true after an edit, and false again once it is undone', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    const before = session.getProject()
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    session.markSaved('D:\\p\\demo.editbay', session.getProject(), defaultWorkspace())
    const saved = session.getProject()
    expect(session.isChanged()).toBe(false)

    session.applyEdit({ sequenceId: S1, kind: 'setClipIn', clipId: clipsOf(saved)[0]!.id, frame: 30 })
    expect(session.isChanged()).toBe(true)
    session.setProject(saved)
    expect(session.isChanged()).toBe(false)
    expect(clipsOf(before)).toHaveLength(0)
  })

  it('never counts where you are in the project', () => {
    session.resetProject()
    session.setWorkspace({
      ...defaultWorkspace(),
      timelines: { [S1]: { playhead: 90, selectedClipId: null, zoom: 2, view: 'program', trackHeights: {} } }
    })
    expect(session.isChanged()).toBe(false)
  })

  it('counts an edit that arrived while the file was being written', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    const written = session.getProject()
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    session.markSaved('D:\\p\\demo.editbay', written, defaultWorkspace())
    expect(session.isChanged()).toBe(true)
  })

  it('is true for a document that matches nothing on disk, such as a restored copy', () => {
    session.adoptDocument(createProject('x', 30, { width: 1080, height: 1920 }), 'D:\\p\\x.editbay', defaultWorkspace(), false)
    expect(session.isChanged()).toBe(true)
  })
})

// Named from Windows paths, which only Windows' path rules read (plan 104).
describe.runIf(process.platform === 'win32')('the project name', () => {
  it('takes the name of what was written, not of the file it went to', () => {
    session.resetProject()
    expect(session.projectName()).toBe('Untitled')
    // Choosing a file names the project after it, and the caller is what
    // decides that: `saveNow` does it only when a file was picked in that call.
    const path = 'D:\\trips\\holiday.editbay'
    session.markSaved(path, { ...session.getProject(), name: session.nameFromPath(path) }, defaultWorkspace())
    expect(session.projectName()).toBe('holiday')
    expect(session.getProject().name).toBe('holiday')
    expect(session.getProjectPath()).toBe(path)
  })

  it('keeps a name given in the top bar when the same file is saved again', () => {
    session.resetProject()
    const path = 'D:\\trips\\holiday.editbay'
    session.markSaved(path, { ...session.getProject(), name: 'holiday' }, defaultWorkspace())

    session.renameProject('Holiday cut')
    expect(session.projectName()).toBe('Holiday cut')
    // A name is part of what gets written, so giving one is unsaved work.
    expect(session.isChanged()).toBe(true)

    // A plain save writes the document as it stands, name and all. It used to
    // rename it after its file every time, which undid this.
    session.markSaved(path, session.getProject(), defaultWorkspace())
    expect(session.projectName()).toBe('Holiday cut')
    expect(session.isChanged()).toBe(false)
  })

  it('is not put back to Untitled by undoing past the first save', () => {
    session.resetProject()
    const untitled = session.getProject()
    session.markSaved('D:\\trips\\holiday.editbay', { ...untitled, name: 'holiday' }, defaultWorkspace())
    session.setProject(untitled)
    expect(session.getProject().name).toBe('holiday')
    expect(session.isChanged()).toBe(false)
  })

  it('comes from the file for a project that was never named', () => {
    expect(session.nameOnOpen('Untitled', 'D:\\trips\\holiday.EDITBAY')).toBe('holiday')
    expect(session.nameOnOpen('', 'D:\\trips\\holiday.editbay')).toBe('holiday')
  })

  it('leaves a name alone when it carries no project extension', () => {
    expect(session.nameOnOpen('Untitled', 'D:\\trips\\holiday.clipper')).toBe('holiday.clipper')
  })

  it('is kept when the project had one, even if the file was renamed', () => {
    expect(session.nameOnOpen('holiday', 'D:\\trips\\holiday copy.editbay')).toBe('holiday')
  })
})

describe('the workspace in the session', () => {
  it('counts as changed only against what was last written', () => {
    session.adoptDocument(createProject('x', 30, { width: 1080, height: 1920 }), 'D:\\p\\x.editbay', defaultWorkspace(), true)
    expect(session.isWorkspaceChanged()).toBe(false)
    session.setWorkspace({ ...defaultWorkspace(), aspectLocked: false })
    expect(session.isWorkspaceChanged()).toBe(true)
    session.markSaved('D:\\p\\x.editbay', session.getProject(), session.getWorkspace())
    expect(session.isWorkspaceChanged()).toBe(false)
  })

  it('has nothing on disk to match for a project that was never saved', () => {
    session.resetProject()
    expect(session.isWorkspaceChanged()).toBe(true)
  })
})

describe('which document is open', () => {
  it('changes each time a whole document replaces the last', () => {
    const first = session.getDocId()
    session.resetProject()
    const second = session.getDocId()
    session.adoptDocument(createProject('x', 30, { width: 1080, height: 1920 }), null, defaultWorkspace(), true)
    expect(second).not.toBe(first)
    expect(session.getDocId()).not.toBe(second)
  })

  it('does not change for an edit', () => {
    session.resetProject()
    const id = session.getDocId()
    session.addAsset(asset('a', 10))
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    expect(session.getDocId()).toBe(id)
  })
})

describe('undo and the sources', () => {
  it('keeps a relinked source pointing at its new file when an earlier snapshot comes back', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    const beforeTrim = session.getProject()
    session.applyEdit({ sequenceId: S1, kind: 'setClipIn', clipId: clipsOf(beforeTrim)[0]!.id, frame: 30 })

    const moved = { ...session.getProject().media[0]!, originalPath: 'E:/new/a.mov', playablePath: 'E:/new/a.mov' }
    session.replaceMedia(moved)

    // Undo the trim: the snapshot still names the old file.
    session.setProject(beforeTrim)
    expect(clipsOf(session.getProject())[0]!.sourceIn).toBe(0)
    expect(session.getProject().media[0]!.playablePath).toBe('E:/new/a.mov')
  })

  it('keeps a source imported after the snapshot was taken', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    const onlyA = session.getProject()
    session.addAsset(asset('b', 5))
    session.setProject(onlyA)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('pulls a clip back inside a source that became shorter since the snapshot', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    const full = session.getProject()
    session.replaceMedia({ ...full.media[0]!, durationSec: 4 })
    session.setProject(full)
    expect(clipsOf(session.getProject())[0]!.sourceOut).toBeLessThanOrEqual(120)
  })
})

describe('a source that arrives during a drag', () => {
  it('stays in the project when the drag moves on, and a copy of it made meanwhile too', () => {
    session.resetProject()
    session.addAsset(asset('a', 10))
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: 'a', clipId: 'c1' })
    const sound = soundsOf(session.getProject())[0]!.id
    // A volume slider held: the first movement, then an import finishing, then the next movement.
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: sound, gain: 0.8, muted: false })
    session.addAsset(asset('b', 5))
    session.replaceMedia({ ...session.getProject().media[0]!, playablePath: 'E:/rebuilt/a.mp4' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: sound, gain: 0.6, muted: false }, true)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a', 'b'])
    expect(session.getProject().media[0]!.playablePath).toBe('E:/rebuilt/a.mp4')
    expect(soundsOf(session.getProject())[0]!.gain).toBe(0.6)
  })
})

describe('a drop that is refused', () => {
  it('leaves the timeline as it was, with no track made and nothing opened up for it', () => {
    const p = withClip()
    const none = { ...mediaFromAsset(asset('none', 4)), hasAudio: false, hasVideo: false }
    const withNone = { ...p, media: [...p.media, none] }
    const edit: ProjectEdit = { sequenceId: S1, kind: 'addSource', mediaId: 'none', clipId: 'n', at: 30, onTrack: 'v-new', insert: true, newTrack: 'video' }
    expect(firstTimeline(applyEditTo(withNone, edit))).toEqual(firstTimeline(withNone))
  })
})

describe('a source taken out of the bin', () => {
  it('stays out when an undo goes back to before, unless the undo brings back a clip of it', () => {
    const empty = createProject('t', 30, { width: 1080, height: 1920 })
    session.adoptDocument(empty, null, defaultWorkspace(), true)
    session.addAsset(asset('a', 10))
    session.addAsset(asset('b', 10))
    const beforeClip = session.getProject()
    const withA = addClipTo(beforeClip, 'a')
    session.setProject(withA)

    // b is on no clip: out it goes, and it stays out through undo and redo.
    expect(session.removeMedia('b')).toBe(true)
    session.setProject(beforeClip)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a'])
    session.setProject(withA)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a'])

    // a is on a clip: it stays in.
    expect(session.removeMedia('a')).toBe(false)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a'])

    // Undone to before its clip, a can go; redone, it comes back with its clip.
    session.setProject(beforeClip)
    expect(session.removeMedia('a')).toBe(true)
    expect(session.getProject().media).toEqual([])
    session.setProject(withA)
    expect(session.getProject().media.map((m) => m.id)).toEqual(['a'])
    expect(clipsOf(session.getProject())).toHaveLength(1)
  })
})

describe('an undo sent by the window (audit 2026-10-01)', () => {
  it('brings a source back with the files it had here, never ones the snapshot names', () => {
    session.adoptDocument(createProject('t', 30, { width: 1080, height: 1920 }), null, defaultWorkspace(), true)
    session.addAsset(asset('a', 10))
    const beforeClip = session.getProject()
    const withA = addClipTo(beforeClip, 'a')
    session.setProject(beforeClip)
    expect(session.removeMedia('a')).toBe(true)
    const elsewhere = { ...withA, media: withA.media.map((m) => ({ ...m, playablePath: '\\\\host\\share\\x.mp4', soundCopy: '\\\\host\\share\\y.wav' })) }
    const back = session.setProject(elsewhere).media[0]!
    expect(back.playablePath).toBe('C:\\c\\a\\conformed.mp4')
    expect(back.soundCopy).toBeUndefined()
  })

  it('is not taken at all when it has a source this document never had', () => {
    session.adoptDocument(createProject('t', 30, { width: 1080, height: 1920 }), null, defaultWorkspace(), true)
    const before = session.getProject()
    const stranger = addClipTo({ ...before, media: [mediaFromAsset(asset('z', 10))] }, 'z')
    expect(session.setProject(stranger)).toBe(before)
  })
})

describe('zoom keyframes through an edit', () => {
  /** One ten second recording on V1 as x, zooming in from its frame 60 to 90 and out from 180 to 210. */
  function zooming(): Project {
    let p = createProject('t', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [mediaFromAsset(asset('a', 10))] }
    p = applyEditTo(p, edit({ kind: 'addSource', mediaId: 'a', clipId: 'x' }))
    const start = findVideoClip(firstTimeline(p), 'x')!.clip.transform.crop
    const closer = { x: 686, y: 54, w: 548, h: 972 }
    return applyEditTo(
      p,
      edit({
        kind: 'setZoomKeys',
        clipId: 'x',
        keys: [
          { at: 60, crop: start },
          { at: 90, crop: closer },
          { at: 180, crop: closer },
          { at: 210, crop: start }
        ]
      })
    )
  }

  it('keeps only the keyframes each half of a split can reach, and each half on the crop of its first frame', () => {
    const p = applyEditTo(zooming(), edit({ kind: 'split', frame: 200, clipId: 'x' }))
    const [first, second] = firstTimeline(p).videoTracks[0]!.clips
    expect(first!.transform.keys!.map((k) => k.at)).toEqual([60, 90, 180, 210])
    expect(second!.transform.keys!.map((k) => k.at)).toEqual([180, 210])
    // Part way out on its first frame.
    expect(second!.transform.crop.w).toBeGreaterThan(548)
    expect(second!.transform.crop.w).toBeLessThan(first!.transform.crop.w)
  })

  it('leaves a clip on a locked track alone when another is edited', () => {
    let p = zooming()
    p = applyEditTo(p, edit({ kind: 'addTrack', trackKind: 'video', trackId: 'V2' }))
    p = applyEditTo(p, edit({ kind: 'addSource', mediaId: 'a', clipId: 'y', at: 400, onTrack: 'V2' }))
    // x left with keyframes it cannot reach, as a file saved before a shorter relink might.
    const t = firstTimeline(p)
    const x = findVideoClip(t, 'x')!.clip
    const stale = { ...x, transform: { ...x.transform, keys: [...x.transform.keys!, { at: 400, crop: x.transform.crop }, { at: 401, crop: x.transform.crop }] } }
    p = { ...p, sequences: [{ ...p.sequences[0]!, videoTracks: [{ ...t.videoTracks[0]!, clips: [stale] }, ...t.videoTracks.slice(1)] }] }
    p = applyEditTo(p, edit({ kind: 'setTrackLocked', trackId: t.videoTracks[0]!.id, locked: true }))
    const moved = applyEditTo(p, edit({ kind: 'moveClip', clipId: 'y', trackId: 'V2', start: 450 }))
    expect(findVideoClip(firstTimeline(moved), 'y')!.clip.timelineStart).toBe(450)
    expect(findVideoClip(firstTimeline(moved), 'x')!.clip.transform.keys).toHaveLength(6)
  })
})
