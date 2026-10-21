import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 24: a track you can call something, a picture track you can hide, a
 * colour on a clip, and tracks tall enough to see.
 */

const fx = fixtureSet('ui-tracks')
const root = await mkdtemp(join(tmpdir(), 'editbay-tracks-ui-'))
let app: ElectronApplication
let page: Page
const WAIT = { timeout: 10_000 }

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  const clip = await fx.cleanClip()
  await launch()
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** A track header by its id. */
function header(trackId: string): string {
  return `[data-testid="track-header"][data-track-id="${trackId}"]`
}

/** What V1's header says it is called. */
async function v1Name(): Promise<string> {
  return (await page.locator(`${header('v1')} [data-testid="track-name"]`).textContent()) ?? ''
}

/** Open a track's menu. */
async function openTrackMenu(trackId: string): Promise<void> {
  await page.locator(`${header(trackId)} [data-testid="track-menu-open"]`).click()
  await page.waitForSelector('[data-testid="track-menu"]')
}

/** The first clip on V1, and the sound linked to it. */
async function clipIds(): Promise<{ picture: string; sound: string | undefined }> {
  return page.evaluate(async () => {
    const s = (await window.api.currentProject()).sequences[0]!
    const picture = s.videoTracks[0]!.clips[0]!
    const sound = s.audioTracks[0]!.clips.find((c) => c.link !== undefined && c.link === picture.link)
    return { picture: picture.id, sound: sound?.id }
  })
}

/** What a clip is marked with in the project, or null. */
async function markOf(clipId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const s = (await window.api.currentProject()).sequences[0]!
    const all = [...s.videoTracks.flatMap((r) => r.clips), ...s.audioTracks.flatMap((r) => r.clips)]
    return all.find((c) => c.id === id)?.mark ?? null
  }, clipId)
}

/** How tall V1's row is drawn. */
async function rowHeight(): Promise<number> {
  const box = await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox()
  return box?.height ?? 0
}

describe('a track you have called something', () => {
  it('shows its number until it is named', async () => {
    expect(await v1Name()).toBe('V1')
  })

  /*
    The menu used to open right aligned from a 132 pixel header, so its panel
    hung off the left edge of the window and the timeline's scroll box cut it
    off: an open menu that looked like an empty box.
  */
  it('opens its menu inside the window, with its words on screen', async () => {
    await openTrackMenu('v1')
    const menu = (await page.locator('[data-testid="track-menu"]').boundingBox())!
    expect(menu.x).toBeGreaterThanOrEqual(0)
    expect(menu.width).toBeGreaterThan(100)
    const item = (await page.locator('[data-testid="track-remove"]').boundingBox())!
    expect(item.x).toBeGreaterThanOrEqual(0)
    expect(item.x + item.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
    await page.keyboard.press('Escape')
  })

  /*
    And the one at the foot of the timeline used to drop below the window,
    where the last item could not be reached at all.
  */
  it('opens upwards where there is no room below, so the whole menu is reachable', async () => {
    // The lowest header on the timeline, which is the one with a window edge under it.
    const audio = await page.locator('[data-testid="track-header"]').last().getAttribute('data-track-id')
    await openTrackMenu(audio!)
    const menu = (await page.locator('[data-testid="track-menu"]').boundingBox())!
    const height = await page.evaluate(() => window.innerHeight)
    expect(menu.y).toBeGreaterThanOrEqual(0)
    expect(menu.y + menu.height).toBeLessThanOrEqual(height)
    await page.keyboard.press('Escape')
  })

  it('takes a name from its menu, and keeps it on Enter', async () => {
    await openTrackMenu('v1')
    await page.click('[data-testid="track-rename-open"]')
    await page.waitForSelector('[data-testid="track-rename"]')
    await page.fill(`${header('v1')} [data-testid="track-rename"]`, 'Facecam')
    await page.keyboard.press('Enter')
    await expect.poll(v1Name, WAIT).toBe('Facecam')
  })

  it('goes back to what it was on an undo', async () => {
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(v1Name, WAIT).toBe('V1')
    await page.keyboard.press('ControlOrMeta+y')
    await expect.poll(v1Name, WAIT).toBe('Facecam')
  })

  it('drops what was typed on Escape', async () => {
    await openTrackMenu('v1')
    await page.click('[data-testid="track-rename-open"]')
    await page.fill(`${header('v1')} [data-testid="track-rename"]`, 'Something else')
    await page.keyboard.press('Escape')
    await expect.poll(v1Name, WAIT).toBe('Facecam')
  })

  it('gives its number back when the name is cleared', async () => {
    await openTrackMenu('v1')
    await page.click('[data-testid="track-rename-open"]')
    await page.fill(`${header('v1')} [data-testid="track-rename"]`, '   ')
    await page.keyboard.press('Enter')
    await expect.poll(v1Name, WAIT).toBe('V1')
  })
})

describe('a picture track that is not drawn', () => {
  const hidden = async (): Promise<boolean> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.hidden === true)

  it('is shown to begin with, and the button says so', async () => {
    expect(await hidden()).toBe(false)
    expect(await page.getAttribute(`${header('v1')} [data-testid="track-hide"]`, 'aria-pressed')).toBe('false')
  })

  it('hides on a press, and the row fades rather than emptying', async () => {
    const clips = await page.locator('[data-testid="clip"]').count()
    await page.click(`${header('v1')} [data-testid="track-hide"]`)
    await expect.poll(hidden, WAIT).toBe(true)
    expect(await page.locator('[data-testid="clip"]').count()).toBe(clips)
  })

  it('comes back on an undo, and on a second press', async () => {
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(hidden, WAIT).toBe(false)
    await page.click(`${header('v1')} [data-testid="track-hide"]`)
    await expect.poll(hidden, WAIT).toBe(true)
    await page.click(`${header('v1')} [data-testid="track-hide"]`)
    await expect.poll(hidden, WAIT).toBe(false)
  })

  it('is not offered on a sound track, which is muted instead', async () => {
    expect(await page.locator(`${header('a1')} [data-testid="track-hide"]`).count()).toBe(0)
    expect(await page.locator(`${header('a1')} [data-testid="track-mute"]`).count()).toBe(1)
  })
})

describe('a sound track that ducks', () => {
  const ducks = (): Promise<boolean> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.audioTracks[0]!.duck === true)

  it('is set by D on its header, saved with the project, and undone like any edit', async () => {
    const d = page.locator(`${header('a1')} [data-testid="track-duck"]`)
    expect(await d.getAttribute('aria-pressed')).toBe('false')
    await d.click()
    await expect.poll(ducks, WAIT).toBe(true)
    expect(await d.getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(ducks, WAIT).toBe(false)
  })

  it('is not offered on a video track', async () => {
    expect(await page.locator(`${header('v1')} [data-testid="track-duck"]`).count()).toBe(0)
  })
})

describe('how tall the tracks are', () => {
  it('starts where the timeline has always been', async () => {
    expect(await page.getAttribute('[data-testid="track-size"]', 'data-size')).toBe('small')
  })

  it('steps through the three sizes and back round, each taller than the last', async () => {
    const small = await rowHeight()
    await page.click('[data-testid="track-size"]')
    await expect.poll(async () => page.getAttribute('[data-testid="track-size"]', 'data-size'), WAIT).toBe('medium')
    const medium = await rowHeight()
    expect(medium).toBeGreaterThan(small)

    await page.click('[data-testid="track-size"]')
    await expect.poll(async () => page.getAttribute('[data-testid="track-size"]', 'data-size'), WAIT).toBe('large')
    expect(await rowHeight()).toBeGreaterThan(medium)

    await page.click('[data-testid="track-size"]')
    await expect.poll(async () => page.getAttribute('[data-testid="track-size"]', 'data-size'), WAIT).toBe('small')
    expect(await rowHeight()).toBe(small)
  })
})

describe('a track dragged taller', () => {
  /** How tall a track's row is drawn. */
  const rowHeightOf = async (trackId: string): Promise<number> =>
    (await page.locator(`[data-testid="track"][data-track-id="${trackId}"]`).boundingBox())?.height ?? 0

  it('follows the drag on its bottom edge, and the row follows the header', async () => {
    const was = await rowHeightOf('a1')
    const grip = (await page.locator(`${header('a1')} [data-testid="track-resize"]`).boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 60, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => rowHeightOf('a1'), WAIT).toBeGreaterThan(was + 40)
    // The track above is left where it was: one track at a time.
    expect(await rowHeightOf('v1')).toBeGreaterThan(0)
  })

  it('goes back to the size control on a double click', async () => {
    const tall = await rowHeightOf('a1')
    const grip = (await page.locator(`${header('a1')} [data-testid="track-resize"]`).boundingBox())!
    await page.mouse.dblclick(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await expect.poll(() => rowHeightOf('a1'), WAIT).toBeLessThan(tall)
  })
})

describe('a colour on a clip', () => {
  it('goes on from the clip menu, and on its sound with it', async () => {
    const { picture, sound } = await clipIds()
    expect(sound).toBeDefined()
    expect(await markOf(picture)).toBeNull()

    await page.locator('[data-testid="clip"]').first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="mark-picker"]')
    await page.click('[data-testid="mark-amber"]')
    await expect.poll(async () => markOf(picture), WAIT).toBe('amber')
    expect(await markOf(sound!)).toBe('amber')
  })

  it('draws a band on the clip, and a coloured block on the overview strip', async () => {
    await page.waitForSelector('[data-testid="clip-mark"][data-mark="amber"]')
    await expect.poll(async () => page.locator('[data-testid="overview-block"][data-mark="amber"]').count(), WAIT).toBeGreaterThan(0)
  })

  it('comes off again from the same menu', async () => {
    const { picture } = await clipIds()
    await page.locator('[data-testid="clip"]').first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="mark-picker"]')
    await page.click('[data-testid="mark-none"]')
    await expect.poll(async () => markOf(picture), WAIT).toBeNull()
    // The band follows the project, which comes back from main, so it goes a
    // render after the mark itself does.
    await expect.poll(async () => page.locator('[data-testid="clip-mark"]').count(), WAIT).toBe(0)
  })

  it('undoes as any other edit does', async () => {
    const { picture } = await clipIds()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => markOf(picture), WAIT).toBe('amber')
  })
})
