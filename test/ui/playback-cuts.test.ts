import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { ElectronApplication, Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardUnsavedWork } from './dialogs'
import { openCut, recordPlaying, sampleAt } from './heard'

/**
 * Task 1097, plan 106: the sound of a timeline cut into many short clips, as
 * the preview actually plays it, recorded and checked for gaps and for sound
 * played twice or skipped at the cuts; and the picture against it.
 *
 * The first recording is one steady 30 Hz tone, a whole wave a frame, so a
 * cut that takes out whole frames leaves the tone running on unbroken: what
 * is heard should be one unbroken tone from start to end. A gap is a stretch
 * of silence; sound played twice or skipped moves the tone's wave out of step
 * with itself, which is what the phase below measures.
 *
 * The second is black with a white frame on every whole second and a short
 * beep at the same moment, for lip sync and how soon Play is heard.
 */

const TONE_HZ = 30
/** Clips half a second long with a fifth of a second taken out between each, as a talk cut tight is: every edge on a whole frame. */
const CUTS = Array.from({ length: 18 }, (_, i) => ({ fromSec: 0.5 + i * 0.7, toSec: 0.7 + i * 0.7 }))

/** What goes wrong in a recording of the tone: its silent stretches, and where its wave jumps out of step. */
function faults(rate: number, x: number[]): { gaps: { at: number; ms: number }[]; jumps: { at: number; ms: number }[]; level: number } {
  // From the first sound, plus a second for playing to get going, to just before the end.
  const first = x.findIndex((v) => Math.abs(v) > 0.01)
  const from = first + rate
  const to = x.length - Math.round(rate * 0.2)
  let peak = 0
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]!))
  // Silence: a run where the tone stays near nothing for longer than it ever
  // does passing through zero, which is a fifth of a millisecond.
  const gaps: { at: number; ms: number }[] = []
  let run = 0
  for (let i = from; i < to; i++) {
    if (Math.abs(x[i]!) < peak * 0.02) run++
    else {
      if (run > rate * 0.002) gaps.push({ at: (i - from) / rate, ms: (run / rate) * 1000 })
      run = 0
    }
  }
  // The tone's phase over each wave, against an unbroken tone at the same
  // rate: steady while it plays on, moving when sound is played twice or
  // skipped. Compared a wave apart, so each jump is seen whole.
  const n = Math.round(rate / TONE_HZ)
  const phaseAt = (s: number): number => {
    let re = 0
    let im = 0
    for (let i = s; i < s + n; i++) {
      const a = (2 * Math.PI * TONE_HZ * i) / rate
      re += x[i]! * Math.cos(a)
      im += x[i]! * Math.sin(a)
    }
    return Math.atan2(im, re)
  }
  const jumps: { at: number; ms: number }[] = []
  const hop = Math.round(rate * 0.005)
  for (let s = from; s + 2 * n < to; s += hop) {
    let d = phaseAt(s + n) - phaseAt(s)
    d = Math.atan2(Math.sin(d), Math.cos(d))
    const ms = (d / (2 * Math.PI * TONE_HZ)) * 1000
    if (Math.abs(ms) > 3) {
      const at = (s - from) / rate
      const last = jumps[jumps.length - 1]
      // One jump is seen from every window that straddles it: counted once.
      if (!last || at - last.at > n / rate) jumps.push({ at, ms })
      else if (Math.abs(ms) > Math.abs(last.ms)) last.ms = ms
    }
  }
  return { gaps, jumps, level: peak }
}

describe('playing a steady tone across many cuts', () => {
  const opened: { app?: ElectronApplication; page?: Page; root?: string } = {}

  beforeAll(async () => {
    opened.root = await mkdtemp(join(tmpdir(), 'editbay-playback-cuts-'))
    Object.assign(
      opened,
      await openCut(
        opened.root,
        ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=14', '-f', 'lavfi', '-i', `sine=frequency=${TONE_HZ}:sample_rate=48000:duration=14`],
        CUTS
      )
    )
  }, 400_000)

  afterAll(async () => {
    if (opened.app) await discardUnsavedWork(opened.app).catch(() => undefined)
    await opened.app?.close().catch(() => undefined)
    if (opened.root) await rm(opened.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('plays the sound on unbroken: no gap, nothing played twice or skipped at any cut', async () => {
    const played = await recordPlaying(opened.page!, 8)
    const found = faults(played.rate, played.samples)
    const said = JSON.stringify({ engine: played.engine, gaps: found.gaps, jumps: found.jumps, level: found.level })
    expect(found.level, 'the tone is heard').toBeGreaterThan(0.02)
    expect(found.gaps, `no silent stretch, ${said}`).toEqual([])
    expect(found.jumps, `nothing played twice or skipped, ${said}`).toEqual([])
  }, 120_000)
})

describe('playing a flash and a beep together across cuts', () => {
  const opened: { app?: ElectronApplication; page?: Page; root?: string } = {}

  beforeAll(async () => {
    opened.root = await mkdtemp(join(tmpdir(), 'editbay-playback-sync-'))
    Object.assign(
      opened,
      await openCut(
        opened.root,
        [
          '-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=14,geq=lum='if(lt(mod(N,30),1),235,16)':cb=128:cr=128",
          '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,1),0.03),0.5*sin(2*PI*1000*t),0)':s=48000:d=14"
        ],
        CUTS
      )
    )
  }, 400_000)

  afterAll(async () => {
    if (opened.app) await discardUnsavedWork(opened.app).catch(() => undefined)
    await opened.app?.close().catch(() => undefined)
    if (opened.root) await rm(opened.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('is heard soon after Play, and keeps the picture in step with the sound', async () => {
    const played = await recordPlaying(opened.page!, 8)
    // Each beep's start, on the page's clock.
    const beeps: number[] = []
    let quiet = 0
    for (let i = 0; i < played.samples.length; i++) {
      if (Math.abs(played.samples[i]!) > 0.1) {
        if (quiet > played.rate * 0.2) beeps.push(sampleAt(played, i))
        quiet = 0
      } else quiet++
    }
    const first = played.samples.findIndex((v) => Math.abs(v) > 0.01)
    const startMs = sampleAt(played, first) - played.pressedAt
    // Each flash against the beep nearest it, once playing has got going.
    const settled = played.pressedAt + 1500
    const offsets = played.flashes
      .filter((f) => f > settled)
      .map((f) => {
        const near = beeps.reduce((b, x) => (Math.abs(x - f) < Math.abs(b - f) ? x : b), Infinity)
        return Math.round(f - near)
      })
      .filter((d) => Math.abs(d) < 300)
    const said = JSON.stringify({ engine: played.engine, startMs: Math.round(startMs), offsets, beeps: beeps.length, flashes: played.flashes.length })
    console.log('heard and seen', said)
    expect(first, 'something is heard').toBeGreaterThanOrEqual(0)
    // The sound first heard soon after Play: well under a third of a second.
    expect(startMs, said).toBeLessThan(300)
    expect(offsets.length, said).toBeGreaterThanOrEqual(4)
    // The picture within a frame and a half of the sound, as the eye takes it: the
    // middle of the offsets, so one frame drawn late does not decide it.
    const sorted = [...offsets].sort((a, b) => a - b)
    expect(Math.abs(sorted[Math.floor(sorted.length / 2)]!), said).toBeLessThan(50)
  }, 120_000)
})
