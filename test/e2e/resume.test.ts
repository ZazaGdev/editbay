import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, rename, mkdir, copyFile, unlink, readFile, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-resume-cache-'))
const pickedFile = { path: '' }
/** Every question the app asked, and the answer each gets: the second button. */
const asked: { message: string; buttons: string[] }[] = []
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot },
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
  dialog: {
    showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
      canceled: false,
      filePaths: [pickedFile.path]
    }),
    showMessageBox: async (...args: unknown[]): Promise<{ response: number }> => {
      const options = args[args.length - 1] as { message: string; buttons: string[] }
      asked.push({ message: options.message, buttons: options.buttons })
      return { response: 1 }
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
const { listRecovery, readRecoveryDocument, recoveryDir, writeRecovery } = await import('../../src/main/project/recovery')
const { splitProjectFile, joinProjectFile } = await import('../../src/shared/project-file')
const { defaultWorkspace } = await import('../../src/shared/workspace')
const { SCHEMA_VERSION } = await import('../../src/shared/project')

const fx = fixtureSet('resume-e2e')
// Projects and footage stay on the fixtures' drive, because a rename cannot
// cross drives on Windows.
const work = join(fx.dir, 'work')

afterAll(async () => {
  lifecycle.stopAutosave()
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** A saved project with one clip of `source`, and the source as the project stores it. */
async function savedProjectWith(source: string, name: string) {
  session.resetProject()
  const asset = await importFile(source, ...quiet())
  expect(asset.status).toBe('ready')
  session.addAsset(asset)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'c1' })
  const file = join(work, `${name}.editbay`)
  await mkdir(work, { recursive: true })
  await saveProjectTo(session.getProject(), file, defaultWorkspace())
  return { file, media: session.mediaFromAsset(asset) }
}

describe('reopening after the cache was cleared', () => {
  it('conforms a file again when the cache lost it, and rebuilds its waveform', async () => {
    const { file, media } = await savedProjectWith(await fx.vfrClip(), 'conformed')
    expect(media.conformed).toBe(true)
    await unlink(media.playablePath)
    await unlink(media.peaksPath)

    expect(await lifecycle.openPath(file)).toBe(true)
    // Usable at once, and marked as rebuilding until it is done.
    expect(lifecycle.status().rebuilding).toEqual([media.id])
    expect(lifecycle.status().offline).toEqual([])

    await lifecycle.sourcesSettled()
    expect(lifecycle.status().rebuilding).toEqual([])
    expect(existsSync(media.playablePath)).toBe(true)
    expect(existsSync(media.peaksPath)).toBe(true)
    // It landed on the same cache key, so nothing in the project moved.
    const back = session.getProject().media[0]!
    expect(back.playablePath).toBe(media.playablePath)
    expect(back.peaksPath).toBe(media.peaksPath)
    expect(session.isChanged()).toBe(false)
  })

  it('rebuilds a missing waveform and filmstrip for a file that plays as it is', async () => {
    const { file, media } = await savedProjectWith(await fx.cleanClip(), 'clean')
    expect(media.conformed).toBe(false)
    await unlink(media.peaksPath)
    await unlink(media.filmstripPath)

    await lifecycle.openPath(file)
    expect(lifecycle.status().rebuilding).toEqual([media.id])
    await lifecycle.sourcesSettled()

    expect(lifecycle.status().rebuilding).toEqual([])
    expect(existsSync(media.peaksPath)).toBe(true)
    expect(existsSync(media.filmstripPath)).toBe(true)
    expect(session.isChanged()).toBe(false)
  })

  it('opens with nothing to do when everything is in place', async () => {
    const { file } = await savedProjectWith(await fx.cleanClip(), 'intact')
    await lifecycle.openPath(file)
    expect(lifecycle.status()).toMatchObject({ offline: [], rebuilding: [], changed: false })
  })
})

describe('relinking', () => {
  it('finds the other missing files in the folder where one turned up', async () => {
    const footage = join(fx.dir, 'footage')
    await mkdir(footage, { recursive: true })
    const a = join(footage, 'a.mp4')
    const b = join(footage, 'b.mp4')
    await copyFile(await fx.cleanClip(), a)
    await copyFile(await fx.silentClip(), b)

    session.resetProject()
    for (const p of [a, b]) {
      const asset = await importFile(p, ...quiet())
      session.addAsset(asset)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: `clip-${asset.id}` })
    }
    const ids = session.getProject().media.map((m) => m.id)
    // Saved outside the footage folder, so moving the folder loses both.
    const file = join(fx.dir, 'relink.editbay')
    await saveProjectTo(session.getProject(), file, defaultWorkspace())

    const moved = join(fx.dir, 'footage-moved')
    await rename(footage, moved)
    await lifecycle.openPath(file)
    expect([...lifecycle.status().offline].sort()).toEqual([...ids].sort())
    lifecycle.takeNotices()

    pickedFile.path = join(moved, 'a.mp4')
    await lifecycle.relink(null, ids[0]!)

    expect(lifecycle.status().offline).toEqual([])
    expect(session.getProject().media.map((m) => m.originalPath).sort()).toEqual(
      [join(moved, 'a.mp4'), join(moved, 'b.mp4')].sort()
    )
    expect(lifecycle.takeNotices().map((n) => n.text).join(' ')).toMatch(/Found 1 more missing file/)
  })

  it('refuses a sound file for a missing recording, whose clips need a picture', async () => {
    const footage = join(fx.dir, 'footage-sound')
    await mkdir(footage, { recursive: true })
    const clip = join(footage, 'take.mp4')
    await copyFile(await fx.cleanClip(), clip)

    session.resetProject()
    const asset = await importFile(clip, ...quiet())
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'take' })
    const file = join(fx.dir, 'relink-sound.editbay')
    await saveProjectTo(session.getProject(), file, defaultWorkspace())
    await unlink(clip)
    await lifecycle.openPath(file)
    expect(lifecycle.status().offline).toEqual([asset.id])
    lifecycle.takeNotices()

    pickedFile.path = await fx.beepWav()
    await lifecycle.relink(null, asset.id)

    expect(lifecycle.status().offline).toEqual([asset.id])
    expect(session.getProject().media[0]!.originalPath).toBe(clip)
    expect(lifecycle.takeNotices().map((n) => n.text).join(' ')).toMatch(/only sound/)
  })
})

describe('relinking by hand to a different recording (audit 2026-10-01)', () => {
  it('asks first, saying how many clips it would cut short, and leaves them alone when told not to', async () => {
    const footage = join(fx.dir, 'footage-different')
    await mkdir(footage, { recursive: true })
    const clip = join(footage, 'long.mp4')
    await copyFile(await fx.cleanClip(), clip)
    session.resetProject()
    const asset = await importFile(clip, ...quiet())
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'long' })
    const before = clipsOf(session.getProject()).map((c) => [c.sourceIn, c.sourceOut])
    const file = join(fx.dir, 'relink-different.editbay')
    await saveProjectTo(session.getProject(), file, defaultWorkspace())
    await unlink(clip)
    await lifecycle.openPath(file)
    lifecycle.takeNotices()
    asked.length = 0

    // A shorter recording with a picture, picked by hand.
    pickedFile.path = await fx.greenClip()
    await lifecycle.relink(null, asset.id)

    const question = asked.find((q) => /is not the same recording/.test(q.message))
    expect(question).toBeDefined()
    expect(question!.buttons).toEqual(['Use it anyway', "Don't use it"])
    // Answered "Don't use it": still missing, its clips as long as they were.
    expect(lifecycle.status().offline).toEqual([asset.id])
    expect(clipsOf(session.getProject()).map((c) => [c.sourceIn, c.sourceOut])).toEqual(before)
  })
})

describe('autosave', () => {
  it('writes a recovery copy holding the change, and a save removes it', async () => {
    const settings = join(cacheRoot, 'settings')
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()

    const { file, media } = await savedProjectWith(await fx.cleanClip(), 'autosaved')
    await lifecycle.openPath(file)
    await lifecycle.autosave()
    // Nothing unsaved, so nothing written.
    expect(await listRecovery(recoveryDir(settings))).toEqual([])

    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: media.id, clipId: 'c2' })
    await lifecycle.autosave()
    const copies = await listRecovery(recoveryDir(settings))
    expect(copies).toHaveLength(1)
    expect(copies[0]!.recoveryOf).toBe(file)
    const held = splitProjectFile(await readRecoveryDocument(copies[0]!.file))
    expect(clipsOf(held.project)).toHaveLength(2)

    await lifecycle.save(false, null)
    // Runs after the removal the save queued.
    await lifecycle.autosave()
    expect(await listRecovery(recoveryDir(settings))).toEqual([])
  })
})

describe('relinking by name', () => {
  it('does not take a different recording that happens to share the name', async () => {
    const footage = join(fx.dir, 'twins')
    await mkdir(footage, { recursive: true })
    const a = join(footage, 'a.mp4')
    const b = join(footage, 'b.mp4')
    await copyFile(await fx.cleanClip(), a)
    await copyFile(await fx.silentClip(), b)

    session.resetProject()
    for (const p of [a, b]) {
      const asset = await importFile(p, ...quiet())
      session.addAsset(asset)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: `clip-${asset.id}` })
    }
    const [idA, idB] = session.getProject().media.map((m) => m.id)
    const lengthB = clipsOf(session.getProject())[1]!.sourceOut
    const file = join(fx.dir, 'twins.editbay')
    await saveProjectTo(session.getProject(), file, defaultWorkspace())

    // The folder moves, and in its new home b.mp4 is some other recording.
    const moved = join(fx.dir, 'twins-moved')
    await rename(footage, moved)
    await copyFile(await fx.cleanClip(), join(moved, 'b.mp4'))

    await lifecycle.openPath(file)
    lifecycle.takeNotices()
    pickedFile.path = join(moved, 'a.mp4')
    await lifecycle.relink(null, idA!)

    expect(lifecycle.status().offline).toEqual([idB])
    const clipB = clipsOf(session.getProject())[1]!
    expect(clipB.sourceOut).toBe(lengthB)
    expect(session.getProject().media.find((m) => m.id === idB)!.originalPath).toBe(b)
    expect(lifecycle.takeNotices().map((n) => n.text).join(' ')).toMatch(/b\.mp4 there is a different recording/)
  })
})

describe('opening the project that is already open', () => {
  it('leaves it as it is rather than reloading it', async () => {
    const { file } = await savedProjectWith(await fx.cleanClip(), 'already')
    await lifecycle.openPath(file)
    const doc = session.getDocId()
    expect(await lifecycle.openDocument(null, file.toUpperCase())).toBe(true)
    expect(session.getDocId()).toBe(doc)
  })
})

describe('writing where you were back into the file you leave', () => {
  const moved = { ...defaultWorkspace(), aspectLocked: false }

  it('writes it into a file this version saved and nobody has touched', async () => {
    const { file } = await savedProjectWith(await fx.cleanClip(), 'writeback')
    await lifecycle.openPath(file)
    session.setWorkspace(moved)
    await lifecycle.newDocument(null)
    const back = splitProjectFile((await readFile(file)).toString())
    expect(back.workspace.aspectLocked).toBe(false)
  })

  it('leaves alone a file that changed on disk while it was open', async () => {
    const { file } = await savedProjectWith(await fx.cleanClip(), 'touched')
    await lifecycle.openPath(file)
    session.setWorkspace(moved)
    await appendFile(file, '\n')
    const outside = (await readFile(file)).toString()
    await lifecycle.newDocument(null)
    expect((await readFile(file)).toString()).toBe(outside)
  })

  it('leaves alone a file an older version wrote, which that version would no longer open', async () => {
    const { file } = await savedProjectWith(await fx.cleanClip(), 'old')
    // As this version wrote it, but marked as the version before, so it opens.
    const v1 = JSON.stringify({ ...JSON.parse((await readFile(file)).toString()), schemaVersion: SCHEMA_VERSION - 1 })
    await writeFile(file, v1)
    expect(await lifecycle.openPath(file)).toBe(true)
    session.setWorkspace(moved)
    await lifecycle.newDocument(null)
    expect((await readFile(file)).toString()).toBe(v1)
  })
})

describe('a recovery copy on offer', () => {
  it('survives saving the version underneath, and Restore keeps it safe until the next save', async () => {
    const settings = join(cacheRoot, 'offer-settings')
    const { file, media } = await savedProjectWith(await fx.cleanClip(), 'offered')
    // A copy newer than the file, holding a second clip that was never saved.
    const crashed = { ...session.getProject() }
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: media.id, clipId: 'c2' })
    const unsaved = session.getProject()
    await writeRecovery(
      recoveryDir(settings),
      { recoveryOf: file, name: 'offered', writtenAt: Date.now() + 1000 },
      joinProjectFile(unsaved, defaultWorkspace())
    )
    expect(clipsOf(crashed)).toHaveLength(1)

    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    expect(lifecycle.recoveryOffer()).toMatchObject({ name: 'offered', unanswered: false })
    expect(clipsOf(session.getProject())).toHaveLength(1)

    // Saving the saved version makes the file newer than the copy. The copy
    // was set aside, so it is still offered at the next launch.
    await lifecycle.save(false, null)
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    // Still there, and now known to be one nobody answered rather than a new crash.
    expect(lifecycle.recoveryOffer()).toMatchObject({ name: 'offered', unanswered: true })

    await lifecycle.restoreRecovery(null)
    await lifecycle.autosave()
    expect(clipsOf(session.getProject())).toHaveLength(2)
    expect(session.isChanged()).toBe(true)
    // It is now the open document's own copy, in the ordinary place.
    const copies = await listRecovery(recoveryDir(settings))
    expect(copies.map((c) => [c.recoveryOf, c.held])).toEqual([[file, false]])
    expect(lifecycle.recoveryOffer()).toBeNull()
  })
})

describe('renaming a project with unsaved changes', () => {
  it('lets go of the recovery copy kept under the old name, so it is never offered as a crash', async () => {
    const settings = join(cacheRoot, 'settings-rename')
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    const { file, media } = await savedProjectWith(await fx.cleanClip(), 'before rename')
    await lifecycle.openPath(file)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: media.id, clipId: 'c2' })
    await lifecycle.autosave()
    expect((await listRecovery(recoveryDir(settings))).map((c) => c.recoveryOf)).toEqual([file])

    await lifecycle.renameProject('after rename')
    // Straight away, before any autosave: the unsaved work is never without a copy.
    await vi.waitFor(async () =>
      expect((await listRecovery(recoveryDir(settings))).map((c) => c.recoveryOf)).toEqual([join(work, 'after rename.editbay')])
    )
  })
})

describe('a recovery copy that cannot be written', () => {
  it('is told, once, so you know a crash would lose your changes', async () => {
    const settings = join(cacheRoot, 'settings-unwritable')
    await mkdir(settings, { recursive: true })
    // A file where the folder of copies goes, so no copy can be written.
    await writeFile(recoveryDir(settings), 'not a folder')
    await lifecycle.startup(settings, 1_000_000_000, null)
    lifecycle.stopAutosave()
    const { file, media } = await savedProjectWith(await fx.cleanClip(), 'unwritable')
    await lifecycle.openPath(file)
    lifecycle.takeNotices()
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: media.id, clipId: 'c2' })
    await lifecycle.autosave()
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: media.id, clipId: 'c3' })
    await lifecycle.autosave()
    const told = lifecycle.takeNotices().filter((n) => n.text.includes('recovery copy'))
    expect(told).toHaveLength(1)
  })
})

describe('closing the window', () => {
  /** A window as guardClose sees one: it is told of a close, and closes when allowed. */
  function fakeWindow() {
    let onClose: ((e: { preventDefault: () => void }) => void) | null = null
    const win = {
      closed: false,
      on: (_event: string, handler: (e: { preventDefault: () => void }) => void) => {
        onClose = handler
      },
      close: () => {
        if (win.closed) return
        onClose?.({ preventDefault: () => undefined })
        win.closed = true
      }
    }
    return { win, tryClose: () => onClose?.({ preventDefault: () => undefined }) }
  }

  it('asks first while an export is running, since closing stops it', async () => {
    session.resetProject()
    lifecycle.setSaveAutomatically(false, () => true)
    // Stopping takes a moment, and the window waits for it to finish.
    const steps: string[] = []
    lifecycle.onCloseStop(async () => {
      steps.push('stopping')
      await new Promise((resolve) => setTimeout(resolve, 50))
      steps.push('stopped')
    })
    const { win, tryClose } = fakeWindow()
    const close = win.close
    win.close = () => {
      steps.push('closed')
      close()
    }
    lifecycle.guardClose(win as never)
    asked.length = 0
    tryClose()
    await vi.waitFor(() => expect(win.closed).toBe(true))
    expect(asked.map((a) => a.message)).toEqual(['An export is still running'])
    expect(asked[0]!.buttons).toEqual(['Keep working', 'Close anyway'])
    expect(steps).toEqual(['stopping', 'stopped', 'closed'])
    lifecycle.setSaveAutomatically(false, () => false)
  })

})
