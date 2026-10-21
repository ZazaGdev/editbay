import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 96, the assets folder through the real window: with none chosen,
 * Sources asks for one; choosing it there makes Video, Audio and Images in
 * it; a trimmed clip with its sound saves into Video as it plays, a sound
 * clip alone into Audio, each shows under Assets in Sources and drags back
 * onto the timeline.
 */

const fx = fixtureSet('ui-assets')
const WAIT = { timeout: 15_000 }
const SAVE = { timeout: 120_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-assets-'))
const assetsDir = join(root, 'My assets')
let app: ElectronApplication
let page: Page

/** What ffmpeg says of a file: its length in seconds, and whether it has picture and sound. */
async function probe(file: string): Promise<{ seconds: number; video: boolean; audio: boolean }> {
  const text = String(await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? ''))
  const [, h = '0', m = '0', s = '0'] = text.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []
  return { seconds: Number(h) * 3600 + Number(m) * 60 + Number(s), video: /Stream .*Video:/.test(text), audio: /Stream .*Audio:/.test(text) }
}

const clips = (): Promise<{ id: string; kind: 'video' | 'audio'; frames: number }[]> =>
  page.evaluate(async () => {
    const t = (await window.api.currentProject()).sequences[0]!
    return [
      ...t.videoTracks.flatMap((r) => r.clips.map((c) => ({ id: c.id, kind: 'video' as const, frames: c.sourceOut - c.sourceIn }))),
      ...t.audioTracks.flatMap((r) => r.clips.map((c) => ({ id: c.id, kind: 'audio' as const, frames: c.sourceOut - c.sourceIn })))
    ]
  })

beforeAll(async () => {
  const red = await fx.solidClip('red', 440, 4)
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), red)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"][data-kind="video"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('the assets folder', () => {
  it('is asked for in Sources while none is chosen, and choosing it there makes Video, Audio and Images in it', async () => {
    await page.waitForSelector('[data-testid="assets-notice"]', WAIT)
    expect(await page.locator('[data-testid="free-packs-open"]').count()).toBe(0)
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, assetsDir)
    await page.click('[data-testid="assets-choose"]')
    await page.waitForSelector('[data-testid="assets-notice"]', { state: 'detached', ...WAIT })
    await page.waitForSelector('[data-testid="source-folder"][data-kind="effects"]', WAIT)
    expect(await page.textContent('[data-testid="source-folder"][data-kind="effects"]')).toContain('Assets')
    expect((await readdir(assetsDir)).sort()).toEqual(['Audio', 'Images', 'Video'])
  })

  // Task 44.
  it('suggests free packs once there is an assets folder, each with a link, what is in it, and the credit line it needs', async () => {
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await page.click('[data-testid="free-packs-open"]')
    await page.waitForSelector('[data-testid="free-packs"]', WAIT)
    const packs = await page.locator('[data-testid="free-pack"]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-pack'), el.getAttribute('data-credit')]))
    expect(packs).toEqual(expect.arrayContaining([['kenney', 'no'], ['oga-512', 'no'], ['oga-100', 'no'], ['sonniss', 'no'], ['bigsoundbank', 'no'], ['pixabay', 'no'], ['mixkit', 'no'], ['zapsplat', 'yes']]))
    expect(await page.textContent('[data-pack="zapsplat"] [data-testid="free-pack-credit"]')).toContain('Sound effects obtained from https://www.zapsplat.com')
    await page.click('[data-pack="kenney"] [data-testid="free-pack-open"]')
    await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened), WAIT).toEqual(['https://kenney.nl/assets/category:Audio'])
    await page.click('[data-testid="free-packs-close"]')
    await page.waitForSelector('[data-testid="free-packs"]', { state: 'detached' })
  })

  it('saves a trimmed clip with its sound into Video, as long as the clip plays', async () => {
    // Trimmed to its first two seconds: split there and take the second part away.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+s')
    await expect.poll(async () => (await clips()).length, WAIT).toBe(4)
    const first = (await clips()).filter((c) => c.kind === 'video')[0]!
    const clip = page.locator(`[data-testid="clip"][data-clip-id="${first.id}"]`)
    const box = (await clip.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.click('[data-testid="clip-menu-save-asset"]')
    await page.waitForSelector('[data-kind="asset-saved"]', SAVE)
    const saved = await readdir(join(assetsDir, 'Video'))
    expect(saved).toHaveLength(1)
    const file = await probe(join(assetsDir, 'Video', saved[0]!))
    expect(file.video).toBe(true)
    expect(file.audio).toBe(true)
    expect(Math.abs(file.seconds - first.frames / 30)).toBeLessThan(0.2)
    expect(first.frames).toBeLessThan(4 * 30)
  })

  it('saves a sound clip alone into Audio, with no picture', async () => {
    const sound = (await clips()).filter((c) => c.kind === 'audio')[0]!
    const clip = page.locator(`[data-testid="sound-clip"][data-clip-id="${sound.id}"]`)
    const box = (await clip.boundingBox())!
    // Alt picks one side of a linked pair alone.
    await page.keyboard.down('Alt')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.up('Alt')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.click('[data-testid="clip-menu-save-asset"]')
    await expect.poll(async () => (await readdir(join(assetsDir, 'Audio'))).length, SAVE).toBe(1)
    const file = await probe(join(assetsDir, 'Audio', (await readdir(join(assetsDir, 'Audio')))[0]!))
    expect(file.video).toBe(false)
    expect(file.audio).toBe(true)
  })

  it('shows what was saved under Assets in Sources, and it drags back onto the timeline', async () => {
    const entry = page.locator('[data-testid="source-folder"][data-kind="effects"]')
    if ((await entry.getAttribute('data-open')) === 'yes') await entry.locator('[data-testid="folder-toggle"]').click()
    await entry.locator('[data-testid="folder-toggle"]').click()
    await entry.locator('[data-testid="folder-dir"][data-name="Video"] [data-testid="folder-dir-toggle"]').click()
    const file = entry.locator('[data-testid="folder-dir"][data-name="Video"] [data-testid="folder-file"]').first()
    await file.waitFor(WAIT)
    const before = (await clips()).filter((c) => c.kind === 'video').length
    const track = page.locator('[data-testid="track"][data-track-id="v1"]')
    const box = (await track.boundingBox())!
    await file.dragTo(track, { targetPosition: { x: box.width - 20, y: box.height / 2 } })
    await expect.poll(async () => (await clips()).filter((c) => c.kind === 'video').length, SAVE).toBe(before + 1)
  })

  // Tasks 103 and 104.
  it('copies a source dragged from the bin onto a folder into it on disk, keeping both on a name clash, its files indented under it', async () => {
    const entry = page.locator('[data-testid="source-folder"][data-kind="effects"]')
    if ((await entry.getAttribute('data-open')) !== 'yes') await entry.locator('[data-testid="folder-toggle"]').click()
    const images = entry.locator('[data-testid="folder-dir"][data-name="Images"]')
    if ((await images.getAttribute('data-open')) !== 'yes') await images.locator('[data-testid="folder-dir-toggle"]').click()
    const source = page.locator('[data-testid="asset"]').first()
    const id = await source.getAttribute('data-asset-id')
    const original = await page.evaluate(async (i) => (await window.api.currentProject()).media.find((m) => m.id === i)!.originalPath, id)
    const name = original.split(/[\\/]/).pop()!
    const dot = name.lastIndexOf('.')
    const projectMedia = async (): Promise<number> => (await page.evaluate(async () => (await window.api.currentProject()).media.length))
    const before = await projectMedia()

    await source.dragTo(images.locator('[data-testid="folder-dir-toggle"]'))
    await expect.poll(async () => (await readdir(join(assetsDir, 'Images'))).sort(), WAIT).toEqual([name])
    await source.dragTo(images.locator('[data-testid="folder-dir-toggle"]'))
    const second = `${name.slice(0, dot)} (2)${name.slice(dot)}`
    await expect.poll(async () => (await readdir(join(assetsDir, 'Images'))).sort(), WAIT).toEqual([name, second].sort())
    // The original is where it was, and nothing new came into the project.
    expect((await readdir(join(original, '..'))).includes(name)).toBe(true)
    expect(await projectMedia()).toBe(before)

    // Both listed under Images, a level in from its name.
    const files = images.locator('[data-testid="folder-file"]')
    await expect.poll(() => files.count(), { timeout: 20_000 }).toBe(2)
    if (process.env.KEEP_SHOTS) await writeFile(join(process.env.KEEP_SHOTS, 'assets-indent.png'), await entry.screenshot())
    const folderIcon = (await images.locator('[data-testid="folder-dir-toggle"] svg').nth(1).boundingBox())!
    const fileIcon = (await files.first().locator('[data-testid="folder-file-icon"]').boundingBox())!
    // Under the folder's name rather than level with its icon.
    expect(fileIcon.x).toBeGreaterThan(folderIcon.x + 12)
  })
})

// Task 47.
describe('credits for the description', () => {
  const zapLine = 'Sound effects obtained from https://www.zapsplat.com'
  const zap = join(assetsDir, 'Audio', 'ZapSplat', 'whoosh.wav')
  const free = join(assetsDir, 'Audio', 'Kenney', 'click.wav')
  const out = join(root, 'exports')

  async function exportNow(): Promise<{ ok: boolean; outputs: string[]; credits?: string[] }> {
    return page.evaluate(
      async (r) => {
        const p = await window.api.currentProject()
        return window.api.startExport({ sequenceId: p.sequences[0]!.id, mode: 'join', outputDir: r.dir, filenamePattern: '{project}', existing: 'replace' })
      },
      { dir: out }
    )
  }

  it('lists only the credit a pack folder asks for, exactly, and writes it beside the video; a part with none says none are needed', async () => {
    for (const [file, hz] of [[zap, 600], [free, 900]] as const) {
      await mkdir(join(file, '..'), { recursive: true })
      await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=1`, file])
    }
    await writeFile(join(assetsDir, 'Audio', 'ZapSplat', 'credit.txt'), `${zapLine}\n`)
    await page.keyboard.press('ControlOrMeta+n')
    await page.waitForFunction(async () => (await window.api.currentProject()).sequences[0]!.videoTracks.every((t) => t.clips.length === 0))
    for (const file of [zap, free]) {
      const before = (await clips()).length
      const [asset] = await page.evaluate((p) => window.api.importFiles([p]), file)
      const card = `[data-testid="asset"][data-asset-id="${asset!.id}"]`
      await page.waitForSelector(`${card}[data-status="ready"]`, SAVE)
      await page.locator(`${card} [data-testid="add-to-timeline"]`).click()
      await expect.poll(async () => (await clips()).length, WAIT).toBeGreaterThan(before)
    }
    const whole = await exportNow()
    expect(whole.ok).toBe(true)
    expect(whole.credits).toEqual([zapLine])
    const beside = whole.outputs.find((o) => o.endsWith('.credits.txt'))!
    // Named as the video is, beside it.
    const video = whole.outputs.find((o) => o.endsWith('.mp4'))!
    expect(beside).toBe(video.replace(/\.mp4$/, '.credits.txt'))
    expect(await readFile(beside, 'utf8')).toContain(zapLine)

    // The ZapSplat sound taken off, leaving only the free one: none needed, and nothing written.
    await rm(beside)
    const zapClip = await page.evaluate(async (path) => {
      const p = await window.api.currentProject()
      const m = p.media.find((x) => x.originalPath === path)!
      return p.sequences[0]!.audioTracks.flatMap((t) => t.clips).find((c) => c.mediaId === m.id)!.id
    }, zap)
    await page.locator(`[data-testid="sound-clip"][data-clip-id="${zapClip}"]`).click()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await clips()).length, WAIT).toBe(1)
    const part = await exportNow()
    expect(part.ok).toBe(true)
    expect(part.credits).toEqual([])
    expect(part.outputs.some((o) => o.endsWith('.credits.txt'))).toBe(false)
  })

  it('marks one file by hand from its menu, with the line typed', async () => {
    const entry = page.locator('[data-testid="source-folder"][data-kind="effects"]')
    if ((await entry.getAttribute('data-open')) === 'yes') await entry.locator('[data-testid="folder-toggle"]').click()
    await entry.locator('[data-testid="folder-toggle"]').click()
    await entry.locator('[data-testid="folder-dir"][data-name="Audio"] > [data-testid="folder-dir-toggle"]').click()
    await entry.locator('[data-testid="folder-dir"][data-name="Kenney"] > [data-testid="folder-dir-toggle"]').click()
    await entry.locator('[data-testid="folder-file"][data-name="click.wav"]').click({ button: 'right' })
    await page.click('[data-testid="effect-credit"]')
    await page.fill('[data-testid="credit-line"]', '"Click" by Ann licensed under CC BY 4.0')
    await page.click('[data-testid="credit-save"]')
    await page.waitForSelector('[data-testid="credit-ask"]', { state: 'detached' })
    const credits = await page.evaluate(async () => (await window.api.appSettings()).credits)
    expect(Object.values(credits)).toEqual(['"Click" by Ann licensed under CC BY 4.0'])
  })
})
