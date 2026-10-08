import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SourceAccess } from '../../src/main/project/store'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-flow-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { saveProjectTo, loadProjectFrom } = await import('../../src/main/project/store')
const session = await import('../../src/main/project/session')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')
const { timelineDuration, clipLength, mediaDurationFrames, upsertMedia } = await import(

  '../../src/shared/project'
)

/** Opens as if everything the project names were on this computer, in a cache that holds the whole temp folder. */
const anywhere: SourceAccess = { allowed: new Set(), cacheDir: tmpdir(), offlineDir: join(tmpdir(), 'offline'), ask: async () => [] }

const fx = fixtureSet('flow')
const work = await mkdtemp(join(tmpdir(), 'editbay-flow-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

describe('the whole editing flow', () => {
  it('imports, cuts, saves and reopens identically', async () => {
    session.resetProject()

    // Import two real files through the real pipeline.
    const a = await importFile(await fx.cleanClip(), ...quiet())
    const b = await importFile(await fx.silentClip(), ...quiet())
    expect(a.status).toBe('ready')
    expect(b.status).toBe('ready')

    session.addAsset(a)
    session.addAsset(b)
    expect(session.getProject().media).toHaveLength(2)

    // Build a cut: both clips, trim the first, split it, drop the middle piece.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: a.id, clipId: 'a1' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: b.id, clipId: 'b1' })
    const firstClip = clipsOf(session.getProject())[0]!
    // I on V1 a second in, which closes up.
    session.applyEdit({ sequenceId: S1, kind: 'trimToFrame', clipId: firstClip.id, edge: 'start', frame: 30 })
    session.applyEdit({ sequenceId: S1, kind: 'split', frame: 20 })
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: clipsOf(session.getProject())[0]!.id, rect: { x: 0, y: 0, w: 360, h: 360 } })

    const built = session.getProject()
    expect(clipsOf(built)).toHaveLength(3)
    expect(timelineDuration(firstTimeline(built))).toBe(clipsOf(built).reduce((n, c) => n + clipLength(c), 0))

    // Save and reopen.
    const file = join(work, 'flow.editbay')
    await saveProjectTo(built, file)
    const loaded = await loadProjectFrom(file, anywhere)

    expect(loaded.project).toEqual(built)
    expect(loaded.missingMedia).toEqual([])
    expect(clipsOf(loaded.project)[0]?.transform.crop).toEqual({ x: 0, y: 0, w: 360, h: 360 })
  })

  it('reports a source that has moved, and relinking restores the cut', async () => {
    session.resetProject()
    const clip = await importFile(await fx.cleanClip(), ...quiet())
    session.addAsset(clip)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: clip.id, clipId: 'c1' })

    const file = join(work, 'moved.editbay')
    await saveProjectTo(session.getProject(), file)

    // Move the source out from under the project. Same drive, because rename
    // cannot cross devices on Windows.
    const moved = join(fx.dir, 'moved-source.mp4')
    await rename(clip.playablePath, moved)

    const missing = await loadProjectFrom(file, anywhere)
    expect(missing.missingMedia).toEqual([clip.id])
    expect(clipsOf(missing.project)).toHaveLength(1)

    // Relink: import the file from its new home, keep the old id.
    const found = await importFile(moved, ...quiet())
    const relinked = upsertMedia(missing.project, { ...session.mediaFromAsset(found), id: clip.id })
    expect(clipsOf(relinked)).toHaveLength(1)
    expect(relinked.media.find((m) => m.id === clip.id)?.playablePath).toBe(moved)

    await saveProjectTo(relinked, file)
    expect((await loadProjectFrom(file, anywhere)).missingMedia).toEqual([])
  })

  it('pulls a clip back inside a source that got shorter on relink', async () => {
    session.resetProject()
    const long = await importFile(await fx.cleanClip(), ...quiet()) // 4 seconds
    session.addAsset(long)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: long.id, clipId: 'c1' })

    const before = session.getProject()
    const fps = before.fps
    expect(clipLength(clipsOf(before)[0]!)).toBe(mediaDurationFrames(before.media[0]!, fps))

    // Relink to a genuinely shorter file, keeping the id.
    const short = await importFile(await fx.silentClip(), ...quiet()) // 3 seconds
    const after = upsertMedia(before, { ...session.mediaFromAsset(short), id: long.id })

    const media = after.media.find((m) => m.id === long.id)!
    expect(clipsOf(after)[0]!.sourceOut).toBeLessThanOrEqual(mediaDurationFrames(media, fps))
    expect(clipsOf(after)[0]!.sourceIn).toBeLessThan(clipsOf(after)[0]!.sourceOut)
  })
})
