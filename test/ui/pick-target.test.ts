import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Task 116: Remove background from the command search. Chosen, the pointer
 * becomes a picker with a hint; a clip it can act on lights up and one it
 * cannot shows not-allowed; a click on a clip takes its background out, as the
 * clip menu does; a click on an asset puts it over the selected clip with its
 * background taken out; Enter does it to the selected clip; Escape and a right
 * click leave it with nothing changed. Screenshots go to EDITBAY_PICK_SHOTS
 * when it is set.
 */

const fx = fixtureSet('ui-pick-target')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-pick-'))
const effectsDir = join(root, 'My effects')
const screen = join(root, 'screen.mp4')
const shots = process.env['EDITBAY_PICK_SHOTS']
let app: ElectronApplication
let page: Page
let redId = ''
let screenId = ''

interface Picture {
  id: string
  track: string
  removal: string | null
}

async function pictures(): Promise<Picture[]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks.flatMap((t) =>
      t.clips.map((c) => ({ id: c.id, track: t.id, removal: c.removeBackground?.colour ?? null }))
    )
  )
}

const removalOf = async (id: string): Promise<string | null> => (await pictures()).find((p) => p.id === id)?.removal ?? null
const clip = (id: string): string => `[data-testid="clip"][data-clip-id="${id}"]`
const soundClip = (id: string): string => `[data-testid="sound-clip"][data-clip-id="${id}"]`

async function shot(name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

/** Remove background chosen from the command search, found by typing. */
async function pickRemoveBackground(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ControlOrMeta+k')
  await page.waitForSelector('[data-testid="command-palette"]')
  await page.keyboard.type('rem')
  await page.waitForSelector('[data-testid="command"][data-command="pick:remove-background"]')
  await shot('1-palette')
  await page.click('[data-testid="command"][data-command="pick:remove-background"]')
  await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  await page.waitForSelector('[data-testid="pick-hint"][data-tool="remove-background"]')
}

async function hoverCentre(selector: string): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function selectClip(id: string): Promise<void> {
  const box = (await page.locator(clip(id)).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector(`${clip(id)}[data-selected="yes"]`, WAIT)
}

const picking = (): Promise<string | null> => page.evaluate(() => document.body.getAttribute('data-picking'))

beforeAll(async () => {
  await mkdir(effectsDir, { recursive: true })
  if (shots) await mkdir(shots, { recursive: true })
  const make = (args: string[], path: string): Promise<unknown> => capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, path])
  const onGreen = ['-f', 'lavfi', '-i', 'color=c=0x00B140:s=640x360:r=30:d=2', '-vf', 'drawbox=x=240:y=120:w=160:h=120:color=0xC0C0C0:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast']
  await make(onGreen, screen)
  await make(onGreen, join(effectsDir, 'green star.mp4'))
  const red = await fx.redClip()

  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  for (const path of [red, screen]) {
    const before = await page.locator('[data-testid="clip"][data-kind="video"]').count()
    const [asset] = await page.evaluate((p) => window.api.importFiles([p]), path)
    const card = `[data-testid="asset"][data-asset-id="${asset!.id}"]`
    await page.waitForSelector(`${card}[data-status="ready"]`, { timeout: 120_000 })
    await page.locator(`${card} [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length > n, before)
  }
  ;[redId, screenId] = (await pictures()).map((p) => p.id) as [string, string]

  // The effects folder, chosen in Settings and opened in Sources.
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, effectsDir)
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-tab"][data-tab="Sources"]')
  await page.click('[data-testid="setting-effects-choose"]')
  await page.waitForFunction((dir) => document.querySelector('[data-testid="setting-effects-folder"]')?.textContent === dir, effectsDir, WAIT)
  await page.click('[data-testid="settings-close"]')
  const entry = page.locator('[data-testid="source-folder"][data-kind="effects"]')
  await entry.waitFor(WAIT)
  if ((await entry.getAttribute('data-open')) !== 'yes') await entry.locator('[data-testid="folder-toggle"]').click()
  await page.waitForSelector('[data-testid="folder-file"][data-name="green star.mp4"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('Remove background from the command search', () => {
  it('is found by typing "rem", and Escape leaves the picker with nothing changed', async () => {
    await pickRemoveBackground()
    expect(await picking()).toBe('remove-background')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="pick-hint"]', { state: 'detached' })
    expect(await picking()).toBe(null)
    expect(await removalOf(screenId)).toBe(null)
  })

  it('lights a clip it can act on, and shows not-allowed with the reason on a sound clip', async () => {
    await pickRemoveBackground()
    await hoverCentre(clip(screenId))
    await page.waitForSelector(`${clip(screenId)}[data-pick="yes"]`)
    await shot('2-hover-clip')
    const sound = (await page.locator('[data-testid="sound-clip"]').first().getAttribute('data-clip-id'))!
    await hoverCentre(soundClip(sound))
    await page.waitForSelector(`${soundClip(sound)}[data-pick="no"]`)
    expect(await page.locator(`${clip(screenId)}[data-pick]`).count()).toBe(0)
    expect(await page.textContent('[data-testid="pick-refusal"]')).toContain('picture')
    // A click on it does nothing, and the picker stays.
    await page.mouse.down()
    await page.mouse.up()
    expect(await picking()).toBe('remove-background')
    await shot('3-not-allowed')
  })

  it('a right click leaves it, with no clip menu and nothing changed', async () => {
    const box = (await page.locator(clip(screenId)).boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="pick-hint"]', { state: 'detached' })
    expect(await page.locator('[data-testid="clip-menu"]').count()).toBe(0)
    expect(await removalOf(screenId)).toBe(null)
  })

  it('takes the background out of the clip clicked, as the clip menu does, and selects it', async () => {
    await selectClip(redId)
    await pickRemoveBackground()
    await page.click(clip(screenId))
    await expect.poll(() => removalOf(screenId), WAIT).toBe('green')
    await page.waitForSelector('[data-testid="pick-hint"]', { state: 'detached' })
    await page.waitForSelector(`${clip(screenId)}[data-selected="yes"]`, WAIT)
    expect(await page.textContent('[data-kind="background-removed"]')).toContain('green')
    await shot('4-removed')
    await page.click('[data-testid="tool-remove-background-none"]')
    await expect.poll(() => removalOf(screenId), WAIT).toBe(null)
  })

  it('does it to the selected clip on Enter', async () => {
    await selectClip(screenId)
    await pickRemoveBackground()
    await page.keyboard.press('Enter')
    await expect.poll(() => removalOf(screenId), WAIT).toBe('green')
    await page.waitForSelector('[data-testid="pick-hint"]', { state: 'detached' })
  })

  it('puts an asset clicked over the selected clip, its background taken out', async () => {
    await selectClip(redId)
    const before = (await pictures()).map((p) => p.id)
    await pickRemoveBackground()
    await hoverCentre('[data-testid="folder-file"][data-name="green star.mp4"]')
    await page.waitForSelector('[data-testid="folder-file"][data-name="green star.mp4"][data-pick="yes"]')
    await shot('5-hover-asset')
    await page.click('[data-testid="folder-file"][data-name="green star.mp4"]')
    await page.waitForSelector('[data-testid="pick-hint"]', { state: 'detached' })
    await expect.poll(async () => (await pictures()).filter((p) => !before.includes(p.id)), { timeout: 60_000 }).toEqual([
      expect.objectContaining({ removal: 'green' })
    ])
    const red = (await pictures()).find((p) => p.id === redId)!
    const added = (await pictures()).find((p) => !before.includes(p.id))!
    expect(added.track).not.toBe(red.track)
  })

})

describe('other clip tools from the command search', () => {
  it('lists Make captions for a clip and Show where a clip came from', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    await page.keyboard.type('clip')
    await page.waitForSelector('[data-testid="command"][data-command="pick:captions-for-clip"]')
    await page.waitForSelector('[data-testid="command"][data-command="pick:show-source"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  })
})
