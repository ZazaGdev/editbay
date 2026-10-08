import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  addTrack,
  closeUpClip,
  cornerPlace,
  createTimeline,
  findVideoClip,
  moveClip,
  placeSource,
  removeClip,
  setClipAudio,
  setCrop,
  setPlace,
  setShape,
  trackOf,
  v1Clips,
  type Clip,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { FULL_PLACE, placeAspect } from '../../src/shared/layout'
import { planRender, spansOf, type RenderRequest } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'

function media(id: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
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
    filmstripPath: '',
    ...overrides
  }
}

/** A vertical sequence: V1 holding a (300 frames) then b (120), and a phone clip to lay over them. */
function base(presetId = 'vertical'): Timeline {
  const output = presetId === 'landscape' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }
  const t = createTimeline(30, output, presetId)
  const withMedia = {
    ...t,
    media: [media('a', 10), media('b', 4), media('phone', 4, { width: 1080, height: 1920 }), media('song', 20, { hasVideo: false, width: 0, height: 0 })]
  }
  return addClip(addClip(withMedia, 'a'), 'b')
}

/**
 * A recording's picture dropped on a video track at `at`, without its sound,
 * the track made first when there is none by that id. What Picture at playhead
 * did before every track was free.
 */
function withPicture(t: Timeline, clipId: string, mediaId: string, at: number, trackId = 'v2'): Timeline {
  const on = trackOf(t, trackId) ? t : addTrack(t, 'video', trackId)
  return addSource(on, { clipId, mediaId, at, onTrack: trackId, streams: [] })
}

function picture(t: Timeline, id: string): Clip {
  const found = findVideoClip(t, id)
  if (!found) throw new Error(`no picture clip ${id}`)
  return found.clip
}

function request(timeline: Timeline, overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    timeline,
    names: { project: 'holiday', sequence: 'Vertical', joined: 'holiday' },
    preset: presetById(timeline.presetId),
    mode: 'join',
    outputDir: 'D:\\out',
    scratchDir: 'D:\\out\\.scratch',
    filenamePattern: '{project}_{index}_{clip}',
    ...overrides
  }
}

const inputs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-i')
const graphOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1] ?? ''

describe('a picture on a video track above V1', () => {
  it('lands where it is dropped, covering the frame, cropped to the output shape from the middle', () => {
    const t = withPicture(base(), 'p1', 'a', 60)
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'v2'])
    const p = picture(t, 'p1')
    expect(p).toMatchObject({ timelineStart: 60, sourceIn: 0, sourceOut: 300 })
    expect(p.transform.place).toEqual(FULL_PLACE)
    // A 9:16 box as large as fits in a 1920x1080 recording, centred.
    expect(p.transform.crop.h).toBe(1080)
    expect(p.transform.crop.w / p.transform.crop.h).toBeCloseTo(9 / 16, 2)
    expect(p.transform.crop.x + p.transform.crop.w / 2).toBeCloseTo(960, -1)
  })

  it('goes on the video track it was dropped on, covering what is there', () => {
    let t = withPicture(base(), 'p1', 'a', 0)
    t = addTrack(t, 'video', 'v3')
    t = withPicture(t, 'p2', 'phone', 100, 'v2')
    expect(t.videoTracks[1]!.clips.map((c) => [c.id, c.timelineStart])).toEqual([
      ['p1', 0],
      ['p2', 100],
      [t.videoTracks[1]!.clips[2]!.id, 220]
    ])
    expect(t.videoTracks[2]!.clips).toEqual([])
  })

  it('is left out of the export under Handoff, which has no frame, and a sound file puts no picture on a video track', () => {
    const handoff = setShape(withPicture(base(), 'p1', 'phone', 60), 'handoff')
    expect(spansOf(handoff, false).flatMap((s) => [s.base, ...s.overlays]).map((c) => c?.id)).not.toContain('p1')
    const plan = planRender(request(handoff, { mode: 'batch' }))
    expect(plan.segments.flatMap((s) => s.args)).not.toContain('C:\\v\\phone.mp4')

    const t = addTrack(base(), 'video', 'v2')
    const dropped = placeSource(t, { clipId: 's1', mediaId: 'song', at: 0, onTrack: 'v2' })
    expect(dropped.refused).toBeNull()
    expect(dropped.timeline.videoTracks[1]!.clips).toEqual([])
    expect(dropped.timeline.audioTracks.flatMap((r) => r.clips).map((c) => c.id)).toContain('s1')
  })

  it('has its crop and place set as a V1 clip\'s are, the lock reshaping the crop to the place', () => {
    let t = withPicture(base(), 'p1', 'phone', 0)
    t = setCrop(t, 'p1', { x: 0, y: 100, w: 1080, h: 1080 })
    expect(picture(t, 'p1').transform.crop).toEqual({ x: 0, y: 100, w: 1080, h: 1080 })
    const corner = cornerPlace(t.media[2]!, picture(t, 'p1').transform.crop, 1080, 1920)
    t = setPlace(t, 'p1', 'main', corner, true)
    const p = picture(t, 'p1')
    expect(p.transform.place.w).toBeCloseTo(corner.w, 3)
    expect(p.transform.crop.w / p.transform.crop.h).toBeCloseTo(placeAspect(p.transform.place, 1080, 1920), 1)
  })

  it('moves only among video tracks, and plays no sound of its own', () => {
    let t = withPicture(base(), 'p1', 'a', 0)
    t = addTrack(t, 'video', 'v3')
    t = moveClip(t, 'p1', 'v3', 30)
    expect(t.videoTracks[2]!.clips.map((c) => c.timelineStart)).toEqual([30])
    // Not to an audio track, nor to one that is not there.
    expect(moveClip(t, 'p1', 'a1', 0)).toBe(t)
    expect(moveClip(t, 'p1', 'nowhere', 0)).toBe(t)
    expect('gain' in picture(t, 'p1')).toBe(false)
  })

  it('stays where it is when V1\'s clip before it is deleted, and moves earlier with it when it is closed up', () => {
    const t = withPicture(base(), 'p1', 'phone', 330)
    const first = v1Clips(t)[0]!.id
    expect(picture(removeClip(t, first), 'p1').timelineStart).toBe(330)
    expect(picture(closeUpClip(t, first), 'p1').timelineStart).toBe(30)
  })
})

describe('a picture on a video track when the sequence changes shape', () => {
  it('keeps filling the frame, its crop taking the new shape', () => {
    const t = setShape(withPicture(base(), 'p1', 'a', 0), 'landscape')
    const p = picture(t, 'p1')
    expect(p.transform.place).toEqual(FULL_PLACE)
    expect(p.transform.crop.w / p.transform.crop.h).toBeCloseTo(16 / 9, 2)
  })

  it('stays in the corner box when it was in it', () => {
    let t = withPicture(base(), 'p1', 'a', 0)
    const m = t.media[0]!
    t = setPlace(t, 'p1', 'main', cornerPlace(m, picture(t, 'p1').transform.crop, 1080, 1920), true)
    t = setShape(t, 'landscape')
    const p = picture(t, 'p1')
    const expected = cornerPlace(m, p.transform.crop, 1920, 1080)
    expect(p.transform.place.x).toBeCloseTo(expected.x, 3)
    expect(p.transform.place.w).toBeCloseTo(expected.w, 3)
  })

  it('is scaled to fit when placed by hand', () => {
    let t = withPicture(base(), 'p1', 'a', 0)
    t = setPlace(t, 'p1', 'main', { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, false)
    t = setShape(t, 'landscape')
    const p = picture(t, 'p1')
    expect(p.transform.place.x + p.transform.place.w).toBeLessThanOrEqual(1)
    expect(p.transform.place.y + p.transform.place.h).toBeLessThanOrEqual(1)
  })
})

describe('the export of pictures on video tracks', () => {
  /** Each span as its edges, the clip underneath and the clips over it. */
  const shape = (t: Timeline, framed: boolean): [number, number, string | null, string[]][] =>
    spansOf(t, framed).map((s) => [s.from, s.to, s.base?.id ?? null, s.overlays.map((o) => o.id)])

  it('leaves a V1 clip with nothing over it as one segment', () => {
    const t = base()
    const [a, b] = v1Clips(t)
    expect(shape(t, true)).toEqual([
      [0, 300, a!.id, []],
      [300, 420, b!.id, []]
    ])
  })

  it('cuts a V1 clip at each edge of a picture over part of it', () => {
    const t = withPicture(base(), 'p1', 'phone', 60)
    const [a, b] = v1Clips(t)
    expect(shape(t, true)).toEqual([
      [0, 60, a!.id, []],
      [60, 180, a!.id, ['p1']],
      [180, 300, a!.id, []],
      [300, 420, b!.id, []]
    ])
    expect(shape(t, false)).toEqual([
      [0, 300, a!.id, []],
      [300, 420, b!.id, []]
    ])
  })

  it('makes one segment per span, each seeking into both recordings, and the frames still add up', () => {
    const t = withPicture(base(), 'p1', 'phone', 270)
    const plan = planRender(request(t))
    expect(plan.segments.map((s) => s.frames)).toEqual([270, 30, 90, 30])
    expect(plan.totalFrames).toBe(420)
    const [, second, third] = plan.segments
    // The picture's first 30 frames over the end of a, then the next 90 over b.
    // a's sound runs on from the segment before, so it is read on its own, from a little earlier.
    expect(inputs(second!.args)).toEqual(['C:\\v\\a.mp4', 'C:\\v\\a.mp4', 'C:\\v\\phone.mp4'])
    expect(second!.args.filter((_, i) => second!.args[i - 1] === '-ss')).toEqual(['9.000000', '8.900000', '0.000000'])
    expect(third!.args.filter((_, i) => third!.args[i - 1] === '-ss')).toEqual(['0.000000', '1.000000'])
    expect(plan.join?.listContent.split('\n').filter((l) => l.startsWith('file '))).toHaveLength(4)
  })

  it('lays the picture over V1 with its first frame at the segment\'s start, fitted in its place', () => {
    const t = withPicture(base(), 'p1', 'phone', 60)
    const graph = graphOf(planRender(request(t)).segments[1]!.args)
    expect(graph).toContain('[b];')
    const p = picture(t, 'p1').transform
    // Input 1 is a's sound, running on from the segment before; the picture is input 2.
    expect(graph).toContain(
      `[2:v]fps=30:start_time=0,crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y},` +
        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,' +
        'setsar=1,tpad=stop_mode=clone:stop=-1[q0];[b][q0]overlay=x=0:y=0[vt]'
    )
  })

  it('draws the tracks in order, V3 over V2', () => {
    let t = withPicture(base(), 'p1', 'phone', 0)
    t = withPicture(t, 'p2', 'a', 0, 'v3')
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\a.mp4', 'C:\\v\\phone.mp4', 'C:\\v\\a.mp4'])
    expect(graphOf(args)).toContain('[b][q0]overlay=x=0:y=0[u0];')
    expect(graphOf(args)).toContain('[u0][q1]overlay=x=0:y=0[vt]')
  })

  it('keeps the generated silence as input 1 under a picture, the picture after it', () => {
    let t = withPicture(base(), 'p1', 'phone', 0)
    // V1's first clip's sound, on A1, muted.
    t = setClipAudio(t, t.audioTracks[0]!.clips[0]!.id, { gain: 1, muted: true })
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\a.mp4', 'anullsrc=channel_layout=stereo:sample_rate=48000', 'C:\\v\\phone.mp4'])
    expect(graphOf(args)).toContain('[2:v]fps=30:start_time=0')
    expect(args[args.lastIndexOf('-map') + 1]).toBe('1:a')
  })

  it('lays a picture over black past V1\'s end, cut at its edges, reading it from where it has got to', () => {
    // V1 ends at 420. The phone clip is 120 frames from 390, so 90 of them are past V1.
    const t = withPicture(base(), 'p1', 'phone', 390)
    const plan = planRender(request(t))
    expect(plan.segments.map((s) => s.frames)).toEqual([300, 90, 30, 90])
    expect(plan.totalFrames).toBe(510)
    const last = plan.segments[3]!.args
    // Past V1's end the picture is the lowest there, so it is built as a V1 clip is, black around it.
    expect(inputs(last)).toEqual(['C:\\v\\phone.mp4', 'anullsrc=channel_layout=stereo:sample_rate=48000'])
    // 30 frames of the picture were over b, so this part starts a second in.
    expect(last[last.indexOf('-ss') + 1]).toBe('1.000000')
    expect(graphOf(last)).toMatch(/^\[0:v\]fps=30:start_time=0,crop=.*,pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1\[vt\];\[vt\]setparams=color_primaries=bt709:color_trc=bt709\[v\]$/)
    expect(plan.segments[3]!.label).toBe('phone')
  })

  it('makes a span of black with nothing over it where nothing is on V1 or a video track', () => {
    const t = withPicture(base(), 'p1', 'phone', 450)
    // 420 to 450 is nothing but black; 450 to 570 has the picture.
    const plan = planRender(request(t))
    expect(plan.segments.slice(2).map((s) => [s.frames, s.label])).toEqual([
      [30, 'black'],
      [120, 'phone']
    ])
  })

  it('leaves the pictures out of a batch export', () => {
    const t = withPicture(base(), 'p1', 'phone', 60)
    const plan = planRender(request(t, { mode: 'batch' }))
    expect(plan.segments).toHaveLength(2)
    expect(plan.segments.flatMap((s) => s.args)).not.toContain('C:\\v\\phone.mp4')
  })
})
