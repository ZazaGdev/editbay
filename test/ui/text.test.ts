import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 44: text over the video. Added with T at the playhead, above V1, typed
 * in the Inspector, drawn in the Output view, and scaled by a corner of its
 * box, which draws it again at the new size.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-text-ui-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function rgbAt(x: number, y: number): Promise<[number, number, number]> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  const file = join(root, `shot-${Date.now()}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale)
  const py = Math.round((y - box.y) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${px}:${py},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0]
}

type Media = { id: string; width: number; height: number; playablePath: string; text?: { text: string; size: number } }
const texts = (): Promise<Media[]> =>
  page.evaluate(async () => (await window.api.currentProject()).media.filter((m) => m.text !== undefined) as unknown as Media[])

describe('text', () => {
  it('goes on above V1 at the playhead with T, selected, with its Text section open', async () => {
    await page.keyboard.press('Control+n')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await page.waitForSelector('[data-testid="clip"]', { timeout: 10_000 })
    const tracks = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks.map((r) => r.clips.length))
    expect(tracks).toEqual([0, 1])
    expect(await page.getAttribute('[data-testid="clip"]', 'data-length-frames')).toBe('150')
    await page.waitForSelector('[data-testid="text-panel"]')
    expect(await page.inputValue('[data-testid="text-words"]')).toBe('Your text')
    const [t] = await texts()
    expect(t!.text!.text).toBe('Your text')
    // Not in the bin: a text is not a file.
    expect(await page.locator('[data-testid="asset"]').count()).toBe(0)
  })

  it('shows its words on the timeline once, as small as a clip name, with a T, and no drawn picture', async () => {
    const clip = page.locator('[data-testid="clip"]').first()
    await clip.locator('[data-testid="clip-text"]').waitFor()
    expect(await clip.locator('[data-testid="clip-name"]').innerText()).toContain('Your text')
    const pictures = await clip.evaluate((el) =>
      Array.from(el.querySelectorAll('*')).filter((x) => getComputedStyle(x).backgroundImage.startsWith('url(')).length
    )
    expect(pictures).toBe(0)
  })

  it('is drawn in the Output view, white letters over black', async () => {
    await page.keyboard.press('Home')
    await page.click('[data-testid="view-program"]')
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'text-drawn.png') })
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    // Somewhere in the middle row of the box there is a white letter.
    let white = false
    for (let i = 1; i < 12 && !white; i++) {
      const [r, g, b] = await rgbAt(box.x + (box.width * i) / 12, box.y + box.height / 2)
      white = r > 200 && g > 200 && b > 200
    }
    expect(white).toBe(true)
  })

  it('is drawn again as it is typed, one undo step for the whole of it', async () => {
    const before = (await texts())[0]!
    await page.fill('[data-testid="text-words"]', 'A much longer line of words')
    await expect.poll(async () => (await texts())[0]!.text!.text, { timeout: 5000 }).toBe('A much longer line of words')
    const after = (await texts())[0]!
    expect(after.width).toBeGreaterThan(before.width)
    expect(after.playablePath).not.toBe(before.playablePath)
    // The box took the new picture's size, about its old middle.
    const place = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips[0]!.transform.place)
    expect(place.w * 1080).toBeCloseTo(after.width, 0)
    await page.locator('[data-testid="text-words"]').blur()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await texts())[0]!.text!.text, { timeout: 5000 }).toBe('Your text')
  })

  it('grows from a corner, and is drawn again sharp at the size it was dragged to', async () => {
    const before = (await texts())[0]!
    const corner = (await page.locator('[data-testid="place-se"]').boundingBox())!
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(corner.x + (box.width / 2) * (i / 6), corner.y + (box.height / 2) * (i / 6))
    await page.mouse.up()
    await expect.poll(async () => (await texts())[0]!.text!.size, { timeout: 5000 }).toBeGreaterThan(before.text!.size * 1.3)
    const after = (await texts())[0]!
    expect(after.width).toBeGreaterThan(before.width * 1.3)
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'text-grown.png') })
  })

  it('undoes the whole of the growing in one step, and is not drawn again after it, so it can be redone', async () => {
    const boxWidth = async (): Promise<number> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips[0]!.transform.place.w)
    const grownWidth = await boxWidth()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    // Back to its size before the drag: the redraw was part of the drag, not a step of its own.
    await expect.poll(async () => (await texts())[0]!.text!.size, { timeout: 5000 }).toBe(96)
    await expect.poll(boxWidth, { timeout: 5000 }).toBeLessThan(grownWidth)
    // Given time to draw itself again, which it must not.
    await page.waitForTimeout(800)
    expect((await texts())[0]!.text!.size).toBe(96)
    await page.keyboard.press('Control+y')
    await expect.poll(boxWidth, { timeout: 5000 }).toBeCloseTo(grownWidth, 2)
  })
})

describe('typing into a text on the Output view', () => {
  const words = async (): Promise<string> => (await texts())[0]!.text!.text
  const placeNow = (): Promise<unknown> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips[0]!.transform.place)

  it('opens on a double click, even with nothing selected, and keeps the editor keys for the words', async () => {
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]', { state: 'detached' })
    const before = await placeNow()
    const clips = await page.locator('[data-testid="clip"]').count()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-testid="text-edit-box"]')
    // Selected by the same double click, with its handles out of the way.
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
    expect(await page.locator('[data-testid="place-rect"]').count()).toBe(0)
    // Every word selected, so typing replaces them; T and Space type, and add no text.
    await page.keyboard.type('Hi there t')
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'text-typed-in-place.png') })
    expect(await page.inputValue('[data-testid="text-edit-box"]')).toBe('Hi there t')
    expect(await page.locator('[data-testid="clip"]').count()).toBe(clips)
    // The Inspector's words follow the typing.
    expect(await page.inputValue('[data-testid="text-words"]')).toBe('Hi there t')
    // Enter is a new line; Ctrl+Enter finishes.
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Control+Enter')
    await page.waitForSelector('[data-testid="text-edit-box"]', { state: 'detached' })
    await expect.poll(words, { timeout: 5000 }).toBe('Hi there t' + String.fromCharCode(10) + 'two')
    // The double click moved nothing.
    expect((await placeNow() as { x: number }).x).toBeCloseTo((before as { x: number }).x, 1)
  })

  // Bugs and notes 2, note 26.
  it('draws the letters at one size from the first letter, and only the box follows the words', async () => {
    await page.waitForSelector('[data-testid="place-rect"]')
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-testid="text-edit-box"]')
    const size = (): Promise<string> => page.locator('[data-testid="text-edit-box"]').evaluate((e) => getComputedStyle(e).fontSize)
    const before = await size()
    await page.keyboard.type('S')
    expect(await size()).toBe(before)
    await page.keyboard.type('OME MORE WORDS')
    expect(await size()).toBe(before)
    await page.keyboard.press('Backspace')
    expect(await size()).toBe(before)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="text-edit-box"]', { state: 'detached' })
  })

  it('takes the whole of the typing back in one undo', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(words, { timeout: 5000 }).not.toBe('Hi there t' + String.fromCharCode(10) + 'two')
    expect(await words()).not.toContain('Hi there')
  })

  it('puts the words back on Escape, and finishes on a press elsewhere', async () => {
    const before = await words()
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-testid="text-edit-box"]')
    await page.keyboard.type('Thrown away')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="text-edit-box"]', { state: 'detached' })
    await page.waitForTimeout(400)
    expect(await words()).toBe(before)

    const again = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.dblclick(again.x + again.width / 2, again.y + again.height / 2)
    await page.waitForSelector('[data-testid="text-edit-box"]')
    await page.keyboard.type('Kept')
    await page.locator('[data-testid="clip"]').first().click()
    await page.waitForSelector('[data-testid="text-edit-box"]', { state: 'detached' })
    await expect.poll(words, { timeout: 5000 }).toBe('Kept')
  })
})

describe('a field left for the ruler or the picture', () => {
  const focused = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
  const words = async (): Promise<string> => (await texts())[0]!.text!.text

  it('lets go of the words box when the Output view is pressed, applying them', async () => {
    await page.locator('[data-testid="clip"]').first().click()
    await page.click('[data-testid="text-words"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('From the picture')
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(await focused()).not.toBe('text-words')
    await expect.poll(words, { timeout: 5000 }).toBe('From the picture')
  })

  it('lets go of it when the ruler is pressed, so Delete takes the clip rather than a letter', async () => {
    await page.click('[data-testid="text-words"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('From the ruler')
    const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
    const clip = (await page.locator('[data-testid="clip"]').first().boundingBox())!
    await page.mouse.click(clip.x + 4, ruler.y + ruler.height / 2)
    expect(await focused()).not.toBe('text-words')
    await expect.poll(words, { timeout: 5000 }).toBe('From the ruler')
    await page.keyboard.press('Delete')
    await page.waitForSelector('[data-testid="clip"]', { state: 'detached' })
  })
})

describe('lining a text up', () => {
  const place = (): Promise<{ x: number; y: number; w: number; h: number }> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips[0]!.transform.place)

  it('puts it against a side of the frame, a little in, or in the middle, from the Frame section', async () => {
    await page.keyboard.press('Control+n')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await page.waitForSelector('[data-testid="text-panel"]', { timeout: 10_000 })
    await page.click('[data-testid="in-frame-left"]')
    await expect.poll(async () => Math.round((await place()).x * 1080), { timeout: 5000 }).toBe(54)
    await page.click('[data-testid="in-frame-bottom"]')
    await expect.poll(async () => {
      const p = await place()
      return Math.round((p.y + p.h) * 1920)
    }, { timeout: 5000 }).toBe(1920 - 54)
  })

  it('keeps its left edge where it is as it grows, once aligned left', async () => {
    await page.click('[data-testid="text-align-left"]')
    await page.waitForTimeout(300)
    const before = await place()
    await page.fill('[data-testid="text-words"]', 'A much longer line of words here')
    await expect.poll(async () => (await place()).w, { timeout: 5000 }).toBeGreaterThan(before.w)
    expect(Math.round((await place()).x * 1080)).toBe(Math.round(before.x * 1080))
  })

  it('carries no mark for being placed, which every text is', async () => {
    expect(await page.locator('[data-testid="clip"] [data-testid="clip-mark-effect"]').count()).toBe(0)
  })
})

describe('typing in the words box, with pauses', () => {
  // The text added here, the last one: the tests before may leave another in the project.
  const words = async (): Promise<string> => (await texts()).at(-1)!.text!.text
  const caret = (): Promise<number> =>
    page.evaluate(() => (document.querySelector('[data-testid="text-words"]') as HTMLTextAreaElement).selectionStart)

  it('keeps every letter typed while the words sent before are drawn, and the caret where it is', async () => {
    await page.keyboard.press('Control+n')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await page.waitForSelector('[data-testid="text-words"]', { timeout: 10_000 })
    await page.click('[data-testid="text-words"]')
    await page.keyboard.press('Control+a')
    // Each pause longer than the moment before the words are sent, so each word
    // is being drawn while the next one is typed.
    const sentence = ['Every ', 'letter ', 'typed ', 'stays ', 'put']
    for (const w of sentence) {
      await page.keyboard.type(w, { delay: 40 })
      await page.waitForTimeout(420)
    }
    const all = sentence.join('')
    expect(await page.inputValue('[data-testid="text-words"]')).toBe(all)
    await expect.poll(words, { timeout: 5000 }).toBe(all)

    // Into the middle, after "Every ", and the letters go there however long the redraw takes.
    await page.evaluate(() => {
      const box = document.querySelector('[data-testid="text-words"]') as HTMLTextAreaElement
      box.setSelectionRange(6, 6)
    })
    for (const letter of ['x', 'y']) {
      await page.keyboard.type(letter)
      await page.waitForTimeout(700)
    }
    expect(await caret()).toBe(8)
    expect(await page.inputValue('[data-testid="text-words"]')).toBe('Every xyletter typed stays put')
    await expect.poll(words, { timeout: 5000 }).toBe('Every xyletter typed stays put')
  })
})

describe('a new text (bugs and notes 2, note 26)', () => {
  it('starts as the text last changed looks, with its own words, until Reset to default', async () => {
    const newest = async (): Promise<Media> => (await texts()).at(-1)!
    // The last text changed to 48 pixels.
    await page.locator('[data-testid="clip"][data-selected="yes"]').first().waitFor()
    await page.fill('[data-testid="text-size"]', '48')
    await page.press('[data-testid="text-size"]', 'Enter')
    await expect.poll(async () => (await newest()).text!.size, { timeout: 5000 }).toBe(48)
    const count = (await texts()).length
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await expect.poll(async () => (await texts()).length, { timeout: 5000 }).toBe(count + 1)
    expect((await newest()).text).toMatchObject({ size: 48, text: 'Your text' })
    // Reset to default gives the built-in size back, and the next new text starts there.
    await page.click('[data-testid="text-reset"]')
    await expect.poll(async () => (await newest()).text!.size, { timeout: 5000 }).toBe(96)
    expect((await page.evaluate(() => window.api.appSettings())).textStyle?.size).toBe(96)
  })
})

describe('a number in the Text group (bugs and notes 2, note 28)', () => {
  type Styled = { text: { size: number; outlineWidth: number } }
  const newest = async (): Promise<Styled> => (await texts()).at(-1)! as unknown as Styled
  const WAIT = { timeout: 5000 }

  it('changes the text as it is typed and stepped, and Escape puts back what it had', async () => {
    await page.locator('[data-testid="clip"][data-selected="yes"]').first().waitFor()
    const was = (await newest()).text.size
    await page.click('[data-testid="text-size"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('61')
    // No Enter: it is drawn a moment after the typing rests.
    await expect.poll(async () => (await newest()).text.size, WAIT).toBe(61)
    for (const size of [62, 63, 64]) {
      await page.keyboard.press('ArrowUp')
      await expect.poll(async () => (await newest()).text.size, WAIT).toBe(size)
    }
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await newest()).text.size, WAIT).toBe(was)
    expect(await page.inputValue('[data-testid="text-size"]')).toBe(String(was))
  })

  it('takes a whole visit to the box back in one undo', async () => {
    const was = (await newest()).text.size
    await page.click('[data-testid="text-size"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('70')
    await expect.poll(async () => (await newest()).text.size, WAIT).toBe(70)
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await newest()).text.size, WAIT).toBe(69)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await newest()).text.size, WAIT).toBe(was)
  })

  it('does the same for the outline width', async () => {
    await page.click('[data-testid="text-outline"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('5')
    await expect.poll(async () => (await newest()).text.outlineWidth, WAIT).toBe(5)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await newest()).text.outlineWidth, WAIT).not.toBe(5)
  })
})

describe('a glow and saved text styles (plan 99)', () => {
  type Styled = { playablePath: string; text: { text: string; glow: boolean; glowColour: string; size: number } }
  const newest = async (): Promise<Styled> => (await texts()).at(-1)! as unknown as Styled
  const WAIT = { timeout: 5000 }
  /** How many pixels of a text's drawn picture are the glow's green. */
  const green = async (path: string): Promise<number> => {
    const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
    let n = 0
    for (let i = 0; i + 3 < stdout.length; i += 4) if (stdout[i + 3]! > 40 && stdout[i + 1]! > 150 && stdout[i]! < 100 && stdout[i + 2]! < 100) n++
    return n
  }

  it('draws a glow round the letters in its colour, into the picture the export reads', async () => {
    await page.locator('[data-testid="clip"][data-selected="yes"]').first().waitFor()
    expect(await green((await newest()).playablePath)).toBe(0)
    await page.click('[data-testid="text-glow"]')
    await expect.poll(async () => (await newest()).text.glow, WAIT).toBe(true)
    await page.locator('[data-testid="text-glow-colour"]').fill('#00ff00')
    await expect.poll(async () => (await newest()).text.glowColour, WAIT).toBe('#00ff00')
    await expect.poll(async () => green((await newest()).playablePath), WAIT).toBeGreaterThan(500)
  })

  it('saves the look under a name and puts it back on in one click, keeping the words, in one undo', async () => {
    // Its own look to save: a green glow, whatever the test above left.
    await page.locator('[data-testid="clip"][data-selected="yes"]').first().waitFor()
    if (!(await newest()).text.glow) await page.click('[data-testid="text-glow"]')
    await expect.poll(async () => (await newest()).text.glow, WAIT).toBe(true)
    await page.locator('[data-testid="text-glow-colour"]').fill('#00ff00')
    await expect.poll(async () => (await newest()).text.glowColour, WAIT).toBe('#00ff00')
    await page.click('[data-testid="text-saved-save"]')
    await page.fill('[data-testid="text-saved-name"]', 'Neon')
    await page.click('[data-testid="text-saved-confirm"]')
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).savedTextStyles.map((s) => s.name), WAIT).toEqual(['Neon'])
    // Never among the caption styles.
    expect((await page.evaluate(() => window.api.appSettings())).savedCaptionStyles).toEqual([])
    // Glow off and a new size, then the saved look back on.
    await page.click('[data-testid="text-glow"]')
    await expect.poll(async () => (await newest()).text.glow, WAIT).toBe(false)
    const words = (await newest()).text.text
    await page.click('[data-testid="text-saved-use"][data-name="Neon"]')
    await expect.poll(async () => (await newest()).text.glow, WAIT).toBe(true)
    expect((await newest()).text).toMatchObject({ glowColour: '#00ff00', text: words })
    // Forgotten with its x.
    await page.click('[data-testid="text-saved-remove"][data-name="Neon"]')
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).savedTextStyles, WAIT).toEqual([])
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await newest()).text.glow, WAIT).toBe(false)
  })
})

describe('the font list', () => {
  it('offers the fonts installed on this PC, not only the stand-ins', async () => {
    const count = await page.evaluate(async () => {
      const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
      return q ? new Set((await q()).map((f) => f.family)).size : 0
    })
    // A Windows machine has far more than the thirteen fallbacks.
    expect(count).toBeGreaterThan(20)
  })
})

describe('deleting a text', () => {
  it('leaves the playhead where it is and nothing selected, rather than going to the next or last text', async () => {
    const playhead = async (): Promise<number> => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    const count = (n: number): Promise<unknown> =>
      page.waitForFunction((k) => document.querySelectorAll('[data-testid="clip"]').length === k, n, { timeout: 10_000 })
    const blur = (): Promise<void> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+n')
    // The new project here before anything is pressed: New keeps the work it
    // replaces as an earlier version first (plan 84), which takes a moment.
    await page.waitForFunction(() => document.title === 'Untitled - Editbay' && document.querySelectorAll('[data-testid="clip"]').length === 0)
    await blur()
    // Three texts one after another, each from where the one before ends.
    for (let n = 1; n <= 3; n++) {
      await page.keyboard.press('End')
      await page.keyboard.press('t')
      await count(n)
      await blur()
    }
    // A second into the middle one, with it selected.
    await page.locator('[data-testid="clip"][data-start="150"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(playhead).toBe(180)
    expect(await page.getAttribute('[data-testid="clip"][data-selected="yes"]', 'data-start')).toBe('150')

    await page.keyboard.press('Delete')
    await count(2)
    // Give the selection that used to follow a moment to arrive, then check it did not.
    await page.waitForTimeout(300)
    expect(await playhead()).toBe(180)
    expect(await page.locator('[data-testid="clip"][data-selected="yes"]').count()).toBe(0)
  })
})
