import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-picture-style-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const { findVideoClip } = await import('../../src/shared/project')
const { placeInPixels } = await import('../../src/shared/layout')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 52 through the real pipeline, read back pixel by pixel: a green
 * recording laid in a corner over a red one, framed with rounded corners, a
 * blue border and a shadow; and a landscape recording in a vertical frame with
 * its bars filled with itself, blurred.
 */

const fx = fixtureSet('picture-style-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-picture-style-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

async function rgb(path: string, x: number, y: number, atSec: number): Promise<[number, number, number]> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
    '-vf', `crop=2:2:${Math.round(x)}:${Math.round(y)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0]
}

async function exportJoined(name: string): Promise<string> {
  const project = session.getProject()
  const scratch = join(work, `scratch-${name}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: { ...exportNames(project, S1), joined: name },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, 'out'),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return out!
}

const isRed = ([r, g, b]: [number, number, number]): boolean => r > 180 && g < 70 && b < 70
const isGreen = ([r, g, b]: [number, number, number]): boolean => g > 90 && r < 70 && b < 70
const isBlue = ([r, g, b]: [number, number, number]): boolean => b > 180 && r < 70 && g < 70

describe('a picture in picture, framed', () => {
  it('has rounded corners, a border round it and a shadow under it', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 0, onTrack: 'V2' })
    // The whole green recording, in a 16:9 box in the upper right.
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: 'g', rect: { x: 0, y: 0, w: 640, h: 360 } })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'g', picture: 'main', place: { x: 0.5, y: 0.05, w: 0.4, h: 243 / 1920 }, reshapeCrop: false })
    session.applyEdit({ sequenceId: S1, kind: 'setPictureStyle', clipId: 'g', picture: 'main', style: { radius: 40, border: 10, borderColour: '#0000ff', shadow: true } })
    const box = placeInPixels(findVideoClip(firstTimeline(session.getProject()), 'g')!.clip.transform.place, 1080, 1920)

    const out = await exportJoined('framed')
    const midX = box.x + box.w / 2
    expect(isGreen(await rgb(out, midX, box.y + box.h / 2, 1))).toBe(true)
    // The border, just outside the box's top edge.
    expect(isBlue(await rgb(out, midX, box.y - 6, 1))).toBe(true)
    // Past the rounded corner of the border: the red underneath.
    expect(isRed(await rgb(out, box.x - 8, box.y - 8, 1))).toBe(true)
    // Just inside the box's own corner, rounded off: the border shows there, not the picture.
    expect(isGreen(await rgb(out, box.x + 3, box.y + 3, 1))).toBe(false)
    // The shadow under it darkens the red, and far below it the red is as it was.
    // Two pixels under the border, well inside the shadow rather than on its soft edge.
    const [r] = await rgb(out, midX, box.y + box.h + 10 + 2, 1)
    expect(r).toBeLessThan(200)
    expect(r).toBeGreaterThan(60)
    expect(isRed(await rgb(out, midX, box.y + box.h + 200, 1))).toBe(true)
  })
})

describe("a border's colour", () => {
  it('is the colour chosen, as the preview draws it (audit 2026-10-01)', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 0, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: 'g', rect: { x: 0, y: 0, w: 640, h: 360 } })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'g', picture: 'main', place: { x: 0.5, y: 0.05, w: 0.4, h: 243 / 1920 }, reshapeCrop: false })
    session.applyEdit({ sequenceId: S1, kind: 'setPictureStyle', clipId: 'g', picture: 'main', style: { radius: 0, border: 16, borderColour: '#e02020' } })
    const box = placeInPixels(findVideoClip(firstTimeline(session.getProject()), 'g')!.clip.transform.place, 1080, 1920)
    const out = await exportJoined('border-colour')
    const [r, g, b] = await rgb(out, box.x + box.w / 2, box.y - 8, 1)
    expect(Math.abs(r! - 0xe0)).toBeLessThanOrEqual(6)
    expect(Math.abs(g! - 0x20)).toBeLessThanOrEqual(6)
    expect(Math.abs(b! - 0x20)).toBeLessThanOrEqual(6)
  })
})

describe('a framed picture in picture through a crossfade', () => {
  it('keeps its border all the way through the blend into the next one', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // Two pieces of the green recording on V2, 0 to 1.5 s and 1.5 s on, both framed, crossfaded.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 0, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'g', frame: 45, alone: true })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'h', at: 45, onTrack: 'V2' })
    for (const id of ['g', 'h']) {
      session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: id, rect: { x: 0, y: 0, w: 640, h: 360 } })
      session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: id, picture: 'main', place: { x: 0.5, y: 0.05, w: 0.4, h: 243 / 1920 }, reshapeCrop: false })
      session.applyEdit({ sequenceId: S1, kind: 'setPictureStyle', clipId: id, picture: 'main', style: { radius: 40, border: 10, borderColour: '#0000ff' } })
    }
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'h', side: 'in', transitionKind: 'dissolve', length: 20, alone: true })
    const box = placeInPixels(findVideoClip(firstTimeline(session.getProject()), 'g')!.clip.transform.place, 1080, 1920)
    const out = await exportJoined('framed-blend')
    const midX = box.x + box.w / 2
    // Before, in the middle of and after the blend.
    for (const at of [0.8, 1.5, 2.2]) {
      expect(isBlue(await rgb(out, midX, box.y - 6, at))).toBe(true)
      expect(isGreen(await rgb(out, midX, box.y + box.h / 2, at))).toBe(true)
    }
  })
})

describe('a blurred background', () => {
  it('fills the bars round a landscape recording in a vertical frame with the recording, not black', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    session.addAsset(red)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    // The whole landscape frame, so it is fitted with bars above and below.
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: 'r', rect: { x: 0, y: 0, w: 640, h: 360 } })
    const plain = await exportJoined('bars')
    const [br, bg, bb] = await rgb(plain, 540, 150, 1)
    expect(br + bg + bb).toBeLessThan(40)

    session.applyEdit({ sequenceId: S1, kind: 'setBlurFill', clipId: 'r', on: true })
    const blurred = await exportJoined('blurred')
    expect(isRed(await rgb(blurred, 540, 150, 1))).toBe(true)
    expect(isRed(await rgb(blurred, 540, 960, 1))).toBe(true)
  })
})
