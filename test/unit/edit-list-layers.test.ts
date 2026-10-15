import { describe, it, expect } from 'vitest'
import { EditListError, buildFromEditList, readEditList, type EditListV1 as EditList, type EditListV2, type SourceFacts } from '../../src/shared/edit-list'
import { type Clip, type Project } from '../../src/shared/project'
import { firstTimeline } from '../project-helpers'

/**
 * Task 137. Pictures and overlay clips laid over the cut by an edit list's
 * `layers`: each an ordinary clip on a picture track above the cut, timed on
 * the main recording's clock as markers and zooms are.
 */

const SCREEN = 'D:\\OBS\\screen.mkv'
const SKETCH = 'D:\\Sketches\\plan.png'
const SUBSCRIBE = 'D:\\Assets\\subscribe-green.mp4'
const facts = new Map<string, SourceFacts>([
  [SCREEN, { durationSec: 60, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }],
  [SKETCH, { durationSec: 0, width: 1000, height: 1000, fps: 0, codec: 'png', hasAudio: false, hasVideo: true, audioTracks: 0, still: true }],
  [SUBSCRIBE, { durationSec: 5, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }]
])

/** A screen recording with 7 s taken out before 30 s, a sketch on the left half and the subscribe animation keyed. */
function list(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [{ id: 'screen', path: SCREEN, offsetSec: 0 }],
    main: 'screen',
    sound: 'screen',
    cuts: [
      { fromSec: 10, toSec: 12, why: 'pause' },
      { fromSec: 20, toSec: 25, why: 'retake' }
    ],
    zooms: [],
    markers: [],
    layers: [
      { path: SKETCH, fromSec: 30, toSec: 35, box: 'left-half', why: 'the sketch', mark: true },
      { path: SUBSCRIBE, fromSec: 40, key: 'green' }
    ]
  }
}

function build(l: unknown = list()): Project {
  return buildFromEditList(readEditList(l), facts, 'rough cut').project
}

function refusal(edit: (l: EditList) => void): string {
  const l = list()
  edit(l)
  try {
    build(l)
  } catch (err) {
    expect(err).toBeInstanceOf(EditListError)
    return (err as Error).message
  }
  throw new Error('the list was built, and should have been refused')
}

const layerClips = (p: Project): Clip[] =>
  firstTimeline(p)
    .videoTracks.filter((r) => r.id.startsWith('layer'))
    .flatMap((r) => r.clips)

describe('reading layers', () => {
  it('gives them back as written', () => {
    expect(readEditList(list())).toEqual(list())
  })

  it('takes a box in fractions of the frame', () => {
    const l = list()
    l.layers![0]!.box = { x: 0.6, y: 0.1, w: 0.35, h: 0.5 }
    expect(readEditList(l)).toEqual(l)
  })

  it('refuses a box it does not know, a key it does not know, and an end before the start', () => {
    const bad = (edit: (l: EditList) => void): string => {
      const l = list()
      edit(l)
      try {
        readEditList(l)
      } catch (err) {
        return (err as Error).message
      }
      return 'read'
    }
    expect(bad((l) => ((l.layers![0] as unknown as Record<string, unknown>).box = 'top-half'))).toBe('layers[0].box: must be one of full, left-half, right-half')
    expect(bad((l) => ((l.layers![1] as unknown as Record<string, unknown>).key = 'pink'))).toBe('layers[1].key: must be one of green, blue, black')
    expect(bad((l) => (l.layers![0]!.toSec = 29))).toBe('layers[0]: ends at 29 s, which is not after where it starts, 30 s')
    expect(bad((l) => ((l.layers![0] as unknown as Record<string, unknown>).at = 'left'))).toMatch(/^layers\[0\]\.at: is not a field/)
  })
})

describe('laying layers over the cut', () => {
  it('puts the picture on a track above the cut where its moments land, fitted in the left half', () => {
    const p = build()
    const t = firstTimeline(p)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'layer1'])
    const sketch = layerClips(p).find((c) => p.media.find((m) => m.id === c.mediaId)!.originalPath === SKETCH)!
    // 30 s with 7 s taken out before it lands at 23 s; on until 35 s, 5 s later.
    expect(sketch.timelineStart).toBe(23 * 30)
    expect(sketch.sourceOut - sketch.sourceIn).toBe(5 * 30)
    // A square picture in the left half of 1920x1080: 960 wide, centred top to bottom.
    expect(sketch.transform.place.x).toBeCloseTo(0, 3)
    expect(sketch.transform.place.w).toBeCloseTo(0.5, 3)
    expect(sketch.transform.place.y).toBeCloseTo(60 / 1080, 3)
    expect(sketch.transform.place.h).toBeCloseTo(960 / 1080, 3)
    expect(p.media.find((m) => m.originalPath === SKETCH)).toMatchObject({ still: true, hasAudio: false })
  })

  it('plays the overlay clip whole from where it lands, keyed, with its sound linked to it', () => {
    const p = build()
    const t = firstTimeline(p)
    const sub = layerClips(p).find((c) => p.media.find((m) => m.id === c.mediaId)!.originalPath === SUBSCRIBE)!
    expect(sub.timelineStart).toBe(33 * 30)
    expect(sub.sourceOut - sub.sourceIn).toBe(5 * 30)
    expect(sub.removeBackground).toEqual({ colour: 'green' })
    expect(sub.transform.place).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    const sound = t.audioTracks.flatMap((r) => r.clips).find((c) => c.mediaId === sub.mediaId)!
    expect(sound.timelineStart).toBe(sub.timelineStart)
    expect(sound.sourceOut - sound.sourceIn).toBe(5 * 30)
    expect(sound.link).toBeDefined()
    expect(sound.link).toBe(sub.link)
  })

  it('trims an overlay clip to its toSec', () => {
    const l = list()
    l.layers![1]!.toSec = 42
    const sub = layerClips(build(l)).find((c) => c.removeBackground)!
    expect(sub.sourceOut - sub.sourceIn).toBe(2 * 30)
  })

  it('marks where a layer comes in when asked', () => {
    expect(firstTimeline(build()).markers.map((m) => [m.frame, m.name])).toEqual([[23 * 30, 'the sketch']])
  })

  it('lays one file three times as one source, and overlapping layers on tracks of their own', () => {
    const l = list()
    l.layers = [
      { path: SUBSCRIBE, fromSec: 30 },
      { path: SUBSCRIBE, fromSec: 32 },
      { path: SUBSCRIBE, fromSec: 50 }
    ]
    const p = build(l)
    expect(p.media.filter((m) => m.originalPath === SUBSCRIBE)).toHaveLength(1)
    const t = firstTimeline(p)
    expect(t.videoTracks.slice(1).map((r) => [r.id, r.clips.map((c) => c.timelineStart / 30)])).toEqual([
      ['layer1', [23, 43]],
      ['layer2', [25]]
    ])
  })

  it('keeps the layer tracks above a later reel\'s corner', () => {
    const v2: EditListV2 = {
      version: 2,
      shape: 'landscape',
      reels: [
        { sources: [{ id: 'a', path: SCREEN, offsetSec: 0 }], main: 'a', sound: 'a', cuts: [], zooms: [], markers: [], layers: [{ path: SKETCH, fromSec: 1, toSec: 2 }] },
        {
          sources: [
            { id: 'a', path: SCREEN, offsetSec: 0 },
            { id: 'b', path: SUBSCRIBE, offsetSec: 0 }
          ],
          main: 'a',
          sound: 'a',
          corner: { source: 'b', at: 'top-left' },
          cuts: [],
          zooms: [],
          markers: []
        }
      ]
    }
    const t = firstTimeline(buildFromEditList(readEditList(v2), facts, 'two').project)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'v2', 'layer1'])
  })
})

describe('refusing layers that cannot be honoured', () => {
  it('refuses a picture with no end', () => {
    expect(refusal((l) => delete l.layers![0]!.toSec)).toBe(`layers[0].toSec: is missing: ${SKETCH} is a picture, so it needs to be told when to go`)
  })

  it('refuses a start inside a cut, as a marker is refused', () => {
    expect(refusal((l) => (l.layers![0]!.fromSec = 21))).toBe('layers[0].fromSec: is at 21 s, inside cuts[1], which is taken out')
  })

  it('refuses a clip running past the end of the cut', () => {
    expect(refusal((l) => (l.layers![1]!.fromSec = 58))).toBe("layers[1]: runs 3.00 s past the end of its reel's cut; start it earlier or give it an earlier toSec")
  })

  it('refuses a clip kept on longer than it lasts', () => {
    expect(refusal((l) => (l.layers![1]!.toSec = 50))).toBe(`layers[1].toSec: keeps it on for 10.00 s of the cut, longer than ${SUBSCRIBE}, 5.00 s`)
  })
})
