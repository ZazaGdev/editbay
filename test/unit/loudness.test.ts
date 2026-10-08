import { describe, it, expect } from 'vitest'
import { LOUDNESS_TARGET, loudnormFilter, parseLoudnorm, withAudioFilter } from '../../src/shared/render-plan'

/** A measuring pass as ffmpeg actually prints it, lines and all. */
const REAL = `[concat @ 000001c9] Auto-inserting h264_mp4toannexb bitstream filter
Input #0, concat, from 'D:\\out\\.scratch\\segments.txt':
  Duration: N/A, start: 0.000000, bitrate: 1536 kb/s
Stream mapping:
  Stream #0:1 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
[Parsed_loudnorm_0 @ 000001c9c0a0]
{
\t"input_i" : "-27.85",
\t"input_tp" : "-9.62",
\t"input_lra" : "6.70",
\t"input_thresh" : "-37.99",
\t"output_i" : "-13.99",
\t"output_tp" : "-1.00",
\t"output_lra" : "6.60",
\t"output_thresh" : "-24.09",
\t"normalization_type" : "dynamic",
\t"target_offset" : "-0.01"
}
`

/** The same pass over a sequence with nothing on its sound tracks. */
const SILENT = REAL.replace('"-27.85"', '"-inf"').replace('"-37.99"', '"-inf"')

describe('reading what the measuring pass found', () => {
  it('takes the figures out of ffmpeg\'s own output, lines and tabs and all', () => {
    expect(parseLoudnorm(REAL)).toEqual({ i: -27.85, tp: -9.62, lra: 6.7, threshold: -37.99, offset: -0.01 })
  })

  it('takes the last block, since only the end of stderr is kept and earlier runs may be in it', () => {
    const earlier = REAL.replace('"-27.85"', '"-9.00"')
    expect(parseLoudnorm(`${earlier}\n${REAL}`)?.i).toBe(-27.85)
  })

  it('gives nothing rather than throwing when there is no block, or a broken one', () => {
    expect(parseLoudnorm('')).toBeNull()
    expect(parseLoudnorm('ffmpeg fell over before it printed anything')).toBeNull()
    expect(parseLoudnorm('{ "input_i" : oops }')).toBeNull()
  })

  it('gives nothing when a figure is missing, so a half read block is never half used', () => {
    expect(parseLoudnorm(REAL.replace('"target_offset" : "-0.01"', '"something_else" : "-0.01"'))).toBeNull()
  })

  it('gives nothing for silence, which ffmpeg reports as "-inf"', () => {
    expect(parseLoudnorm(SILENT)).toBeNull()
  })
})

describe('the filter that levels the sound', () => {
  const measured = { i: -27.85, tp: -9.62, lra: 6.7, threshold: -37.99, offset: -0.01 }

  it('carries the target and everything the first pass measured, and asks for one gain rather than a compressor', () => {
    expect(loudnormFilter(LOUDNESS_TARGET, measured)).toBe(
      'loudnorm=I=-14:TP=-1:LRA=11:measured_I=-27.85:measured_TP=-9.62:measured_LRA=6.7:measured_thresh=-37.99:offset=-0.01:linear=true'
    )
  })

  it('leaves a near silent export alone, rather than lifting its noise floor by fifty decibels', () => {
    expect(loudnormFilter(LOUDNESS_TARGET, { ...measured, i: -60 })).toBeNull()
    expect(loudnormFilter(LOUDNESS_TARGET, { ...measured, i: -50.1 })).toBeNull()
    expect(loudnormFilter(LOUDNESS_TARGET, { ...measured, i: -49.9 })).not.toBeNull()
  })

  it('is asked for on a quiet recording, which is the whole point of levelling', () => {
    expect(loudnormFilter(LOUDNESS_TARGET, { ...measured, i: -34 })).toContain('measured_I=-34')
  })

  it('turns a mix louder than full scale down first, the measurements with it, since loudnorm refuses them over 0', () => {
    const f = loudnormFilter(LOUDNESS_TARGET, { ...measured, i: 4.04, tp: 9, threshold: -6 })!
    expect(f.startsWith('volume=-11dB,loudnorm=')).toBe(true)
    expect(f).toContain('measured_I=-6.96:')
    expect(f).toContain('measured_TP=-2:')
    expect(f).toContain('measured_thresh=-17:')
    expect(loudnormFilter(LOUDNESS_TARGET, measured)!.startsWith('loudnorm=')).toBe(true)
  })
})

describe('putting the filter into the join', () => {
  const join = ['-f', 'concat', '-safe', '0', '-i', 'D:\\list.txt', '-c:v', 'copy', '-c:a', 'aac', '-y', 'D:\\out.mp4']

  it('puts it straight after the input, leaving how the video is encoded exactly where it was', () => {
    expect(withAudioFilter(join, 'loudnorm=I=-14')).toEqual([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'D:\\list.txt',
      '-af', 'loudnorm=I=-14',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-y', 'D:\\out.mp4'
    ])
  })

  it('leaves the arguments it was given untouched, since the plan is reused when the measure fails', () => {
    const before = [...join]
    withAudioFilter(join, 'loudnorm=I=-14')
    expect(join).toEqual(before)
  })

  it('refuses arguments with no input, rather than quietly putting the filter somewhere it does nothing', () => {
    expect(() => withAudioFilter(['-c:a', 'aac', '-y', 'D:\\out.mp4'], 'loudnorm=I=-14')).toThrow(/no input/)
  })
})
