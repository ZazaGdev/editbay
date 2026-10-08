import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardUnsavedWork } from './dialogs'

/**
 * Task 34: Apply to all texts. Three texts, two in one sequence and one in
 * another, styled apart; Apply to all on one, once you are sure, gives the
 * other two its look, each keeping its words, alignment, place and timing.
 * Cancel changes nothing, and one undo takes the whole of it back.
 */

const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-apply-all-'))
let app: ElectronApplication
let page: Page

interface Seen {
  mediaId: string
  style: Record<string, unknown>
  /** The middle of its box, and when it plays. */
  middle: [number, number]
  timing: [number, number, number]
}

/** Every text, in the order they were added, with its clip's place and timing. */
async function texts(): Promise<Seen[]> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    const clips = p.sequences.flatMap((s) => s.videoTracks.flatMap((t) => t.clips))
    return p.media
      .filter((m) => m.text !== undefined)
      .map((m) => {
        const c = clips.find((x) => x.mediaId === m.id)!
        const at = c.transform.place
        return {
          mediaId: m.id,
          style: m.text as unknown as Record<string, unknown>,
          middle: [at.x + at.w / 2, at.y + at.h / 2] as [number, number],
          timing: [c.timelineStart, c.sourceIn, c.sourceOut] as [number, number, number]
        }
      })
  })
}

async function selectText(mediaId: string): Promise<void> {
  const tab = await page.evaluate(async (id) => {
    const p = await window.api.currentProject()
    return p.sequences.findIndex((s) => s.videoTracks.some((t) => t.clips.some((c) => c.mediaId === id)))
  }, mediaId)
  await page.locator('[data-testid="sequence-tab"]').nth(tab).click()
  await page.locator(`[data-testid="clip"][data-media-id="${mediaId}"]`).click()
  await page.waitForSelector(`[data-testid="clip"][data-media-id="${mediaId}"][data-selected="yes"]`, WAIT)
  await page.waitForSelector('[data-testid="text-panel"]', WAIT)
}

async function setNumber(testid: string, value: string): Promise<void> {
  await page.click(`[data-testid="${testid}"]`)
  await page.keyboard.press('Control+a')
  await page.keyboard.type(value)
  await page.keyboard.press('Tab')
}

/** Wait for a reading to come to a value, as expect.poll does inside a test. */
async function until(read: () => Promise<unknown>, want: unknown): Promise<void> {
  const end = Date.now() + WAIT.timeout
  while (JSON.stringify(await read()) !== JSON.stringify(want)) {
    if (Date.now() > end) throw new Error(`still ${JSON.stringify(await read())}, not ${JSON.stringify(want)}`)
    await page.waitForTimeout(100)
  }
}

const without = (s: Record<string, unknown>): Record<string, unknown> => ({ ...s, text: '', align: '' })

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.keyboard.press('Control+n')
  // Two texts in the first sequence, one after the other, and a third in a sequence of its own.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('t')
  await page.waitForSelector('[data-testid="clip"]', WAIT)
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('End')
  await page.keyboard.press('t')
  await until(async () => (await texts()).length, 2)
  await page.click('[data-testid="sequence-add"]')
  await page.click('[data-testid="sequence-add-shape"][data-shape="vertical"]')
  await until(() => page.locator('[data-testid="sequence-tab"]').count(), 2)
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('t')
  await until(async () => (await texts()).length, 3)

  // Each looks its own way: the first big, red and bold; the second left aligned and italic; the third as it came.
  const [a, b] = await texts()
  await selectText(a!.mediaId)
  await setNumber('text-size', '140')
  await until(async () => (await texts())[0]!.style.size, 140)
  await page.locator('[data-testid="text-colour"]').fill('#ff0000')
  await page.click('[data-testid="text-bold"]')
  await until(async () => (await texts())[0]!.style.bold, true)
  await selectText(b!.mediaId)
  await page.click('[data-testid="text-align-left"]')
  await page.click('[data-testid="text-italic"]')
  await until(async () => (await texts())[1]!.style.italic, true)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('Apply to all texts', () => {
  it('changes nothing when the question is cancelled', async () => {
    const before = await texts()
    expect(new Set(before.map((t) => JSON.stringify(without(t.style)))).size).toBe(3)
    await selectText(before[0]!.mediaId)
    await page.click('[data-testid="text-apply-all"]')
    expect(await page.textContent('[data-testid="text-apply-all-ask"]')).toContain('All 2 other texts')
    await page.click('[data-testid="text-apply-all-cancel"]')
    await page.waitForSelector('[data-testid="text-apply-all-ask"]', { state: 'detached' })
    await page.waitForTimeout(300)
    expect(await texts()).toEqual(before)
  })

  it('gives every other text, in every sequence, its look, each keeping its words, alignment, place and timing', async () => {
    const before = await texts()
    await page.click('[data-testid="text-apply-all"]')
    await page.click('[data-testid="text-apply-all-confirm"]')
    await expect.poll(async () => (await texts()).every((t) => t.style.size === 140), WAIT).toBe(true)
    const after = await texts()
    for (let i = 0; i < 3; i++) {
      expect(without(after[i]!.style)).toEqual(without(before[0]!.style))
      expect(after[i]!.style.text).toBe(before[i]!.style.text)
      expect(after[i]!.style.align).toBe(before[i]!.style.align)
      expect(after[i]!.timing).toEqual(before[i]!.timing)
    }
    // A centred text keeps its middle; the left aligned one keeps its left edge, so only its middle across moves.
    for (const i of [0, 2]) {
      expect(after[i]!.middle[0]).toBeCloseTo(before[i]!.middle[0], 2)
      expect(after[i]!.middle[1]).toBeCloseTo(before[i]!.middle[1], 2)
    }
    expect(after[1]!.middle[1]).toBeCloseTo(before[1]!.middle[1], 2)
    expect(after[0]!.style).toMatchObject({ colour: '#ff0000', bold: true, italic: false })
  })

  it('takes the whole of it back in one undo', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await texts())[1]!.style.italic, WAIT).toBe(true)
    const back = await texts()
    expect(back[1]!.style.size).not.toBe(140)
    expect(back[2]!.style.size).not.toBe(140)
    expect(back[0]!.style.size).toBe(140)
  })
})
