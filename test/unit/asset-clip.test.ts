import { describe, it, expect } from 'vitest'
import { addClip, createProject, editSequence, setClipOut, type Project, type ProjectMedia } from '../../src/shared/project'
import { assetCut } from '../../src/shared/asset-clip'
import { S1, firstTimeline } from '../project-helpers'

function source(id: string, still = false): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: !still,
    peaksPath: '',
    filmstripPath: '',
    ...(still ? { still: true } : {})
  }
}

/** A recording on V1 from 0 to 150, its sound linked under it, and a picture after it. */
function project(): Project {
  const p = createProject('t', 30, { width: 1920, height: 1080 })
  return editSequence({ ...p, media: [source('rec'), source('pic', true)] }, S1, (t) => addClip(setClipOut(addClip(t, 'rec', 'r'), 'r', 150), 'pic', 'p'))
}

describe('a clip saved as an asset (plan 96)', () => {
  const t = firstTimeline(project())
  const sound = t.audioTracks.flatMap((r) => r.clips).find((c) => c.link !== undefined && c.timelineStart === 0)!

  it('is a video with its sound when the video clip and its linked sound are both saved, and nothing else is in it', () => {
    const cut = assetCut(t, ['r', sound.id])!
    expect(cut).toMatchObject({ kind: 'video', sound: true, from: 0, to: 150 })
    expect(cut.timeline.videoTracks.flatMap((r) => r.clips).map((c) => c.id)).toEqual(['r'])
    expect(cut.timeline.audioTracks.flatMap((r) => r.clips).map((c) => c.id)).toEqual([sound.id])
    expect(cut.timeline.captions.clips).toEqual([])
  })

  it('is a video with no sound when the video clip is saved alone', () => {
    expect(assetCut(t, ['r'])).toMatchObject({ kind: 'video', sound: false })
  })

  it('is a sound when the sound clip is saved alone', () => {
    expect(assetCut(t, [sound.id])).toMatchObject({ kind: 'audio', sound: true, from: 0, to: 150 })
  })

  it('is an image for a still picture alone, over the stretch it covers', () => {
    const cut = assetCut(t, ['p'])!
    expect(cut.kind).toBe('image')
    expect(cut.from).toBe(150)
  })

  it('is nothing when none of the clips is on the timeline', () => {
    expect(assetCut(t, ['gone'])).toBeNull()
  })
})
