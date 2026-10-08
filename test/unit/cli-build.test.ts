import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditListError, buildFromEditList, cutsReport, projectFromEditList, readEditList, type EditListV1 as EditList, type EditListV2, type SourceFacts } from '../../src/shared/edit-list'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { pipCorner } from '../../src/shared/pip'
import { pipOf, type Clip, type Project, type SoundClip } from '../../src/shared/project'
import { firstTimeline } from '../project-helpers'

/**
 * Plan 74. `npm run cli -- build`: a project made from an edit list with the
 * app's own editing code, so it is one the app could have made by hand. The
 * ids are counted rather than random here, so the file it writes can be
 * compared with the last one written.
 */

const ids = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../src/shared/ids', () => ({ newId: (): string => `id-${++ids.n}` }))

beforeEach(() => {
  ids.n = 0
})

const FACTS: Record<string, SourceFacts> = {
  screen: { durationSec: 60, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 2 },
  camera: { durationSec: 70, width: 1280, height: 720, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }
}
/** Where the two files are, which is what probing is keyed by. */
const SCREEN = 'D:\\OBS\\screen.mkv'
const CAMERA = 'D:\\Phone\\camera.mp4'
const facts = new Map([
  [SCREEN, FACTS.screen!],
  [CAMERA, FACTS.camera!]
])

/** The owner's OBS canvas: the screen on the left half, the camera on the right, 3840x1080 at 60 fps. */
const OBS: SourceFacts = { durationSec: 60, width: 3840, height: 1080, fps: 60, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 6 }

/** A list over one OBS recording, shown as its screen with its own camera half in the corner. */
function obsList(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [
      { id: 'obs', path: 'D:\\OBS\\obs.mkv', offsetSec: 0 },
      { id: 'cam', path: 'D:\\OBS\\obs.mkv', offsetSec: 0 }
    ],
    main: 'obs',
    sound: 'obs',
    view: 'left',
    corner: { source: 'cam', at: 'bottom-right', view: 'right' },
    cuts: [{ fromSec: 10, toSec: 12, why: 'pause' }],
    zooms: [{ fromSec: 20, toSec: 25, rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, how: 'cut' }],
    markers: []
  }
}

const obsFacts = new Map([['D:\\OBS\\obs.mkv', OBS]])

/**
 * A screen recording with a phone camera in the corner whose recording began
 * 2 s before the screen's, cut to its first 50 s with three stretches out.
 */
function list(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [
      { id: 'screen', path: 'D:\\OBS\\screen.mkv', offsetSec: 0 },
      { id: 'camera', path: 'D:\\Phone\\camera.mp4', offsetSec: -2 }
    ],
    main: 'screen',
    sound: 'screen',
    corner: { source: 'camera', at: 'bottom-right' },
    range: { fromSec: 0, toSec: 50 },
    cuts: [
      { fromSec: 20, toSec: 25, why: 'retake', words: 'so this is the, so this is', mark: true },
      { fromSec: 10, toSec: 12, why: 'pause', mark: false }
    ],
    zooms: [
      { fromSec: 30, toSec: 35, rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, how: 'cut', why: 'the export button', mark: true },
      { fromSec: 40, toSec: 44, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, how: 'smooth' }
    ],
    markers: [{ atSec: 45, label: 'Check the ending' }]
  }
}

function build(l: unknown = list()): Project {
  return projectFromEditList(readEditList(l), facts, 'rough cut')
}

function refusal(edit: (l: EditList) => void, given = facts): string {
  const l = list()
  edit(l)
  try {
    projectFromEditList(readEditList(l), given, 'rough cut')
  } catch (err) {
    expect(err).toBeInstanceOf(EditListError)
    return (err as Error).message
  }
  throw new Error('the list was built, and should have been refused')
}

const spans = (clips: readonly (Clip | SoundClip)[]): number[][] => clips.map((c) => [c.sourceIn, c.sourceOut, c.timelineStart])

describe('a project made from an edit list', () => {
  it('writes the same file every time', () => {
    expect(joinProjectFile(build(), defaultWorkspace())).toMatchSnapshot()
  })

  it('reads back through the project file unchanged', () => {
    const p = build()
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })

  it('is in the shape asked for, at the rate a new project has', () => {
    const p = build()
    expect(p.fps).toBe(30)
    expect(p.sequences[0]!.presetId).toBe('landscape')
    expect(p.sequences[0]!.output).toEqual({ width: 1920, height: 1080 })
    expect(p.name).toBe('rough cut')
  })

  it('names every source so that opening it imports each one through the app', () => {
    for (const m of build().media) {
      expect(m.conformed).toBe(true)
      expect([m.playablePath, m.peaksPath, m.filmstripPath]).toEqual(['', '', ''])
    }
    expect(build().media.map((m) => [m.id, m.originalPath])).toEqual([
      ['screen', 'D:\\OBS\\screen.mkv'],
      ['camera', 'D:\\Phone\\camera.mp4']
    ])
  })

  it('lays the kept parts on V1 in order with no gaps, the range and the cuts left out', () => {
    // At 30 fps: out are 10 s to 12 s, 20 s to 25 s, and 50 s to the end.
    expect(spans(firstTimeline(build()).videoTracks[0]!.clips)).toEqual([
      [0, 300, 0],
      [360, 600, 300],
      [750, 1500, 540]
    ])
  })

  it('puts the main source\'s sound on A1 under each piece, linked to it', () => {
    const t = firstTimeline(build())
    const pictures = t.videoTracks[0]!.clips
    const sounds = t.audioTracks[0]!.clips
    expect(spans(sounds)).toEqual(spans(pictures))
    for (const [i, s] of sounds.entries()) {
      expect(s.mediaId).toBe('screen')
      expect(s.track).toBe(0)
      expect(s.muted).toBe(false)
      expect(s.link).toBeDefined()
      expect(s.link).toBe(pictures[i]!.link)
    }
  })

  it('plays another of the sound source\'s tracks when asked', () => {
    const l = list()
    l.soundTrack = 1
    expect(firstTimeline(build(l)).audioTracks[0]!.clips.map((c) => c.track)).toEqual([1, 1, 1])
  })

  it('puts the camera in the bottom right corner, in step with the screen and cut with it', () => {
    const t = firstTimeline(build())
    const corner = t.videoTracks[1]!.clips
    // The camera began 2 s, 60 frames, before the screen.
    expect(spans(corner)).toEqual([
      [60, 360, 0],
      [420, 660, 300],
      [810, 1560, 540]
    ])
    for (const [i, c] of corner.entries()) {
      expect(c.mediaId).toBe('camera')
      expect(c.link).toBe(t.videoTracks[0]!.clips[i]!.link)
      const pip = pipOf(t, c.id)
      expect(pip).not.toBeNull()
      expect(pipCorner(pip!.place, 1920, 1080).corner).toBe('br')
    }
  })

  it('lines up a corner source that began after the main one', () => {
    const l = list()
    l.sources[1]!.offsetSec = 5
    delete l.range
    l.cuts = []
    l.zooms = []
    l.markers = []
    // Its 0 s is 5 s into the screen, and it runs past the screen's end, which it is cut to.
    expect(spans(firstTimeline(build(l)).videoTracks[1]!.clips)).toEqual([[0, 1650, 150]])
  })

  it('takes the sound from another source when asked, lined up by its offset', () => {
    const l = list()
    l.sound = 'camera'
    const t = firstTimeline(build(l))
    expect(t.audioTracks.flatMap((r) => r.clips).map((c) => c.mediaId)).toEqual(['camera', 'camera', 'camera'])
    expect(spans(t.audioTracks[0]!.clips)).toEqual(spans(t.videoTracks[1]!.clips))
    // No picture of the camera is left over on a track of its own.
    expect(t.videoTracks).toHaveLength(2)
  })

  it('takes the sound from a source that is not in the corner, without its picture', () => {
    const l = list()
    delete l.corner
    l.sound = 'camera'
    const t = firstTimeline(build(l))
    expect(t.videoTracks).toHaveLength(1)
    expect(spans(t.audioTracks[0]!.clips)).toEqual([
      [60, 360, 0],
      [420, 660, 300],
      [810, 1560, 540]
    ])
    expect(t.audioTracks[0]!.clips.map((c) => c.link)).toEqual(t.videoTracks[0]!.clips.map((c) => c.link))
  })

  it('makes a cut zoom jump in and out, and a smooth one ease over half a second', () => {
    const piece = firstTimeline(build()).videoTracks[0]!.clips[2]!
    const keys = piece.transform.keys!
    expect(keys.map((k) => [k.at, k.ease ?? 'smooth'])).toEqual([
      [899, 'hold'],
      [900, 'hold'],
      [1050, 'smooth'],
      [1200, 'smooth'],
      [1215, 'smooth'],
      [1305, 'smooth'],
      [1320, 'smooth']
    ])
    const full = { x: 0, y: 0, w: 1920, h: 1080 }
    // The top right quarter, and the middle quarter, of a 1920x1080 picture.
    expect(keys.map((k) => k.crop)).toEqual([full, { x: 960, y: 0, w: 960, h: 540 }, full, full, { x: 480, y: 270, w: 960, h: 540 }, { x: 480, y: 270, w: 960, h: 540 }, full])
  })

  it('leaves the pieces before the zooms still', () => {
    // Each keeps only the first keyframe after its end, as a split leaves it: the whole picture.
    const t = firstTimeline(build())
    for (const piece of t.videoTracks[0]!.clips.slice(0, 2)) {
      expect((piece.transform.keys ?? []).map((k) => k.crop)).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }])
      expect(piece.transform.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    }
  })

  it('puts one marker on each noted entry, where it lands in the cut', () => {
    // The retake's join at 20 s, 2 s already out: 540. The zoom at 30 s, 7 s
    // out: 690. The free marker at 45 s: 1140.
    expect(firstTimeline(build()).markers.map((m) => [m.frame, m.name])).toEqual([
      [540, 'Retake: "so this is the, so this is"'],
      [690, 'Zoom: the export button'],
      [1140, 'Check the ending']
    ])
  })

  it('names both entries on a marker when two land on the same frame', () => {
    const l = list()
    l.markers.push({ atSec: 25, label: 'Second take starts' })
    expect(firstTimeline(build(l)).markers.find((m) => m.frame === 540)?.name).toBe('Retake: "so this is the, so this is" / Second take starts')
  })

  it('takes the whole recording when there is no range, and stops at its end when the range runs past it', () => {
    const l = list()
    l.range = { fromSec: 5, toSec: 500 }
    l.zooms = []
    l.markers = []
    expect(spans(firstTimeline(build(l)).videoTracks[0]!.clips)).toEqual([
      [150, 300, 0],
      [360, 600, 150],
      [750, 1800, 390]
    ])
  })
})

describe('refusing what cannot be honoured', () => {
  it('refuses a source that was not probed', () => {
    expect(refusal(() => undefined, new Map([[SCREEN, FACTS.screen!]]))).toMatch(/^sources\[1\]: /)
  })

  it('refuses a main source with no picture, and a sound source with no sound', () => {
    const silent = new Map(facts)
    silent.set(CAMERA, { ...FACTS.camera!, hasAudio: false, audioTracks: 0 })
    expect(refusal((l) => (l.sound = 'camera'), silent)).toMatch(/^sound: /)
    const voice = new Map(facts)
    voice.set(SCREEN, { ...FACTS.screen!, hasVideo: false, width: 0, height: 0 })
    expect(refusal(() => undefined, voice)).toMatch(/^main: /)
  })

  it('refuses a sound track the source does not have', () => {
    expect(refusal((l) => (l.soundTrack = 2))).toMatch(/^soundTrack: /)
  })

  it('refuses a range that starts after the main source ends', () => {
    expect(refusal((l) => (l.range = { fromSec: 61, toSec: 70 }))).toMatch(/^range: /)
  })

  it('refuses a list that cuts everything out', () => {
    expect(refusal((l) => (l.cuts = [{ fromSec: 0, toSec: 50, why: 'other' }]))).toMatch(/nothing/)
  })

  it('refuses a cut too short to take a frame out', () => {
    expect(refusal((l) => l.cuts.push({ fromSec: 30.001, toSec: 30.01, why: 'pause' }))).toMatch(/^cuts\[2\]: /)
  })

  it('refuses a zoom that falls inside a cut', () => {
    expect(refusal((l) => l.zooms.push({ fromSec: 21, toSec: 23, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, how: 'cut' }))).toMatch(/^zooms\[2\]: .*cuts\[0\]/)
  })

  it('refuses a zoom outside the range', () => {
    expect(refusal((l) => l.zooms.push({ fromSec: 52, toSec: 55, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, how: 'cut' }))).toMatch(/^zooms\[2\]: /)
  })

  it('refuses a zoom that would show more than the picture, or come closer than Editbay goes', () => {
    expect(refusal((l) => (l.zooms[1]!.rect = { x: 0, y: 0, w: 1, h: 1 }))).toMatch(/^zooms\[1\]\.rect: /)
    expect(refusal((l) => (l.zooms[1]!.rect = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }))).toMatch(/^zooms\[1\]\.rect: /)
  })

  it('refuses a marker inside a cut, or past the end', () => {
    expect(refusal((l) => l.markers.push({ atSec: 11, label: 'x' }))).toMatch(/^markers\[1\]: .*cuts\[1\]/)
    expect(refusal((l) => l.markers.push({ atSec: 55, label: 'x' }))).toMatch(/^markers\[1\]: /)
  })

  it('refuses a corner source that never overlaps the main one', () => {
    expect(refusal((l) => (l.sources[1]!.offsetSec = -80))).toMatch(/^sources\[1\]\.offsetSec: /)
  })

  it('refuses a corner in a shape with no frame to put it in', () => {
    expect(refusal((l) => (l.shape = 'handoff'))).toMatch(/^corner: /)
  })

  it('refuses a smooth zoom too short to ease in and out of, rather than dropping it', () => {
    expect(refusal((l) => (l.zooms[1] = { fromSec: 40, toSec: 40.04, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, how: 'smooth' }))).toMatch(/^zooms\[1\]: .*too short/)
  })

  it('refuses a view of a recording that is not side by side', () => {
    expect(refusal((l) => (l.view = 'left'))).toMatch(/^view: .*not a side-by-side/)
    expect(refusal((l) => (l.corner!.view = 'right'))).toMatch(/^corner\.view: /)
  })
})

describe('a half of a side-by-side recording', () => {
  const build2 = (l: EditList): Project => projectFromEditList(readEditList(l), obsFacts, 'obs cut')

  it('writes the same file every time', () => {
    expect(joinProjectFile(build2(obsList()), defaultWorkspace())).toMatchSnapshot()
  })

  it('frames the left half or the right half of the canvas, whole', () => {
    const t = firstTimeline(build2(obsList()))
    expect(t.videoTracks[0]!.clips[0]!.transform.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    const l = obsList()
    l.view = 'right'
    l.zooms = []
    expect(firstTimeline(build2(l)).videoTracks[0]!.clips[0]!.transform.crop).toEqual({ x: 1920, y: 0, w: 1920, h: 1080 })
  })

  it('starts on the middle of the canvas without a view, as a source dropped in the app does', () => {
    const l = obsList()
    delete l.view
    l.zooms = []
    expect(firstTimeline(build2(l)).videoTracks[0]!.clips[0]!.transform.crop).toEqual({ x: 960, y: 0, w: 1920, h: 1080 })
  })

  it('shows the half asked for in the corner box', () => {
    const t = firstTimeline(build2(obsList()))
    for (const c of t.videoTracks[1]!.clips) {
      expect(c.transform.crop.x).toBeGreaterThanOrEqual(1920)
      expect(c.transform.crop.x + c.transform.crop.w).toBeLessThanOrEqual(3840)
      expect(pipCorner(c.transform.place, 1920, 1080).corner).toBe('br')
    }
    const l = obsList()
    l.corner!.view = 'left'
    for (const c of firstTimeline(build2(l)).videoTracks[1]!.clips) expect(c.transform.crop.x + c.transform.crop.w).toBeLessThanOrEqual(1920)
  })

  it("reads a zoom's rectangle in fractions of the half shown, not of the whole canvas", () => {
    // The top right quarter of the left half: x 960 to 1920, y 0 to 540.
    const piece = firstTimeline(build2(obsList())).videoTracks[0]!.clips[1]!
    expect(piece.transform.keys!.find((k) => k.at === 600)!.crop).toEqual({ x: 960, y: 0, w: 960, h: 540 })
  })

  it('refuses a zoom past the edge of the half it is in', () => {
    const l = obsList()
    l.view = 'right'
    l.zooms[0]!.rect = { x: 0, y: 0, w: 1, h: 1 }
    expect(() => build2(l)).toThrow(/^zooms\[0\]\.rect: .*not a punch-in/)
  })
})

describe('cut zooms at the edges', () => {
  const keysOf = (l: EditList): [number, string][] => {
    const clips = firstTimeline(projectFromEditList(readEditList(l), facts, 'x')).videoTracks[0]!.clips
    return clips[clips.length - 1]!.transform.keys!.map((k) => [k.at, k.ease ?? 'smooth'])
  }
  const plain = (): EditList => {
    const l = list()
    delete l.corner
    delete l.range
    l.cuts = []
    l.markers = []
    l.zooms = []
    return l
  }
  const rect = { x: 0.5, y: 0, w: 0.5, h: 0.5 }

  it('stays in to the last frame when it runs to the end of the recording', () => {
    const l = plain()
    l.zooms = [{ fromSec: 50, toSec: 60, rect, how: 'cut' }]
    // In on 1500 and held: no keyframe pulls it back out on the last frame.
    expect(keysOf(l)).toEqual([
      [1499, 'hold'],
      [1500, 'hold']
    ])
  })

  it('holds the first of two zooms that meet on one frame until the second starts', () => {
    const l = plain()
    l.zooms = [
      { fromSec: 10, toSec: 20, rect, how: 'cut' },
      { fromSec: 20, toSec: 30, rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, how: 'cut' }
    ]
    expect(keysOf(l).map(([at]) => at)).toEqual([299, 300, 600, 900])
  })
})


/**
 * Plan 75: reels laid end to end, and shots that change a reel's framing
 * for a stretch, on the owner's OBS canvas: screen left, camera right.
 */
describe('a version 2 list of reels and shots', () => {
  const TWO = 'D:\\OBS\\two.mkv'
  const reelFacts = new Map([
    ['D:\\OBS\\obs.mkv', OBS],
    [TWO, { ...OBS, durationSec: 20 }]
  ])
  function reels(): EditListV2 {
    return {
      version: 2,
      shape: 'landscape',
      reels: [
        {
          sources: [
            { id: 'a', path: 'D:\\OBS\\obs.mkv', offsetSec: 0 },
            { id: 'a-cam', path: 'D:\\OBS\\obs.mkv', offsetSec: 0 }
          ],
          main: 'a',
          sound: 'a',
          view: 'left',
          corner: { source: 'a-cam', at: 'bottom-right', view: 'right' },
          cuts: [{ fromSec: 10, toSec: 12, why: 'pause' }],
          zooms: [],
          markers: [],
          shots: [{ fromSec: 40, toSec: 50, view: 'right', corner: false, why: 'closing lines to camera', mark: true }]
        },
        {
          sources: [{ id: 'a', path: TWO, offsetSec: 0 }],
          main: 'a',
          sound: 'a',
          view: 'left',
          cuts: [],
          zooms: [],
          markers: [{ atSec: 5, label: 'Second file' }]
        }
      ]
    }
  }
  const build3 = (l: EditListV2 = reels()) => buildFromEditList(readEditList(l), reelFacts, 'episode')
  const refused = (edit: (l: EditListV2) => void): string => {
    const l = reels()
    edit(l)
    try {
      build3(l)
    } catch (err) {
      expect(err).toBeInstanceOf(EditListError)
      return (err as Error).message
    }
    throw new Error('the list was built, and should have been refused')
  }
  const LEFT = { x: 0, y: 0, w: 1920, h: 1080 }
  const RIGHT = { x: 1920, y: 0, w: 1920, h: 1080 }

  it('lays the reels one after another, and says where each starts', () => {
    const { project, reels: placed } = build3()
    // Reel 1: 60 s less the 2 s cut, 1740 frames; reel 2 after it, 20 s.
    expect(placed).toEqual([
      { startFrame: 0, endFrame: 1740 },
      { startFrame: 1740, endFrame: 2340 }
    ])
    const v1 = firstTimeline(project).videoTracks[0]!.clips
    expect(spans(v1)).toEqual([
      [0, 300, 0],
      [360, 1200, 300],
      [1200, 1500, 1140],
      [1500, 1800, 1440],
      [0, 600, 1740]
    ])
    expect(v1.map((c) => c.mediaId)).toEqual(['reel1.a', 'reel1.a', 'reel1.a', 'reel1.a', 'reel2.a'])
  })

  it('names every source by its reel, so two reels may use the same ids', () => {
    expect(build3().project.media.map((m) => m.id)).toEqual(['reel1.a', 'reel1.a-cam', 'reel2.a'])
  })

  it('shows the camera half full frame for the shot, and the screen half either side', () => {
    const v1 = firstTimeline(build3().project).videoTracks[0]!.clips
    expect(v1.map((c) => c.transform.crop)).toEqual([LEFT, LEFT, RIGHT, LEFT, LEFT])
  })

  it('hides the corner for the shot only', () => {
    const v2 = firstTimeline(build3().project).videoTracks[1]!.clips
    expect(v2.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn])).toEqual([
      [0, 300],
      [300, 840],
      [1440, 300]
    ])
  })

  it('keeps every piece of picture linked to its sound, cut together at the shot\'s edges', () => {
    const t = firstTimeline(build3().project)
    const pictures = t.videoTracks[0]!.clips
    const sounds = t.audioTracks[0]!.clips
    expect(spans(sounds)).toEqual(spans(pictures))
    sounds.forEach((s, i) => expect(s.link).toBe(pictures[i]!.link))
    expect(new Set(pictures.map((c) => c.link)).size).toBe(pictures.length)
  })

  it('marks the shot, and puts a later reel\'s markers on its own stretch', () => {
    expect(firstTimeline(build3().project).markers.map((m) => [m.frame, m.name])).toEqual([
      [1140, 'Shot: closing lines to camera'],
      [1890, 'Second file']
    ])
  })

  it('reads a zoom inside a shot in fractions of the shot\'s half', () => {
    const l = reels()
    l.reels[0]!.zooms = [{ fromSec: 42, toSec: 45, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, how: 'cut' }]
    const piece = firstTimeline(build3(l).project).videoTracks[0]!.clips[2]!
    expect(piece.transform.keys!.find((k) => k.at === 1260)!.crop).toEqual({ x: 2880, y: 540, w: 960, h: 540 })
  })

  it('refuses a zoom that crosses a shot\'s edge, naming both', () => {
    expect(refused((l) => (l.reels[0]!.zooms = [{ fromSec: 38, toSec: 42, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, how: 'cut' }]))).toMatch(
      /^reels\[0\]\.zooms\[0\]: crosses the edge of reels\[0\]\.shots\[0\]/
    )
  })

  it('refuses a shot inside a cut, and a shot view on a recording that is not side by side', () => {
    expect(refused((l) => (l.reels[0]!.shots = [{ fromSec: 10.5, toSec: 11.5, view: 'right', why: 'x' }]))).toMatch(/^reels\[0\]\.shots\[0\]: falls inside reels\[0\]\.cuts\[0\]/)
    const flat = new Map(reelFacts)
    flat.set('D:\\OBS\\obs.mkv', { ...OBS, width: 1920 })
    const l = reels()
    delete l.reels[0]!.view
    delete l.reels[0]!.corner!.view
    l.reels[0]!.shots![0]!.corner = true
    expect(() => buildFromEditList(readEditList(l), flat, 'x')).toThrow(/^reels\[0\]\.shots\[0\]\.view: /)
  })

  it('gives a one-reel version 2 list the same cut as the version 1 list it rewrites', () => {
    const v1 = obsList()
    const { version: _v, shape, ...body } = v1
    const v2: EditListV2 = { version: 2, shape, reels: [body] }
    const one = firstTimeline(projectFromEditList(readEditList(v1), obsFacts, 'x'))
    const two = firstTimeline(projectFromEditList(readEditList(v2), obsFacts, 'x'))
    const shape2 = (t: typeof one): unknown => [t.videoTracks, t.audioTracks].map((rs) => rs.map((r) => r.clips.map((c) => [c.sourceIn, c.sourceOut, c.timelineStart, 'transform' in c ? c.transform.crop : null])))
    expect(shape2(two)).toEqual(shape2(one))
  })
})

describe('the cuts in the report (edit list, words)', () => {
  it('lists every cut by reel and in order, with its words, marked or not', () => {
    const l = obsList()
    l.cuts = [
      { fromSec: 30, toSec: 31, why: 'retake', words: ' so this is the, so this is ' },
      { fromSec: 10, toSec: 12, why: 'pause' },
      { fromSec: 20, toSec: 21, why: 'false-start', words: '   ' }
    ]
    expect(cutsReport(l)).toEqual([
      { reel: 0, fromSec: 10, toSec: 12, why: 'pause' },
      { reel: 0, fromSec: 20, toSec: 21, why: 'false-start' },
      { reel: 0, fromSec: 30, toSec: 31, why: 'retake', words: 'so this is the, so this is' }
    ])
    const two: EditListV2 = { version: 2, shape: 'landscape', reels: [{ ...obsList(), cuts: [] }, obsList()].map(({ version: _v, shape: _s, ...r }) => r) }
    expect(cutsReport(two).map((c) => c.reel)).toEqual([1])
  })
})
