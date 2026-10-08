/**
 * A media element as Chromium's behaves, for the preview's tests: its time
 * moves only while it plays, a seek can take until it is let land and says so
 * with `seeked`, and a file can take until it is let load. Shared, so no test
 * gets a kinder one than the window does (audit 2026-10-01).
 */

/** The page's clock, which a test steps by hand. */
export const clock = { now: 1000 }

export class FakePlayer {
  /** How long after play() a player starts moving: a real one is never at once. */
  static startDelay = 0
  /**
   * Seeks that take until `finishSeeks()`, as in Chromium: meanwhile the
   * player is `seeking`, and its `readyState` is 1, no frame to draw.
   */
  static slowSeeks = false
  /** Files that take until `finishLoads()` to load, as a real one does: nothing to show meanwhile. */
  static slowLoads = false
  startsAt = 0
  paused = true
  private time = 0
  /** How many times it has been told to go somewhere: each one a seek, and one still landing thrown away. */
  seeks = 0
  get currentTime(): number {
    return this.time
  }
  set currentTime(sec: number) {
    // As Chromium does: nothing before the start of the file.
    this.time = Math.max(0, sec)
    this.seeks += 1
    if (FakePlayer.slowSeeks) {
      this.seeking = true
      this.readyState = 1
    }
  }
  /** Playing on, which is not a seek. A picture shows the frame it has moved on to, and says so to whoever asked. */
  advance(sec: number): void {
    this.time += sec
    if (this.tag !== 'video') return
    const asked = this.frameCallbacks
    this.frameCallbacks = new Map()
    for (const cb of asked.values()) cb(clock.now, { mediaTime: this.time, presentationTime: clock.now })
  }
  /** The frame callbacks waiting for the next frame a picture shows, by handle. */
  private frameCallbacks = new Map<number, (now: number, frame: { mediaTime: number; presentationTime: number }) => void>()
  private nextFrameCallback = 1
  requestVideoFrameCallback(cb: (now: number, frame: { mediaTime: number; presentationTime: number }) => void): number {
    const handle = this.nextFrameCallback++
    this.frameCallbacks.set(handle, cb)
    return handle
  }
  cancelVideoFrameCallback(handle: number): void {
    this.frameCallbacks.delete(handle)
  }
  readyState = 4
  error: MediaError | null = null
  seeking = false
  ended = false
  playbackRate = 1
  volume = 1
  muted = false
  private file = ''
  get src(): string {
    return this.file
  }
  set src(url: string) {
    this.file = url
    if (FakePlayer.slowLoads) this.readyState = 0
  }
  preload = ''
  playsInline = false
  controls = false
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  constructor(readonly tag: string) {}
  /** How many times it has been told to play. */
  plays = 0
  play(): Promise<void> {
    this.plays += 1
    if (this.paused) this.startsAt = clock.now + FakePlayer.startDelay
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  /** What the engine listens for, so a seek arriving can be told to it as Chromium would. */
  listeners: Record<string, (() => void)[]> = {}
  addEventListener(type: string, handler: () => void): void {
    ;(this.listeners[type] ??= []).push(handler)
  }
  removeEventListener(): void {}
  removeAttribute(): void {}
  load(): void {}
  remove(): void {}
}

/** Every player made since the last `made.length = 0`. */
export const made: FakePlayer[] = []

/** Every seek under way arrives, and says so. */
export function finishSeeks(): void {
  for (const p of made) {
    if (!p.seeking) continue
    p.seeking = false
    p.readyState = 4
    for (const handler of p.listeners.seeked ?? []) handler()
  }
}

/** Every file being loaded arrives: first its length, then its first frame. */
export function finishLoads(): void {
  for (const p of made) {
    if (p.readyState !== 0 || p.src === '') continue
    p.readyState = 1
    for (const handler of [...(p.listeners.loadedmetadata ?? [])]) handler()
    p.listeners.loadedmetadata = []
    p.seeking = false
    p.readyState = 4
    for (const handler of p.listeners.loadeddata ?? []) handler()
  }
}

