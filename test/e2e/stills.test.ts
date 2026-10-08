import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-stills-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { STILL_SEC, findVideoClip, timelineDuration } = await import('../../src/shared/project')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * A picture through the real pipeline: a 400x200 PNG, clear but for a green
 * box in its middle, imported, put over red footage and exported, then read
 * back pixel by pixel. Its clear pixels are magenta underneath, so any step
 * that dropped the transparency rather than honouring it would show magenta.
 */

const fx = fixtureSet('stills-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-stills-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

async function countFrames(path: string): Promise<number> {
  const out = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path
  ])
  return Number(out.trim())
}

type Colour = 'red' | 'green' | 'black' | 'grey' | 'magenta' | 'other'

/** The colour of one pixel of the frame at `atSec`, as H.264 leaves it. */
async function colourAt(path: string, x: number, y: number, atSec: number): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
    '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 180 && g < 70 && b > 180) return 'magenta'
  if (r > 180 && g < 70 && b < 70) return 'red'
  if (g > 100 && r < 70 && b < 70) return 'green'
  if (r < 40 && g < 40 && b < 40) return 'black'
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 6) return 'grey'
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

// On a 1080x1920 frame the 400x200 picture is fitted 1080 wide and 540 tall,
// from y 690. Its green box is the middle half: x 270 to 810, y 825 to 1095.
const IN_BOX = [540, 960] as const
const CLEAR = [100, 960] as const
const OUTSIDE = [540, 300] as const

describe('a picture', () => {
  it('imports as a picture: upright, with its own size, a filmstrip, and no sound', async () => {
    session.resetProject()
    const logo = await importFile(await fx.logoPng(), ...quiet())
    expect(logo.status).toBe('ready')
    expect(logo.still).toBe(true)
    expect(logo.hasAudio).toBe(false)
    expect([logo.width, logo.height]).toEqual([400, 200])
    expect(logo.durationSec).toBe(STILL_SEC)
    expect(logo.playablePath).toMatch(/picture\.png$/)
    expect((await stat(logo.filmstripPath)).size).toBeGreaterThan(0)
  })

  it('laid over footage, shows the footage through its clear parts', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(red)
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // From 1 s, five seconds long, which runs past the four seconds of red.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p', at: 30, onTrack: 'V2' })
    const t = firstTimeline(session.getProject())
    const p = findVideoClip(t, 'p')!.clip
    expect(p.sourceOut - p.sourceIn).toBe(150)
    expect(timelineDuration(t)).toBe(180)

    const out = await exportJoined('over')
    expect(await countFrames(out)).toBe(180)
    expect(await colourAt(out, ...IN_BOX, 0.5)).toBe('red')
    expect(await colourAt(out, ...IN_BOX, 1.0)).toBe('green')
    expect(await colourAt(out, ...IN_BOX, 2.0)).toBe('green')
    expect(await colourAt(out, ...CLEAR, 2.0)).toBe('red')
    expect(await colourAt(out, ...OUTSIDE, 2.0)).toBe('red')
    // Past the footage's end, over black, and still clear around the box.
    expect(await colourAt(out, ...IN_BOX, 5.0)).toBe('green')
    expect(await colourAt(out, ...CLEAR, 5.0)).toBe('black')
  })

  it('in black and white, is grey and still clear', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setLook', clipId: 'p', look: 'mono' })
    const out = await exportJoined('mono')
    expect(await colourAt(out, ...IN_BOX, 2.0)).toBe('grey')
    expect(await colourAt(out, ...CLEAR, 2.0)).toBe('red')
  })

  it('on V1 alone, has black through its clear parts', async () => {
    session.resetProject()
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p' })
    const out = await exportJoined('alone')
    expect(await countFrames(out)).toBe(150)
    expect(await colourAt(out, ...IN_BOX, 1.0)).toBe('green')
    expect(await colourAt(out, ...CLEAR, 1.0)).toBe('black')
    expect(await colourAt(out, ...OUTSIDE, 1.0)).toBe('black')
  })
})

describe('a picture placed freely', () => {
  /** Red footage on V1 and the picture over it on V2, from 1 s. */
  async function overFootage(): Promise<void> {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(red)
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p', at: 30, onTrack: 'V2' })
  }

  async function rgb(path: string, x: number, y: number, atSec: number): Promise<[number, number, number]> {
    const { stdout } = await capture(ffmpegPath, [
      '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
      '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
    ])
    return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0]
  }

  it('turned a quarter, stands upright on the frame where the preview puts it', async () => {
    await overFootage()
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'p', rotation: 90 })
    const out = await exportJoined('turned')
    expect(await countFrames(out)).toBe(180)
    // Turned about the frame's middle, the green box is 270 wide and 540 tall there.
    expect(await colourAt(out, 540, 1150, 2.0)).toBe('green')
    expect(await colourAt(out, 700, 960, 2.0)).toBe('red')
    expect(await colourAt(out, 540, 960, 2.0)).toBe('green')
  })

  it('at half opacity, is half way between its colour and the footage', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'p', rotation: 0, opacity: 0.5 })
    const out = await exportJoined('faded')
    const [r, g, b] = await rgb(out, ...IN_BOX, 2.0)
    // Red at 255 and green at 200, half each.
    expect(r).toBeGreaterThan(90)
    expect(r).toBeLessThan(170)
    expect(g).toBeGreaterThan(60)
    expect(g).toBeLessThan(140)
    expect(b).toBeLessThan(50)
    // Still clear around the box.
    expect(await colourAt(out, ...CLEAR, 2.0)).toBe('red')
  })

  it('half off the frame, shows the half on it and nothing past the edge', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'p', opacity: 1 })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'p', picture: 'main', place: { x: -0.5, y: 690 / 1920, w: 1, h: 540 / 1920 }, reshapeCrop: false })
    const t = firstTimeline(session.getProject())
    expect(findVideoClip(t, 'p')!.clip.transform.place.x).toBeCloseTo(-0.5)
    const out = await exportJoined('off')
    expect(await countFrames(out)).toBe(180)
    // The box runs from -540 to 540, so its green from -270 to 270.
    expect(await colourAt(out, 100, 960, 2.0)).toBe('green')
    expect(await colourAt(out, 400, 960, 2.0)).toBe('red')
    expect(await colourAt(out, 1000, 960, 2.0)).toBe('red')
  })

  it('pops in from its middle and fades out, as the preview draws it', async () => {
    await overFootage()
    session.applyEdit({ sequenceId: S1, kind: 'setAppear', clipId: 'p', side: 'in', appear: { kind: 'pop', length: 30 } })
    session.applyEdit({ sequenceId: S1, kind: 'setAppear', clipId: 'p', side: 'out', appear: { kind: 'fade', length: 30 } })
    const out = await exportJoined('appear')
    expect(await countFrames(out)).toBe(180)
    // A tenth of the way in it is about four tenths of its size, about its middle:
    // the middle is green, and a point near the box's left edge is still the footage.
    expect(await colourAt(out, ...IN_BOX, 1.1)).toBe('green')
    expect(await colourAt(out, 300, 960, 1.1)).toBe('red')
    // Settled, it is its own size.
    expect(await colourAt(out, 300, 960, 2.5)).toBe('green')
    expect(await colourAt(out, ...CLEAR, 2.5)).toBe('red')
    // Half way through going out, past the footage's end, half its colour over the black there.
    const [r, g, b] = await rgb(out, ...IN_BOX, 5.5)
    expect(r).toBeLessThan(40)
    expect(g).toBeGreaterThan(60)
    expect(g).toBeLessThan(140)
    expect(b).toBeLessThan(40)
  })
})

describe('a picture that moves, or blends into another', () => {
  it('cuts closer on its own frame, when the export starts part way through it', async () => {
    session.resetProject()
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p' })
    // Cut to its green box alone three seconds in, so the box fills the whole
    // picture: a keyframe on its first frame that holds, and the box on the cut.
    const p = findVideoClip(firstTimeline(session.getProject()), 'p')!.clip
    session.applyEdit({
      sequenceId: S1,
      kind: 'setZoomKeys',
      clipId: 'p',
      keys: [
        { at: p.sourceIn, crop: p.transform.crop, ease: 'hold' },
        { at: p.sourceIn + 90, crop: { x: 100, y: 50, w: 200, h: 100 } }
      ]
    })
    const project = session.getProject()
    const scratch = join(work, 'scratch-zoom-range')
    // From one second in: the cut lands two seconds into the file, not three.
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'zoom-range' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}',
      range: { from: 30, to: 150 }
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    expect(await countFrames(out!)).toBe(120)
    expect(await colourAt(out!, ...CLEAR, 1.8)).toBe('black')
    expect(await colourAt(out!, ...CLEAR, 2.2)).toBe('green')
    // The whole box is green once it is there, edge to edge.
    expect(await colourAt(out!, 20, 700, 2.2)).toBe('green')
    expect(await colourAt(out!, 1056, 1225, 2.2)).toBe('green')
  })

  it('zooms in to its green box and back out again, without being split', async () => {
    session.resetProject()
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p' })
    // In over half a second from 0.5 s, held on the box, and back out over half a second from 3 s.
    const p = findVideoClip(firstTimeline(session.getProject()), 'p')!.clip
    const box = { x: 100, y: 50, w: 200, h: 100 }
    const at = (sec: number): number => p.sourceIn + Math.round(sec * 30)
    session.applyEdit({ sequenceId: S1, kind: 'setZoomKey', clipId: 'p', at: at(0.5), crop: p.transform.crop })
    session.applyEdit({ sequenceId: S1, kind: 'setZoomKey', clipId: 'p', at: at(1.0), crop: box })
    session.applyEdit({ sequenceId: S1, kind: 'setZoomKey', clipId: 'p', at: at(3.0), crop: box })
    session.applyEdit({ sequenceId: S1, kind: 'setZoomKey', clipId: 'p', at: at(3.5), crop: p.transform.crop })
    expect(findVideoClip(firstTimeline(session.getProject()), 'p')!.clip.transform.keys).toHaveLength(4)
    const out = await exportJoined('zoom-in-out')
    expect(await countFrames(out)).toBe(150)
    // Clear beside the box before and after, and inside the box, edge to edge, while it is held.
    expect(await colourAt(out, ...CLEAR, 0.3)).toBe('black')
    expect(await colourAt(out, ...CLEAR, 2.0)).toBe('green')
    expect(await colourAt(out, 20, 700, 2.0)).toBe('green')
    expect(await colourAt(out, ...CLEAR, 4.2)).toBe('black')
  })

  it('exports a zoom with so many keyframes that its filter graph goes in a file', async () => {
    session.resetProject()
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p' })
    // A keyframe on each of its first 120 frames, each on the green box or two pixels off it, then the whole picture.
    const p = findVideoClip(firstTimeline(session.getProject()), 'p')!.clip
    const keys = Array.from({ length: 120 }, (_, i) => ({
      at: p.sourceIn + i,
      crop: i % 2 === 0 ? { x: 100, y: 50, w: 200, h: 100 } : { x: 102, y: 52, w: 200, h: 100 }
    }))
    session.applyEdit({ sequenceId: S1, kind: 'setZoomKeys', clipId: 'p', keys: [...keys, { at: p.sourceIn + 120, crop: p.transform.crop }] })
    const project = session.getProject()
    const scratch = join(work, 'scratch-many-keys')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'many-keys' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    expect(plan.segments[0]!.graph).toBeDefined()
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    expect(await countFrames(out!)).toBe(150)
    expect(await colourAt(out!, ...CLEAR, 2.0)).toBe('green')
    expect(await colourAt(out!, ...CLEAR, 4.5)).toBe('black')
  })

  it('stays turned through a crossfade into the next picture on its track', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const logo = await importFile(await fx.logoPng(), ...quiet())
    session.addAsset(red)
    session.addAsset(logo)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // Two pictures back to back on V2, 0 s to 5 s and 5 s to 10 s, both turned a quarter.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'p', at: 0, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: logo.id, clipId: 'q', at: 150, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'p', rotation: 90 })
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'q', rotation: 90 })
    session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'q', side: 'in', transitionKind: 'dissolve', length: 30 })
    const out = await exportJoined('turned-blend')
    // Turned, the green box runs down past y 1095, where upright it would be clear.
    expect(await colourAt(out, 540, 1150, 3.0)).toBe('green')
    expect(await colourAt(out, 540, 1150, 5.0)).toBe('green')
    expect(await colourAt(out, 540, 1150, 7.0)).toBe('green')
    // And clear beside it, through the blend as outside it.
    expect(await colourAt(out, 700, 960, 5.0)).toBe('black')
  })
})

describe('an animated GIF', () => {
  it('imports as an animation, its frames unpacked at its own rate', async () => {
    session.resetProject()
    const gif = await importFile(await fx.animGif(), ...quiet())
    expect(gif.status).toBe('ready')
    expect(gif.still).toBe(true)
    expect(gif.frames).toBe(2)
    expect(gif.frameRate).toBe(2)
    expect(gif.playablePath).toMatch(/frames[\\/]0001\.png$/)
  })

  it('plays over the footage, looping, the same frame for the same moment on either side of a cut', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const gif = await importFile(await fx.animGif(), ...quiet())
    session.addAsset(red)
    session.addAsset(gif)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    // From 3 s to 8 s, across the end of the red at 4 s, which starts a new segment.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: gif.id, clipId: 'g', at: 90, onTrack: 'V2' })
    const out = await exportJoined('gif')
    expect(await countFrames(out)).toBe(240)
    // The 200x100 GIF fitted 1080 wide: its opaque half is the left, x 0 to 540.
    const LEFT = [270, 960] as const
    const RIGHT = [800, 960] as const
    expect(await colourAt(out, ...LEFT, 3.2)).toBe('green')
    expect(await colourAt(out, ...LEFT, 3.7)).toBe('magenta')
    expect(await colourAt(out, ...LEFT, 4.2)).toBe('green')
    expect(await colourAt(out, ...LEFT, 4.7)).toBe('magenta')
    expect(await colourAt(out, ...LEFT, 6.2)).toBe('green')
    expect(await colourAt(out, ...RIGHT, 3.2)).toBe('red')
    expect(await colourAt(out, ...RIGHT, 5.2)).toBe('black')
  })

  it('stays in step when a cut elsewhere falls part way through one of its frames', async () => {
    // From 3.1 s: the red ends at 4 s, 0.9 s in, part way through its second frame.
    session.applyEdit({ sequenceId: S1, kind: 'moveClip', clipId: 'g', trackId: 'V2', start: 93 })
    const out = await exportJoined('gif-mid-frame')
    // Its second frame runs from 3.6 s to 4.1 s, its third from 4.1 s: after the cut as before it.
    expect(await colourAt(out, 270, 960, 4.03)).toBe('magenta')
    expect(await colourAt(out, 270, 960, 4.17)).toBe('green')
    session.applyEdit({ sequenceId: S1, kind: 'moveClip', clipId: 'g', trackId: 'V2', start: 90 })
  })

  it('starts part way through its loop when its head is trimmed', async () => {
    // Half a second off its head: it now opens on its second frame.
    const t = firstTimeline(session.getProject())
    const g = findVideoClip(t, 'g')!.clip
    session.applyEdit({ sequenceId: S1, kind: 'setClipIn', clipId: 'g', frame: g.sourceIn + 15 })
    const out = await exportJoined('gif-trimmed')
    expect(await colourAt(out, 270, 960, 3.7)).toBe('magenta')
    expect(await colourAt(out, 270, 960, 4.2)).toBe('green')
  })

  // Plan 88: a shape drawing itself on is a run of pictures played once, as this one is told to be.
  it('plays once and holds its last frame when it is one that plays once, across a cut as before it', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const gif = await importFile(await fx.animGif(), ...quiet())
    session.addAsset(red)
    session.addAsset(gif)
    session.replaceMedia({ ...session.getProject().media.find((m) => m.id === gif.id)!, once: true })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: gif.id, clipId: 'g', at: 90, onTrack: 'V2' })
    expect(session.getProject().media.find((m) => m.id === gif.id)!.once).toBe(true)
    const out = await exportJoined('gif-once')
    expect(await countFrames(out)).toBe(240)
    expect(await colourAt(out, 270, 960, 3.2)).toBe('green')
    expect(await colourAt(out, 270, 960, 3.7)).toBe('magenta')
    // Where a loop would have started again, it holds, and goes on holding after the cut at 4 s.
    expect(await colourAt(out, 270, 960, 4.2)).toBe('magenta')
    expect(await colourAt(out, 270, 960, 6.2)).toBe('magenta')
  })
})

describe('exporting only part of the sequence', () => {
  it('writes just the frames of the range, across a cut, with nothing before or after', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    // Red from 0 to 120, green from 120 to 210.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g' })
    const project = session.getProject()
    const scratch = join(work, 'scratch-range')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'range' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}',
      range: { from: 90, to: 150 }
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    expect(await countFrames(out!)).toBe(60)
    expect(await colourAt(out!, 540, 960, 0.5)).toBe('red')
    expect(await colourAt(out!, 540, 960, 1.5)).toBe('green')
  })
})


describe('a picture\'s colours', () => {
  /** A 400x200 PNG of one opaque colour, #E02020, which BT.601 and BT.709 turn into video differently. */
  async function redPng(): Promise<string> {
    const path = join(work, 'e02020.png')
    await capture(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xE02020:s=400x200', '-frames:v', '1', '-pix_fmt', 'rgb24', '-y', path])
    return path
  }

  /** One pixel as a player shows HD video: by the BT.709 matrix, at video range. */
  async function asPlayed(path: string, x: number, y: number, atSec: number): Promise<number[]> {
    const { stdout } = await capture(ffmpegPath, [
      '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
      '-vf', `crop=2:2:${x}:${y},scale=in_color_matrix=bt709:in_range=tv,format=rgb24`, '-f', 'rawvideo', 'pipe:1'
    ])
    return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0]
  }

  function near(got: number[], want: number[]): void {
    for (const [i, w] of want.entries()) expect(Math.abs((got[i] ?? 0) - w), `${got.join(',')} against ${want.join(',')}`).toBeLessThanOrEqual(6)
  }

  async function pictureOn(track: 'V1' | 'V2'): Promise<void> {
    session.resetProject()
    const picture = await importFile(await redPng(), ...quiet())
    session.addAsset(picture)
    if (track === 'V2') {
      const green = await importFile(await fx.logoPng(), ...quiet())
      session.addAsset(green)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g' })
      session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: picture.id, clipId: 'p', at: 0, onTrack: 'V2' })
    } else {
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: picture.id, clipId: 'p' })
    }
  }

  it('on V1, exports in the colour the preview shows', async () => {
    await pictureOn('V1')
    near(await asPlayed(await exportJoined('colour-v1'), ...IN_BOX, 1.0), [224, 32, 32])
  })

  it('laid over another track, exports in the colour the preview shows', async () => {
    await pictureOn('V2')
    near(await asPlayed(await exportJoined('colour-v2'), ...IN_BOX, 1.0), [224, 32, 32])
  })

  it('turned, exports in the colour the preview shows', async () => {
    await pictureOn('V2')
    session.applyEdit({ sequenceId: S1, kind: 'setOverlay', clipId: 'p', rotation: 90 })
    near(await asPlayed(await exportJoined('colour-turned'), 540, 960, 1.0), [224, 32, 32])
  })

  it('says which colours it holds, so a player reads it as it was made', async () => {
    await pictureOn('V1')
    const out = await exportJoined('colour-tags')
    const tags = await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range', '-of', 'csv=p=0', out])
    expect(tags.trim().split(',').sort()).toEqual(['bt709', 'bt709', 'bt709', 'tv'])
  })
})
