/**
 * Play, held until the picture really plays. Started together, the other
 * players ran on the wall clock while a picture on a busy machine took 100 to
 * 250 ms to get going, and were then that far ahead of it for a second or more
 * while being eased back. So only the picture starts, and the clock and every
 * other player wait until it shows frames as fast as they play: two in a row
 * as far apart in the recording as on the clock. Not its `playing`, which
 * comes as soon as it has data, nor its first frame: on a busy machine it
 * stood still 100 ms after either.
 */

/** The longest Play waits for the picture: a file that fails never shows a frame. */
export const PICTURE_PATIENCE_MS = 1000
/** How near two frames shown in a row must be to as far apart as the clock says, for the picture to be playing at speed. */
const KEEPS_PACE_SEC = 0.01

/** What Chromium tells a frame callback about the frame shown. */
interface FrameShown {
  mediaTime: number
  presentationTime: number
}
/** A picture that can say when it shows a frame, as a `<video>` can. */
interface Framed {
  requestVideoFrameCallback(cb: (now: number, frame: FrameShown) => void): number
  cancelVideoFrameCallback(handle: number): void
}

function framed(el: HTMLMediaElement): Framed | null {
  const f = el as unknown as Partial<Framed>
  return typeof f.requestVideoFrameCallback === 'function' && typeof f.cancelVideoFrameCallback === 'function' ? (f as Framed) : null
}

export class PictureStart {
  private el: HTMLMediaElement | null = null
  private handle = 0
  private last: { media: number; at: number } | null = null
  private speed = 1

  /** `started` is told the picture waited on, once it plays at speed. */
  constructor(private readonly started: (el: HTMLMediaElement) => void) {}

  /** The picture being waited on, or null. */
  get waitingOn(): HTMLMediaElement | null {
    return this.el
  }

  /** Wait on `el`, told to play at `speed`. */
  begin(el: HTMLMediaElement, speed: number): void {
    this.stop()
    this.el = el
    this.speed = speed
    const f = framed(el)
    if (f) this.handle = f.requestVideoFrameCallback(this.shown)
    else el.addEventListener('playing', this.playing, { once: true })
  }

  /** Stop waiting, as when playback stops first or the wait is over. */
  stop(): void {
    const el = this.el
    if (!el) return
    const f = framed(el)
    if (f && this.handle !== 0) f.cancelVideoFrameCallback(this.handle)
    el.removeEventListener('playing', this.playing)
    this.el = null
    this.handle = 0
    this.last = null
  }

  private playing = (): void => this.done()

  /** Waited on long enough, or it plays: no longer waited on, and the engine told. */
  done(): void {
    const el = this.el
    if (!el) return
    this.stop()
    this.started(el)
  }

  private shown = (_now: number, frame: FrameShown): void => {
    const el = this.el
    const f = el ? framed(el) : null
    if (!f) return
    const was = this.last
    this.last = { media: frame.mediaTime, at: frame.presentationTime }
    if (was) {
      const played = (frame.mediaTime - was.media) / this.speed
      const took = (frame.presentationTime - was.at) / 1000
      if (played > 0 && Math.abs(played - took) < KEEPS_PACE_SEC) {
        this.done()
        return
      }
    }
    this.handle = f.requestVideoFrameCallback(this.shown)
  }
}
