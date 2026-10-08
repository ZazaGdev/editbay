import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DTW_LATE_SEC,
  DEFAULT_CAPTION_STYLE,
  captionAt,
  captionsAss,
  captionsSrt,
  captionsTranscript,
  transcriptOf,
  captionBox,
  cleanCaptionAt,
  cleanCaptionStyle,
  editCaptionWords,
  groupWords,
  layoutCaption,
  readWhisperJson,
  retimeCaption,
  splitCaption,
  textWidth,
  wordAt,
  wordsOf,
  wordsToFrames,
  type CaptionClip,
  type TimedWord
} from '../../src/shared/captions'

/** One token as whisper-cli's full JSON gives it: its text, its span in milliseconds, and its DTW time in hundredths of a second. */
interface Token {
  text: string
  from: number
  to: number
  dtw?: number
}

/**
 * whisper-cli's `-ojf` output for some segments of tokens, as the bytes of the
 * file read one character to a byte: the way the app reads it, since a token
 * can hold half of a character.
 */
function whisperFile(segments: Token[][]): string {
  const json = JSON.stringify({
    systeminfo: 'WHISPER : CPU',
    result: { language: 'en' },
    transcription: segments.map((tokens) => ({
      offsets: { from: tokens[0]?.from ?? 0, to: tokens.at(-1)?.to ?? 0 },
      text: tokens.map((t) => t.text).join(''),
      tokens: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 }, id: 50363, p: 0.8, t_dtw: -1 },
        ...tokens.map((t, i) => ({
          text: t.text,
          timestamps: { from: '', to: '' },
          offsets: { from: t.from, to: t.to },
          id: 1000 + i,
          p: 0.9,
          t_dtw: t.dtw ?? -1
        })),
        { text: '[_TT_400]', offsets: { from: 8000, to: 8000 }, id: 50763, p: 0.9, t_dtw: -1 }
      ]
    }))
  })
  return Buffer.from(json, 'utf8').toString('latin1')
}

describe('reading what whisper heard', () => {
  it('joins tokens into words: a token starting with a space starts one, and punctuation stays with its word', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' I', from: 20, to: 80, dtw: 170 },
          { text: "'ve", from: 80, to: 330, dtw: 176 },
          { text: ' been', from: 330, to: 670, dtw: 186 },
          { text: ' meaning', from: 670, to: 1260, dtw: 202 },
          { text: '.', from: 1260, to: 1270, dtw: 230 }
        ]
      ])
    )
    expect(words.map((w) => w.text)).toEqual(["I've", 'been', 'meaning.'])
  })

  it('leaves out the special tokens: the segment start, the timestamps and the end of text', () => {
    const words = readWhisperJson(whisperFile([[{ text: ' Hello', from: 0, to: 400, dtw: 10 }], [{ text: ' <|endoftext|>', from: 400, to: 400 }, { text: ' there', from: 500, to: 800, dtw: 50 }]]))
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there'])
  })

  it('takes a word from where DTW hears it start, less how late DTW is measured to run', () => {
    const [first, second] = readWhisperJson(
      whisperFile([
        [
          { text: ' I', from: 20, to: 80, dtw: 170 },
          { text: "'ve", from: 80, to: 330, dtw: 176 },
          { text: ' been', from: 330, to: 670, dtw: 186 }
        ]
      ])
    )
    // DTW says 1.70 and 1.86; it runs `DTW_LATE_SEC` late, so the words are
    // where it heard them less that. The token timestamps, 0.02 and 0.08, are
    // not used: they put the first word of a file at the start of the file
    // however much silence comes first.
    expect(first!.startSec).toBeCloseTo(1.7 - DTW_LATE_SEC)
    expect(second!.startSec).toBeCloseTo(1.86 - DTW_LATE_SEC)
  })

  it('falls back to the token timestamps when there is no DTW time', () => {
    const [w] = readWhisperJson(whisperFile([[{ text: ' Hi', from: 500, to: 800 }]]))
    expect(w!.startSec).toBeCloseTo(0.5)
    expect(w!.endSec).toBeCloseTo(0.8)
  })

  it('ends a word when the next begins, or after about as long as the tokens say it lasted, whichever is first', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' better', from: 5380, to: 7440, dtw: 562 },
          { text: ' way', from: 7440, to: 7600, dtw: 620 },
          { text: ' now', from: 7600, to: 7900, dtw: 900 }
        ]
      ])
    )
    // Better runs on to where way starts; way is said for its 160 ms and then
    // a pause. Every time moves back by the same lateness, so what each word
    // is given to be said over is unchanged.
    expect(words[0]!.endSec).toBeCloseTo(6.2 - DTW_LATE_SEC)
    expect(words[1]!.endSec).toBeCloseTo(6.36 - DTW_LATE_SEC)
    expect(words[2]!.endSec).toBeCloseTo(9.3 - DTW_LATE_SEC)
  })

  it('never lets a word last more than a second, however long its tokens claim', () => {
    const [w] = readWhisperJson(whisperFile([[{ text: ' software', from: 11040, to: 14600, dtw: 1152 }]]))
    expect(w!.endSec - w!.startSec).toBeCloseTo(1)
  })

  it('puts a character split across two tokens back together', () => {
    // A curly apostrophe is three bytes, and whisper can put them in two tokens.
    const apostrophe = Buffer.from('’', 'utf8')
    const json = whisperFile([[{ text: ' don', from: 0, to: 200, dtw: 0 }, { text: 'SPLIT', from: 200, to: 250, dtw: 20 }, { text: 't', from: 250, to: 300, dtw: 25 }]])
    const bytes = json.replace(
      '"text":"SPLIT"',
      `"text":"${apostrophe.subarray(0, 2).toString('latin1')}","offsets":{"from":200,"to":220},"id":7,"p":1,"t_dtw":-1},{"text":"${apostrophe.subarray(2).toString('latin1')}"`
    )
    expect(readWhisperJson(bytes).map((w) => w.text)).toEqual(['don’t'])
  })

  it('drops what is in brackets, such as [Music] or (laughs), even across words', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' [', from: 0, to: 100, dtw: 0 },
          { text: 'Music', from: 100, to: 200, dtw: 10 },
          { text: ']', from: 200, to: 300, dtw: 20 },
          { text: ' So', from: 300, to: 500, dtw: 30 },
          { text: ' (', from: 500, to: 600, dtw: 50 },
          { text: 'laughs', from: 600, to: 700, dtw: 60 },
          { text: ' loudly', from: 700, to: 800, dtw: 70 },
          { text: ')', from: 800, to: 900, dtw: 80 },
          { text: ' yes', from: 900, to: 1100, dtw: 90 }
        ]
      ])
    )
    expect(words.map((w) => w.text)).toEqual(['So', 'yes'])
  })

  /*
    Found on the owner's own gaming clips: whisper heard a whole sentence over
    the game sound and wrote it as one sound event, and every word of it was
    thrown away, so the sequence got no captions at all.
  */
  it('keeps a whole sentence whisper put in brackets, which is speech it was unsure of', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' [', from: 10, to: 50, dtw: 19 },
          { text: 'I', from: 60, to: 120, dtw: 19 },
          { text: "'m", from: 120, to: 250, dtw: 19 },
          { text: ' not', from: 260, to: 450, dtw: 26 },
          { text: ' sure', from: 450, to: 720, dtw: 45 },
          { text: ' what', from: 720, to: 990, dtw: 72 },
          { text: ' he', from: 990, to: 1120, dtw: 99 },
          { text: "'s", from: 1120, to: 1250, dtw: 112 },
          { text: ' doing', from: 1250, to: 1590, dtw: 125 },
          { text: ' here', from: 1590, to: 1860, dtw: 159 },
          { text: ']', from: 1860, to: 2000, dtw: 186 }
        ]
      ])
    )
    // The brackets come off: they were whisper's doubt, not something said.
    expect(words.map((w) => w.text)).toEqual(["I'm", 'not', 'sure', 'what', "he's", 'doing', 'here'])
  })

  it('puts punctuation said on its own onto the word before it, and drops a lone dash', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' Wait', from: 0, to: 300, dtw: 0 },
          { text: ' ...', from: 300, to: 400, dtw: 30 },
          { text: ' -', from: 400, to: 450, dtw: 40 },
          { text: ' what', from: 450, to: 700, dtw: 45 }
        ]
      ])
    )
    expect(words.map((w) => w.text)).toEqual(['Wait...', 'what'])
  })

  it('ends a bracket whisper left open with its segment, rather than dropping every word after it', () => {
    const words = readWhisperJson(
      whisperFile([
        [
          { text: ' So', from: 0, to: 200, dtw: 0 },
          { text: ' (', from: 200, to: 300, dtw: 20 },
          { text: 'laughs', from: 300, to: 500, dtw: 30 }
        ],
        [
          { text: ' anyway', from: 1000, to: 1300, dtw: 100 },
          { text: ' here', from: 1300, to: 1500, dtw: 130 },
          { text: ' we', from: 1500, to: 1600, dtw: 150 },
          { text: ' go', from: 1600, to: 1800, dtw: 160 },
          { text: '.', from: 1800, to: 1810, dtw: 180 }
        ]
      ])
    )
    expect(words.map((w) => w.text)).toEqual(['So', 'anyway', 'here', 'we', 'go.'])
  })

  it("starts a word at a segment's first token, even one with no space before it", () => {
    const words = readWhisperJson(whisperFile([[{ text: ' Right', from: 0, to: 300, dtw: 0 }], [{ text: '"Next', from: 500, to: 800, dtw: 50 }]]))
    expect(words.map((w) => w.text)).toEqual(['Right', '"Next'])
  })

  it('refuses a file that is not whisper output', () => {
    expect(() => readWhisperJson('{"nothing": true}')).toThrow(/speech engine/)
    expect(() => readWhisperJson('not json')).toThrow(/speech engine/)
  })
})

describe('what whisper-cli really writes', () => {
  // Thirty seconds of an OBS recording of the owner's, heard by the pinned
  // engine and model with the app's own arguments: two segments, special
  // tokens between them, a word in two tokens and a full stop in one.
  const words = readWhisperJson(readFileSync(join(process.cwd(), 'test', 'fixtures', 'whisper-real.json')).toString('latin1'))

  it('reads every word, in order, across both segments', () => {
    expect(words.map((w) => w.text).join(' ')).toBe(
      "I've been meaning to start this journey for a very long time and what better way to start your YouTube journey if not creating your own video editing software."
    )
  })

  it('starts the first word where the talking starts, rather than at the segment start its tokens claim', () => {
    // Its tokens claim 0.02 s, which is the start of the file. DTW hears it at
    // 1.70 and runs late, so the word is a little before that, and nowhere
    // near the beginning.
    expect(words[0]!.startSec).toBeCloseTo(1.7 - DTW_LATE_SEC, 1)
  })

  it('has every word end by the time the next begins', () => {
    for (const [i, w] of words.entries()) {
      expect(w.endSec).toBeGreaterThan(w.startSec)
      if (i > 0) expect(w.startSec).toBeGreaterThanOrEqual(words[i - 1]!.endSec)
    }
  })
})

describe('words in frames', () => {
  it('rounds each word to frames of the sequence, at least one frame long, never overlapping the one before', () => {
    const frames = wordsToFrames(
      [
        { text: 'a', startSec: 1.0, endSec: 1.01 },
        { text: 'b', startSec: 1.0, endSec: 1.5 },
        { text: 'c', startSec: 2.0, endSec: 2.4 }
      ],
      30
    )
    expect(frames).toEqual([
      { text: 'a', start: 30, length: 1 },
      { text: 'b', start: 31, length: 14 },
      { text: 'c', start: 60, length: 12 }
    ])
  })
})

/** Words one after another at a steady pace: each `length` frames long with `gap` frames between. */
function spoken(texts: string[], opts: { from?: number; length?: number; gap?: number } = {}): TimedWord[] {
  const length = opts.length ?? 10
  const gap = opts.gap ?? 2
  return texts.map((text, i) => ({ text, start: (opts.from ?? 0) + i * (length + gap), length }))
}

let n = 0
const ids = (): string => `c${++n}`

function texts(clips: CaptionClip[]): string[] {
  return clips.map((c) => c.words.map((w) => w.text).join(' '))
}

describe('grouping words into captions', () => {
  it('puts three words in a caption by default', () => {
    const clips = groupWords(spoken(['one', 'two', 'three', 'four', 'five']), DEFAULT_CAPTION_STYLE, 30, ids)
    expect(texts(clips)).toEqual(['one two three', 'four five'])
  })

  it('starts a new caption after a word that ends a sentence', () => {
    const clips = groupWords(spoken(['Stop.', 'Go', 'on', 'now']), DEFAULT_CAPTION_STYLE, 30, ids)
    expect(texts(clips)).toEqual(['Stop.', 'Go on now'])
  })

  it('starts a new caption before a pause of more than 0.4 seconds', () => {
    const words = [...spoken(['one', 'two']), ...spoken(['three'], { from: 22 + 13 })]
    expect(texts(groupWords(words, DEFAULT_CAPTION_STYLE, 30, ids))).toEqual(['one two', 'three'])
    // 12 frames at 30 fps is 0.4 s exactly, which is not more.
    const close = [...spoken(['one', 'two']), ...spoken(['three'], { from: 22 + 12 })]
    expect(texts(groupWords(close, DEFAULT_CAPTION_STYLE, 30, ids))).toEqual(['one two three'])
  })

  it('starts a new caption rather than run past 18 characters, but a longer word still has one to itself', () => {
    const clips = groupWords(spoken(['absolutely', 'fantastic', 'extraordinarily-long', 'yes']), DEFAULT_CAPTION_STYLE, 30, ids)
    expect(texts(clips)).toEqual(['absolutely', 'fantastic', 'extraordinarily-long', 'yes'])
  })

  // Bugs and notes 2, note 19.
  it('holds as many words as asked for when the speech allows, with room for about six letters a word', () => {
    const said = spoken(['you', 'can', 'just', 'drag', 'them', 'here', 'and', 'then', 'let', 'go'])
    const at = (n: number): string[] => texts(groupWords(said, { ...DEFAULT_CAPTION_STYLE, wordsPerCaption: n }, 30, ids))
    // At five, five a caption; at three, back to three at most.
    expect(at(5)).toEqual(['you can just drag them', 'here and then let go'])
    expect(at(3).every((t) => t.split(' ').length <= 3)).toBe(true)
    expect(at(3).length).toBeGreaterThan(at(5).length)
    // Four is in between.
    expect(at(4).every((t) => t.split(' ').length <= 4)).toBe(true)
    expect(at(4).some((t) => t.split(' ').length === 4)).toBe(true)
  })

  it('still breaks at the end of a sentence at five words', () => {
    const clips = groupWords(spoken(['Stop.', 'Go', 'on', 'now', 'please', 'friend']), { ...DEFAULT_CAPTION_STYLE, wordsPerCaption: 5 }, 30, ids)
    expect(texts(clips)).toEqual(['Stop.', 'Go on now please friend'])
  })

  it('makes one word a caption when asked for one at a time', () => {
    const clips = groupWords(spoken(['one', 'two', 'three']), { ...DEFAULT_CAPTION_STYLE, wordsPerCaption: 1 }, 30, ids)
    expect(texts(clips)).toEqual(['one', 'two', 'three'])
  })

  it('lasts from its first word to its last, each word timed from the caption start', () => {
    const [first] = groupWords(spoken(['one', 'two', 'three'], { from: 100 }), DEFAULT_CAPTION_STYLE, 30, ids)
    expect(first).toMatchObject({ timelineStart: 100, length: 34 })
    expect(first!.words).toEqual([
      { text: 'one', start: 0, length: 10 },
      { text: 'two', start: 12, length: 10 },
      { text: 'three', start: 24, length: 10 }
    ])
  })

  it('runs on to the next caption when the gap to it is under a quarter of a second, so they do not flicker', () => {
    // A full stop ends the first, so the two are captions of their own whatever the count.
    const words = [...spoken(['one', 'two', 'three.']), ...spoken(['four'], { from: 34 + 7 })]
    const [first, second] = groupWords(words, DEFAULT_CAPTION_STYLE, 30, ids)
    expect(first!.timelineStart + first!.length).toBe(second!.timelineStart)
    // 8 frames is more than 0.25 s at 30 fps: the gap stays.
    const apart = [...spoken(['one', 'two', 'three.']), ...spoken(['four'], { from: 34 + 8 })]
    const [a] = groupWords(apart, DEFAULT_CAPTION_STYLE, 30, ids)
    expect(a!.length).toBe(34)
  })

  it('groups the same words again the same way from the captions it made', () => {
    const words = spoken(['one', 'two', 'three', 'four', 'five'])
    const clips = groupWords(words, DEFAULT_CAPTION_STYLE, 30, ids)
    expect(wordsOf(clips)).toEqual(words)
    const again = groupWords(wordsOf(clips), { ...DEFAULT_CAPTION_STYLE, wordsPerCaption: 2 }, 30, ids)
    expect(wordsOf(again)).toEqual(words)
    // Five words two at a time cannot help leaving one alone; the rest are pairs.
    expect(texts(again)).toEqual(['one two', 'three', 'four five'])
  })
})

/** Two captions: "one two three" over frames 0 to 34, and "four five" over 60 to 82. */
function twoCaptions(): CaptionClip[] {
  return groupWords([...spoken(['one', 'two', 'three']), ...spoken(['four', 'five'], { from: 60 })], DEFAULT_CAPTION_STYLE, 30, ids)
}

/** One caption, "one two three", at 100: each word 10 frames with 2 between, 34 frames long. */
function three(): CaptionClip {
  return groupWords(spoken(['one', 'two', 'three'], { from: 100 }), DEFAULT_CAPTION_STYLE, 30, ids)[0]!
}

describe('where a caption breaks inside a sentence', () => {
  const group = (said: string, per = 3): string[] => texts(groupWords(spoken(said.split(' ')), { ...DEFAULT_CAPTION_STYLE, wordsPerCaption: per }, 30, ids))

  it('shares a sentence out evenly rather than leave its last word alone', () => {
    // Filled to the count, this was 3, 3 and 1: "ECHO." on its own.
    expect(group('we are going to fix it right now.')).toEqual(['we are going', 'to fix it', 'right now.'])
    expect(group('you picked an upgrade good work echo.')).not.toContain('echo.')
  })

  it('breaks at a comma rather than wherever the count runs out', () => {
    expect(group('yes, it works now')).toEqual(['yes,', 'it works now'])
  })

  it('starts a caption on "and" or "because" rather than ending one there', () => {
    expect(group('it broke and we left')).toEqual(['it broke', 'and we left'])
    expect(group('we stopped because it rained')).toEqual(['we stopped', 'because it rained'])
  })

  it('does not end a caption on "the", "a" or "to" when another break would do', () => {
    expect(group('take the bus home now')).toEqual(['take the bus', 'home now'])
    expect(group('we want to go home')).toEqual(['we want', 'to go home'])
  })

  it('still always breaks at a sentence end and at a pause, whatever reads better', () => {
    expect(group('Stop. And go')).toEqual(['Stop.', 'And go'])
    const paused = [...spoken(['one', 'two']), ...spoken(['three'], { from: 22 + 13 })]
    expect(texts(groupWords(paused, DEFAULT_CAPTION_STYLE, 30, ids))).toEqual(['one two', 'three'])
  })

  it('keeps to the count and the 18 characters however a sentence runs', () => {
    for (const p of group('this is a much longer sentence than any one caption could ever hold at once', 3)) {
      expect(p.split(' ').length).toBeLessThanOrEqual(3)
      expect(p.length).toBeLessThanOrEqual(18)
    }
  })
})

describe('the word being said', () => {
  it('is the last to have started, lit through the pause after it, and the first from the caption start', () => {
    const c = three()
    expect([100, 109, 111, 112, 123, 124, 133].map((f) => wordAt(c, f))).toEqual([0, 0, 0, 1, 1, 2, 2])
  })

  it('belongs to the caption on screen at a frame, if any', () => {
    const clips = twoCaptions()
    expect(captionAt(clips, 0)?.words[0]?.text).toBe('one')
    expect(captionAt(clips, 34)).toBeUndefined()
    expect(captionAt(clips, 81)?.words[0]?.text).toBe('four')
  })
})

describe('splitting a caption', () => {
  it('gives the words begun before the frame, whole, to the first piece and the rest to the second, the first running on to it', () => {
    // At 118, part way through "two".
    const [a, b] = splitCaption(three(), 118, ids)!
    expect(a).toMatchObject({ timelineStart: 100, length: 24 })
    expect(a.words).toEqual([
      { text: 'one', start: 0, length: 10 },
      { text: 'two', start: 12, length: 10 }
    ])
    expect(b).toMatchObject({ timelineStart: 124, length: 10 })
    expect(b.words).toEqual([{ text: 'three', start: 0, length: 10 }])
    expect(b.id).not.toBe(a.id)
    // Nothing flickers off between them.
    expect(a.timelineStart + a.length).toBe(b.timelineStart)
  })

  it('does nothing at its edges, outside it, or where a piece would have no words', () => {
    const c = three()
    expect(splitCaption(c, 100, ids)).toBeNull()
    expect(splitCaption(c, 134, ids)).toBeNull()
    expect(splitCaption(c, 50, ids)).toBeNull()
    // Inside "three", the last word: nothing is said after it.
    expect(splitCaption(c, 130, ids)).toBeNull()
  })
})

describe('typing a caption\'s words', () => {
  it('keeps the timing of a word changed', () => {
    const c = editCaptionWords(three(), 'one too three')!
    expect(c.words).toEqual([
      { text: 'one', start: 0, length: 10 },
      { text: 'too', start: 12, length: 10 },
      { text: 'three', start: 24, length: 10 }
    ])
  })

  it('shares the time of the word a new one was typed beside', () => {
    const c = editCaptionWords(three(), 'one two and three')!
    expect(c.words.map((w) => w.text)).toEqual(['one', 'two', 'and', 'three'])
    // "two" was 12 to 22: it and "and" have 5 frames each of it.
    expect(c.words[1]).toEqual({ text: 'two', start: 12, length: 5 })
    expect(c.words[2]).toEqual({ text: 'and', start: 17, length: 5 })
    expect(c.words[3]).toEqual({ text: 'three', start: 24, length: 10 })
  })

  it('shares the first word\'s time with one typed before it', () => {
    const c = editCaptionWords(three(), 'so one two three')!
    expect(c.words.slice(0, 2)).toEqual([
      { text: 'so', start: 0, length: 5 },
      { text: 'one', start: 5, length: 5 }
    ])
  })

  it('gives the time of a word deleted to the words either side', () => {
    const c = editCaptionWords(three(), 'one three')!
    // "two" was 12 to 22: "one" runs on to 17, and "three" starts there.
    expect(c.words).toEqual([
      { text: 'one', start: 0, length: 17 },
      { text: 'three', start: 17, length: 17 }
    ])
  })

  it('shares the time of a word replaced between the words typed in its place', () => {
    const c = editCaptionWords(three(), 'one to the three')!
    expect(c.words.map((w) => w.text)).toEqual(['one', 'to', 'the', 'three'])
    // "two", 12 to 22, becomes "to the", 5 frames each.
    expect(c.words.slice(1, 3)).toEqual([
      { text: 'to', start: 12, length: 5 },
      { text: 'the', start: 17, length: 5 }
    ])
  })

  it('matches words whatever their case, and keeps the case typed', () => {
    const c = editCaptionWords(three(), 'One two Three')!
    expect(c.words.map((w) => [w.text, w.start])).toEqual([
      ['One', 0],
      ['two', 12],
      ['Three', 24]
    ])
  })

  it('leaves nothing of a caption with nothing typed', () => {
    expect(editCaptionWords(three(), '   ')).toBeNull()
  })
})

describe('trimming a caption', () => {
  it('stretches or squeezes its words, each keeping its share', () => {
    const c = retimeCaption(three(), 100, 17)
    expect(c).toMatchObject({ timelineStart: 100, length: 17 })
    expect(c.words.map((w) => [w.start, w.length])).toEqual([
      [0, 5],
      [6, 5],
      [12, 5]
    ])
  })

  it('keeps every word inside the caption, however unevenly they were spaced', () => {
    // "so" long, then "i" and "think" close together at its end.
    const c: CaptionClip = { id: 'c', timelineStart: 100, length: 30, words: [{ text: 'so', start: 0, length: 24 }, { text: 'i', start: 24, length: 3 }, { text: 'think', start: 27, length: 3 }] }
    const r = retimeCaption(c, 124, 6)
    expect(r.length).toBe(6)
    for (const w of r.words) expect(w.start + w.length).toBeLessThanOrEqual(6)
    expect(r.words.map((w) => w.start)).toEqual([0, 4, 5])
  })

  it('keeps at least a frame a word', () => {
    const c = retimeCaption(three(), 100, 1)
    expect(c.length).toBe(3)
    expect(c.words.map((w) => [w.start, w.length])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1]
    ])
  })
})

describe('how a caption looks, set by hand', () => {
  it('takes the default for any setting it cannot use, and keeps the rest', () => {
    expect(cleanCaptionStyle({ size: 0.1, height: 2, wordsPerCaption: 7, capitals: false, highlight: '#00ff88' })).toEqual({
      size: 0.1,
      height: DEFAULT_CAPTION_STYLE.height,
      across: DEFAULT_CAPTION_STYLE.across,
      wordsPerCaption: DEFAULT_CAPTION_STYLE.wordsPerCaption,
      capitals: false,
      highlight: '#00FF88',
      font: DEFAULT_CAPTION_STYLE.font,
      wordColour: DEFAULT_CAPTION_STYLE.wordColour,
      outline: DEFAULT_CAPTION_STYLE.outline,
      outlineColour: DEFAULT_CAPTION_STYLE.outlineColour,
      shadow: DEFAULT_CAPTION_STYLE.shadow,
      shadowColour: DEFAULT_CAPTION_STYLE.shadowColour,
      spacing: DEFAULT_CAPTION_STYLE.spacing,
      box: false,
      boxColour: DEFAULT_CAPTION_STYLE.boxColour,
      boxOpacity: DEFAULT_CAPTION_STYLE.boxOpacity,
      glow: 0,
      glowColour: DEFAULT_CAPTION_STYLE.glowColour,
      popGrow: false,
      popBox: false,
      popBoxColour: DEFAULT_CAPTION_STYLE.popBoxColour
    })
  })

  // Plan 76.
  it('keeps a font it has, colours and an outline, and forgets a font this build does not have', () => {
    const s = cleanCaptionStyle({ font: 'anton', wordColour: '#ff0000', outline: 0.12, outlineColour: '#0000ff' })
    expect(s).toMatchObject({ font: 'anton', wordColour: '#FF0000', outline: 0.12, outlineColour: '#0000FF' })
    expect(cleanCaptionStyle({ font: 'comic-sans', outline: -1, wordColour: 'red' })).toMatchObject({
      font: DEFAULT_CAPTION_STYLE.font,
      outline: DEFAULT_CAPTION_STYLE.outline,
      wordColour: DEFAULT_CAPTION_STYLE.wordColour
    })
    // A caption file from before plan 76 looks exactly as it did.
    expect(cleanCaptionStyle({})).toEqual(DEFAULT_CAPTION_STYLE)
  })
})

describe('a caption in another font (plan 76)', () => {
  const said: CaptionClip = { id: 'c', timelineStart: 0, length: 30, words: ['WHAT', 'A', 'SHOT'].map((text, i) => ({ text, start: i * 10, length: 10 })) }
  it('is measured in that font: narrower in a narrow one, wider in a wide one', () => {
    // One word, so no font breaks it onto a second line.
    const shot: CaptionClip = { ...said, words: [{ text: 'SHOT', start: 0, length: 30 }] }
    const width = (font: string): number => layoutCaption(shot, { ...DEFAULT_CAPTION_STYLE, font }, 1080, 1920).width
    expect(width('anton')).toBeLessThan(width('montserrat'))
    expect(width('bebas')).toBeLessThan(width('anton'))
  })

  it('writes its font, its colours and its outline into the subtitle file', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, font: 'poppins', wordColour: '#11AA33', outline: 0.12, outlineColour: '#2244FF' }
    const ass = captionsAss({ clips: [said], style, from: 0, to: 30, fps: 30, width: 1080, height: 1920 })!
    const line = ass.split('\n').find((l) => l.startsWith('Style: Caption,'))!
    expect(line).toContain('Style: Caption,Poppins Black,')
    // Colours as ASS writes them: blue, green, red.
    expect(line).toContain('&H0033AA11')
    expect(line).toContain('&H00FF4422')
    // The word after the lit one goes back to the words' colour, not white.
    expect(ass).toContain('{\\c&H33AA11&}')
  })
})

describe('a caption put somewhere by hand', () => {
  function of(...texts: string[]): CaptionClip {
    return { id: 'c', timelineStart: 0, length: texts.length * 10, words: texts.map((text, i) => ({ text, start: i * 10, length: 10 })) }
  }

  it("is laid out round its own middle rather than the style's", () => {
    const layout = layoutCaption({ ...of('hi'), at: { x: 0.25, y: 0.2 } }, DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(layout.centerX).toBe(270)
    expect(layout.middle).toBeCloseTo(384)
    // One that follows the style still goes where the style puts it.
    expect(layoutCaption(of('hi'), DEFAULT_CAPTION_STYLE, 1080, 1920).centerX).toBe(540)
  })

  it('follows the style across as well as down, once Relocate has moved it', () => {
    const layout = layoutCaption(of('hi'), { ...DEFAULT_CAPTION_STYLE, across: 0.3 }, 1080, 1920)
    expect(layout.centerX).toBeCloseTo(324)
  })

  it('has a box round its words, centred on its middle, as wide as its widest line', () => {
    const layout = layoutCaption(of('hi'), DEFAULT_CAPTION_STYLE, 1080, 1920)
    const box = captionBox(layout)
    expect(box.x + box.w / 2).toBeCloseTo(540)
    expect(box.y + box.h / 2).toBeCloseTo(layout.middle)
    expect(box.w).toBeCloseTo(textWidth('HI') * layout.fontPx)
  })

  it('is written into the subtitle file where the preview draws it', () => {
    const clips = [{ ...of('hi'), at: { x: 0.25, y: 0.2 } }]
    const ass = captionsAss({ clips, style: DEFAULT_CAPTION_STYLE, from: 0, to: 10, fps: 30, width: 1080, height: 1920 })!
    expect(ass).toMatch(/\\pos\(270,/)
  })

  it('keeps a position inside the frame, and refuses what is not one', () => {
    expect(cleanCaptionAt({ x: 1.4, y: -0.2 })).toEqual({ x: 1, y: 0 })
    expect(cleanCaptionAt({ x: 'left', y: 0.2 })).toBeNull()
    expect(cleanCaptionAt(null)).toBeNull()
  })
})

describe('where a caption goes in the frame', () => {
  /** A caption of these words, a few frames each. */
  function of(...texts: string[]): CaptionClip {
    return { id: 'c', timelineStart: 0, length: texts.length * 10, words: texts.map((text, i) => ({ text, start: i * 10, length: 10 })) }
  }

  it('is 7% of the frame tall, 134 pixels in a vertical one, its capitals centred 65% of the way down', () => {
    const layout = layoutCaption(of('hi'), DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(layout.fontPx).toBeCloseTo(134.4)
    expect(layout.centerX).toBe(540)
    expect(layout.lines).toHaveLength(1)
    // The middle of a capital, 0.35 of the letters' size above the baseline, is at 1248.
    expect(layout.lines[0]!.baseline - 0.35 * layout.fontPx).toBeCloseTo(1248)
  })

  it('breaks words that would not fit across nine tenths of the frame onto lines, the lines centred together', () => {
    // HELLO THERE is 7.36 of the letters' size wide: 989 pixels, more than 972.
    expect(textWidth('HELLO THERE')).toBeCloseTo(7.36, 2)
    const layout = layoutCaption(of('hello', 'there'), DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(layout.lines.map((l) => l.words)).toEqual([[0], [1]])
    const [a, b] = layout.lines.map((l) => l.baseline - 0.35 * layout.fontPx)
    expect((a! + b!) / 2).toBeCloseTo(1248)
    expect(b! - a!).toBeCloseTo(1.15 * layout.fontPx)
  })

  it('makes a caption smaller when a word is too long for a line on its own, so it stays in the frame', () => {
    // UNFORTUNATELY at 134.4 pixels is 1269 pixels, far more than 972.
    const layout = layoutCaption(of('unfortunately'), DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(textWidth('UNFORTUNATELY') * layout.fontPx).toBeCloseTo(972)
    expect(layout.outlinePx).toBeCloseTo(0.08 * layout.fontPx)
    expect(layoutCaption(of('hi'), DEFAULT_CAPTION_STYLE, 1080, 1920).fontPx).toBeCloseTo(134.4)
  })

  it('keeps them on one line in a wide frame, where they fit', () => {
    expect(layoutCaption(of('hello', 'there'), DEFAULT_CAPTION_STYLE, 1920, 1080).lines.map((l) => l.words)).toEqual([[0, 1]])
  })

  it('measures the words as they are written, smaller without capitals', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, capitals: false }
    expect(layoutCaption(of('hello', 'there'), style, 1080, 1920).lines.map((l) => l.words)).toEqual([[0, 1]])
  })
})

describe('the captions as ffmpeg burns them in', () => {
  /** "one two" over 30 to 50, "two" said from 40. */
  const clip: CaptionClip = { id: 'c', timelineStart: 30, length: 20, words: [{ text: 'one', start: 0, length: 10 }, { text: 'two', start: 10, length: 10 }] }
  const ass = (from: number, to: number, clips = [clip]): string | null =>
    captionsAss({ clips, style: DEFAULT_CAPTION_STYLE, from, to, fps: 30, width: 1080, height: 1920 })
  const events = (text: string | null): string[] => (text ?? '').split('\n').filter((l) => l.startsWith('Dialogue:'))

  it('sizes the font as libass does, by the font\'s own ascent and descent, with the outline as the preview draws it', () => {
    const style = (ass(0, 100) ?? '').split('\n').find((l) => l.startsWith('Style:'))
    // 134.4 pixels to the em is 209.93 to libass; the outline is 0.08 of the em.
    expect(style).toBe('Style: Caption,Montserrat ExtraBold,209.93,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,10.75,0,2,0,0,0,1')
    expect(ass(0, 100)).toContain('PlayResX: 1080')
    expect(ass(0, 100)).toContain('PlayResY: 1920')
  })

  it('writes one event for each word while it is said, the whole caption with that word in the highlight colour', () => {
    const layout = layoutCaption(clip, DEFAULT_CAPTION_STYLE, 1080, 1920)
    const y = Math.round((layout.lines[0]!.baseline + 0.453 * layout.fontPx) * 10) / 10
    // Each starts and ends half way between frames: 29.5 and 39.5 frames in, and so on.
    expect(events(ass(0, 100))).toEqual([
      `Dialogue: 0,0:00:00.98,0:00:01.32,Caption,,0,0,0,,{\\an2\\pos(540,${y})}{\\c&H00D4FF&}ONE{\\c&HFFFFFF&} TWO`,
      `Dialogue: 0,0:00:01.32,0:00:01.65,Caption,,0,0,0,,{\\an2\\pos(540,${y})}ONE {\\c&H00D4FF&}TWO{\\c&HFFFFFF&}`
    ])
  })

  it('counts the times from the segment\'s start, and writes only the part of a caption over it', () => {
    // A segment from 35 to 45: "one" from its start until 40, "two" from 40 to its end.
    expect(events(ass(35, 45)).map((e) => e.split(',').slice(1, 3).join(' to '))).toEqual(['0:00:00.00 to 0:00:00.15', '0:00:00.15 to 0:00:00.32'])
  })

  it('writes a line of its own for each line of a caption, placed as the preview places it', () => {
    const long: CaptionClip = { ...clip, words: [{ text: 'hello', start: 0, length: 10 }, { text: 'there', start: 10, length: 10 }] }
    const layout = layoutCaption(long, DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(layout.lines).toHaveLength(2)
    const lines = events(ass(0, 100, [long])).slice(0, 2)
    expect(lines.map((l) => l.replace(/^.*\\pos\(540,([\d.]+)\)\}/, '$1 '))).toEqual([
      `${Math.round((layout.lines[0]!.baseline + 0.453 * layout.fontPx) * 10) / 10} {\\c&H00D4FF&}HELLO{\\c&HFFFFFF&}`,
      `${Math.round((layout.lines[1]!.baseline + 0.453 * layout.fontPx) * 10) / 10} THERE`
    ])
  })

  it('kerns the letters, as the preview does, which libass does only when asked', () => {
    expect((ass(0, 100) ?? '').split(/\r?\n/)).toContain('Kerning: yes')
  })

  it('gives a caption the layout made smaller, for a word too long for a line, its own size and outline', () => {
    const long: CaptionClip = { ...clip, words: [{ text: 'unfortunately', start: 0, length: 20 }] }
    const layout = layoutCaption(long, DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(layout.fontPx).toBeLessThan(134.4)
    const size = Math.round(layout.fontPx * 1.562 * 100) / 100
    const outline = Math.round(layout.outlinePx * 100) / 100
    expect(events(ass(0, 100, [long]))[0]).toContain(`\\fs${size}\\bord${outline}}`)
    // One at its asked size needs none.
    expect(events(ass(0, 100))[0]).not.toContain('\\fs')
  })

  it('writes nothing for a stretch with no caption over it', () => {
    expect(ass(50, 100)).toBeNull()
    expect(ass(0, 30)).toBeNull()
  })

  it('keeps what the subtitle format takes as its own commands out of the words', () => {
    const odd: CaptionClip = { ...clip, words: [{ text: 'a{b}\\c', start: 0, length: 20 }] }
    expect(events(ass(0, 100, [odd]))[0]).toMatch(/\}ABC\{/)
  })

  it('keeps a word to its own line of the file, whatever line breaks a project gives it', () => {
    // A word ending one line and starting another could add sections of its own, a font among them.
    const odd: CaptionClip = { ...clip, words: [{ text: 'a\r\n[Fonts]\nfontname: x.ttf', start: 0, length: 20 }] }
    const lines = (ass(0, 100, [odd]) ?? '').split(/\r?\n|\r/)
    const after = lines.slice(lines.findIndex((l) => l.startsWith('Format: Layer')) + 1).filter((l) => l !== '')
    expect(after).toHaveLength(1)
    expect(after[0]).toMatch(/^Dialogue:.*A \[FONTS\] FONTNAME: X\.TTF/)
  })
})

describe('captions as a subtitle file', () => {
  const caption = (id: string, timelineStart: number, length: number, text: string): CaptionClip => ({
    id,
    timelineStart,
    length,
    words: text.split(' ').map((w, i) => ({ text: w, start: i * 5, length: 5 }))
  })

  it('numbers each caption and times it from the start of the export, in SRT', () => {
    const clips = [caption('a', 30, 45, 'hello there'), caption('b', 90, 30, 'General Kenobi')]
    expect(captionsSrt({ clips, from: 0, to: 300, fps: 30 })).toBe(
      ['1', '00:00:01,000 --> 00:00:02,500', 'hello there', '', '2', '00:00:03,000 --> 00:00:04,000', 'General Kenobi', ''].join('\n')
    )
  })

  it('writes the words as typed, not in the capitals a style draws them in', () => {
    const srt = captionsSrt({ clips: [caption('a', 0, 30, 'Mixed case')], from: 0, to: 30, fps: 30 })!
    expect(srt).toContain('\nMixed case\n')
  })

  it('counts from the start of a range, and cuts a caption to its edges', () => {
    const clips = [caption('a', 0, 60, 'cut short'), caption('b', 60, 30, 'inside'), caption('c', 200, 30, 'after')]
    expect(captionsSrt({ clips, from: 45, to: 120, fps: 30 })).toBe(
      ['1', '00:00:00,000 --> 00:00:00,500', 'cut short', '', '2', '00:00:00,500 --> 00:00:01,500', 'inside', ''].join('\n')
    )
  })

  it('runs past an hour, and gives nothing when no caption is over the stretch', () => {
    const late = caption('a', 30 * 3725, 15, 'late')
    expect(captionsSrt({ clips: [late], from: 0, to: 30 * 4000, fps: 30 })).toContain('01:02:05,000 --> 01:02:05,500')
    expect(captionsSrt({ clips: [late], from: 0, to: 300, fps: 30 })).toBeNull()
    expect(captionsSrt({ clips: [{ ...late, words: [] }], from: 0, to: 30 * 4000, fps: 30 })).toBeNull()
  })
})

describe('captions as a transcript', () => {
  /** Words five frames long, one after another from `timelineStart`. */
  const caption = (id: string, timelineStart: number, text: string): CaptionClip => {
    const words = text.split(' ')
    return { id, timelineStart, length: words.length * 5, words: words.map((w, i) => ({ text: w, start: i * 5, length: 5 })) }
  }

  it('runs the words of every caption on as one text, as typed, not in caption pieces', () => {
    const clips = [caption('b', 20, 'General Kenobi.'), caption('a', 0, 'Hello there.')]
    expect(captionsTranscript({ clips, from: 0, to: 300, fps: 30 })).toBe('Hello there. General Kenobi.\n')
  })

  it('starts a new paragraph at a long pause, not a short one', () => {
    const clips = [caption('a', 0, 'One two.'), caption('b', 10 + 30, 'Three.'), caption('c', 45 + 45, 'Four.')]
    expect(captionsTranscript({ clips, from: 0, to: 300, fps: 30 })).toBe('One two. Three.\n\nFour.\n')
  })

  it('ends a long paragraph at a sentence end even without a pause', () => {
    const long = Array.from({ length: 79 }, () => 'word').join(' ') + ' end, still going. Next'
    const text = captionsTranscript({ clips: [caption('a', 0, long)], from: 0, to: 1000, fps: 30 })!
    const paragraphs = text.trim().split('\n\n')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toMatch(/still going\.$/)
    expect(paragraphs[1]).toBe('Next')
  })

  it('keeps to the words said inside the stretch, and gives nothing when none is', () => {
    const clips = [caption('a', 0, 'before inside'), caption('b', 100, 'after')]
    expect(captionsTranscript({ clips, from: 5, to: 100, fps: 30 })).toBe('inside\n')
    expect(captionsTranscript({ clips, from: 200, to: 300, fps: 30 })).toBeNull()
    expect(captionsTranscript({ clips: [], from: 0, to: 300, fps: 30 })).toBeNull()
  })

  it('makes the same text of words heard, in any order, without captions', () => {
    const words = [{ text: 'there.', start: 5, length: 5 }, { text: 'Hello', start: 0, length: 5 }, { text: 'Later.', start: 100, length: 5 }]
    expect(transcriptOf(words, 0, 300, 30)).toBe('Hello there.\n\nLater.\n')
  })
})

describe('a shadow, letter spacing and a font from this PC (plan 87)', () => {
  const arialish = { family: 'Arial', capHeight: 0.716, assSizePerEm: 1.117, assDescent: 0.212, averageAdvance: 680, advance: { A: 667, B: 667, ' ': 278, I: 278 } }
  const clip = { id: 'c', timelineStart: 0, length: 30, words: [{ text: 'HI', start: 0, length: 30 }] }

  it('keeps them through a save, and leaves out what cannot be used', () => {
    const kept = cleanCaptionStyle({ ...DEFAULT_CAPTION_STYLE, pcFont: arialish, shadow: 0.08, shadowColour: '#ff0000', spacing: 0.05 })
    expect(kept.pcFont?.family).toBe('Arial')
    expect([kept.shadow, kept.shadowColour, kept.spacing]).toEqual([0.08, '#FF0000', 0.05])
    const damaged = cleanCaptionStyle({ ...DEFAULT_CAPTION_STYLE, pcFont: { family: 'X,Y' }, shadow: -1, spacing: 9 })
    expect(damaged.pcFont).toBeUndefined()
    expect(damaged.shadow).toBe(0)
    expect(damaged.spacing).toBe(0.5)
    // Back to the bundled font the style names.
    expect(cleanCaptionStyle({ ...kept, pcFont: null }).pcFont).toBeUndefined()
  })

  it('lays the words out wider by the spacing, after every letter', () => {
    const plain = layoutCaption(clip, DEFAULT_CAPTION_STYLE, 1080, 1920)
    const spaced = layoutCaption(clip, { ...DEFAULT_CAPTION_STYLE, spacing: 0.1 }, 1080, 1920)
    expect(spaced.width - plain.width).toBeCloseTo(2 * 0.1 * plain.fontPx, 6)
  })

  it('writes the font, the spacing and the shadow into the burned-in captions', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, pcFont: arialish, shadow: 0.1, shadowColour: '#00FF00', spacing: 0.05 }
    const ass = captionsAss({ clips: [clip], style, from: 0, to: 30, fps: 30, width: 1080, height: 1920 })!
    const line = ass.split('\n').find((l) => l.startsWith('Style: Caption,'))!
    const f = line.split(',')
    expect(f[1]).toBe('Arial')
    // BackColour is the shadow's, in alpha, blue, green, red.
    expect(f[6]).toBe('&H0000FF00')
    const base = DEFAULT_CAPTION_STYLE.size * 1920
    expect(Number(f[13])).toBeCloseTo(0.05 * base, 1)
    expect(Number(f[17])).toBeCloseTo(0.1 * base, 1)
  })
})
