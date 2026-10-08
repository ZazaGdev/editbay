import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { binariesFolder, ffmpegPath, ffprobePath, parseEncoderList } from '../../src/main/ffmpeg/locate'
import { capture } from '../../src/main/ffmpeg/spawn'
import { parseProgressChunk } from '../../src/main/ffmpeg/run'

describe('binariesFolder', () => {
  it('finds the one build npm install fetched, ffmpeg and ffprobe side by side', () => {
    expect(binariesFolder()).toBe(join(process.cwd(), 'vendor', 'ffmpeg'))
    expect(dirname(ffmpegPath)).toBe(dirname(ffprobePath))
  })
})

describe('parseEncoderList', () => {
  const sample = [
    'Encoders:',
    ' V..... libx264              libx264 H.264 / AVC (codec h264)',
    ' V..... libx265              libx265 H.265 / HEVC (codec hevc)',
    ' A..... aac                  AAC (Advanced Audio Coding)',
    ' A..... pcm_s16le            PCM signed 16-bit little-endian'
  ].join('\n')

  it('finds the encoders the app needs', () => {
    const found = parseEncoderList(sample)
    expect(found.has('libx264')).toBe(true)
    expect(found.has('aac')).toBe(true)
    expect(found.has('pcm_s16le')).toBe(true)
  })

  it('does not invent encoders that are absent', () => {
    expect(parseEncoderList(sample).has('libvpx-vp9')).toBe(false)
  })
})

describe('parseProgressChunk', () => {
  const block = [
    'frame=120',
    'fps=58.2',
    'bitrate=1234.5kbits/s',
    'total_size=123456',
    'out_time_us=4000000',
    'out_time_ms=4000000',
    'out_time=00:00:04.000000',
    'speed=8.12x',
    'progress=continue',
    ''
  ].join('\n')

  it('reads the elapsed output time in milliseconds', () => {
    expect(parseProgressChunk(block).timeMs).toBe(4000)
  })

  it('reads the speed multiplier', () => {
    expect(parseProgressChunk(block).speed).toBeCloseTo(8.12)
  })

  it('reports completion only on the end marker', () => {
    expect(parseProgressChunk(block).done).toBe(false)
    expect(parseProgressChunk(block.replace('progress=continue', 'progress=end')).done).toBe(true)
  })

  it('ignores out_time_ms, which ffmpeg reports in microseconds', () => {
    const odd = 'out_time_us=2500000\nout_time_ms=2500000\nprogress=continue\n'
    expect(parseProgressChunk(odd).timeMs).toBe(2500)
  })

  it('returns nothing useful from an empty chunk', () => {
    expect(parseProgressChunk('').timeMs).toBeUndefined()
  })

  it('takes the last value when a chunk holds several blocks', () => {
    const two = 'out_time_us=1000000\nprogress=continue\nout_time_us=2000000\nprogress=continue\n'
    expect(parseProgressChunk(two).timeMs).toBe(2000)
  })
})

describe('a run cancelled before it starts', () => {
  it('stops at once rather than running to the end', async () => {
    // Many seconds of work, which a cancel must not wait for.
    const args = ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:duration=600:rate=30', '-f', 'null', '-']
    const started = Date.now()
    await expect(capture(ffmpegPath, args, { signal: AbortSignal.abort() })).rejects.toThrow('cancelled')
    expect(Date.now() - started).toBeLessThan(1500)
  })
})

describe('a run given a time limit', () => {
  // Node itself stands in for a probe that hangs on a damaged file.
  const hang = ['-e', 'setTimeout(() => {}, 20000)']

  it('is stopped when it runs past it, and says so', async () => {
    const started = Date.now()
    await expect(capture(process.execPath, hang, { timeoutMs: 200 })).rejects.toThrow('did not finish within 0.2 seconds')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('is left alone when it finishes in time', async () => {
    const out = await capture(process.execPath, ['-e', 'process.stdout.write("done")'], { timeoutMs: 10000 })
    expect(out.stdout.toString()).toBe('done')
  })
})
