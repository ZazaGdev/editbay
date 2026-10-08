import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, appendFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-versions-cache-'))
/** The questions asked, and the button each is answered with: "Don't save" unless set. */
const asked: string[] = []
const answer = { response: 1 }
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot },
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
  dialog: {
    showMessageBox: async (...args: unknown[]): Promise<{ response: number }> => {
      asked.push((args[args.length - 1] as { message: string }).message)
      return { response: answer.response }
    },
    showSaveDialog: async (): Promise<{ canceled: boolean }> => ({ canceled: true }),
    showErrorBox: (): void => {}
  }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { saveProjectTo } = await import('../../src/main/project/store')
const session = await import('../../src/main/project/session')
const { S1, clipsOf } = await import('../project-helpers')
const lifecycle = await import('../../src/main/project/lifecycle')
const { listRecovery, recoveryDir } = await import('../../src/main/project/recovery')
const { listVersions, versionsDir } = await import('../../src/main/project/versions')
const { defaultWorkspace } = await import('../../src/shared/workspace')

/**
 * Plan 84: every way work used to be lost now keeps an earlier version, and
 * an earlier version opens again.
 */

const fx = fixtureSet('versions-e2e')
const work = join(fx.dir, 'work')
const versions = versionsDir(cacheRoot)
let source = ''

beforeAll(async () => {
  source = await fx.cleanClip()
})

afterAll(async () => {
  lifecycle.stopAutosave()
  lifecycle.setSaveAutomatically(false, () => false)
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** A saved project with one clip, opened, and the source's id. */
async function opened(name: string): Promise<{ file: string; mediaId: string }> {
  session.resetProject()
  const asset = await importFile(source, ...quiet())
  session.addAsset(asset)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'c1' })
  const file = join(work, name, `${name}.editbay`)
  await mkdir(dirname(file), { recursive: true })
  await saveProjectTo(session.getProject(), file, defaultWorkspace())
  answer.response = 1
  expect(await lifecycle.openPath(file)).toBe(true)
  asked.length = 0
  return { file, mediaId: asset.id }
}

/** A second clip of the source: a change worth keeping. */
function addClip(mediaId: string, clipId: string): void {
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId, clipId })
}

describe('with Save automatically off', () => {
  beforeAll(() => lifecycle.setSaveAutomatically(false, () => false))

  it("keeps the changes given up with Don't save, and opens them again", async () => {
    const { file, mediaId } = await opened('given-up')
    addClip(mediaId, 'c2')
    expect(await lifecycle.newDocument(null)).toBe(true)
    expect(asked).toEqual(['Save changes to given-up?'])
    expect(clipsOf(session.getProject())).toHaveLength(0)

    expect(await lifecycle.openPath(file)).toBe(true)
    const listed = await lifecycle.earlierVersions()
    expect(listed.versions.map((v) => v.reason)).toEqual(['not-saved'])
    expect(await lifecycle.openEarlierVersion(null, listed.versions[0]!.id)).toBe(true)
    // The work given up, attached to its file and not saved yet.
    expect(clipsOf(session.getProject())).toHaveLength(2)
    expect(session.getProjectPath()).toBe(file)
    expect(session.isChanged()).toBe(true)
  })

  it('keeps the work of a project never saved when it is given up', async () => {
    session.resetProject()
    const asset = await importFile(source, ...quiet())
    session.addAsset(asset)
    addClip(asset.id, 'u1')
    answer.response = 1
    expect(await lifecycle.newDocument(null)).toBe(true)
    const kept = await listVersions(versions, null)
    expect(kept[0]?.reason).toBe('not-saved')
  })

  it('keeps the file as it was opened before the first save over it, and only that once', async () => {
    const { file, mediaId } = await opened('first-save')
    const asOpened = (await readFile(file)).toString()
    addClip(mediaId, 'c2')
    expect(await lifecycle.save(false, null)).toBe(file)
    addClip(mediaId, 'c3')
    expect(await lifecycle.save(false, null)).toBe(file)
    const kept = await listVersions(versions, file)
    expect(kept.map((v) => v.reason)).toEqual(['saved-over'])
    expect(await lifecycle.openEarlierVersion(null, kept[0]!.id)).toBe(true)
    expect(clipsOf(session.getProject())).toHaveLength(1)
    // Saving the old one back keeps the newer one first, three clips and all.
    expect(await lifecycle.save(false, null)).toBe(file)
    expect(JSON.parse((await readFile(file)).toString()).sequences).toEqual(JSON.parse(asOpened).sequences)
    const now = await listVersions(versions, file)
    expect(now.map((v) => v.reason)).toEqual(['saved-over', 'saved-over'])
    const newer = (await import('../../src/main/project/versions')).readVersion(versions, now[0]!.id)
    expect(clipsOf(JSON.parse((await newer).text))).toHaveLength(3)
  })

  it('keeps a version changed elsewhere before a save writes over it', async () => {
    const { file, mediaId } = await opened('elsewhere')
    await appendFile(file, '\n')
    const outside = (await readFile(file)).toString()
    addClip(mediaId, 'c2')
    expect(await lifecycle.save(false, null)).toBe(file)
    const kept = await listVersions(versions, file)
    expect(kept[0]?.reason).toBe('changed-elsewhere')
    expect((await (await import('../../src/main/project/versions')).readVersion(versions, kept[0]!.id)).text).toBe(outside)
  })
})

describe('with Save automatically on', () => {
  beforeAll(() => lifecycle.setSaveAutomatically(true, () => false))

  it('saves on closing, New or Open without asking, when the file is as it was left', async () => {
    const { file, mediaId } = await opened('closing')
    addClip(mediaId, 'c2')
    expect(await lifecycle.newDocument(null)).toBe(true)
    expect(asked).toEqual([])
    expect(await lifecycle.openPath(file)).toBe(true)
    expect(clipsOf(session.getProject())).toHaveLength(2)
  })

  it('asks when the file changed elsewhere, and keeps what is given up', async () => {
    const { file, mediaId } = await opened('closing-held')
    await appendFile(file, '\n')
    addClip(mediaId, 'c2')
    answer.response = 1
    expect(await lifecycle.newDocument(null)).toBe(true)
    expect(asked).toEqual(['Save changes to closing-held?'])
    expect((await listVersions(versions, file))[0]?.reason).toBe('not-saved')
  })
})

describe('the recovery copy', () => {
  it('is written a moment after a change, not a minute', async () => {
    const settings = join(cacheRoot, 'settings')
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.setSaveAutomatically(false, () => false)
    const { file, mediaId } = await opened('soon')
    addClip(mediaId, 'c2')
    lifecycle.changed()
    await expect.poll(async () => (await listRecovery(recoveryDir(settings))).map((c) => c.recoveryOf), { timeout: 5000 }).toEqual([file])
    answer.response = 1
    await lifecycle.newDocument(null)
    lifecycle.stopAutosave()
  })

  it('is not offered when its project file already holds its work, however the clocks say (audit 2026-10-01)', async () => {
    const settings = join(cacheRoot, 'settings-saved')
    const dir = recoveryDir(settings)
    await mkdir(dir, { recursive: true })
    const { file } = await opened('held-already')
    const { joinProjectFile, splitProjectFile } = await import('../../src/shared/project-file')
    const { writeRecovery } = await import('../../src/main/project/recovery')
    const onDisk = splitProjectFile((await readFile(file)).toString())
    // Written "after" the file by this computer's clock, as a NAS running slow would make it look.
    await writeRecovery(dir, { recoveryOf: file, name: 'held-already', writtenAt: Date.now() + 3_600_000 }, joinProjectFile(onDisk.project, onDisk.workspace))
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    expect(lifecycle.recoveryOffer()).toBeNull()
    expect(await listRecovery(dir)).toEqual([])
  })

  it('is kept as an earlier version when it is set aside at launch', async () => {
    const settings = join(cacheRoot, 'settings-offer')
    const dir = recoveryDir(settings)
    await mkdir(dir, { recursive: true })
    // A copy of a project never saved, as a crash leaves it.
    session.resetProject()
    const { joinProjectFile } = await import('../../src/shared/project-file')
    const { writeRecovery } = await import('../../src/main/project/recovery')
    await writeRecovery(dir, { recoveryOf: null, name: 'crashed', writtenAt: Date.now() }, joinProjectFile(session.getProject(), defaultWorkspace()))
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    expect(lifecycle.recoveryOffer()?.name).toBe('crashed')
    const before = (await listVersions(versions, null)).length
    await lifecycle.discardRecovery()
    const after = await listVersions(versions, null)
    expect(after.length).toBe(before + 1)
    expect(after[0]!.reason).toBe('recovery-discarded')
    expect(await listRecovery(dir)).toEqual([])
    await writeFile(join(dir, 'unused.txt'), '')
  })
})
