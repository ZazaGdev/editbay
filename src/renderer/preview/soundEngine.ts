import type { SoundPcmRequest } from '../../shared/types'
import { chunkKey, chunksBetween, gainCurve, startOf, voiceShape, type SoundChunk, type SoundVoice } from '../../shared/sound-chunks'

/**
 * Plan 106: the preview's sound while it plays forwards at normal speed.
 *
 * A media player per clip, swapped at each cut, gave its first sound 5 to
 * 15 ms off at about half the cuts, and no way of holding two players in step
 * did better. Here the sound is decoded ahead in stretches and each stretch
 * is started at its exact sample of one audio clock, so two clips that meet
 * at a cut meet at the same sample. While it plays it is the preview's clock:
 * what is being heard, which every picture is held to.
 */

/** How far ahead stretches are started on the clock, in seconds: enough to ride out a window in the background. */
const SCHEDULE_AHEAD_SEC = 3
/** How far ahead stretches are decoded. */
const DECODE_AHEAD_SEC = 6
/** How much is decoded at the playhead before Play makes a sound. */
const FIRST_SEC = 0.6
/** How long after Play the first sound is due, so the pictures are under way by then. */
const LEAD_SEC = 0.08
/** How long Play waits for the engine to be ready before the players play instead, this time. */
const START_PATIENCE_MS = 300
/** How often stretches are started and decoded while playing. */
const PUMP_MS = 100
/** How long after a stretch failed to decode it is asked for again. */
const RETRY_MS = 250
/** Stretches decoded at once. */
const AT_ONCE = 2

type Decode = (req: SoundPcmRequest) => Promise<Float32Array | null>

/** A stretch waiting to be decoded. */
interface Job {
  key: string
  voice: SoundVoice
  chunk: SoundChunk
  resolve: (b: AudioBuffer | null) => void
}

/** A stretch started on the clock. */
interface Playing {
  voice: SoundVoice
  chunk: SoundChunk
  src: AudioBufferSourceNode
  gain: GainNode
  /** When it starts on the clock, and how far into it. */
  when: number
  offset: number
}

export class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private broken = false
  private voices: SoundVoice[] = []
  /** Decoded stretches, and those on their way, by `chunkKey`. */
  private readonly decoded = new Map<string, AudioBuffer | null>()
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>()
  /** When a stretch last failed to decode, so it is tried again, but not on every tick. */
  private readonly failedAt = new Map<string, number>()
  private readonly queue: Job[] = []
  private decoding = 0
  /** The stretches started, by voice id and stretch. */
  private readonly started = new Map<string, Playing>()
  /** The sequence's sample `origin` is heard at clock time `t0`; null while stopped. */
  private run: { origin: number; t0: number } | null = null
  private pump: ReturnType<typeof setInterval> | null = null
  private masterGain = 1
  /** Bumped by every start and stop, so a start overtaken by a stop does nothing. */
  private generation = 0

  constructor(private readonly decode: Decode) {}

  /** Whether it can play at all: false once Web Audio has refused. */
  get usable(): boolean {
    return !this.broken && this.open() !== null
  }

  /** The clips to play. While playing, those left as they were play on untouched. */
  setVoices(voices: SoundVoice[]): void {
    const before = new Map(this.voices.map((v) => [v.id, voiceShape(v)]))
    this.voices = voices
    if (!this.run) return
    const now = new Map(voices.map((v) => [v.id, v]))
    for (const [key, p] of this.started) {
      const v = now.get(p.voice.id)
      if (!v || voiceShape(v) !== before.get(p.voice.id)) {
        this.stopOne(key, p)
        continue
      }
      // Same sound in the same place: only its loudness may have moved.
      p.voice = v
      this.applyGain(p)
    }
    this.tick()
  }

  /** The master gain: the loudness boost, or 0 to silence everything. */
  setMaster(gain: number): void {
    this.masterGain = Number.isFinite(gain) && gain >= 0 ? gain : 1
    if (this.master) this.master.gain.value = this.masterGain
  }

  /** Paused at `sec`: what Play there needs first is decoded now, so it starts at once. */
  prepare(sec: number): void {
    const ctx = this.open()
    if (!ctx || this.run) return
    const rate = ctx.sampleRate
    const at = Math.round(sec * rate)
    const to = at + Math.round(FIRST_SEC * rate)
    // Only the place now asked about: one seeked away from is not decoded after all.
    this.dropQueue()
    this.keepOnly(at, to)
    this.want(at, to, true)
  }

  /**
   * Play from `sec`. Resolves true once the first sound is set to start,
   * false when it cannot play, is not ready soon enough, or was stopped first.
   */
  async start(sec: number): Promise<boolean> {
    this.stop()
    const ctx = this.open()
    if (!ctx) return false
    const generation = ++this.generation
    const rate = ctx.sampleRate
    const origin = Math.round(sec * rate)
    // The audio device woken and the stretches at the playhead decoded before
    // a sound is made, for so long at most: Play is never kept waiting on it.
    const ready = (async (): Promise<boolean> => {
      await ctx.resume().catch(() => undefined)
      if (ctx.state !== 'running') return false
      await Promise.all(this.want(origin, origin + Math.round(FIRST_SEC * rate), true))
      return true
    })()
    const patience = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), START_PATIENCE_MS))
    const ok = await Promise.race([ready, patience])
    if (generation !== this.generation) return false
    if (!ok) {
      // What was asked for goes on being decoded, for the next Play.
      this.generation++
      return false
    }
    this.run = { origin, t0: ctx.currentTime + LEAD_SEC }
    this.tick()
    this.pump = setInterval(() => this.tick(), PUMP_MS)
    return true
  }

  stop(): void {
    this.generation++
    if (this.pump !== null) clearInterval(this.pump)
    this.pump = null
    this.run = null
    for (const [key, p] of this.started) this.stopOne(key, p)
    this.dropQueue()
  }

  /** Nothing waiting is decoded after all: whatever waits on it hears that now, rather than never. */
  private dropQueue(): void {
    for (const job of this.queue.splice(0)) {
      this.pending.delete(job.key)
      job.resolve(null)
    }
  }

  /**
   * Where the sequence is that is being heard now, in seconds: what the
   * preview's clock is while this plays. Before the first sound, where it
   * starts. Null while stopped.
   */
  heardSec(): number | null {
    const ctx = this.ctx
    const run = this.run
    if (!ctx || !run) return null
    const at = this.heardClock(ctx)
    return (run.origin + Math.max(0, at - run.t0) * ctx.sampleRate) / ctx.sampleRate
  }

  /** The clips being heard at `sec`: those with a stretch started under it. */
  sounding(sec: number): string[] {
    const rate = this.ctx?.sampleRate
    if (!rate || !this.run) return []
    const at = Math.round(sec * rate)
    const out = new Set<string>()
    for (const p of this.started.values()) if (p.chunk.at <= at && at < p.chunk.at + p.chunk.frames) out.add(p.voice.id)
    return [...out]
  }

  /** Whether the first sound has been heard yet. */
  heard(): boolean {
    const ctx = this.ctx
    return ctx !== null && this.run !== null && this.heardClock(ctx) >= this.run.t0
  }

  close(): void {
    this.stop()
    this.decoded.clear()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    void ctx?.close().catch(() => undefined)
  }

  /** The clock time being heard now: what is coming out of the speakers, not what is being worked out. */
  private heardClock(ctx: AudioContext): number {
    const stamp = ctx.getOutputTimestamp?.()
    if (stamp && stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
      return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0)
  }

  private open(): AudioContext | null {
    if (this.broken) return null
    if (this.ctx) return this.ctx
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      const master = ctx.createGain()
      master.gain.value = this.masterGain
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      return ctx
    } catch {
      this.broken = true
      return null
    }
  }

  /** Start what is due on the clock, decode what is coming, and let go of what is behind. */
  private tick(): void {
    const ctx = this.ctx
    const run = this.run
    if (!ctx || !run) return
    const rate = ctx.sampleRate
    const now = this.heardSec() ?? run.origin / rate
    const here = Math.round(now * rate)
    this.want(here, here + Math.round(DECODE_AHEAD_SEC * rate), false)
    // Started a little ahead of what the context is working on now.
    const earliest = ctx.currentTime + 0.02
    const until = Math.round(Math.max(now, run.origin / rate) * rate + SCHEDULE_AHEAD_SEC * rate)
    for (const v of this.voices) {
      for (const c of chunksBetween(v, rate, run.origin, until)) {
        const id = `${v.id}#${c.index}`
        if (this.started.has(id)) continue
        const buffer = this.decoded.get(chunkKey(v, c, rate))
        if (!buffer) continue
        const at = startOf(c, run.origin, run.t0, rate, earliest)
        if (!at) continue
        this.startOne(ctx, id, v, c, buffer, at)
      }
    }
    // Stretches long gone: their nodes are let go, and what they held too.
    for (const [key, p] of this.started) if (p.when + p.chunk.frames / rate < ctx.currentTime - 1) this.started.delete(key)
    this.keepOnly(here - Math.round(2 * rate), here + Math.round((DECODE_AHEAD_SEC + 1) * rate))
  }

  /** Let go of every decoded stretch outside samples `from` to `to`. */
  private keepOnly(from: number, to: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const rate = ctx.sampleRate
    const kept = new Set<string>()
    for (const v of this.voices) for (const c of chunksBetween(v, rate, from, to)) kept.add(chunkKey(v, c, rate))
    for (const key of this.decoded.keys()) if (!kept.has(key)) this.decoded.delete(key)
  }

  private startOne(ctx: AudioContext, id: string, voice: SoundVoice, chunk: SoundChunk, buffer: AudioBuffer, at: { when: number; offset: number }): void {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    src.connect(gain)
    gain.connect(this.master!)
    const p: Playing = { voice, chunk, src, gain, when: at.when, offset: at.offset }
    this.applyGain(p)
    src.start(at.when, at.offset)
    this.started.set(id, p)
  }

  private stopOne(key: string, p: Playing): void {
    try {
      p.src.stop()
    } catch {
      // Never started, or already stopped.
    }
    p.src.disconnect()
    p.gain.disconnect()
    this.started.delete(key)
  }

  /** A stretch's gain on the clock: steady, or following its fade over the part still to come. */
  private applyGain(p: Playing): void {
    const ctx = this.ctx
    const run = this.run
    if (!ctx || !run) return
    const rate = ctx.sampleRate
    const g = p.gain.gain
    const from = Math.max(p.when, ctx.currentTime)
    const end = p.when + p.chunk.frames / rate - p.offset
    g.cancelScheduledValues(0)
    if (!p.voice.fadeAt || end - from <= 0.01) {
      g.value = p.voice.fadeAt ? p.voice.gain * p.voice.fadeAt(run.origin / rate + (from - run.t0)) : p.voice.gain
      return
    }
    const seq = run.origin / rate + (from - run.t0)
    g.setValueCurveAtTime(gainCurve(p.voice, seq, end - from), from, end - from)
  }

  /**
   * Decode the stretches over samples `from` to `to` that are not decoded or
   * on their way. `first` puts them ahead of anything waiting. The promises
   * of every stretch there, to wait on.
   */
  private want(from: number, to: number, first: boolean): Promise<AudioBuffer | null>[] {
    const ctx = this.ctx
    if (!ctx) return []
    const rate = ctx.sampleRate
    const out: Promise<AudioBuffer | null>[] = []
    for (const v of this.voices) {
      for (const c of chunksBetween(v, rate, from, to)) {
        const key = chunkKey(v, c, rate)
        if (this.decoded.has(key)) continue
        const failed = this.failedAt.get(key)
        if (failed !== undefined && performance.now() - failed < RETRY_MS) continue
        let p = this.pending.get(key)
        if (!p) {
          p = new Promise<AudioBuffer | null>((resolve) => {
            const job: Job = { key, voice: v, chunk: c, resolve }
            if (first) this.queue.unshift(job)
            else this.queue.push(job)
          })
          this.pending.set(key, p)
        }
        out.push(p)
      }
    }
    this.next()
    return out
  }

  /** Decode what is waiting, a few at a time. */
  private next(): void {
    const ctx = this.ctx
    if (!ctx) return
    while (this.decoding < AT_ONCE && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.decoding++
      const rate = ctx.sampleRate
      const { voice: v, chunk: c } = job
      void this.decode({ mediaId: v.mediaId, track: v.track, denoise: v.denoise, ...(v.voice ? { voice: v.voice } : {}), ...(v.side ? { side: v.side } : {}), fromSec: c.fileSec, frames: c.frames, rate })
        .catch(() => null)
        .then((pcm) => {
          let buffer: AudioBuffer | null = null
          if (pcm && pcm.length >= c.frames * 2) {
            buffer = ctx.createBuffer(2, c.frames, rate)
            const left = buffer.getChannelData(0)
            const right = buffer.getChannelData(1)
            for (let i = 0; i < c.frames; i++) {
              left[i] = pcm[2 * i]!
              right[i] = pcm[2 * i + 1]!
            }
          }
          // One that failed, as a recording still being prepared just after it
          // opens can, is asked for again a moment later, not given up on.
          if (buffer) {
            this.decoded.set(job.key, buffer)
            this.failedAt.delete(job.key)
          } else this.failedAt.set(job.key, performance.now())
          this.pending.delete(job.key)
          job.resolve(buffer)
        })
        .finally(() => {
          this.decoding--
          this.next()
          // A stretch arriving late is started as soon as it is here.
          if (this.run) this.tick()
        })
    }
  }
}
