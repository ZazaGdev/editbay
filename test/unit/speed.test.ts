import { describe, it, expect } from 'vitest'
import { planRender, type RenderRequest } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import {
  addClip,
  addTrack,
  createTimeline,
  findClip,
  setClipOut,
  setZoomKeys,
  splitClip,
  joinClips,
  type Clip,
  type ProjectMedia,
  type SoundClip,
  type Timeline
} from '../../src/shared/project'
import { setSpeed, speedRefusal } from '../../src/shared/speed-edit'
import { cleanSpeed, soundHeard, speedLabel } from '../../src/shared/speed'
import { sourceAt, spanEnd, spanLength, timelineAt } from '../../src/shared/tracks'
import { tempoFilters } from '../../src/shared/render-sound'
import { seekFrom, timedRate } from '../../src/shared/render-pictures'
import { recordingFrame } from '../../src/shared/render-moves'
import { splitProjectFile, joinProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { createProject } from '../../src/shared/project'

/** Plan 105: a clip's speed, on the timeline and in the export. */

function media(id: string, durationSec = 10): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** Clips of 10 s each on V1, back to back, each with its sound linked on A1. */
function cut(...ids: string[]): Timeline {
  const base = createTimeline(30, { width: 1920, height: 1080 })
  return ids.reduce((p, id) => addClip({ ...p, media: [...p.media, media(id)] }, id), base)
}

const v1 = (t: Timeline): Clip[] => t.videoTracks[0]!.clips
const a1 = (t: Timeline): SoundClip[] => t.audioTracks[0]!.clips

function request(timeline: Timeline): RenderRequest {
  return {
    timeline,
    names: { project: 'p', sequence: 'Wide', joined: 'p' },
    preset: presetById('landscape'),
    mode: 'join',
    outputDir: 'D:\\out',
    scratchDir: 'D:\\out\\.scratch',
    filenamePattern: '{project}_{index}'
  }
}

describe('a speed fit to keep', () => {
  it('is held from 0.1x to 16x, to two places, and 1x is none at all', () => {
    expect(cleanSpeed(4)).toBe(4)
    expect(cleanSpeed(0.05)).toBe(0.1)
    expect(cleanSpeed(40)).toBe(16)
    expect(cleanSpeed(1.234)).toBe(1.23)
    expect(cleanSpeed(1)).toBeUndefined()
    expect(cleanSpeed('fast')).toBeUndefined()
    expect(speedLabel(0.5)).toBe('0.5x')
  })
})

describe('a clip at a speed on the timeline', () => {
  it('a 10 s clip at 4x is 2.5 s long, its sound with it, and the next shot moves up', () => {
    const p = cut('a', 'b')
    const t = setSpeed(p, v1(p)[0]!.id, { speed: 4 })
    const [a, b] = v1(t)
    expect(spanLength(a!)).toBe(75)
    expect(spanLength(a1(t)[0]!)).toBe(75)
    expect(a1(t)[0]!.speed).toBe(4)
    expect(b!.timelineStart).toBe(75)
    expect(a1(t)[1]!.timelineStart).toBe(75)
    // Still the whole of its recording.
    expect(a!.sourceIn).toBe(0)
    expect(a!.sourceOut).toBe(300)
  })

  it('at 0.5x it is 20 s, and the next shot moves on', () => {
    const p = cut('a', 'b')
    const t = setSpeed(p, v1(p)[0]!.id, { speed: 0.5 })
    expect(spanLength(v1(t)[0]!)).toBe(600)
    expect(v1(t)[1]!.timelineStart).toBe(600)
  })

  it('back at 1x it is as it was, with no speed kept', () => {
    const p = cut('a', 'b')
    const id = v1(p)[0]!.id
    const back = setSpeed(setSpeed(p, id, { speed: 0.75 }), id, { speed: 1 })
    expect(v1(back)[0]!.speed).toBeUndefined()
    expect(spanLength(v1(back)[0]!)).toBe(300)
    expect(v1(back)[1]!.timelineStart).toBe(300)
  })

  it('maps each frame of the timeline to its place in the recording, and back', () => {
    const p = cut('a')
    const t = setSpeed(p, v1(p)[0]!.id, { speed: 4 })
    const c = v1(t)[0]!
    expect(sourceAt(c, 10)).toBe(40)
    expect(timelineAt(c, 40)).toBe(10)
  })

  it('a split at 0.5x lands exactly where asked, and the two pieces still add up and join again', () => {
    const p = cut('a')
    const t = setSpeed(p, v1(p)[0]!.id, { speed: 0.5 })
    const s = splitClip(t, 301)
    const [x, y] = v1(s)
    expect(spanEnd(x!)).toBe(301)
    expect(y!.timelineStart).toBe(301)
    expect(spanEnd(y!)).toBe(600)
    expect(x!.sourceOut).toBe(150.5)
    const joined = joinClips(s, [x!.id, y!.id])
    expect(v1(joined)).toHaveLength(1)
    expect(spanLength(v1(joined)[0]!)).toBe(600)
  })

  it('a trim of its end moves the recording by its speed', () => {
    const p = cut('a')
    const t = setSpeed(p, v1(p)[0]!.id, { speed: 4 })
    const c = v1(t)[0]!
    // Asked to end on recording frame 200: 50 frames of the timeline.
    const trimmed = setClipOut(t, c.id, 200)
    expect(spanLength(v1(trimmed)[0]!)).toBe(50)
    expect(v1(trimmed)[0]!.sourceOut).toBe(200)
  })

  it('keeps zoom keyframes on the frames of the recording they were put on', () => {
    const p = cut('a')
    const id = v1(p)[0]!.id
    const crop = v1(p)[0]!.transform.crop
    const keyed = setZoomKeys(p, id, [
      { at: 0, crop },
      { at: 200, crop: { ...crop, w: crop.w / 2, h: crop.h / 2 } }
    ])
    const t = setSpeed(keyed, id, { speed: 4 })
    const c = v1(t)[0]!
    expect(c.transform.keys!.map((k) => k.at)).toEqual([0, 200])
    // On the timeline the second is a quarter as far in.
    expect(timelineAt(c, 200)).toBe(50)
  })

  it('off V1, slower needs room after it, and says so', () => {
    // Two 4 s pictures on V2 with no sound, at 0 and at 150.
    const base = addTrack(cut('a'), 'video', 'v2')
    const like = v1(base)[0]!
    const { link: _, ...plain } = like
    const p: Timeline = {
      ...base,
      media: [...base.media, media('o', 4), media('n', 4)],
      videoTracks: [
        base.videoTracks[0]!,
        {
          ...base.videoTracks[1]!,
          clips: [
            { ...plain, id: 'O', mediaId: 'o', sourceIn: 0, sourceOut: 120, timelineStart: 0 },
            { ...plain, id: 'N', mediaId: 'n', sourceIn: 0, sourceOut: 120, timelineStart: 150 }
          ]
        }
      ]
    }
    const overlay = p.videoTracks[1]!.clips[0]!
    expect(setSpeed(p, overlay.id, { speed: 0.5 })).toBe(p)
    expect(speedRefusal(p, overlay.id, 0.5)).toMatch(/no room/)
    // Faster leaves a gap.
    const fast = setSpeed(p, overlay.id, { speed: 2 })
    expect(spanLength(fast.videoTracks[1]!.clips.find((c) => c.mediaId === 'o')!)).toBe(60)
  })

  it('the switches change nothing about time', () => {
    const p = cut('a')
    const id = v1(p)[0]!.id
    const t = setSpeed(setSpeed(p, id, { speed: 4 }), id, { keepSound: true, plainFrames: true })
    expect(a1(t)[0]!.keepSound).toBe(true)
    expect(v1(t)[0]!.plainFrames).toBe(true)
    expect(spanLength(v1(t)[0]!)).toBe(75)
    const off = setSpeed(t, id, { keepSound: false })
    expect(a1(off)[0]!.keepSound).toBeUndefined()
  })
})

describe('sound at a speed', () => {
  it('is heard from 0.5x to 2x, and outside only when kept', () => {
    const at = (speed: number, keepSound?: true): boolean => soundHeard({ ...a1(cut('a'))[0]!, speed, ...(keepSound ? { keepSound } : {}) })
    expect(at(0.5)).toBe(true)
    expect(at(2)).toBe(true)
    expect(at(4)).toBe(false)
    expect(at(0.25)).toBe(false)
    expect(at(4, true)).toBe(true)
  })

  it('is stretched with its pitch kept, in halvings below half speed', () => {
    expect(tempoFilters(2)).toBe('atempo=2')
    expect(tempoFilters(0.25)).toBe('atempo=0.5,atempo=0.5')
    expect(tempoFilters(0.1)).toBe('atempo=0.5,atempo=0.5,atempo=0.5,atempo=0.8')
  })
})

describe('the export of a clip at a speed', () => {
  it('times its picture by its speed, blending slow motion unless plain frames are asked for', () => {
    expect(timedRate(30, { speed: 4, blend: false })).toBe('setpts=(PTS-STARTPTS)/4,fps=30:start_time=0')
    expect(timedRate(30, { speed: 0.5, blend: true })).toBe('setpts=(PTS-STARTPTS)/0.5,framerate=fps=30')
    expect(recordingFrame(10, 4)).toBe('(on*4+10)')
  })

  it('reads a head on a part frame from the whole frame before it, that part taken off its clock', () => {
    // Recording frame 10.5 at 30 fps: read from frame 10, half a frame early on its clock.
    expect(seekFrom(10.5, 30)).toEqual({ fromSec: '0.333333', part: 0.5 })
    expect(seekFrom(10, 30)).toEqual({ fromSec: '0.333333', part: 0 })
    expect(timedRate(30, { speed: 0.5, blend: false }, 0.5)).toBe('setpts=(PTS-STARTPTS-0.016667/TB)/0.5,fps=30:start_time=0')
  })

  it('at 4x is 75 frames, its sound silent; at 2x its sound is stretched', () => {
    const p = cut('a')
    const id = v1(p)[0]!.id
    const fast = planRender(request(setSpeed(p, id, { speed: 4 })))
    expect(fast.segments.reduce((n, s) => n + s.frames, 0)).toBe(75)
    const args4 = fast.segments[0]!.args
    expect(args4[args4.indexOf('-frames:v') + 1]).toBe('75')
    expect(args4.join(' ')).toContain('setpts=(PTS-STARTPTS)/4')
    expect(args4.join(' ')).toContain('anullsrc')
    const two = planRender(request(setSpeed(p, id, { speed: 2 }))).segments[0]!.args.join(' ')
    expect(two).toContain('atempo=2')
    expect(two).not.toContain('anullsrc')
  })
})

describe('a saved clip at a speed', () => {
  it('opens with its speed, its switches, and its ends part way between frames', () => {
    const p = cut('a')
    const id = v1(p)[0]!.id
    const t = splitClip(setSpeed(setSpeed(p, id, { speed: 0.5 }), id, { keepSound: true }), 301)
    const project = { ...createProject('x', 30, { width: 1920, height: 1080 }), media: t.media }
    const seq = project.sequences[0]!
    const saved = { ...project, sequences: [{ ...seq, videoTracks: t.videoTracks, audioTracks: t.audioTracks }] }
    const back = splitProjectFile(joinProjectFile(saved, defaultWorkspace()))
    const clips = back.project.sequences[0]!.videoTracks[0]!.clips
    expect(clips[0]!.speed).toBe(0.5)
    expect(clips[0]!.sourceOut).toBe(150.5)
    expect(back.project.sequences[0]!.audioTracks[0]!.clips[0]!.keepSound).toBe(true)
    expect(findClip(t, clips[1]!.id)).not.toBeNull()
  })
})
