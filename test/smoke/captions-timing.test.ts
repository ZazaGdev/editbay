import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { engineReady, enginePaths } from '../../src/main/speech/engine'
import { whisperArgs, speechThreads } from '../../src/main/speech/transcribe'
import { readWhisperJson, DTW_LATE_SEC } from '../../src/shared/captions'

/**
 * How late the speech engine hears a word, measured rather than assumed.
 *
 * `DTW_LATE_SEC` is a number taken off every word time whisper gives, because
 * whisper's DTW is biased late. A number like that goes stale the moment the
 * engine build or the model changes, and both changed within a week of it
 * being measured, so it is measured again here rather than described in a
 * comment.
 *
 * Speech is synthesised a word at a time, trimmed to its first sound, and laid
 * out at known times. That makes the truth exact: the audio is silent until
 * the millisecond a word is placed at. Real speech would be more honest about
 * how a person starts a word, and there is no way to know when they did.
 *
 * Needs the engine the app downloads, and Windows for its voices. Skips
 * without either.
 */

const folder = process.env.EDITBAY_SPEECH_DIR ?? join(process.env.APPDATA ?? '', 'Editbay', 'speech')
const ready = (await engineReady(folder)) && process.platform === 'win32'
const work = await mkdtemp(join(tmpdir(), 'editbay-caption-timing-'))

/** The words said, and the second each one starts at in the audio built from them. */
const SAID = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog', 'again']
const FIRST_SEC = 0.5
const APART_SEC = 0.7
const truth = SAID.map((_, i) => FIRST_SEC + i * APART_SEC)

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

/** One word spoken into a wav by Windows' own voice. */
async function say(word: string, index: number): Promise<string> {
  const out = join(work, `said-${index}.wav`)
  await capture(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${out}'); $s.Speak('${word}'); $s.Dispose()`
    ],
    { collectStdout: false }
  )
  return out
}

/** The words laid out at their known times, one channel at the rate whisper listens at. */
async function buildAudio(): Promise<string> {
  const spoken: string[] = []
  for (const [i, word] of SAID.entries()) {
    const raw = await say(word, i)
    const trimmed = join(work, `trimmed-${i}.wav`)
    // Trimmed to its first sound, so where it is placed is where it is said.
    await capture(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0,aresample=16000',
      '-ac', '1', '-c:a', 'pcm_s16le', trimmed
    ])
    spoken.push(trimmed)
  }

  const out = join(work, 'known.wav')
  const lengthSec = Math.ceil(FIRST_SEC + SAID.length * APART_SEC + 1)
  const delays = spoken.map((_, i) => `[${i + 1}]adelay=${Math.round(truth[i]! * 1000)}:all=1[d${i}]`).join(';')
  const mixed = `[0]${spoken.map((_, i) => `[d${i}]`).join('')}amix=inputs=${spoken.length + 1}:duration=first:normalize=0[out]`
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:d=${lengthSec}`,
    ...spoken.flatMap((p) => ['-i', p]),
    '-filter_complex', `${delays};${mixed}`,
    '-map', '[out]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out
  ])
  return out
}

describe.skipIf(!ready)('how late the engine hears a word', () => {
  it('lands each word on the word, with no lateness left over', async () => {
    const wav = await buildAudio()
    const paths = enginePaths(folder)
    const outBase = join(work, 'words')
    await capture(paths.cli, whisperArgs(paths.model, paths.dtw, wav, outBase, speechThreads()), { collectStdout: false })
    const words = readWhisperJson((await readFile(`${outBase}.json`)).toString('latin1'))

    const errors = words.map((w, i) => w.startSec - (truth[i] ?? NaN))
    console.log(
      `${words.length} words, ${DTW_LATE_SEC} s taken off each\n` +
        words.map((w, i) => `${w.text.padEnd(8)} truth ${truth[i]?.toFixed(2) ?? '--'}  heard ${w.startSec.toFixed(3)}  error ${errors[i]!.toFixed(3)}`).join('\n')
    )

    // The words themselves are not asserted: a synthetic voice saying one word
    // alone is misheard often enough that the text is not the measurement.
    expect(words, `heard ${words.map((w) => w.text).join(' ')}`).toHaveLength(SAID.length)

    // Centred on the word rather than sitting to one side, which is the whole
    // point of taking the lateness off.
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    expect(Math.abs(mean), `mean error ${mean.toFixed(3)} s`).toBeLessThan(0.1)

    // And no word far out either way. Six frames at 30 fps.
    for (const [i, error] of errors.entries()) {
      expect(Math.abs(error), `${words[i]!.text} is ${error.toFixed(3)} s out`).toBeLessThan(0.2)
    }
  }, 300_000)
})
