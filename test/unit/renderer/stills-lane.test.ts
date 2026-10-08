import { describe, it, expect, beforeEach } from 'vitest'
import type { PictureLaneClip } from '../../../src/renderer/preview/lanes'

/**
 * A track of GIFs held every frame of every one of them in the window, a
 * decoded image each, for as long as the project was open. Only the ones near
 * the playhead are kept now, and the next one to come is always loaded ahead,
 * so playing into it never finds its frames missing.
 */

class FakeImage {
  src = ''
  decoding = ''
  alt = ''
  complete = false
  naturalWidth = 0
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attached = false
  addEventListener(): void {}
  removeEventListener(): void {}
  remove(): void {
    this.attached = false
  }
}

const made: FakeImage[] = []
;(globalThis as unknown as Record<string, unknown>).document = {
  createElement(): FakeImage {
    const img = new FakeImage()
    made.push(img)
    return img
  }
}

const { StillLane } = await import('../../../src/renderer/preview/stills')

const host = {
  appendChild(img: FakeImage) {
    img.attached = true
  }
} as unknown as HTMLElement

/** A GIF of 20 frames on the track from `from` to `to` seconds, its frames named after it. */
function gif(id: string, from: number, to: number): PictureLaneClip {
  const paths = Array.from({ length: 20 }, (_, i) => `C:\\cache\\${id}\\frame-${i}.png`)
  return {
    id,
    path: paths[0]!,
    startSec: from,
    endSec: to,
    fileAtStart: 0,
    volume: 0,
    muted: true,
    pictures: [],
    anim: { paths, frameAt: (sec) => Math.floor((sec - from) * 10) % 20 },
    width: 480,
    height: 270
  }
}

/** A plain picture, one image. */
function still(id: string, from: number, to: number): PictureLaneClip {
  const { anim: _none, ...rest } = gif(id, from, to)
  return { ...rest, path: `C:\\pics\\${id}.png` }
}

/** Which clips have any frame in the window now, by the folder their frames are in. */
function loaded(): string[] {
  const ids = made.filter((img) => img.attached && img.src !== '').map((img) => decodeURI(img.src).match(/cache\/([^/]+)\//)?.[1] ?? decodeURI(img.src).match(/pics\/([^.]+)\./)?.[1])
  return [...new Set(ids)].sort() as string[]
}

beforeEach(() => {
  made.length = 0
})

describe('a track of pictures', () => {
  it('loads only the animations near the playhead, and the next one to come', () => {
    const lane = new StillLane(host, 'v2', () => {})
    lane.setClips([gif('a', 0, 5), gif('b', 30, 35), gif('c', 60, 65), gif('d', 90, 95)])
    lane.setTime(0)
    // A, under the playhead, and B, the next to come though it is 30 s off.
    expect(loaded()).toEqual(['a', 'b'])
    expect(made.filter((img) => img.attached)).toHaveLength(40)
  })

  it('lets go of the frames of an animation left behind, emptied and taken out of the page', () => {
    const lane = new StillLane(host, 'v2', () => {})
    lane.setClips([gif('a', 0, 5), gif('b', 30, 35), gif('c', 60, 65), gif('d', 90, 95)])
    lane.setTime(0)
    const aFrames = made.filter((img) => img.src.includes('/a/'))
    lane.setTime(61)
    // B the one before, for playing backwards into it; C under it; D the next.
    expect(loaded()).toEqual(['b', 'c', 'd'])
    expect(aFrames.every((img) => img.src === '' && !img.attached)).toBe(true)
  })

  it('has the next animation loaded before playing reaches it, frame by frame', () => {
    const lane = new StillLane(host, 'v2', () => {})
    const clips = [gif('a', 0, 5), gif('b', 8, 12), gif('c', 40, 45)]
    lane.setClips(clips)
    lane.setTime(0)
    for (let f = 1; f < 45 * 30; f++) {
      const t = f / 30
      // Already there on the frame before, with the lane told only where playing was then.
      const under = clips.find((c) => t >= c.startSec && t < c.endSec)
      if (under) expect(loaded()).toContain(under.id)
      lane.setTime(t)
    }
  })

  it('keeps a plain picture loaded wherever the playhead is', () => {
    const lane = new StillLane(host, 'v2', () => {})
    lane.setClips([still('p', 0, 5), gif('a', 100, 105), gif('b', 200, 205), gif('c', 300, 305)])
    lane.setTime(250)
    expect(loaded()).toEqual(['b', 'c', 'p'])
    lane.setTime(0)
    expect(loaded()).toEqual(['a', 'p'])
  })
})
