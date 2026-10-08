import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'

/**
 * Making captions in the real app, with a stand-in for whisper-cli that says
 * it heard "Hello there everyone." at 0.5 to 2 seconds. V1 holds a 4 second
 * clip of solid red, 0 to 120, its sound on A1, so a caption's white and
 * yellow can be told from the picture under it.
 */

const fx = fixtureSet('captions-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-captions-ui-'))
const userData = join(root, 'user-data')
const heard = join(root, 'heard.json')
const fake = join(process.cwd(), 'test', 'fixtures', 'fake-whisper.mjs')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const clean = await fx.redClip()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_SPEECH_FAKE: fake, EDITBAY_FAKE_WHISPER_LOG: heard }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clean)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** Every caption on the caption track as it reads there, with where it starts. */
async function captions(): Promise<[string, number][]> {
  return page.locator('[data-testid="caption"]').evaluateAll((els) =>
    els.map((el) => [el.getAttribute('data-text') ?? '', Number(el.getAttribute('data-start'))] as [string, number])
  )
}

/** The whole sequence chosen, where a clip selected or In and Out marked offer less of it (plan 78). */
async function wholeSequence(): Promise<void> {
  await page.waitForSelector('[data-testid="captions-dialog"]', WAIT)
  if ((await page.locator('[data-testid="captions-scope-whole"]').count()) > 0) await page.click('[data-testid="captions-scope-whole"]')
}

/** Where the main process is told to find the engine: a test launch reads these when it needs them. */
async function setEnv(values: Record<string, string | null>): Promise<void> {
  await app.evaluate((_electron, v) => {
    for (const [k, x] of Object.entries(v)) {
      if (x === null) delete process.env[k]
      else process.env[k] = x
    }
  }, values)
}

describe('making captions', () => {
  it('ticks the talking head\'s own sound to listen to, and puts what was heard on the caption track, a few words at a time', async () => {
    await page.locator('[data-testid="open-captions"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', WAIT)
    const ticked = await page.locator('[data-testid="captions-track-listen"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked))
    expect(ticked).toEqual([true])
    await wholeSequence()
    await page.locator('[data-testid="captions-make"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', timeout: 30_000 })
    // "Hello there everyone." is more than 18 characters, so the last word has a caption of its own.
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
    await page.waitForSelector('[data-testid="toast"][data-kind="captions"]', WAIT)
  })

  it('hands the engine the sequence\'s sound as one channel at 16 kHz', async () => {
    const given = JSON.parse((await readFile(heard)).toString()) as { wav: { sampleRate: number; channels: number; seconds: number } }
    expect(given.wav).toMatchObject({ sampleRate: 16000, channels: 1 })
    expect(given.wav.seconds).toBeCloseTo(4, 1)
  })

  it('selects a caption clicked, and shows its words in the Inspector', async () => {
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption"][data-selected="yes"]', WAIT)
    expect(await page.locator('[data-testid="caption-text"]').textContent()).toBe('HELLO THERE')
    // A clip clicked takes the selection from it.
    await page.locator('[data-testid="clip"]').first().click()
    await page.waitForSelector('[data-testid="caption"][data-selected="yes"]', { state: 'detached', ...WAIT })
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
  })

  it('takes every caption away with one undo, and puts them back with one redo', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(captions, WAIT).toEqual([])
    expect(await page.locator('[data-testid="caption-track"]').count()).toBe(0)
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await captions()).length, WAIT).toBe(2)
  })

  it('moves the captions after a clip on V1 taken out with Shift+Delete', async () => {
    // Split at 10, and take the first 10 frames out: every caption comes 10 frames earlier.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(10)
    await page.keyboard.press('KeyS')
    await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(2)
    await page.locator('[data-testid="clip"][data-start="0"]').click()
    await page.keyboard.press('Shift+Delete')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 5],
      ['EVERYONE.', 32]
    ])
    await page.keyboard.press('Control+z')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
  })

  it('says making them again replaces the captions there are', async () => {
    await page.locator('[data-testid="open-captions"]').click()
    await wholeSequence()
    await page.waitForSelector('[data-testid="captions-replace-note"]', WAIT)
    expect(await page.locator('[data-testid="captions-make"]').textContent()).toBe('Make captions again')
    await page.locator('[data-testid="captions-dialog-close"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', ...WAIT })
  })

  // Bugs and notes 2, note 17 (plan 78).
  it('makes captions for In to Out only, listening to that stretch alone and leaving the rest', async () => {
    // The playhead to one second, In; to two seconds, Out.
    const at = (): Promise<string | null> => page.getAttribute('[data-testid="timecode"]', 'data-playhead')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await expect.poll(at, WAIT).toBe('0')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(at, WAIT).toBe('30')
    await page.keyboard.press('Shift+KeyI')
    // The keys back on the timeline, whatever marking In put in front of them.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(at, WAIT).toBe('60')
    await page.keyboard.press('Shift+KeyO')
    await page.locator('[data-testid="open-captions"]').click()
    await page.waitForSelector('[data-testid="captions-scope"]', WAIT)
    await page.click('[data-testid="captions-scope-marked"]')
    // "EVERYONE." starts at frame 42, inside; "HELLO THERE" at 15 is left.
    expect(await page.textContent('[data-testid="captions-scope-note"]')).toContain('Replaces the caption between')
    await page.click('[data-testid="captions-make"]')
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', timeout: 30_000 })
    // The engine heard one second, and its words land a second in; the last, said past it, is left out.
    const given = JSON.parse((await readFile(heard)).toString()) as { wav: { seconds: number } }
    expect(given.wav.seconds).toBeCloseTo(1, 1)
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['HELLO THERE', 45]
    ])
    // One undo puts it back as it was.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
    await page.keyboard.press('Control+Shift+KeyX')
  })

  it("offers Make captions for this clip on a clip's right click, with the selected clips chosen", async () => {
    const clip = (await page.locator('[data-testid="clip"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.click('[data-testid="clip-menu-captions"]')
    await page.waitForSelector('[data-testid="captions-dialog"]', WAIT)
    expect(await page.getAttribute('[data-testid="captions-scope-selected"]', 'aria-pressed')).toBe('true')
    await page.locator('[data-testid="captions-dialog-close"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', ...WAIT })
  })

  it('stops listening when cancelled, and leaves the captions as they were', async () => {
    await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: '400', EDITBAY_FAKE_WHISPER_WORDS: JSON.stringify([{ text: 'other', start: 0.1, end: 0.5 }]) })
    try {
      await page.locator('[data-testid="open-captions"]').click()
      await wholeSequence()
      await page.locator('[data-testid="captions-make"]').click()
      await page.waitForSelector('[data-testid="captions-progress"]', WAIT)
      // Closing the window leaves it listening, and opening it again shows the progress and Cancel.
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', ...WAIT })
      await page.locator('[data-testid="open-captions"]').click()
      await page.waitForSelector('[data-testid="captions-progress"]', WAIT)
      await page.locator('[data-testid="captions-cancel"]').click()
      await page.waitForSelector('[data-testid="captions-progress"]', { state: 'detached', ...WAIT })
      expect(await page.locator('[data-testid="captions-error"]').count()).toBe(0)
      await page.locator('[data-testid="captions-dialog-close"]').click()
      expect(await captions()).toEqual([
        ['HELLO THERE', 15],
        ['EVERYONE.', 42]
      ])
    } finally {
      await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: null, EDITBAY_FAKE_WHISPER_WORDS: null })
    }
  })
})

describe('making captions in the background', () => {
  it('keeps listening with the window closed, shows how far it has got, and puts the captions on the footage they were heard from', async () => {
    // "other" is heard at 30 frames, on the sequence as it was when the listening began.
    const clipsBefore = await page.locator('[data-testid="clip"]').count()
    await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: '800', EDITBAY_FAKE_WHISPER_WORDS: JSON.stringify([{ text: 'other', start: 1, end: 1.5 }]) })
    try {
      await page.locator('[data-testid="open-captions"]').click()
      await wholeSequence()
      await page.locator('[data-testid="captions-make"]').click()
      await page.waitForSelector('[data-testid="captions-progress"]', WAIT)
      await page.locator('[data-testid="captions-background"]').click()
      await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', ...WAIT })
      await expect.poll(async () => (await page.locator('[data-testid="open-captions"]').textContent()) ?? '', WAIT).toMatch(/^Captions \d+%$/)

      // Meanwhile the first 10 frames are cut out, so the word lands 10 frames earlier.
      await page.locator('[data-testid="timecode"]').click()
      await page.keyboard.press('Home')
      for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
      await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(10)
      await page.keyboard.press('KeyS')
      await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(2)
      await page.locator('[data-testid="clip"][data-start="0"]').click()
      await page.keyboard.press('Shift+Delete')
      await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(1)

      await expect.poll(captions, { timeout: 30_000 }).toEqual([['OTHER', 20]])
      await page.waitForSelector('[data-testid="toast"][data-kind="captions"]', WAIT)
      expect(await page.locator('[data-testid="open-captions"]').textContent()).toBe('Captions')
    } finally {
      await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: null, EDITBAY_FAKE_WHISPER_WORDS: null })
    }
    // Both undone, back to how it was.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
    await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(clipsBefore)
  })

  it('says why in a notice when it fails with the window closed, and shows it in the window', async () => {
    await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: '300', EDITBAY_FAKE_WHISPER_WORDS: '[]' })
    try {
      await page.locator('[data-testid="open-captions"]').click()
      await wholeSequence()
      await page.locator('[data-testid="captions-make"]').click()
      await page.waitForSelector('[data-testid="captions-progress"]', WAIT)
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', ...WAIT })
      const notice = page.locator('[data-testid="toast"][data-kind="captions"]', { hasText: 'No speech was heard' })
      await notice.waitFor({ timeout: 30_000 })
      await notice.locator('[data-testid="toast-action"]').click()
      await page.waitForSelector('[data-testid="captions-error"]', WAIT)
      await page.locator('[data-testid="captions-dialog-close"]').click()
    } finally {
      await setEnv({ EDITBAY_FAKE_WHISPER_DELAY_MS: null, EDITBAY_FAKE_WHISPER_WORDS: null })
    }
    expect(await captions()).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
  })
})

describe('the speech model, the first time', () => {
  let server: Server
  let base = ''
  const files = new Map<string, Buffer>()

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = files.get(req.url ?? '')
      if (!body) return void res.writeHead(404).end()
      res.writeHead(200, { 'content-length': body.length })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(async () => {
    await setEnv({ EDITBAY_SPEECH_SOURCES: null })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const serve = (name: string, body: Buffer): { name: string; url: string; sha256: string; bytes: number } => {
    files.set(`/${name}`, body)
    return { name, url: `${base}/${name}`, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length }
  }

  it('is downloaded once asked, and the captions are made as soon as it is here', async () => {
    // An engine shaped like whisper.cpp's zip: its program in a Release folder.
    const build = join(root, 'build')
    await mkdir(join(build, 'Release'), { recursive: true })
    await writeFile(join(build, 'Release', 'whisper-cli.exe'), 'program')
    const zip = join(root, 'engine.zip')
    await capture(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', build, 'Release'])
    const sources = { engine: serve('whisper-bin-x64.zip', await readFile(zip)), model: serve('model.bin', Buffer.alloc(1000, 3)) }
    await setEnv({ EDITBAY_SPEECH_SOURCES: JSON.stringify(sources) })

    await page.locator('[data-testid="open-captions"]').click()
    await wholeSequence()
    await page.locator('[data-testid="captions-make"]').click()
    await page.waitForSelector('[data-testid="captions-download-ask"]', WAIT)
    expect(await page.locator('[data-testid="captions-download-ask"]').textContent()).toContain('about 200 MB')
    await page.locator('[data-testid="captions-download"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', timeout: 30_000 })
    expect((await readdir(join(userData, 'speech'))).sort()).toEqual(['model.bin', 'whisper-b5130'])
    await expect.poll(async () => (await captions()).length, WAIT).toBe(2)
  })
})

/** The playhead to a frame, by the keys, waiting for it to land. */
async function playheadTo(frame: number): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Home')
  for (let i = 0; i < Math.floor(frame / 30); i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < frame % 30; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(frame)
}

let shots = 0

/** How wide the pixels of one kind are on the Output view, in the caption's band, in screen pixels (plan 99). */
async function outputWidth(is: (r: number, g: number, b: number) => boolean): Promise<number> {
  let [left, right] = [Infinity, -Infinity]
  await outputPixels((r, g, b, x) => {
    if (is(r, g, b)) [left, right] = [Math.min(left, x!), Math.max(right, x!)]
    return false
  })
  return right >= left ? right - left + 1 : 0
}

/** How many pixels of the Output view, in the caption's band of the frame, are of one kind (plan 99). */
async function outputPixels(is: (r: number, g: number, b: number, x?: number) => boolean): Promise<number> {
  const file = join(root, `output-${++shots}.png`)
  await writeFile(file, await page.locator('[data-testid="program-canvas"]').screenshot())
  const probe = await capture(ffmpegPath, ['-hide_banner', '-i', file], {}).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }))
  const [, w = '0', h = '0'] = String(probe.stderr).match(/, (\d+)x(\d+)/) ?? []
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  const width = Number(w)
  const fit = fitInBox(1080, 1920, width, Number(h))
  let n = 0
  for (let i = 0; i + 2 < stdout.length && Number(h) > 0; i += 3) {
    const x = ((i / 3) % width - fit.offsetX) / fit.width
    const y = (Math.floor(i / 3 / width) - fit.offsetY) / fit.height
    if (x < 0.05 || x > 0.95 || y < 0.5 || y > 0.8) continue
    if (is(stdout[i]!, stdout[i + 1]!, stdout[i + 2]!, (i / 3) % width)) n++
  }
  return n
}

/**
 * How many pixels of the Output view are white, and how many the caption's
 * yellow, in the band of the vertical frame the caption is drawn in, away
 * from its edges, where the frame's own handles are.
 */
async function captionPixels(): Promise<{ white: number; yellow: number; yellowX: number; yellowY: number }> {
  const file = join(root, `output-${++shots}.png`)
  await writeFile(file, await page.locator('[data-testid="program-canvas"]').screenshot())
  const probe = await capture(ffmpegPath, ['-hide_banner', '-i', file], {}).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }))
  const [, w = '0', h = '0'] = String(probe.stderr).match(/, (\d+)x(\d+)/) ?? []
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  let white = 0
  let yellow = 0
  let sumX = 0
  let sumY = 0
  const width = Number(w)
  const fit = fitInBox(1080, 1920, width, Number(h))
  for (let i = 0; i + 2 < stdout.length && Number(h) > 0; i += 3) {
    const x = ((i / 3) % width - fit.offsetX) / fit.width
    const y = (Math.floor(i / 3 / width) - fit.offsetY) / fit.height
    if (x < 0.05 || x > 0.95 || y < 0.5 || y > 0.8) continue
    const [r, g, b] = [stdout[i]!, stdout[i + 1]!, stdout[i + 2]!]
    if (r > 220 && g > 220 && b > 220) white++
    // The caption's #FFD400, not the orange of the frame's handles.
    if (r > 230 && g > 190 && g < 235 && b < 60) {
      yellow++
      sumX += x
      sumY += y
    }
  }
  return { white, yellow, yellowX: yellow > 0 ? sumX / yellow : 0, yellowY: yellow > 0 ? sumY / yellow : 0 }
}

describe('captions in the Output view', () => {
  it('shows the caption under the playhead, the word being said in yellow, and moves the yellow on to the next word', async () => {
    await page.locator('[data-testid="view-program"]').click()
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]', WAIT)
    // HELLO THERE is over 15 to 42, "there" said from 27; in a vertical frame the two words are on two lines.
    // Drawn in the bundled font, not a stand-in.
    await expect
      .poll(() => page.evaluate(() => [...document.fonts].find((f) => f.family.replace(/"/g, '') === 'Montserrat ExtraBold')?.status), WAIT)
      .toBe('loaded')
    await playheadTo(20)
    await expect.poll(async () => (await captionPixels()).yellow, WAIT).toBeGreaterThan(100)
    const hello = await captionPixels()
    expect(hello.white).toBeGreaterThan(100)
    // THERE, on the line below, is lit once it is said.
    await playheadTo(30)
    await expect.poll(async () => (await captionPixels()).yellowY, WAIT).toBeGreaterThan(hello.yellowY + 0.02)
    // Nothing between the captions' end and the end of the clip.
    await playheadTo(90)
    await expect.poll(async () => (await captionPixels()).yellow, WAIT).toBe(0)
    expect((await captionPixels()).white).toBe(0)
  })

  it('saves a frame with a caption on it, the caption burned in', async () => {
    const out = join(root, 'frames')
    const saved = await page.evaluate(async (dir) => {
      const p = await window.api.currentProject()
      return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: 20, outputDir: dir })
    }, out)
    expect(saved.error).toBeUndefined()
    expect(saved.ok).toBe(true)
    // White letters on the red clip, and yellow for the word being said.
    const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', saved.path!, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    let lit = 0
    for (let i = 0; i + 2 < stdout.length; i += 3) if (stdout[i + 1]! > 180) lit++
    expect(lit).toBeGreaterThan(500)
  })
})

describe('editing captions', () => {
  it("changes a caption's words as typed in the Inspector, on the track and on screen", async () => {
    await page.locator('[data-testid="caption"]').first().click()
    const words = page.locator('[data-testid="caption-words"]')
    await expect.poll(async () => words.inputValue()).toBe('Hello there')
    await words.fill('Hello world')
    await words.press('Enter')
    await expect.poll(async () => (await captions())[0]).toEqual(['HELLO WORLD', 15])
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await captions())[0]).toEqual(['HELLO THERE', 15])
  })

  it('applies words typed in the Inspector to their own caption when another caption is clicked, and gives the keys back', async () => {
    await page.locator('[data-testid="caption"]').first().click()
    await page.locator('[data-testid="caption-words"]').fill('Hello world')
    await page.locator('[data-testid="caption"]').nth(1).click()
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO WORLD', 15],
      ['EVERYONE.', 42]
    ])
    // S goes to the editor, not into the field: with the playhead past the caption, it cuts the clip there.
    const clipsBefore = await page.locator('[data-testid="clip"]').count()
    await page.keyboard.press('KeyS')
    await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(clipsBefore + 1)
    expect(await page.locator('[data-testid="caption-words"]').inputValue()).toBe('everyone.')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => page.locator('[data-testid="clip"]').count(), WAIT).toBe(clipsBefore)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await captions())[0], WAIT).toEqual(['HELLO THERE', 15])
  })

  it('splits the caption selected at the playhead with S, the words either side going to each piece', async () => {
    await playheadTo(27)
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption"][data-selected="yes"]', WAIT)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('KeyS')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO', 15],
      ['THERE', 27],
      ['EVERYONE.', 42]
    ])
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await captions()).length, WAIT).toBe(2)
  })

  it('moves a caption dragged along its track, and takes one away with Delete', async () => {
    const block = page.locator('[data-testid="caption"]').nth(1)
    const box = (await block.boundingBox())!
    // A short caption is drawn wider than it is, so the zoom is read from how far apart two captions start.
    const firstBox = (await page.locator('[data-testid="caption"]').first().boundingBox())!
    const starts = (await captions()).map(([, start]) => start)
    const pxPerFrame = (box.x - firstBox.x) / (starts[1]! - starts[0]!)
    // Alt, so it lands where it is let go rather than snapping.
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30 * pxPerFrame, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(async () => (await captions())[1], WAIT).toEqual(['EVERYONE.', 72])
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Delete')
    await expect.poll(captions, WAIT).toEqual([['HELLO THERE', 15]])
    // One undo for the delete, one for the drag.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
  })

  it('groups them again from the Inspector, as one step that undoes', async () => {
    await page.locator('[data-testid="caption"]').first().click()
    await page.locator('[data-testid="caption-regroup"]').click()
    await page.waitForSelector('[data-testid="toast"][data-kind="regroupCaptions"]', WAIT)
    // Grouped by the rule, these three words are the same two captions as before.
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO THERE', 15],
      ['EVERYONE.', 42]
    ])
    await page.waitForSelector('[data-testid="caption-panel"]', WAIT)
  })

  it('groups the words again for another number of words at a time', async () => {
    await page.locator('[data-testid="caption"]').first().click()
    await page.locator('[data-testid="caption-words-per"]').selectOption('1')
    await expect.poll(captions, WAIT).toEqual([
      ['HELLO', 15],
      ['THERE', 27],
      ['EVERYONE.', 42]
    ])
    await page.waitForSelector('[data-testid="toast"][data-kind="setCaptionStyle"]', WAIT)
    // The caption it was changed in is still the one shown, though grouping again renames them all.
    await page.waitForSelector('[data-testid="caption-panel"]', WAIT)
    expect(await page.locator('[data-testid="caption-words-per"]').inputValue()).toBe('1')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await captions()).length, WAIT).toBe(2)
  })

  // Plan 76.
  it('takes a font, a words colour and an outline, and each undoes', async () => {
    const style = (): Promise<Record<string, unknown>> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.captions.style as unknown as Record<string, unknown>)
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption-style"]', WAIT)
    await page.locator('[data-testid="caption-font"]').selectOption('anton')
    await expect.poll(async () => (await style()).font, WAIT).toBe('anton')
    await page.locator('[data-testid="caption-outline-0.12"]').click()
    await expect.poll(async () => (await style()).outline, WAIT).toBe(0.12)
    await page.locator('[data-testid="caption-word-colour"]').fill('#00ff00')
    await expect.poll(async () => (await style()).wordColour, WAIT).toBe('#00FF00')
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid="timecode"]').click()
      await page.keyboard.press('Control+z')
    }
    await expect.poll(async () => (await style()).font, WAIT).toBe('montserrat')
    expect(await style()).toMatchObject({ outline: 0.08, wordColour: '#FFFFFF' })
  })

  // Plan 87.
  it('takes a font from this PC, a shadow and letter spacing, and goes back to a bundled font', async () => {
    const style = (): Promise<Record<string, unknown>> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.captions.style as unknown as Record<string, unknown>)
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption-style"]', WAIT)
    // Listed after the bundled four, read from its file once chosen.
    await expect.poll(() => page.locator('[data-testid="caption-font"] option[value="pc:Arial"]').count(), WAIT).toBe(1)
    await page.locator('[data-testid="caption-font"]').selectOption('pc:Arial')
    await expect.poll(async () => ((await style()).pcFont as { family?: string } | undefined)?.family, WAIT).toBe('Arial')
    await page.locator('[data-testid="caption-shadow-0.08"]').click()
    await expect.poll(async () => (await style()).shadow, WAIT).toBe(0.08)
    await page.locator('[data-testid="caption-spacing-0.05"]').click()
    await expect.poll(async () => (await style()).spacing, WAIT).toBe(0.05)
    await page.locator('[data-testid="caption-font"]').selectOption('bebas')
    await expect.poll(async () => (await style()).pcFont, WAIT).toBeUndefined()
    expect((await style()).font).toBe('bebas')
  })

  // Plan 99.
  it('draws a box, a glow and the word being said boxed and bigger on the Output view, each undoing', async () => {
    const style = (): Promise<Record<string, unknown>> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.captions.style as unknown as Record<string, unknown>)
    await page.locator('[data-testid="view-program"]').click()
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]', WAIT)
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption-style"]', WAIT)
    const start = Number(await page.locator('[data-testid="caption"]').first().getAttribute('data-start'))
    await playheadTo(start + 2)
    const blue = (r: number, g: number, b: number): boolean => r < 60 && g < 60 && b > 200
    // The glow green, over the red picture or the blue box: never the white or yellow letters, which have red in them.
    const green = (r: number, g: number, b: number): boolean => g > 120 && r < 120 && g > b
    expect(await outputPixels(blue)).toBe(0)

    await page.locator('[data-testid="caption-bg"]').click()
    await page.locator('[data-testid="caption-bg-colour"]').fill('#0000ff')
    await page.locator('[data-testid="caption-bg-opacity"]').fill('100')
    await expect.poll(async () => (await style()).boxOpacity, WAIT).toBe(1)
    await expect.poll(() => outputPixels(blue), WAIT).toBeGreaterThan(1000)

    await page.locator('[data-testid="caption-glow-colour"]').fill('#00ff00')
    await page.locator('[data-testid="caption-glow-0.25"]').click()
    await expect.poll(async () => (await style()).glow, WAIT).toBe(0.25)
    await expect.poll(() => outputPixels(green), WAIT).toBeGreaterThan(500)

    // The word being said, boxed in purple and bigger: wider than before it grew.
    const yellow = (r: number, g: number, b: number): boolean => r > 230 && g > 190 && g < 235 && b < 60
    const before = await outputWidth(yellow)
    await page.locator('[data-testid="caption-pop-grow"]').click()
    await page.locator('[data-testid="caption-pop-box"]').click()
    await expect.poll(async () => (await style()).popBox, WAIT).toBe(true)
    expect((await style()).popGrow).toBe(true)
    await expect.poll(() => outputWidth(yellow), WAIT).toBeGreaterThan(before * 1.15)
    await expect.poll(() => outputPixels((r, g, b) => r > 100 && r < 140 && g < 80 && b > 220), WAIT).toBeGreaterThan(200)

    // Seven steps, each its own undo, last first.
    const undone: [string, unknown][] = [
      ['popBox', false],
      ['popGrow', false],
      ['glow', 0],
      ['glowColour', '#FFD400'],
      ['boxOpacity', 0.6],
      ['boxColour', '#000000'],
      ['box', false]
    ]
    for (const [field, was] of undone) {
      await page.locator('[data-testid="timecode"]').click()
      await page.keyboard.press('Control+z')
      await expect.poll(async () => (await style())[field], WAIT).toBe(was)
    }
    await expect.poll(() => outputPixels(blue), WAIT).toBe(0)
  })

  it('saves the caption look under a name and puts it back in one click and one undo, apart from text styles', async () => {
    const style = (): Promise<Record<string, unknown>> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.captions.style as unknown as Record<string, unknown>)
    const settings = (): Promise<{ savedCaptionStyles: { name: string }[]; savedTextStyles: unknown[] }> => page.evaluate(() => window.api.appSettings())
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption-style"]', WAIT)
    const height = (await style()).height
    await page.locator('[data-testid="caption-bg"]').click()
    await page.locator('[data-testid="caption-glow-0.12"]').click()
    await expect.poll(async () => (await style()).glow, WAIT).toBe(0.12)
    await page.locator('[data-testid="caption-saved-save"]').click()
    expect(await page.inputValue('[data-testid="caption-saved-name"]')).toBe('My caption style')
    await page.fill('[data-testid="caption-saved-name"]', 'Boxed glow')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await settings()).savedCaptionStyles.map((s) => s.name), WAIT).toEqual(['Boxed glow'])
    expect((await settings()).savedTextStyles).toEqual([])
    // Back to no box and no glow, then the saved look on again in one step.
    await page.locator('[data-testid="caption-bg"]').click()
    await page.locator('[data-testid="caption-glow-0"]').click()
    await expect.poll(async () => (await style()).glow, WAIT).toBe(0)
    await page.locator('[data-testid="caption-saved-use"][data-name="Boxed glow"]').click()
    await expect.poll(async () => (await style()).glow, WAIT).toBe(0.12)
    expect(await style()).toMatchObject({ box: true, height })
    await page.locator('[data-testid="caption-saved-remove"][data-name="Boxed glow"]').click()
    await expect.poll(async () => (await settings()).savedCaptionStyles, WAIT).toEqual([])
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await style()).glow, WAIT).toBe(0)
    expect((await style()).box).toBe(false)
    // The rest of this file starts from captions as they were.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z')
    await expect.poll(async () => (await style()).box, WAIT).toBe(false)
  })
})

describe('moving captions on the Output view', () => {
  interface Placed {
    at?: { x: number; y: number }
  }
  const stored = (): Promise<{ clips: Placed[]; across: number; height: number }> =>
    page.evaluate(async () => {
      const c = (await window.api.currentProject()).sequences[0]!.captions
      return { clips: c.clips.map((x) => ({ ...(x.at ? { at: x.at } : {}) })), across: c.style.across, height: c.style.height }
    })

  /** Press and drag a box by pixels, as a hand does. */
  async function drag(testid: string, dx: number, dy: number): Promise<void> {
    const box = (await page.locator(`[data-testid="${testid}"]`).boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + (dx * i) / 5, from.y + (dy * i) / 5)
    await page.mouse.up()
  }

  it('moves one caption on its own after a double click, in one undo step', async () => {
    await page.locator('[data-testid="view-program"]').click()
    // The playhead on the first caption, which starts at frame 15.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
    await page.waitForSelector('[data-testid="caption-box"]', WAIT)

    await page.locator('[data-testid="caption-box"]').dblclick()
    await page.waitForSelector('[data-testid="caption-box"][data-mode="one"]', WAIT)
    await drag('caption-box', 0, -150)
    await expect.poll(async () => (await stored()).clips[0]!.at?.y ?? 1, WAIT).toBeLessThan(0.6)
    // Only that one.
    expect((await stored()).clips[1]!.at).toBeUndefined()
    await page.waitForSelector('[data-testid="caption-where"][data-where="hand"]', WAIT)

    // One undo for the whole drag.
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await stored()).clips[0]!.at, WAIT).toBeUndefined()
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await stored()).clips[0]!.at, WAIT).toBeDefined()
  })

  it('relocates the rest and leaves the one moved by hand, unless asked to take it too', async () => {
    await page.locator('[data-testid="caption-box"]').click()
    await page.waitForSelector('[data-testid="caption-panel"]', WAIT)
    const before = await stored()
    await page.locator('[data-testid="caption-relocate"]').click()
    await page.waitForSelector('[data-testid="caption-box"][data-mode="all"]', WAIT)
    await drag('caption-box', 0, 200)
    await expect.poll(async () => (await stored()).height, WAIT).toBeGreaterThan(before.height)
    // The one placed by hand kept its place.
    expect((await stored()).clips[0]!.at).toEqual(before.clips[0]!.at)

    // With the box ticked, it goes with them.
    await page.locator('[data-testid="caption-relocate-hand"]').check()
    await drag('caption-box', 0, -50)
    await expect.poll(async () => (await stored()).clips[0]!.at, WAIT).toBeUndefined()

    // And Escape ends it.
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="caption-box"][data-mode="none"]', WAIT)
    await page.locator('[data-testid="caption-relocate-hand"]').uncheck()
  })

  // Bugs and notes 2, note 18.
  it('draws the box on the caption as it is in Relocate too, and a double click there moves that one alone', async () => {
    // The first caption placed by hand, higher up.
    await page.locator('[data-testid="caption-box"]').dblclick()
    await page.waitForSelector('[data-testid="caption-box"][data-mode="one"]', WAIT)
    await drag('caption-box', 0, -150)
    await expect.poll(async () => (await stored()).clips[0]!.at?.y ?? 1, WAIT).toBeLessThan(0.6)
    await page.keyboard.press('Escape')
    const at = (await stored()).clips[0]!.at!

    await page.locator('[data-testid="caption-box"]').click()
    await page.locator('[data-testid="caption-relocate"]').click()
    await page.waitForSelector('[data-testid="caption-box"][data-mode="all"]', WAIT)
    // On the words, where the caption was put, not where the style would put it.
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const box = (await page.locator('[data-testid="caption-box"]').boundingBox())!
    expect((box.y + box.height / 2 - frame.y) / frame.height).toBeCloseTo(at.y, 1)
    // And it says the drag will leave it there.
    expect(await page.getAttribute('[data-testid="caption-box"]', 'data-stays')).toBe('yes')
    await page.waitForSelector('[data-testid="caption-box-note"]', WAIT)

    // A double click: Relocate off, and this caption moving on its own.
    await page.locator('[data-testid="caption-box"]').dblclick()
    await page.waitForSelector('[data-testid="caption-box"][data-mode="one"]', WAIT)
    await page.keyboard.press('Escape')
  })
})

describe('captions and the export', () => {
  it('offers a subtitle file beside one video, lists it among what it will write, and not for one file per clip', async () => {
    await openExportDialog()
    const box = page.locator('[data-testid="export-subtitle-file"]')
    const will = page.locator('[data-testid="export-will-write"]')
    expect(await box.isDisabled()).toBe(false)
    expect(await box.isChecked()).toBe(false)
    await expect.poll(() => will.getAttribute('data-count'), WAIT).toBe('1')
    await box.check()
    await expect.poll(() => will.getAttribute('data-count'), WAIT).toBe('2')
    expect(await will.textContent()).toMatch(/\.srt/)
    await page.locator('[data-testid="export-mode"]').selectOption('batch')
    await expect.poll(() => box.isDisabled(), WAIT).toBe(true)
    expect(await box.isChecked()).toBe(false)
    // Back to one video, it is still chosen: the choice is kept, only not offered for files per clip.
    await page.locator('[data-testid="export-mode"]').selectOption('join')
    await expect.poll(() => box.isChecked(), WAIT).toBe(true)
    await box.uncheck()
    await page.locator('[data-testid="export-panel-close"]').click()
  })

  it('offers a transcript beside one video, listed with what it will write, and not for one file per clip', async () => {
    await openExportDialog()
    const box = page.locator('[data-testid="export-transcript-file"]')
    const will = page.locator('[data-testid="export-will-write"]')
    expect(await box.isDisabled()).toBe(false)
    expect(await box.isChecked()).toBe(false)
    await expect.poll(() => will.getAttribute('data-count'), WAIT).toBe('1')
    await box.check()
    await expect.poll(() => will.getAttribute('data-count'), WAIT).toBe('2')
    expect(await will.textContent()).toMatch(/\.txt/)
    await page.locator('[data-testid="export-mode"]').selectOption('batch')
    await expect.poll(() => box.isDisabled(), WAIT).toBe(true)
    await page.locator('[data-testid="export-mode"]').selectOption('join')
    await expect.poll(() => box.isChecked(), WAIT).toBe(true)
    await box.uncheck()
    await page.locator('[data-testid="export-panel-close"]').click()
  })

  it('says the captions are left out under Handoff, which has no frame to put them in', async () => {
    await openExportDialog()
    expect(await page.locator('[data-testid="export-captions-note"]').count()).toBe(0)
    await page.locator('[data-testid="export-panel-close"]').click()
    await page.locator('[data-testid="export-preset"]').selectOption('handoff')
    await openExportDialog()
    await page.waitForSelector('[data-testid="export-captions-note"]', WAIT)
    await page.locator('[data-testid="export-panel-close"]').click()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
  })
})

// Task 34: last, since it leaves a second sequence behind.
describe('one caption style on every sequence', () => {
  it('puts the look on the other sequence once you are sure, keeping where its captions sit; Cancel changes nothing; one undo puts it back', async () => {
    const styles = (): Promise<Record<string, unknown>[]> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences.map((s) => s.captions.style as unknown as Record<string, unknown>))
    const look = (s: Record<string, unknown>): Record<string, unknown> => ({ ...s, height: 0, across: 0 })
    await page.click('[data-testid="sequence-add"]')
    await page.click('[data-testid="sequence-add-shape"][data-shape="vertical"]')
    await expect.poll(async () => (await styles()).length, WAIT).toBe(2)
    await page.locator('[data-testid="sequence-tab"]').first().click()
    await page.locator('[data-testid="caption"]').first().click()
    await page.waitForSelector('[data-testid="caption-style"]', WAIT)
    await page.locator('[data-testid="caption-font"]').selectOption('anton')
    await page.locator('[data-testid="caption-word-colour"]').fill('#00ff00')
    await expect.poll(async () => (await styles())[0]!.wordColour, WAIT).toBe('#00FF00')
    const before = await styles()
    expect(look(before[1]!)).not.toEqual(look(before[0]!))

    await page.click('[data-testid="caption-apply-all"]')
    expect(await page.textContent('[data-testid="caption-apply-all-ask"]')).toContain('the other sequence')
    await page.click('[data-testid="caption-apply-all-cancel"]')
    await page.waitForSelector('[data-testid="caption-apply-all-ask"]', { state: 'detached' })
    expect(await styles()).toEqual(before)

    await page.click('[data-testid="caption-apply-all"]')
    await page.click('[data-testid="caption-apply-all-confirm"]')
    await expect.poll(async () => (await styles())[1]!.font, WAIT).toBe('anton')
    const after = await styles()
    expect(look(after[1]!)).toEqual(look(before[0]!))
    expect([after[1]!.height, after[1]!.across]).toEqual([before[1]!.height, before[1]!.across])
    expect(after[0]).toEqual(before[0])

    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await styles())[1], WAIT).toEqual(before[1])
  })
})

async function openExportDialog(): Promise<void> {
  await page.locator('[data-testid="open-export"]').click()
  await page.waitForSelector('[data-testid="export-panel"]', WAIT)
}
