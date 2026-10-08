import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-keying-cache-'))
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
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 90, background removal through the real pipeline: a clip shot on a
 * green, blue or black screen with a white box in its middle, laid over red
 * footage with its background taken out, exported and read back. Where the
 * screen was, the red shows; where the box is, the box does. On V1 alone, with
 * nothing under it, the screen goes black.
 */

const fx = fixtureSet('keying-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-keying-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** A 640x360 clip of a screen in `colour` with a white box in its middle, 4 seconds at 30 fps. */
async function screenClip(colour: string, name: string): Promise<string> {
  await mkdir(fx.dir, { recursive: true })
  const out = join(fx.dir, `${name}.mp4`)
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${colour}:s=640x360:r=30:d=4`,
    '-vf', 'drawbox=x=280:y=135:w=80:h=90:color=white:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    out
  ])
  return out
}

type Colour = 'red' | 'white' | 'black' | 'screen' | 'other'

async function colourAt(path: string, x: number, y: number, atSec: number): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
    '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 180 && g < 70 && b < 70) return 'red'
  if (r > 200 && g > 200 && b > 200) return 'white'
  if (r < 40 && g < 40 && b < 40) return 'black'
  if (g > 120 || b > 120) return 'screen'
  return 'other'
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
  const [output] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return output!
}

// A vertical frame shows the middle of the 640x360 clip, x 219 to 421, filling it: the box is
// x 326 to 754, y 720 to 1200 of the 1080x1920 frame.
const IN_BOX = [540, 960] as const
const SCREEN = [100, 300] as const

const SCREENS = [
  { colour: 'green', fill: '0x00B140' },
  { colour: 'blue', fill: '0x0047BB' },
  { colour: 'black', fill: 'black' }
] as const

describe('a clip with its background taken out', () => {
  for (const s of SCREENS) {
    it(`over footage, shows the footage where its ${s.colour} screen was, and its subject where it is`, async () => {
      session.resetProject()
      const red = await importFile(await fx.redClip(), ...quiet())
      const shot = await importFile(await screenClip(s.fill, `${s.colour}-screen`), ...quiet())
      session.addAsset(red)
      session.addAsset(shot)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
      session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: shot.id, clipId: 'k', at: 0, onTrack: 'V2' })

      const before = await exportJoined(`${s.colour}-kept`)
      expect(await colourAt(before, ...SCREEN, 1)).toBe(s.colour === 'black' ? 'black' : 'screen')

      session.applyEdit({ sequenceId: S1, kind: 'setRemoveBackground', clipId: 'k', removal: { colour: s.colour } })
      const out = await exportJoined(`${s.colour}-out`)
      expect(await colourAt(out, ...SCREEN, 1)).toBe('red')
      expect(await colourAt(out, ...IN_BOX, 1)).toBe('white')
    })
  }

  it('is not framed or given blurred bars over footage, which would cover what shows through', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const shot = await importFile(await screenClip('0x00B140', 'green-framed'), ...quiet())
    session.addAsset(red)
    session.addAsset(shot)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // In the same edit that puts it on, as an effect lands.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: shot.id, clipId: 'k', at: 0, onTrack: 'V2', removeBackground: { colour: 'green' } })
    session.applyEdit({ sequenceId: S1, kind: 'setPictureStyle', clipId: 'k', picture: 'main', style: { radius: 60, border: 12, shadow: true } })
    session.applyEdit({ sequenceId: S1, kind: 'setBlurFill', clipId: 'k', on: true })
    const out = await exportJoined('framed')
    expect(await colourAt(out, ...SCREEN, 1)).toBe('red')
    expect(await colourAt(out, ...IN_BOX, 1)).toBe('white')
  })

  it('on V1 alone, has black where its screen was', async () => {
    session.resetProject()
    const shot = await importFile(await screenClip('0x00B140', 'green-alone'), ...quiet())
    session.addAsset(shot)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: shot.id, clipId: 'k' })
    session.applyEdit({ sequenceId: S1, kind: 'setRemoveBackground', clipId: 'k', removal: { colour: 'green' } })
    const out = await exportJoined('alone')
    expect(await colourAt(out, ...SCREEN, 1)).toBe('black')
    expect(await colourAt(out, ...IN_BOX, 1)).toBe('white')
  })
})

describe('a plain background of any colour taken out (plan 98)', () => {
  /** A 640x360 clip of a plain `fill` with a dark blue box in its middle, 4 seconds at 30 fps. */
  async function plainClip(fill: string, name: string): Promise<string> {
    await mkdir(fx.dir, { recursive: true })
    const out = join(fx.dir, `${name}.mp4`)
    await capture(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${fill}:s=640x360:r=30:d=4`,
      '-vf', 'drawbox=x=280:y=135:w=80:h=90:color=0x203070:t=fill',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      out
    ])
    return out
  }

  async function rgbAt(path: string, x: number, y: number): Promise<number[]> {
    const { stdout } = await capture(ffmpegPath, [
      '-v', 'error', '-ss', '1', '-i', path, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
    ])
    return [stdout[0]!, stdout[1]!, stdout[2]!]
  }

  const near = (got: number[], want: number[]): boolean => got.every((v, i) => Math.abs(v - want[i]!) <= 30)
  const RED = [255, 0, 0]
  const BOX = [32, 48, 112]

  for (const s of [
    { name: 'white', fill: '0xF0F0F0', rgb: [240, 240, 240] },
    { name: 'grey', fill: '0x808080', rgb: [128, 128, 128] },
    { name: 'orange', fill: '0xE07020', rgb: [224, 112, 32] }
  ]) {
    it(`over footage, shows the footage where its ${s.name} background was, and its subject where it is`, async () => {
      session.resetProject()
      const red = await importFile(await fx.redClip(), ...quiet())
      const shot = await importFile(await plainClip(s.fill, `${s.name}-plain`), ...quiet())
      session.addAsset(red)
      session.addAsset(shot)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
      session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: shot.id, clipId: 'k', at: 0, onTrack: 'V2' })
      session.applyEdit({ sequenceId: S1, kind: 'setRemoveBackground', clipId: 'k', removal: { colour: 'plain', rgb: s.rgb as [number, number, number] } })
      const out = await exportJoined(`${s.name}-plain-out`)
      expect(near(await rgbAt(out, ...SCREEN), RED)).toBe(true)
      expect(near(await rgbAt(out, ...IN_BOX), BOX)).toBe(true)
    })
  }
})

describe("an effect's background, read from its file", () => {
  it('is green, blue or black for a screen of that colour, and none for ordinary footage or a clear picture', async () => {
    const { detectBackground } = await import('../../src/main/media/background')
    expect(await detectBackground(await screenClip('0x00B140', 'detect-green'))).toBe('green')
    expect(await detectBackground(await screenClip('0x0047BB', 'detect-blue'))).toBe('blue')
    expect(await detectBackground(await screenClip('black', 'detect-black'))).toBe('black')
    expect(await detectBackground(await fx.cleanClip())).toBeNull()
    expect(await detectBackground(await fx.logoPng())).toBeNull()
    expect(await detectBackground(join(fx.dir, 'not-there.mp4'))).toBeNull()
  })
})
