import { describe, it, expect } from 'vitest'
import { win32 } from 'node:path'
import {
  joinProjectFile,
  splitProjectFile,
  relativeMediaPath,
  mediaPathCandidates,
  withOriginalAt
} from '../../src/shared/project-file'
import {
  createProject,
  addSequence,
  renameSequence,
  editSequence,
  addSource,
  addTrack,
  applyLayout,
  findClip,
  setClipAudio,
  setClipMark,
  setSequenceMarks,
  setLook,
  setClipOut,
  setTrackHidden,
  setTrackDuck,
  setTrackName,
  splitClip,
  unlinkClip,
  linkedIds,
  setCaptions,
  SCHEMA_VERSION,
  type Clip,
  type Project,
  type ProjectMedia,
  type SoundClip
} from '../../src/shared/project'
import { FULL_PLACE } from '../../src/shared/layout'
import { DEFAULT_CAPTION_STYLE, emptyCaptions } from '../../src/shared/captions'
import { S1, clipsOf, soundsOf, firstTimeline, addClipTo } from '../project-helpers'
import { defaultWorkspace, type Workspace } from '../../src/shared/workspace'

// Windows rules, whatever machine the tests run on: this app only ships there.
const path = win32

function media(id: string, original: string, conformed = false, more: Partial<ProjectMedia> = {}): ProjectMedia {
  const cache = `C:\\Users\\me\\AppData\\Roaming\\Editbay\\media-cache\\${id}`
  return {
    id,
    originalPath: original,
    playablePath: conformed ? `${cache}\\conformed.mp4` : original,
    conformed,
    conformReasons: conformed ? ['variable-frame-rate'] : [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: `${cache}\\peaks.bin`,
    filmstripPath: `${cache}\\filmstrip.jpg`,
    ...more
  }
}

function project(...m: ProjectMedia[]): Project {
  let p = createProject('holiday', 30, { width: 1080, height: 1920 })
  p = { ...p, media: m }
  for (const x of m) p = addClipTo(p, x.id)
  return p
}

function workspaceFor(p: Project): Workspace {
  return {
    activeSequenceId: S1,
    timelines: { [S1]: { playhead: 45, selectedClipId: clipsOf(p)[0]?.id ?? null, zoom: 3, view: 'program', trackHeights: {} } },
    aspectLocked: false,
    trackSize: 'large',
    monitorVolume: 0.5,
    export: { folder: 'D:\\Exports', mode: 'batch', filenamePattern: '{clip}_{index}', subtitleFile: true, transcriptFile: true, sharpen: true, fast: true, fileNames: { 'sequence-1': 'final cut v2' } }
  }
}

/** One of a recording's tracks a clip played before schema 6, and how loud. */
interface OldLevel {
  index: number
  gain: number
}

/**
 * A project's V1 clips as files before schema 6 stored them: each with a sound
 * of its own, played at `audio`'s volume and mute, and no link.
 */
function oldClips(p: Project, audio: { gain: number; muted: boolean; tracks?: OldLevel[] }): Record<string, unknown>[] {
  return clipsOf(p).map((c) => {
    const { link: _link, ...rest } = c
    return { ...rest, audio }
  })
}

/** A V1 clip as schema 5 stored it: a picture filling the frame, with a sound of its own. */
function oldClip(id: string, mediaId: string, sourceOut: number, audio: { gain: number; muted: boolean; tracks: OldLevel[] }): Record<string, unknown> {
  return {
    id,
    mediaId,
    sourceIn: 0,
    sourceOut,
    // Worked out from the order of V1's clips before schema 6, whatever is stored.
    timelineStart: 0,
    transform: { mode: 'crop', crop: { x: 656, y: 0, w: 608, h: 1080 }, place: FULL_PLACE },
    layers: [],
    layout: 'single',
    audio
  }
}

/** A schema 5 document with one sequence holding these clips and rows. */
function v5(m: ProjectMedia[], sequence: { clips: unknown[]; audioRows?: unknown; videoRows?: unknown }): string {
  return JSON.stringify({
    schemaVersion: 5,
    name: 'holiday',
    fps: 30,
    media: m,
    sequences: [
      {
        id: S1,
        name: 'Vertical',
        nameFollowsShape: true,
        presetId: 'vertical',
        output: { width: 1080, height: 1920 },
        audioRows: [],
        videoRows: [],
        ...sequence
      }
    ],
    workspace: defaultWorkspace()
  })
}

describe('joining and splitting', () => {
  it('gives back the project and the workspace it was handed', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const back = splitProjectFile(joinProjectFile(p, workspaceFor(p)))
    expect(back.project).toEqual(p)
    expect(back.workspace).toEqual(workspaceFor(p))
  })

  it('writes the current schema version', () => {
    const p = project()
    expect(JSON.parse(joinProjectFile(p, defaultWorkspace())).schemaVersion).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(11)
  })

  it('is newer than every released app reads, so they say so of a file with a clip at a speed rather than open it wrongly', () => {
    // 1.0, 1.1 and 1.2 read schema 10 and refuse anything newer with this message (audit 2026-10-19).
    expect(SCHEMA_VERSION).toBeGreaterThan(10)
    const raw = JSON.parse(joinProjectFile(project(), defaultWorkspace()))
    expect(() => splitProjectFile(JSON.stringify({ ...raw, schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(
      `this project was made by a newer version of the app (schema ${SCHEMA_VERSION + 1})`
    )
    // A file this app wrote before the bump still opens.
    expect(splitProjectFile(JSON.stringify({ ...raw, schemaVersion: 10 })).project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('keeps where you are in each sequence under workspace.timelines, apart from the rest', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const raw = JSON.parse(joinProjectFile(p, workspaceFor(p))) as { workspace: Record<string, unknown> }
    expect(Object.keys(raw.workspace).sort()).toEqual([
      'activeSequenceId',
      'aspectLocked',
      'export',
      'monitorVolume',
      'timelines',
      'trackSize'
    ])
    const timelines = raw.workspace.timelines as Record<string, object>
    expect(Object.keys(timelines[S1]!).sort()).toEqual([
      'playhead',
      'selectedClipId',
      'trackHeights',
      'view',
      'zoom'
    ])
  })

  it('keeps every sequence, with its own shape, name and clips', () => {
    let p = project(media('a', 'D:\\footage\\a.mp4'))
    p = renameSequence(addSequence(p, 'land', 'landscape'), 'land', 'YouTube')
    const back = splitProjectFile(joinProjectFile(p, workspaceFor(p)))
    expect(back.project).toEqual(p)
    expect(back.project.sequences.map((s) => [s.id, s.name, s.presetId, s.nameFollowsShape])).toEqual([
      [S1, 'Vertical', 'vertical', true],
      ['land', 'YouTube', 'landscape', false]
    ])
  })

  it('ignores a stored selection naming a clip that has gone, rather than failing', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const ws = { ...workspaceFor(p), timelines: { [S1]: { ...workspaceFor(p).timelines[S1]!, selectedClipId: 'gone' } } }
    const back = splitProjectFile(joinProjectFile(p, ws))
    expect(back.workspace.timelines[S1]!.selectedClipId).toBeNull()
    expect(back.workspace.timelines[S1]!.playhead).toBe(45)
  })

  it('refuses a file whose sequences are all broken', () => {
    expect(() => splitProjectFile(JSON.stringify({ schemaVersion: 3, media: [], sequences: [{ nope: true }] }))).toThrow()
  })

  it('refuses a damaged sequence rather than dropping it, which the next save would make for good', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const withBroken = { ...p, sequences: [...p.sequences, { name: 'no id', videoTracks: [], audioTracks: [] }] }
    expect(() => splitProjectFile(JSON.stringify(withBroken))).toThrow(/damaged sequence/)
    const twice = { ...p, sequences: [...p.sequences, ...p.sequences] }
    expect(() => splitProjectFile(JSON.stringify(twice))).toThrow(/damaged sequence/)
  })

  it('refuses a damaged clip, which would stop the window drawing', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    // In a file of today's schema a clip is on a track, and the track is refused with it.
    const broken = { ...p, sequences: [{ ...p.sequences[0]!, videoTracks: [{ id: 'v1', clips: [null] }] }] }
    expect(() => splitProjectFile(JSON.stringify(broken))).toThrow(/damaged track/)
    const oldBroken = { schemaVersion: 1, fps: 30, media: [], clips: [{ id: 'c' }] }
    expect(() => splitProjectFile(JSON.stringify(oldBroken))).toThrow(/damaged clip/)
  })

  it('keeps the relative path out of the project in memory', () => {
    const p = project(media('a', 'D:\\proj\\footage\\a.mp4'))
    const text = joinProjectFile(p, defaultWorkspace(), { path, projectPath: 'D:\\proj\\holiday.editbay' })
    const back = splitProjectFile(text)
    expect(back.project).toEqual(p)
    expect(back.relativePaths.get('a')).toBe('footage\\a.mp4')
  })
})

describe('a file of schema 6', () => {
  /**
   * Every kind of thing a sequence now holds: a recording with two streams on
   * V1 and A1 and A2, linked, split so its pieces have links of their own; a
   * gap; a picture on V2 laid out as Picture in picture; a song on A3 with
   * its own volume; and a clip unlinked from its sound.
   */
  function everything(): Project {
    const a = media('a', 'D:\\footage\\a.mkv', false, { audioTracks: 2, trackFiles: [{ path: 'C:\\c\\a\\track-2.m4a', peaksPath: 'C:\\c\\a\\track-2.bin' }] })
    const b = media('b', 'D:\\footage\\b.mp4')
    const song = media('song', 'D:\\music\\song.wav', false, { hasVideo: false, width: 0, height: 0, durationSec: 60 })
    let p = createProject('holiday', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [a, b, song] }
    return editSequence(p, S1, (t) => {
      let x = addSource(t, { mediaId: 'a', clipId: 'rec' })
      x = splitClip(x, 100, 'rec')
      x = addSource(x, { mediaId: 'b', clipId: 'later', at: 400, onTrack: 'v1' })
      x = unlinkClip(x, 'later')
      x = addTrack(x, 'video', 'V2')
      x = addSource(x, { mediaId: 'a', clipId: 'cut', at: 50, onTrack: 'V2', streams: [] })
      x = setClipOut(x, 'cut', 60)
      x = applyLayout(x, 'cut', 'pip')
      x = addTrack(x, 'audio', 'A3')
      x = addSource(x, { mediaId: 'song', clipId: 'song', at: 10, onTrack: 'A3' })
      x = setClipAudio(x, 'song', { gain: 2.5, muted: false })
      return x
    })
  }

  it('gives back every track, clip, link and gap it was saved with', () => {
    const p = everything()
    const t = firstTimeline(p)
    // What the round trip has to keep, so it is not a round trip of nothing.
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'V2'])
    expect(t.audioTracks.map((r) => r.id)).toEqual(['a1', 'rec.a2', 'A3'])
    expect(linkedIds(t, 'rec')).toEqual(['rec', 'rec.1', 'rec.2'])
    expect(clipsOf(p).map((c) => c.timelineStart)).toEqual([0, 100, 400])
    expect(t.videoTracks[1]!.clips[0]!.layers).toHaveLength(1)

    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back).toEqual(p)
  })

  it('writes tracks, never the clips and rows of older schemas, and a link only on a linked clip', () => {
    const raw = JSON.parse(joinProjectFile(everything(), defaultWorkspace())) as {
      sequences: (Record<string, unknown> & { videoTracks: { clips: Record<string, unknown>[] }[] })[]
    }
    const s = raw.sequences[0]!
    expect(Object.keys(s)).not.toContain('clips')
    expect(Object.keys(s)).not.toContain('audioRows')
    expect(Object.keys(s)).not.toContain('videoRows')
    const later = s.videoTracks[0]!.clips.find((c) => c.id === 'later')!
    expect('link' in later).toBe(false)
    expect(s.videoTracks[0]!.clips.find((c) => c.id === 'rec')!.link).toBe('rec')
  })

  it('gives back a track name, a hidden track and a clip mark', () => {
    const p = editSequence(everything(), S1, (t) => setClipMark(setTrackHidden(setTrackName(t, 'v1', 'Facecam'), 'V2', true), 'rec', 'amber'))
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back).toEqual(p)
    const t = firstTimeline(back)
    expect(t.videoTracks[0]!.name).toBe('Facecam')
    expect(t.videoTracks[1]!.hidden).toBe(true)
    expect(findClip(t, 'rec')!.clip.mark).toBe('amber')
    // The mark went on the clips linked to it too, and they come back as well.
    expect(findClip(t, 'rec.1')!.clip.mark).toBe('amber')
  })

  it('gives back a track that ducks, and never a picture track that claims to', () => {
    const p = editSequence(everything(), S1, (t) => setTrackDuck(t, 'A3', true))
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back).toEqual(p)
    expect(firstTimeline(back).audioTracks[2]!.duck).toBe(true)
    const s0 = p.sequences[0]!
    const claimed = { ...s0, videoTracks: s0.videoTracks.map((r) => ({ ...r, duck: true })) }
    expect(firstTimeline(splitProjectFile(JSON.stringify({ ...p, sequences: [claimed] })).project).videoTracks[0]!.duck).toBeUndefined()
  })

  it('gives back the range marked with In and Out on a sequence, and drops one that is no range', () => {
    const p = editSequence(everything(), S1, (t) => setSequenceMarks(t, { in: 30, out: 90 }))
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back).toEqual(p)
    expect(firstTimeline(back).marks).toEqual({ in: 30, out: 90 })

    const s0 = p.sequences[0]!
    const stored = (marks: unknown): unknown =>
      firstTimeline(splitProjectFile(JSON.stringify({ ...p, sequences: [{ ...s0, marks }] })).project).marks
    expect(stored({ in: 90, out: 30 })).toEqual({ in: 90 })
    expect(stored({ in: -4, out: 'late' })).toBeUndefined()
    expect(stored('both')).toBeUndefined()
  })

  it('drops a mark naming a colour that is not there, rather than refusing the file', () => {
    const p = everything()
    const s0 = p.sequences[0]!
    const v1 = s0.videoTracks[0]!
    const text = JSON.stringify({
      ...p,
      sequences: [{ ...s0, videoTracks: [{ ...v1, clips: v1.clips.map((c) => ({ ...c, mark: 'puce' })) }, s0.videoTracks[1]!] }]
    })
    const t = firstTimeline(splitProjectFile(text).project)
    expect(t.videoTracks[0]!.clips.every((c) => c.mark === undefined)).toBe(true)
  })

  it('drops a track name that is not a name, rather than refusing the file', () => {
    const p = everything()
    const s0 = p.sequences[0]!
    const text = JSON.stringify({ ...p, sequences: [{ ...s0, videoTracks: [{ ...s0.videoTracks[0]!, name: '   ' }, s0.videoTracks[1]!] }] })
    const t = firstTimeline(splitProjectFile(text).project)
    expect(t.videoTracks[0]!.name).toBeUndefined()
  })

  it('opens the same way every time', () => {
    const text = joinProjectFile(everything(), defaultWorkspace())
    expect(JSON.stringify(splitProjectFile(text).project)).toBe(JSON.stringify(splitProjectFile(text).project))
  })

  it('refuses a damaged track with the file, rather than dropping it', () => {
    const p = everything()
    const s = p.sequences[0]!
    const withSequence = (change: Record<string, unknown>): string =>
      JSON.stringify({ ...p, sequences: [{ ...s, ...change }] })
    const v1 = s.videoTracks[0]!
    const a1 = s.audioTracks[0]!
    const damaged: Record<string, unknown>[] = [
      { videoTracks: undefined },
      { audioTracks: 'none' },
      // A sequence always has V1 and A1.
      { videoTracks: [] },
      { audioTracks: [] },
      { videoTracks: [{ clips: v1.clips }] },
      { videoTracks: [v1, { id: 'v1', clips: [] }] },
      { audioTracks: [{ id: 'a1', clips: 'none' }] },
      // A video clip with no layout, and one whose layer has no place.
      { videoTracks: [{ ...v1, clips: [{ ...v1.clips[0]!, layout: undefined }] }] },
      { videoTracks: [{ ...v1, clips: [{ ...v1.clips[0]!, layers: [{ id: 'L1', crop: { x: 0, y: 0, w: 2, h: 2 } }] }] }] },
      // A sound clip with no volume, and one naming no stream.
      { audioTracks: [{ ...a1, clips: [{ ...a1.clips[0]!, gain: '100%' }] }] },
      { audioTracks: [{ ...a1, clips: [{ ...a1.clips[0]!, track: undefined }] }] },
      // A link that is not an id.
      { audioTracks: [{ ...a1, clips: [{ ...a1.clips[0]!, link: 7 }] }] },
      // A sound clip on a video track.
      { videoTracks: [{ id: 'v1', clips: a1.clips }] }
    ]
    for (const change of damaged) {
      expect(() => splitProjectFile(withSequence(change)), JSON.stringify(change)).toThrow(/damaged track/)
    }
  })
})

describe('files from before layers', () => {
  /** A schema 3 document: sequences, but clips with no place, layers or layout, and only a volume and a mute. */
  function v3(): string {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const old = {
      ...p,
      schemaVersion: 3,
      sequences: p.sequences.map((s) => ({
        id: s.id,
        name: s.name,
        nameFollowsShape: s.nameFollowsShape,
        presetId: s.presetId,
        output: s.output,
        clips: oldClips(p, { gain: 1, muted: false }).map((c) => {
          const { layers: _l, layout: _k, transform, ...rest } = c as { layers: unknown; layout: unknown; transform: Clip['transform'] }
          return { ...rest, transform: { mode: transform.mode, crop: transform.crop } }
        })
      }))
    }
    return JSON.stringify(old)
  }

  it('open with one picture filling the frame, no layers and the Single layout', () => {
    const c = clipsOf(splitProjectFile(v3()).project)[0]!
    expect(c.transform.place).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(c.layers).toEqual([])
    expect(c.layout).toBe('single')
  })

  it('open the same way every time, so they are not marked changed for having been opened', () => {
    const file = v3()
    expect(splitProjectFile(file).project).toEqual(splitProjectFile(file).project)
    const once = splitProjectFile(file).project
    expect(splitProjectFile(joinProjectFile(once, defaultWorkspace())).project).toEqual(once)
  })

  it('refuse a damaged layer with the file, as a damaged clip is', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const broken = v5(p.media, {
      clips: oldClips(p, { gain: 1, muted: false }).map((c) => ({ ...c, layers: [{ id: 'L1', crop: 'no' }] }))
    })
    expect(() => splitProjectFile(broken)).toThrow(/damaged layer/)
  })

  it('keep a source without an audio track count as unknown, not a guess', () => {
    const m = splitProjectFile(v3()).project.media[0]!
    expect(m.audioTracks).toBeUndefined()
  })
})

describe('files from before a clip chose its tracks', () => {
  /** A schema 4 document: clips whose sound has only a volume and a mute. */
  function v4(): string {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const old = {
      ...p,
      schemaVersion: 4,
      sequences: p.sequences.map((s) => ({
        id: s.id,
        name: s.name,
        nameFollowsShape: s.nameFollowsShape,
        presetId: s.presetId,
        output: s.output,
        clips: oldClips(p, { gain: 0.5, muted: true })
      }))
    }
    return JSON.stringify(old)
  }

  it('open with every clip\'s first track as a sound clip linked to it, keeping its volume and mute', () => {
    const back = splitProjectFile(v4()).project
    const c = clipsOf(back)[0]!
    expect(c.link).toBe(c.id)
    expect(soundsOf(back)).toEqual([
      { id: `${c.id}.1`, mediaId: 'a', track: 0, sourceIn: 0, sourceOut: 300, timelineStart: 0, gain: 0.5, muted: true, link: c.id }
    ])
    expect(firstTimeline(back).audioTracks.map((r) => r.id)).toEqual(['a1'])
  })

  it('open the same way every time, so they are not marked changed for having been opened', () => {
    const file = v4()
    const once = splitProjectFile(file).project
    expect(splitProjectFile(file).project).toEqual(once)
    expect(splitProjectFile(joinProjectFile(once, defaultWorkspace())).project).toEqual(once)
  })

  it('keep a clip\'s choice of tracks, at its level, through a save', () => {
    const a = media('a', 'D:\\footage\\a.mp4', false, { audioTracks: 2 })
    const p = project(a)
    const chosen = v5(p.media, { clips: oldClips(p, { gain: 0.5, muted: false, tracks: [{ index: 1, gain: 1.5 }] }) })
    const once = splitProjectFile(chosen).project
    const c = clipsOf(once)[0]!
    expect(soundsOf(once)).toEqual([
      { id: `${c.id}.2`, mediaId: 'a', track: 1, sourceIn: 0, sourceOut: 300, timelineStart: 0, gain: 0.75, muted: false, link: c.id }
    ])
    expect(splitProjectFile(joinProjectFile(once, defaultWorkspace())).project).toEqual(once)
  })

  it('refuse a damaged choice of tracks with the file', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const broken = v5(p.media, { clips: oldClips(p, { gain: 1, muted: false, tracks: [{ index: 'mic' } as unknown as OldLevel] }) })
    expect(() => splitProjectFile(broken)).toThrow(/damaged clip/)
  })
})

describe('files from before free tracks', () => {
  /** A recording with two streams, 10 seconds, and a song. */
  const rec = media('a', 'D:\\footage\\a.mkv', false, { audioTracks: 2 })
  const song = media('song', 'D:\\music\\song.wav', false, { hasVideo: false, width: 0, height: 0, durationSec: 60 })
  const voiceOver = { id: 'vo', mediaId: 'song', track: 0, sourceIn: 0, sourceOut: 90, timelineStart: 60, gain: 1.25, muted: false }

  /**
   * A schema 5 sequence: V1 holding a clip playing streams 1 and 2, the second
   * at 150%, at half volume, then a muted clip playing stream 1; and a voice
   * over on the audio row A2.
   */
  function twoStreams(): string {
    return v5([rec, song], {
      clips: [
        oldClip('c1', 'a', 300, { gain: 0.5, muted: false, tracks: [{ index: 0, gain: 1 }, { index: 1, gain: 1.5 }] }),
        oldClip('c2', 'a', 150, { gain: 1, muted: true, tracks: [{ index: 0, gain: 1 }] })
      ],
      audioRows: [{ id: 'A2', clips: [voiceOver] }]
    })
  }

  it('open with V1\'s clips on V1, their streams as linked sound clips on A1 and A2 heard as before, and the old A2 on A3', () => {
    const back = splitProjectFile(twoStreams()).project
    const t = firstTimeline(back)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1'])
    expect(clipsOf(back).map((c) => [c.id, c.timelineStart, c.sourceIn, c.sourceOut, c.link])).toEqual([
      ['c1', 0, 0, 300, 'c1'],
      ['c2', 300, 0, 150, 'c2']
    ])
    expect(t.audioTracks.map((r) => r.id)).toEqual(['a1', 'a2', 'A2'])
    const sound = (c: SoundClip): unknown[] => [c.id, c.track, c.timelineStart, c.sourceIn, c.sourceOut, c.gain, c.muted, c.link]
    // Each at the clip's volume times the stream's level, and muted as the clip was.
    expect(t.audioTracks[0]!.clips.map(sound)).toEqual([
      ['c1.1', 0, 0, 0, 300, 0.5, false, 'c1'],
      ['c2.1', 0, 300, 0, 150, 1, true, 'c2']
    ])
    expect(t.audioTracks[1]!.clips.map(sound)).toEqual([['c1.2', 1, 0, 0, 300, 0.75, false, 'c1']])
    // The row keeps its clip exactly, with no link.
    expect(t.audioTracks[2]!.clips).toEqual([voiceOver])
    expect(linkedIds(t, 'c1').sort()).toEqual(['c1', 'c1.1', 'c1.2'])
    expect(linkedIds(t, 'vo')).toEqual(['vo'])
  })

  it('keep the old A2 as A2 when no clip played more than one stream', () => {
    const file = v5([rec, song], {
      clips: [oldClip('c1', 'a', 300, { gain: 1, muted: false, tracks: [{ index: 0, gain: 1 }] })],
      audioRows: [{ id: 'A2', clips: [voiceOver] }]
    })
    const t = firstTimeline(splitProjectFile(file).project)
    expect(t.audioTracks.map((r) => r.id)).toEqual(['a1', 'A2'])
    expect(t.audioTracks[0]!.clips.map((c) => c.id)).toEqual(['c1.1'])
    expect(t.audioTracks[1]!.clips).toEqual([voiceOver])
  })

  it('give a clip that played no stream no sound and no link, and still an empty A1', () => {
    const file = v5([rec], { clips: [oldClip('c1', 'a', 300, { gain: 1, muted: false, tracks: [] })] })
    const t = firstTimeline(splitProjectFile(file).project)
    expect(clipsOf(splitProjectFile(file).project)[0]!.link).toBeUndefined()
    expect(t.audioTracks).toEqual([{ id: 'a1', clips: [] }])
  })

  it('open video rows as video tracks above V1, their pictures on Single when they fill the frame and Custom otherwise', () => {
    const corner = { x: 0.6, y: 0.05, w: 0.35, h: 0.2 }
    const crop = { x: 0, y: 0, w: 1920, h: 1080 }
    const file = v5([rec], {
      clips: [oldClip('c1', 'a', 300, { gain: 1, muted: false, tracks: [{ index: 0, gain: 1 }] })],
      videoRows: [
        { id: 'V2', clips: [{ id: 'g', mediaId: 'a', sourceIn: 30, sourceOut: 60, timelineStart: 90, crop, place: FULL_PLACE }] },
        { id: 'V3', clips: [{ id: 'k', mediaId: 'a', sourceIn: 0, sourceOut: 30, timelineStart: 120, crop, place: corner }] }
      ]
    })
    const t = firstTimeline(splitProjectFile(file).project)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'V2', 'V3'])
    const full: Clip = {
      id: 'g',
      mediaId: 'a',
      sourceIn: 30,
      sourceOut: 60,
      timelineStart: 90,
      transform: { mode: 'crop', crop, place: FULL_PLACE },
      layers: [],
      layout: 'single'
    }
    expect(t.videoTracks[1]!.clips).toEqual([full])
    expect(t.videoTracks[2]!.clips).toEqual([
      { ...full, id: 'k', sourceIn: 0, sourceOut: 30, timelineStart: 120, transform: { mode: 'crop', crop, place: corner }, layout: 'custom' }
    ])
    expect(t.audioTracks.map((r) => r.id)).toEqual(['a1'])
  })

  it('open the same way every time, so they are not marked changed for having been opened', () => {
    const file = twoStreams()
    const once = splitProjectFile(file).project
    // What "changed" compares: the project as text.
    expect(JSON.stringify(splitProjectFile(file).project)).toBe(JSON.stringify(once))
    expect(splitProjectFile(joinProjectFile(once, defaultWorkspace())).project).toEqual(once)
  })

  it('refuse a damaged row with the file', () => {
    const clips = [oldClip('c1', 'a', 300, { gain: 1, muted: false, tracks: [{ index: 0, gain: 1 }] })]
    const damaged = [
      { audioRows: [{ id: 'A2', clips: [{ ...voiceOver, gain: 'loud' }] }] },
      { audioRows: [{ clips: [] }] },
      { audioRows: 'none' },
      { videoRows: [{ id: 'V2', clips: [{ id: 'g', mediaId: 'a', sourceIn: 0, sourceOut: 30, timelineStart: 0, crop: { x: 0, y: 0, w: 2, h: 2 } }] }] }
    ]
    for (const rows of damaged) {
      expect(() => splitProjectFile(v5([rec, song], { clips, ...rows })), JSON.stringify(rows)).toThrow(/damaged row/)
    }
    expect(() => splitProjectFile(v5([rec], { clips: [{ id: 'c1', mediaId: 'a' }] }))).toThrow(/damaged clip/)
  })
})

describe('files from before sequences', () => {
  /** A schema 2 document: one timeline at the top, where you were under workspace.timeline. */
  function v2(clipIds: string[]): string {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const clips = oldClips(p, { gain: 1, muted: false }).map((c, i) => ({ ...c, id: clipIds[i] ?? c.id }))
    return JSON.stringify({
      schemaVersion: 2,
      name: 'holiday',
      fps: 30,
      output: { width: 1080, height: 1080 },
      presetId: 'square',
      media: p.media,
      clips,
      workspace: {
        timeline: { playhead: 60, selectedClipId: clipIds[0], zoom: 4, view: 'program' },
        aspectLocked: false,
        export: { folder: 'D:\\Exports', mode: 'batch', filenamePattern: '{clip}' }
      }
    })
  }

  it('open as one sequence holding their clips and shape, named after the shape', () => {
    const back = splitProjectFile(v2(['c1']))
    expect(back.project.sequences).toHaveLength(1)
    expect(back.project.sequences[0]).toMatchObject({
      id: S1,
      name: 'Square',
      nameFollowsShape: true,
      presetId: 'square',
      output: { width: 1080, height: 1080 }
    })
    expect(clipsOf(back.project).map((c) => c.id)).toEqual(['c1'])
  })

  it('keep where you were, now as where you are in that sequence', () => {
    const back = splitProjectFile(v2(['c1']))
    expect(back.workspace.activeSequenceId).toBe(S1)
    // A file written before there were marks reads back with none.
    expect(back.workspace.timelines[S1]).toEqual({ playhead: 60, selectedClipId: 'c1', zoom: 4, view: 'program', trackHeights: {} })
    expect(back.workspace.aspectLocked).toBe(false)
    expect(back.workspace.export.folder).toBe('D:\\Exports')
  })

  it('give the same document every time they are opened', () => {
    expect(splitProjectFile(v2(['c1'])).project).toEqual(splitProjectFile(v2(['c1'])).project)
  })

  it('open a version 1 file, which has no workspace, with the default one', () => {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    const v1 = JSON.stringify({ schemaVersion: 1, name: 'x', fps: 30, media: p.media, clips: oldClips(p, { gain: 1, muted: false }) })
    const back = splitProjectFile(v1)
    expect(back.workspace).toEqual(defaultWorkspace())
    expect(back.project.schemaVersion).toBe(SCHEMA_VERSION)
    // Exactly what Add to timeline gives the same recording today.
    expect(clipsOf(back.project)).toEqual(clipsOf(p))
    expect(soundsOf(back.project)).toEqual(soundsOf(p))
    expect(firstTimeline(back.project).presetId).toBe('vertical')
  })
})

describe('paths relative to the project file', () => {
  it('are written for a source on the same drive', () => {
    expect(relativeMediaPath(path, 'D:\\proj', 'D:\\proj\\footage\\a.mp4')).toBe('footage\\a.mp4')
    expect(relativeMediaPath(path, 'D:\\proj\\edits', 'D:\\raw\\a.mp4')).toBe('..\\..\\raw\\a.mp4')
  })

  it('treat the drive letter without regard to case', () => {
    expect(relativeMediaPath(path, 'd:\\proj', 'D:\\proj\\a.mp4')).toBe('a.mp4')
  })

  it('are not written for a source on another drive, which Windows cannot express', () => {
    expect(relativeMediaPath(path, 'G:\\proj', 'C:\\footage\\a.mp4')).toBeNull()
  })

  it('are not written across network shares', () => {
    expect(relativeMediaPath(path, '\\\\nas\\video\\proj', '\\\\other\\video\\a.mp4')).toBeNull()
    expect(relativeMediaPath(path, '\\\\nas\\video\\proj', '\\\\nas\\video\\raw\\a.mp4')).toBe('..\\raw\\a.mp4')
  })

  it('are never written for cache files', () => {
    const conformed = media('a', 'C:\\Users\\me\\Videos\\a.mov', true)
    const p = project(conformed)
    const raw = JSON.parse(
      joinProjectFile(p, defaultWorkspace(), { path, projectPath: 'C:\\Users\\me\\Videos\\holiday.editbay' })
    ) as { media: (ProjectMedia & { relativePath?: string })[] }
    const stored = raw.media[0]!
    expect(stored.relativePath).toBe('a.mov')
    // The playable file, waveform and filmstrip stay absolute: they are
    // rebuilt when missing rather than looked for.
    expect(stored.playablePath).toBe(conformed.playablePath)
    expect(stored.peaksPath).toBe(conformed.peaksPath)
    expect(stored.filmstripPath).toBe(conformed.filmstripPath)
  })

  it('survive the project folder moving', () => {
    const p = project(media('a', 'D:\\proj\\footage\\a.mp4'))
    const text = joinProjectFile(p, defaultWorkspace(), { path, projectPath: 'D:\\proj\\holiday.editbay' })
    const back = splitProjectFile(text)

    // The whole folder moved to another drive.
    const candidates = mediaPathCandidates(path, 'E:\\moved\\holiday.editbay', 'D:\\proj\\footage\\a.mp4', back.relativePaths.get('a'))
    expect(candidates).toEqual(['E:\\moved\\footage\\a.mp4', 'D:\\proj\\footage\\a.mp4'])
  })

  it('look where the source was when there is no relative path', () => {
    expect(mediaPathCandidates(path, 'E:\\p\\x.editbay', 'C:\\a.mp4', undefined)).toEqual(['C:\\a.mp4'])
  })

  it('do not look in the same place twice', () => {
    expect(mediaPathCandidates(path, 'D:\\proj\\x.editbay', 'D:\\proj\\a.mp4', 'a.mp4')).toEqual(['D:\\proj\\a.mp4'])
  })
})

describe('a source found somewhere else', () => {
  it('plays from there when it was never conformed', () => {
    const moved = withOriginalAt(media('a', 'D:\\old\\a.mp4'), 'E:\\new\\a.mp4')
    expect(moved.originalPath).toBe('E:\\new\\a.mp4')
    expect(moved.playablePath).toBe('E:\\new\\a.mp4')
  })

  it('keeps playing from the cache when it was', () => {
    const m = media('a', 'D:\\old\\a.mov', true)
    const moved = withOriginalAt(m, 'E:\\new\\a.mov')
    expect(moved.originalPath).toBe('E:\\new\\a.mov')
    expect(moved.playablePath).toBe(m.playablePath)
  })

  it('is left alone when it is where it was', () => {
    const m = media('a', 'D:\\a.mp4')
    expect(withOriginalAt(m, 'D:\\a.mp4')).toBe(m)
  })
})

describe('an older file whose rows have the names new tracks take', () => {
  it('names the new audio tracks apart from them, so the file opens again after it is saved', () => {
    const media = {
      id: 'm1',
      originalPath: 'C:\v\a.mp4',
      playablePath: 'C:\v\a.mp4',
      conformed: false,
      conformReasons: [],
      durationSec: 4,
      width: 640,
      height: 360,
      fps: 30,
      codec: 'h264',
      hasAudio: true,
      audioTracks: 2,
      peaksPath: '',
      filmstripPath: ''
    }
    const clip = {
      id: 'c1',
      mediaId: 'm1',
      sourceIn: 0,
      sourceOut: 120,
      timelineStart: 0,
      transform: { mode: 'crop', crop: { x: 0, y: 0, w: 202, h: 360 }, place: { x: 0, y: 0, w: 1, h: 1 } },
      layers: [],
      layout: 'single',
      audio: { gain: 1, muted: false, tracks: [{ index: 0, gain: 1 }, { index: 1, gain: 1 }] }
    }
    const row = (id: string) => ({ id, clips: [] })
    const text = JSON.stringify({
      schemaVersion: 5,
      name: 'clash',
      fps: 30,
      media: [media],
      sequences: [{ id: 'sequence-1', name: 'Vertical', nameFollowsShape: true, presetId: 'vertical', output: { width: 1080, height: 1920 }, clips: [clip], audioRows: [row('a2'), row('a1')], videoRows: [row('v1')] }]
    })
    const opened = splitProjectFile(text).project
    const ids = opened.sequences[0]!.audioTracks.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(2)).toEqual(['a2', 'a1'])
    const pictures = opened.sequences[0]!.videoTracks.map((r) => r.id)
    expect(pictures[0]).toBe('v1')
    expect(new Set(pictures).size).toBe(2)
    // Saved and opened again, it is the same.
    const again = splitProjectFile(joinProjectFile(opened, defaultWorkspace())).project
    expect(again.sequences[0]!.audioTracks.map((r) => r.id)).toEqual(ids)
    expect(again.sequences[0]!.videoTracks.map((r) => r.id)).toEqual(pictures)
  })
})

describe('captions in the file', () => {
  function captioned(): Project {
    const p = project(media('a', 'D:\\footage\\a.mp4'))
    return editSequence(p, S1, (t) => {
      const styled = { ...t, captions: { ...t.captions, style: { ...t.captions.style, wordsPerCaption: 2, capitals: false, highlight: '#00FF88' } } }
      return setCaptions(styled, [{ text: 'hello', start: 10, length: 8 }, { text: 'there', start: 20, length: 8 }, { text: 'you', start: 40, length: 6 }], ['a1'])
    })
  }

  it('are saved and read back as they were, with how they look and what was listened to', () => {
    const p = captioned()
    expect(firstTimeline(p).captions.clips).toHaveLength(2)
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back).toEqual(p)
  })

  it('are none in a file of schema 6, which had none, and it opens in the current schema', () => {
    const raw = JSON.parse(joinProjectFile(project(media('a', 'D:\\footage\\a.mp4')), defaultWorkspace())) as Record<string, unknown> & { sequences: Record<string, unknown>[] }
    const old = { ...raw, schemaVersion: 6, sequences: raw.sequences.map(({ captions: _none, ...s }) => s) }
    const opened = splitProjectFile(JSON.stringify(old))
    expect(opened.fileSchema).toBe(6)
    expect(opened.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(firstTimeline(opened.project).captions).toEqual(emptyCaptions())
  })

  it('refuse the file when a caption is damaged, rather than lose it at the next save', () => {
    const raw = JSON.parse(joinProjectFile(captioned(), defaultWorkspace())) as { sequences: { captions: { clips: unknown[] } }[] }
    raw.sequences[0]!.captions.clips[0] = { id: 'x', timelineStart: 0, length: 10, words: [{ text: 'hi' }] }
    expect(() => splitProjectFile(JSON.stringify(raw))).toThrow(/damaged captions/)
  })

  it('take the default for a setting of how they look that cannot be read', () => {
    const raw = JSON.parse(joinProjectFile(captioned(), defaultWorkspace())) as { sequences: { captions: { style: Record<string, unknown> } }[] }
    raw.sequences[0]!.captions.style = { size: 'big', height: 2, wordsPerCaption: 9, capitals: 'yes', highlight: 'yellow' }
    expect(firstTimeline(splitProjectFile(JSON.stringify(raw)).project).captions.style).toEqual(DEFAULT_CAPTION_STYLE)
  })
})

describe('a caption placed by hand in the file', () => {
  it('comes back where it was put, and one whose place cannot be read follows the style', () => {
    const p = editSequence(project(media('a', 'D:\\footage\\a.mp4')), S1, (t) =>
      setCaptions(t, [{ text: 'hello', start: 10, length: 8 }, { text: 'there.', start: 20, length: 8 }], [])
    )
    const placed = editSequence(p, S1, (t) => ({
      ...t,
      captions: { ...t.captions, clips: t.captions.clips.map((c, i) => (i === 0 ? { ...c, at: { x: 0.25, y: 0.3 } } : c)) }
    }))
    const back = splitProjectFile(joinProjectFile(placed, defaultWorkspace())).project
    expect(firstTimeline(back).captions.clips[0]!.at).toEqual({ x: 0.25, y: 0.3 })

    const raw = JSON.parse(joinProjectFile(placed, defaultWorkspace())) as { sequences: { captions: { clips: Record<string, unknown>[] } }[] }
    raw.sequences[0]!.captions.clips[0]!.at = { x: 'left' }
    const opened = splitProjectFile(JSON.stringify(raw)).project
    expect('at' in firstTimeline(opened).captions.clips[0]!).toBe(false)
  })
})

describe('markers in the file', () => {
  function marked(): Project {
    const p = project(media('a', 'D:\footage\a.mp4'))
    return editSequence(p, S1, (t) => ({
      ...t,
      markers: [
        { id: 'm1', frame: 60, name: 'the good bit' },
        { id: 'm2', frame: 300, name: '', colour: 'amber' }
      ]
    }))
  }

  it('come back exactly as they went in', () => {
    const opened = splitProjectFile(joinProjectFile(marked(), defaultWorkspace()))
    expect(firstTimeline(opened.project).markers).toEqual([
      { id: 'm1', frame: 60, name: 'the good bit' },
      { id: 'm2', frame: 300, name: '', colour: 'amber' }
    ])
  })

  it('are none in a file from before they existed, which still opens', () => {
    const raw = JSON.parse(joinProjectFile(marked(), defaultWorkspace())) as Record<string, unknown> & {
      sequences: Record<string, unknown>[]
    }
    const old = { ...raw, schemaVersion: 7, sequences: raw.sequences.map(({ markers: _none, ...s }) => s) }
    const opened = splitProjectFile(JSON.stringify(old))
    expect(opened.fileSchema).toBe(7)
    expect(firstTimeline(opened.project).markers).toEqual([])
  })

  it('lose only the damaged one, where a damaged caption loses the whole file', () => {
    const raw = JSON.parse(joinProjectFile(marked(), defaultWorkspace())) as { sequences: { markers: unknown[] }[] }
    raw.sequences[0]!.markers[0] = { id: 'm1', frame: 'early', name: 'no' }
    const opened = splitProjectFile(JSON.stringify(raw))
    expect(firstTimeline(opened.project).markers.map((m) => m.frame)).toEqual([300])
  })

  it('opens a file whose markers are not a list at all', () => {
    const raw = JSON.parse(joinProjectFile(marked(), defaultWorkspace())) as { sequences: Record<string, unknown>[] }
    raw.sequences[0]!.markers = 'all of them'
    expect(firstTimeline(splitProjectFile(JSON.stringify(raw)).project).markers).toEqual([])
  })
})

describe('transitions in the file', () => {
  /** Two clips on V1 with a dissolve on the cut between them, and a fade on the sound. */
  function faded(): Project {
    const p = addClipTo(project(media('a', 'D:\footage\a.mp4')), 'a')
    return editSequence(p, S1, (t) => ({
      ...t,
      videoTracks: t.videoTracks.map((r) => ({
        ...r,
        clips: r.clips.map((c, i) => (i === 1 ? { ...c, transitionIn: { kind: 'dissolve', length: 30, before: 15 } } : c))
      })),
      audioTracks: t.audioTracks.map((r) => ({
        ...r,
        clips: r.clips.map((c, i) => (i === 1 ? { ...c, transitionIn: { kind: 'even', length: 30, before: 15 } } : c))
      }))
    }))
  }

  it('come back exactly as they went in', () => {
    const opened = splitProjectFile(joinProjectFile(faded(), defaultWorkspace()))
    expect(clipsOf(opened.project)[1]?.transitionIn).toEqual({ kind: 'dissolve', length: 30, before: 15 })
    expect(soundsOf(opened.project)[1]?.transitionIn).toEqual({ kind: 'even', length: 30, before: 15 })
  })

  it('leave a clip with none carrying no key for them in the file', () => {
    const written = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[]
    }
    const first = written.sequences[0]!.videoTracks[0]!.clips[0]!
    expect('transitionIn' in first).toBe(false)
    expect('transitionOut' in first).toBe(false)
  })

  it('are none in a file from before they existed, which still opens', () => {
    const raw = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as Record<string, unknown>
    const old = { ...raw, schemaVersion: 8 }
    const opened = splitProjectFile(JSON.stringify(old))
    expect(opened.fileSchema).toBe(8)
    expect(opened.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(clipsOf(opened.project).length).toBe(2)
  })

  it('lose only the damaged one, where a damaged caption loses the whole file', () => {
    const raw = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[]
    }
    raw.sequences[0]!.videoTracks[0]!.clips[1]!.transitionIn = { kind: 'dissolve', length: 'a while', before: 15 }
    const opened = splitProjectFile(JSON.stringify(raw))
    expect(clipsOf(opened.project)[1]?.transitionIn).toBeUndefined()
    expect(clipsOf(opened.project).length).toBe(2)
  })

  it('keep one whose kind this build does not have, on the default kind', () => {
    const raw = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[]
    }
    raw.sequences[0]!.videoTracks[0]!.clips[1]!.transitionIn = { kind: 'kaleidoscope', length: 30, before: 15 }
    expect(clipsOf(splitProjectFile(JSON.stringify(raw)).project)[1]?.transitionIn?.kind).toBe('dissolve')
  })

  it('never carry the empty effects list that schema 8 wrote', () => {
    const written = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[]
    }
    expect(written.sequences[0]!.videoTracks[0]!.clips.some((c) => 'effects' in c)).toBe(false)
  })

  it('opens a schema 8 file that still has the effects list on its clips', () => {
    const raw = JSON.parse(joinProjectFile(faded(), defaultWorkspace())) as {
      schemaVersion: number
      sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[]
    }
    raw.schemaVersion = 8
    for (const c of raw.sequences[0]!.videoTracks[0]!.clips) c.effects = []
    const opened = splitProjectFile(JSON.stringify(raw))
    expect(clipsOf(opened.project).every((c) => !('effects' in c))).toBe(true)
  })
})

describe('a look in the file', () => {
  function looked(): Project {
    const p = addClipTo(project(media('a', 'D:\footage\a.mp4')), 'a')
    return editSequence(p, S1, (t) => setLook(t, clipsOf(p)[0]!.id, 'mono'))
  }

  it('comes back as it went in', () => {
    const p = looked()
    expect(clipsOf(p)[0]!.look).toBe('mono')
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })

  it('is dropped when it names a look the app no longer has, and the file still opens', () => {
    const raw = JSON.parse(joinProjectFile(looked(), defaultWorkspace())) as { sequences: { videoTracks: { clips: Record<string, unknown>[] }[] }[] }
    raw.sequences[0]!.videoTracks[0]!.clips[0]!.look = 'lomo'
    const opened = splitProjectFile(JSON.stringify(raw)).project
    expect('look' in clipsOf(opened)[0]!).toBe(false)
  })
})

describe('a move from before zoom keyframes', () => {
  /** Three clips of a schema 9 file, each with the move given, the third cut from its recording's frame 30 on. */
  function schema9(zooms: unknown[]): Project {
    const p = project(media('a', 'C:\v\a.mp4'), media('b', 'C:\v\b.mp4'), media('c', 'C:\v\c.mp4'))
    const raw = JSON.parse(joinProjectFile(p, defaultWorkspace())) as {
      schemaVersion: number
      sequences: { videoTracks: { clips: (Record<string, unknown> & { transform: Record<string, unknown> })[] }[] }[]
    }
    raw.schemaVersion = 9
    const clips = raw.sequences[0]!.videoTracks[0]!.clips
    clips[2]!.sourceIn = 30
    zooms.forEach((z, i) => {
      clips[i]!.transform.zoom = z
    })
    return splitProjectFile(JSON.stringify(raw)).project
  }

  const closer = { x: 686, y: 54, w: 548, h: 972 }

  it('opens a cut, a cut on the first frame and a move as keyframes on the recording that show the same crops', () => {
    const opened = schema9([
      { crop: closer, at: 90, length: 0 },
      { crop: closer, at: 0, length: 0 },
      { crop: closer, at: 15, length: 30 }
    ])
    const [cut, first, move] = clipsOf(opened)
    const start = cut!.transform.crop
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION)
    for (const c of [cut, first, move]) expect('zoom' in c!.transform).toBe(false)
    // A cut three seconds in: a keyframe on the first frame that holds, and the closer one on the cut.
    expect(cut!.transform.keys).toEqual([
      { at: 0, crop: start, ease: 'hold' },
      { at: 90, crop: closer }
    ])
    // A cut on the first frame is the closer crop, the whole clip long.
    expect(first!.transform.keys).toBeUndefined()
    expect(first!.transform.crop).toEqual(closer)
    // A move, on the recording's frames: 30 in, so from 45 to 75, eased as before.
    expect(move!.transform.keys).toEqual([
      { at: 45, crop: move!.transform.crop },
      { at: 75, crop: closer }
    ])
  })

  it('keeps no move for one that went nowhere, as it was drawn', () => {
    const own = clipsOf(schema9([]))[0]!.transform.crop
    const c = clipsOf(schema9([{ crop: { ...own, x: own.x + 0.5 }, at: 10, length: 10 }]))[0]!
    expect(c.transform.keys).toBeUndefined()
    expect(c.transform.crop).toEqual(own)
  })

  it('refuses a damaged move or damaged keyframes, as it refuses a damaged clip', () => {
    expect(() => schema9([{ crop: closer, at: 'soon', length: 0 }])).toThrow(/damaged/)
    const raw = JSON.parse(joinProjectFile(project(media('a', 'C:\v\a.mp4')), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: { transform: Record<string, unknown> }[] }[] }[]
    }
    raw.sequences[0]!.videoTracks[0]!.clips[0]!.transform.keys = [{ at: 3, crop: closer, ease: 'bounce' }]
    expect(() => splitProjectFile(JSON.stringify(raw))).toThrow(/damaged/)
  })

  it('keeps keyframes when saved and opened again', () => {
    const opened = schema9([{ crop: closer, at: 90, length: 0 }])
    const again = splitProjectFile(joinProjectFile(opened, defaultWorkspace())).project
    expect(clipsOf(again)[0]!.transform.keys).toEqual(clipsOf(opened)[0]!.transform.keys)
  })
})

describe('a Simple zoom in the file', () => {
  const closer = { x: 686, y: 54, w: 548, h: 972 }
  /** One clip saved with the Simple mark given and a zoom from its crop to `closer`. */
  function saved(simple: unknown): Project {
    const raw = JSON.parse(joinProjectFile(project(media('a', 'C:\v\a.mp4')), defaultWorkspace())) as {
      sequences: { videoTracks: { clips: (Record<string, unknown> & { sourceIn: number; sourceOut: number; transform: Record<string, unknown> & { crop: unknown } })[] }[] }[]
    }
    const c = raw.sequences[0]!.videoTracks[0]!.clips[0]!
    c.transform.simple = simple
    c.transform.keys = [
      { at: c.sourceIn, crop: c.transform.crop, ease: 'linear' },
      { at: c.sourceOut - 1, crop: closer }
    ]
    return splitProjectFile(JSON.stringify(raw)).project
  }

  it('comes back as it went in', () => {
    const p = saved('linear')
    expect(clipsOf(p)[0]!.transform.simple).toBe('linear')
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })

  it('opens a mark it does not know as keyframes put by hand, with the same keyframes', () => {
    const c = clipsOf(saved('bounce'))[0]!
    expect('simple' in c.transform).toBe(false)
    expect(c.transform.keys!.map((k) => k.crop)).toEqual([c.transform.crop, closer])
  })
})

describe('a project the app could not have saved (audit 2026-10-01)', () => {
  /** A saved two-clip project, its text changed by `change` before it is read. */
  function read(change: (raw: Record<string, any>) => void): () => unknown {
    const raw = JSON.parse(joinProjectFile(project(media('a', 'D:\a.mp4'), media('b', 'D:\b.mp4')), defaultWorkspace()))
    change(raw)
    return () => splitProjectFile(JSON.stringify(raw))
  }
  const clips = (raw: Record<string, any>): Record<string, any>[] => raw.sequences[0].videoTracks[0].clips

  it('opens as it is when nothing is wrong', () => {
    expect(read(() => undefined)).not.toThrow()
  })

  it('is refused in words, never with a TypeError, for a source that is not one', () => {
    expect(read((raw) => raw.media.push(null))).toThrow('this project has a damaged source in it')
  })

  it('is refused for a frame rate it cannot be played at', () => {
    expect(read((raw) => (raw.fps = 0))).toThrow(/frame rate/)
    expect(read((raw) => (raw.fps = -30))).toThrow(/frame rate/)
  })

  it('is refused for two sources or two clips under one name', () => {
    expect(read((raw) => (raw.media[1].id = raw.media[0].id))).toThrow(/two sources/)
    expect(read((raw) => (clips(raw)[1]!.id = clips(raw)[0]!.id))).toThrow(/two clips/)
  })

  it('is refused for a clip of a source it does not have, or one that ends before it starts', () => {
    expect(read((raw) => (clips(raw)[0]!.mediaId = 'nowhere'))).toThrow(/source it does not have/)
    expect(read((raw) => (clips(raw)[0]!.sourceOut = clips(raw)[0]!.sourceIn))).toThrow(/ends before it starts/)
    expect(read((raw) => (clips(raw)[0]!.sourceOut = 1e15))).toThrow(/runs past any recording/)
  })
})
