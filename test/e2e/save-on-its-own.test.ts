import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { mkdtemp, rm, rename, mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-autosave-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot },
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
  dialog: {
    showMessageBox: async (): Promise<{ response: number }> => ({ response: 1 }),
    showSaveDialog: async (): Promise<{ canceled: boolean }> => ({ canceled: true }),
    showErrorBox: (): void => {}
  }
}))

// Saved on its own a moment after a change, so the tests need not wait half a minute.
process.env.EDITBAY_SAVE_AUTOMATICALLY_MS = '30'

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { saveProjectTo } = await import('../../src/main/project/store')
const session = await import('../../src/main/project/session')
const { S1 } = await import('../project-helpers')
const lifecycle = await import('../../src/main/project/lifecycle')
const { defaultWorkspace } = await import('../../src/shared/workspace')
const { SCHEMA_VERSION } = await import('../../src/shared/project')

/**
 * Audit 2026-10-01, item 10: Save automatically, on by default, writes only
 * over the project file as the app last read or wrote it. One changed by
 * another computer through a synced folder, moved away, or written by an
 * older version is left as it is, and you are told once.
 */

const fx = fixtureSet('autosave-e2e')
const work = join(fx.dir, 'work')
let source = ''

beforeAll(async () => {
  source = await fx.cleanClip()
  lifecycle.setSaveAutomatically(true, () => false)
})

afterAll(async () => {
  lifecycle.stopAutosave()
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** A saved project with one clip, in a folder of its own, opened unless `written` changes it first. */
async function opened(name: string, written?: (file: string) => Promise<void>): Promise<string> {
  session.resetProject()
  const asset = await importFile(source, ...quiet())
  session.addAsset(asset)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'c1' })
  const file = join(work, name, `${name}.editbay`)
  await mkdir(dirname(file), { recursive: true })
  await saveProjectTo(session.getProject(), file, defaultWorkspace())
  if (written) await written(file)
  const ok = await lifecycle.openPath(file)
  expect([ok, lifecycle.takeNotices()]).toEqual([true, []])
  return file
}

/** An edit, as the window makes one, and the wait saving on its own would take. */
let nextMarker = 0
async function editAndWait(): Promise<void> {
  // A frame no marker is on yet, so the edit always changes something.
  session.applyEdit({ sequenceId: S1, kind: 'addMarker', frame: ++nextMarker } as never)
  lifecycle.changed()
  await new Promise((r) => setTimeout(r, 400))
}

describe('saving on its own', () => {
  it('saves a file that is as it was left', async () => {
    const file = await opened('kept')
    const before = (await readFile(file)).toString()
    await editAndWait()
    expect((await readFile(file)).toString()).not.toBe(before)
    expect(session.isChanged()).toBe(false)
    expect(lifecycle.takeNotices()).toEqual([])
  })

  it('leaves alone a file changed on disk meanwhile, says so once, and carries on once you save', async () => {
    const file = await opened('synced')
    await appendFile(file, '\n')
    const outside = (await readFile(file)).toString()
    await editAndWait()
    await editAndWait()
    expect((await readFile(file)).toString()).toBe(outside)
    const told = lifecycle.takeNotices()
    expect(told).toHaveLength(1)
    expect(told[0]!.text).toMatch(/changed on disk/)
    // Saved by hand, your version is kept, and saving on its own carries on from there.
    expect(await lifecycle.save(false, null)).toBe(file)
    const saved = (await readFile(file)).toString()
    await editAndWait()
    expect((await readFile(file)).toString()).not.toBe(saved)
  })

  it('does not make the folder again for a project moved away while open', async () => {
    const file = await opened('moved')
    await rename(dirname(file), join(work, 'moved-elsewhere'))
    await editAndWait()
    expect(existsSync(dirname(file))).toBe(false)
    expect(lifecycle.takeNotices()[0]?.text).toMatch(/no longer where it was opened from/)
  })

  it('does not bring a file an older version wrote up to date behind your back', async () => {
    let older = ''
    // As this version wrote it, but marked as the version before.
    const file = await opened('older', async (f) => {
      older = JSON.stringify({ ...JSON.parse((await readFile(f)).toString()), schemaVersion: SCHEMA_VERSION - 1 })
      await writeFile(f, older)
    })
    await editAndWait()
    expect((await readFile(file)).toString()).toBe(older)
    expect(lifecycle.takeNotices()[0]?.text).toMatch(/older version/)
  })

  it('renames a file changed on disk meanwhile without writing over it (audit 2026-10-08)', async () => {
    const file = await opened('renamed-synced')
    // Saved on another computer while this one had it open with nothing unsaved.
    await appendFile(file, '\n')
    const outside = (await readFile(file)).toString()
    await lifecycle.renameProject('renamed-elsewhere')
    const moved = join(dirname(file), 'renamed-elsewhere.editbay')
    expect(existsSync(file)).toBe(false)
    expect((await readFile(moved)).toString()).toBe(outside)
    expect(lifecycle.takeNotices().map((n) => n.text).join(' ')).toMatch(/changed on disk/)
    // And saving on its own does not write over it afterwards either.
    await editAndWait()
    expect((await readFile(moved)).toString()).toBe(outside)
  })
})

