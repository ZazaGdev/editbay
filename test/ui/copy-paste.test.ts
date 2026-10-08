import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/** Plan 63: clips copied, cut and pasted, a styled text among them. */

const fx = fixtureSet('ui-copy-paste')
const root = await mkdtemp(join(tmpdir(), 'editbay-copy-paste-'))
const WAIT = { timeout: 15_000 }
let app: ElectronApplication
let page: Page

type Seq = { videoTracks: { clips: { id: string; mediaId: string; timelineStart: number; link?: string }[] }[]; audioTracks: { clips: { id: string; link?: string; timelineStart: number }[] }[] }
const sequence = (): Promise<Seq> => page.evaluate(async () => (await window.api.currentProject()).sequences[0]! as unknown as Seq)
const texts = (): Promise<{ id: string; text?: { text: string } }[]> =>
  page.evaluate(async () => (await window.api.currentProject()).media.filter((m) => m.text !== undefined) as unknown as { id: string; text?: { text: string } }[])
const playheadTo = async (frame: number): Promise<void> => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Home')
  for (let i = 0; i < frame / 30; i++) await page.keyboard.press('Shift+ArrowRight')
}

beforeAll(async () => {
  const clean = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clean)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('copy and paste', () => {
  it('pastes a recording again at the playhead, picture and sound linked to each other and not to the original, in one undo', async () => {
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.keyboard.press('Control+c')
    // To the end of the sequence, as far as the playhead goes: the stretch after the clip is free.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('End')
    const end = Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await sequence()).videoTracks[0]!.clips.length, WAIT).toBe(2)
    const s = await sequence()
    const [first, pasted] = s.videoTracks[0]!.clips
    expect(pasted!.timelineStart).toBe(end)
    const sounds = s.audioTracks[0]!.clips
    expect(sounds).toHaveLength(2)
    expect(sounds[1]!.link).toBe(pasted!.link)
    expect(pasted!.link).not.toBe(first!.link)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await sequence()).videoTracks[0]!.clips.length, WAIT).toBe(1)
    expect((await sequence()).audioTracks[0]!.clips).toHaveLength(1)
  })

  it('pastes a text as a text of its own, whose words change without the original', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Home')
    await page.keyboard.press('t')
    await page.waitForSelector('[data-testid="text-panel"]', WAIT)
    await page.keyboard.press('Control+c')
    await playheadTo(300)
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await texts()).length, WAIT).toBe(2)
    // The pasted one is selected: change its words.
    await page.fill('[data-testid="text-words"]', 'Only the copy')
    await expect.poll(async () => (await texts()).map((t) => t.text?.text).sort(), { timeout: 8000 }).toEqual(['Only the copy', 'Your text'])
  })

  it('never pastes over a clip: a taken stretch goes on another track', async () => {
    const tracksBefore = (await sequence()).videoTracks.length
    await page.keyboard.press('Home')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await sequence()).videoTracks.length, WAIT).toBe(tracksBefore + 1)
    // What was there is still there.
    expect((await sequence()).videoTracks[0]!.clips[0]!.timelineStart).toBe(0)
  })

  it('keeps Ctrl+C and Ctrl+V for a field while typing in it', async () => {
    const before = (await texts()).length
    await page.click('[data-testid="text-words"]')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    await page.keyboard.press('End')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)
    expect((await texts()).length).toBe(before)
  })

  it('cuts a clip, leaving a gap, and pastes it from the gap’s menu', async () => {
    await page.locator('[data-testid="timecode"]').click()
    const first = (await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').first().boundingBox())!
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
    // A second clip after it, so taking the first away leaves a gap rather than an empty track.
    await page.keyboard.press('Control+c')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('End')
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await sequence()).videoTracks[0]!.clips.length, WAIT).toBe(2)
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
    const count = (await sequence()).videoTracks[0]!.clips.length
    await page.keyboard.press('Control+x')
    await expect.poll(async () => (await sequence()).videoTracks[0]!.clips.length, WAIT).toBe(count - 1)
    // Right click the gap it left, and paste there.
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2, { button: 'right' })
    await page.click('[data-testid="gap-menu-paste"]')
    await expect.poll(async () => (await sequence()).videoTracks[0]!.clips.length, WAIT).toBe(count)
    expect((await sequence()).videoTracks[0]!.clips[0]!.timelineStart).toBe(0)
  })
})
