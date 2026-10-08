import { describe, it, expect } from 'vitest'
import { parseProbeJson, parseRational, conformReasons, readPixelAspect } from '../../src/main/media/probe'
import type { ProbeResult } from '../../src/main/media/probe'

describe('parseRational', () => {
  it('reads an ffprobe fraction', () => {
    expect(parseRational('30/1')).toBe(30)
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2)
  })

  it('returns zero for the undefined rate ffprobe writes for still images', () => {
    expect(parseRational('0/0')).toBe(0)
  })

  it('returns zero for nonsense', () => {
    expect(parseRational(undefined)).toBe(0)
    expect(parseRational('')).toBe(0)
  })
})

const cleanH264 = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      color_transfer: 'bt709'
    },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }
  ],
  format: { duration: '12.500000' }
}

const phoneHevc = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p10le',
      bits_per_raw_sample: '10',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      color_transfer: 'smpte2084',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }]
    },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 1 }
  ],
  format: { duration: '30.000000' }
}

const screenRecording = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 2560,
      height: 1440,
      pix_fmt: 'yuv420p',
      r_frame_rate: '1000/1',
      avg_frame_rate: '2997/100'
    }
  ],
  format: { duration: '600.000000' }
}

describe('parseProbeJson', () => {
  it('reads a clean file', () => {
    const p = parseProbeJson(cleanH264, 'C:\\a.mp4')
    expect(p.durationSec).toBe(12.5)
    expect(p.video.codec).toBe('h264')
    expect(p.video.width).toBe(1920)
    expect(p.video.nominalFps).toBe(30)
    expect(p.video.bitDepth).toBe(8)
    expect(p.video.rotationDeg).toBe(0)
    expect(p.audio?.sampleRate).toBe(48000)
    expect(p.audio?.channels).toBe(2)
  })

  it('reads bit depth from the pixel format when the tag is absent', () => {
    const noTag = structuredClone(phoneHevc) as Record<string, any>
    delete noTag.streams[0].bits_per_raw_sample
    expect(parseProbeJson(noTag, 'C:\\b.mov').video.bitDepth).toBe(10)
  })

  it('normalises rotation to a positive quarter turn', () => {
    expect(parseProbeJson(phoneHevc, 'C:\\b.mov').video.rotationDeg).toBe(270)
  })

  it('reads legacy rotation from stream tags', () => {
    const legacy = structuredClone(cleanH264) as Record<string, any>
    legacy.streams[0].tags = { rotate: '180' }
    expect(parseProbeJson(legacy, 'C:\\c.mp4').video.rotationDeg).toBe(180)
  })

  it('reports the nominal and average rates separately', () => {
    const p = parseProbeJson(screenRecording, 'C:\\d.mkv')
    expect(p.video.nominalFps).toBe(1000)
    expect(p.video.averageFps).toBeCloseTo(29.97, 2)
  })

  it('reports no audio when there is no audio stream', () => {
    expect(parseProbeJson(screenRecording, 'C:\\d.mkv').audio).toBeNull()
  })

  it('counts every audio track, and describes the first', () => {
    const obs = {
      ...cleanH264,
      streams: [
        ...cleanH264.streams,
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 1 },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 1 }
      ]
    }
    const p = parseProbeJson(obs, 'C:\\obs.mkv')
    expect(p.audioTracks).toBe(3)
    expect(p.audio?.channels).toBe(2)
  })

  it('reads each audio track name from its title, in any case, and nothing where there is none', () => {
    const obs = {
      ...cleanH264,
      streams: [
        ...cleanH264.streams,
        { codec_type: 'audio', codec_name: 'aac', tags: { title: ' Mic ' } },
        { codec_type: 'audio', codec_name: 'aac', tags: { TITLE: 'Game' } }
      ]
    }
    expect(parseProbeJson(obs, 'C:\\obs.mkv').trackNames).toEqual(['', 'Mic', 'Game'])
  })

  it('counts no audio tracks for a silent file', () => {
    const silent = { ...cleanH264, streams: cleanH264.streams.filter((s) => s.codec_type === 'video') }
    expect(parseProbeJson(silent, 'C:\\a.mp4').audioTracks).toBe(0)
  })

  it('throws when there is no video stream', () => {
    expect(() => parseProbeJson({ streams: [], format: {} }, 'C:\\e.mp3')).toThrow(/no video stream/i)
  })
})

function probeOf(overrides: Partial<ProbeResult['video']> = {}, audio: ProbeResult['audio'] = null): ProbeResult {
  return {
    path: 'C:\\x.mp4',
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

describe('conformReasons', () => {
  it('leaves a clean file alone', () => {
    expect(conformReasons(probeOf(), false)).toEqual([])
  })

  it('leaves a clean 60fps file alone, because frame rate is reconciled at render', () => {
    expect(conformReasons(probeOf({ nominalFps: 60, averageFps: 60 }), false)).toEqual([])
  })

  it('conforms a variable frame rate file', () => {
    expect(conformReasons(probeOf(), true)).toContain('variable-frame-rate')
  })

  it('conforms HEVC, which the preview cannot play reliably', () => {
    expect(conformReasons(probeOf({ codec: 'hevc' }), false)).toContain('unsupported-codec')
  })

  it('leaves the codecs the preview can play', () => {
    for (const codec of ['h264', 'vp8', 'vp9', 'av1']) {
      expect(conformReasons(probeOf({ codec }), false)).toEqual([])
    }
  })

  it('conforms above 8 bits', () => {
    expect(conformReasons(probeOf({ bitDepth: 10 }), false)).toContain('high-bit-depth')
  })

  it('conforms an HDR transfer curve', () => {
    expect(conformReasons(probeOf({ colorTransfer: 'smpte2084' }), false)).toContain('hdr-transfer')
    expect(conformReasons(probeOf({ colorTransfer: 'arib-std-b67' }), false)).toContain('hdr-transfer')
  })

  it('conforms rotation metadata', () => {
    expect(conformReasons(probeOf({ rotationDeg: 90 }), false)).toContain('rotation-metadata')
  })

  it('reports every reason a file qualifies under', () => {
    const reasons = conformReasons(probeOf({ codec: 'hevc', bitDepth: 10, rotationDeg: 90 }), true)
    expect(reasons).toHaveLength(4)
  })
})

describe('pixels that are not square (audit 2026-10-01)', () => {
  it('reads the ratio a file gives, and takes none as square', () => {
    expect(readPixelAspect('32:27')).toBeCloseTo(1.185, 3)
    expect(readPixelAspect('1:1')).toBe(1)
    expect(readPixelAspect('0:1')).toBe(1)
    expect(readPixelAspect(undefined)).toBe(1)
  })
})
