import { describe, it, expect } from 'vitest'
import { EditListError, buildFromEditList, readEditList, type EditListV2, type SourceFacts } from '../../src/shared/edit-list'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { pictureGraph } from '../../src/shared/render-pictures'
import { type Project } from '../../src/shared/project'
import { firstTimeline } from '../project-helpers'

/**
 * Task 1188. A reel's grade: a look on every picture of the camera, the
 * camera half of the owner's OBS canvas, and nothing on the screen half. A
 * clip of the camera alone takes it as its look; the camera's picture in a
 * clip that also shows the screen takes it as that picture's own.
 */

const OBS = 'D:\\OBS\\obs.mkv'
const facts = new Map<string, SourceFacts>([[OBS, { durationSec: 60, width: 3840, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }]])

/** A Short: both halves stacked, a full-camera hook, the camera graded warm. */
function short(): EditListV2 {
  return {
    version: 2,
    shape: 'vertical',
    reels: [
      {
        sources: [{ id: 'obs', path: OBS, offsetSec: 0 }],
        main: 'obs',
        sound: 'obs',
        view: 'split',
        cuts: [],
        zooms: [],
        markers: [],
        shots: [{ fromSec: 0, toSec: 5, view: 'right', why: 'the hook' }],
        grade: { source: 'obs', view: 'right', look: 'warm', lookStrength: 35, adjust: { contrast: 8, saturation: 10 } }
      }
    ]
  }
}

function build(l: unknown = short()): Project {
  return buildFromEditList(readEditList(l), facts, 'short').project
}

function refusal(edit: (l: EditListV2) => void): string {
  const l = short()
  edit(l)
  try {
    build(l)
  } catch (err) {
    expect(err).toBeInstanceOf(EditListError)
    return (err as Error).message
  }
  throw new Error('the list was built, and should have been refused')
}

const WARM = { look: 'warm', lookStrength: 35, adjust: { contrast: 8, saturation: 10 } }

describe('a grade on the camera', () => {
  it('gives the full-camera shot the look, the camera picture of a split clip its own, and the screen nothing', () => {
    const [hook, rest] = firstTimeline(build()).videoTracks[0]!.clips
    expect({ look: hook!.look, lookStrength: hook!.lookStrength, adjust: hook!.adjust }).toEqual(WARM)
    expect(rest!.look).toBeUndefined()
    expect(rest!.adjust).toBeUndefined()
    expect(rest!.layers).toHaveLength(1)
    expect(rest!.layers[0]).toMatchObject(WARM)
  })

  it('reaches the camera in the corner, the same file listed again', () => {
    const l = short()
    const reel = l.reels[0]!
    reel.view = 'left'
    reel.shots = []
    reel.sources.push({ id: 'cam', path: OBS, offsetSec: 0 })
    reel.corner = { source: 'cam', at: 'bottom-right', view: 'right' }
    reel.grade!.source = 'cam'
    const t = firstTimeline(build(l))
    expect(t.videoTracks[0]!.clips.every((c) => c.look === undefined)).toBe(true)
    expect(t.videoTracks[1]!.clips.every((c) => c.look === 'warm')).toBe(true)
  })

  it('is kept by the project file, a layer\'s own look with it', () => {
    const p = build()
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })

  it("is drawn in the export on the layer's crop alone, after the clip's own", () => {
    const rest = firstTimeline(build()).videoTracks[0]!.clips[1]!
    const graph = pictureGraph(30, rest, 1080, 1920)
    const [head, , layerBranch] = graph.split(';')
    expect(head).not.toContain('colorchannelmixer')
    expect(graph.match(/colorchannelmixer/g)).toHaveLength(1)
    expect(layerBranch ?? graph).toContain('colorchannelmixer')
  })

  it('refuses a grade that names no source, no look, or a look Editbay has not', () => {
    expect(refusal((l) => (l.reels[0]!.grade!.source = 'cam'))).toMatch(/^reels\[0\]\.grade\.source: /)
    expect(refusal((l) => (l.reels[0]!.grade = { source: 'obs' }))).toMatch(/^reels\[0\]\.grade: changes nothing/)
    expect(refusal((l) => (l.reels[0]!.grade!.look = 'teal'))).toMatch(/^reels\[0\]\.grade\.look: must be one of/)
    expect(refusal((l) => (l.reels[0]!.grade!.adjust = { contrast: 120 }))).toMatch(/^reels\[0\]\.grade\.adjust\.contrast: /)
  })

  it('refuses a grade on a reel that never shows that camera, and one that would grade the screen with it', () => {
    expect(
      refusal((l) => {
        l.reels[0]!.view = 'left'
        l.reels[0]!.shots = []
      })
    ).toMatch(/^reels\[0\]\.grade: grades nothing/)
    expect(refusal((l) => (l.reels[0]!.grade!.view = 'left'))).toMatch(/^reels\[0\]\.grade: .*main picture is the camera/)
  })
})
