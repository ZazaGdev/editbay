import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { runExport } from '../../src/main/render/runner'
import { planRender } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import { addClip, createTimeline, setCaptionStyle, setCaptions, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { layoutCaption, type CaptionStyleChange } from '../../src/shared/captions'
import { fontFor } from '../../src/main/fonts/system-fonts'
import { readFontFigures } from '../../src/shared/font-file'
import { CAPTION_FONTS, captionFont } from '../../src/shared/caption-fonts'
import { POP_GROW, captionDrawing } from '../../src/shared/caption-drawing'

/**
 * Captions burned into the export by ffmpeg's libass, in the bundled font,
 * read back from the pixels of the file: where they are, how big, and which
 * word is lit, against the layout the preview draws them by.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-captions-export-'))
const fontsDir = join(process.cwd(), 'resources', 'fonts')

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

/** Two seconds of solid red with a tone, so a caption's white and yellow can be told from it. */
let red = ''
beforeAll(async () => {
  red = await generate('red.mp4', [
    '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest'
  ])
})

async function generate(file: string, args: string[]): Promise<string> {
  const out = join(work, file)
  await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out])
  return out
}

function media(id: string, path: string, durationSec: number): ProjectMedia {
  return {
    id,
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 640,
    height: 360,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** The pixels of one frame of a video, by its number from 0, as RGB. */
async function frameAt(path: string, n: number, w: number, h: number): Promise<Buffer> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-i', path, '-vf', `select='eq(n,${n})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, 'pipe:1'
  ])
  return stdout
}

/** A sequence of one clip of red, two seconds long, with these words over it, exported as one video. */
async function exported(
  name: string,
  words: { text: string; start: number; length: number }[],
  style: CaptionStyleChange = {},
  pcFonts: string[] = []
): Promise<{ out: string; t: Timeline }> {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('red', red, 2)] }
  t = setCaptionStyle(setCaptions(addClip(t, 'red'), words, []), style)
  const scratch = join(work, `scratch-${name}`)
  const plan = planRender({
    timeline: t,
    names: { project: name, sequence: 'Vertical', joined: name },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: work,
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: 30, scratchDir: scratch, onProgress: () => undefined, fontsDir, pcFonts })
  expect(existsSync(scratch)).toBe(false)
  return { out: out!, t }
}

/** Where the caption's letters are in a frame: its white and its yellow, by their extent and middle. */
function letters(px: Buffer, w: number): { white: number; yellow: number; yellowX: number; top: number; bottom: number; left: number; right: number } {
  let white = 0
  let yellow = 0
  let sumX = 0
  let top = Infinity
  let bottom = -1
  let left = Infinity
  let right = -1
  for (let i = 0; i + 2 < px.length; i += 3) {
    const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!]
    const isWhite = r > 220 && g > 220 && b > 220
    const isYellow = r > 200 && g > 170 && b < 90
    if (!isWhite && !isYellow) continue
    const x = (i / 3) % w
    const y = Math.floor(i / 3 / w)
    if (isWhite) white++
    else {
      yellow++
      sumX += x
    }
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    left = Math.min(left, x)
    right = Math.max(right, x)
  }
  return { white, yellow, yellowX: yellow > 0 ? sumX / yellow : -1, top, bottom, left, right }
}

/** Where the pixels of one kind are in a frame: their extent, and how many. */
function extent(px: Buffer, w: number, is: (r: number, g: number, b: number) => boolean): { left: number; right: number; top: number; bottom: number; count: number } {
  let [left, right, top, bottom, count] = [Infinity, -1, Infinity, -1, 0]
  for (let i = 0; i + 2 < px.length; i += 3) {
    if (!is(px[i]!, px[i + 1]!, px[i + 2]!)) continue
    const x = (i / 3) % w
    const y = Math.floor(i / 3 / w)
    count++
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return { left, right, top, bottom, count }
}

describe('captions burned into the export', () => {
  it('are drawn in their own colours, as the preview draws them (audit 2026-10-01)', async () => {
    const { out } = await exported('caption-colours', [{ text: 'one', start: 0, length: 60 }])
    const px = await frameAt(out, 10, 1080, 1920)
    // The middle of the strokes: the commonest yellow, as the edges blend into the red.
    const counts = new Map<string, number>()
    for (let i = 0; i + 2 < px.length; i += 3) {
      const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!]
      if (r > 200 && g > 170 && b < 90) counts.set(`${r},${g},${b}`, (counts.get(`${r},${g},${b}`) ?? 0) + 1)
    }
    const [r, g, b] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]![0].split(',').map(Number)
    // #FFD400, as the preview's canvas draws it.
    expect(Math.abs(r! - 255)).toBeLessThanOrEqual(6)
    expect(Math.abs(g! - 212)).toBeLessThanOrEqual(6)
    expect(b!).toBeLessThanOrEqual(8)
  })

  it('are where the preview draws them, as big, and light each word on the frame it is said', async () => {
    // "ONE TWO" over the whole two seconds, "two" said from frame 30.
    const { out, t } = await exported('captions', [
      { text: 'one', start: 0, length: 30 },
      { text: 'two', start: 30, length: 30 }
    ])
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const line = layout.lines[0]!
    expect(layout.lines).toHaveLength(1)
    // The last frame of "one", and the first of "two", as the preview lights them.
    const first = letters(await frameAt(out, 29, 1080, 1920), 1080)
    // The capitals stand on the preview's baseline, as tall as the font's capitals at its size.
    expect(Math.abs(first.bottom - line.baseline)).toBeLessThan(4)
    expect(Math.abs(first.bottom - first.top - 0.7 * layout.fontPx)).toBeLessThan(6)
    // Centred in the frame.
    expect(Math.abs((first.left + first.right) / 2 - 540)).toBeLessThan(6)
    // ONE lit, on the left; TWO white, on the right.
    expect(first.yellow).toBeGreaterThan(500)
    expect(first.white).toBeGreaterThan(500)
    expect(first.yellowX).toBeLessThan(540)

    const second = letters(await frameAt(out, 30, 1080, 1920), 1080)
    expect(second.yellow).toBeGreaterThan(500)
    expect(second.yellowX).toBeGreaterThan(540)
    // Still there on the last frame, where the caption ends with the clip.
    expect(letters(await frameAt(out, 59, 1080, 1920), 1080).white).toBeGreaterThan(0)
  })

  // Plan 76: every bundled font is found by the export, not quietly swapped for another.
  for (const font of CAPTION_FONTS.filter((f) => f.id !== 'montserrat')) {
    it(`are burned in ${font.label}, as wide and as tall as the layout measures them`, async () => {
      const { out, t } = await exported(`font-${font.id}`, [{ text: 'shot', start: 0, length: 60 }], { font: font.id })
      const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
      const text = letters(await frameAt(out, 10, 1080, 1920), 1080)
      // Its capitals stand on the layout's baseline, as tall as this font's capitals, as wide as its widths say.
      expect(Math.abs(text.bottom - layout.lines[0]!.baseline)).toBeLessThan(6)
      expect(Math.abs(text.bottom - text.top - captionFont(font.id).capHeight * layout.fontPx)).toBeLessThan(8)
      expect(Math.abs(text.right - text.left - layout.width) / layout.width).toBeLessThan(0.06)
    })
  }

  it('are drawn in the words colour and outline chosen', async () => {
    // Green words, no outline: no white at all, and green where the words are.
    const { out } = await exported('coloured', [{ text: 'go', start: 0, length: 60 }], { wordColour: '#00FF00', outline: 0, highlight: '#00FF00' })
    const px = await frameAt(out, 10, 1080, 1920)
    let green = 0
    for (let i = 0; i + 2 < px.length; i += 3) if (px[i]! < 60 && px[i + 1]! > 200 && px[i + 2]! < 60) green++
    expect(green).toBeGreaterThan(500)
    expect(letters(px, 1080).white).toBe(0)
  })

  // Plan 87.
  it('are burned in a font from this PC, as wide and as tall as the layout measures them', async () => {
    const arial = (await fontFor('Arial'))!
    const { out, t } = await exported('pc-font', [{ text: 'shot', start: 0, length: 60 }], { pcFont: arial.figures }, [arial.path])
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const text = letters(await frameAt(out, 10, 1080, 1920), 1080)
    expect(Math.abs(text.bottom - layout.lines[0]!.baseline)).toBeLessThan(6)
    expect(Math.abs(text.bottom - text.top - arial.figures.capHeight * layout.fontPx)).toBeLessThan(8)
    expect(Math.abs(text.right - text.left - layout.width) / layout.width).toBeLessThan(0.06)
  })

  // Audit 2026-10-08: Cambria's regular face is only in a collection, cambria.ttc.
  it.runIf(existsSync('C:\\Windows\\Fonts\\cambria.ttc'))('are burned in the regular face of a font kept in a collection, not its bold file', async () => {
    const cambria = (await fontFor('Cambria'))!
    const { out, t } = await exported('pc-collection', [{ text: 'shot', start: 0, length: 60 }], { pcFont: cambria.figures }, [cambria.path])
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const bold = readFontFigures(new Uint8Array(await readFile('C:\\Windows\\Fonts\\cambriab.ttf')))!
    const boldLayout = layoutCaption(t.captions.clips[0]!, { ...t.captions.style, pcFont: bold }, 1080, 1920)
    const text = letters(await frameAt(out, 10, 1080, 1920), 1080)
    const width = text.right - text.left
    expect(Math.abs(width - layout.width)).toBeLessThan(Math.abs(width - boldLayout.width))
    expect(Math.abs(width - layout.width) / layout.width).toBeLessThan(0.06)
  })

  it('are spaced as the layout spaces them, and cast the shadow chosen down and to the right', async () => {
    const { out, t } = await exported('shadow', [{ text: 'shot', start: 0, length: 60 }], { spacing: 0.12, shadow: 0.14, shadowColour: '#00FF00', outline: 0 })
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const px = await frameAt(out, 10, 1080, 1920)
    const text = letters(px, 1080)
    // Wider by the spacing after each letter but the last, which adds room and no ink.
    const inked = layout.width - 0.12 * layout.fontPx
    expect(Math.abs(text.right - text.left - inked) / inked).toBeLessThan(0.06)
    // Green shadow, below and to the right of the letters.
    let green = 0
    let lowest = -1
    for (let i = 0; i + 2 < px.length; i += 3) {
      if (px[i]! < 60 && px[i + 1]! > 200 && px[i + 2]! < 60) {
        green++
        lowest = Math.max(lowest, Math.floor(i / 3 / 1080))
      }
    }
    expect(green).toBeGreaterThan(500)
    expect(lowest - text.bottom).toBeGreaterThan(0.14 * layout.fontPx * 0.7)
  })

  it('are kerned, as the preview draws them', async () => {
    // Kerned, WAY TO YOU is about 919 pixels wide at this size; without kerning, 938.
    const { out } = await exported('kerned', [
      { text: 'way', start: 0, length: 20 },
      { text: 'to', start: 20, length: 20 },
      { text: 'you', start: 40, length: 20 }
    ])
    const text = letters(await frameAt(out, 10, 1080, 1920), 1080)
    expect(text.right - text.left).toBeLessThan(928)
  })

  // Plan 99: what is drawn round the words, where the shared geometry the preview draws by puts it.
  it('draw the box behind the caption where the preview draws it', async () => {
    const { out, t } = await exported('box', [{ text: 'shot', start: 0, length: 60 }], { box: true, boxColour: '#0000FF', boxOpacity: 1 })
    const c = t.captions.clips[0]!
    const box = captionDrawing(c, t.captions.style, layoutCaption(c, t.captions.style, 1080, 1920), 0).box!
    const blue = extent(await frameAt(out, 10, 1080, 1920), 1080, (r, g, b) => r < 60 && g < 60 && b > 200)
    // The rounded corners are not blue, so the edges are read across the middle.
    expect(Math.abs(blue.left - box.x)).toBeLessThan(3)
    expect(Math.abs(blue.right + 1 - (box.x + box.w))).toBeLessThan(3)
    expect(Math.abs(blue.top - box.y)).toBeLessThan(3)
    expect(Math.abs(blue.bottom + 1 - (box.y + box.h))).toBeLessThan(3)
  })

  it('glow round the words in the glow colour, and not at all without one', async () => {
    const words = [{ text: 'hi', start: 0, length: 60 }]
    // Green over the red, from a fifth of the glow up, but never the white letters.
    const green = (r: number, g: number, b: number): boolean => g > 50 && g > b + 40
    const { out, t } = await exported('glow', words, { glow: 0.25, glowColour: '#00FF00', outline: 0, highlight: '#FFFFFF' })
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const px = await frameAt(out, 10, 1080, 1920)
    const text = letters(px, 1080)
    const glow = extent(px, 1080, green)
    // Round the letters on every side, reaching about as far as its blur: further than half of it, not twice it.
    const blur = 0.25 * layout.fontPx
    for (const reach of [text.left - glow.left, glow.right - text.right, text.top - glow.top, glow.bottom - text.bottom]) {
      expect(reach).toBeGreaterThan(blur / 2)
      expect(reach).toBeLessThan(2 * blur)
    }
    const plain = await exported('no-glow', words, { outline: 0, highlight: '#FFFFFF' })
    expect(extent(await frameAt(plain.out, 10, 1080, 1920), 1080, green).count).toBe(0)
  })

  it('grow the word being said from its baseline, each word where the preview puts it', async () => {
    const { out, t } = await exported('pop', [{ text: 'one', start: 0, length: 30 }, { text: 'two', start: 30, length: 30 }], { popGrow: true })
    const c = t.captions.clips[0]!
    const layout = layoutCaption(c, t.captions.style, 1080, 1920)
    const pieces = captionDrawing(c, t.captions.style, layout, 1).pieces!
    const px = await frameAt(out, 40, 1080, 1920)
    const lit = extent(px, 1080, (r, g, b) => r > 200 && g > 170 && b < 90)
    const plain = extent(px, 1080, (r, g, b) => r > 220 && g > 220 && b > 220)
    // TWO, lit, a quarter taller than ONE, both standing on the baseline.
    expect(Math.abs(lit.bottom - layout.lines[0]!.baseline)).toBeLessThan(5)
    expect(Math.abs(plain.bottom - layout.lines[0]!.baseline)).toBeLessThan(5)
    expect(Math.abs((lit.bottom - lit.top) / (plain.bottom - plain.top) - POP_GROW)).toBeLessThan(0.06)
    // Each word's ink starts just inside where it is placed.
    expect(Math.abs(plain.left - pieces[0]!.x)).toBeLessThan(0.08 * layout.fontPx)
    expect(Math.abs(lit.left - pieces[1]!.x)).toBeLessThan(0.08 * layout.fontPx * POP_GROW)
  })

  it('put a box behind the word being said, and move it on with the words', async () => {
    const { out, t } = await exported('word-box', [{ text: 'one', start: 0, length: 30 }, { text: 'two', start: 30, length: 30 }], { popBox: true, popBoxColour: '#0000FF' })
    const c = t.captions.clips[0]!
    const layout = layoutCaption(c, t.captions.style, 1080, 1920)
    const blue = (r: number, g: number, b: number): boolean => r < 60 && g < 60 && b > 200
    for (const [frame, lit] of [[10, 0], [40, 1]] as const) {
      const box = captionDrawing(c, t.captions.style, layout, lit).wordBox!
      const got = extent(await frameAt(out, frame, 1080, 1920), 1080, blue)
      expect(Math.abs(got.left - box.x)).toBeLessThan(3)
      expect(Math.abs(got.right + 1 - (box.x + box.w))).toBeLessThan(3)
      expect(Math.abs(got.top - box.y)).toBeLessThan(3)
      expect(Math.abs(got.bottom + 1 - (box.y + box.h))).toBeLessThan(3)
    }
  })

  it('are in each file of their own clip, one file per clip, timed from its start', async () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('red', red, 2)] }
    t = addClip(addClip(t, 'red', 'first'), 'red', 'second')
    // One word, over the first half second of the second clip.
    t = setCaptions(t, [{ text: 'hi', start: 60, length: 15 }], [])
    const scratch = join(work, 'scratch-batch')
    const plan = planRender({
      timeline: t,
      names: { project: 'batch', sequence: 'Vertical', joined: 'batch' },
      preset: presetById('vertical'),
      mode: 'batch',
      outputDir: join(work, 'batch'),
      scratchDir: scratch,
      filenamePattern: '{project}_{index}'
    })
    const [a, b] = await runExport({ plan, fps: 30, scratchDir: scratch, onProgress: () => undefined, fontsDir })
    expect(letters(await frameAt(a!, 6, 1080, 1920), 1080).yellow).toBe(0)
    expect(letters(await frameAt(b!, 6, 1080, 1920), 1080).yellow).toBeGreaterThan(200)
    expect(letters(await frameAt(b!, 36, 1080, 1920), 1080).yellow).toBe(0)
  })
})

describe('captions as a subtitle file', () => {
  it('are written beside the video with its name, and read by ffmpeg as subtitles, timed to the file, with the transcript beside them', async () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('red', red, 2)] }
    t = setCaptions(addClip(t, 'red'), [{ text: 'hello', start: 15, length: 15 }, { text: 'there', start: 30, length: 15 }], [])
    const scratch = join(work, 'scratch-srt')
    const plan = planRender({
      timeline: t,
      names: { project: 'subtitled', sequence: 'Vertical', joined: 'subtitled' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'srt'),
      scratchDir: scratch,
      filenamePattern: '{project}',
      subtitleFile: true,
      transcriptFile: true
    })
    const [out] = await runExport({ plan, fps: 30, scratchDir: scratch, onProgress: () => undefined, fontsDir })
    const srt = join(work, 'srt', 'subtitled.srt')
    expect(out).toBe(join(work, 'srt', 'subtitled.mp4'))
    expect(await readFile(srt, 'utf8')).toBe(['1', '00:00:00,500 --> 00:00:01,500', 'hello there', ''].join('\n'))
    // Read as subtitles, and converted, by the same ffmpeg a player would be built on.
    const { stdout, stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', srt, '-f', 'webvtt', '-'])
    expect(stderr).toContain('subrip')
    expect(stdout.toString()).toContain('00:00.500 --> 00:01.500')    // And every word said, as text to read, beside them both.
    expect(await readFile(join(work, 'srt', 'subtitled.txt'), 'utf8')).toBe('hello there' + String.fromCharCode(10))
  })
})
