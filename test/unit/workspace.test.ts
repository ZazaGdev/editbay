import { describe, it, expect } from 'vitest'
import {
  cleanWorkspace,
  cleanTimelineWorkspace,
  defaultWorkspace,
  defaultTimelineWorkspace,
  timelineWorkspaceOf,
  DEFAULT_FILENAME_PATTERN,
  type TimelineWorkspace
} from '../../src/shared/workspace'
import {
  createProject,
  createTimeline,
  addClip,
  addSequence,
  addSource,
  addTrack,
  timelineDuration,
  v1Clips,
  type Project,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { ZOOM_LEVELS, DEFAULT_ZOOM, DEFAULT_TRACK_SIZE, MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../../src/shared/timeline-layout'
import { S1, addClipTo } from '../project-helpers'

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: `C:\\c\\${id}\\peaks.bin`,
    filmstripPath: `C:\\c\\${id}\\filmstrip.jpg`
  }
}

/** A timeline with one 10 second clip, 300 frames long. */
function timeline(): Timeline {
  return addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }, 'a')
}

/** A project with one 10 second clip in its first sequence, and an empty second sequence. */
function project(): Project {
  const p = createProject('demo', 30, { width: 1080, height: 1920 })
  return addSequence(addClipTo({ ...p, media: [media('a')] }, 'a'), 'second', 'landscape')
}

function place(t: Timeline): TimelineWorkspace {
  return { playhead: 120, selectedClipId: v1Clips(t)[0]!.id, zoom: 7, view: 'program', trackHeights: {} }
}

describe('the default workspace', () => {
  it('is what the app has always started with, on the first sequence', () => {
    expect(defaultWorkspace()).toEqual({
      activeSequenceId: S1,
      timelines: {},
      aspectLocked: true,
      trackSize: DEFAULT_TRACK_SIZE,
      monitorVolume: 1,
      export: { folder: null, mode: 'join', filenamePattern: DEFAULT_FILENAME_PATTERN, subtitleFile: false, transcriptFile: false, sharpen: false, fast: false, fileNames: {} }
    })
    expect(defaultTimelineWorkspace()).toEqual({
      playhead: 0,
      selectedClipId: null,
      zoom: DEFAULT_ZOOM,
      view: 'source',
      trackHeights: {}
    })
  })

  it('is a fresh object each time, so one window cannot change another', () => {
    const a = defaultWorkspace()
    a.aspectLocked = false
    a.timelines.x = defaultTimelineWorkspace()
    expect(defaultWorkspace()).toEqual({ ...defaultWorkspace(), aspectLocked: true, timelines: {} })
  })

  it('starts a sequence you have not been in at the beginning', () => {
    expect(timelineWorkspaceOf(defaultWorkspace(), 'anything')).toEqual(defaultTimelineWorkspace())
  })
})

describe('cleaning where you were in one timeline', () => {
  it('keeps a place that fits its timeline exactly as it was', () => {
    const t = timeline()
    expect(cleanTimelineWorkspace(place(t), t)).toEqual(place(t))
  })

  it('never throws, whatever it is handed', () => {
    const t = timeline()
    for (const junk of ['a string', 42, [], [1, 2], null, undefined, true, { playhead: 'x' }]) {
      expect(() => cleanTimelineWorkspace(junk, t)).not.toThrow()
    }
    expect(cleanTimelineWorkspace('junk', t)).toEqual(defaultTimelineWorkspace())
  })

  it('drops a selected clip that no longer exists and keeps everything else', () => {
    const t = timeline()
    const clean = cleanTimelineWorkspace({ ...place(t), selectedClipId: 'deleted-long-ago' }, t)
    expect(clean).toEqual({ ...place(t), selectedClipId: null })
  })

  it('leaves behind the marks a place stored from before they were edits', () => {
    const t = timeline()
    expect(cleanTimelineWorkspace({ ...place(t), markIn: 60, markOut: 180 }, t)).toEqual(place(t))
  })

  it('pulls a playhead past the end of the timeline back to the end', () => {
    const t = timeline()
    expect(cleanTimelineWorkspace({ ...place(t), playhead: 99_999 }, t).playhead).toBe(timelineDuration(t))
  })

  it('keeps a playhead past V1\'s end where an audio track runs on, since the sequence goes that far', () => {
    const t = addTrack({ ...timeline(), media: [...timeline().media, { ...media('song'), hasVideo: false }] }, 'audio', 'a2')
    const song = addSource(t, { clipId: 's1', mediaId: 'song', at: 200, onTrack: 'a2' })
    expect(cleanTimelineWorkspace({ ...place(song), playhead: 450 }, song).playhead).toBe(450)
    expect(cleanTimelineWorkspace({ ...place(song), playhead: 99_999 }, song).playhead).toBe(500)
  })

  it('keeps a selected clip on any track, a sound clip or a picture above V1, and drops one that has gone', () => {
    let t = addTrack(timeline(), 'video', 'v2')
    t = addSource({ ...t, media: [...t.media, media('b')] }, { clipId: 'p1', mediaId: 'b', at: 60, onTrack: 'v2', streams: [] })
    const sound = t.audioTracks[0]!.clips[0]!.id
    expect(cleanTimelineWorkspace({ ...place(t), selectedClipId: sound }, t).selectedClipId).toBe(sound)
    expect(cleanTimelineWorkspace({ ...place(t), selectedClipId: 'p1' }, t).selectedClipId).toBe('p1')
    expect(cleanTimelineWorkspace({ ...place(t), selectedClipId: 'p2' }, t).selectedClipId).toBeNull()
  })

  it('puts a negative or fractional playhead on a real frame', () => {
    const t = timeline()
    const at = (playhead: number): number => cleanTimelineWorkspace({ ...place(t), playhead }, t).playhead
    expect(at(-5)).toBe(0)
    expect(at(12.6)).toBe(13)
    expect(at(Number.NaN)).toBe(0)
  })

  it('parks the playhead at zero on an empty timeline', () => {
    expect(cleanTimelineWorkspace({ playhead: 50 }, createTimeline(30, { width: 1080, height: 1920 })).playhead).toBe(0)
  })

  it('falls back to the default zoom for a level that does not exist', () => {
    const t = timeline()
    for (const zoom of [-1, ZOOM_LEVELS, ZOOM_LEVELS - 0.5, 1000, 'close', Number.NaN]) {
      expect(cleanTimelineWorkspace({ ...place(t), zoom }, t).zoom).toBe(DEFAULT_ZOOM)
    }
  })

  it('keeps a zoom between two levels, as Ctrl+wheel leaves it', () => {
    const t = timeline()
    expect(cleanTimelineWorkspace({ ...place(t), zoom: 6.4 }, t).zoom).toBe(6.4)
    expect(cleanTimelineWorkspace({ ...place(t), zoom: ZOOM_LEVELS - 1 }, t).zoom).toBe(ZOOM_LEVELS - 1)
  })

  it('falls back to the source view for one it does not know', () => {
    const t = timeline()
    expect(cleanTimelineWorkspace({ ...place(t), view: 'split' }, t).view).toBe('source')
  })
})

describe('cleaning a stored workspace', () => {
  it('keeps a workspace that fits its project exactly as it was', () => {
    const p = project()
    const ws = {
      activeSequenceId: 'second',
      timelines: {
        [S1]: { playhead: 30, selectedClipId: null, zoom: 2, view: 'program' as const, trackHeights: { v1: 120 } }
      },
      aspectLocked: false,
      trackSize: 'small' as const,
      monitorVolume: 0.4,
      export: { folder: 'D:\\Exports', mode: 'batch' as const, filenamePattern: '{clip}', subtitleFile: true, transcriptFile: true, sharpen: true, fast: true, fileNames: {} }
    }
    expect(cleanWorkspace(ws, p)).toEqual(ws)
  })

  it('keeps how tall each track was dragged, and drops one for a track that has gone', () => {
    const p = project()
    const stored = { timelines: { [S1]: { trackHeights: { v1: 140, a1: 30, gone: 90 } } } }
    expect(cleanWorkspace(stored, p).timelines[S1]?.trackHeights).toEqual({ v1: 140, a1: 30 })
  })

  it('brings a height outside what a track can be back inside it, and ignores rubbish', () => {
    const p = project()
    const heights = (raw: unknown): Record<string, number> =>
      cleanWorkspace({ timelines: { [S1]: { trackHeights: raw } } }, p).timelines[S1]?.trackHeights ?? {}
    expect(heights({ v1: 9000 })).toEqual({ v1: MAX_TRACK_HEIGHT })
    expect(heights({ v1: 1 })).toEqual({ v1: MIN_TRACK_HEIGHT })
    expect(heights({ v1: 'tall' })).toEqual({})
    expect(heights('all of them')).toEqual({})
  })

  it('starts the preview all the way up, and keeps how far down it was left', () => {
    const p = project()
    expect(cleanWorkspace({}, p).monitorVolume).toBe(1)
    expect(cleanWorkspace({ monitorVolume: 0.25 }, p).monitorVolume).toBe(0.25)
  })

  it('brings a preview volume outside 0 to 1 back inside it, and ignores rubbish', () => {
    const p = project()
    expect(cleanWorkspace({ monitorVolume: 4 }, p).monitorVolume).toBe(1)
    expect(cleanWorkspace({ monitorVolume: -2 }, p).monitorVolume).toBe(0)
    expect(cleanWorkspace({ monitorVolume: 'loud' }, p).monitorVolume).toBe(1)
    expect(cleanWorkspace({ monitorVolume: Number.NaN }, p).monitorVolume).toBe(1)
  })

  it('gives the defaults when there is nothing stored', () => {
    expect(cleanWorkspace(undefined, project())).toEqual(defaultWorkspace())
    expect(cleanWorkspace(null, project())).toEqual(defaultWorkspace())
  })

  it('never throws, whatever it is handed', () => {
    const p = project()
    for (const junk of ['a string', 42, [], { timelines: 'no' }, { timelines: null, export: [] }, true]) {
      expect(() => cleanWorkspace(junk, p)).not.toThrow()
      expect(cleanWorkspace(junk, p)).toEqual(defaultWorkspace())
    }
  })

  it('goes back to the first sequence when the one on screen has gone', () => {
    expect(cleanWorkspace({ activeSequenceId: 'removed' }, project()).activeSequenceId).toBe(S1)
  })

  it('forgets where you were in a sequence that has gone', () => {
    const ws = cleanWorkspace({ timelines: { removed: { playhead: 5 }, [S1]: { playhead: 5 } } }, project())
    expect(Object.keys(ws.timelines)).toEqual([S1])
  })

  it('cleans each sequence against its own clips', () => {
    // The second sequence is empty, so a playhead there goes back to zero.
    const ws = cleanWorkspace({ timelines: { [S1]: { playhead: 200 }, second: { playhead: 200 } } }, project())
    expect(ws.timelines[S1]!.playhead).toBe(200)
    expect(ws.timelines.second!.playhead).toBe(0)
  })

  it('keeps how tall the tracks were, and falls back for a size that is not one', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(cleanWorkspace({ trackSize: size }, project()).trackSize).toBe(size)
    }
    for (const junk of ['enormous', 3, null, undefined]) {
      expect(cleanWorkspace({ trackSize: junk }, project()).trackSize).toBe(DEFAULT_TRACK_SIZE)
    }
  })

  it('keeps export settings only when each one makes sense', () => {
    const clean = cleanWorkspace({ export: { folder: '', mode: 'zip', filenamePattern: '   ' } }, project())
    expect(clean.export).toEqual(defaultWorkspace().export)
  })

  it('keeps the aspect lock off when it was saved off', () => {
    expect(cleanWorkspace({ aspectLocked: false }, project()).aspectLocked).toBe(false)
    expect(cleanWorkspace({ aspectLocked: 'no' }, project()).aspectLocked).toBe(true)
  })
})
