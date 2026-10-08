import { describe, it, expect } from 'vitest'
import { FfmpegStalled, runFfmpeg } from '../../src/main/ffmpeg/run'

describe('ffmpeg that goes quiet (audit 2026-10-01)', () => {
  it('is stopped once it has said nothing for too long, and says why', async () => {
    // A long run that is never let say anything in time: it is taken to have hung.
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'sine=duration=600', '-f', 'null', '-'], { stallMs: 1 })
    await expect(run).rejects.toBeInstanceOf(FfmpegStalled)
  })

  it('runs to the end while it keeps reporting', async () => {
    await expect(runFfmpeg(['-f', 'lavfi', '-i', 'sine=duration=1', '-f', 'null', '-'], { stallMs: 20_000 })).resolves.toBeUndefined()
  })
})
