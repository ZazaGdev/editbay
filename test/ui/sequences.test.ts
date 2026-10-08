import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Several timelines in one project, driven through the real window: making,
 * reshaping, switching, renaming and removing them, exporting one, and
 * getting all of it back after closing the app.
 */

const fx = fixtureSet('sequences')
const root = await mkdtemp(join(tmpdir(), 'editbay-sequences-'))
let cleanPath: string
let counter = 0
const WAIT = { timeout: 15_000 }

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
}, 180_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function launch(userData: string, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...extraArgs], cwd: process.cwd() })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  return { app, page }
}

async function closeAndWait(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await closed
}

async function freshDir(): Promise<{ userData: string; files: string }> {
  counter += 1
  return { userData: join(root, `user-${counter}`), files: await mkdtemp(join(root, `files${counter}-`)) }
}

async function waitForClips(page: Page, n: number): Promise<void> {
  await page.waitForFunction((want) => document.querySelectorAll('[data-testid="clip"]').length === want, n, WAIT)
}

/** Import the clean clip and put it on the timeline twice. */
async function twoClips(page: Page): Promise<void> {
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  for (let n = 1; n <= 2; n++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await waitForClips(page, n)
  }
}

async function tabNames(page: Page): Promise<string[]> {
  return page.locator('[data-testid="sequence-name"]').allTextContents()
}

async function activeName(page: Page): Promise<string> {
  return (await page.locator('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]').textContent()) ?? ''
}

async function waitForTabs(page: Page, names: string[]): Promise<void> {
  await page.waitForFunction(
    (want) =>
      JSON.stringify(Array.from(document.querySelectorAll('[data-testid="sequence-name"]')).map((e) => e.textContent)) ===
      want,
    JSON.stringify(names),
    WAIT
  )
}

/** The names of the project's sequences, tab or no tab. */
async function sequenceNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences.map((s) => s.name))
}

async function waitForActive(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    (want) =>
      document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')
        ?.textContent === want,
    name,
    WAIT
  )
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('[data-testid="sequence-tab"]', { hasText: name }).click()
  await waitForActive(page, name)
}

async function playhead(page: Page): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

async function waitForPlayhead(page: Page, frame: number): Promise<void> {
  await page.waitForFunction(
    (want) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(want),
    frame,
    WAIT
  )
}

async function waitForTitle(page: Page, title: string): Promise<void> {
  await page.waitForFunction((want) => document.title === want, title, WAIT)
}

/** Width over height of every clip's crop, sequence by sequence, from the document itself. */
async function cropShapes(page: Page): Promise<number[][]> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    return p.sequences.map((s) => s.videoTracks[0]!.clips.map((c) => c.transform.crop.w / c.transform.crop.h))
  })
}

async function selectClip(page: Page, index: number): Promise<void> {
  const box = await page.locator('[data-testid="clip"]').nth(index).boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForFunction(
    (i) => document.querySelectorAll('[data-testid="clip"]')[i]?.getAttribute('data-selected') === 'yes',
    index,
    WAIT
  )
}

async function selectedIndex(page: Page): Promise<number> {
  return page
    .locator('[data-testid="clip"]')
    .evaluateAll((els) => els.findIndex((e) => e.getAttribute('data-selected') === 'yes'))
}

describe('several sequences in one project', () => {
  let app: ElectronApplication
  let page: Page
  let exportDir: string

  beforeAll(async () => {
    const dirs = await freshDir()
    exportDir = dirs.files
    ;({ app, page } = await launch(dirs.userData))
    await twoClips(page)
  }, 240_000)

  afterAll(async () => {
    await app?.close()
  })

  it('starts with one sequence, named after its shape, and shows no tab for it', async () => {
    await expect.poll(() => sequenceNames(page), WAIT).toEqual(['Vertical'])
    // The shape list beside says what it is (task 88).
    expect(await page.locator('[data-testid="sequence-tab"]').count()).toBe(0)
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')
  })

  it('duplicates, and reshaping the copy leaves the original crops exactly as they were', async () => {
    const before = await cropShapes(page)
    await page.click('[data-testid="sequence-duplicate"]')
    await waitForTabs(page, ['Vertical', 'Vertical 2'])
    await waitForActive(page, 'Vertical 2')
    await waitForClips(page, 2)

    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    // Its name follows its shape until you rename it.
    await waitForTabs(page, ['Vertical', 'Landscape'])

    const after = await cropShapes(page)
    expect(after[0]).toEqual(before[0])
    for (const aspect of after[1]!) expect(aspect).toBeCloseTo(16 / 9, 1)
    // The export panel shows the shape of the sequence on screen.
    await switchTo(page, 'Vertical')
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')
  })

  it('keeps a playhead and a selection for each sequence', async () => {
    await switchTo(page, 'Vertical')
    await page.keyboard.press('Home')
    await waitForPlayhead(page, 0)
    await selectClip(page, 0)

    await switchTo(page, 'Landscape')
    await page.keyboard.press('End')
    await selectClip(page, 1)
    const end = await playhead(page)
    expect(end).toBeGreaterThan(0)

    await switchTo(page, 'Vertical')
    await waitForPlayhead(page, 0)
    expect(await selectedIndex(page)).toBe(0)

    await switchTo(page, 'Landscape')
    await waitForPlayhead(page, end)
    expect(await selectedIndex(page)).toBe(1)
  })

  it('picks up where the other sequence was when you switch during playback', async () => {
    await switchTo(page, 'Landscape')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
    await waitForPlayhead(page, 150)

    await switchTo(page, 'Vertical')
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 5,
      undefined,
      WAIT
    )
    await switchTo(page, 'Landscape')
    await waitForPlayhead(page, 150)

    // Playing on from here must run from the Landscape place, not from where
    // the picture was in Vertical.
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
    await page.keyboard.press('Space')
    expect(await playhead(page)).toBeGreaterThanOrEqual(150)
  })

  it('carries the selected clip into a duplicate', async () => {
    await switchTo(page, 'Vertical')
    await selectClip(page, 1)
    await page.click('[data-testid="sequence-duplicate"]')
    await waitForTabs(page, ['Vertical', 'Vertical 2', 'Landscape'])
    await waitForActive(page, 'Vertical 2')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="clip"]')[1]?.getAttribute('data-selected') === 'yes',
      undefined,
      WAIT
    )
    // Tidy up for the tests after this one.
    await page.locator('[data-testid="sequence-tab"]', { hasText: 'Vertical 2' }).locator('[data-testid="sequence-remove"]').click()
    await waitForTabs(page, ['Vertical', 'Landscape'])
  })

  it('does not rename a sequence when you click into its name and away again', async () => {
    await page.locator('[data-testid="sequence-tab"]', { hasText: 'Landscape' }).dblclick()
    await page.waitForSelector('[data-testid="sequence-name-input"]')
    await page.locator('[data-testid="timecode"]').click()
    await waitForTabs(page, ['Vertical', 'Landscape'])
    // Still following its shape: a rename would have stopped that.
    const follows = await page.evaluate(async () => (await window.api.currentProject()).sequences.map((s) => s.nameFollowsShape))
    expect(follows).toEqual([true, true])
  })

  it('renames by double-click, and Escape abandons a rename', async () => {
    await page.locator('[data-testid="sequence-tab"]', { hasText: 'Landscape' }).dblclick()
    await page.fill('[data-testid="sequence-name-input"]', 'Never mind')
    await page.keyboard.press('Escape')
    await waitForTabs(page, ['Vertical', 'Landscape'])

    await page.locator('[data-testid="sequence-tab"]', { hasText: 'Landscape' }).dblclick()
    await page.fill('[data-testid="sequence-name-input"]', 'YouTube')
    await page.keyboard.press('Enter')
    await waitForTabs(page, ['Vertical', 'YouTube'])

    // A name you gave it stays when the shape changes.
    await switchTo(page, 'YouTube')
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForTimeout(400)
    expect(await tabNames(page)).toEqual(['Vertical', 'YouTube'])
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.locator('[data-testid="export-preset"]').blur()
  })

  it('exports the sequence on screen, named after it', async () => {
    await switchTo(page, 'YouTube')
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, exportDir)
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.waitForFunction(
      () => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled,
      undefined,
      WAIT
    )
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
    expect(await readdir(exportDir)).toEqual(['Untitled YouTube.mp4'])
    await closeExport(page)
  }, 240_000)

  it('removes a sequence, and undo brings it back', async () => {
    await page.locator('[data-testid="sequence-tab"]', { hasText: 'YouTube' }).locator('[data-testid="sequence-remove"]').click()
    // Back to one, and its tab goes with the other's.
    await waitForTabs(page, [])
    await expect.poll(() => sequenceNames(page), WAIT).toEqual(['Vertical'])

    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await waitForTabs(page, ['Vertical', 'YouTube'])
    expect(await activeName(page)).toBe('Vertical')
  })

  it('adds an empty sequence in the shape chosen from +', async () => {
    await switchTo(page, 'Vertical')
    await page.click('[data-testid="sequence-add"]')
    await page.click('[data-testid="sequence-add-shape"][data-shape="vertical"]')
    await waitForTabs(page, ['Vertical', 'YouTube', 'Vertical 2'])
    await waitForActive(page, 'Vertical 2')
    await waitForClips(page, 0)
  })
})

describe('sequences across a restart', () => {
  it('reopens on the same sequence, with each one where it was', async () => {
    const { userData, files } = await freshDir()
    const first = await launch(userData)
    await twoClips(first.page)
    await first.page.click('[data-testid="sequence-duplicate"]')
    await waitForActive(first.page, 'Vertical 2')
    await first.page.selectOption('[data-testid="export-preset"]', 'landscape')
    await waitForTabs(first.page, ['Vertical', 'Landscape'])
    await first.page.locator('[data-testid="export-preset"]').blur()

    await switchTo(first.page, 'Vertical')
    await first.page.keyboard.press('End')
    await first.page.keyboard.press('ArrowLeft')
    const verticalAt = await playhead(first.page)
    await switchTo(first.page, 'Landscape')
    await first.page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await first.page.keyboard.press('ArrowRight')
    await waitForPlayhead(first.page, 5)

    await answerSaveDialog(first.app, join(files, 'two cuts.editbay'))
    await first.page.keyboard.press('Control+s')
    await waitForTitle(first.page, 'two cuts - Editbay')
    await closeAndWait(first.app)

    const second = await launch(userData)
    await waitForTabs(second.page, ['Vertical', 'Landscape'])
    await waitForActive(second.page, 'Landscape')
    await waitForPlayhead(second.page, 5)
    await switchTo(second.page, 'Vertical')
    await waitForPlayhead(second.page, verticalAt)
    await closeAndWait(second.app)
  }, 360_000)

  it('opens a project saved before sequences as one sequence, with its place intact', async () => {
    const { userData, files } = await freshDir()
    const file = join(files, 'older.editbay')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 2,
        name: 'older',
        fps: 30,
        output: { width: 1080, height: 1080 },
        presetId: 'square',
        media: [
          {
            id: 'm1',
            originalPath: cleanPath,
            playablePath: cleanPath,
            conformed: false,
            conformReasons: [],
            durationSec: 4,
            width: 640,
            height: 360,
            fps: 30,
            codec: 'h264',
            hasAudio: true,
            // In the app's own cache, the only place it keeps what it makes from a source.
            peaksPath: join(userData, 'media-cache', 'older', 'peaks.bin'),
            filmstripPath: join(userData, 'media-cache', 'older', 'filmstrip.jpg')
          }
        ],
        clips: [
          {
            id: 'c1',
            mediaId: 'm1',
            sourceIn: 0,
            sourceOut: 120,
            timelineStart: 0,
            transform: { mode: 'crop', crop: { x: 140, y: 0, w: 360, h: 360 } },
            audio: { gain: 1, muted: false }
          }
        ],
        workspace: {
          timeline: { playhead: 60, selectedClipId: 'c1', zoom: 7, view: 'program' },
          aspectLocked: true,
          export: { folder: null, mode: 'join', filenamePattern: '{project}_{index}_{clip}' }
        }
      })
    )

    const { app, page } = await launch(userData, [file])
    await expect.poll(() => sequenceNames(page), WAIT).toEqual(['Square'])
    await waitForPlayhead(page, 60)
    expect(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom')).toBe('7')
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('program')
    expect(await selectedIndex(page)).toBe(0)
    // Opening an older file is not a change of its own.
    await waitForTitle(page, 'older - Editbay')
    await closeAndWait(app)
  }, 240_000)

  it('opens a project saved before free tracks with each clip\'s sound on audio tracks of its own, heard as before', async () => {
    const { userData, files } = await freshDir()
    // A source with its streams copied, as plan 11 left an OBS recording.
    const recording = await fx.obsTracksClip()
    const first = await launch(userData)
    await first.page.evaluate((p) => window.api.importFiles([p]), recording)
    await first.page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
    // Ready before its other streams are copied: this wants them copied.
    await expect
      .poll(() => first.page.evaluate(async () => (await window.api.currentProject()).media[0]?.trackFiles !== undefined), { timeout: 180_000 })
      .toBe(true)
    const media = await first.page.evaluate(async () => (await window.api.currentProject()).media[0]!)
    await closeAndWait(first.app)

    // Schema 5: a V1 clip playing its first stream as recorded and its second
    // at half, and on the audio row A2 a second of its third stream from 1 s.
    const file = join(files, 'plan11.editbay')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 5,
        name: 'plan11',
        fps: 30,
        media: [media],
        sequences: [
          {
            id: 'sequence-1',
            name: 'Vertical',
            nameFollowsShape: true,
            presetId: 'vertical',
            output: { width: 1080, height: 1920 },
            clips: [
              {
                id: 'c1',
                mediaId: media.id,
                sourceIn: 0,
                sourceOut: 90,
                timelineStart: 0,
                transform: { mode: 'crop', crop: { x: 0, y: 0, w: 606, h: 1080 }, place: { x: 0, y: 0, w: 1, h: 1 } },
                layers: [],
                layout: 'single',
                audio: { gain: 1, muted: false, tracks: [{ index: 0, gain: 1 }, { index: 1, gain: 0.5 }] }
              }
            ],
            audioRows: [
              { id: 'row-a2', clips: [{ id: 's1', mediaId: media.id, track: 2, sourceIn: 0, sourceOut: 30, timelineStart: 30, gain: 1, muted: false }] }
            ],
            videoRows: []
          }
        ],
        workspace: {
          activeSequenceId: 'sequence-1',
          timelines: {},
          aspectLocked: true,
          export: { folder: null, mode: 'join', filenamePattern: '{project}_{index}_{clip}' }
        }
      })
    )

    const { app, page } = await launch(userData, [file])
    // Opening an older file is not a change of its own.
    await waitForTitle(page, 'plan11 - Editbay')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track"][data-kind="audio"]').length === 3, undefined, WAIT)
    const sound = await page.evaluate(async () =>
      (await window.api.currentProject()).sequences[0]!.audioTracks.map((r) =>
        r.clips.map((c) => ({ stream: c.track, start: c.timelineStart, length: c.sourceOut - c.sourceIn, gain: c.gain, muted: c.muted, linked: c.link !== undefined }))
      )
    )
    // Streams 1 and 2 of the V1 clip on A1 and A2, linked to its picture; the old A2 on A3.
    expect(sound).toEqual([
      [{ stream: 0, start: 0, length: 90, gain: 1, muted: false, linked: true }],
      [{ stream: 1, start: 0, length: 90, gain: 0.5, muted: false, linked: true }],
      [{ stream: 2, start: 30, length: 30, gain: 1, muted: false, linked: false }]
    ])
    await closeAndWait(app)
  }, 360_000)
})
