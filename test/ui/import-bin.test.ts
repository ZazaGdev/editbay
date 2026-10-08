import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { appendFile, copyFile, mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Plan 13, step 5: import and OBS. Every dropped file shown at once, each
 * stage in words, cancel, retry and remove, search and sort, where a source
 * is used, scrubbing a card's picture, and recordings from OBS's folder.
 */

const fx = fixtureSet('ui-import-bin')
const root = await mkdtemp(join(tmpdir(), 'editbay-import-bin-'))
/** A stand-in for %APPDATA%, holding OBS settings that point at `obsFolder`. */
const obsAppData = join(root, 'appdata')
const obsFolder = join(root, 'OBS recordings')
let app: ElectronApplication
let page: Page
let cleanPath: string
let vfrPath: string
/** Needs converting, and takes long enough that the files after it are seen waiting. */
let slowPath: string
let counter = 0

async function makeSlowClip(path: string): Promise<void> {
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=120',
    '-c:v', 'mpeg4', '-q:v', '20', path
  ])
}

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  vfrPath = await fx.vfrClip()
  slowPath = join(root, 'slow.avi')
  await makeSlowClip(slowPath)
  // OBS as it is set up on the owner's machine: a profile in Advanced mode,
  // named in user.ini, with one recording already in its folder.
  await mkdir(join(obsAppData, 'obs-studio', 'basic', 'profiles', 'Wide_recording'), { recursive: true })
  await writeFile(join(obsAppData, 'obs-studio', 'user.ini'), '[Basic]\r\nProfile=Wide recording\r\nProfileDir=Wide_recording\r\n')
  await writeFile(
    join(obsAppData, 'obs-studio', 'basic', 'profiles', 'Wide_recording', 'basic.ini'),
    `﻿[Output]\r\nMode=Advanced\r\n[AdvOut]\r\nRecFilePath=${obsFolder.replace(/\\/g, '\\\\')}\r\n`
  )
  await mkdir(obsFolder, { recursive: true })
  await copyFile(cleanPath, join(obsFolder, '2026-09-22 00-09-13.mkv'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_OBS_APPDATA: obsAppData }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function fresh(): Promise<void> {
  // Out of the search box, which keeps keys for itself, as a text box does.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"]').length === 0)
}

/** A copy of a file, named `name`, in a folder of its own, so the bin sees a new file. */
async function copyOf(path: string, name: string): Promise<string> {
  counter += 1
  const dir = join(root, `copy-${counter}`)
  await mkdir(dir, { recursive: true })
  const to = join(dir, name)
  await copyFile(path, to)
  return to
}

function card(name: string): string {
  return `[data-testid="asset"]:has(div[title$="${name}"])`
}

async function statusOf(name: string): Promise<string> {
  return (await page.locator(`${card(name)} [data-testid="asset-status"]`).textContent()) ?? ''
}

async function allSettled(): Promise<void> {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="asset"]')].every((e) =>
        ['ready', 'failed'].includes(e.getAttribute('data-status') ?? '')
      ),
    null,
    { timeout: 180_000 }
  )
}

describe('importing', () => {
  beforeEach(fresh)

  it('shows every dropped file at once, the ones behind marked waiting, and says what the one in front is doing', async () => {
    const slow = await copyOf(slowPath, 'slow.avi')
    const a = await copyOf(cleanPath, 'a.mp4')
    const b = await copyOf(cleanPath, 'b.mp4')
    void page.evaluate((p) => window.api.importFiles(p), [slow, a, b])
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"]').length === 3)
    await page.waitForSelector(`${card('slow.avi')}[data-status="conforming"]`, { timeout: 60_000 })
    expect(await page.getAttribute(card('a.mp4'), 'data-status')).toBe('queued')
    expect(await statusOf('a.mp4')).toBe('waiting')
    expect(await statusOf('b.mp4')).toBe('waiting')
    // Converting, with how far it has got, and in time how long it has left.
    expect(await statusOf('slow.avi')).toMatch(/^converting, \d+%/)
    await page.waitForFunction(
      (sel) => /^converting, \d+%, about .+ left$/.test(document.querySelector(sel)?.textContent ?? ''),
      `${card('slow.avi')} [data-testid="asset-status"]`,
      { timeout: 60_000 }
    )
    // Stopped then and there, not left to finish converting.
    await page.locator(`${card('slow.avi')} [data-testid="asset-cancel"]`).click()
    await page.waitForSelector(card('slow.avi'), { state: 'detached', timeout: 5000 })
    await allSettled()
  }, 300_000)

  it('takes a waiting file off the queue with Cancel, and imports the rest', async () => {
    const slow = await copyOf(slowPath, 'slow.avi')
    const a = await copyOf(cleanPath, 'a.mp4')
    const b = await copyOf(cleanPath, 'b.mp4')
    void page.evaluate((p) => window.api.importFiles(p), [slow, a, b])
    await page.waitForSelector(`${card('a.mp4')}[data-status="queued"]`)
    await page.locator(`${card('a.mp4')} [data-testid="asset-cancel"]`).click()
    await page.waitForSelector(card('a.mp4'), { state: 'detached' })
    // The one converting is stopped too, and b goes next.
    await page.locator(`${card('slow.avi')} [data-testid="asset-cancel"]`).click()
    await page.waitForSelector(card('slow.avi'), { state: 'detached' })
    await page.waitForSelector(`${card('b.mp4')}[data-status="ready"]`, { timeout: 60_000 })
    expect(await page.locator('[data-testid="asset"]').count()).toBe(1)
  }, 300_000)

  it('says in plain words why a file could not be imported, with the details a click away, and can try again or remove it', async () => {
    const bad = join(root, `notes-${++counter}.mp4`)
    await writeFile(bad, 'not a video')
    void page.evaluate((p) => window.api.importFiles(p), [bad])
    await page.waitForSelector('[data-testid="asset"][data-status="failed"]', { timeout: 60_000 })
    expect(await page.textContent('[data-testid="asset-status"]')).toBe(
      'This file could not be read. It may be damaged, or not a video or sound file.'
    )
    expect(await page.locator('[data-testid="asset-details"]').count()).toBe(0)
    await page.click('[data-testid="asset-details-toggle"]')
    expect(await page.textContent('[data-testid="asset-details"]')).toMatch(/ffprobe/)

    // Mended, and tried again on the same card.
    const id = await page.getAttribute('[data-testid="asset"]', 'data-asset-id')
    await copyFile(cleanPath, bad)
    await page.click('[data-testid="asset-retry"]')
    await page.waitForSelector(`[data-testid="asset"][data-asset-id="${id}"][data-status="ready"]`, { timeout: 60_000 })

    // Another that fails: Remove takes it away.
    const bad2 = join(root, `notes-${++counter}.mp4`)
    await writeFile(bad2, 'nothing')
    void page.evaluate((p) => window.api.importFiles(p), [bad2])
    await page.waitForSelector('[data-testid="asset"][data-status="failed"]', { timeout: 60_000 })
    await page.click('[data-testid="asset"][data-status="failed"] [data-testid="asset-remove"]')
    await page.waitForSelector('[data-testid="asset"][data-status="failed"]', { state: 'detached' })
    expect(await page.locator('[data-testid="asset"]').count()).toBe(1)
  }, 240_000)

  it('says in plain words why a source was converted', async () => {
    const vfr = await copyOf(vfrPath, 'vfr.mkv')
    await page.evaluate((p) => window.api.importFiles(p), [vfr])
    await page.waitForSelector(`${card('vfr.mkv')}[data-status="ready"]`, { timeout: 120_000 })
    expect(await page.textContent(`${card('vfr.mkv')} [data-testid="asset-converted"]`)).toBe(
      'Converted on import because its frame timing varies.'
    )
  }, 180_000)
})

describe('the bin', () => {
  beforeEach(fresh)

  it('says where each source is used, and takes out one that is not, but not one that is', async () => {
    const a = await copyOf(cleanPath, 'a.mp4')
    const b = await copyOf(cleanPath, 'b.mp4')
    await page.evaluate((p) => window.api.importFiles(p), [a, b])
    await allSettled()
    expect(await page.textContent(`${card('a.mp4')} [data-testid="asset-usage"]`)).toBe('not on the timeline')
    await page.locator(`${card('a.mp4')} [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.textContent === 'in 1 clip',
      `${card('a.mp4')} [data-testid="asset-usage"]`
    )

    // In use: Remove is there, greyed, with the reason behind it.
    await page.locator(card('a.mp4')).click({ button: 'right' })
    await page.waitForSelector('[data-testid="asset-menu"]')
    expect(await page.isDisabled('[data-testid="asset-menu-remove"]')).toBe(true)
    expect(await page.getAttribute('[data-testid="asset-menu-remove"]', 'title')).toBe('In 1 clip. Delete that clip first.')
    await page.keyboard.press('Escape')

    // Not in use: out of the bin and the project.
    await page.locator(card('b.mp4')).click({ button: 'right' })
    await page.click('[data-testid="asset-menu-remove"]')
    await page.waitForSelector(card('b.mp4'), { state: 'detached' })
    const media = await page.evaluate(() => window.api.currentProject().then((p) => p.media.map((m) => m.originalPath)))
    expect(media.some((m) => m.endsWith('b.mp4'))).toBe(false)
    expect(media.some((m) => m.endsWith('a.mp4'))).toBe(true)

    // Undone back to before a was placed, and a can go too; undone further, it comes back with its clip.
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
    await page.locator(card('a.mp4')).click({ button: 'right' })
    await page.click('[data-testid="asset-menu-remove"]')
    await page.waitForSelector(card('a.mp4'), { state: 'detached' })
    await page.keyboard.press('Control+Shift+z')
    await page.waitForSelector('[data-testid="clip"]')
    await page.waitForSelector(card('a.mp4'))
  }, 180_000)

  it('clears the notice about missing files when a missing source is removed, or comes back on Retry', async () => {
    const footage = join(root, `footage-${++counter}`)
    await mkdir(footage)
    await copyFile(cleanPath, join(footage, 'kept.mp4'))
    await copyFile(cleanPath, join(footage, 'spare.mp4'))
    await page.evaluate((p) => window.api.importFiles(p), [join(footage, 'kept.mp4'), join(footage, 'spare.mp4')])
    await allSettled()
    await page.locator(`${card('kept.mp4')} [data-testid="add-to-timeline"]`).click()
    await page.waitForSelector('[data-testid="clip"]')
    const saved = join(root, `missing-${counter}.editbay`)
    await answerSaveDialog(app, saved)
    await page.keyboard.press('Control+Shift+s')
    for (let i = 0; i < 100 && !(await stat(saved).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100))

    // Both files go, and the project is opened again.
    const away = `${footage}-away`
    await rename(footage, away)
    await fresh()
    await page.evaluate((p) => window.api.openProject(p), saved)
    await page.waitForSelector('[data-testid="missing-media"]', { timeout: 15_000 })
    expect(await page.locator('[data-testid="relink"]').count()).toBe(2)

    // The unused one is taken out: the notice no longer offers to find it.
    await page.click(`${card('spare.mp4')} [data-testid="asset-remove"]`)
    await page.waitForSelector(card('spare.mp4'), { state: 'detached' })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="relink"]').length === 1)

    // The used one's file is put back, and Retry brings it and its clips back.
    await rename(away, footage)
    await page.click(`${card('kept.mp4')} [data-testid="asset-retry"]`)
    await page.waitForSelector(`${card('kept.mp4')}[data-status="ready"]`, { timeout: 60_000 })
    await page.waitForSelector('[data-testid="missing-media"]', { state: 'detached' })
    expect(await page.locator('[data-testid="clip"][data-offline="yes"]').count()).toBe(0)
  }, 240_000)

  it('offers sort once it holds more than five sources, and searches them by name', async () => {
    const names = ['e.mp4', 'b.mp4', 'd.mp4', 'a.mp4', 'c.mp4']
    const paths: string[] = []
    for (const n of names) paths.push(await copyOf(cleanPath, n))
    await page.evaluate((p) => window.api.importFiles(p), paths)
    await allSettled()
    expect(await page.locator('[data-testid="bin-sort"]').count()).toBe(0)
    await page.evaluate((p) => window.api.importFiles(p), [await copyOf(cleanPath, 'f.mp4')])
    await allSettled()
    await page.waitForSelector('[data-testid="bin-sort"]')
    await page.fill('[data-testid="sources-search"]', 'd.mp4')
    await expect.poll(() => page.locator('[data-testid="asset"]').count()).toBe(1)
    await page.fill('[data-testid="sources-search"]', 'nothing like it')
    await page.waitForSelector('[data-testid="sources-nothing-found"]')
    await page.fill('[data-testid="sources-search"]', '')
    await page.selectOption('[data-testid="bin-sort"]', 'name')
    const order = await page
      .locator('[data-testid="asset"] div[title]')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('title') ?? '').split(/[\\/]/).pop()))
    expect(order).toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4', 'f.mp4'])

    // Added puts the newest at the top: the one just brought in is the one
    // about to be used, and it used to be at the bottom of a growing list.
    await page.selectOption('[data-testid="bin-sort"]', 'added')
    const byAdded = await page
      .locator('[data-testid="asset"] div[title]')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('title') ?? '').split(/[\\/]/).pop()))
    // f.mp4 came in on its own, after the other five, so it is the newest
    // whatever order a batch of imports happens to finish in.
    expect(byAdded).toHaveLength(6)
    expect(byAdded[0]).toBe('f.mp4')
    expect(byAdded).not.toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4', 'f.mp4'])
  }, 240_000)

  it('filters by kind, and dates each source so a bin of one day has no headings', async () => {
    const paths: string[] = []
    for (const n of ['k1.mp4', 'k2.mp4', 'k3.mp4', 'k4.mp4', 'k5.mp4', 'k6.mp4']) paths.push(await copyOf(cleanPath, n))
    await page.evaluate((p) => window.api.importFiles(p), paths)
    await allSettled()
    await page.waitForSelector('[data-testid="bin-kind"]')
    expect(await page.locator('[data-testid="asset"]').count()).toBeGreaterThanOrEqual(6)
    // Every one of these came in today, so there is nothing to tell apart by day.
    expect(await page.locator('[data-testid="bin-group-toggle"]').count()).toBe(0)
    const dated = await page.evaluate(async () => (await window.api.currentProject()).media.every((m) => typeof m.addedAt === 'number'))
    expect(dated).toBe(true)

    const all = await page.locator('[data-testid="asset"]').count()
    await page.click('[data-testid="bin-kind-sound"]')
    await page.waitForSelector('[data-testid="bin-nothing-found"]')
    expect(await page.locator('[data-testid="asset"]').count()).toBe(0)
    await page.click('[data-testid="bin-kind-video"]')
    await expect.poll(() => page.locator('[data-testid="asset"]').count()).toBe(all)
    await page.click('[data-testid="bin-kind-all"]')
  })

  it('shows the sources as cards, a list or a grid, and keeps the choice', async () => {
    await page.evaluate((p) => window.api.importFiles(p), [await copyOf(cleanPath, 'v1.mp4'), await copyOf(cleanPath, 'v2.mp4')])
    await allSettled()
    const ready = await page.locator('[data-testid="asset"][data-status="ready"]').count()
    expect(ready).toBeGreaterThanOrEqual(2)
    await page.click('[data-testid="bin-view-list"]')
    await expect.poll(() => page.locator('[data-testid="asset"][data-view="list"]').count()).toBe(ready)
    await page.click('[data-testid="bin-view-grid"]')
    await expect.poll(() => page.locator('[data-testid="asset"][data-view="grid"]').count()).toBe(ready)

    // A double click puts one on the timeline, which the tile then says.
    const clips = await page.locator('[data-testid="clip"]').count()
    await page.locator('[data-testid="asset"][data-view="grid"]').first().dblclick()
    await expect.poll(() => page.locator('[data-testid="clip"]').count()).toBeGreaterThan(clips)
    await page.waitForSelector('[data-testid="asset"][data-view="grid"] [data-testid="asset-usage"]')

    // Kept with the window, across a reload.
    await page.reload()
    await page.waitForSelector('main')
    await page.waitForSelector('[data-testid="asset"][data-view="grid"]', { timeout: 30_000 })
    await page.click('[data-testid="bin-view-cards"]')
    await expect.poll(() => page.locator('[data-testid="asset"][data-view="grid"]').count()).toBe(0)
  })

  it('shows the part of the recording under the pointer as it moves across a card', async () => {
    await page.evaluate((p) => window.api.importFiles(p), [await copyOf(cleanPath, 'scrub.mp4')])
    await allSettled()
    const thumb = page.locator('[data-testid="asset-thumb"]').first()
    const box = (await thumb.boundingBox())!
    expect(await thumb.getAttribute('data-tile')).toBe('0')
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2)
    await page.waitForFunction(() => document.querySelector('[data-testid="asset-thumb"]')?.getAttribute('data-tile') === '3')
    await page.mouse.move(box.x - 40, box.y - 40)
    await page.waitForFunction(() => document.querySelector('[data-testid="asset-thumb"]')?.getAttribute('data-tile') === '0')
  }, 120_000)
})

describe('recordings from OBS, and your own folders', () => {
  beforeEach(fresh)

  /** Recordings, one of the folders in Sources, made for you. */
  const REC = '[data-testid="source-folder"][data-kind="recordings"]'
  /** One of your folders in Sources, by its name. */
  const folder = (name: string): string => `[data-testid="source-folder"][data-name="${name}"]`

  /** Unfold the Recordings list, which stays as it was left from one project to the next. */
  async function openRecordings(): Promise<void> {
    await page.waitForSelector(REC)
    if ((await page.getAttribute(REC, 'data-open')) !== 'yes') await page.click(`${REC} [data-testid="folder-toggle"]`)
    await page.waitForSelector(`${REC}[data-open="yes"]`)
  }

  /** The folder dialog answers `dir` from now on. */
  async function dialogAnswers(dir: string): Promise<void> {
    await app.evaluate(({ dialog }, d) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
    }, dir)
  }

  /** Add a folder to Sources with +, answering the folder dialog with it. */
  async function addFolder(dir: string): Promise<void> {
    await dialogAnswers(dir)
    await page.click('[data-testid="folders-add"]')
    await page.click('[data-testid="folders-add-folder"]')
  }

  async function menu(name: string, item: string): Promise<void> {
    await page.click(`${folder(name)} [data-testid="folder-more"]`)
    await page.click(`[data-testid="folder-menu-${item}"]`)
  }

  /** Sources' folders back to Recordings alone, following OBS, for whatever runs next. */
  async function onlyRecordings(): Promise<void> {
    await page.evaluate(() =>
      window.api.setAppSettings({ sourceFolders: [{ id: 'recordings', name: 'Recordings', kind: 'recordings', folder: null, newestFirst: true }] })
    )
  }

  it('lists the recordings in OBS’s folder, and says when a new one has finished, ready to import', async () => {
    await openRecordings()
    await page.waitForFunction(
      (dir) => document.querySelector('[data-testid="recordings-folder"]')?.textContent === `${dir}, from OBS`,
      obsFolder
    )
    await page.waitForSelector('[data-testid="recording"][data-name="2026-09-22 00-09-13.mkv"][data-state="ready"]')
    // Already there when the app started: listed, never announced.
    expect(await page.locator('[data-testid="toast"][data-kind="recording"]').count()).toBe(0)

    // A new recording, written for a while and then left alone.
    const fresh = join(obsFolder, '2026-09-22 00-35-20.mkv')
    await copyFile(cleanPath, fresh)
    const growing = setInterval(() => void appendFile(fresh, Buffer.alloc(1000)), 1000)
    try {
      await page.waitForSelector('[data-testid="recording"][data-name="2026-09-22 00-35-20.mkv"][data-state="recording"]', {
        timeout: 20_000
      })
    } finally {
      clearInterval(growing)
    }
    await page.waitForSelector('[data-testid="toast"][data-kind="recording"]', { timeout: 30_000 })
    expect(await page.textContent('[data-testid="toast"][data-kind="recording"]')).toContain(
      'New recording: 2026-09-22 00-35-20.mkv'
    )
    // An edit meanwhile does not put it away: it stays until answered.
    // One sequence has no tab of its own.
    const sequences = Math.max(1, await page.locator('[data-testid="sequence-tab"]').count())
    await page.click('[data-testid="sequence-add"]')
    await page.locator('[data-testid="sequence-add-shape"]').first().click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="sequence-tab"]').length === n + 1, sequences)
    expect(await page.locator('[data-testid="toast"][data-kind="recording"]').count()).toBe(1)
    await page.click('[data-testid="toast"][data-kind="recording"] [data-testid="toast-action"]')
    await page.waitForSelector(`${card('2026-09-22 00-35-20.mkv')}[data-status="ready"]`, { timeout: 60_000 })
    await page.waitForSelector('[data-testid="recording"][data-name="2026-09-22 00-35-20.mkv"][data-state="imported"]')
  }, 180_000)

  it('adds a folder of your own, lists its media and its subfolders as a tree, sees a file dropped in, and brings one in', async () => {
    const shelf = join(root, 'Library', 'Sound effects')
    await mkdir(join(shelf, 'Impacts'), { recursive: true })
    await copyFile(cleanPath, join(shelf, 'whoosh.mp4'))
    await writeFile(join(shelf, 'readme.txt'), 'not a sound')
    // Sound files that are really tones: made with the bundled ffmpeg.
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', join(shelf, 'ding.wav')])
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(shelf, 'Impacts', 'boom.wav')])

    await addFolder(shelf)
    // Named after its folder, and kept with the app, so every project has it.
    await page.waitForSelector(folder('Sound effects'))
    const kept = (await page.evaluate(() => window.api.appSettings())).sourceFolders
    expect(kept.find((f) => f.name === 'Sound effects')?.folder).toBe(shelf)

    await page.click(`${folder('Sound effects')} [data-testid="folder-toggle"]`)
    await page.waitForSelector(`${folder('Sound effects')} [data-testid="folder-file"][data-name="ding.wav"]`)
    // Video and sound alike, but not a text file.
    expect(await page.locator(`${folder('Sound effects')} [data-testid="folder-file"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))).toEqual([
      'ding.wav',
      'whoosh.mp4'
    ])

    // A subfolder opens in place, and what is in it can be brought in too.
    await page.click(`${folder('Sound effects')} [data-testid="folder-dir"][data-name="Impacts"] [data-testid="folder-dir-toggle"]`)
    await page.click(`${folder('Sound effects')} [data-testid="folder-file"][data-name="boom.wav"] [data-testid="folder-bring-in"]`)
    await page.waitForSelector(`${card('boom.wav')}[data-status="ready"]`, { timeout: 60_000 })
    await page.waitForSelector('[data-testid="folder-file"][data-name="boom.wav"][data-state="imported"]')
    // Each file has its own icon, green once it is in the project (task 81).
    const iconColour = (name: string): Promise<string> =>
      page.locator(`[data-testid="folder-file"][data-name="${name}"] [data-testid="folder-file-icon"]`).evaluate((e) => getComputedStyle(e).color)
    expect(await iconColour('boom.wav')).toBe('rgb(79, 191, 135)')
    expect(await iconColour('ding.wav')).toBe('rgb(143, 153, 169)')

    // A file dropped into the folder on disk is there the next time it is looked at.
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', join(shelf, 'blip.wav')])
    await page.waitForSelector('[data-testid="folder-file"][data-name="blip.wav"]', { timeout: 15_000 })
    await onlyRecordings()
  }, 120_000)

  it('shows a sort button only on an open folder with two or more things in it, and sorts from it (task 56)', async () => {
    const shelf = join(root, 'Sorting', 'Clips')
    await mkdir(shelf, { recursive: true })
    await copyFile(cleanPath, join(shelf, 'a-older.mp4'))
    await addFolder(shelf)
    await page.click(`${folder('Clips')} [data-testid="folder-toggle"]`)
    await page.waitForSelector(`${folder('Clips')} [data-testid="folder-file"][data-name="a-older.mp4"]`)
    expect(await page.locator(`${folder('Clips')} [data-testid="folder-sort"]`).count()).toBe(0)
    // The sort is no longer in the folder's menu.
    await page.click(`${folder('Clips')} [data-testid="folder-more"]`)
    await page.waitForSelector('[data-testid="folder-menu"]')
    expect(await page.locator('[data-testid="folder-menu-newest"]').count()).toBe(0)
    await page.keyboard.press('Escape')

    // A copy keeps its original's time on Windows: set each one's own.
    await copyFile(cleanPath, join(shelf, 'b-newer.mp4'))
    await utimes(join(shelf, 'a-older.mp4'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    await utimes(join(shelf, 'b-newer.mp4'), new Date(2026, 5, 1), new Date(2026, 5, 1))
    await page.waitForSelector(`${folder('Clips')} [data-testid="folder-sort"]`, { timeout: 15_000 })
    const names = (): Promise<(string | null)[]> =>
      page.locator(`${folder('Clips')} [data-testid="folder-file"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))
    await expect.poll(names).toEqual(['a-older.mp4', 'b-newer.mp4'])
    await page.click(`${folder('Clips')} [data-testid="folder-sort"]`)
    expect(await page.getAttribute('[data-testid="folder-sort-name"]', 'data-current')).toBe('yes')
    await page.click('[data-testid="folder-sort-newest"]')
    await expect.poll(names, { timeout: 15_000 }).toEqual(['b-newer.mp4', 'a-older.mp4'])
    await page.click(`${folder('Clips')} [data-testid="folder-sort"]`)
    await page.click('[data-testid="folder-sort-name"]')
    await expect.poll(names, { timeout: 15_000 }).toEqual(['a-older.mp4', 'b-newer.mp4'])
    await onlyRecordings()
  })

  it('renames a folder, moves it, takes it out with Undo, and points it at another folder', async () => {
    const a = join(root, 'Folders', 'Alpha')
    const b = join(root, 'Folders', 'Beta')
    await mkdir(a, { recursive: true })
    await mkdir(b, { recursive: true })
    await copyFile(cleanPath, join(b, 'beta clip.mp4'))
    await addFolder(a)
    await page.waitForSelector(folder('Alpha'))
    await addFolder(b)
    await page.waitForSelector(folder('Beta'))
    const names = (): Promise<(string | null)[]> =>
      page.locator('[data-testid="source-folder"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))
    expect(await names()).toEqual(['Recordings', 'Alpha', 'Beta'])

    // Renamed in place.
    await menu('Alpha', 'rename')
    await page.fill('[data-testid="folder-rename-input"]', 'Music')
    await page.press('[data-testid="folder-rename-input"]', 'Enter')
    await page.waitForSelector(folder('Music'))

    // Dragged above Recordings.
    await page.dragAndDrop(`${folder('Beta')} [data-testid="folder-toggle"]`, `${REC} [data-testid="folder-toggle"]`)
    await expect.poll(names).toEqual(['Beta', 'Recordings', 'Music'])

    // Taken out, and put back where it was with Undo. The folder on disk is untouched.
    await menu('Music', 'remove')
    await expect.poll(names).toEqual(['Beta', 'Recordings'])
    await page.click('[data-testid="toast"][data-kind="folder-removed"] [data-testid="toast-action"]')
    await expect.poll(names).toEqual(['Beta', 'Recordings', 'Music'])

    // Pointed at another folder: now it lists that one.
    await dialogAnswers(b)
    await menu('Music', 'change')
    await page.click(`${folder('Music')} [data-testid="folder-toggle"]`)
    await page.waitForSelector(`${folder('Music')} [data-testid="folder-file"][data-name="beta clip.mp4"]`)
    const kept = (await page.evaluate(() => window.api.appSettings())).sourceFolders
    expect(kept.map((f) => [f.name, f.folder])).toEqual([
      ['Beta', b],
      ['Recordings', null],
      ['Music', b]
    ])
    await onlyRecordings()
  }, 120_000)

  it('imports one from Recordings, and lists another folder when one is chosen', async () => {
    await openRecordings()
    await page.waitForSelector('[data-testid="recording"][data-name="2026-09-22 00-09-13.mkv"]')
    await page.click('[data-testid="recording"][data-name="2026-09-22 00-09-13.mkv"] [data-testid="recording-import"]')
    await page.waitForSelector(`${card('2026-09-22 00-09-13.mkv')}[data-status="ready"]`, { timeout: 60_000 })

    const other = join(root, 'Elsewhere')
    await mkdir(other, { recursive: true })
    await copyFile(cleanPath, join(other, 'other.mp4'))
    await dialogAnswers(other)
    await page.click('[data-testid="recordings-change"]')
    await page.waitForFunction((d) => document.querySelector('[data-testid="recordings-folder"]')?.textContent === d, other)
    await page.waitForSelector('[data-testid="recording"][data-name="other.mp4"]')
    // Remembered by the app.
    expect((await page.evaluate(() => window.api.appSettings())).sourceFolders.find((f) => f.kind === 'recordings')?.folder).toBe(other)
    // Back to OBS's own folder for whatever runs next.
    await onlyRecordings()
  }, 120_000)

  it('finds a source, a recording and a file deep in a folder with one search, imports from it, and clears back', async () => {
    await page.evaluate(async (p) => window.api.importFiles([p]), await copyOf(cleanPath, 'take project.mp4'))
    await page.waitForSelector(`${card('take project.mp4')}[data-status="ready"]`, { timeout: 60_000 })
    await copyFile(cleanPath, join(obsFolder, 'take recording.mkv'))
    const shelf = join(root, 'Library', 'Clips')
    await mkdir(join(shelf, 'old', 'deep'), { recursive: true })
    await copyFile(cleanPath, join(shelf, 'old', 'deep', 'take library.mp4'))
    await copyFile(cleanPath, join(shelf, 'other thing.mp4'))
    await addFolder(shelf)
    await page.waitForSelector(`${folder('Clips')}[data-open="no"]`)
    const recordingsWere = await page.getAttribute(REC, 'data-open')

    // One box, always there, for all of them.
    await page.fill('[data-testid="sources-search"]', 'TAKE')
    await page.waitForSelector(`${REC}[data-open="yes"] [data-testid="recording"][data-name="take recording.mkv"]`)
    await page.waitForSelector(`${folder('Clips')}[data-open="yes"] [data-testid="folder-file"][data-name="take library.mp4"]`)
    await expect.poll(() => page.textContent(`${REC} [data-testid="folder-count"]`)).toBe('1')
    await expect.poll(() => page.textContent(`${folder('Clips')} [data-testid="folder-count"]`)).toBe('1')
    // Said where it is, under the folder.
    expect(await page.textContent(`${folder('Clips')} [data-testid="folder-file"]`)).toContain('in old/deep')
    expect(await page.textContent('[data-testid="sources-project-count"]')).toBe('1')
    await page.waitForSelector(card('take project.mp4'))
    expect(await page.locator('[data-testid="asset"]').count()).toBe(1)

    // Imported with one click from the results.
    await page.click('[data-testid="recording"][data-name="take recording.mkv"] [data-testid="recording-import"]')
    await page.waitForSelector(`${card('take recording.mkv')}[data-status="ready"]`, { timeout: 60_000 })

    // A heading with nothing found is not shown at all.
    await page.fill('[data-testid="sources-search"]', 'other thing')
    await page.waitForSelector(REC, { state: 'detached' })
    await page.waitForSelector('[data-testid="folder-file"][data-name="other thing.mp4"]')
    expect(await page.locator('[data-testid="sources-project-heading"]').count()).toBe(0)

    // Cleared, every section is as it was.
    await page.fill('[data-testid="sources-search"]', '')
    await page.waitForSelector(`${REC}[data-open="${recordingsWere}"]`)
    await page.waitForSelector(`${folder('Clips')}[data-open="no"]`)
    expect(await page.locator('[data-testid="sources-project-heading"]').count()).toBe(0)
    await onlyRecordings()
  }, 180_000)

  it('jumps to the search with Ctrl+F', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+f')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'sources-search')
  })
})
