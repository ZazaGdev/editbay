import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The import pipeline reads its cache location from Electron, which is not
 * running here. Pointing it at a temporary directory lets the whole pipeline be
 * exercised for real: probe, variable timing detection, conform, re-probe,
 * peaks and filmstrip.
 */
const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { probeFile } = await import('../../src/main/media/probe')

const fx = fixtureSet('pipeline')

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

describe('importing a clean file', () => {
  it('uses the original and never writes a conformed copy', async () => {
    const path = await fx.cleanClip()
    const asset = await importFile(path, ...quiet())

    expect(asset.status).toBe('ready')
    expect(asset.conformed).toBe(false)
    expect(asset.conformReasons).toEqual([])
    expect(asset.playablePath).toBe(path)
    expect(asset.hasAudio).toBe(true)
    expect(asset.width).toBe(640)
    expect(asset.height).toBe(360)
    expect(asset.fps).toBe(30)
    expect(asset.durationSec).toBeCloseTo(4, 1)
  })

  it('writes a waveform and a filmstrip into the cache', async () => {
    const path = await fx.cleanClip()
    const asset = await importFile(path, ...quiet())

    expect((await stat(asset.peaksPath)).size).toBeGreaterThan(16)
    expect((await stat(asset.filmstripPath)).size).toBeGreaterThan(1000)
  })

  it('reports every stage in order and ends ready', async () => {
    const path = await fx.cleanClip()
    const stages: string[] = []
    await importFile(path, (p) => stages.push(p.status), () => {})

    expect(stages[0]).toBe('probing')
    expect(stages).toContain('analysing')
    expect(stages.at(-1)).toBe('ready')
    expect(stages).not.toContain('conforming')
    expect(stages).not.toContain('failed')
  })
})

describe('importing a variable frame rate file', () => {
  it('detects it even though ffprobe reports a clean constant rate', async () => {
    const path = await fx.vfrClip()
    const probe = await probeFile(path)
    // The guard this test exists for. If these two ever stop matching, the
    // fixture has stopped representing the case that matters: a file whose
    // reported rates look perfect and whose timestamps do not.
    expect(probe.video.nominalFps).toBe(probe.video.averageFps)

    const asset = await importFile(path, ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.conformed).toBe(true)
    expect(asset.conformReasons).toContain('variable-frame-rate')
    expect(asset.playablePath).not.toBe(path)
    expect(asset.playablePath).toContain(cacheRoot)
  })

  it('produces a conformed file with steady timing', async () => {
    const path = await fx.vfrClip()
    const asset = await importFile(path, ...quiet())
    const { detectVfr } = await import('../../src/main/media/vfr')
    const after = await probeFile(asset.playablePath)

    expect(await detectVfr(asset.playablePath, after.video.nominalFps, after.video.averageFps)).toBe(false)
  })
})

describe('importing a source larger than the conform cap', () => {
  it('reports the conformed size, not the original', async () => {
    const path = await fx.oversizedClip()
    const original = await probeFile(path)
    expect(original.video.width).toBe(4200)
    expect(original.video.bitDepth).toBe(10)

    const asset = await importFile(path, ...quiet())
    const conformed = await probeFile(asset.playablePath)

    expect(asset.status).toBe('ready')
    expect(asset.conformed).toBe(true)
    // The bug this fix exists for: the asset must describe the file the editor
    // plays and crops against. A crop rectangle is in the pixels of that file,
    // so reporting the original 4200 wide frame would put every crop wrong.
    expect(asset.width).toBe(conformed.video.width)
    expect(asset.height).toBe(conformed.video.height)
    expect(asset.width).toBe(3840)
    expect(asset.width).not.toBe(original.video.width)
    expect(asset.durationSec).toBeCloseTo(conformed.durationSec, 3)
  })
})

describe('importing a file with no audio', () => {
  it('succeeds and says so', async () => {
    const path = await fx.silentClip()
    const asset = await importFile(path, ...quiet())

    expect(asset.status).toBe('ready')
    expect(asset.hasAudio).toBe(false)
    // Header only: a peaks file always exists, even when there is nothing in it.
    expect((await stat(asset.peaksPath)).size).toBe(16)
  })
})

describe('importing the same file twice', () => {
  it('reuses the cache rather than conforming again', async () => {
    const path = await fx.vfrClip()
    const first = await importFile(path, ...quiet())

    const stages: string[] = []
    const second = await importFile(path, (p) => stages.push(p.status), () => {})

    expect(second.playablePath).toBe(first.playablePath)
    expect(second.durationSec).toBe(first.durationSec)
    expect(stages).not.toContain('conforming')
  })
})

describe('importing something that is not there', () => {
  it('fails with a readable reason instead of throwing', async () => {
    const asset = await importFile(join(fx.dir, 'does-not-exist.mp4'), ...quiet())

    expect(asset.status).toBe('failed')
    expect(asset.error).toBeTruthy()
  })
})

describe('the asset registry', () => {
  it('returns the same asset when a file is imported twice', async () => {
    const { listAssets, clearAssets } = await import('../../src/main/media/import')
    clearAssets()

    const path = await fx.cleanClip()
    const first = await importFile(path, ...quiet())
    const second = await importFile(path, ...quiet())

    // Re-importing must not fill the bin with copies, only one of which the
    // project actually references.
    expect(second.id).toBe(first.id)
    expect(listAssets()).toHaveLength(1)
  })

  it('still adds a genuinely different file', async () => {
    const { listAssets, clearAssets } = await import('../../src/main/media/import')
    clearAssets()

    await importFile(await fx.cleanClip(), ...quiet())
    await importFile(await fx.silentClip(), ...quiet())
    expect(listAssets()).toHaveLength(2)
  })

  it('can be emptied, so a new project starts with an empty bin', async () => {
    const { listAssets, clearAssets } = await import('../../src/main/media/import')
    await importFile(await fx.cleanClip(), ...quiet())
    expect(listAssets().length).toBeGreaterThan(0)
    clearAssets()
    expect(listAssets()).toHaveLength(0)
  })

  it('adopts the sources of an opened project without re-importing them', async () => {
    const { listAssets, clearAssets, adoptMedia } = await import('../../src/main/media/import')
    const session = await import('../../src/main/project/session')
    clearAssets()

    const asset = await importFile(await fx.cleanClip(), ...quiet())
    const media = [session.mediaFromAsset(asset)]
    clearAssets()
    adoptMedia(media)

    expect(listAssets()).toHaveLength(1)
    expect(listAssets()[0]?.id).toBe(asset.id)
    expect(listAssets()[0]?.status).toBe('ready')
  })
})
