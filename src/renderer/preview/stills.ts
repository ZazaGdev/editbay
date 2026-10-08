import { fileUrl } from '../../shared/file-url'
import type { PictureLaneClip } from './lanes'

/**
 * How far either side of the playhead an animation's frames are kept loaded,
 * in seconds. A GIF of a few hundred frames is a few hundred decoded images,
 * and a track of them held whole grew the window without end.
 */
export const ANIMATION_REACH_SEC = 10

/**
 * A video track's pictures: the clips whose source is a still rather than a
 * recording. There is nothing to play or keep in step, so where a video lane
 * has two players this has one image per file, drawn for as long as a clip of
 * it is under the playhead.
 *
 * A plain picture is one image, loaded once and kept. An animation is one
 * image per frame, so its frames are loaded only while its clip is near the
 * playhead, or is the next one to come either way, and let go of after. The
 * next one is always loaded ahead, however far off, so playing into it never
 * shows a frame that is not there yet.
 *
 * The images are laid out behind the canvas like the videos, so the Source
 * view can show one the same way it shows a recording.
 */
export class StillLane {
  private clips: PictureLaneClip[] = []
  /** One image per file, by its path. */
  private readonly images = new Map<string, HTMLImageElement>()
  /** Where the playhead was last said to be, which decides which animations are loaded. */
  private at = 0
  /** The animations loaded for it, by clip id, so a frame that changes none of them costs nothing. */
  private near = ''

  constructor(
    private readonly host: HTMLElement | null,
    private readonly trackId: string,
    /** Told whenever an image has loaded, or failed to, so the frame is drawn again. */
    private readonly loaded: () => void
  ) {}

  /** Every image, for laying out. */
  get elements(): readonly HTMLImageElement[] {
    return [...this.images.values()]
  }

  setClips(clips: PictureLaneClip[]): void {
    this.clips = [...clips].sort((a, b) => a.startSec - b.startSec)
    this.near = this.nearKey(this.at)
    this.load(true)
  }

  /**
   * The playhead is at `t`. Called on every frame of playback, so it does
   * nothing unless an animation has come into reach or gone out of it.
   */
  setTime(t: number): void {
    this.at = t
    const near = this.nearKey(t)
    if (near === this.near) return
    this.near = near
    this.load(false)
  }

  /** The animations to hold loaded with the playhead at `t`, by clip id. */
  private nearAnimations(t: number): PictureLaneClip[] {
    const animated = this.clips.filter((c) => c.anim)
    const within = animated.filter((c) => c.endSec > t - ANIMATION_REACH_SEC && c.startSec < t + ANIMATION_REACH_SEC)
    // The next to come each way, however far: playing into it, forwards or
    // backwards, must find its frames already there.
    const after = animated.find((c) => c.startSec > t)
    const before = [...animated].reverse().find((c) => c.endSec <= t)
    return [...new Set([...within, ...(after ? [after] : []), ...(before ? [before] : [])])]
  }

  private nearKey(t: number): string {
    return this.nearAnimations(t)
      .map((c) => c.id)
      .join(',')
  }

  /**
   * Load what is wanted and let go of the rest. `retry` asks again for an
   * image that failed, which is only worth doing when the clips have changed.
   */
  private load(retry: boolean): void {
    const wanted = new Set([
      ...this.clips.filter((c) => !c.anim).map((c) => c.path),
      ...this.nearAnimations(this.at).flatMap((c) => c.anim!.paths)
    ])
    for (const [path, img] of this.images) {
      if (wanted.has(path)) continue
      this.release(img)
      this.images.delete(path)
    }
    for (const path of wanted) {
      const had = this.images.get(path)
      // One that could not be loaded, as a text whose picture was being drawn
      // again, is asked for again, past the browser's memory of the failure.
      if (retry && had && had.complete && had.naturalWidth === 0) {
        had.src = `${fileUrl(path)}?retry=${Date.now()}`
        continue
      }
      if (had) continue
      const img = document.createElement('img')
      img.decoding = 'async'
      img.alt = ''
      img.dataset.testid = 'track-still'
      img.dataset.track = this.trackId
      img.style.position = 'absolute'
      img.style.left = '0'
      img.style.top = '0'
      img.style.pointerEvents = 'none'
      img.style.zIndex = '0'
      img.style.visibility = 'hidden'
      img.addEventListener('load', this.loaded)
      img.addEventListener('error', this.loaded)
      img.src = fileUrl(path)
      this.host?.appendChild(img)
      this.images.set(path, img)
    }
  }

  /**
   * Let an image go, so the window can drop its decoded picture. Its listeners
   * go first: emptying its source can fire an error nobody needs to hear.
   */
  private release(img: HTMLImageElement): void {
    img.removeEventListener('load', this.loaded)
    img.removeEventListener('error', this.loaded)
    img.src = ''
    img.remove()
  }

  /**
   * Every clip under `t`, in the order they are drawn: one, or two over a
   * transition between two pictures, the outgoing one first.
   */
  clipsAt(t: number): PictureLaneClip[] {
    return this.clips.filter((c) => t >= c.startSec && t < c.endSec)
  }

  /** The image a clip is drawn from at `sec`, once it has loaded: an animation's frame there. */
  imageFor(clip: PictureLaneClip, sec: number): HTMLImageElement | null {
    const path = clip.anim ? (clip.anim.paths[clip.anim.frameAt(sec)] ?? clip.path) : clip.path
    const img = this.images.get(path)
    return img && img.complete && img.naturalWidth > 0 ? img : null
  }

  destroy(): void {
    for (const img of this.images.values()) this.release(img)
    this.images.clear()
    this.clips = []
  }
}
