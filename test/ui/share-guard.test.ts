import { describe, it, expect, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { FIRST_SEQUENCE_ID, addSource, createProject, editSequence, upsertMedia, type ProjectMedia } from '../../src/shared/project'
import { defaultWorkspace } from '../../src/shared/workspace'
import { joinProjectFile } from '../../src/shared/project-file'

/**
 * A playlist dressed as a recording must not make the app reach another
 * computer (audit 2026-10-10, fix first 1). The window's player reads a
 * playlist even in a file named `.mp4`, and follows a line in it to a share,
 * which signs in there with the user's Windows account.
 *
 * The shares named are on 192.0.2.x, an address range kept for examples that
 * nothing answers on, so a connection the app tries is seen in `netstat` as
 * one waiting on port 445, and goes nowhere.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-share-guard-'))
let app: ElectronApplication
let page: Page

afterAll(async () => {
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(project?: string): Promise<void> {
  const userData = await mkdtemp(join(root, 'user-'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...(project ? [project] : [])],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
}

/** An HLS playlist of one segment, `segment`. */
function playlist(segment: string): string {
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\n${segment}\n#EXT-X-ENDLIST\n`
}

/** Whether anything on this computer has tried to reach `host` on port 445, the Windows share port. */
async function reached(host: string): Promise<boolean> {
  const { stdout } = await promisify(execFile)('C:\\Windows\\System32\\NETSTAT.EXE', ['-ano', '-p', 'tcp'])
  return stdout.includes(`${host}:445`)
}

/** Whether any of `hosts` is reached within `ms`, looked at every quarter second. */
async function anyReached(hosts: string[], ms: number): Promise<string | null> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    for (const h of hosts) if (await reached(h)) return h
  }
  return null
}

describe('a playlist named like a recording', () => {
  it('cannot make the window reach a share, however the share is written', async () => {
    // Each written its own way, on a host of its own, so one seen says which got through.
    const ways: [string, string][] = [
      ['192.0.2.71', 'file://192.0.2.71/share/seg.ts'],
      ['192.0.2.72', '//192.0.2.72/share/seg.ts'],
      ['192.0.2.73', 'file:////192.0.2.73/share/seg.ts'],
      ['192.0.2.74', 'file:///%5C%5C192.0.2.74%5Cshare%5Cseg.ts']
    ]
    for (const h of ways.map(([host]) => host)) expect(await reached(h)).toBe(false)
    const urls: string[] = []
    for (const [i, [, segment]] of ways.entries()) {
      const file = join(root, `clip-${i}.mp4`)
      await writeFile(file, playlist(segment))
      urls.push(pathToFileURL(file).href)
    }
    await launch()
    // Played as the preview plays a source: a video element given the file's URL.
    const ends = await page.evaluate(
      (list) =>
        Promise.all(
          list.map(
            (src) =>
              new Promise<string>((done) => {
                const v = document.createElement('video')
                v.muted = true
                v.onerror = () => done('error')
                v.onloadedmetadata = () => done('loaded')
                v.src = src
                document.body.append(v)
                setTimeout(() => done('waiting'), 10_000)
              })
          )
        ),
      urls
    )
    expect(ends).toHaveLength(ways.length)
    expect(await anyReached(ways.map(([host]) => host), 4_000)).toBeNull()
    await app.close()
  }, 120_000)

  it('makes a project naming one as a source open with it missing, reaching no share', async () => {
    const host = '192.0.2.75'
    expect(await reached(host)).toBe(false)
    const file = join(root, 'clip.mp4')
    await writeFile(file, playlist(`file://${host}/share/seg.ts`))
    const media: ProjectMedia = {
      id: 'clip',
      originalPath: file,
      playablePath: file,
      conformed: false,
      conformReasons: [],
      durationSec: 2,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
      hasAudio: false,
      peaksPath: '',
      filmstripPath: ''
    }
    let project = upsertMedia(createProject('sent', 30, { width: 1920, height: 1080 }, 'landscape'), media)
    project = editSequence(project, FIRST_SEQUENCE_ID, (t) => addSource(t, { mediaId: 'clip', clipId: 'c', at: 0, streams: [] }))
    const target = join(root, 'sent.editbay')
    await writeFile(target, joinProjectFile(project, defaultWorkspace()))
    await launch(target)
    await page.waitForSelector('[data-testid="missing-media"]', { timeout: 20_000 })
    expect(await page.locator('[data-testid="clip"][data-offline="yes"]').count()).toBe(1)
    expect(await anyReached([host], 4_000)).toBeNull()
    await app.close()
  }, 120_000)
})
