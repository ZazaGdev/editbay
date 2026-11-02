import { describe, it, expect } from 'vitest'
import { EditListError, buildFromEditList, readEditList, type EditListV1 as EditList, type SourceFacts } from '../../src/shared/edit-list'
import { type Project } from '../../src/shared/project'
import { DEFAULT_SOUND_KIND } from '../../src/shared/transitions'
import { firstTimeline } from '../project-helpers'

/**
 * Task 139. `endDipToBlackSec` ends the cut with a dip to black: an ordinary
 * transition on the out edge of every clip that ends where the cut ends,
 * wholly inside it, so the app shows it and can still change it.
 */

const SCREEN = 'D:\\OBS\\screen.mkv'
const CAMERA = 'D:\\Phone\\camera.mp4'
const facts = new Map<string, SourceFacts>([
  [SCREEN, { durationSec: 60, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }],
  [CAMERA, { durationSec: 60, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }]
])

/** A screen recording with the camera in a corner and 8 s taken out near the end, ending on a 2 s piece. */
function list(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [
      { id: 'screen', path: SCREEN, offsetSec: 0 },
      { id: 'camera', path: CAMERA, offsetSec: 0 }
    ],
    main: 'screen',
    sound: 'screen',
    corner: { source: 'camera', at: 'bottom-right' },
    cuts: [{ fromSec: 50, toSec: 58, why: 'retake' }],
    zooms: [],
    markers: [],
    endDipToBlackSec: 2
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

describe('an edit list ending with a dip to black', () => {
  it('dips the last picture, the corner and the sound out over their last 2 s', () => {
    const t = firstTimeline(build())
    const pictures = t.videoTracks.map((r) => r.clips.at(-1)!)
    expect(pictures.length).toBe(2)
    for (const c of pictures) expect(c.transitionOut).toEqual({ kind: 'toBlack', length: 60, before: 60 })
    const sounds = t.audioTracks.flatMap((r) => r.clips.slice(-1))
    expect(sounds.length).toBeGreaterThan(0)
    for (const c of sounds) expect(c.transitionOut).toEqual({ kind: DEFAULT_SOUND_KIND, length: 60, before: 60 })
  })

  it('leaves every earlier clip and edge alone', () => {
    const t = firstTimeline(build())
    const v1 = t.videoTracks[0]!.clips
    expect(v1.length).toBe(2)
    expect(v1[0]!.transitionOut).toBeUndefined()
    expect(v1[1]!.transitionIn).toBeUndefined()
  })

  it('puts no transition anywhere without the field', () => {
    const l = list()
    delete l.endDipToBlackSec
    const t = firstTimeline(build(l))
    const all = [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)]
    expect(all.every((c) => c.transitionOut === undefined && c.transitionIn === undefined)).toBe(true)
  })

  it('dips only the end of the last reel of a version 2 list', () => {
    const { version: _v, shape: _s, endDipToBlackSec: _d, ...reel } = list()
    const t = firstTimeline(build({ version: 2, shape: 'landscape', reels: [reel, reel], endDipToBlackSec: 2 }))
    const v1 = t.videoTracks[0]!.clips
    expect(v1.length).toBe(4)
    expect(v1.filter((c) => c.transitionOut !== undefined)).toEqual([v1[3]])
  })

  it('refuses a dip of no length', () => {
    expect(refusal((l) => (l.endDipToBlackSec = 0))).toMatch(/^endDipToBlackSec: /)
  })

  it('refuses a dip longer than the last piece of the cut, saying how long that is', () => {
    expect(refusal((l) => (l.cuts = [{ fromSec: 50, toSec: 59, why: 'retake' }]))).toMatch(/^endDipToBlackSec: .*1\.00 s/)
  })
})
