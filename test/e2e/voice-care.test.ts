import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg, measureFfmpeg } from '../../src/main/ffmpeg/run'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { careCopyArgs, voiceMeasureArgs, type CareSteps } from '../../src/main/media/tracks'
import { parseLoudnorm } from '../../src/shared/render-plan'
import { VOICE_BAND, breathThreshold } from '../../src/shared/voice-care'

/**
 * Plan 81: a made-up voice run through Soften breaths and Remove mouth
 * clicks. Words are a steady tone with its overtones, in the band a voice has
 * most of its energy in; breaths are quieter noise above that band, between
 * the words; clicks are single loud samples in the breaths. What comes out is
 * measured window by window against what went in.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-care-'))
afterAll(() => rm(work, { recursive: true, force: true }))

const RATE = 48000
/** A word and then a breath, over and over: 0.8 s of word, 0.4 s of breath. */
const WORD = 0.8
const BREATH = 0.4
const CYCLES = 6
/** Two clicks, each in the middle of a breath. */
const CLICKS = [1, 3].map((i) => i * (WORD + BREATH) + WORD + BREATH / 2)

async function voice(): Promise<string> {
  const path = join(work, 'voice.wav')
  const period = WORD + BREATH
  const words = `aevalsrc=exprs='if(lt(mod(t\\,${period})\\,${WORD})\\,0.45*sin(2*PI*220*t)+0.18*sin(2*PI*440*t)+0.08*sin(2*PI*660*t)\\,0)':s=${RATE}:d=${CYCLES * period}`
  const breaths = `anoisesrc=color=pink:amplitude=0.12:r=${RATE}:d=${CYCLES * period},highpass=f=1500,highpass=f=1500,volume='if(gte(mod(t\\,${period})\\,${WORD})\\,1\\,0)':eval=frame`
  const clicks = `aevalsrc=exprs='${CLICKS.map((t) => `eq(n\\,${Math.round(t * RATE)})`).join('+')}*0.9':s=${RATE}:d=${CYCLES * period}`
  await runFfmpeg([
    '-f', 'lavfi', '-i', words,
    '-f', 'lavfi', '-i', breaths,
    '-f', 'lavfi', '-i', clicks,
    '-filter_complex', '[0][1][2]amix=inputs=3:normalize=0,aformat=channel_layouts=stereo[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', '-y', path
  ])
  return path
}

/** The first channel, as numbers from -1 to 1, 48000 a second. */
async function samples(path: string): Promise<Float32Array> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'])
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4))
}

function rmsDb(s: Float32Array, from: number, to: number): number {
  const a = Math.round(from * RATE)
  const b = Math.round(to * RATE)
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i]! * s[i]!
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-20)
}

function peakDb(s: Float32Array, at: number, reach = 0.004): number {
  let peak = 0
  for (let i = Math.round((at - reach) * RATE); i < Math.round((at + reach) * RATE); i++) peak = Math.max(peak, Math.abs(s[i]!))
  return 20 * Math.log10(peak + 1e-20)
}

/** The middle of each word, and of each breath away from its click, clear of the gate's opening and closing. */
const wordsAt = Array.from({ length: CYCLES }, (_, i) => [i * (WORD + BREATH) + 0.2, i * (WORD + BREATH) + WORD - 0.1] as const)
const breathsAt = Array.from({ length: CYCLES - 1 }, (_, i) => [i * (WORD + BREATH) + WORD + 0.22, i * (WORD + BREATH) + WORD + BREATH - 0.03] as const)
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

async function treated(input: string, name: string, steps: CareSteps): Promise<Float32Array> {
  const out = join(work, `${name}.m4a`)
  await runFfmpeg(careCopyArgs(input, out, steps))
  return samples(out)
}

describe('breaths and mouth clicks, treated', () => {
  it('turns the breaths down by about the amount chosen and leaves the words as they were', async () => {
    const input = await voice()
    const before = await samples(input)
    const band = parseLoudnorm(await measureFfmpeg(voiceMeasureArgs(input, VOICE_BAND)))?.i ?? null
    const threshold = breathThreshold(band)
    const plain = await treated(input, 'plain', { clicks: false })
    const words = (s: Float32Array): number => mean(wordsAt.map(([a, b]) => rmsDb(s, a, b)))
    const breaths = (s: Float32Array): number => mean(breathsAt.map(([a, b]) => rmsDb(s, a, b)))
    // Through the copy with nothing on, the words and breaths are as recorded.
    expect(Math.abs(words(plain) - words(before))).toBeLessThan(1)
    expect(Math.abs(breaths(plain) - breaths(before))).toBeLessThan(1.5)

    const gentle = await treated(input, 'gentle', { clicks: false, breaths: { amount: 'gentle', threshold } })
    const strong = await treated(input, 'strong', { clicks: false, breaths: { amount: 'strong', threshold } })
    expect(Math.abs(words(gentle) - words(plain))).toBeLessThan(1.5)
    expect(Math.abs(words(strong) - words(plain))).toBeLessThan(1.5)
    const gentleDown = breaths(plain) - breaths(gentle)
    const strongDown = breaths(plain) - breaths(strong)
    expect(gentleDown).toBeGreaterThan(7)
    expect(gentleDown).toBeLessThan(13)
    expect(strongDown).toBeGreaterThan(15)
    expect(strongDown).toBeLessThan(25)
  }, 120_000)

  it('takes the clicks out and leaves the words and the breaths', async () => {
    const input = await voice()
    const plain = await treated(input, 'plain-clicks', { clicks: false })
    const declicked = await treated(input, 'declicked', { clicks: true })
    for (const at of CLICKS) expect(peakDb(plain, at) - peakDb(declicked, at)).toBeGreaterThan(12)
    const words = (s: Float32Array): number => mean(wordsAt.map(([a, b]) => rmsDb(s, a, b)))
    expect(Math.abs(words(declicked) - words(plain))).toBeLessThan(1)
  }, 120_000)
})
