import { newId } from './ids'
import { DEFAULT_CAPTION_STYLE, MAX_WORDS_PER_CAPTION, MIN_WORDS_PER_CAPTION, type CaptionStyle } from './caption-style'

/**
 * Captions made from the speech: every word said, at the frames it is said
 * over, grouped a few at a time into the blocks on the caption track. All
 * pure: the editing, the preview and the export read the same answers here.
 *
 * Times are whole frames at the project rate, as everywhere else, except
 * where whisper's own seconds are read.
 */

/** One word of a caption: its text, and the frames it is said over, counted from the caption's start. */
export interface CaptionWord {
  text: string
  start: number
  length: number
}

/** One block on the caption track: a few words shown together. */
export interface CaptionClip {
  id: string
  timelineStart: number
  length: number
  words: CaptionWord[]
  /**
   * Where the middle of it sits, as shares of the frame's width and height,
   * when it was put there by hand. Absent, it sits where the style puts every
   * caption, which is how one moved by hand is told from one that follows.
   */
  at?: CaptionAt
}

/** The middle of a caption, as shares of the frame: 0 is the left or top, 1 the right or bottom. */
export interface CaptionAt {
  x: number
  y: number
}

/** A sequence's captions, how they look, and the audio tracks listened to for them. */
export interface Captions {
  clips: CaptionClip[]
  style: CaptionStyle
  /** The audio tracks, by id, Make captions last listened to. Empty until it has been used. */
  listenTo: string[]
  /** Whether a caption has been changed by hand since they were made, so making them again asks first. */
  edited: boolean
}

/** A word at frames of its own in the sequence. */
export interface TimedWord {
  text: string
  start: number
  length: number
}

/** A word as whisper heard it, in seconds of what it listened to. */
export interface SpokenWord {
  text: string
  startSec: number
  endSec: number
}

/** A caption gets no longer than this, in characters, at three words or fewer, unless one word is longer on its own. */
export const MAX_CAPTION_CHARS = 18

/**
 * The most characters a caption holds when `per` words are asked for: about
 * six a word, and never fewer than 18. A fixed 18 held captions to two or
 * three words whatever was asked for; a caption too wide for the frame goes
 * onto a second line instead, as the layout already does.
 */
export function maxCaptionChars(per: number): number {
  return Math.max(MAX_CAPTION_CHARS, 6 * per)
}
/** A pause longer than this starts a new caption. */
const PAUSE_SEC = 0.4
/** A caption runs on to the next one across a gap shorter than this, so they do not flicker. */
const BRIDGE_SEC = 0.25
/** How long a word is taken to last at the least and the most, when whisper's own times say otherwise. */
const MIN_WORD_SEC = 0.08
const MAX_WORD_SEC = 1

/**
 * How late whisper's DTW hears a word, in seconds, taken off every time it
 * gives. Measured, not guessed.
 *
 * Ten words were synthesised and placed at known times, 0.7 seconds apart,
 * their onsets confirmed to the millisecond, and read back through the app's
 * own arguments and model. Every word came back late, by 0.14 to 0.34 seconds,
 * mean 0.284. At 30 fps that is most of a short caption, and it is what put
 * the captions behind the talking.
 *
 * DTW is precise and biased, which is why it is corrected rather than
 * replaced: its spread is only 0.2 seconds wide, so it follows the rhythm of
 * the talking well. The decoder's own token times, the other thing whisper
 * offers, are five times as scattered and put the first word of a file at zero
 * however much silence comes first.
 *
 * The number belongs to the engine rather than the model: the small model
 * measured 0.244 on the same audio, close enough that one figure covers both,
 * and only the medium one is shipped. `test/smoke/captions-timing.test.ts`
 * measures it again, so a new engine build cannot quietly move it.
 */
export const DTW_LATE_SEC = 0.28

export function emptyCaptions(): Captions {
  return { clips: [], style: { ...DEFAULT_CAPTION_STYLE }, listenTo: [], edited: false }
}

export function captionEnd(c: CaptionClip): number {
  return c.timelineStart + c.length
}

/** A word as a caption writes it: in capitals when the style says so. */
export function styledWord(text: string, style: CaptionStyle): string {
  return style.capitals ? text.toLocaleUpperCase('en') : text
}

/** A caption's words as it shows them. */
export function captionText(c: CaptionClip, style: CaptionStyle): string {
  return c.words.map((w) => styledWord(w.text, style)).join(' ')
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Bytes read one to a character, as UTF-8 text. */
function utf8(binary: string): string {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff
  return new TextDecoder().decode(bytes)
}

/** A token that is whisper's own bookkeeping: the start of a segment, a timestamp, the end of the text. */
const SPECIAL = /^\s*(\[_[^\]]*\]|<\|[^|]*\|>)\s*$/
/** Something said, rather than punctuation alone. */
const SAID = /[\p{L}\p{N}]/u
/** Punctuation that belongs at the end of the word before it. */
const TRAILING = /^[.,!?;:…'"”’)\]]+$/
/**
 * A bracketed run of this many words or fewer is a sound, not speech:
 * [Music], (laughs), [BLANK_AUDIO], [car horn]. Longer than that and it is a
 * sentence whisper was unsure of, which is still what was said.
 */
const NON_SPEECH_WORDS = 3

interface WhisperToken {
  text: string
  offsets: { from: number; to: number }
  t_dtw?: number
}

function isToken(t: unknown): t is WhisperToken {
  const x = t as Partial<WhisperToken> | null
  return typeof x === 'object' && x !== null && typeof x.text === 'string' && typeof x.offsets?.from === 'number' && typeof x.offsets.to === 'number'
}

/**
 * The words whisper heard, from the full JSON whisper-cli writes with `-ojf`,
 * given as the file's bytes read one to a character (Latin-1): a token can
 * hold part of a character, and only once a word's tokens are joined can it
 * be read as UTF-8.
 *
 * A token starting with a space starts a word, as the first of a segment
 * does; any other joins the word before it, so punctuation stays with its
 * word. A word starts where DTW hears its first token, less `DTW_LATE_SEC`,
 * which is how late DTW is measured to be, or at the token's own timestamp
 * when there is no DTW time, which is left alone because the lateness is
 * DTW's and not the decoder's. It ends when the next word starts, or after
 * about as long as its tokens say it lasted, within reason, whichever is
 * first. What is in brackets, such as [Music] or (laughs), is not speech.
 */
export function readWhisperJson(binary: string): SpokenWord[] {
  let raw: unknown
  try {
    raw = JSON.parse(binary)
  } catch {
    throw new Error("The speech engine's answer could not be read.")
  }
  const segments = (raw as { transcription?: unknown } | null)?.transcription
  if (!Array.isArray(segments)) throw new Error("The speech engine's answer could not be read.")

  interface Heard {
    bytes: string
    start: number
    from: number
    to: number
    /** Which segment it was heard in: a word never runs from one into the next. */
    segment: number
  }
  const heard: Heard[] = []
  segments.forEach((segment, n) => {
    const tokens = (segment as { tokens?: unknown } | null)?.tokens
    if (!Array.isArray(tokens)) return
    for (const t of tokens) {
      if (!isToken(t) || SPECIAL.test(t.text) || t.text === '') continue
      const from = t.offsets.from / 1000
      const to = t.offsets.to / 1000
      const last = heard.at(-1)
      if (!last || last.segment !== n || t.text.startsWith(' ')) {
        // DTW's own time, brought back by how late it is measured to run, and
        // never before the file begins.
        const dtw = typeof t.t_dtw === 'number' && t.t_dtw >= 0 ? Math.max(0, t.t_dtw / 100 - DTW_LATE_SEC) : null
        heard.push({ bytes: t.text, start: dtw ?? from, from, to, segment: n })
      } else {
        last.bytes += t.text
        last.to = Math.max(last.to, to)
      }
    }
  })

  interface Said {
    text: string
    start: number
    spoken: number
  }
  const words: Said[] = []
  /** A bracketed run, held until it closes and its length says what it was. */
  let bracketed: { closing: string; held: Said[] } | null = null
  let segment = -1

  const strip = (text: string): string => text.replace(/^[[(]+/, '').replace(/[\])]+$/, '')

  /**
   * A bracketed run is over. A short label, [Music] or (laughs), is a sound
   * rather than speech and goes. Anything longer is speech: whisper puts a
   * whole sentence in brackets when it is unsure of what it heard, and
   * dropping those threw away every word it had.
   */
  const closeBracket = (): void => {
    if (bracketed && bracketed.held.length > NON_SPEECH_WORDS) words.push(...bracketed.held)
    bracketed = null
  }

  for (const h of heard) {
    // A bracket whisper left open ends with its segment, rather than taking every word after it.
    if (h.segment !== segment) closeBracket()
    segment = h.segment
    const text = utf8(h.bytes).trim()
    if (text === '') continue
    if (bracketed !== null) {
      const inner = strip(text)
      if (SAID.test(inner)) bracketed.held.push({ text: inner, start: h.start, spoken: h.to - h.from })
      if (text.includes(bracketed.closing)) closeBracket()
      continue
    }
    const opening = text[0] === '[' ? ']' : text[0] === '(' ? ')' : null
    if (opening !== null) {
      const inner = strip(text)
      bracketed = { closing: opening, held: [] }
      if (SAID.test(inner)) bracketed.held.push({ text: inner, start: h.start, spoken: h.to - h.from })
      if (text.includes(opening)) closeBracket()
      continue
    }
    if (!SAID.test(text)) {
      const before = words.at(-1)
      if (before && TRAILING.test(text)) before.text += text
      continue
    }
    words.push({ text, start: h.start, spoken: h.to - h.from })
  }
  closeBracket()

  let floor = 0
  const starts = words.map((w) => (floor = Math.max(floor, w.start)))
  return words.map((w, i) => {
    const start = starts[i]!
    const next = starts[i + 1]
    const own = start + clamp(w.spoken, MIN_WORD_SEC, MAX_WORD_SEC)
    return { text: w.text, startSec: start, endSec: next === undefined ? own : Math.max(start, Math.min(own, next)) }
  })
}

/**
 * Words at frames of the sequence: each rounded to frames, at least one frame
 * long, and never starting before the one before it has ended.
 */
export function wordsToFrames(words: SpokenWord[], fps: number): TimedWord[] {
  let floor = 0
  return words.map((w) => {
    const start = Math.max(floor, Math.round(w.startSec * fps))
    const end = Math.max(start + 1, Math.round(w.endSec * fps))
    floor = end
    return { text: w.text, start, length: end - start }
  })
}

/** Whether a word ends a sentence, perhaps inside a quote or a bracket. */
function endsSentence(text: string): boolean {
  return /[.!?…]["'”’)\]]*$/.test(text)
}

/**
 * What a break between two captions costs, by what is either side of it. A
 * caption is read in the moment it is on screen, so it should end where a
 * reader would pause anyway. The numbers are judgement, kept here in one place
 * to be tuned from what real speech looks like.
 */
const COST = {
  /** Every caption: fewer, fuller captions read better than many thin ones. */
  caption: 10,
  /**
   * A caption of one word, when the stretch it is in has more than one to
   * share. Not for one that ends on a comma, such as "yes,", which is a phrase
   * of its own.
   */
  alone: 12,
  /** After a comma, a semicolon, a colon or a dash: where the speaker paused in writing. */
  afterPause: 0,
  /** Before a word that starts a clause, such as "and" or "because". */
  beforeClause: 2,
  /** Anywhere else. */
  plain: 4,
  /** After "the", "a" or "to", which leave the caption hanging on the next word. */
  hanging: 16,
  /** For unevenness: the square of a caption's characters, times this. Equal shares cost least. */
  uneven: 0.02
}

/** Words a caption should not end on: each belongs with the word after it. */
const HANGING = new Set(['a', 'an', 'the', 'to', 'of', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'and', 'but', 'or', 'with', 'for', 'in', 'on', 'at'])

/** Words that start a clause, and so start a caption well. */
const CLAUSE = new Set([
  'and', 'but', 'or', 'so', 'because', 'that', 'which', 'who', 'when', 'where', 'while', 'if', 'then',
  'though', 'although', 'until', 'since', 'unless', 'whether', 'before', 'after'
])

/** A word as the tables above know it: lower case, without the punctuation round it. */
function bare(text: string): string {
  return text.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
}

/** What a break after `before` and ahead of `after` costs. */
function breakCost(before: string, after: string): number {
  if (/[,;:\-\u2013\u2014]["'\u201d\u2019)\]]*$/.test(before)) return COST.afterPause
  if (HANGING.has(bare(before))) return COST.hanging
  if (CLAUSE.has(bare(after))) return COST.beforeClause
  return COST.plain
}

/**
 * One stretch of words shared between captions: as few as its limits allow,
 * broken where a reader would pause, and as even as those leave room for.
 *
 * A caption holds at most `per` words and `maxCaptionChars(per)` characters,
 * except that a word longer than that has one to itself. Within those, every way of cutting the
 * stretch is costed and the cheapest is taken, which a stretch no longer than
 * a sentence makes instant.
 */
function shareOut(stretch: TimedWord[], per: number): TimedWord[][] {
  const n = stretch.length
  const most = maxCaptionChars(per)
  const fits = (from: number, to: number): boolean =>
    to - from === 1 || (to - from <= per && stretch.slice(from, to).map((w) => w.text).join(' ').length <= most)
  // Even shares matter less the more words are asked for: at five, a full caption is the point.
  const uneven = COST.uneven * (3 / Math.max(3, per))
  // best[j]: the cheapest way to caption the first j words, and where its last caption starts.
  const best: { cost: number; from: number }[] = [{ cost: 0, from: 0 }]
  for (let j = 1; j <= n; j++) {
    best[j] = { cost: Infinity, from: j - 1 }
    for (let i = j - 1; i >= 0 && fits(i, j); i--) {
      const chars = stretch.slice(i, j).map((w) => w.text).join(' ').length
      const cut = j < n ? breakCost(stretch[j - 1]!.text, stretch[j]!.text) : 0
      // The last term only settles a tie, towards fuller captions first, as
      // the words are read.
      const cost =
        best[i]!.cost + COST.caption + cut + uneven * chars * chars + (j - i === 1 && n > 1 && breakCost(stretch[i]!.text, '') !== COST.afterPause ? COST.alone : 0) - 1e-4 * i
      if (cost < best[j]!.cost) best[j] = { cost, from: i }
    }
  }
  const groups: TimedWord[][] = []
  for (let j = n; j > 0; j = best[j]!.from) groups.unshift(stretch.slice(best[j]!.from, j))
  return groups
}

/**
 * Words grouped into captions.
 *
 * First into stretches, which nothing ever joins: a new one starts after a
 * word that ends a sentence and before a pause of more than 0.4 seconds. Then
 * each stretch is shared between captions by `shareOut`: at most as many words
 * as the style asks for and about six characters a word, broken at a comma or before "and"
 * rather than wherever the count ran out, and never leaving one word on its
 * own when the words could be shared out better. A caption lasts from its
 * first word's start to its last word's end, and runs on to the next caption
 * when the gap to it is under a quarter of a second.
 */
export function groupWords(words: TimedWord[], style: CaptionStyle, fps: number, makeId: () => string = newId): CaptionClip[] {
  const per = clamp(Math.round(style.wordsPerCaption), MIN_WORDS_PER_CAPTION, MAX_WORDS_PER_CAPTION)
  const stretches: TimedWord[][] = []
  let current: TimedWord[] = []
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = current.at(-1)
    if (last && (endsSentence(last.text) || w.start - (last.start + last.length) > PAUSE_SEC * fps)) {
      stretches.push(current)
      current = []
    }
    current.push(w)
  }
  if (current.length > 0) stretches.push(current)
  const groups = stretches.flatMap((s) => shareOut(s, per))

  return groups.map((group, i) => {
    const start = group[0]!.start
    const last = group.at(-1)!
    let end = last.start + last.length
    const next = groups[i + 1]?.[0]?.start
    if (next !== undefined && next > end && next - end < BRIDGE_SEC * fps) end = next
    return {
      id: makeId(),
      timelineStart: start,
      length: end - start,
      words: group.map((w) => ({ text: w.text, start: w.start - start, length: w.length }))
    }
  })
}

/** Every word of the captions at its own frames in the sequence, in order: for grouping them again. */
export function wordsOf(clips: CaptionClip[]): TimedWord[] {
  return clips
    .flatMap((c) => c.words.map((w) => ({ text: w.text, start: c.timelineStart + w.start, length: w.length })))
    .sort((a, b) => a.start - b.start)
}

/** The caption on screen at `frame`, if any. */
export function captionAt(clips: CaptionClip[], frame: number): CaptionClip | undefined {
  return clips.find((c) => frame >= c.timelineStart && frame < captionEnd(c))
}

/**
 * Which word of a caption is being said at `frame`: the last to have started
 * by then, so a word stays lit through the pause after it until the next
 * begins. Its first word is lit from the caption's start.
 */
export function wordAt(c: CaptionClip, frame: number): number {
  const into = frame - c.timelineStart
  let lit = 0
  c.words.forEach((w, i) => {
    if (w.start <= into) lit = i
  })
  return lit
}

/**
 * A caption cut in two at `frame`: the words begun before it in the first
 * piece, kept whole, and the rest in the second, which has a new id. The
 * first runs on to where the second starts, so nothing flickers off between
 * them. Null when `frame` is not inside it, or when either piece would have
 * no words.
 */
export function splitCaption(c: CaptionClip, frame: number, makeId: () => string = newId): [CaptionClip, CaptionClip] | null {
  if (frame <= c.timelineStart || frame >= captionEnd(c)) return null
  const k = c.words.filter((w) => c.timelineStart + w.start < frame).length
  if (k === 0 || k === c.words.length) return null
  const at = c.words[k]!.start
  return [
    { ...c, length: at, words: c.words.slice(0, k) },
    {
      ...c,
      id: makeId(),
      timelineStart: c.timelineStart + at,
      length: c.length - at,
      words: c.words.slice(k).map((w) => ({ ...w, start: w.start - at }))
    }
  ]
}

/**
 * A caption stretched or squeezed to a new start and length, each word
 * keeping its share of it: how a caption is retimed by trimming it. At least
 * one frame a word.
 */
export function retimeCaption(c: CaptionClip, start: number, length: number): CaptionClip {
  const to = Math.max(length, c.words.length)
  const scale = c.length > 0 ? to / c.length : 1
  const starts = c.words.map((w) => Math.min(to - 1, Math.round(w.start * scale)))
  // Each word starts at least a frame after the one before, and ends where the next starts, or as its share says.
  let floor = 0
  const at = starts.map((s, i) => (floor = i === 0 ? Math.max(0, s) : Math.max(floor + 1, s)))
  // And a frame before the end for every word after it, so the last is inside the caption.
  for (let i = at.length - 1, ceil = to; i >= 0; i--) ceil = at[i] = Math.min(at[i]!, ceil - 1)
  const words = c.words.map((w, i) => {
    const next = at[i + 1] ?? to
    const own = Math.max(1, Math.round(w.length * scale))
    return { text: w.text, start: at[i]!, length: Math.max(1, Math.min(own, next - at[i]!)) }
  })
  return { ...c, timelineStart: start, length: to, words }
}

/** Words to match one another by: without case, which capitals only show. */
function same(a: string, b: string): boolean {
  return a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en')
}

/**
 * A caption's words as typed: a word changed keeps its timing, words added
 * share the time of the word they were typed beside, and words deleted give
 * their time to the words either side. Null when nothing is left of it.
 */
export function editCaptionWords(c: CaptionClip, text: string): CaptionClip | null {
  const typed = text.split(/\s+/).filter((w) => w !== '')
  if (typed.length === 0) return null
  const old = c.words
  // The longest run of words kept, in order: what lies between is changed, added or deleted.
  const n = old.length
  const m = typed.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = same(old[i]!.text, typed[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  interface Slot {
    text: string
    start: number
    end: number
    added: boolean
  }
  const out: Slot[] = []
  const gone: { at: number; start: number; end: number }[] = []
  let i = 0
  let j = 0
  const flush = (oldTo: number, typedTo: number): void => {
    const was = old.slice(i, oldTo)
    const now = typed.slice(j, typedTo)
    if (was.length > 0 && now.length > 0) {
      if (was.length === now.length) {
        was.forEach((w, k) => out.push({ text: now[k]!, start: w.start, end: w.start + w.length, added: false }))
      } else {
        // Changed words share the time of the words they replace.
        const from = was[0]!.start
        const to = was.at(-1)!.start + was.at(-1)!.length
        now.forEach((t, k) => out.push({ text: t, start: from + ((to - from) * k) / now.length, end: from + ((to - from) * (k + 1)) / now.length, added: false }))
      }
    } else if (was.length > 0) {
      gone.push({ at: out.length, start: was[0]!.start, end: was.at(-1)!.start + was.at(-1)!.length })
    } else {
      for (const t of now) out.push({ text: t, start: 0, end: 0, added: true })
    }
    i = oldTo
    j = typedTo
  }
  let oi = 0
  let tj = 0
  while (oi < n && tj < m) {
    if (same(old[oi]!.text, typed[tj]!)) {
      flush(oi, tj)
      out.push({ text: typed[tj]!, start: old[oi]!.start, end: old[oi]!.start + old[oi]!.length, added: false })
      oi++
      tj++
      i = oi
      j = tj
    } else if (lcs[oi + 1]![tj]! >= lcs[oi]![tj + 1]!) oi++
    else tj++
  }
  flush(n, m)

  // Words added share the time of the word before them, or after them at the start.
  for (let k = 0; k < out.length; ) {
    if (!out[k]!.added) {
      k++
      continue
    }
    let e = k
    while (e < out.length && out[e]!.added) e++
    const beside = k > 0 ? k - 1 : e < out.length ? e : -1
    const run = beside === k - 1 ? [beside, ...range(k, e)] : [...range(k, e), beside]
    const from = beside >= 0 ? out[beside]!.start : 0
    const to = beside >= 0 ? out[beside]!.end : c.length
    run.forEach((idx, r) => {
      if (idx < 0) return
      out[idx]!.start = from + ((to - from) * r) / run.length
      out[idx]!.end = from + ((to - from) * (r + 1)) / run.length
      out[idx]!.added = false
    })
    k = e
  }
  // Words deleted give their time to the words either side, half each.
  for (const g of gone) {
    const before = out[g.at - 1]
    const after = out[g.at]
    const middle = (g.start + g.end) / 2
    if (before) before.end = after ? middle : g.end
    if (after) after.start = before ? middle : g.start
  }

  let floor = 0
  const words = out.map((w) => {
    const start = Math.max(floor, Math.round(w.start))
    const end = Math.max(start + 1, Math.round(w.end))
    floor = end
    return { text: w.text, start, length: end - start }
  })
  const last = words.at(-1)!
  return { ...c, length: Math.max(c.length, last.start + last.length), words }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, k) => from + k)
}

export * from './caption-style'

// What moved out of this file, by what it does. Everything that was exported
// here still is, so every file goes on importing from this one.
export { CAPTION_FONT, CAPTION_FONT_FILE, textWidth, ASS_SIZE_PER_EM, captionBox, cleanCaptionAt, drawnWord, layoutCaption } from './caption-layout'
export type { CaptionLine, CaptionLayout } from './caption-layout'
export { captionsSrt, captionsTranscript, transcriptOf, captionsAss } from './caption-files'

/**
 * Plan 78: a stretch of the sequence captions are made for, in its frames,
 * `to` not included.
 */
export interface Stretch {
  from: number
  to: number
}

/** Stretches in order, joined where they overlap or touch, and without the empty ones. */
export function mergeStretches(stretches: readonly Stretch[]): Stretch[] {
  const out: Stretch[] = []
  for (const s of [...stretches].filter((x) => x.to > x.from).sort((a, b) => a.from - b.from)) {
    const last = out.at(-1)
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push({ from: s.from, to: s.to })
  }
  return out
}

/**
 * Words heard on the stretches played one after another, put back on the
 * sequence's own frames: a word is placed in the stretch it starts in, and
 * cut short where that stretch ends. One starting past the last is dropped.
 */
export function wordsBack(words: readonly TimedWord[], stretches: readonly Stretch[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const w of words) {
    let offset = 0
    for (const s of stretches) {
      const length = s.to - s.from
      if (w.start >= offset && w.start < offset + length) {
        const start = s.from + (w.start - offset)
        out.push({ text: w.text, start, length: Math.max(1, Math.min(w.length, s.to - start)) })
        break
      }
      offset += length
    }
  }
  return out
}

/** The captions making captions for these stretches would replace: those starting inside one. */
export function captionsWithin(clips: readonly CaptionClip[], stretches: readonly Stretch[]): CaptionClip[] {
  return clips.filter((c) => stretches.some((s) => c.timelineStart >= s.from && c.timelineStart < s.to))
}
