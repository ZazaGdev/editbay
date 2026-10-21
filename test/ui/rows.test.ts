import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Music on an audio track, driven through the real window: a song dropped
 * from the bin, dragged, trimmed, left where it is or moved earlier as V1
 * changes, saved, and played in step with the picture.
 *
 * V1 holds a 4 second clip with sound (120 frames), whose sound is on A1,
 * and a 3 second one without (90 frames), so the song can run across a cut
 * between two files. The song is 6 seconds, 180 frames.
 */

const fx = fixtureSet('rows-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-rows-'))
const userData = join(root, 'user-data')
const saved = join(root, 'rows.editbay')
let app: ElectronApplication
let page: Page
let songId = ''
/** Pixels per frame at the zoom a new project starts at. */
const PX = 0.4
const SONG = '[data-testid="sound-clip"][data-media-id]'

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  const [clean, silent, song] = [await fx.cleanClip(), await fx.silentClip(), await fx.songWav()]
  await launch()
  const assets = await page.evaluate((p) => window.api.importFiles(p), [clean, silent, song])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 3, undefined, {
    timeout: 180_000
  })
  for (const a of assets.slice(0, 2)) {
    await page.locator(`[data-testid="asset"][data-asset-id="${a.id}"] [data-testid="add-to-timeline"]`).click()
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
  songId = assets[2]!.id
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** The song's clip on whichever audio track it is. */
function song(): ReturnType<Page['locator']> {
  return page.locator(`[data-testid="sound-clip"][data-media-id="${songId}"]`).first()
}

async function soundStart(): Promise<number> {
  return Number(await song().getAttribute('data-start'))
}

async function soundLength(): Promise<number> {
  return Number(await song().getAttribute('data-length-frames'))
}

async function undo(): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('ControlOrMeta+z')
}

/**
 * Drag by `dx` pixels in several movements, as a hand does, with Alt held so
 * nothing snaps: these drags go to exact frames.
 */
async function dragFrom(x: number, y: number, ...steps: number[]): Promise<void> {
  await page.keyboard.down('Alt')
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (const dx of steps) {
    for (let i = 1; i <= 4; i++) await page.mouse.move(x + dx * (i / 4), y)
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
}

async function centre(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function audioTrack(index: number): ReturnType<Page['locator']> {
  return page.locator(`[data-testid="track"][data-kind="audio"][data-index="${index}"]`)
}

describe('a song on an audio track', () => {
  it('goes where it is dropped from the bin, at that frame, and is selected', async () => {
    // A1 holds the first clip's own sound; the song goes on a track of its own.
    await page.click('[data-testid="add-audio-track"]')
    await audioTrack(1).waitFor(WAIT)
    const box = (await audioTrack(1).boundingBox())!
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${songId}"]`, '[data-testid="track"][data-kind="audio"][data-index="1"]', {
      targetPosition: { x: 0.1, y: box.height / 2 }
    })
    await page.waitForSelector(`[data-testid="sound-clip"][data-media-id="${songId}"][data-selected="yes"]`, WAIT)
    expect(await audioTrack(1).locator('[data-testid="sound-clip"]').count()).toBe(1)
    expect(await soundStart()).toBe(0)
    expect(await soundLength()).toBe(180)
    await page.waitForSelector('[data-testid="sound-clip-panel"]', WAIT)
  })

  it('offers only Add to timeline and the three dots in the bin: everything else is in the menu or by dragging', async () => {
    expect(await page.locator('[data-testid="asset"] button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual([
      'asset-more',
      'add-to-timeline',
      'asset-more',
      'add-to-timeline',
      'asset-more',
      'add-to-timeline'
    ])
  })

  it('holds everything else behind the three dots, inside the window', async () => {
    const card = page.locator('[data-testid="asset"]').first()
    await card.locator('[data-testid="asset-more"]').click()
    const menu = page.locator('[data-testid="asset-menu"]')
    await menu.waitFor(WAIT)
    expect(await menu.locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual([
      'asset-menu-skim',
      'asset-menu-add',
      'asset-menu-show',
      'asset-menu-remove'
    ])
    // This one is on the timeline, so Remove is there but greyed, with the reason behind it.
    expect(await menu.locator('[data-testid="asset-menu-remove"]').isDisabled()).toBe(true)

    // The whole menu on screen, which is what a 220 pixel panel at the left
    // edge of the window makes easy to get wrong.
    const box = (await menu.boundingBox())!
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(win.w)
    expect(box.y + box.height).toBeLessThanOrEqual(win.h)

    // The dots close it again, rather than closing and reopening it in one go.
    await card.locator('[data-testid="asset-more"]').click()
    await expect.poll(() => page.locator('[data-testid="asset-menu"]').count(), WAIT).toBe(0)
  })

  it('moves along its track when dragged, and one undo puts it back', async () => {
    const c = await centre(song())
    // 60 pixels at 0.4 per frame is 150 frames.
    await dragFrom(c.x, c.y, 30, 60)
    await expect.poll(soundStart).toBe(150)
    await undo()
    await expect.poll(soundStart).toBe(0)
    await page.keyboard.press('ControlOrMeta+y')
    await expect.poll(soundStart).toBe(150)
  })

  it('takes one undo step for a whole trim drag, and stays where it is when V1 is trimmed', async () => {
    const end = await centre(song().locator('[data-testid="trim-end"]'))
    await dragFrom(end.x, end.y, -20, -40)
    await expect.poll(soundLength).toBe(80)
    await undo()
    await expect.poll(soundLength).toBe(180)

    const lengthOf = (): Promise<number> => page.locator('[data-testid="clip"]').first().getAttribute('data-length-frames').then(Number)
    const v1End = await centre(page.locator('[data-testid="clip"]').first().locator('[data-testid="trim-end"]'))
    await dragFrom(v1End.x, v1End.y, -8, -16)
    await expect.poll(lengthOf).toBe(80)
    // V1 leaves a gap now rather than closing up, so nothing after it moves.
    expect(await soundStart()).toBe(150)
    await undo()
    await expect.poll(lengthOf).toBe(120)
    expect(await soundStart()).toBe(150)
  })

  it('stays put when the V1 clip before it goes with Delete, and moves earlier by its length with Shift+Delete', async () => {
    const select = async (): Promise<void> => {
      const box = (await page.locator('[data-testid="clip"]').first().boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await select()
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1, undefined, WAIT)
    expect(await soundStart()).toBe(150)
    await undo()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)

    await select()
    await page.keyboard.press('Shift+Delete')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1, undefined, WAIT)
    // The 120 frames of that clip came out of the sequence, and the song after them moved up.
    await expect.poll(soundStart).toBe(30)
    await undo()
    await expect.poll(soundStart).toBe(150)
  })

  it('is kept on its track when the project is saved and opened again', async () => {
    await answerSaveDialog(app, saved)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+s')
    await page.waitForFunction(() => document.title.startsWith('rows '), undefined, WAIT)
    const closed = app.waitForEvent('close', { timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await closed

    await launch()
    await page.waitForSelector(SONG, WAIT)
    expect(await page.locator('[data-testid="track"][data-kind="audio"]').count()).toBe(2)
    expect(await audioTrack(1).locator('[data-testid="sound-clip"]').count()).toBe(1)
    expect(await soundStart()).toBe(150)
  })

  it('plays in step with the picture, across V1\'s cut as well', async () => {
    // Put the song at the very start, running over the cut at 4 s.
    const c = await centre(song())
    await dragFrom(c.x, c.y, -60)
    await expect.poll(soundStart).toBe(0)

    const project = await page.evaluate(() => window.api.currentProject())
    const fps = project.fps
    const clips = project.sequences[0]!.videoTracks[0]!.clips.map((clip) => {
      const m = project.media.find((x) => x.id === clip.mediaId)!
      return {
        file: m.playablePath.split(/[\\/]/).pop()!,
        start: clip.timelineStart,
        sourceIn: clip.sourceIn,
        startSec: m.startSec ?? 0
      }
    })

    // The song is played by the sound engine (plan 106), whose place in the
    // sequence, what is being heard, the monitor shows beside the picture.
    const songClip = project.sequences[0]!.audioTracks.flatMap((r) => r.clips).find((c) => c.mediaId === songId)!.id
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    const samples = await page.evaluate(
      async ({ clips, fps, songClip }) => {
        const out: { at: number; drift: number }[] = []
        const from = performance.now()
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-testid="program-canvas"]')!
        while (performance.now() - from < 5800) {
          await new Promise((r) => setTimeout(r, 50))
          const video = Array.from(document.querySelectorAll<HTMLVideoElement>('[data-testid="monitor-stage"] video')).find(
            (v) => !v.paused && v.readyState >= 3
          )
          const heard = Number(canvas.dataset.heardSec || NaN)
          if (!video || !Number.isFinite(heard) || !(canvas.dataset.heardClips ?? '').split(',').includes(songClip)) continue
          const src = decodeURIComponent(video.src)
          const clip = clips.find((c) => src.endsWith(c.file))
          if (!clip) continue
          // Where the sequence is, from the picture, against where the song being heard is.
          const t = clip.start / fps + (video.currentTime - clip.startSec) - clip.sourceIn / fps
          out.push({ at: performance.now() - from, drift: heard - t })
        }
        return out
      },
      { clips, fps, songClip }
    )
    await page.keyboard.press('Space')

    const settled = (from: number, to: number): number => {
      const s = samples
        .filter((d) => d.at >= from && d.at < to)
        .map((d) => Math.abs(d.drift))
        .sort((a, b) => a - b)
      expect(s.length).toBeGreaterThan(5)
      return s[Math.floor(s.length / 2)]!
    }
    // Before the cut at 4 s, and after it, once each has settled.
    expect(settled(1500, 3900)).toBeLessThan(0.012)
    expect(settled(5200, 5800)).toBeLessThan(0.012)
    const worst = Math.max(...samples.map((d) => Math.abs(d.drift)))
    // Every reading, when one is far out, so the moment it happened can be seen.
    if (worst >= 0.1) console.log(samples.map((d) => `${Math.round(d.at)}:${(d.drift * 1000).toFixed(0)}`).join(' '))
    expect(worst).toBeLessThan(0.1)
  })
})

describe('past the end of V1', () => {
  const playhead = (): Promise<number> => page.getAttribute('[data-testid="timecode"]', 'data-playhead').then(Number)

  it('goes on to the end of the song, where End goes, and plays through V1\'s end to there', async () => {
    // V1 ends at 210. Moved to 90, the song runs on 60 frames past it, to 270.
    const c = await centre(song())
    await dragFrom(c.x, c.y, 90 * PX)
    await expect.poll(soundStart).toBe(90)
    await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-total').then(Number)).toBe(270)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('End')
    await expect.poll(playhead).toBe(270)

    // From V1's last second.
    await page.keyboard.press('Home')
    await expect.poll(playhead).toBe(0)
    for (let s = 1; s <= 6; s++) {
      await page.keyboard.press('Shift+ArrowRight')
      await expect.poll(playhead).toBe(30 * s)
    }
    // Heard from the sound engine (plan 106): where in the song, from where in the sequence is being heard.
    const project = await page.evaluate(() => window.api.currentProject())
    const songClip = project.sequences[0]!.audioTracks.flatMap((r) => r.clips).find((c) => c.mediaId === songId)!
    await page.keyboard.press('Space')
    const seen = await page.evaluate(async ({ id, startSec }) => {
      const out: { playhead: number; song: number | null }[] = []
      const from = performance.now()
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-testid="program-canvas"]')!
      while (performance.now() - from < 4000) {
        await new Promise((r) => setTimeout(r, 100))
        const heard = (canvas.dataset.heardClips ?? '').split(',').includes(id) ? Number(canvas.dataset.heardSec) : null
        out.push({
          playhead: Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')),
          song: heard === null ? null : heard - startSec
        })
      }
      return out
    }, { id: songClip.id, startSec: songClip.timelineStart / project.fps })
    const past = seen.filter((s) => s.playhead > 215 && s.playhead < 265)
    expect(past.length).toBeGreaterThan(5)
    // The song plays on, where the playhead says: it starts at 90, so at frame f it is (f - 90) / 30 s in.
    for (const s of past) {
      expect(s.song).not.toBeNull()
      expect(Math.abs(s.song! - (s.playhead - 90) / 30)).toBeLessThan(0.1)
    }
    expect(past[past.length - 1]!.song! - past[0]!.song!).toBeGreaterThan(0.5)
    // And stops at the end of the sequence, with nothing left playing.
    await expect.poll(playhead).toBe(270)
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll<HTMLAudioElement>('[data-testid="track-player"]')).every((a) => a.paused) &&
        document.querySelector<HTMLCanvasElement>('canvas[data-testid="program-canvas"]')?.dataset.heardSec === undefined,
      undefined,
      WAIT
    )
    await page.waitForSelector('[data-testid="play-pause"][data-playing="no"]', WAIT)
    // Space at the very end has nothing to play, so it leaves playback stopped.
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    expect(await page.getAttribute('[data-testid="play-pause"]', 'data-playing')).toBe('no')

    await undo()
    await expect.poll(soundStart).toBe(0)
  })
})

describe('the timeline with tracks', () => {
  /** Where the song clip is: its track and its start. */
  async function songAt(): Promise<{ track: string; start: number }> {
    return page.evaluate((id) => {
      const clip = document.querySelector(`[data-testid="sound-clip"][data-media-id="${id}"]`)
      return {
        track: clip?.closest('[data-testid="track"]')?.getAttribute('data-track-id') ?? '',
        start: Number(clip?.getAttribute('data-start'))
      }
    }, songId)
  }

  it('lets a trim of a few frames through without Alt, rather than snapping it back', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    // Nothing on any track starts or ends within reach of the first clip's end at 120.
    const lengthOf = (): Promise<number> => page.locator('[data-testid="clip"]').first().getAttribute('data-length-frames').then(Number)
    expect(await lengthOf()).toBe(120)
    const end = await centre(page.locator('[data-testid="clip"]').first().locator('[data-testid="trim-end"]'))
    await page.mouse.move(end.x, end.y)
    await page.mouse.down()
    // 2 pixels at 0.4 per frame is 5 frames, well inside the 8 pixels snapping reaches.
    await page.mouse.move(end.x - 1, end.y)
    await page.mouse.move(end.x - 2, end.y)
    await page.mouse.up()
    await expect.poll(lengthOf).toBe(115)
    await undo()
    await expect.poll(lengthOf).toBe(120)
  })

  it('takes a clip dragged from A2 to A3 there, at the same time', async () => {
    await page.click('[data-testid="add-audio-track"]')
    await audioTrack(2).waitFor(WAIT)
    const [a2, a3] = [await audioTrack(1).getAttribute('data-track-id'), await audioTrack(2).getAttribute('data-track-id')]
    expect((await songAt()).track).toBe(a2)
    const from = await centre(song())
    const to = await centre(audioTrack(2))
    await page.keyboard.down('Alt')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x, from.y + ((to.y - from.y) * i) / 5)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(songAt).toEqual({ track: a3, start: 0 })
  })

  it('snaps a clip let go near a cut onto it, and not with Alt held', async () => {
    // V1's cut is at 120. Moved 115 frames, 5 short of it, it snaps on.
    const c = await centre(song())
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++) await page.mouse.move(c.x + (115 * PX * i) / 4, c.y)
    await page.mouse.up()
    await expect.poll(async () => (await songAt()).start).toBe(120)

    await undo()
    await expect.poll(async () => (await songAt()).start).toBe(0)
    const again = await centre(song())
    await dragFrom(again.x, again.y, 115 * PX)
    await expect.poll(async () => (await songAt()).start).toBe(115)
  })

  it('lets a clip go where it is put with snapping turned off by N, without Alt, and N turns it back on', async () => {
    await undo()
    await expect.poll(async () => (await songAt()).start).toBe(0)
    const snap = page.locator('[data-testid="timeline-snap"]')
    expect(await snap.getAttribute('aria-pressed')).toBe('true')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('KeyN')
    await expect.poll(() => snap.getAttribute('aria-pressed')).toBe('false')

    // Five frames short of V1's cut at 120, as above, and no Alt: it stays there.
    const c = await centre(song())
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++) await page.mouse.move(c.x + (115 * PX * i) / 4, c.y)
    await page.mouse.up()
    await expect.poll(async () => (await songAt()).start).toBe(115)
    expect(await page.locator('[data-testid="snap-guide"]').count()).toBe(0)

    // The button turns it back on as well as the key.
    await snap.click()
    await expect.poll(() => snap.getAttribute('aria-pressed')).toBe('true')
  })

  it('puts a source dropped from the bin on a track there, at the frame it was let go, covering what is under it', async () => {
    // The song is on A3 from 115 to 295. Dropped over it at 200, a second copy
    // goes there, not on the empty A2, and the song stops where it starts.
    const box = (await audioTrack(2).boundingBox())!
    // With Alt held, so it does not snap onto V1's cut at 210.
    await page.keyboard.down('Alt')
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${songId}"]`, '[data-testid="track"][data-kind="audio"][data-index="2"]', {
      targetPosition: { x: 200 * PX, y: box.height / 2 }
    })
    await page.keyboard.up('Alt')
    const spans = (): Promise<number[][]> =>
      audioTrack(2)
        .locator('[data-testid="sound-clip"]')
        .evaluateAll((els) => els.map((c) => [Number(c.getAttribute('data-start')), Number(c.getAttribute('data-length-frames'))]))
    await expect.poll(spans).toEqual([
      [115, 85],
      [200, 180]
    ])
    expect(await audioTrack(1).locator('[data-testid="sound-clip"]').count()).toBe(0)
  })
})

describe('a fade dragged on a sound clip', () => {
  /** The first song clip's fade in, as the project holds it. */
  const fadeIn = (): Promise<{ length: number; before: number } | null> =>
    page.evaluate(async (id) => {
      const t = (await window.api.currentProject()).sequences[0]!
      const c = t.audioTracks.flatMap((r) => r.clips).find((x) => x.mediaId === id)
      return c?.transitionIn ? { length: c.transitionIn.length, before: c.transitionIn.before } : null
    }, songId)

  it('fades in from silence as far as its handle is dragged, in one undo, and steps aside once there is a fade', async () => {
    const handle = song().locator('[data-testid="fade-in"]')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // What is under the pointer is the handle, not the cut's transition button, which sits on a lone edge no more.
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.getAttribute('data-testid'), [box.x + box.width / 2, box.y + box.height / 2])).toBe('fade-in')
    await page.mouse.down()
    // Thirty frames to the right, in several movements as a hand makes them.
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + (30 * PX * i) / 5, box.y + box.height / 2)
    await page.mouse.up()
    await expect.poll(fadeIn, WAIT).toEqual({ length: 30, before: 0 })
    // The fade is drawn now, with its own handles: this one steps aside.
    expect(await song().locator('[data-testid="fade-in"]').count()).toBe(0)
    // Its end meets the second copy of the song at 200: that cut's own button makes a crossfade there, so no handle.
    expect(await song().locator('[data-testid="fade-out"]').count()).toBe(0)
    await undo()
    await expect.poll(fadeIn, WAIT).toBeNull()
  })
})

describe('noise cleaned out of a sound clip', () => {
  const state = (): Promise<{ on: boolean; cleaned: boolean }> =>
    page.evaluate(async (id) => {
      const p = await window.api.currentProject()
      const c = p.sequences[0]!.audioTracks.flatMap((r) => r.clips).find((x) => x.mediaId === id)
      const m = p.media.find((x) => x.id === id)
      return { on: c?.denoise === true, cleaned: (m?.cleaned ?? []).some((x) => x.track === 0) }
    }, songId)

  it('is turned on in the Inspector, says it is being made, and plays from the cleaned copy once it is', async () => {
    const c = await centre(song())
    await page.mouse.click(c.x, c.y)
    await page.waitForSelector('[data-testid="sound-clip-panel"]', WAIT)
    await page.locator('[data-testid="sound-clip-denoise"]').check()
    await expect.poll(async () => (await state()).on, WAIT).toBe(true)
    // Made in the background, a few seconds for a six second song.
    await expect.poll(async () => (await state()).cleaned, { timeout: 60_000 }).toBe(true)
    await expect.poll(() => page.locator('[data-testid="sound-clip-cleaning"]').count(), WAIT).toBe(0)
    await undo()
    await expect.poll(async () => (await state()).on, WAIT).toBe(false)
  })
})

describe('a voice enhanced on a sound clip', () => {
  const state = (): Promise<{ voice: string | null; recipes: string[] }> =>
    page.evaluate(async (id) => {
      const p = await window.api.currentProject()
      const c = p.sequences[0]!.audioTracks.flatMap((r) => r.clips).find((x) => x.mediaId === id)
      const m = p.media.find((x) => x.id === id)
      return { voice: c?.voice ?? null, recipes: (m?.enhanced ?? []).map((e) => e.recipe) }
    }, songId)

  it('is turned on in the Inspector at Normal, made in the background, and made again at another strength', async () => {
    const c = await centre(song())
    await page.mouse.click(c.x, c.y)
    await page.waitForSelector('[data-testid="sound-clip-panel"]', WAIT)
    await page.locator('[data-testid="sound-clip-voice"]').check()
    await expect.poll(async () => (await state()).voice, WAIT).toBe('normal')
    await expect.poll(async () => (await state()).recipes, { timeout: 60_000 }).toContain('v1-normal')
    await expect.poll(() => page.locator('[data-testid="sound-clip-enhancing"]').count(), WAIT).toBe(0)
    // Another strength is another copy.
    await page.click('[data-testid="sound-clip-voice-strength"] >> text=Strong')
    await expect.poll(async () => (await state()).voice, WAIT).toBe('strong')
    await expect.poll(async () => (await state()).recipes, { timeout: 60_000 }).toContain('v1-strong')
    await page.locator('[data-testid="sound-clip-voice"]').click()
    await expect.poll(async () => (await state()).voice, WAIT).toBeNull()
  })
})

describe('breaths and clicks on a recording track (bugs and notes 2, note 31)', () => {
  const state = (): Promise<{ care: unknown; recipes: string[] }> =>
    page.evaluate(async (id) => {
      const p = await window.api.currentProject()
      const m = p.media.find((x) => x.id === id)
      return { care: m?.care ?? null, recipes: (m?.treated ?? []).map((e) => e.recipe) }
    }, songId)

  it('sets them for the whole track from a clip, makes the treated copy, and undoes as one step each', async () => {
    const c = await centre(song())
    await page.mouse.click(c.x, c.y)
    await page.waitForSelector('[data-testid="sound-clip-panel"]', WAIT)
    await page.click('[data-testid="sound-clip-breaths"] >> text=Gentle')
    await expect.poll(async () => (await state()).care, WAIT).toEqual([{ track: 0, breaths: 'gentle' }])
    await page.locator('[data-testid="sound-clip-clicks"]').click()
    await expect.poll(async () => (await state()).care, WAIT).toEqual([{ track: 0, breaths: 'gentle', clicks: true }])
    // Behind a "?", said on hover (task 64).
    expect(await page.getAttribute('[data-testid="sound-clip-care-note"]', 'title')).toContain('every clip that plays it')
    await expect.poll(async () => (await state()).recipes, { timeout: 60_000 }).toContain('c1-clicks-gentle')
    await expect.poll(() => page.locator('[data-testid="sound-clip-treating"]').count(), WAIT).toBe(0)
    await undo()
    await expect.poll(async () => (await state()).care, WAIT).toEqual([{ track: 0, breaths: 'gentle' }])
    await undo()
    await expect.poll(async () => (await state()).care, WAIT).toBeNull()
  })
})
