import { describe, it, expect } from 'vitest'
import {
  planRender,
  balancedSum,
  concatListLine,
  exportNames,
  freeName,
  samePathKey,
  spansOf,
  trackCopiesRead,
  type RenderRequest
} from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import {
  createProject,
  createTimeline,
  addSequence,
  renameSequence,
  addClip,
  addSource,
  addTrack,
  addTransition,
  cornerPlace,
  findVideoClip,
  moveClip,
  removeClip,
  setClipIn,
  setClipOut,
  setCrop,
  setZoomKeys,
  setClipAudio,
  setPlace,
  setTrackHidden,
  setTrackDuck,
  setTransition,
  applyLayout,
  setShape,
  setCaptions,
  trackOf,
  trimToFrame,
  unlinkClip,
  v1Clips,
  type Clip,
  type SoundClip,
  type Timeline,
  type ProjectMedia
} from '../../src/shared/project'
import { placeInPixels } from '../../src/shared/layout'
import { cropAtKeys } from '../../src/shared/crop-geometry'

function media(id: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id} take.mp4`,
    playablePath: `C:\\v\\${id} take.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
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

function projectWith(...m: ProjectMedia[]): Timeline {
  const base = createTimeline(30, { width: 1080, height: 1920 })
  return m.reduce((p, x) => addClip({ ...p, media: [...p.media, x] }, x.id), base)
}

function request(timeline: Timeline, overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    timeline,
    names: { project: 'holiday', sequence: 'Vertical', joined: 'holiday' },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: 'D:\\out',
    scratchDir: 'D:\\out\\.scratch',
    filenamePattern: '{project}_{index}_{clip}',
    ...overrides
  }
}

/** Read the value that follows a flag. */
function after(args: string[], flag: string): string {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? '') : ''
}

/** The value that follows `-filter_complex`. */
function graphOf(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1] ?? ''
}

/** The sound part of a segment's graph: everything after its picture's chain. */
function soundOf(args: string[]): string {
  const graph = graphOf(args)
  return graph.slice(graph.indexOf('[v];') + 4)
}

const inputs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-i')
const seeks = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-ss')
const maps = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-map')

/** The sound clip of V1's first clip's first stream, on A1, which Add to timeline put there with it. */
function firstSound(t: Timeline): SoundClip {
  const link = v1Clips(t)[0]!.link
  return t.audioTracks[0]!.clips.find((s) => s.link !== undefined && s.link === link)!
}

/**
 * V1's first clip with its head trimmed by `frames`, keeping its start: I on
 * V1, which closes up, as every trim on V1 did before V1 could have gaps. Its
 * linked sound is trimmed by as much.
 */
function headTrimmed(t: Timeline, frames: number): Timeline {
  const c = v1Clips(t)[0]!
  return trimToFrame(t, c.id, 'start', c.timelineStart + frames)
}

/** A source dropped on an audio track at `at`, the track made first when there is none by that id. */
function withSoundOn(t: Timeline, trackId: string, drop: { clipId: string; mediaId: string; at: number; streams?: number[] }): Timeline {
  const on = trackOf(t, trackId) ? t : addTrack(t, 'audio', trackId)
  return addSource(on, { ...drop, onTrack: trackId })
}

/** A recording's picture dropped on a video track at `at`, without its sound, the track made first when there is none. */
function withPicture(t: Timeline, clipId: string, mediaId: string, at: number, trackId = 'v2'): Timeline {
  const on = trackOf(t, trackId) ? t : addTrack(t, 'video', trackId)
  return addSource(on, { clipId, mediaId, at, onTrack: trackId, streams: [] })
}

function picture(t: Timeline, id: string): Clip {
  return findVideoClip(t, id)!.clip
}

/** A crop as ffmpeg's crop filter is given it. */
const cropOf = (c: { w: number; h: number; x: number; y: number }): string => `crop=${c.w}:${c.h}:${c.x}:${c.y}`


/**
 * One heard sound's chain.
 *
 * `trimmed` is the samples read before it and cut off again, when it runs on
 * from the segment before. `declick` is the fades at the sound's own edges,
 * which only the segment holding that edge has.
 */
const heardChain = (input: number, gain: number, label: string, delay = 0, trimmed = 0, declick = ''): string =>
  `[${input}:a:0]volume=${gain},aresample=48000:async=1:first_pts=0,pan=stereo|FL=FL+FC|FR=FR+FC,aformat=sample_rates=48000:channel_layouts=stereo` +
  `${trimmed > 0 ? `,atrim=start_sample=${trimmed},asetpts=N/SR/TB` : ''}` +
  declick +
  `${delay > 0 ? `,adelay=${delay}S:all=1` : ''}[${label}]`

/** The declick at a sound's own beginning: five milliseconds up from silence. */
const FADE_IN = ',afade=t=in:st=0:d=0.005'
/** The declick at the end of a sound `sec` seconds long. */
const fadeOut = (sec: number): string => `,afade=t=out:st=${Number((sec - 0.005).toFixed(6))}:d=0.005`
/** Both, for a sound whose beginning and its end are both inside this segment. */
const declicked = (sec: number): string => `${FADE_IN}${fadeOut(sec)}`

const FORMAT = 'aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo'
/** The finished picture, [vt], with its primaries and transfer said on its frames on its way to [v] (plan 89). */
const TAGGED = '[vt]setparams=color_primaries=bt709:color_trc=bt709[v]'
/** The black a segment with nothing on V1 is drawn over, said to be BT.709 so what is laid over it is not converted. */
const BLACK_BASE = '[0:v]setsar=1,setparams=colorspace=bt709:range=tv'
const SILENCE = 'anullsrc=channel_layout=stereo:sample_rate=48000'
const BLACK = 'color=c=black:s=1080x1920:r=30'

/** A sound file of 20 seconds, 600 frames. */
const song = media('song', { durationSec: 20, width: 0, height: 0, hasVideo: false, playablePath: 'C:\\m\\song.wav' })

/**
 * An OBS recording with three streams: the first is the playable file, the
 * other two have copies of their own.
 */
const obs = media('obs', {
  audioTracks: 3,
  trackFiles: [
    { path: 'C:\\cache\\track-2.m4a', peaksPath: 'C:\\cache\\peaks-2.bin' },
    { path: 'C:\\cache\\track-3.m4a', peaksPath: 'C:\\cache\\peaks-3.bin' }
  ]
})

/**
 * The OBS recording on V1 as `c1`, its streams' sound clips `c1.1` to `c1.3`
 * on A1 to A3, each heard at the level given, or muted where it is null.
 */
function obsHeard(levels: (number | null)[], m: ProjectMedia = obs): Timeline {
  let t = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [m] }, m.id, 'c1')
  levels.forEach((gain, i) => {
    t = setClipAudio(t, `c1.${i + 1}`, gain === null ? { gain: 1, muted: true } : { gain, muted: false })
  })
  return t
}

describe('planRender, joining', () => {
  it('makes one segment per clip plus a join', () => {
    const plan = planRender(request(projectWith(media('a'), media('b'))))
    expect(plan.segments).toHaveLength(2)
    expect(plan.join).not.toBeNull()
    expect(plan.outputs).toHaveLength(1)
  })

  it('writes segments to the scratch directory and the deliverable to the output one', () => {
    const plan = planRender(request(projectWith(media('a'))))
    expect(plan.segments[0]?.output).toContain('.scratch')
    // One file means one name: the project's, not the per-clip pattern.
    expect(plan.join?.output).toBe('D:\\out\\holiday.mp4')
  })

  it('counts the frames it is going to produce', () => {
    const plan = planRender(request(projectWith(media('a'), media('b', { durationSec: 4 }))))
    expect(plan.totalFrames).toBe(300 + 120)
  })

  it('refuses an empty timeline rather than writing an empty file', () => {
    expect(() => planRender(request(createTimeline(30, { width: 1080, height: 1920 })))).toThrow(
      /nothing on the timeline/i
    )
  })
})

describe('the segment command', () => {
  const plan = (p: Timeline, o: Partial<RenderRequest> = {}) => planRender(request(p, o)).segments[0]!

  it('seeks accurately to the clip head before the input', () => {
    const p = headTrimmed(projectWith(media('a')), 90)
    const args = plan(p).args
    // -ss must come before -i to be both fast and, when re-encoding, accurate.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(after(args, '-ss')).toBe('3.000000')
  })

  it('bounds the output by both a duration and an exact frame count', () => {
    const p0 = projectWith(media('a'))
    const p = setClipOut(p0, v1Clips(p0)[0]!.id, 150)
    const args = plan(p).args
    expect(after(args, '-frames:v')).toBe('150')
    expect(after(args, '-t')).toBe('5.000000')
  })

  it('crops in source pixels and then scales to the preset', () => {
    const p0 = projectWith(media('a'))
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 656, y: 0, w: 608, h: 1080 })
    const vf = after(plan(p).args, '-filter_complex')
    expect(vf).toContain('crop=608:1080:656:0')
    expect(vf).toContain('scale=1080:1920')
  })

  it('pads rather than stretching when the crop is the wrong shape', () => {
    const p0 = projectWith(media('a'))
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 0, y: 0, w: 1920, h: 1080 })
    const vf = after(plan(p).args, '-filter_complex')
    expect(vf).toContain('force_original_aspect_ratio=decrease')
    expect(vf).toContain('pad=1080:1920')
  })

  it('forces the project frame rate, so mixed sources line up', () => {
    expect(after(plan(projectWith(media('a', { fps: 60 }))).args, '-filter_complex')).toContain('fps=30')
  })

  it('writes square pixels', () => {
    expect(after(plan(projectWith(media('a'))).args, '-filter_complex')).toContain('setsar=1')
  })

  it('uses the preset quality', () => {
    expect(after(plan(projectWith(media('a'))).args, '-crf')).toBe('20')
    expect(after(plan(projectWith(media('a')), { preset: presetById('landscape') }).args, '-crf')).toBe('18')
  })

  it('writes uncompressed audio into a segment, because AAC does not join cleanly', () => {
    const args = plan(projectWith(media('a'))).args
    expect(after(args, '-c:a')).toBe('pcm_f32le')
    expect(plan(projectWith(media('a'))).output).toMatch(/\.mkv$/)
  })

  it('applies the gain of the clip\'s sound', () => {
    const p0 = projectWith(media('a'))
    const p = setClipAudio(p0, firstSound(p0).id, { gain: 0.5, muted: false })
    expect(after(plan(p).args, '-filter_complex')).toContain('volume=0.5')
  })
})

describe('a segment that has no sound', () => {
  const plan = (p: Timeline) => planRender(request(p)).segments[0]!

  it('generates silence for a source with no audio stream', () => {
    const args = plan(projectWith(media('a', { hasAudio: false }))).args
    expect(args.join(' ')).toContain('anullsrc')
    expect(args).toContain('1:a')
  })

  it('generates silence for a clip the user muted', () => {
    const p0 = projectWith(media('a'))
    const p = setClipAudio(p0, firstSound(p0).id, { gain: 1, muted: true })
    expect(plan(p).args.join(' ')).toContain('anullsrc')
  })

  it('makes the silence exactly as long as the clip', () => {
    const p0 = projectWith(media('a', { hasAudio: false }))
    const p = setClipOut(p0, v1Clips(p0)[0]!.id, 90)
    const args = plan(p).args
    // The -t that belongs to the lavfi input comes before its -i.
    const lavfi = args.indexOf('lavfi')
    const tAfterLavfi = args.indexOf('-t', lavfi)
    expect(args[tAfterLavfi + 1]).toBe('3.000000')
  })

  it('still maps an audio stream, so the join cannot break on a missing track', () => {
    for (const m of [media('a'), media('b', { hasAudio: false })]) {
      const args = plan(projectWith(m)).args
      expect(maps(args)).toHaveLength(2)
    }
  })
})

describe('planRender, one file per clip', () => {
  it('writes finished files straight to the output directory', () => {
    const plan = planRender(request(projectWith(media('a'), media('b')), { mode: 'batch' }))
    expect(plan.join).toBeNull()
    expect(plan.outputs).toHaveLength(2)
    expect(plan.segments[0]?.output).toBe('D:\\out\\holiday_01_a take.mp4')
    expect(plan.segments[1]?.output).toBe('D:\\out\\holiday_02_b take.mp4')
  })

  it('compresses the audio, because there is nothing left to join', () => {
    const plan = planRender(request(projectWith(media('a')), { mode: 'batch' }))
    expect(after(plan.segments[0]!.args, '-c:a')).toBe('aac')
    expect(plan.segments[0]!.args).toContain('+faststart')
  })

  it('uses the same picture settings as the joined path, so the two agree', () => {
    const joined = planRender(request(projectWith(media('a')))).segments[0]!.args
    const batched = planRender(request(projectWith(media('a')), { mode: 'batch' })).segments[0]!.args
    for (const flag of ['-crf', '-c:v', '-preset', '-pix_fmt', '-frames:v', '-filter_complex']) {
      expect(after(batched, flag)).toBe(after(joined, flag))
    }
  })

  it('forces one file per clip for the handoff preset, whatever was asked for', () => {
    const plan = planRender(request(projectWith(media('a'), media('b')), { preset: presetById('handoff') }))
    // Its output size follows each clip's crop, and differing sizes cannot be joined.
    expect(plan.join).toBeNull()
    expect(plan.outputs).toHaveLength(2)
  })

  it('keeps the cropped region at source scale for the handoff preset', () => {
    const p0 = projectWith(media('a'))
    const p = setCrop(p0, v1Clips(p0)[0]!.id, { x: 100, y: 0, w: 800, h: 1000 })
    const args = planRender(request(p, { preset: presetById('handoff'), mode: 'batch' })).segments[0]!.args
    expect(after(args, '-filter_complex')).toContain('scale=800:1000')
  })

  it('is each V1 clip with its layers and only its linked heard sound, the other tracks left out, finished as an MP4', () => {
    const phone = media('phone', { durationSec: 4, width: 1080, height: 1920 })
    let t = obsHeard([1, null, 1])
    t = applyLayout({ ...t, media: [...t.media, song, phone] }, 'c1', 'split')
    // A second clip of the recording after it, its sound on A1 to A3 and heard on A1, but no longer its own.
    t = unlinkClip(addClip(t, 'obs', 'c2'), 'c2')
    t = withSoundOn(t, 'a4', { clipId: 's1', mediaId: 'song', at: 0 })
    t = withPicture(t, 'p1', 'phone', 0)
    const plan = planRender(request(t, { mode: 'batch' }))
    expect(plan.segments.map((s) => [s.clipId, s.frames])).toEqual([
      ['c1', 300],
      ['c2', 300]
    ])

    const [one, two] = plan.segments
    // Its first stream from the recording itself, its third from the copy; the song and the picture on V2 left out.
    expect(inputs(one!.args)).toEqual(['C:\\v\\obs take.mp4', 'C:\\cache\\track-3.m4a'])
    expect(graphOf(one!.args)).toContain('[0:v]fps=30:start_time=0,split=2[s0][s1]')
    expect(soundOf(one!.args)).toBe(
      `${heardChain(0, 1, 's0', 0, 0, declicked(10))};${heardChain(1, 1, 's1', 0, 0, declicked(10))};[s0][s1]amix=inputs=2:duration=longest:normalize=0,apad,${FORMAT}[a]`
    )
    expect(one!.output).toBe('D:\\out\\holiday_01_obs take.mp4')
    expect(after(one!.args, '-c:a')).toBe('aac')
    expect(after(one!.args, '-b:a')).toBe('192k')
    expect(one!.args).toContain('+faststart')

    // The sound heard under the unlinked clip is not its own, so its file is silent.
    expect(inputs(two!.args)).toEqual(['C:\\v\\obs take.mp4', SILENCE])
    expect(maps(two!.args)).toEqual(['[v]', '1:a'])
    expect(plan.segments.flatMap((s) => s.args)).not.toContain('C:\\m\\song.wav')
    expect(plan.segments.flatMap((s) => s.args)).not.toContain('C:\\v\\phone take.mp4')
  })

  it('leaves the other audio tracks out of a batch export, whose files are each one V1 clip', () => {
    const t = projectWith(media('a'))
    const withSong = (at: number): Timeline => withSoundOn({ ...t, media: [...t.media, song] }, 'a2', { clipId: 's1', mediaId: 'song', at })
    const plan = planRender(request(withSong(0), { mode: 'batch' }))
    expect(plan.join).toBeNull()
    expect(plan.segments.flatMap((s) => s.args)).not.toContain('C:\\m\\song.wav')
    // Nor does it go on past V1's end in black.
    expect(planRender(request(withSong(150), { mode: 'batch' })).segments).toHaveLength(1)
  })
})

describe('the join command', () => {
  it('copies the picture and encodes the sound once', () => {
    const join = planRender(request(projectWith(media('a'), media('b')))).join!
    expect(after(join.args, '-c:v')).toBe('copy')
    expect(after(join.args, '-c:a')).toBe('aac')
    expect(join.args).toContain('+faststart')
  })

  it('lists every segment in order', () => {
    const plan = planRender(request(projectWith(media('a'), media('b'))))
    const lines = plan.join!.listContent.trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('segment-001')
    expect(lines[2]).toContain('segment-002')
  })

  it('gives each segment its length in frames, so the next starts exactly where it ends', () => {
    // 31 frames at 30 a second: a length a millisecond clock cannot hold.
    const t = projectWith(media('a', { durationSec: 31 / 30 }), media('b', { durationSec: 31 / 30 }))
    const lines = planRender(request(t)).join!.listContent.trim().split('\n')
    expect(lines[1]).toBe('duration 1.033333')
    expect(lines[3]).toBe('duration 1.033333')
  })

  it('reads the list from the scratch directory', () => {
    const join = planRender(request(projectWith(media('a')))).join!
    expect(after(join.args, '-i')).toBe(join.listPath)
    expect(join.listPath).toContain('.scratch')
  })

  it('is the plain join word for word, whatever is on the audio tracks, since every sound is in the segments', () => {
    const plain = [
      '-f', 'concat', '-safe', '0', '-i', 'D:\\out\\.scratch\\segments.txt',
      '-c:v', 'copy',
      '-bsf:v', 'setts=time_base=1/90000:prescale=1:pts=round(PTS*TB*30)*3000:dts=round(DTS*TB*30)*3000:duration=round(DURATION*TB*30)*3000', '-video_track_timescale', '90000',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', '-y', 'D:\\out\\holiday.mp4'
    ]
    const t = projectWith(media('a'))
    expect(planRender(request(t)).join!.args).toEqual(plain)
    const withSong = withSoundOn({ ...t, media: [...t.media, song] }, 'a2', { clipId: 's1', mediaId: 'song', at: 60 })
    expect(planRender(request(withSong)).join!.args).toEqual(plain)
    expect(planRender(request(setClipAudio(withSong, 's1', { gain: 1, muted: true }))).join!.args).toEqual(plain)
  })
})

describe('concatListLine', () => {
  it('writes a path the concat demuxer accepts', () => {
    expect(concatListLine('D:\\out\\a.mkv')).toBe("file 'D:/out/a.mkv'")
  })

  it('escapes a single quote rather than ending the string early', () => {
    expect(concatListLine("D:\\out\\it's.mkv")).toBe("file 'D:/out/it'\\''s.mkv'")
  })

  it('leaves spaces alone, which quoting already handles', () => {
    expect(concatListLine('D:\\my out\\a b.mkv')).toBe("file 'D:/my out/a b.mkv'")
  })
})

describe('export names with several sequences', () => {
  const one = createProject('holiday', 30, { width: 1080, height: 1920 })
  const two = addSequence(one, 'land', 'landscape')

  it('name a joined export after the project while it has one sequence, as always', () => {
    expect(exportNames(one, 'sequence-1')).toEqual({ project: 'holiday', sequence: 'Vertical', joined: 'holiday' })
  })

  it('name it after the project and the sequence once there are several', () => {
    expect(exportNames(two, 'sequence-1').joined).toBe('holiday Vertical')
    expect(exportNames(two, 'land').joined).toBe('holiday Landscape')
  })

  it('follow a sequence you renamed', () => {
    expect(exportNames(renameSequence(two, 'land', 'YouTube cut'), 'land').joined).toBe('holiday YouTube cut')
  })

  it('reach the joined file, and the {sequence} field of the per-clip pattern', () => {
    const t = projectWith(media('a'))
    const joined = planRender(request(t, { names: exportNames(two, 'land') }))
    expect(joined.outputs).toEqual(['D:\\out\\holiday Landscape.mp4'])

    const batch = planRender(
      request(t, { mode: 'batch', filenamePattern: '{project}_{sequence}_{index}', names: exportNames(two, 'land') })
    )
    expect(batch.outputs).toEqual(['D:\\out\\holiday_Landscape_01.mp4'])
  })

  it('keep two sequences\' per-clip files apart even when the pattern has no {sequence}', () => {
    const t = projectWith(media('a'))
    const vertical = planRender(request(t, { mode: 'batch', names: exportNames(two, 'sequence-1') }))
    const landscape = planRender(request(t, { mode: 'batch', names: exportNames(two, 'land') }))
    expect(vertical.outputs).toEqual(['D:\\out\\holiday Vertical_01_a take.mp4'])
    expect(landscape.outputs).toEqual(['D:\\out\\holiday Landscape_01_a take.mp4'])
  })

  it('leave per-clip names as they were for a project with one sequence', () => {
    const plan = planRender(request(projectWith(media('a')), { mode: 'batch', names: exportNames(one, 'sequence-1') }))
    expect(plan.outputs).toEqual(['D:\\out\\holiday_01_a take.mp4'])
  })
})

describe('a clip with layers', () => {
  // A 3840x1080 OBS canvas: two 1920x1080 views side by side.
  const wide = media('obs', { width: 3840, height: 1080 })
  const split = (): Timeline => {
    const t = projectWith(wide)
    return applyLayout(t, v1Clips(t)[0]!.id, 'split')
  }

  it('crops each picture, fits it in its place and lays it over black at its place', () => {
    const t = split()
    const c = v1Clips(t)[0]!
    const graph = graphOf(planRender(request(t)).segments[0]!.args)
    // The frame rate once, before the split, so both pictures share frames, with
    // the first frame at the segment's start, as every picture has now.
    expect(graph).toContain('[0:v]fps=30:start_time=0,split=2[s0][s1]')
    const main = c.transform.crop
    const layer = c.layers[0]!.crop
    expect(graph).toContain(`[s0]crop=${main.w}:${main.h}:${main.x}:${main.y},scale=1080:960:`)
    expect(graph).toContain(`[s1]crop=${layer.w}:${layer.h}:${layer.x}:${layer.y},scale=1080:960:`)
    expect(graph).toContain('pad=1080:960:(ow-iw)/2:(oh-ih)/2:color=black')
    // The main picture is padded out to the frame at its place; the layer goes over it.
    expect(graph).toContain('pad=1080:1920:0:0:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[o0]')
    expect(graph).toContain('[o0][p1]overlay=x=0:y=960[vt]')
  })

  it('sets its timing from the picture itself, never from a separate black source', () => {
    // A black frame made in the graph starts at the first timestamp, and when
    // the source's first frame lands later the segment opens on black.
    const graph = graphOf(planRender(request(split())).segments[0]!.args)
    expect(graph).not.toContain('color=c=black')
  })

  it('pads a lone main picture that does not fill the frame straight to the output', () => {
    let t = projectWith(media('a'))
    t = applyLayout(t, v1Clips(t)[0]!.id, 'split')
    t = { ...t, videoTracks: t.videoTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, layers: [] })) })) }
    const graph = graphOf(planRender(request(t)).segments[0]!.args)
    expect(graph).toContain('pad=1080:1920:0:0:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt]')
    expect(graph).not.toContain('overlay')
  })

  it('keeps every frame bound a plain segment has', () => {
    const t = split()
    const seg = planRender(request(t)).segments[0]!
    expect(seg.args).toContain('-frames:v')
    expect(seg.args[seg.args.indexOf('-frames:v') + 1]).toBe(String(seg.frames))
  })

  it('rounds its length bound up, so a held last frame is not dropped, as a plain clip does', () => {
    // 91 frames at 30 fps is 3.0333... seconds.
    let t = split()
    t = setClipOut(t, v1Clips(t)[0]!.id, 91)
    const layered = planRender(request(t)).segments[0]!.args
    expect(layered[layered.indexOf('-t') + 1]).toBe('3.033334')

    let plain = projectWith(media('a'))
    plain = setClipOut(plain, v1Clips(plain)[0]!.id, 91)
    const args = planRender(request(plain)).segments[0]!.args
    expect(args[args.indexOf('-t') + 1]).toBe('3.033334')
  })

  it('keeps the generated silence of a muted clip on the same input', () => {
    let t = split()
    t = setClipAudio(t, firstSound(t).id, { gain: 1, muted: true })
    const args = planRender(request(t)).segments[0]!.args
    expect(args).toContain(SILENCE)
    expect(args[args.lastIndexOf('-map') + 1]).toBe('1:a')
  })

  it('exports only the main picture under Handoff, which has no frame to place anything in', () => {
    const t = setShape(split(), 'handoff')
    const graph = graphOf(planRender(request(t, { preset: presetById('handoff'), mode: 'batch' })).segments[0]!.args)
    expect(graph).not.toContain('split=')
    expect(graph).not.toContain('overlay')
  })
})

describe('a plain clip', () => {
  it('keeps a single picture chain, holding its last frame for as long as the segment needs', () => {
    const t = projectWith(media('a'))
    const c = v1Clips(t)[0]!.transform.crop
    const graph = graphOf(planRender(request(t)).segments[0]!.args)
    expect(graph.split(';')[0]).toBe(
      `[0:v]fps=30:start_time=0,crop=${c.w}:${c.h}:${c.x}:${c.y},` +
        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,' +
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt]'
    )
  })

  it('names the first audio track, rather than leaving the choice to ffmpeg', () => {
    const graph = graphOf(planRender(request(projectWith(media('a')))).segments[0]!.args)
    expect(graph).toContain('[0:a:0]volume=1')
    expect(graph).not.toMatch(/\[0:a\]/)
  })
})

describe('input 0 shared with the picture\'s own first stream', () => {
  it('gives a plain V1 clip, its first stream heard at 100%, the plain command word for word, its first frame put at the start', () => {
    const t = projectWith(media('a'))
    const c = v1Clips(t)[0]!.transform.crop
    expect(planRender(request(t)).segments[0]!.args).toEqual([
      '-ss', '0.000000', '-colorspace', 'bt709', '-advanced_editlist', '0',
      '-i', 'C:\\v\\a take.mp4',
      '-filter_complex',
      `[0:v]fps=30:start_time=0,crop=${c.w}:${c.h}:${c.x}:${c.y},` +
        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,' +
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt];' +
        `${TAGGED};` +
        '[0:a:0]volume=1,aresample=async=1,apad,pan=stereo|FL=FL+FC|FR=FR+FC,aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.005,afade=t=out:st=9.995:d=0.005[a]',
      '-map', '[v]',
      '-map', '[a]',
      '-t', '10.000000',
      '-frames:v', '300',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2',
      '-y', 'D:\\out\\.scratch\\segment-001.mkv'
    ])
  })

  it('gives the same clip with its sound muted the muted command word for word, its first frame put at the start', () => {
    const t0 = projectWith(media('a'))
    const t = setClipAudio(t0, firstSound(t0).id, { gain: 1, muted: true })
    const c = v1Clips(t)[0]!.transform.crop
    expect(planRender(request(t)).segments[0]!.args).toEqual([
      '-ss', '0.000000', '-colorspace', 'bt709', '-advanced_editlist', '0',
      '-i', 'C:\\v\\a take.mp4',
      '-f', 'lavfi', '-t', '10.000000', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-filter_complex',
      `[0:v]fps=30:start_time=0,crop=${c.w}:${c.h}:${c.x}:${c.y},` +
        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,' +
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt];' +
        TAGGED,
      '-map', '[v]',
      '-map', '1:a',
      '-t', '10.000000',
      '-frames:v', '300',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2',
      '-y', 'D:\\out\\.scratch\\segment-001.mkv'
    ])
  })

  it('no longer shares it once the same sound is moved on its own by a frame', () => {
    const t = projectWith(media('a'))
    const moved = moveClip(t, firstSound(t).id, 'a1', 1, true)
    const args = planRender(request(moved)).segments[0]!.args
    // Read from the recording again as a sound of its own, from its start, 299 frames of it, a frame into the segment.
    expect(inputs(args)).toEqual(['C:\\v\\a take.mp4', 'C:\\v\\a take.mp4'])
    expect(args.slice(8, 16)).toEqual(['-ss', '0.000000', '-t', '9.966667', '-advanced_editlist', '0', '-i', 'C:\\v\\a take.mp4'])
    // Moving the sound on by a frame takes its last frame past the picture's, so this
    // segment holds its beginning but not its end: faded up here, faded down in the next.
    expect(soundOf(args)).toBe(`${heardChain(1, 1, 's0', 1600, 0, FADE_IN)};[s0]apad,${FORMAT}[a]`)
    expect(graphOf(args)).not.toContain('[0:a:0]')
  })

  it('no longer shares it when the sound ends part way through the segment, so that it stops there', () => {
    const t = projectWith(media('a'))
    const short = setClipOut(t, firstSound(t).id, 150, true)
    const args = planRender(request(short)).segments[0]!.args
    expect(args.slice(8, 16)).toEqual(['-ss', '0.000000', '-t', '5.000000', '-advanced_editlist', '0', '-i', 'C:\\v\\a take.mp4'])
    expect(soundOf(args)).toBe(`${heardChain(1, 1, 's0', 0, 0, declicked(5))};[s0]apad,${FORMAT}[a]`)
  })

  it('no longer shares it when the sound is a frame out of step with the picture over the whole segment', () => {
    // The sound starts a frame into the recording at the picture's start, and both are 299 frames long.
    let t = projectWith(media('a'))
    const sound = firstSound(t).id
    t = moveClip(setClipIn(t, sound, 1, true), sound, 'a1', 0, true)
    t = setClipOut(t, v1Clips(t)[0]!.id, 299, true)
    const args = planRender(request(t)).segments[0]!.args
    expect(planRender(request(t)).segments.map((s) => s.frames)).toEqual([299])
    expect(args.slice(8, 16)).toEqual(['-ss', '0.033333', '-t', '9.966667', '-advanced_editlist', '0', '-i', 'C:\\v\\a take.mp4'])
    expect(soundOf(args)).toBe(`${heardChain(1, 1, 's0', 0, 0, declicked(9.966667))};[s0]apad,${FORMAT}[a]`)
  })

  it('shares it for a picture on V2 over a gap in V1, heard with its own first stream', () => {
    const phone = media('phone', { durationSec: 4, width: 1080, height: 1920 })
    const t = addTrack({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [phone] }, 'video', 'v2')
    const dropped = addSource(t, { clipId: 'p1', mediaId: 'phone', at: 0, onTrack: 'v2' })
    const args = planRender(request(dropped)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\phone take.mp4'])
    expect(soundOf(args)).toBe(`[0:a:0]volume=1,aresample=async=1,apad,pan=stereo|FL=FL+FC|FR=FR+FC,${FORMAT}${declicked(4)}[a]`)
  })
})

describe('a segment\'s sound', () => {
  /** V1 holding one 10 second clip, with the song put on A2 at `at`. */
  const withSong = (at: number, extra: Partial<{ gain: number; muted: boolean }> = {}): Timeline => {
    const t = projectWith(media('a'))
    const placed = withSoundOn({ ...t, media: [...t.media, song] }, 'a2', { clipId: 's1', mediaId: 'song', at })
    return extra.gain !== undefined || extra.muted !== undefined
      ? setClipAudio(placed, 's1', { gain: extra.gain ?? 1, muted: extra.muted ?? false })
      : placed
  }
  const segmentsOf = (t: Timeline): string[][] => planRender(request(t)).segments.map((s) => s.args)
  /** The five words that read one sound input: its point, its length and its file. */
  const readOf = (args: string[], path: string): string[] => {
    const at = args.indexOf(path)
    return args.slice(at - 5, at + 1)
  }

  it('reads each of a recording\'s other streams from its copy, from the same point, after the picture underneath', () => {
    const t = headTrimmed(obsHeard([null, 1.5, 0.6]), 30)
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4', 'C:\\cache\\track-2.m4a', 'C:\\cache\\track-3.m4a'])
    expect(seeks(args)).toEqual(['1.000000', '1.000000', '1.000000'])
  })

  it('sums what is heard at each clip\'s level, never averaging it, and pads it with silence to the segment\'s length', () => {
    const args = planRender(request(obsHeard([null, 1.5, 0.6]))).segments[0]!.args
    expect(soundOf(args)).toBe(
      `${heardChain(1, 1.5, 's0', 0, 0, declicked(10))};${heardChain(2, 0.6, 's1', 0, 0, declicked(10))};[s0][s1]amix=inputs=2:duration=longest:normalize=0,apad,${FORMAT}[a]`
    )
    expect(graphOf(args)).not.toContain('[0:a:0]')
  })

  it('reads the picture\'s own first stream from input 0 when it is mixed with a copy', () => {
    const args = planRender(request(obsHeard([1, null, 1]))).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4', 'C:\\cache\\track-3.m4a'])
    expect(graphOf(args)).toContain('[0:a:0]volume=1,aresample=48000:async=1:first_pts=0,')
    expect(graphOf(args)).toContain('[1:a:0]volume=1,aresample=48000:async=1:first_pts=0,')
  })

  it('plays one other stream on its own without a mix, at its volume', () => {
    const args = planRender(request(obsHeard([null, 3, null]))).segments[0]!.args
    expect(soundOf(args)).toBe(`${heardChain(1, 3, 's0', 0, 0, declicked(10))};[s0]apad,${FORMAT}[a]`)
    expect(graphOf(args)).not.toContain('amix')
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4', 'C:\\cache\\track-2.m4a'])
  })

  it('gives the generated silence as input 1, mapped as 1:a, when nothing is heard, reading no copies', () => {
    const args = planRender(request(obsHeard([null, null, null]))).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4', SILENCE])
    expect(args[args.lastIndexOf('-map') + 1]).toBe('1:a')
    expect(graphOf(args)).not.toContain(':a:0]')
  })

  it('leaves out a stream whose copy was never made', () => {
    const noCopies = media('obs', { audioTracks: 3 })
    const args = planRender(request(obsHeard([1, 1, null], noCopies))).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4'])
    expect(graphOf(args)).toContain('[0:a:0]volume=1,aresample=async=1,apad,pan=stereo|FL=FL+FC|FR=FR+FC,aformat')
  })

  it('reads a sound from its point in its file, for as long as it is over the segment, delayed in samples to where it starts', () => {
    // Trimming its head moved the song's start to 3 s, a second into it. It runs on
    // past V1's end at 10 s, and the sequence with it, to 22 s.
    const [first, second] = segmentsOf(setClipIn(withSong(60), 's1', 30))
    expect(readOf(first!, 'C:\\m\\song.wav')).toEqual(['-ss', '1.000000', '-t', '7.000000', '-i', 'C:\\m\\song.wav'])
    expect(graphOf(first!)).toContain('adelay=144000S:all=1')
    expect(graphOf(first!)).not.toContain('atrim')
    // Running on from the segment before, it is read from a tenth of a second
    // earlier, which is cut off again, so the two pieces meet without a click.
    expect(readOf(second!, 'C:\\m\\song.wav')).toEqual(['-ss', '7.900000', '-t', '12.100000', '-i', 'C:\\m\\song.wav'])
    expect(graphOf(second!)).toContain('atrim=start_sample=4800,asetpts=N/SR/TB')
    expect(graphOf(second!)).not.toContain('adelay')
  })

  it('reads a sound across a cut in pieces, each from where the last left off, and one after V1 whole', () => {
    const [before, past] = segmentsOf(withSong(150))
    expect(readOf(before!, 'C:\\m\\song.wav')).toEqual(['-ss', '0.000000', '-t', '5.000000', '-i', 'C:\\m\\song.wav'])
    expect(graphOf(before!)).toContain('adelay=240000S:all=1')
    expect(readOf(past!, 'C:\\m\\song.wav')).toEqual(['-ss', '4.900000', '-t', '15.100000', '-i', 'C:\\m\\song.wav'])

    const [under, later] = segmentsOf(withSong(330))
    expect(under).not.toContain('C:\\m\\song.wav')
    expect(readOf(later!, 'C:\\m\\song.wav')).toEqual(['-ss', '0.000000', '-t', '20.000000', '-i', 'C:\\m\\song.wav'])
    expect(graphOf(later!)).toContain('adelay=48000S:all=1')
  })

  it('resamples each sound before delaying it to its start, to the sample, then sums it with the picture\'s own', () => {
    const [first] = segmentsOf(withSong(60, { gain: 1.5 }))
    expect(inputs(first!)).toEqual(['C:\\v\\a take.mp4', 'C:\\m\\song.wav'])
    expect(soundOf(first!)).toBe(
      `${heardChain(0, 1, 's0', 0, 0, declicked(10))};${heardChain(1, 1.5, 's1', 96000, 0, FADE_IN)};[s0][s1]amix=inputs=2:duration=longest:normalize=0,apad,${FORMAT}[a]`
    )
  })

  it('does not hear a muted sound clip', () => {
    const t = withSong(60, { muted: true })
    const [first, second] = segmentsOf(t)
    expect(inputs(first!)).toEqual(['C:\\v\\a take.mp4'])
    expect(soundOf(first!)).toBe(`[0:a:0]volume=1,aresample=async=1,apad,pan=stereo|FL=FL+FC|FR=FR+FC,${FORMAT}${declicked(10)}[a]`)
    expect(inputs(second!)).toEqual([BLACK, SILENCE])
    expect(maps(second!)).toEqual(['[v]', '1:a'])
    expect(spansOf(t, true).map((s) => s.sounds.map((c) => c.id))).toEqual([[firstSound(t).id], []])
  })
})

describe('the spans of the whole sequence', () => {
  /**
   * V1 holding a from 0 to 300 and b from 360 to 480, a gap between, each with
   * its sound on A1, and the phone clip on V2 from 330 to 450, over the gap and
   * into b, without its sound.
   */
  const gapped = (): Timeline => {
    const m = [media('a'), media('b', { durationSec: 4 }), media('phone', { durationSec: 4, width: 1080, height: 1920 })]
    let t = { ...createTimeline(30, { width: 1080, height: 1920 }), media: m }
    t = addClip(addClip(t, 'a', 'c1'), 'b', 'c2')
    t = moveClip(t, 'c2', 'v1', 360)
    return withPicture(t, 'p1', 'phone', 330)
  }
  /** Each span as its edges, the clip underneath, the clips over it and the sounds heard. */
  const shape = (t: Timeline, framed: boolean): [number, number, string | null, string[], string[]][] =>
    spansOf(t, framed).map((s) => [s.from, s.to, s.base?.id ?? null, s.overlays.map((o) => o.id), s.sounds.map((c) => c.id)])

  it('cuts the whole sequence at every edge of every video clip on every track, gaps and all', () => {
    expect(shape(gapped(), true)).toEqual([
      [0, 300, 'c1', [], ['c1.1']],
      [300, 330, null, [], []],
      [330, 360, 'p1', [], []],
      [360, 450, 'c2', ['p1'], ['c2.1']],
      [450, 480, 'c2', [], ['c2.1']]
    ])
    // Without a frame to place pictures in, only V1 counts.
    expect(shape(gapped(), false)).toEqual([
      [0, 300, 'c1', [], ['c1.1']],
      [300, 360, null, [], []],
      [360, 480, 'c2', [], ['c2.1']]
    ])
  })

  it('leaves a hidden track out, so what is hidden is not in the export', () => {
    const t = setTrackHidden(gapped(), gapped().videoTracks[1]!.id, true)
    // V2 held the phone clip. With it hidden the sequence is V1's two clips
    // and the gap between them, exactly as if V2 had nothing on it.
    expect(shape(t, true)).toEqual([
      [0, 300, 'c1', [], ['c1.1']],
      [300, 360, null, [], []],
      [360, 480, 'c2', [], ['c2.1']]
    ])
  })

  it('leaves black where a hidden V1 was, rather than promoting V2 into its frame', () => {
    const t = setTrackHidden(gapped(), 'v1', true)
    // Unframed, V1 is the output itself.
    expect(shape(t, false)).toEqual([[0, 480, null, [], ['c1.1', 'c2.1']]])
  })

  it('makes each span a segment of its exact length, a gap black and silent, generated', () => {
    const plan = planRender(request(gapped()))
    expect(plan.segments.map((s) => s.frames)).toEqual([300, 30, 30, 90, 30])
    expect(plan.totalFrames).toBe(480)
    const black = plan.segments[1]!
    expect([black.clipId, black.label]).toEqual(['', 'black'])
    expect(inputs(black.args)).toEqual([BLACK, SILENCE])
    expect(graphOf(black.args)).toBe(`${BLACK_BASE}[vt];${TAGGED}`)
    expect(maps(black.args)).toEqual(['[v]', '1:a'])
    expect(after(black.args, '-t')).toBe('1.000000')
    expect(after(black.args, '-frames:v')).toBe('30')
    expect(plan.join?.listContent.split('\n').filter((l) => l.startsWith('file '))).toHaveLength(5)
  })

  it('builds a picture on V2 over a gap in V1 as a V1 clip is, from its own start', () => {
    const t = gapped()
    const plan = planRender(request(t))
    const over = plan.segments[2]!
    expect([over.clipId, over.label]).toEqual(['p1', 'phone take'])
    expect(inputs(over.args)).toEqual(['C:\\v\\phone take.mp4', SILENCE])
    expect(seeks(over.args)).toEqual(['0.000000'])
    expect(graphOf(over.args)).toBe(
      `[0:v]fps=30:start_time=0,${cropOf(picture(t, 'p1').transform.crop)},` +
        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,' +
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt];' +
        TAGGED
    )
    // Then laid over b, from where it has got to.
    const onB = plan.segments[3]!
    expect(inputs(onB.args)).toEqual(['C:\\v\\b take.mp4', 'C:\\v\\phone take.mp4'])
    expect(seeks(onB.args)).toEqual(['0.000000', '1.000000'])
  })

  it('puts a picture on V2 in the corner over a gap in V1 in its place, black around it', () => {
    let t = gapped()
    const phone = t.media[2]!
    t = setPlace(t, 'p1', 'main', cornerPlace(phone, picture(t, 'p1').transform.crop, 1080, 1920), true)
    const p = picture(t, 'p1').transform
    const box = placeInPixels(p.place, 1080, 1920)
    const plan = planRender(request(t))
    expect(graphOf(plan.segments[2]!.args)).toBe(
      `[0:v]fps=30:start_time=0[s0];[s0]${cropOf(p.crop)},` +
        `scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `pad=1080:1920:${box.x}:${box.y}:color=black,setsar=1,tpad=stop_mode=clone:stop=-1[vt];${TAGGED}`
    )
    expect(graphOf(plan.segments[3]!.args)).toContain(`[b][q0]overlay=x=${box.x}:y=${box.y}[vt]`)
  })

  it('is not cut by a sound clip, which it reads in pieces, but runs on to the end of the last one', () => {
    const t = projectWith(media('a'))
    // The song from 100 to 700.
    const withSong = withSoundOn({ ...t, media: [...t.media, song] }, 'a2', { clipId: 's1', mediaId: 'song', at: 100 })
    expect(shape(withSong, true).map(([from, to, , , sounds]) => [from, to, sounds.includes('s1')])).toEqual([
      [0, 300, true],
      [300, 700, true]
    ])
  })

  it('goes on past V1 to the end of the last clip, in black with the sound heard there, and the frames still add up', () => {
    const t = projectWith(media('a'))
    const withSong = withSoundOn({ ...t, media: [...t.media, song] }, 'a2', { clipId: 's1', mediaId: 'song', at: 150 })
    const plan = planRender(request(withSong))
    expect(plan.segments.map((s) => s.frames)).toEqual([300, 450])
    expect(plan.totalFrames).toBe(750)
    const black = plan.segments[1]!.args
    expect(inputs(black)).toEqual([BLACK, 'C:\\m\\song.wav'])
    expect(graphOf(black)).toBe(`${BLACK_BASE}[vt];${TAGGED};${heardChain(1, 1, 's0', 0, 4800, fadeOut(15))};[s0]apad,${FORMAT}[a]`)
    expect(maps(black)).toEqual(['[v]', '[a]'])
    expect(after(black, '-frames:v')).toBe('450')
    expect(after(black, '-t')).toBe('15.000000')
    expect(after(black, '-c:a')).toBe('pcm_f32le')
    expect(plan.join?.listContent.split('\n').filter((l) => l.startsWith('file '))).toHaveLength(2)
  })

  it('exports a sequence with nothing on V1 but sound on an audio track', () => {
    const t = createTimeline(30, { width: 1080, height: 1920 })
    const onlySong = withSoundOn({ ...t, media: [song] }, 'a2', { clipId: 's1', mediaId: 'song', at: 30 })
    const plan = planRender(request(onlySong))
    expect(plan.segments.map((s) => s.frames)).toEqual([630])
    expect(inputs(plan.segments[0]!.args)).toEqual([BLACK, 'C:\\m\\song.wav'])
    expect(graphOf(plan.segments[0]!.args)).toContain('adelay=48000S:all=1')
    expect(() => planRender(request(onlySong, { mode: 'batch' }))).toThrow(/nothing on the timeline/i)
  })
})

describe('the order of a segment\'s inputs', () => {
  const phone = media('phone', { durationSec: 4, width: 1080, height: 1920 })
  const b = media('b', { durationSec: 4 })
  /**
   * The OBS recording on V1 with its second and third streams heard on A2 and
   * A3, the song put on A1 last of all, where the recording's first stream
   * was, and b on V3 put there before the phone on V2.
   */
  const busy = (): Timeline => {
    let t = obsHeard([1, 1, 1])
    t = removeClip({ ...t, media: [...t.media, song, phone, b] }, 'c1.1', true)
    t = addTrack(addTrack(t, 'video', 'v2'), 'video', 'v3')
    t = withPicture(t, 'p2', 'b', 0, 'v3')
    t = withPicture(t, 'p1', 'phone', 0, 'v2')
    return withSoundOn(t, 'a1', { clipId: 's1', mediaId: 'song', at: 0 })
  }

  it('is the picture underneath, the sounds heard in track order, then the higher pictures in track order', () => {
    const t = busy()
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual([
      'C:\\v\\obs take.mp4',
      'C:\\m\\song.wav',
      'C:\\cache\\track-2.m4a',
      'C:\\cache\\track-3.m4a',
      'C:\\v\\phone take.mp4',
      'C:\\v\\b take.mp4'
    ])
    const graph = graphOf(args)
    expect(graph).toContain(`[4:v]fps=30:start_time=0,${cropOf(picture(t, 'p1').transform.crop)},`)
    expect(graph).toContain(`[5:v]fps=30:start_time=0,${cropOf(picture(t, 'p2').transform.crop)},`)
    expect(graph).toContain(
      `${heardChain(1, 1, 's0', 0, 0, FADE_IN)};${heardChain(2, 1, 's1', 0, 0, FADE_IN)};${heardChain(3, 1, 's2', 0, 0, FADE_IN)};` +
        `[s0][s1][s2]amix=inputs=3:duration=longest:normalize=0,apad,${FORMAT}[a]`
    )
    expect(maps(args)).toEqual(['[v]', '[a]'])
  })

  it('puts the generated silence second when nothing is heard, and then the higher pictures', () => {
    let t = busy()
    for (const id of ['s1', 'c1.2', 'c1.3']) t = setClipAudio(t, id, { gain: 1, muted: true })
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\obs take.mp4', SILENCE, 'C:\\v\\phone take.mp4', 'C:\\v\\b take.mp4'])
    expect(graphOf(args)).toContain('[2:v]fps=30:start_time=0,')
    expect(graphOf(args)).toContain('[3:v]fps=30:start_time=0,')
    expect(maps(args)).toEqual(['[v]', '1:a'])
  })

  it('splits a higher clip with layers once, and lays each of its pictures over in its place', () => {
    const wide = media('wide', { width: 3840, height: 1080 })
    let t = projectWith(media('a'))
    t = withPicture({ ...t, media: [...t.media, wide] }, 'p1', 'wide', 0)
    t = applyLayout(t, 'p1', 'split')
    const p = picture(t, 'p1')
    const args = planRender(request(t)).segments[0]!.args
    expect(inputs(args)).toEqual(['C:\\v\\a take.mp4', 'C:\\v\\wide take.mp4'])
    const fitted = (crop: Clip['transform']['crop']): string =>
      `${cropOf(crop)},scale=1080:960:force_original_aspect_ratio=decrease:flags=lanczos,` +
      'pad=1080:960:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=stop_mode=clone:stop=-1'
    const graph = graphOf(args)
    expect(graph).toContain(
      '[b];[1:v]fps=30:start_time=0,split=2[i0_0][i0_1];' +
        `[i0_0]${fitted(p.transform.crop)}[q0];[b][q0]overlay=x=0:y=0[u0];` +
        `[i0_1]${fitted(p.layers[0]!.crop)}[q1];[u0][q1]overlay=x=0:y=960[vt];`
    )
    expect(graph.match(/split=/g)).toHaveLength(1)
  })
})

describe('the copies an export reads', () => {
  it('lists the copies, named for a message if one is missing', () => {
    const t = obsHeard([1, null, 1])
    expect(trackCopiesRead(t, 'join')).toEqual([{ path: 'C:\\cache\\track-3.m4a', label: 'track 3 of obs take' }])
    expect(trackCopiesRead(obsHeard([1]), 'join')).toEqual([])
    const muted = setClipAudio(t, 'c1.3', { gain: 1, muted: true })
    expect(trackCopiesRead(muted, 'batch')).toEqual([])
  })

  it('lists every heard copy for a join, and only the V1 clips\' linked heard copies for files of their own', () => {
    let t = obsHeard([1, 1, null])
    // A second clip of the recording, unlinked, with its third stream heard: not the sound of any V1 clip.
    t = unlinkClip(addClip(t, 'obs', 'c2'), 'c2')
    t = setClipAudio(t, 'c2.3', { gain: 1, muted: false })
    expect(trackCopiesRead(t, 'join')).toEqual([
      { path: 'C:\\cache\\track-2.m4a', label: 'track 2 of obs take' },
      { path: 'C:\\cache\\track-3.m4a', label: 'track 3 of obs take' }
    ])
    expect(trackCopiesRead(t, 'batch')).toEqual([{ path: 'C:\\cache\\track-2.m4a', label: 'track 2 of obs take' }])
    const quiet = setClipAudio(t, 'c1.2', { gain: 1, muted: true })
    expect(trackCopiesRead(quiet, 'join')).toEqual([{ path: 'C:\\cache\\track-3.m4a', label: 'track 3 of obs take' }])
    expect(trackCopiesRead(quiet, 'batch')).toEqual([])
  })

  it('counts a sound clip past the end of V1, since the sequence runs on to it', () => {
    const t = projectWith(media('a'))
    // The recording's second stream alone, heard on A2, its picture taken away.
    const soundAt = (at: number): Timeline =>
      removeClip(withSoundOn({ ...t, media: [...t.media, obs] }, 'a2', { clipId: 's1', mediaId: 'obs', at, streams: [1] }), 's1', true)
    expect(trackCopiesRead(soundAt(400), 'join')).toEqual([{ path: 'C:\\cache\\track-2.m4a', label: 'track 2 of obs take' }])
    expect(trackCopiesRead(soundAt(0), 'join')).toEqual([{ path: 'C:\\cache\\track-2.m4a', label: 'track 2 of obs take' }])
  })
})

describe('keeping files that are already there', () => {
  it('leaves a name alone when nothing has it', () => {
    expect(freeName('D:\\out\\holiday.mp4', new Set())).toBe('D:\\out\\holiday.mp4')
  })

  it('takes the first free number, ignoring case as Windows does', () => {
    const taken = new Set(['d:\\out\\holiday.mp4', 'd:\\out\\holiday (2).mp4'])
    expect(freeName('D:\\out\\Holiday.mp4', taken)).toBe('D:\\out\\Holiday (3).mp4')
  })

  it('puts the number before the extension, and not in a folder name that has a dot', () => {
    expect(freeName('D:\\v1.2\\cut', new Set(['d:\\v1.2\\cut']))).toBe('D:\\v1.2\\cut (2)')
  })

  it('gives a joined file a free name when its own is kept', () => {
    const plan = planRender(request(projectWith(media('a')), { keep: ['D:\\out\\holiday.mp4'] }))
    expect(plan.outputs).toEqual(['D:\\out\\holiday (2).mp4'])
    expect(plan.join?.output).toBe('D:\\out\\holiday (2).mp4')
    // The command writes where the plan says.
    expect(plan.join?.args.at(-1)).toBe('D:\\out\\holiday (2).mp4')
  })

  it('gives each file of one per clip a free name, in its command too', () => {
    const plan = planRender(
      request(projectWith(media('a'), media('b')), { mode: 'batch', keep: ['D:\\out\\holiday_02_b take.mp4'] })
    )
    expect(plan.outputs).toEqual(['D:\\out\\holiday_01_a take.mp4', 'D:\\out\\holiday_02_b take (2).mp4'])
    expect(plan.segments[1]?.args.at(-1)).toBe('D:\\out\\holiday_02_b take (2).mp4')
  })

  it('never writes two files of one export over each other, even with nothing kept', () => {
    // A pattern that gives two clips of recordings with the same name the same file name.
    const plan = planRender(
      request(projectWith(media('a'), media('a2', { originalPath: 'C:\\w\\a take.mp4' })), {
        mode: 'batch',
        filenamePattern: '{clip}'
      })
    )
    expect(plan.outputs).toEqual(['D:\\out\\a take.mp4', 'D:\\out\\a take (2).mp4'])
  })

  it('knows a kept file however its folder was written, with either slash', () => {
    const plan = planRender(request(projectWith(media('a')), { outputDir: 'D:/out', keep: ['D:\\out\\holiday.mp4'] }))
    expect(plan.outputs).toEqual(['D:/out\\holiday (2).mp4'])
    expect(samePathKey('D:/Out//holiday.MP4')).toBe(samePathKey('d:\\out\\holiday.mp4'))
  })

  it('writes to its usual names when nothing is kept, as before', () => {
    expect(planRender(request(projectWith(media('a')))).outputs).toEqual(['D:\\out\\holiday.mp4'])
  })
})

describe('a recording\'s own sound cut into pieces by a picture over part of it', () => {
  it('reads the pieces after the first on their own, from a little earlier, and the first as it always was', () => {
    // a is 0 to 300 with its sound heard; a picture on V2 from 60 to 180 cuts it in three.
    const t = projectWith(media('a'))
    const withOver = { ...t, media: [...t.media, media('phone', { durationSec: 4 })] }
    const over = addSource(addTrack(withOver, 'video', 'v2'), { mediaId: 'phone', clipId: 'p1', at: 60, onTrack: 'v2', streams: [] })
    const [first, second, third] = planRender(request(over)).segments.map((s) => s.args)
    // The first starts where the clip does: its sound comes with its picture, as always.
    expect(inputs(first!)).toEqual(['C:\\v\\a take.mp4'])
    expect(graphOf(first!)).toContain('[0:a:0]volume=1,aresample=async=1')
    // The others run on from the one before.
    expect(second!.filter((_, i) => second![i - 1] === '-ss')).toEqual(['2.000000', '1.900000', '0.000000'])
    expect(graphOf(second!)).toContain(heardChain(1, 1, 's0', 0, 4800))
    expect(third!.filter((_, i) => third![i - 1] === '-ss')).toEqual(['6.000000', '5.900000'])
    expect(graphOf(third!)).toContain(heardChain(1, 1, 's0', 0, 4800, fadeOut(4)))
  })

  it('fades the sound only at its own ends, and never where a picture cut split it', () => {
    const t = projectWith(media('a'))
    const withOver = { ...t, media: [...t.media, media('phone', { durationSec: 4 })] }
    const over = addSource(addTrack(withOver, 'video', 'v2'), { mediaId: 'phone', clipId: 'p1', at: 60, onTrack: 'v2', streams: [] })
    const [first, second, third] = planRender(request(over)).segments.map((s) => s.args)
    // One sound of ten seconds, in three pieces. Fading each piece would dip it twice in
    // the middle, at moments the edit never put a cut at and the listener would hear.
    expect(graphOf(first!)).toContain(FADE_IN.slice(1))
    expect(graphOf(first!)).not.toContain('afade=t=out')
    expect(graphOf(second!)).not.toContain('afade')
    expect(graphOf(third!)).not.toContain('afade=t=in')
    expect(graphOf(third!)).toContain('afade=t=out')
  })

  it('shortens the fade on a sound too short to hold two of them', () => {
    // A single frame of 120 fps footage is 8.3 ms, so two 5 ms fades would overlap and
    // the one at the end would start before the one at the start had finished. Each is
    // cut to a third of the sound instead, which leaves a third of it at full level.
    const fast = createTimeline(120, { width: 1080, height: 1920 })
    const one = addClip({ ...fast, media: [media('a')] }, 'a')
    const picture = v1Clips(one)[0]!
    const trimmed = setClipOut(setClipOut(one, picture.id, 1, true), firstSound(one).id, 1, true)
    const graph = graphOf(planRender(request(trimmed)).segments[0]!.args)
    expect(graph).toContain('afade=t=in:st=0:d=0.002778')
    expect(graph).toContain('afade=t=out:st=0.005556:d=0.002778')
  })
})

describe('levelling the loudness of what comes out', () => {
  it('measures a joined export from the same list the join reads, and asks for the short form target', () => {
    const plan = planRender(request(projectWith(media('a'))))
    expect(plan.loudness?.target).toEqual({ i: -14, tp: -1, lra: 11 })
    expect(plan.loudness?.measureArgs).toEqual([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'D:\\out\\.scratch\\segments.txt',
      '-vn',
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
      '-f', 'null', '-'
    ])
    expect(plan.loudness?.measureArgs[5]).toBe(plan.join?.listPath)
  })

  it('leaves a handoff alone, because its files are pieces for another editor rather than deliverables', () => {
    const plan = planRender(request(projectWith(media('a')), { preset: presetById('handoff'), mode: 'batch' }))
    expect(plan.join).toBeNull()
    expect(plan.loudness).toBeNull()
  })
})

describe('captions burned in', () => {
  /** Two clips of a on V1, 0 to 300 and 300 to 600, and "one two" said over 290 to 310, across the cut. */
  function captioned(): Timeline {
    const t = projectWith(media('a'), media('b'))
    return setCaptions(t, [{ text: 'one', start: 290, length: 10 }, { text: 'two', start: 300, length: 10 }], [])
  }

  it("draws the captions over a segment's finished picture, from a file named in the folder it runs in", () => {
    const [first] = planRender(request(captioned())).segments
    expect(first!.subtitles?.name).toBe('captions-001.ass')
    expect(first!.subtitles?.content).toContain('Dialogue:')
    const graph = graphOf(first!.args)
    // The picture chain ends at [c], and the captions go over it last, as [v], named by relative paths only.
    expect(graph).toContain('[c];[c]scale=in_color_matrix=bt709:in_range=tv,format=rgb24,ass=filename=captions-001.ass:fontsdir=fonts,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vt];')
    expect(graph.split(';').filter((f) => f.includes('ass='))).toHaveLength(1)
  })

  it('writes a caption across the edge between two segments into both, each for its own part', () => {
    const [a, b] = planRender(request(captioned())).segments
    // "one" is over the last 10 frames of the first, "two" over the first 10 of the second.
    expect(a!.subtitles?.content).toContain('ONE')
    expect(b!.subtitles?.content).toContain('TWO')
    const times = (content: string | undefined): string[] =>
      (content ?? '')
        .split(/\r?\n/)
        .filter((l) => l.startsWith('Dialogue:'))
        .map((l) => l.split(',').slice(1, 3).join('-'))
    // In the first, "one" lit from 290 to its end at 300, counted from 0; in the second, "two" from its start.
    expect(times(a!.subtitles?.content)).toEqual(['0:00:09.65-0:00:09.98'])
    expect(times(b!.subtitles?.content)).toEqual(['0:00:00.00-0:00:00.32'])
  })

  it('leaves a segment with no caption over it just as it was', () => {
    const plain = projectWith(media('a'), media('b'))
    const t = setCaptions(plain, [{ text: 'one', start: 10, length: 10 }], [])
    const [, second] = planRender(request(t)).segments
    expect(second!.subtitles).toBeUndefined()
    expect(second!.args).toEqual(planRender(request(plain)).segments[1]!.args)
  })

  it("puts each clip's own captions in its file, one file per clip, timed from its start", () => {
    const segments = planRender(request(captioned(), { mode: 'batch' })).segments
    expect(segments.map((s) => s.subtitles?.name)).toEqual(['captions-001.ass', 'captions-002.ass'])
    expect(segments[1]!.subtitles?.content).toContain('0:00:00.00')
  })

  it('draws them over the whole picture of a clip laid out in two, and over a picture on V2', () => {
    const base = captioned()
    const split = applyLayout(base, v1Clips(base)[0]!.id, 'split')
    const splitGraph = graphOf(planRender(request(split)).segments[0]!.args)
    expect(splitGraph).toMatch(/overlay=x=\d+:y=\d+\[c\];\[c\]scale=in_color_matrix=bt709:in_range=tv,format=rgb24,ass=filename=captions-001\.ass:fontsdir=fonts,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p\[vt\]/)
    const over = withPicture(captioned(), 'pic', 'a', 280)
    const overGraph = graphOf(planRender(request(over)).segments[1]!.args)
    expect(overGraph).toMatch(/overlay=x=\d+:y=\d+\[c\];\[c\]scale=in_color_matrix=bt709:in_range=tv,format=rgb24,ass=filename=captions-002\.ass:fontsdir=fonts,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p\[vt\]/)
  })

  it('leaves them out under Handoff, which has no frame to put them in', () => {
    const segments = planRender(request(captioned(), { preset: presetById('handoff'), mode: 'batch' })).segments
    expect(segments.every((s) => s.subtitles === undefined)).toBe(true)
    expect(segments.every((s) => !graphOf(s.args).includes('ass='))).toBe(true)
  })
})

describe('transitions in the plan', () => {
  /** Two clips of one ten second recording on V1, meeting at 150, the first with footage to spare. */
  function twoClips(): Timeline {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }
    t = addClip(t, 'a', 'first')
    t = setClipOut(t, 'first', 150)
    t = addClip(t, 'a', 'second')
    return t
  }

  const shape = (t: Timeline): [number, number, string | null][] => spansOf(t, true).map((s) => [s.from, s.to, s.base?.id ?? null])

  it('cuts a stretch at both ends of a blend, and puts both clips in it', () => {
    const t = addTransition(twoClips(), 'second', 'in', { kind: 'dissolve', length: 30 })
    expect(shape(t)).toEqual([
      [0, 135, 'first'],
      [135, 165, 'first'],
      [165, 450, 'second']
    ])
    const middle = spansOf(t, true)[1]!
    expect(middle.blends.map((b) => [b.clipId, b.into.id, b.xfade])).toEqual([['first', 'second', 'fade']])
    expect(middle.washes).toEqual([])
  })

  it('cuts a dip in two at its middle, one going to the colour and one coming out of it', () => {
    const t = addTransition(twoClips(), 'second', 'in', { kind: 'toBlack', length: 30 })
    expect(shape(t)).toEqual([
      [0, 135, 'first'],
      [135, 150, 'first'],
      [150, 165, 'second'],
      [165, 450, 'second']
    ])
    const [, out, into] = spansOf(t, true)
    expect(out!.washes).toEqual([{ clipId: 'first', colour: 'black', dir: 'out', from: 135, to: 150 }])
    expect(into!.washes).toEqual([{ clipId: 'second', colour: 'black', dir: 'in', from: 150, to: 165 }])
    expect(out!.blends).toEqual([])
  })

  it('shows the clip that arrives from the middle of a dip that ends at the cut, never the one going out at full brightness', () => {
    // 13 frames all before the cut at 150: to black over 137 to 144, out of it from 144 to 150.
    let t = addTransition(twoClips(), 'second', 'in', { kind: 'toBlack', length: 13 })
    t = setTransition(t, 'second', 'in', { length: 13, before: 13 })
    expect(shape(t)).toEqual([
      [0, 137, 'first'],
      [137, 144, 'first'],
      [144, 150, 'second'],
      [150, 450, 'second']
    ])
    const [, out, into] = spansOf(t, true)
    expect(out!.washes).toEqual([{ clipId: 'first', colour: 'black', dir: 'out', from: 137, to: 144 }])
    expect(into!.washes).toEqual([{ clipId: 'second', colour: 'black', dir: 'in', from: 144, to: 150 }])
  })

  it('keeps the clip going out on screen through a dip that starts at the cut, up to the middle of it', () => {
    let t = addTransition(twoClips(), 'second', 'in', { kind: 'toBlack', length: 30 })
    t = setTransition(t, 'second', 'in', { length: 30, before: 0 })
    expect(shape(t)).toEqual([
      [0, 150, 'first'],
      [150, 165, 'first'],
      [165, 180, 'second'],
      [180, 450, 'second']
    ])
  })

  it('leaves every other stretch alone, so the frame count only moves where a window hangs off the end', () => {
    const plain = twoClips()
    const t = addTransition(plain, 'second', 'in', { kind: 'dissolve', length: 30 })
    const total = (x: Timeline): number => spansOf(x, true).reduce((n, s) => n + (s.to - s.from), 0)
    expect(total(t)).toBe(total(plain))
  })

  it('crossfades with xfade, both sides through the same chain first', () => {
    const t = addTransition(twoClips(), 'second', 'in', { kind: 'wipeLeft', length: 30 })
    const plan = planRender(request(t))
    const graph = graphOf(plan.segments[1]!.args)
    expect(graph).toContain('xfade=transition=wipeleft:duration=1.000000:offset=0')
    // Both inputs forced to one pixel format: xfade fails or produces nonsense on two that differ.
    expect(graph).toContain('[xa]format=yuv420p[xa1]')
    expect(graph).toContain('[xb]format=yuv420p[xb1]')
    // The second side is an input of its own, not the one the first reads.
    const second = /\[(\d+):v\][^;]*\[xb\]/.exec(graph)
    expect(second).not.toBeNull()
    expect(Number(second![1])).toBeGreaterThan(0)
  })

  it('picks a blend up where it stands when something on another track cuts it in two, rather than starting it again', () => {
    // The window is 135 to 165; a clip on V2 from 150 cuts it at the cut itself.
    let t = addTransition(twoClips(), 'second', 'in', { kind: 'dissolve', length: 30 })
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { clipId: 'title', mediaId: 'a', at: 150, onTrack: 'v2' })
    const segments = planRender(request(t)).segments.map((s) => graphOf(s.args))
    const [first, second] = segments.filter((g) => g.includes('xfade'))
    // Both halves run the whole second of it: the first from its start, the second from half way.
    expect(first).toContain('xfade=transition=fade:duration=1.000000:offset=0[')
    expect(first).not.toContain('trim=start=')
    expect(second).toContain('tpad=start_duration=0.500000:start_mode=clone')
    expect(second).toContain('xfade=transition=fade:duration=1.000000:offset=0,trim=start=0.500000,setpts=PTS-STARTPTS')
  })

  it('dips with a fade over the whole stretch, and needs no second input for it', () => {
    const t = addTransition(twoClips(), 'second', 'in', { kind: 'toWhite', length: 30 })
    const plan = planRender(request(t))
    expect(graphOf(plan.segments[1]!.args)).toContain('fade=t=out:st=0:d=0.500000:color=white')
    expect(graphOf(plan.segments[2]!.args)).toContain('fade=t=in:st=0:d=0.500000:color=white')
    // One picture read, not two: a dip needs nothing on the other side.
    expect((graphOf(plan.segments[1]!.args).match(/:v\]/g) ?? []).length).toBe(1)
  })

  it('flashes with the same fade, starting three quarters of the way to the cut (plan 95)', () => {
    const t = addTransition(twoClips(), 'second', 'in', { kind: 'flash', length: 30 })
    const plan = planRender(request(t))
    expect(graphOf(plan.segments[1]!.args)).toContain('fade=t=out:st=0.375000:d=0.125000:color=white')
    expect(graphOf(plan.segments[2]!.args)).toContain('fade=t=in:st=0:d=0.500000:color=white')
  })

  it('lays the stylised kinds\' own filters on a dissolve, counting the window from its first frame (plan 95)', () => {
    const graphFor = (kind: string): string => graphOf(planRender(request(addTransition(twoClips(), 'second', 'in', { kind, length: 30 }))).segments[1]!.args)
    const spin = graphFor('spin')
    expect(spin).toContain("xfade=transition=fade:duration=1.000000:offset=0,rotate=a='2*PI*(clip(n/30,0,1)")
    expect(spin).toContain(':fillcolor=black')
    // The next picture enlarged before the two are mixed.
    expect(graphFor('zoomOut')).toMatch(/\[xb1\]perspective=x0='W\/2-W\/2\/\(1\+3\*\(1-\(clip\(in\/30,0,1\)[^;]*sense=source:eval=frame\[xabz\];\[xa1\]\[xabz\]xfade=transition=fade/)
    expect(graphFor('pixelate')).toContain('xfade=transition=pixelize:duration=1.000000:offset=0')
    // Red and blue set apart frame by frame, in RGB and back by the BT.709 matrix: none on the first, 16 each way half way.
    const split = graphFor('rgbSplit')
    expect(split).toContain('scale=in_color_matrix=bt709:in_range=tv,format=gbrp,sendcmd=c=\'0.000000 rgbashift rh 0, rgbashift bh 0;')
    expect(split).toContain('0.483333 rgbashift rh -32, rgbashift bh 32;')
    expect(split).toContain("',rgbashift,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p")
  })

  it('holds the first frame where a window reaches back past the start of the recording', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }
    t = addClip(t, 'a', 'only')
    t = moveClip(t, 'only', 'v1', 60)
    t = addTransition(t, 'only', 'in', { kind: 'toBlack', length: 30 })
    const plan = planRender(request(t))
    // The first stretch is the black before the clip; the window is the next.
    const window = plan.segments[1]!
    expect(graphOf(window.args)).toContain('tpad=start_mode=clone:start=15')
    expect(seeks(window.args)[0]).toBe('0.000000')
  })
})

describe('planRender, only part of the sequence', () => {
  // Two ten second clips on V1: 0 to 300 and 300 to 600.
  const t = (): Timeline => projectWith(media('a'), media('b'))

  it('joins only the frames inside the range, cut at its edges', () => {
    const plan = planRender(request(t(), { range: { from: 150, to: 450 } }))
    expect(plan.totalFrames).toBe(300)
    expect(plan.segments.map((s) => s.frames)).toEqual([150, 150])
    // The first piece starts 5 s into the first clip, the second at the second's start.
    expect(plan.segments[0]!.args.slice(0, 2)).toEqual(['-ss', '5.000000'])
    expect(plan.segments[1]!.args.slice(0, 2)).toEqual(['-ss', '0.000000'])
  })

  it('writes one file per clip for the clips inside it, each cut to it', () => {
    const plan = planRender(request(t(), { mode: 'batch', range: { from: 450, to: 600 } }))
    expect(plan.segments).toHaveLength(1)
    expect(plan.segments[0]!.frames).toBe(150)
    expect(plan.segments[0]!.args.slice(0, 2)).toEqual(['-ss', '5.000000'])
  })

  it('refuses a range with nothing in it', () => {
    expect(() => planRender(request(t(), { range: { from: 700, to: 800 } }))).toThrow(/nothing in that part/)
  })
})

describe('a move in the export', () => {
  /** Ten per cent in on the tall crop a vertical sequence starts a recording with, centred: the punch-in. */
  const closer = { x: 686, y: 54, w: 548, h: 972 }
  const graphs = (t: Timeline, overrides: Partial<RenderRequest> = {}): string[] => planRender(request(t, overrides)).segments.map((s) => graphOf(s.args))

  /** One ten second recording on V1 that cuts closer three seconds in: a keyframe that holds, and the closer one. */
  const cutting = (): Timeline => {
    const t = projectWith(media('a'))
    const c = v1Clips(t)[0]!
    return setZoomKeys(t, c.id, [
      { at: 0, crop: c.transform.crop, ease: 'hold' },
      { at: 90, crop: closer }
    ])
  }

  it('works a 4K zoom under Handoff in a window no wider than 7680 pixels (audit 2026-10-01)', () => {
    const wide = media('a', { width: 3840, height: 2160 })
    const t0 = addClip({ ...createTimeline(30, { width: 1920, height: 1080 }, 'landscape'), media: [wide] }, 'a')
    const c = v1Clips(t0)[0]!
    const t = setZoomKeys(t0, c.id, [
      { at: 0, crop: { x: 0, y: 0, w: 3840, h: 2160 } },
      { at: 90, crop: { x: 960, y: 540, w: 1920, h: 1080 } }
    ])
    const [graph] = graphs(t, { preset: presetById('handoff') })
    const size = graph!.match(/zoompan=.*?:s=(\d+)x(\d+)/)
    expect(size).not.toBeNull()
    expect(Number(size![1])).toBeLessThanOrEqual(7680)
  })

  it('keeps the recording clock when the export is cut in pieces part way through the clip', () => {
    // A picture over V1 from one second to two cuts the export at both.
    let t = cutting()
    t = withPicture({ ...t, media: [...t.media, media('b', { durationSec: 1 })] }, 'p1', 'b', 30)
    const g = graphs(t)
    expect(g).toHaveLength(3)
    // The piece from frame 60 shows the recording from its frame 60, so its cut is 30 frames in.
    expect(g[0]).toContain('lt(on,90)')
    expect(g[1]).toContain('lt((on+30),90)')
    expect(g[2]).toContain('lt((on+60),90)')
  })

  it('keeps the recording clock in a range that starts part way through it', () => {
    const g = graphs(cutting(), { range: { from: 45, to: 150 } })
    expect(g).toHaveLength(1)
    expect(g[0]).toContain('lt((on+45),90)')
  })

  it('counts on the recording, so a trimmed start leaves the cut where it was on the picture', () => {
    // Trimmed by a second: the clip's first frame is the recording's 30th, and the cut still on its 90th.
    const g = graphs(headTrimmed(cutting(), 30))
    expect(g[0]).toContain('lt((on+30),90)')
  })

  it('moves the main picture of a clip with two pictures', () => {
    let t = projectWith(media('a'))
    const id = v1Clips(t)[0]!.id
    t = applyLayout(t, id, 'pip')
    const crop = findVideoClip(t, id)!.clip.transform.crop
    t = setZoomKeys(t, id, [
      { at: 30, crop },
      { at: 60, crop: { x: crop.x + 20, y: crop.y + 10, w: crop.w - 40, h: crop.h - 20 } }
    ])
    const g = graphs(t)[0]!
    expect(g).toContain('zoompan')
    // Its second picture stays where it is put.
    expect(g.match(/zoompan/g)).toHaveLength(1)
  })

  // Plan 73: every picture of a clip has a zoom of its own.
  it('moves the second picture of a clip by its own keyframes, and leaves the main one still', () => {
    let t = projectWith(media('a'))
    const id = v1Clips(t)[0]!.id
    t = applyLayout(t, id, 'pip')
    const layer = findVideoClip(t, id)!.clip.layers[0]!
    const crop = layer.crop
    t = setZoomKeys(
      t,
      id,
      [
        { at: 30, crop },
        { at: 60, crop: { x: crop.x + 20, y: crop.y + 10, w: crop.w - 40, h: crop.h - 20 } }
      ],
      layer.id
    )
    const g = graphs(t)[0]!
    expect(g.match(/zoompan/g)).toHaveLength(1)
    // On the second picture's branch, not the main one's.
    const branch = (label: string): string => g.split(';').find((part) => part.startsWith(label)) ?? ''
    expect(branch('[s0]')).not.toContain('zoompan')
    expect(branch('[s1]')).toContain('zoompan')
  })

  it('moves a recording laid over another track', () => {
    let t = projectWith(media('a'))
    t = withPicture({ ...t, media: [...t.media, media('b', { durationSec: 2 })] }, 'p1', 'b', 30)
    const crop = picture(t, 'p1').transform.crop
    const first = picture(t, 'p1').sourceIn
    t = setZoomKeys(t, 'p1', [
      { at: first, crop, ease: 'hold' },
      { at: first + 15, crop: closer }
    ])
    const over = graphs(t)[1]!
    expect(over).toContain('zoompan')
    expect(over).toContain(first === 0 ? 'lt(on,15)' : `lt((on+${first}),${first + 15})`)
  })

  it('goes in and back out through keyframes, each with its own ease', () => {
    const t = projectWith(media('a'))
    const c = v1Clips(t)[0]!
    const g = graphs(
      setZoomKeys(t, c.id, [
        { at: 30, crop: c.transform.crop, ease: 'linear' },
        { at: 45, crop: closer, ease: 'hold' },
        { at: 90, crop: closer, ease: 'out' },
        { at: 120, crop: c.transform.crop }
      ])
    )[0]!
    expect(g).toContain('lt(on,30)')
    expect(g).toContain('lt(on,45)')
    expect(g).toContain('lt(on,120)')
    // Steady in, ends slowly on the way out.
    expect(g).toContain('(on-30)/15')
    expect(g).toContain('(1-(1-((on-90)/30))*(1-((on-90)/30)))')
  })

  it('writes only the keyframes a piece shows, and a fixed crop where the picture stays still', () => {
    // In from 1 s to 1.5 s, out from 8 s to 8.5 s; a picture over 4 s to 5 s cuts the export there.
    let t = projectWith(media('a'))
    const c = v1Clips(t)[0]!
    t = setZoomKeys(t, c.id, [
      { at: 30, crop: c.transform.crop },
      { at: 45, crop: closer },
      { at: 240, crop: closer },
      { at: 255, crop: c.transform.crop }
    ])
    t = withPicture({ ...t, media: [...t.media, media('b', { durationSec: 1 })] }, 'p1', 'b', 120)
    const g = graphs(t)
    expect(g).toHaveLength(3)
    // The first piece moves in, and says nothing of the move out.
    expect(g[0]).toContain('zoompan')
    expect(g[0]).not.toContain('255')
    // The piece in the middle is held on the closer crop throughout.
    expect(g[1]).not.toContain('zoompan')
    expect(g[1]).toContain(cropOf(closer))
    // The last starts between two keyframes and moves out.
    expect(g[2]).toContain('zoompan')
    expect(g[2]).toContain('lt((on+150),255)')
  })

  it('moves a long graph into a file, read with -/filter_complex', () => {
    let t = projectWith(media('a'))
    const c = v1Clips(t)[0]!
    // A zoom in or out every two frames, the whole ten seconds.
    const keys = Array.from({ length: 150 }, (_, i) => ({ at: i * 2, crop: i % 2 === 0 ? c.transform.crop : closer, ease: 'linear' as const }))
    t = setZoomKeys(t, c.id, keys)
    const [segment] = planRender(request(t)).segments
    expect(segment!.args).not.toContain('-filter_complex')
    expect(after(segment!.args, '-/filter_complex')).toBe('graph-001.txt')
    expect(segment!.graph!.name).toBe('graph-001.txt')
    expect(segment!.graph!.content).toContain('zoompan')
    // As shallow for 150 keyframes as for two: ffmpeg refuses brackets nested much past a hundred deep.
    let depth = 0
    let deepest = 0
    for (const ch of segment!.graph!.content) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
      deepest = Math.max(deepest, depth)
    }
    expect(deepest).toBeLessThan(20)
    // A short one stays on the command line, with no file.
    const plain = planRender(request(cutting())).segments[0]!
    expect(plain.graph).toBeUndefined()
    expect(plain.args).toContain('-filter_complex')
  })
})

/**
 * The frame identity guarantee in code: the export's expressions for x, y and
 * w, evaluated here as ffmpeg evaluates them, on every frame, give the crop
 * the preview draws, `cropAtKeys`, to a hundredth of a pixel.
 */
describe('the export crop, frame by frame', () => {
  /** A small evaluator for the expressions the export writes: numbers, `on`, `+ - * /`, brackets, `if`, `lt`, `gte` and `clip`. */
  function evaluate(source: string, on: number): number {
    let i = 0
    const peek = (): string => source[i] ?? ''
    const take = (c: string): void => {
      if (source[i] !== c) throw new Error(`expected ${c} at ${i} in ${source}`)
      i++
    }
    const primary = (): number => {
      if (peek() === '(') {
        i++
        const v = sum()
        take(')')
        return v
      }
      if (peek() === '-') {
        i++
        return -primary()
      }
      const num = source.slice(i).match(/^\d+(\.\d+)?(e[-+]?\d+)?/)
      if (num) {
        i += num[0].length
        return Number(num[0])
      }
      const name = source.slice(i).match(/^[a-z]+/)
      if (!name) throw new Error(`cannot read ${source.slice(i)}`)
      i += name[0].length
      if (name[0] === 'on') return on
      take('(')
      const args = [sum()]
      while (peek() === ',') {
        i++
        args.push(sum())
      }
      take(')')
      const [a = 0, b = 0, c = 0] = args
      switch (name[0]) {
        case 'if':
          return a !== 0 ? b : c
        case 'lt':
          return a < b ? 1 : 0
        case 'gte':
          return a >= b ? 1 : 0
        case 'clip':
          return Math.min(c, Math.max(b, a))
        default:
          throw new Error(`no function ${name[0]}`)
      }
    }
    const product = (): number => {
      let v = primary()
      while (peek() === '*' || peek() === '/') {
        const op = source[i++]
        const r = primary()
        v = op === '*' ? v * r : v / r
      }
      return v
    }
    const sum = (): number => {
      let v = product()
      while (peek() === '+' || peek() === '-') {
        const op = source[i++]
        const r = product()
        v = op === '+' ? v + r : v - r
      }
      return v
    }
    const v = sum()
    if (i !== source.length) throw new Error(`left over: ${source.slice(i)}`)
    return v
  }

  /** The crop a graph's move shows on frame `on` of its piece, read back from its `crop`, `scale` and `zoompan`. */
  function cropFromGraph(graph: string, on: number): { x: number; y: number; w: number } {
    const move = graph.match(
      /crop=(\d+):(\d+):(\d+):(\d+),scale=iw\*([\d.]+):ih\*[\d.]+:flags=bicubic,zoompan=z='([^']+)':x='([^']+)':y='([^']+)':d=1:s=(\d+)x(\d+)/
    )
    if (!move) throw new Error('no move in the graph')
    const [, , , seenX, seenY, times, z, x, y, windowW] = move
    const t = Number(times)
    return {
      x: evaluate(x!, on) / t + Number(seenX),
      y: evaluate(y!, on) / t + Number(seenY),
      w: Number(windowW) / (evaluate(z!, on) * t)
    }
  }

  it('matches the preview on every frame of every piece, from a trimmed start and across a cut in the export', () => {
    const closer = { x: 686, y: 54, w: 548, h: 972 }
    const aside = { x: 400, y: 200, w: 440, h: 780 }
    let t = projectWith(media('a'))
    const id = v1Clips(t)[0]!.id
    const start = v1Clips(t)[0]!.transform.crop
    t = setZoomKeys(t, id, [
      { at: 40, crop: start },
      { at: 55, crop: closer, ease: 'in' },
      { at: 80, crop: aside, ease: 'hold' },
      { at: 100, crop: closer, ease: 'linear' },
      { at: 130, crop: start, ease: 'out' },
      { at: 170, crop: aside }
    ])
    // Its first half second trimmed off, and a picture over 2 s to 3 s cutting the export there.
    t = headTrimmed(t, 15)
    t = withPicture({ ...t, media: [...t.media, media('b', { durationSec: 1 })] }, 'p1', 'b', 60)
    const c = v1Clips(t)[0]!
    const plan = planRender(request(t))
    let from = 0
    let checked = 0
    for (const segment of plan.segments) {
      const graph = graphOf(segment.args)
      for (let on = 0; on < segment.frames; on++) {
        const want = cropAtKeys(c.transform.crop, c.transform.keys, c.sourceIn + from + on - c.timelineStart)
        if (!graph.includes('zoompan')) {
          expect(graph).toContain(cropOf(want))
          continue
        }
        const got = cropFromGraph(graph, on)
        expect(Math.abs(got.x - want.x)).toBeLessThan(0.01)
        expect(Math.abs(got.y - want.y)).toBeLessThan(0.01)
        expect(Math.abs(got.w - want.w)).toBeLessThan(0.01)
        checked++
      }
      from += segment.frames
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('a fast export on the graphics card', () => {
  const videoArgs = (args: string[]): string[] => args.slice(args.indexOf('-c:v'), args.indexOf('-pix_fmt'))
  it('encodes every piece on the card at the preset quality number when asked, and on the processor otherwise', () => {
    const t = projectWith(media('a'), media('b'))
    for (const mode of ['join', 'batch'] as const) {
      for (const segment of planRender(request(t, { fast: true, mode })).segments) {
        const v = videoArgs(segment.args)
        expect(v.slice(0, 2)).toEqual(['-c:v', 'h264_nvenc'])
        expect(v).toContain('-cq')
        expect(v).not.toContain('libx264')
      }
    }
    for (const segment of planRender(request(t)).segments) expect(videoArgs(segment.args).slice(0, 4)).toEqual(['-c:v', 'libx264', '-preset', 'slow'])
  })
})

describe('sharpening the picture a little', () => {
  it('cleans up grain and sharpens every piece when asked, and leaves the picture alone otherwise', () => {
    const t = projectWith(media('a'), media('b'))
    for (const segment of planRender(request(t, { sharpen: true })).segments) {
      const graph = graphOf(segment.args)
      expect(graph).toContain('hqdn3d=')
      // The brightness only: the colour planes' amount is 0.
      expect(graph).toMatch(/unsharp=5:5:0\.8:3:3:0\[vt\]/)
    }
    for (const segment of planRender(request(t)).segments) expect(graphOf(segment.args)).not.toContain('unsharp')
  })

  it('sharpens before the captions are drawn, so they stay as crisp as they are made', () => {
    let t = projectWith(media('a'), media('b'))
    t = setCaptions(t, [{ text: 'one', start: 10, length: 20 }], [])
    const graph = graphOf(planRender(request(t, { sharpen: true })).segments[0]!.args)
    expect(graph).toContain('ass=')
    expect(graph.indexOf('unsharp')).toBeLessThan(graph.indexOf('ass='))
  })

  it('sharpens one file per clip as well', () => {
    const plan = planRender(request(projectWith(media('a'), media('b')), { sharpen: true, mode: 'batch' }))
    expect(plan.segments.length).toBeGreaterThan(1)
    for (const segment of plan.segments) expect(graphOf(segment.args)).toContain('unsharp')
  })
})

describe('a subtitle file beside the video', () => {
  /** "one two" said over 290 to 310, on a clip of a from 0 to 300 and one of b after it. */
  function captioned(): Timeline {
    const t = projectWith(media('a'), media('b'))
    return setCaptions(t, [{ text: 'one', start: 290, length: 10 }, { text: 'two', start: 300, length: 10 }], [])
  }

  it('is written beside the joined video, with its name, when asked for', () => {
    const plan = planRender(request(captioned(), { subtitleFile: true }))
    expect(plan.outputs).toEqual(['D:\\out\\holiday.mp4'])
    expect(plan.beside).toHaveLength(1)
    expect(plan.beside[0]!.path).toBe('D:\\out\\holiday.srt')
    expect(plan.beside[0]!.content).toContain('one two')
  })

  it('is not written unless asked for, nor when there are no captions', () => {
    expect(planRender(request(captioned())).beside).toEqual([])
    expect(planRender(request(projectWith(media('a')), { subtitleFile: true })).beside).toEqual([])
  })

  it('counts from the start of the part exported', () => {
    const plan = planRender(request(captioned(), { subtitleFile: true, range: { from: 280, to: 400 } }))
    expect(plan.beside[0]!.content).toContain('00:00:00,333 --> 00:00:01,000')
  })

  it('takes the same new name as its video, free for both, when a file is kept', () => {
    const kept = planRender(request(captioned(), { subtitleFile: true, keep: ['D:\\out\\holiday.mp4'] }))
    expect(kept.outputs).toEqual(['D:\\out\\holiday (2).mp4'])
    expect(kept.beside[0]!.path).toBe('D:\\out\\holiday (2).srt')
    // A subtitle file kept on its own moves the video along with it.
    const alone = planRender(request(captioned(), { subtitleFile: true, keep: ['D:\\out\\holiday.srt'] }))
    expect(alone.outputs).toEqual(['D:\\out\\holiday (2).mp4'])
  })

  it('is not written for one file per clip', () => {
    expect(planRender(request(captioned(), { subtitleFile: true, mode: 'batch' })).beside).toEqual([])
  })
})

describe('a transcript file beside the video', () => {
  function captioned(): Timeline {
    const t = projectWith(media('a'), media('b'))
    return setCaptions(t, [{ text: 'one', start: 290, length: 10 }, { text: 'two', start: 300, length: 10 }], [])
  }

  it('is written beside the joined video, with its name, when asked for', () => {
    const plan = planRender(request(captioned(), { transcriptFile: true }))
    expect(plan.beside).toEqual([{ path: 'D:\\out\\holiday.txt', content: 'one two\n' }])
  })

  it('goes with the subtitle file, the three taking one name free for all of them', () => {
    const plan = planRender(request(captioned(), { subtitleFile: true, transcriptFile: true, keep: ['D:\\out\\holiday.txt'] }))
    expect(plan.outputs).toEqual(['D:\\out\\holiday (2).mp4'])
    expect(plan.beside.map((b) => b.path)).toEqual(['D:\\out\\holiday (2).srt', 'D:\\out\\holiday (2).txt'])
  })

  it('holds only the part exported, and is not written without captions or for one file per clip', () => {
    expect(planRender(request(captioned(), { transcriptFile: true, range: { from: 300, to: 400 } })).beside[0]!.content).toBe('two\n')
    expect(planRender(request(projectWith(media('a')), { transcriptFile: true })).beside).toEqual([])
    expect(planRender(request(captioned(), { transcriptFile: true, mode: 'batch' })).beside).toEqual([])
  })

  it('takes the words heard when there are no captions, and the captions over them when there are', () => {
    const heard = [{ text: 'Heard,', start: 10, length: 10 }, { text: 'not', start: 20, length: 10 }, { text: 'captioned.', start: 30, length: 10 }]
    const plain = planRender(request(projectWith(media('a')), { transcriptFile: true, heard }))
    expect(plain.beside).toEqual([{ path: 'D:\\out\\holiday.txt', content: 'Heard, not captioned.\n' }])
    expect(planRender(request(captioned(), { transcriptFile: true, heard })).beside[0]!.content).toBe('one two\n')
    // Nothing said in the part exported: no file.
    expect(planRender(request(projectWith(media('a')), { transcriptFile: true, heard, range: { from: 100, to: 200 } })).beside).toEqual([])
  })
})

describe('a track that ducks under the voice', () => {
  /** A recording on V1 whose sound is loud from 2 s to 4 s, and a song on A2 under it all. */
  function ducked(): { t: Timeline; peaks: Map<string, { peaksPerSecond: number; durationSec: number; peaks: Int16Array }> } {
    let t = projectWith(media('a'))
    t = { ...t, media: [...t.media, media('song', { width: 0, height: 0, fps: 0, durationSec: 10 })] }
    t = addTrack(t, 'audio', 'a2')
    t = addSource(t, { mediaId: 'song', clipId: 's', at: 0, onTrack: 'a2' })
    t = setTrackDuck(t, 'a2', true)
    const loud = (from: number, to: number): Int16Array => {
      const p = new Int16Array(1000 * 2)
      for (let i = from * 100; i < to * 100; i++) {
        p[i * 2] = -16000
        p[i * 2 + 1] = 16000
      }
      return p
    }
    const peaks = new Map([
      ['a', { peaksPerSecond: 100, durationSec: 10, peaks: loud(2, 4) }],
      ['song', { peaksPerSecond: 100, durationSec: 10, peaks: loud(0, 10) }]
    ])
    return { t, peaks }
  }

  it("brings the song down under the voice, in the segment's own time, and leaves the voice alone", () => {
    const { t, peaks } = ducked()
    const graph = soundOf(planRender(request(t, { peaks })).segments[0]!.args)
    expect(graph.match(/volume=eval=frame/g)).toHaveLength(1)
    expect(graph).toContain("volume=eval=frame:volume='1-0.748811*min(clip((t-1.85)/0.15,0,1),clip((4.5-t)/0.5,0,1))'")
  })

  it('leaves the song as it was with no waveforms to go by, or once it stops ducking', () => {
    const { t, peaks } = ducked()
    expect(soundOf(planRender(request(t)).segments[0]!.args)).not.toContain('volume=eval')
    expect(soundOf(planRender(request(setTrackDuck(t, 'a2', false), { peaks })).segments[0]!.args)).not.toContain('volume=eval')
  })
})

describe('a plan with no sound, as Save frame makes (audit 2026-10-01)', () => {
  it('reads no sound file, and puts silence in its place', () => {
    const t = projectWith(media('a'), media('b'))
    const loud = planRender(request(t, { range: { from: 10, to: 11 } }))
    const silent = planRender(request(t, { range: { from: 10, to: 11 }, silent: true }))
    const inputs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-i')
    expect(inputs(loud.segments[0]!.args).some((i) => i.startsWith('anullsrc'))).toBe(false)
    expect(inputs(silent.segments[0]!.args).some((i) => i.startsWith('anullsrc'))).toBe(true)
    expect(silent.segments[0]!.args.join(' ')).not.toMatch(/\[\d+:a:0\]/)
  })
})

describe('balancedSum', () => {
  /** How deep the brackets go, which is what ffmpeg 9 limits. */
  const depth = (e: string): number => [...e].reduce((d, c) => ({ most: Math.max(d.most, d.now + (c === '(' ? 1 : 0)), now: d.now + (c === '(' ? 1 : c === ')' ? -1 : 0) }), { most: 0, now: 0 }).most

  it('adds one or two terms as they are', () => {
    expect(balancedSum(['a'])).toBe('a')
    expect(balancedSum(['a', 'b'])).toBe('a+b')
  })

  it('adds many in halves, every term once and in order, a few brackets deep', () => {
    const terms = Array.from({ length: 4000 }, (_, i) => `t${i}`)
    const sum = balancedSum(terms)
    expect(sum.replace(/[()]/g, '').split('+')).toEqual(terms)
    expect(depth(sum)).toBeLessThanOrEqual(12)
  })
})
