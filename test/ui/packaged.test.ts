import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listPackage } from '@electron/asar'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * The packaged application, not the development one.
 *
 * A packed build is exactly where the bundled ffmpeg stops being found: it has
 * to sit outside the asar archive, where the binaries are not real files and
 * cannot be executed. That
 * failure looks like nothing at all until the moment you press Export, so this
 * goes all the way to a finished file.
 *
 * Skips unless `npm run dist:test` has been run. That builds the copy made
 * for this test, which can be driven: the installer's own cannot.
 */

// EDITBAY_PACKAGED_DIR points at another build's win-unpacked folder, or a
// Mac build's Editbay.app, for checking a fresh build while the usual one is
// open and cannot be replaced.
const MAC = process.platform === 'darwin'
const UNPACKED =
  process.env.EDITBAY_PACKAGED_DIR ??
  (MAC
    ? join(process.cwd(), 'release-test', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Editbay.app')
    : join(process.cwd(), 'release-test', 'win-unpacked'))
// A Mac app keeps its program and its resources inside the bundle (plan 104).
const EXE = MAC ? join(UNPACKED, 'Contents', 'MacOS', 'Editbay') : join(UNPACKED, 'Editbay.exe')
const RESOURCES = MAC ? join(UNPACKED, 'Contents', 'Resources') : join(UNPACKED, 'resources')
const built = existsSync(EXE)

const fx = fixtureSet('packaged')
let app: ElectronApplication
let page: Page
let userData: string
let exportDir: string
let cleanPath: string

beforeAll(async () => {
  if (!built) return
  cleanPath = await fx.cleanClip()
  userData = await mkdtemp(join(tmpdir(), 'editbay-packaged-'))
  exportDir = await mkdtemp(join(tmpdir(), 'editbay-packaged-export-'))

  // A stand-in for the speech engine, so captions can be made without downloading it.
  const fake = join(process.cwd(), 'test', 'fixtures', 'fake-whisper.mjs')
  app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${userData}`], env: { ...process.env, EDITBAY_SPEECH_FAKE: fake } })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 240_000)

afterAll(async () => {
  if (!built) return
  await app?.close()
  await rm(userData, { recursive: true, force: true })
  await rm(exportDir, { recursive: true, force: true })
  await fx.cleanup()
})

describe.skipIf(!built)('the packaged application', () => {
  it('ships ffmpeg and ffprobe as files of their own beside the archive, and nothing else of their build', async () => {
    expect((await readdir(join(RESOURCES, 'ffmpeg'))).sort()).toEqual(MAC ? ['ffmpeg', 'ffprobe'] : ['ffmpeg.exe', 'ffprobe.exe'])
  })

  it.runIf(MAC)("ships whisper.cpp's program inside the app on a Mac, with its licence", () => {
    expect(existsSync(join(RESOURCES, 'whisper', 'whisper-cli'))).toBe(true)
    expect(existsSync(join(RESOURCES, 'whisper', 'LICENSE'))).toBe(true)
  })

  it('ships the captions\' font as a file of its own, where the export burns captions in with it, and its licence', () => {
    expect(existsSync(join(RESOURCES, 'fonts', 'Montserrat-ExtraBold.ttf'))).toBe(true)
    expect(existsSync(join(RESOURCES, 'licences', 'Montserrat-OFL.txt'))).toBe(true)
  })

  it('ships ONNX Runtime for Follow face beside the archive, CPU only, with the C++ runtime and the face model', async () => {
    const platform = MAC ? join('darwin', process.arch) : join('win32', 'x64')
    const bin = join(RESOURCES, 'onnxruntime', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platform)
    const files = (await readdir(bin)).map((f) => f.toLowerCase()).sort()
    expect(files).toContain('onnxruntime_binding.node')
    if (MAC) {
      expect(files).toContain('libonnxruntime.1.dylib')
    } else {
      expect(files).toContain('onnxruntime.dll')
      expect(files).toContain('vcruntime140.dll')
      expect(files).not.toContain('directml.dll')
    }
    expect(existsSync(join(RESOURCES, 'models', 'face_detection_yunet_2023mar.onnx'))).toBe(true)
    expect(existsSync(join(RESOURCES, 'licences', 'ONNXRuntime-MIT.txt'))).toBe(true)
  })

  it('ships every licence notice, and nothing from node_modules', () => {
    for (const name of ['THIRD-PARTY-NOTICES.md', 'README.txt', 'FFmpeg-GPLv3.txt', 'Editbay-MIT.txt', 'React-MIT.txt', 'lucide-ISC.txt', 'ONNXRuntime-ThirdPartyNotices.txt']) {
      expect(existsSync(join(RESOURCES, 'licences', name))).toBe(true)
    }
    const packages = new Set(
      listPackage(join(RESOURCES, 'app.asar'), { isPack: false })
        .map((p) => p.replace(/\\/g, '/').match(/^\/node_modules\/(@[^/]+\/[^/]+|[^@/][^/]*)/)?.[1])
        .filter((p): p is string => p !== undefined)
    )
    expect([...packages]).toEqual([])
  })

  it('starts and finds a usable ffmpeg', async () => {
    expect(await page.title()).toMatch(/Editbay$/)
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="ffmpeg-status"]')?.textContent ?? '').includes('ffmpeg'),
      undefined,
      { timeout: 60_000 }
    )
    const status = await page.textContent('[data-testid="ffmpeg-status"]')
    expect(status).toMatch(/ffmpeg version/i)
    expect(status).not.toMatch(/unusable/i)
    // The Mac build's run keeps a picture of the window, for a person to look at (plan 104).
    if (process.env.EDITBAY_SCREENSHOT) await page.screenshot({ path: process.env.EDITBAY_SCREENSHOT })
  })

  it('imports a file, which means ffprobe runs too', async () => {
    await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length >= 1,
      undefined,
      { timeout: 240_000 }
    )
    expect(await page.locator('[data-testid="asset"][data-status="ready"]').count()).toBe(1)
  })

  it('loads ONNX Runtime and the face model from beside the archive, for Follow face', async () => {
    const found = await page.evaluate(async () => {
      const p = await window.api.currentProject()
      return window.api.mediaFaces(p.media[0]!.id, 0, 1, 30)
    })
    expect(found).toMatchObject({ ok: true })
  }, 60_000)

  it('exports a real file', async () => {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1, undefined, {
      timeout: 15_000
    })

    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, exportDir)

    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 300_000 })

    expect(await page.locator('[data-testid="export-error"]').count()).toBe(0)
    const written = await readdir(exportDir)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/\.mp4$/)
  }, 360_000)

  it('burns captions into the export in the font it ships', async () => {
    const [plain] = await readdir(exportDir)
    await closeExport(page)
    await page.locator('[data-testid="open-captions"]').click()
    await page.locator('[data-testid="captions-make"]').click()
    await page.waitForSelector('[data-testid="captions-dialog"]', { state: 'detached', timeout: 60_000 })
    await page.waitForSelector('[data-testid="caption"]', { timeout: 15_000 })
    await openExport(page)
    await page.locator('[data-testid="export-start"]').click()
    // The file of the export before is there: this one goes beside it.
    await page.locator('[data-testid="export-keep-both"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 300_000 })
    expect(await page.locator('[data-testid="export-error"]').count()).toBe(0)
    const captioned = (await readdir(exportDir)).find((f) => f !== plain)!
    // Frame 20, while HELLO THERE is on screen: the band the caption sits in differs from the export without it.
    const band = async (file: string): Promise<Buffer> =>
      (
        await capture(ffmpegPath, [
          '-v', 'error', '-i', join(exportDir, file), '-vf', "select='eq(n,20)',crop=1080:400:0:1050", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
        ])
      ).stdout
    const [a, b] = [await band(plain!), await band(captioned)]
    let changed = 0
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 100) changed++
    expect(changed).toBeGreaterThan(5000)
  }, 360_000)
})
