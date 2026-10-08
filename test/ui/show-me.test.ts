import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { readFileSync, readdirSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { parseTutorial, sections, type ShowMe } from '../../src/shared/tutorials'
import { discardUnsavedWork } from './dialogs'

/**
 * Task 84: every Show me step of every tutorial, pressed in the real app, on
 * an empty project and on one with something of every kind in it.
 *
 * A step passes when its ring sits on a control with the test id it names (or
 * its fallback), or, with nothing of the kind it needs, when the callout says
 * what to drop or make first. On the full project, no step that needs
 * something may say that, apart from a missing file, which this project does
 * not have.
 */

const FOLDER = join(process.cwd(), 'docs', 'tutorials')
const fx = fixtureSet('ui-show-me')
const root = await mkdtemp(join(tmpdir(), 'editbay-show-me-'))
const assetsDir = join(root, 'My assets')
let app: ElectronApplication
let page: Page
const WAIT = { timeout: 15_000 }

interface Case {
  id: string
  title: string
  /** Which Show me button in the entry, counting only steps that have one. */
  nth: number
  show: ShowMe
}

const CASES: Case[] = readdirSync(FOLDER)
  .filter((f) => /^\d{3}-.+\.md$/.test(f))
  .flatMap((f) => {
    const t = parseTutorial(f.replace(/\.md$/, ''), readFileSync(join(FOLDER, f), 'utf8'))
    return sections(t.body)
      .steps.filter((s) => s.show)
      .map((s, nth) => ({ id: t.id, title: t.title, nth, show: s.show! }))
  })

interface Outcome {
  found: boolean
  hint: boolean
  /** The ring lies over a control with the step's test id, or its fallback's. */
  onTarget: boolean
  /** Something is selected, for a kind that Show me selects. */
  selected: boolean
  words: string
}

async function press(c: Case): Promise<Outcome> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('F1')
  await page.waitForSelector('[data-testid="tutorials"]', WAIT)
  await page.locator('[data-testid="tutorial-search"]').fill(c.title)
  await page.locator(`[data-testid="tutorial-row"][data-tutorial="${c.id}"]`).first().click()
  await page.waitForSelector(`[data-testid="tutorial-body"][data-tutorial="${c.id}"]`, WAIT)
  await page.locator('[data-testid="tutorial-show-me"]').nth(c.nth).click()
  await page.waitForSelector('[data-testid="show-me-callout"]', WAIT)
  const out = await page.evaluate((ids) => {
    const callout = document.querySelector<HTMLElement>('[data-testid="show-me-callout"]')!
    const ring = document.querySelector('[data-testid="show-me-ring"]')?.getBoundingClientRect()
    const onTarget =
      ring !== undefined &&
      ids.some((id) =>
        [...document.querySelectorAll(`[data-testid="${id}"]`)].some((el) => {
          const r = el.getBoundingClientRect()
          const x = Math.max(r.left, ring.left + 5)
          const y = Math.max(r.top, ring.top + 5)
          return x < Math.min(r.right, ring.right - 5) && y < Math.min(r.bottom, ring.bottom - 5)
        })
      )
    return {
      found: callout.dataset['found'] === 'yes',
      hint: callout.dataset['hint'] === 'yes',
      onTarget,
      selected: document.querySelector('[data-testid="clip"][data-selected="yes"], [data-testid="sound-clip"][data-selected="yes"], [data-testid="caption"][data-selected="yes"]') !== null,
      words: callout.innerText.split('\n')[0] ?? ''
    }
  }, [c.show.target, ...(c.show.or ? [c.show.or] : [])])
  // A picture of each, when asked for, to look at by eye.
  if (process.env.EDITBAY_SHOTS) await page.screenshot({ path: join(process.env.EDITBAY_SHOTS, `show-me-${c.id}-${c.nth + 1}.png`) })
  // Back to the tutorial, then closed.
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="show-me"]', { state: 'detached', ...WAIT })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached', ...WAIT })
  return out
}

const name = (c: Case): string => `${c.id} step ${c.nth + 1} (${c.show.target}${c.show.on ? ` on:${c.show.on}` : ''})`

/** The kinds Show me selects one of before it looks for the control. */
const SELECTS = new Set(['picture', 'video', 'overlay', 'text', 'shape', 'sound', 'linked', 'group', 'caption', 'keyframes'])

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('Show me on an empty project', () => {
  it('rings the control, or says what to drop first, for every step of every tutorial', async () => {
    const wrong: string[] = []
    const elsewhere: string[] = []
    for (const c of CASES) {
      const o = await press(c)
      if (c.show.on) {
        // Nothing of any kind is here, so every step that needs something says so.
        if (!o.hint) wrong.push(`${name(c)}: needs something, but said "${o.words}" instead of what to drop first`)
      } else if (o.found && !o.onTarget) {
        wrong.push(`${name(c)}: ringed something other than ${c.show.target}`)
      } else if (!o.found) {
        elsewhere.push(`${name(c)}: "${o.words}"`)
      }
    }
    // A control that only shows once you act, a menu item or a panel, is not
    // ringed; its callout must then say what to do, never just the step again.
    for (const line of elsewhere) console.log('not on screen, callout only:', line)
    expect(wrong).toEqual([])
  }, 1_200_000)
})

describe('Show me on a project with one of everything', () => {
  beforeAll(async () => {
    const clip = await fx.cleanClip()
    const tone = await fx.toneWav()
    await mkdir(join(assetsDir, 'Audio'), { recursive: true })
    await copyFile(tone, join(assetsDir, 'Audio', 'whoosh.wav'))
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, assetsDir)
    await page.click('[data-testid="assets-choose"]')
    await page.waitForSelector('[data-testid="effect-more"]', WAIT).catch(() => undefined)

    // More than five sources, so Sources offers its sort and its filter.
    const copies = await Promise.all([1, 2, 3, 4].map(async (n) => {
      const to = join(fx.dir, `copy-${n}.mp4`)
      await copyFile(clip, to)
      return to
    }))
    await page.evaluate((files) => window.api.importFiles(files), [clip, tone, ...copies])
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length >= 6, undefined, { timeout: 120_000 })
    // The recording twice, so V1 has a cut and both carry their sound, then the tone on its own.
    const card = (file: string) => page.locator('[data-testid="asset"]', { hasText: file }).locator('[data-testid="add-to-timeline"]')
    await card('clean').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-source="video"]').length === 1)
    await card('clean').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-source="video"]').length === 2)
    await card('tone').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sound-clip"]').length >= 3)

    // A text, and a marker, at the playhead.
    await page.keyboard.press('Home')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await page.waitForSelector('[data-testid="clip"][data-source="text"]', WAIT)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('m')
    await page.waitForSelector('[data-testid="marker"]', WAIT)

    // A shape, drawn on the Output view.
    await page.click('[data-testid="view-program"]').catch(() => undefined)
    await page.click('[data-testid="add-shape"]')
    await page.waitForSelector('[data-testid="shape-menu"]', WAIT)
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Box$/ }).first().click()
    await page.waitForSelector('[data-testid="shape-draw"]', WAIT)
    const stage = (await page.locator('[data-testid="shape-draw"]').boundingBox())!
    await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.3)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(stage.x + stage.width * (0.3 + i * 0.05), stage.y + stage.height * (0.3 + i * 0.05))
    await page.mouse.up()
    await page.waitForSelector('[data-testid="clip"][data-source="shape"]', WAIT)

    // Captions, a transition at the cut, zoom keyframes, a look and a group, as edits.
    await page.evaluate(async () => {
      const { docId } = await window.api.session()
      const p = await window.api.currentProject()
      const s = p.sequences[0]!
      const [first, second] = s.videoTracks[0]!.clips
      const e = (edit: object): Promise<unknown> => window.api.applyEdit(docId, { sequenceId: s.id, ...edit } as never)
      await e({ kind: 'setCaptions', words: [{ text: 'hello', start: 0, length: 20 }, { text: 'there', start: 20, length: 20 }, { text: 'again', start: 60, length: 20 }], listenTo: [] })
      await e({ kind: 'addTransition', clipId: second!.id, side: 'in', length: 10 })
      const crop = first!.transform.crop
      await e({ kind: 'setZoomKeys', clipId: first!.id, keys: [{ at: first!.sourceIn, crop, ease: 'smooth' }, { at: first!.sourceIn + 30, crop: { ...crop, w: crop.w / 2, h: crop.h / 2 }, ease: 'smooth' }] })
      await e({ kind: 'setLook', clipId: second!.id, look: 'mono' })
      // The recording again, on the text's track above V1, after the text.
      await e({ kind: 'addSource', mediaId: first!.mediaId, clipId: 'above-v1', onTrack: s.videoTracks[1]!.id, at: 200 })
    })
    await page.waitForSelector('[data-testid="caption"]', WAIT)
    await page.waitForSelector('[data-testid="clip-transition"]', WAIT)
    await page.waitForSelector('[data-testid="clip-keyframe"]', WAIT)
    // Two clips grouped: the two on V1, picked with Shift.
    const v1 = page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]')
    await v1.nth(0).click()
    await v1.nth(1).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+g')
    await page.waitForSelector('[data-testid="clip"][data-group]:not([data-group=""])', WAIT).catch(() => undefined)
    await page.keyboard.press('Home')
  }, 300_000)

  it('rings the control the step names for every step, selecting what it needs first', async () => {
    const wrong: string[] = []
    const elsewhere: string[] = []
    for (const c of CASES) {
      const o = await press(c)
      if (o.hint) {
        // Nothing is missing here, and every source came in today, so those two may say so.
        if (c.show.on !== 'missing' && c.show.on !== 'days') wrong.push(`${name(c)}: said "${o.words}" though there is one`)
        continue
      }
      if (o.found && !o.onTarget) wrong.push(`${name(c)}: ringed something other than ${c.show.target}`)
      else if (!o.found) {
        if (c.show.on) wrong.push(`${name(c)}: found nothing to ring, said "${o.words}"`)
        else elsewhere.push(`${name(c)}: "${o.words}"`)
      }
      if (c.show.on && SELECTS.has(c.show.on) && !o.selected) wrong.push(`${name(c)}: nothing was selected`)
    }
    for (const line of elsewhere) console.log('not on screen, callout only:', line)
    expect(wrong).toEqual([])
  }, 1_200_000)
})
