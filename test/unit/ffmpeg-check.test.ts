import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckRunner } from '../../src/main/ffmpeg/locate'

/**
 * ffmpeg is checked beside the window now, not before it (audit 2026-11-07):
 * an ffmpeg that hung kept the app windowless for good while it held the
 * single-instance lock. Each check has a time limit, and one that fails is
 * said in the window's banner, and tried again the next time it is asked.
 */

const ENCODERS = [' V....D libx264              libx264 H.264', ' A....D aac                  AAC', ' A....D pcm_s16le            PCM signed 16-bit'].join('\n')

/** A runner as ffmpeg answers each of the four checks. */
const working: CheckRunner = async (_binary, args) => (args.includes('-encoders') ? ENCODERS : args.includes('-filters') ? ' ... zscale' : 'ffmpeg version 9.0.2')

async function fresh(): Promise<typeof import('../../src/main/ffmpeg/locate')> {
  vi.resetModules()
  return import('../../src/main/ffmpeg/locate')
}

describe('verifyFfmpeg', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('gives each of its four checks a time limit, so an ffmpeg that hangs is reported rather than waited on for good', async () => {
    const { verifyFfmpeg } = await fresh()
    const limits: (number | undefined)[] = []
    const hangs: CheckRunner = async (_binary, _args, opts) => {
      limits.push(opts.timeoutMs)
      throw new Error('ffmpeg did not finish within 30 seconds and was stopped')
    }
    await expect(verifyFfmpeg(hangs)).rejects.toThrow(/did not finish/)
    expect(limits).toHaveLength(4)
    for (const ms of limits) expect(ms !== undefined && ms > 0 && ms <= 60_000, String(ms)).toBe(true)
  })

  it('runs one check for everyone who asks while it runs, and a new one after it failed', async () => {
    const { verifyFfmpeg } = await fresh()
    let runs = 0
    let fail = true
    const counted: CheckRunner = async (binary, args, opts) => {
      runs++
      if (fail) throw new Error('not yet')
      return working(binary, args, opts)
    }
    await Promise.all([expect(verifyFfmpeg(counted)).rejects.toThrow(), expect(verifyFfmpeg(counted)).rejects.toThrow()])
    expect(runs).toBe(4)
    fail = false
    const caps = await verifyFfmpeg(counted)
    expect(caps.version).toBe('ffmpeg version 9.0.2')
    expect(runs).toBe(8)
    await verifyFfmpeg(counted)
    expect(runs).toBe(8)
  })
})
