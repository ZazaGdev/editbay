// A stand-in for whisper-cli, for the tests: it takes the same arguments,
// prints its progress as whisper-cli does, and writes the full JSON of words
// it is told to hear, rather than listening. Run with Node, or with Electron
// as Node.
//
// EDITBAY_FAKE_WHISPER_WORDS  the words to hear, as JSON: [{ "text", "start", "end" }] in seconds.
// EDITBAY_FAKE_WHISPER_FILE   a file of whisper-cli's own output to give instead, word for word.
// EDITBAY_FAKE_WHISPER_LOG    a file to write what it was given: its arguments and the WAV's shape.
// EDITBAY_FAKE_WHISPER_DELAY_MS  how long to take over each tenth, so a test can cancel it part way.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const value = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const wav = value('-f')
const out = value('-of')
if (!wav || !out || !args.includes('-ojf')) {
  process.stderr.write('fake whisper: needs -f, -of and -ojf\n')
  process.exit(2)
}

/** The shape of a WAV: its rate, channels, and how long it is. */
function shapeOf(path) {
  const b = readFileSync(path)
  let off = 12
  let fmt = null
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(off + 10), sampleRate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) }
    if (id === 'data' && fmt) {
      const samples = Math.min(size, b.length - off - 8) / (fmt.channels * (fmt.bits / 8))
      return { ...fmt, seconds: samples / fmt.sampleRate }
    }
    off += 8 + size + (size % 2)
  }
  return null
}

const log = process.env.EDITBAY_FAKE_WHISPER_LOG
if (log) writeFileSync(log, JSON.stringify({ args, wav: shapeOf(wav) }))

const words = JSON.parse(
  process.env.EDITBAY_FAKE_WHISPER_WORDS ??
    JSON.stringify([
      { text: 'Hello', start: 0.5, end: 0.9 },
      { text: 'there', start: 0.9, end: 1.3 },
      { text: 'everyone.', start: 1.4, end: 2.0 }
    ])
)

const delay = Number(process.env.EDITBAY_FAKE_WHISPER_DELAY_MS ?? 0)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
for (let p = 10; p <= 100; p += 10) {
  if (delay > 0) await sleep(delay)
  process.stderr.write(`whisper_print_progress_callback: progress = ${String(p).padStart(3)}%\n`)
}

const given = process.env.EDITBAY_FAKE_WHISPER_FILE
if (given) {
  copyFileSync(given, `${out}.json`)
  process.exit(0)
}

/**
 * How late whisper's DTW hears a word, in seconds.
 *
 * The real engine's word times run this late and the app takes it off again,
 * so the stand-in has to be late by the same amount: a stand-in that hears
 * perfectly would have every word land early, and the tests would be measuring
 * the correction rather than the app.
 *
 * Kept in step with `DTW_LATE_SEC` in `src/shared/captions.ts` by the caption
 * tests themselves: if the two drift apart, every caption they expect moves.
 */
const DTW_LATE_SEC = 0.28

// Written as whisper-cli writes it: a new segment after each sentence, with
// its bookkeeping tokens around it, and a word's closing punctuation in a
// token of its own, as whisper's tokens mostly are.
const ms = (s) => Math.round(s * 1000)
const token = (text, from, to, dtw) => ({ text, timestamps: { from: '', to: '' }, offsets: { from, to }, id: 1, p: 0.9, t_dtw: dtw })
const segments = [[]]
for (const w of words) {
  segments.at(-1).push(w)
  if (/[.!?]$/.test(w.text)) segments.push([])
}
writeFileSync(
  `${out}.json`,
  JSON.stringify({
    systeminfo: 'fake',
    result: { language: 'en' },
    transcription: segments
      .filter((s) => s.length > 0)
      .map((s) => ({
        offsets: { from: ms(s[0].start), to: ms(s.at(-1).end) },
        text: s.map((w) => ` ${w.text}`).join(''),
        tokens: [
          token('[_BEG_]', ms(s[0].start), ms(s[0].start), -1),
          ...s.flatMap((w) => {
            const [, said, stop] = w.text.match(/^(.*?)([.,!?]*)$/)
            const end = stop ? ms(w.end) - 10 : ms(w.end)
            return [token(` ${said}`, ms(w.start), end, Math.round((w.start + DTW_LATE_SEC) * 100)), ...(stop ? [token(stop, end, ms(w.end), -1)] : [])]
          }),
          token(`[_TT_${Math.round(s.at(-1).end * 50)}]`, ms(s.at(-1).end), ms(s.at(-1).end), -1)
        ]
      }))
  })
)
process.stdout.write(words.map((w) => w.text).join(' ') + '\n')
