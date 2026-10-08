import { describe, it, expect } from 'vitest'
import {
  STILL_SEC,
  addClip,
  animationFrame,
  framePath,
  framesPattern,
  addSource,
  addTrack,
  addTransition,
  createProject,
  createTimeline,
  findVideoClip,
  framingOf,
  setFraming,
  setOverlay,
  setAppear,
  splitClip,
  joinClips,
  setPlace,
  markedSpan,
  prepareDrop,
  setClipIn,
  setClipOut,
  setShape,
  setSourceMarksOn,
  type Project,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { planRender, type RenderRequest } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import { FULL_PLACE, freePlaceInPixels, placeAspect, stretchFreeBox, tidyAngle, tidyFreePlace } from '../../src/shared/layout'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { binGroups, isKind } from '../../src/shared/bin'
import { animationRate, stillArgs, stillFilmstripArgs, unpackArgs } from '../../src/main/media/still'
import type { MediaAsset } from '../../src/shared/types'

/**
 * Pictures, for overlays and memes: a source with one frame, no sound and no
 * length of its own, which lands five seconds long and whole, in a box of its
 * own shape, and is read by the export as a looped frame.
 */

function recording(id: string): ProjectMedia {
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
    peaksPath: '',
    filmstripPath: ''
  }
}

function picture(id: string, width = 400, height = 200): ProjectMedia {
  return {
    id,
    originalPath: `C:\\p\\${id}.png`,
    playablePath: `C:\\cache\\${id}\\picture.png`,
    conformed: true,
    conformReasons: [],
    durationSec: STILL_SEC,
    width,
    height,
    fps: 0,
    codec: 'png',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    still: true
  }
}

function timelineWith(presetId = 'vertical', ...media: ProjectMedia[]): Timeline {
  const size = presetId === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
  return { ...createTimeline(30, size, presetId), media }
}

/** The clear margin a freely placed picture in a blend is placed inside: room for any turn of its box. */
const MARGIN = (box: { w: number; h: number }): number => Math.ceil(Math.hypot(box.w, box.h) / 2) * 2

function request(timeline: Timeline, preset = 'vertical'): RenderRequest {
  return {
    timeline,
    names: { project: 'memes', sequence: 'Vertical', joined: 'memes' },
    preset: presetById(preset),
    mode: 'join',
    outputDir: 'D:\\out',
    scratchDir: 'D:\\out\\.scratch',
    filenamePattern: '{project}'
  }
}

describe('a picture landing on the timeline', () => {
  it('is five seconds long, from the middle of its nominal length, with no sound', () => {
    const t = addClip(timelineWith('vertical', picture('logo')), 'logo', 'c')
    const c = findVideoClip(t, 'c')!.clip
    expect(c.sourceOut - c.sourceIn).toBe(150)
    expect(c.sourceIn).toBe(Math.floor((STILL_SEC * 30) / 2))
    expect(t.audioTracks.every((r) => r.clips.length === 0)).toBe(true)
    expect(c.link).toBeUndefined()
  })

  it('is whole, fitted inside the frame, in a box the shape of the picture', () => {
    const t = addClip(timelineWith('vertical', picture('logo')), 'logo', 'c')
    const c = findVideoClip(t, 'c')!.clip
    expect(c.transform.crop).toEqual({ x: 0, y: 0, w: 400, h: 200 })
    expect(c.layout).toBe('custom')
    // As wide as the frame, half as tall as wide, in the middle.
    expect(c.transform.place.w).toBeCloseTo(1)
    expect(placeAspect(c.transform.place, 1080, 1920)).toBeCloseTo(2)
    expect(c.transform.place.y).toBeCloseTo((1920 - 540) / 2 / 1920)
  })

  it('has no box of its own under Handoff, which has no frame to place it in', () => {
    const t = addClip(timelineWith('handoff', picture('logo')), 'logo', 'c')
    const c = findVideoClip(t, 'c')!.clip
    expect(c.transform.place).toEqual(FULL_PLACE)
    expect(c.layout).toBe('single')
  })

  it('stays whole when the sequence changes shape', () => {
    const t = setShape(addClip(timelineWith('vertical', picture('logo')), 'logo', 'c'), 'landscape')
    const c = findVideoClip(t, 'c')!.clip
    expect(c.transform.crop).toEqual({ x: 0, y: 0, w: 400, h: 200 })
    expect(placeAspect(c.transform.place, t.output.width, t.output.height)).toBeCloseTo(2)
  })

  it('can be stretched earlier and later than it landed, far past five seconds', () => {
    let t = addTrack(timelineWith('vertical', recording('rec'), picture('logo')), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    t = addSource(t, { mediaId: 'logo', clipId: 'c', at: 300, onTrack: 'v2' })
    const landed = findVideoClip(t, 'c')!.clip
    t = setClipIn(t, 'c', landed.sourceIn - 240)
    t = setClipOut(t, 'c', landed.sourceOut + 30 * 60 * 30)
    const c = findVideoClip(t, 'c')!.clip
    expect(c.timelineStart).toBe(60)
    expect(c.sourceOut - c.sourceIn).toBe(150 + 240 + 30 * 60 * 30)
  })

  it('put in with Ctrl, opens the sequence up by its five seconds, not its nominal length', () => {
    let t = addClip(timelineWith('vertical', recording('rec'), picture('logo')), 'rec', 'r')
    t = prepareDrop(t, { mediaId: 'logo', clipId: 'c', at: 60 }, { insert: true })
    t = addSource(t, { mediaId: 'logo', clipId: 'c', at: 60 })
    const after = t.videoTracks[0]!.clips.find((c) => c.timelineStart > 60)!
    expect(after.timelineStart).toBe(60 + 150)
  })

  it('is never marked: it has nothing to choose between', () => {
    const p = { media: [picture('logo')], fps: 30 } as unknown as Project
    expect(setSourceMarksOn(p, 'logo', { in: 10, out: 20 })).toBe(p)
    expect(markedSpan({ ...picture('logo'), markIn: 10, markOut: 20 }, 30).to - markedSpan(picture('logo'), 30).from).toBe(150)
  })
})

describe('a picture in the export', () => {
  it('is read as its one frame looped at the project rate, never sought', () => {
    const t = addClip(timelineWith('vertical', picture('logo')), 'logo', 'c')
    const args = planRender(request(t)).segments[0]!.args
    const at = args.indexOf('C:\\cache\\logo\\picture.png')
    expect(args.slice(at - 5, at + 1)).toEqual(['-loop', '1', '-framerate', '30', '-i', 'C:\\cache\\logo\\picture.png'])
    expect(args).not.toContain('-ss')
  })

  it('on V1, is laid over black, so its box can reach past the frame', () => {
    const t = addClip(timelineWith('vertical', picture('logo')), 'logo', 'c')
    const args = planRender(request(t)).segments[0]!.args
    expect(args.join(' ')).toContain('color=c=black')
    expect(args.join(' ')).toContain('color=black@0')
    expect(args.join(' ')).not.toContain('premultiply')
  })

  it('under Handoff, which has no frame to lay it over, is flattened over black', () => {
    const t = addClip(timelineWith('handoff', picture('logo')), 'logo', 'c')
    const graph = planRender(request(t, 'handoff')).segments[0]!.args.join(' ')
    expect(graph).toContain('format=rgba,premultiply=inplace=1')
  })

  it('keeps its transparency laid over another track, with clear rather than black around it', () => {
    let t = addTrack(timelineWith('vertical', recording('rec'), picture('logo')), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    t = addSource(t, { mediaId: 'logo', clipId: 'c', at: 30, onTrack: 'v2' })
    const segment = planRender(request(t)).segments.find((s) => s.args.includes('C:\\cache\\logo\\picture.png'))!
    const graph = segment.args[segment.args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('format=rgba,scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,crop=400:200:0:0')
    expect(graph).toMatch(/pad=\d+:\d+:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black@0/)
    expect(graph).not.toContain('premultiply')
    // The recording under it is still sought as ever.
    expect(segment.args).toContain('-ss')
  })

  it('leaves a recording laid over another as it was, black around it', () => {
    let t = addTrack(timelineWith('vertical', recording('rec'), recording('top')), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    t = addSource(t, { mediaId: 'top', clipId: 'c', at: 30, onTrack: 'v2' })
    const graphs = planRender(request(t)).segments.map((s) => s.args.join(' ')).join('\n')
    expect(graphs).not.toContain('black@0')
    expect(graphs).not.toContain('-loop')
  })
})

function asset(id: string, over: Partial<MediaAsset> = {}): MediaAsset {
  return { ...recording(id), status: 'ready', ...over }
}

describe('a picture in the Source bin', () => {
  it('is its own kind for the filter', () => {
    const logo = asset('logo', { still: true, hasAudio: false })
    const song = asset('song', { hasVideo: false })
    const rec = asset('rec')
    expect(isKind(logo, 'image')).toBe(true)
    expect(isKind(logo, 'video')).toBe(false)
    expect(isKind(rec, 'image')).toBe(false)
    expect(isKind(song, 'image')).toBe(false)
  })

  it('sorts as the shortest by length, whatever its nominal length', () => {
    const logo = asset('logo', { still: true, durationSec: STILL_SEC })
    const rec = asset('rec', { durationSec: 3 })
    const [group] = binGroups([logo, rec], new Map(), { search: '', sort: 'length', kind: 'all', now: Date.now() })
    expect(group!.assets.map((a) => a.id)).toEqual(['rec', 'logo'])
  })
})

describe('a picture made ready on import', () => {
  it('is a PNG with its transparency, within the size cap', () => {
    expect(stillArgs('a.jpg', 'p.png', 400, 200)).toEqual(['-i', 'a.jpg', '-frames:v', '1', '-vf', 'format=rgba', '-f', 'image2', '-c:v', 'png', '-y', 'p.png'])
    const big = stillArgs('a.jpg', 'p.png', 8000, 6000)
    expect(big[big.indexOf('-vf') + 1]).toBe('scale=3840:2880:flags=lanczos,format=rgba')
  })

  it('has a filmstrip of itself repeated, over black, in the layout its nominal length has', () => {
    const args = stillFilmstripArgs('p.png', 'f.jpg', 400, 200)
    const graph = args[args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('color=c=black:s=160x80')
    expect(graph).toContain('loop=loop=99:size=1:start=0,tile=10x10')
  })
})

describe('an overlay placed freely', () => {
  const base = (): Timeline => {
    let t = addTrack(timelineWith('vertical', recording('rec'), picture('logo')), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    return addSource(t, { mediaId: 'logo', clipId: 'c', at: 30, onTrack: 'v2' })
  }

  it('keeps 24 pixels of its box on the frame, however far it is dragged off', () => {
    const p = tidyFreePlace({ x: -5, y: 3, w: 0.5, h: 0.25 }, 1080, 1920)
    expect(p.x * 1080 + p.w * 1080).toBeCloseTo(24)
    expect(p.y * 1920).toBeCloseTo(1920 - 24)
  })

  it('may reach past the frame when it is a picture, and not when it is a recording', () => {
    let t = setPlace(base(), 'c', 'main', { x: -0.5, y: 0.3, w: 1, h: 0.28 }, false)
    expect(findVideoClip(t, 'c')!.clip.transform.place.x).toBeCloseTo(-0.5)
    t = setPlace(t, 'r', 'main', { x: -0.5, y: 0.3, w: 0.5, h: 0.28 }, false)
    expect(findVideoClip(t, 'r')!.clip.transform.place.x).toBe(0)
  })

  it('turns and fades, tidied, and only a picture does', () => {
    let t = setOverlay(base(), 'c', { rotation: 450, opacity: 1.5 })
    expect(findVideoClip(t, 'c')!.clip.transform).toMatchObject({ rotation: 90 })
    expect(findVideoClip(t, 'c')!.clip.transform.opacity).toBeUndefined()
    t = setOverlay(t, 'c', { opacity: 0.4 })
    expect(findVideoClip(t, 'c')!.clip.transform).toMatchObject({ rotation: 90, opacity: 0.4 })
    t = setOverlay(t, 'c', { rotation: 0, opacity: 1 })
    expect(findVideoClip(t, 'c')!.clip.transform.rotation).toBeUndefined()
    expect(findVideoClip(t, 'c')!.clip.transform.opacity).toBeUndefined()
    expect(setOverlay(t, 'r', { rotation: 45 })).toEqual(t)
  })

  it('snaps to a quarter turn when near one', () => {
    expect(tidyAngle(93, 6)).toBe(90)
    expect(tidyAngle(97, 6)).toBe(97)
    expect(tidyAngle(-178, 6)).toBe(180)
    expect(tidyAngle(270)).toBe(-90)
  })

  it('carries its turn and opacity to another picture with its framing, and not to a recording', () => {
    let t = addSource(base(), { mediaId: 'logo', clipId: 'd', at: 300, onTrack: 'v2' })
    t = setOverlay(t, 'c', { rotation: 30, opacity: 0.5 })
    const framing = framingOf(t, 'c')!
    const pasted = setFraming(t, 'd', framing)
    expect(findVideoClip(pasted, 'd')!.clip.transform).toMatchObject({ rotation: 30, opacity: 0.5 })
    const onRecording = setFraming(t, 'r', framing)
    expect(findVideoClip(onRecording, 'r')!.clip.transform.rotation).toBeUndefined()
  })

  it('is turned about its centre and faded in the export, clear around its corners', () => {
    const t = setOverlay(base(), 'c', { rotation: 90, opacity: 0.5 })
    const segment = planRender(request(t)).segments.find((s) => s.args.includes('C:\\cache\\logo\\picture.png'))!
    const graph = segment.args[segment.args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('rotate=a=1.570796:ow=rotw(1.570796):oh=roth(1.570796):c=none')
    expect(graph).toContain('colorchannelmixer=aa=0.5')
    expect(graph).toMatch(/overlay=x=540-w\/2:y=960-h\/2/)
  })

  it('stays turned, faded and past the frame through a blend into the next picture on its track', () => {
    let t = addSource(base(), { mediaId: 'logo', clipId: 'd', at: 180, onTrack: 'v2' })
    t = setOverlay(t, 'c', { rotation: 90, opacity: 0.5 })
    t = setOverlay(t, 'd', { rotation: -30 })
    // The first reaches past the left edge of the frame.
    t = setPlace(t, 'c', 'main', { x: -0.1, y: 0.4, w: 0.5, h: 0.1 }, false)
    t = addTransition(t, 'd', 'in', { kind: 'dissolve', length: 30 })
    const graphs = planRender(request(t)).segments.map((s) => s.args[s.args.indexOf('-filter_complex') + 1]!)
    const blend = graphs.find((g) => g.includes('xfade'))!
    expect(blend).toContain('rotate=a=1.570796:ow=rotw(1.570796):oh=roth(1.570796):c=none')
    expect(blend).toContain('colorchannelmixer=aa=0.5')
    expect(blend).toContain('rotate=a=-0.523599:ow=rotw(-0.523599):oh=roth(-0.523599):c=none')
    // Placed by its centre on a clear canvas bigger than the frame, and cut
    // back to the frame, so a box reaching past the edge is not pulled onto it.
    const c = freePlaceInPixels(findVideoClip(t, 'c')!.clip.transform.place, 1080, 1920)
    expect(c.x).toBeLessThan(0)
    expect(blend).toContain(`x=${MARGIN(c)}+${c.x + c.w / 2}-iw/2`)
  })

  it('reads its turn back from a saved project, tidied', () => {
    const t = setOverlay(base(), 'c', { rotation: 30 })
    const p = createProject('x', 30, { width: 1080, height: 1920 })
    const project = { ...p, media: t.media, sequences: [{ ...p.sequences[0]!, videoTracks: t.videoTracks, audioTracks: t.audioTracks }] }
    const saved = JSON.parse(joinProjectFile(project, defaultWorkspace()))
    saved.sequences[0].videoTracks[1].clips[0].transform.rotation = 390
    saved.sequences[0].videoTracks[1].clips[0].transform.opacity = 'lots'
    const read = splitProjectFile(JSON.stringify(saved)).project
    const c = read.sequences[0]!.videoTracks[1]!.clips[0]!
    expect(c.transform.rotation).toBe(30)
    expect(c.transform.opacity).toBeUndefined()
  })
})

describe('an animation', () => {
  const gif = (): ProjectMedia => ({ ...picture('gif'), playablePath: 'C:\\cache\\gif\\frames\\0001.png', frames: 4, frameRate: 10 })

  it('shows its first frame where it lands, then each in turn at its own rate, looping', () => {
    const t = addClip(timelineWith('vertical', gif()), 'gif', 'c')
    const c = findVideoClip(t, 'c')!.clip
    const m = t.media[0]!
    // 10 frames a second in a 30 fps sequence: a frame of it every three.
    expect([0, 3, 6, 9, 12].map((f) => animationFrame(m, c.sourceIn + f, 30))).toEqual([0, 1, 2, 3, 0])
    expect(animationFrame(m, c.sourceIn - 3, 30)).toBe(3)
  })

  it('names its frame files in order', () => {
    expect(framesPattern(gif())).toBe('C:\\cache\\gif\\frames\\%04d.png')
    expect(framePath(gif(), 11)).toBe('C:\\cache\\gif\\frames\\0012.png')
  })

  it('is read looping in the export, from the frame each segment starts on', () => {
    let t = addTrack(timelineWith('vertical', recording('rec'), gif()), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    // From frame 245, across the recording's end at 300: the second segment
    // starts 55 frames in, which is 18 and a third of its frames, and 18 is frame 2 of 4.
    t = addSource(t, { mediaId: 'gif', clipId: 'c', at: 245, onTrack: 'v2' })
    const pattern = framesPattern(gif())
    const segments = planRender(request(t)).segments.filter((s) => s.args.includes(pattern))
    expect(segments).toHaveLength(2)
    const at = segments[0]!.args.indexOf(pattern)
    expect(segments[0]!.args.slice(at - 5, at + 1)).toEqual(['-stream_loop', '-1', '-framerate', '10', '-i', pattern])
    expect(segments[0]!.args.join(' ')).not.toContain('trim=start_frame')
    // A third of the way into that frame: it shows for what is left of it, 1/30 s.
    expect(segments[1]!.args.join(' ')).toContain("trim=start_frame=2,settb=AVTB,setpts='if(eq(N,0),0,PTS-STARTPTS-0.033333/TB)'")
  })

  it('is unpacked at a steady rate, its own, held to 30 a second at most', () => {
    expect(animationRate(2, 1)).toBe(2)
    expect(animationRate(100, 1)).toBe(30)
    expect(animationRate(3, 0)).toBe(10)
    const args = unpackArgs('a.gif', 'f/%04d.png', 12.5, 400, 300)
    expect(args[args.indexOf('-vf') + 1]).toBe('fps=12.5,format=rgba')
    expect(args).toContain('600')
  })
})

describe('an overlay box stretched by an edge', () => {
  it('keeps where it is past the frame, moving only the edge dragged', () => {
    // Hanging 200 pixels off the left of a 1080 wide frame.
    const box = { x: -200, y: 100, w: 600, h: 300 }
    const wider = stretchFreeBox(box, 'w', -40, 1080, 1920)
    expect(wider).toEqual({ x: -240, y: 100, w: 640, h: 300 })
    const narrower = stretchFreeBox(box, 'e', -100, 1080, 1920)
    expect(narrower).toEqual({ x: -200, y: 100, w: 500, h: 300 })
  })
})

describe('a text or a picture coming in and going out', () => {
  const base = (): Timeline => {
    let t = addTrack(timelineWith('vertical', recording('rec'), picture('logo')), 'video', 'v2')
    t = addClip(t, 'rec', 'r')
    return addSource(t, { mediaId: 'logo', clipId: 'c', at: 30, onTrack: 'v2' })
  }
  const clip = (t: Timeline, id = 'c') => findVideoClip(t, id)!.clip
  const graphs = (t: Timeline): string[] => planRender(request(t)).segments.map((s) => s.args[s.args.indexOf('-filter_complex') + 1] ?? '')

  it('is set on a picture, taken off with null, and never on a recording', () => {
    let t = setAppear(base(), 'c', 'in', { kind: 'pop', length: 15 })
    t = setAppear(t, 'c', 'out', { kind: 'fade', length: 20 })
    expect(clip(t)).toMatchObject({ enter: { kind: 'pop', length: 15 }, exit: { kind: 'fade', length: 20 } })
    t = setAppear(t, 'c', 'in', null)
    expect(clip(t).enter).toBeUndefined()
    expect(clip(t).exit).toEqual({ kind: 'fade', length: 20 })
    expect(setAppear(t, 'r', 'in', { kind: 'fade', length: 10 })).toEqual(t)
  })

  it('keeps its coming in on the first piece of a cut and its going out on the second, and both once joined', () => {
    let t = setAppear(base(), 'c', 'in', { kind: 'pop', length: 15 })
    t = setAppear(t, 'c', 'out', { kind: 'fade', length: 20 })
    const start = clip(t).timelineStart
    t = splitClip(t, start + 60, 'c')
    const [first, second] = t.videoTracks[1]!.clips
    expect(first).toMatchObject({ enter: { kind: 'pop', length: 15 } })
    expect(first!.exit).toBeUndefined()
    expect(second).toMatchObject({ exit: { kind: 'fade', length: 20 } })
    expect(second!.enter).toBeUndefined()
    const joined = joinClips(t, [first!.id, second!.id])
    expect(joined.videoTracks[1]!.clips).toHaveLength(1)
    expect(joined.videoTracks[1]!.clips[0]).toMatchObject({ enter: { kind: 'pop', length: 15 }, exit: { kind: 'fade', length: 20 } })
  })

  it('is read back from a saved project, and a damaged one is dropped', () => {
    const t = setAppear(setAppear(base(), 'c', 'in', { kind: 'pop', length: 15 }), 'c', 'out', { kind: 'fade', length: 20 })
    const p = createProject('x', 30, { width: 1080, height: 1920 })
    const project = { ...p, media: t.media, sequences: [{ ...p.sequences[0]!, videoTracks: t.videoTracks, audioTracks: t.audioTracks }] }
    const saved = JSON.parse(joinProjectFile(project, defaultWorkspace()))
    expect(saved.sequences[0].videoTracks[1].clips[0]).toMatchObject({ enter: { kind: 'pop', length: 15 } })
    saved.sequences[0].videoTracks[1].clips[0].exit = { kind: 'wobble', length: 5 }
    const read = splitProjectFile(JSON.stringify(saved)).project.sequences[0]!.videoTracks[1]!.clips[0]!
    expect(read.enter).toEqual({ kind: 'pop', length: 15 })
    expect(read.exit).toBeUndefined()
  })

  it('is written into the export: a pop sized on every frame in room for its overshoot, and fades on its alpha, placed by its centre', () => {
    const t = setAppear(setAppear(base(), 'c', 'in', { kind: 'pop', length: 15 }), 'c', 'out', { kind: 'fade', length: 30 })
    const graph = graphs(t).find((g) => g.includes('eval=frame'))!
    expect(graph).toContain('setpts=PTS+0.000000/TB,format=rgba,scale=')
    expect(graph).toMatch(/pad=w=\d+:h=\d+:x='\(ow-iw\)\/2':y='\(oh-ih\)\/2':color=black@0:eval=frame/)
    expect(graph).toContain('fade=t=out:st=4:d=1:alpha=1')
    expect(graph).toMatch(/overlay=x=540-w\/2:y=\d+(\.\d+)?-h\/2/)
  })

  it('picks the animation up where a piece starts part way through the clip', () => {
    // A cut on V1 a third of a second into the picture starts a piece there.
    let t = setAppear(base(), 'c', 'in', { kind: 'fade', length: 30 })
    t = splitClip(t, 40, 'r')
    const later = graphs(t).filter((g) => g.includes('fade=t=in:st=0:d=1:alpha=1'))
    expect(later.some((g) => g.includes('setpts=PTS+0.333334/TB'))).toBe(true)
  })

  it('leaves a picture with neither as it was', () => {
    expect(graphs(base()).some((g) => g.includes('eval=frame') || g.includes('alpha=1'))).toBe(false)
  })
})
