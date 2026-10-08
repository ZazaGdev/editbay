import { describe, it, expect } from 'vitest'
import { cappedSize, targetFrameRate, conformArgs } from '../../src/main/media/conform'
import type { ProbeResult } from '../../src/main/media/probe'

function probeOf(overrides: Partial<ProbeResult['video']> = {}, audio: ProbeResult['audio'] = null): ProbeResult {
  return {
    path: 'C:\\in.mp4',
    durationSec: 10,
    startSec: 0,
    video: {
      codec: 'h264',
      width: 1920,
      height: 1080,
      pixFmt: 'yuv420p',
      bitDepth: 8,
      colorTransfer: 'bt709',
      colorSpace: 'bt709',
      nominalFps: 30,
      averageFps: 30,
      rotationDeg: 0,
      ...overrides
    },
    audio,
    audioTracks: audio ? 1 : 0,
    chapters: [],
    trackNames: audio ? [''] : [],
    trackChannels: audio ? [2] : []
  }
}

describe('cappedSize', () => {
  it('leaves a frame under the cap alone', () => {
    expect(cappedSize(1920, 1080)).toEqual({ w: 1920, h: 1080 })
  })

  it('leaves 4K alone, because 4K is the cap', () => {
    expect(cappedSize(3840, 2160)).toEqual({ w: 3840, h: 2160 })
  })

  it('scales a wider-than-4K frame down by its longest side', () => {
    expect(cappedSize(7680, 4320)).toEqual({ w: 3840, h: 2160 })
  })

  it('scales a tall frame by its height', () => {
    expect(cappedSize(2160, 7680)).toEqual({ w: 1080, h: 3840 })
  })

  it('always returns even dimensions, because H.264 requires them', () => {
    const { w, h } = cappedSize(4001, 2251)
    expect(w % 2).toBe(0)
    expect(h % 2).toBe(0)
  })
})

describe('targetFrameRate', () => {
  it('uses the nominal rate of an ordinary file', () => {
    expect(targetFrameRate(probeOf())).toBe(30)
    expect(targetFrameRate(probeOf({ nominalFps: 60, averageFps: 60 }))).toBe(60)
  })

  it('ignores the 1000/1 nominal rate recorders write, and uses the average', () => {
    expect(targetFrameRate(probeOf({ nominalFps: 1000, averageFps: 29.97 }))).toBeCloseTo(29.97, 2)
  })

  it('snaps a rate that is within a hair of a standard one', () => {
    expect(targetFrameRate(probeOf({ nominalFps: 1000, averageFps: 30.001 }))).toBe(30)
  })

  it('falls back to 30 when neither rate is usable', () => {
    expect(targetFrameRate(probeOf({ nominalFps: 0, averageFps: 0 }))).toBe(30)
  })

  it('clamps an absurd rate', () => {
    expect(targetFrameRate(probeOf({ nominalFps: 240, averageFps: 240 }))).toBe(120)
  })
})

describe('conformArgs', () => {
  const out = 'C:\\cache\\conformed.mp4'

  it('encodes H.264 at CRF 16 with constant frame rate', () => {
    const args = conformArgs({ probe: probeOf(), output: out, hasZscale: true })
    expect(args).toContain('libx264')
    expect(args[args.indexOf('-crf') + 1]).toBe('16')
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('cfr')
    expect(args[args.indexOf('-r') + 1]).toBe('30')
  })

  it('turns scene-cut detection off through x264-params, not the removed sc_threshold', () => {
    const args = conformArgs({ probe: probeOf(), output: out, hasZscale: true })
    expect(args[args.indexOf('-x264-params') + 1]).toContain('scenecut=0')
    expect(args).not.toContain('-sc_threshold')
  })

  it('places a keyframe every second', () => {
    const args = conformArgs({ probe: probeOf({ nominalFps: 60, averageFps: 60 }), output: out, hasZscale: true })
    expect(args[args.indexOf('-g') + 1]).toBe('60')
    expect(args[args.indexOf('-keyint_min') + 1]).toBe('60')
  })

  it('writes audio as 48kHz stereo AAC', () => {
    const args = conformArgs({
      probe: probeOf({}, { codec: 'aac', sampleRate: 44100, channels: 1 }),
      output: out,
      hasZscale: true
    })
    expect(args[args.indexOf('-ar') + 1]).toBe('48000')
    expect(args[args.indexOf('-ac') + 1]).toBe('2')
  })

  it('maps audio optionally, so a file without it still conforms', () => {
    const args = conformArgs({ probe: probeOf(), output: out, hasZscale: true })
    expect(args).toContain('0:a:0?')
  })

  it('scales an 8K source down to the 4K cap', () => {
    const args = conformArgs({ probe: probeOf({ width: 7680, height: 4320 }), output: out, hasZscale: true })
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).toContain('scale=3840:2160')
  })

  it('does not scale a source already under the cap', () => {
    const args = conformArgs({ probe: probeOf(), output: out, hasZscale: true })
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).not.toContain('scale=')
  })

  it('tonemaps HDR when the build has zscale', () => {
    const args = conformArgs({ probe: probeOf({ colorTransfer: 'smpte2084' }), output: out, hasZscale: true })
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).toContain('tonemap')
    expect(vf).toContain('zscale')
  })

  it('falls back to a plain conversion when the build has no zscale', () => {
    const args = conformArgs({ probe: probeOf({ colorTransfer: 'smpte2084' }), output: out, hasZscale: false })
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).not.toContain('zscale')
    expect(vf).toContain('format=yuv420p')
  })

  it('always ends with the output path', () => {
    const args = conformArgs({ probe: probeOf(), output: out, hasZscale: true })
    expect(args[args.length - 1]).toBe(out)
  })

  it('overwrites the output without asking', () => {
    expect(conformArgs({ probe: probeOf(), output: out, hasZscale: true })).toContain('-y')
  })
})

describe('conforming a recording made by BT.601 (audit 2026-10-01)', () => {
  const vf = (p: ProbeResult): string => {
    const args = conformArgs({ probe: p, output: 'out.mp4', hasZscale: false })
    return args[args.indexOf('-vf') + 1]!
  }

  it('turns its colours into BT.709, and says so in the file', () => {
    expect(vf(probeOf({ colorSpace: 'smpte170m' }))).toContain('scale=in_color_matrix=bt601:out_color_matrix=bt709')
    expect(vf(probeOf({ colorSpace: 'bt470bg' }))).toContain('in_color_matrix=bt601')
    const args = conformArgs({ probe: probeOf(), output: 'out.mp4', hasZscale: false })
    expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709')
  })

  it('leaves one made by BT.709, or that says nothing, as it is', () => {
    expect(vf(probeOf())).not.toContain('in_color_matrix')
    expect(vf(probeOf({ colorSpace: null }))).not.toContain('in_color_matrix')
  })
})

describe('conforming a recording whose pixels are not square (audit 2026-10-01)', () => {
  it('widens the picture to what it shows, with square pixels', () => {
    const args = conformArgs({ probe: probeOf({ width: 720, height: 480, pixelAspect: 32 / 27 }), output: 'out.mp4', hasZscale: false })
    expect(args[args.indexOf('-vf') + 1]).toContain('scale=854:480:flags=lanczos,setsar=1')
  })
})
