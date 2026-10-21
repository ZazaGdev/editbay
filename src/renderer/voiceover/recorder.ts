import { lineUp } from '../../shared/voiceover'
import type { FinishedTake } from '../../shared/types'
import { RUNNING_SYSTEM } from '../../shared/system'

/**
 * A voice over take from the microphone. The sound comes in through an
 * AudioWorklet, which knows the audio clock's frame of every block it is
 * given, is mixed to one channel and made 16-bit there, and goes to main in
 * pieces as it records. When it stops, its head is lined up with the frame
 * where recording began, from what the preview said about its clock and what
 * the browser says about its delays.
 */

/**
 * Runs in the audio thread. Every block it is given is appended, and a block
 * with nothing in it counts as silence, so sample n of the take is always
 * the audio clock's frame `first + n`.
 */
const WORKLET = `
class TakeCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(4800)
    this.filled = 0
    this.first = -1
    this.peak = 0
    this.port.onmessage = () => {
      this.flush()
      this.port.postMessage({ flushed: true })
    }
  }
  flush() {
    if (this.filled === 0) return
    this.port.postMessage({ first: this.first, samples: this.buffer.slice(0, this.filled), peak: this.peak })
    this.filled = 0
    this.peak = 0
  }
  process(inputs) {
    const input = inputs[0]
    const n = input && input[0] ? input[0].length : 128
    if (this.first < 0) {
      if (!input || !input[0]) return true
      this.first = currentFrame
    }
    for (let i = 0; i < n; i++) {
      let s = 0
      if (input && input.length > 0 && input[0]) {
        for (let c = 0; c < input.length; c++) s += input[c][i]
        s /= input.length
      }
      const a = Math.abs(s)
      if (a > this.peak) this.peak = a
      this.buffer[this.filled++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))
      if (this.filled === this.buffer.length) this.flush()
    }
    return true
  }
}
registerProcessor('take-capture', TakeCapture)
`

/** A microphone the window can record from. */
export interface Microphone {
  id: string
  label: string
}

/** The microphones there are, by name, once the app has been allowed to use one. */
export async function microphones(): Promise<Microphone[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  } catch {
    return []
  }
}

/** Why recording could not start, in words to show rather than to log. */
export class MicrophoneRefused extends Error {}

function refusal(err: unknown): MicrophoneRefused {
  const name = err instanceof DOMException ? err.name : ''
  if ((name === 'NotAllowedError' || name === 'SecurityError') && RUNNING_SYSTEM === 'mac') {
    return new MicrophoneRefused(
      'macOS is not letting Editbay use the microphone. Allow it in System Settings, Privacy & Security, Microphone, then try again.'
    )
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicrophoneRefused(
      'Windows is not letting Editbay use the microphone. Allow it in Settings, Privacy & security, Microphone, under "Let desktop apps access your microphone".'
    )
  }
  if (name === 'NotFoundError') return new MicrophoneRefused('No microphone was found. Plug one in and try again.')
  if (name === 'NotReadableError' && RUNNING_SYSTEM === 'mac') {
    return new MicrophoneRefused(
      'The microphone could not be opened. Close anything else using it, or allow it in System Settings, Privacy & Security, Microphone.'
    )
  }
  // Windows reports a microphone its privacy setting blocks this way too, not only one another app holds.
  if (name === 'NotReadableError') {
    return new MicrophoneRefused(
      'The microphone could not be opened. Close anything else using it, or allow it in Settings, Privacy & security, Microphone, under "Let desktop apps access your microphone".'
    )
  }
  return new MicrophoneRefused(`The microphone could not be started: ${err instanceof Error ? err.message : String(err)}`)
}

/** Ask for the microphone chosen, or the default when it is gone. */
async function openMicrophone(deviceId: string | null): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const audio = (id: string | null): MediaTrackConstraints => ({
    ...(id ? { deviceId: { exact: id } } : {}),
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  })
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: audio(deviceId), video: false }), fellBack: false }
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio: audio(null), video: false }), fellBack: true }
      } catch (again) {
        throw refusal(again)
      }
    }
    throw refusal(err)
  }
}

export interface Take {
  /** The WAV's path, known from the start. */
  readonly path: string
  /** Whether the chosen microphone was gone, so the system's default is recording. */
  readonly fellBack: boolean
  /**
   * Where the sequence is, in seconds, at `performance.now()` `at`, as the
   * preview reports it. The last report before the take stops lines it up.
   */
  anchor(sec: number, at: number): void
  /** How loud the microphone has been lately, 0 to 1. */
  level(): number
  /** Seconds since recording began. */
  elapsed(): number
  /**
   * Why the take stopped being saved, when a piece of it could not be
   * written, as when the disk is full. Null while all is well.
   */
  failure(): string | null
  /** Stop and keep: the WAV and the source it became once they are made, or null when there was nothing. */
  stop(): Promise<FinishedTake | null>
  /** Stop and throw it away. */
  cancel(): Promise<void>
}

/**
 * Start recording. `startSec` is where the sequence is when recording
 * begins; until the preview reports its clock, that moment is taken as now.
 */
export async function startTake(opts: { deviceId: string | null; startSec: number }): Promise<Take> {
  const { stream, fellBack } = await openMicrophone(opts.deviceId)
  let ctx: AudioContext | null = null
  let begun = false
  let path: string
  let node: AudioWorkletNode
  let source: MediaStreamAudioSourceNode
  // Whatever fails from here, the microphone is let go and main's take closed.
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    node = new AudioWorkletNode(ctx, 'take-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    try {
      path = await window.api.voiceBegin(ctx.sampleRate)
    } catch (err) {
      const why = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
      throw new MicrophoneRefused(`The voice over could not be saved: ${why}`)
    }
    begun = true
    source = ctx.createMediaStreamSource(stream)
    // Connected through to the speakers, silent, so the graph keeps running.
    source.connect(node)
    node.connect(ctx.destination)
    if (ctx.state !== 'running') await ctx.resume()
  } catch (err) {
    for (const t of stream.getTracks()) t.stop()
    void ctx?.close().catch(() => undefined)
    if (begun) void window.api.voiceCancel().catch(() => undefined)
    throw err instanceof MicrophoneRefused ? err : refusal(err)
  }
  const audio = ctx

  const began = performance.now()
  /** The frame where recording began, on the clock the page and the preview share. */
  let anchor = { sec: opts.startSec, at: began }
  /** The audio clock against that clock, read around the anchor. */
  let stamp = audio.getOutputTimestamp()
  let first: number | null = null
  let peak = 0
  let pending: Int16Array[] = []
  let sending: Promise<void> = Promise.resolve()
  let flushed: (() => void) | null = null
  let closed = false
  /** The first piece that could not be written, and why. */
  let failed: string | null = null

  const send = (): void => {
    if (pending.length === 0) return
    const total = pending.reduce((n, a) => n + a.length, 0)
    const joined = new Int16Array(total)
    let at = 0
    for (const a of pending) {
      joined.set(a, at)
      at += a.length
    }
    pending = []
    sending = sending
      .then(() => window.api.voiceChunk(new Uint8Array(joined.buffer)))
      .catch((err: unknown) => {
        failed ??= err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
      })
  }
  const timer = window.setInterval(send, 250)

  node.port.onmessage = (e: MessageEvent<{ first?: number; samples?: Int16Array; peak?: number; flushed?: boolean }>) => {
    const m = e.data
    if (m.flushed) {
      flushed?.()
      return
    }
    if (m.samples) {
      if (first === null && typeof m.first === 'number') first = m.first
      pending.push(m.samples)
      peak = Math.max(peak * 0.6, m.peak ?? 0)
    }
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    window.clearInterval(timer)
    for (const t of stream.getTracks()) t.stop()
    source.disconnect()
    node.disconnect()
    await audio.close().catch(() => undefined)
  }

  return {
    path,
    fellBack,
    anchor(sec: number, at: number): void {
      anchor = { sec, at }
      const now = audio.getOutputTimestamp()
      // Read beside the anchor, where the two clocks have had least time to drift apart.
      if (now.performanceTime) stamp = now
    },
    level: () => peak,
    failure: () => failed,
    elapsed: () => (performance.now() - began) / 1000,
    async stop(): Promise<FinishedTake | null> {
      if (closed) return null
      await new Promise<void>((resolve) => {
        flushed = resolve
        node.port.postMessage('flush')
        // A worklet that never answers must not hold the take forever.
        window.setTimeout(resolve, 1000)
      })
      send()
      const settings = stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
      // Base latency is processing, not the way to the speakers, so it is no stand-in for it.
      const outputLatency = audio.outputLatency || 0
      const sampleRate = audio.sampleRate
      // Before the audio has reached the speakers the reading is empty: take it now instead,
      // and failing that the audio clock as it is now.
      if (!stamp.performanceTime) stamp = audio.getOutputTimestamp()
      if (!stamp.performanceTime) stamp = { contextTime: audio.currentTime, performanceTime: performance.now() }
      await close()
      await sending
      if (first === null) {
        await window.api.voiceCancel()
        return null
      }
      // The moment the sequence was at the frame where recording began, on
      // the clock the page and the preview share, and then on the audio clock.
      const atStart = anchor.at - (anchor.sec - opts.startSec) * 1000
      const startedAt = (stamp.contextTime ?? 0) + (atStart - (stamp.performanceTime ?? 0)) / 1000
      const line = lineUp({
        sampleRate,
        firstCaptured: first / sampleRate,
        startedAt,
        inputLatency: settings?.latency ?? 0,
        outputLatency
      })
      return window.api.voiceFinish(line)
    },
    async cancel(): Promise<void> {
      await close()
      await sending
      await window.api.voiceCancel()
    }
  }
}
