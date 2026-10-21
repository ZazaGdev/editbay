import type { Appear } from '../../shared/appear'
import type { BlurRegion } from '../../shared/blur'
import { fileUrl } from '../../shared/file-url'
import type { BoxKey, PictureStyle, ZoomKey } from '../../shared/project'
import type { ColourAdjust } from '../../shared/looks'
import { SEEK_DRIFT_SEC, syncAction } from '../../shared/sound'

/**
 * The players of the preview: two for every track, held in step with the
 * preview's clock. Nothing outside this folder knows they exist.
 */

/**
 * The speed a player starts at. A player starts a little behind the clock,
 * and the first change of its speed away from 1 costs it another 20 ms or
 * so, while the browser's pitch keeping gets going. Starting just above 1
 * pays that at the start, while it is catching up anyway, rather than a
 * moment later when it is nearly in step.
 */
const STARTING_RATE = 1.02

/** A player's volume: its clip's own, times whatever a fade over it says at this moment. */
function heard(el: HTMLMediaElement, clip: LaneClip, sec: number): void {
  const want = Math.min(1, Math.max(0, clip.volume * (clip.fadeAt?.(sec) ?? 1)))
  if (el.volume !== want) el.volume = want
}

/**
 * Where a player that is seeking goes once that seek lands, when it was asked
 * to go somewhere else meanwhile. Only the latest is kept.
 */
const nextSeek = new WeakMap<HTMLMediaElement, number>()
/** The players already listening for a seek to land. */
const waiting = new WeakSet<HTMLMediaElement>()
/** When a player first held a place back for its seek to land, to stop waiting on one that never does. */
const heldSince = new WeakMap<HTMLMediaElement, number>()

/**
 * How long a seek may keep later ones waiting. One that lands is quicker than
 * this even on phone footage; one that never lands, as when the file goes or
 * fails to decode, would otherwise hold the picture where it was for good.
 */
export const SEEK_PATIENCE_MS = 500

/** A seek has landed: on to the last place asked for while it was on its way, if there is one. */
function landed(el: HTMLMediaElement): void {
  heldSince.delete(el)
  const next = nextSeek.get(el)
  if (next === undefined) return
  nextSeek.delete(el)
  if (Math.abs(el.currentTime - next) >= 1e-6) el.currentTime = next
}

/**
 * Put a media element at a time, now if it knows its length, or as soon as it
 * does.
 *
 * A seek asked for while another is on its way waits for it to land rather
 * than cutting it off. A fast drag asks for a new place on every move, and
 * each seek thrown away is decoding thrown away: on phone footage, with a
 * key frame every few seconds, none ever finished and the picture froze until
 * the pointer stopped. Only the last place asked for is kept, so the player
 * always ends up exactly there.
 */
export function setMediaTime(el: HTMLMediaElement, seconds: number): void {
  if (el.readyState >= 1) {
    const since = heldSince.get(el)
    if (el.seeking && (since === undefined || performance.now() - since < SEEK_PATIENCE_MS)) {
      if (!waiting.has(el)) {
        el.addEventListener('seeked', () => landed(el))
        // A file that fails or is taken away mid-seek never says it landed.
        const dropped = (): void => {
          nextSeek.delete(el)
          heldSince.delete(el)
        }
        el.addEventListener('error', dropped)
        el.addEventListener('emptied', dropped)
        waiting.add(el)
      }
      if (since === undefined) heldSince.set(el, performance.now())
      nextSeek.set(el, seconds)
      return
    }
    nextSeek.delete(el)
    heldSince.delete(el)
    if (Math.abs(el.currentTime - seconds) < 1e-6) return
    el.currentTime = seconds
  } else {
    // A new file: nothing asked of the last one still applies.
    nextSeek.delete(el)
    heldSince.delete(el)
    // One listener a player, going to the last place asked: one each time stacked
    // up on a file that never loads (audit 2026-10-01).
    const asked = afterLoad.has(el)
    afterLoad.set(el, seconds)
    if (asked) return
    const once = (): void => {
      el.removeEventListener('loadedmetadata', once)
      const to = afterLoad.get(el)
      afterLoad.delete(el)
      if (to !== undefined) el.currentTime = to
    }
    el.addEventListener('loadedmetadata', once)
  }
}

/** Where a player still loading its file is to go once it has. */
const afterLoad = new WeakMap<HTMLMediaElement, number>()

/**
 * Bring a playing element back towards where it should be, gently when it is
 * close and by seeking when it is not. An element still loading or seeking is
 * left alone: its position means nothing yet.
 */
export function keepInStep(el: HTMLMediaElement, seconds: number, speed = 1): void {
  if (el.readyState < 2 || el.seeking) return
  const action = syncAction(el.currentTime - seconds, el.playbackRate, speed)
  if (action.seek) {
    // Its own seek, made now: one waiting from before would take it back.
    nextSeek.delete(el)
    el.currentTime = Math.max(0, seconds)
    // Catching up again from a standing start, as when it first plays.
    el.playbackRate = starting(speed)
    return
  }
  const rate = Math.min(FASTEST, Math.max(SLOWEST, action.rate))
  if (el.playbackRate !== rate) el.playbackRate = rate
}

/** The speed a player starts at to catch up, kept inside what a player can do. */
function starting(speed: number): number {
  return Math.min(FASTEST, STARTING_RATE * speed)
}

/** Where a clip's player should be at `t` of the sequence: never before its recording's first frame. */
function timeIn(clip: LaneClip, t: number): number {
  const at = clip.fileAtStart + (t - clip.startSec) * (clip.rate ?? 1)
  return clip.firstSec === undefined ? at : Math.max(clip.firstSec, at)
}

/** Whether `t` is before the clip's recording has any footage: a transition reaching back past its first frame. */
function holding(clip: LaneClip, t: number): boolean {
  return clip.firstSec !== undefined && clip.fileAtStart + (t - clip.startSec) * (clip.rate ?? 1) < clip.firstSec - 1e-6
}

/**
 * The fastest and slowest a player plays. Chromium refuses a speed outside
 * these, and a clip at 16x played at 2x would ask for 32.
 */
const FASTEST = 16
const SLOWEST = 0.0625

/** How fast a player plays a clip while the sequence plays at `speed`: both speeds at once, kept inside what a player can do. */
export function playerRate(clip: LaneClip | undefined, speed: number): number {
  return Math.min(FASTEST, Math.max(SLOWEST, speed * (clip?.rate ?? 1)))
}

/** Where the sequence is when a clip's player is at `fileSec` of its file: the other way round from `timeIn`. */
export function sequenceTimeOf(clip: LaneClip, fileSec: number): number {
  return clip.startSec + (fileSec - clip.fileAtStart) / (clip.rate ?? 1)
}

/** One clip on a track, as its player needs it, in seconds of the sequence. */
export interface LaneClip {
  id: string
  path: string
  /** Where it starts and ends in the sequence. */
  startSec: number
  endSec: number
  /** Where its file is at its start, in the player's own time. */
  fileAtStart: number
  /**
   * Seconds of its file a second of the sequence plays: its clip's speed
   * (plan 105). The player plays that much faster, its pitch kept. Absent for 1.
   */
  rate?: number
  /**
   * Where the recording's own first frame is, in the player's own time. A
   * transition reaching back past it has no footage there: the player holds
   * that first frame until the clip gets to it, as the export does.
   */
  firstSec?: number
  /** 0 to 1. */
  volume: number
  /**
   * What its volume is multiplied by at a time in the sequence, for a fade
   * that is part way through. Left out for a clip with no fade on it, which is
   * almost all of them, and the volume is then set once as it always was.
   */
  fadeAt?: (sec: number) => number
  /** Whether its player is silent: a picture with no sound of its own to play. */
  muted: boolean
}

/** One clip on a video track, as its player and the canvas need it. */
export interface PictureLaneClip extends LaneClip {
  /** What the canvas draws of it: its pictures, the main one first, each a crop and a place. */
  pictures: {
    crop: { x: number; y: number; w: number; h: number }
    place: { x: number; y: number; w: number; h: number }
    style?: PictureStyle
    /** A further picture's own zoom keyframes, read on the clock `move` gives. */
    keys?: ZoomKey[]
    /** Its box's keyframes (plan 97), read on the same clock. */
    boxKeys?: BoxKey[]
    /** A further picture's own look, on top of the clip's (task 1188). */
    look?: string
    lookStrength?: number
    adjust?: ColourAdjust
  }[]
  /** Its bars filled with itself, blurred. */
  blurFill?: boolean
  /**
   * Its main picture's zoom keyframes, with the recording's frame its clip
   * starts on and the sequence frame it starts at, so the frame being drawn
   * can be read as a frame of the recording. Present when any of its pictures
   * moves, a further picture by its own keys on this same clock. Absent for a
   * clip that stays where it is put, which is almost all of them.
   */
  move?: { keys: ZoomKey[]; sourceIn: number; startFrame: number; speed?: number }
  /** Its look, from `LOOKS`. Absent for the recording's own colour. */
  look?: string
  /** What of the recording it blurs, in the recording's pixels (plan 85). Absent for none. */
  blurs?: BlurRegion[]
  /** An overlay's turn and opacity, whose box may reach past the frame. */
  free?: { rotation?: number; opacity?: number }
  /** How it comes in and goes out, on the frames of the sequence it covers. Absent for straight in and out. */
  appear?: { start: number; length: number; enter?: Appear; exit?: Appear }
  /** An animation: its frame files, and which of them shows at a time of the sequence. */
  anim?: { paths: string[]; frameAt: (sec: number) => number }
  /** The recording's picture size, which the Source view fits. */
  width: number
  height: number
}

/**
 * A track: two players, one playing the clip under the lane's time and one
 * holding the next, swapped at a cut. Sound players for an audio track, video
 * players for a video track, whose pictures the canvas draws.
 *
 * It is told the time on every frame. Told to correct itself, it is held to
 * that time; not told, as when it is the clock's own source or the picture it
 * follows is getting going, it only starts and stops.
 */
export class Lane<C extends LaneClip = LaneClip> {
  private readonly players: HTMLMediaElement[] = []
  /** The clip each player holds, by id, and the file it was loaded from. */
  private readonly holds: (string | null)[] = [null, null]
  private readonly paths: (string | null)[] = [null, null]
  private active = 0
  private clips: C[] = []
  /** Every player silent, while a voice over records. */
  private silenced = false
  /**
   * Whether each player has shown a frame of the file it holds. One that has
   * goes on showing it while it seeks; one still loading has nothing at all.
   */
  private readonly framed = [false, false]
  /** When each player was last sent to a file or a time, so one that never gets there is not waited on for good. */
  private readonly sentAt = [0, 0]

  /**
   * `keepsFrame` for a picture lane: what is on screen is kept there until the
   * next picture has a frame. A sound lane has nothing on screen to keep.
   */
  constructor(host: HTMLElement | null, make: () => HTMLMediaElement, private readonly keepsFrame = false) {
    for (let i = 0; i < 2; i++) {
      const el = make()
      host?.appendChild(el)
      this.players.push(el)
      for (const event of ['loadeddata', 'seeked']) el.addEventListener(event, () => (this.framed[i] = el.readyState >= 2))
    }
  }

  /** Both players, for laying out and listening to. */
  get elements(): readonly HTMLMediaElement[] {
    return this.players
  }

  /** The clip under `t`, whether or not a player holds it yet. */
  clipAt(t: number): C | undefined {
    return this.under(t)
  }

  /**
   * Every clip under `t`, in the order they are drawn: one, or two over a
   * transition that blends them, the outgoing one first.
   */
  clipsAt(t: number): C[] {
    const first = this.under(t)
    const second = this.also(t)
    return first ? (second ? [first, second] : [first]) : []
  }

  /**
   * The player holding a clip, when it has a frame to show. Also while it
   * seeks, once it has shown a frame of its file: Chromium says it has no frame
   * then, but goes on showing the last one.
   */
  playerFor(clipId: string): HTMLMediaElement | null {
    for (const i of [this.active, 1 - this.active]) {
      const el = this.players[i]
      if (el && el.readyState >= 2) this.framed[i] = true
      const ready = el !== undefined && (el.readyState >= 2 || (this.framed[i] === true && el.seeking && el.readyState >= 1))
      if (el && this.holds[i] === clipId && ready && el.error === null) return el
    }
    return null
  }

  /**
   * Whether the player holding a clip is still on its way to the frame asked
   * for: loading its file or seeking. One whose file failed is not: it will
   * never have a frame, and is shown as black.
   */
  waiting(clipId: string): boolean {
    const now = performance.now()
    return this.players.some(
      (el, i) =>
        this.holds[i] === clipId &&
        el.error === null &&
        (el.readyState < 2 || el.seeking) &&
        // One that has not got there in this long may never: it is shown as it is.
        now - (this.sentAt[i] ?? 0) < SEEK_PATIENCE_MS
    )
  }

  /**
   * The player showing the clip under `t`, and that clip, when it holds it and
   * has a frame to show. With `seeking`, also while it seeks within the clip:
   * Chromium says it has no frame then, but goes on showing the last one, which
   * playing backwards, a seek every frame, would otherwise never see.
   */
  shown(t: number, seeking = false): { el: HTMLMediaElement; clip: C } | null {
    const clip = this.under(t)
    if (!clip) return null
    // The active player first: it is the one playing, or parked on the playhead.
    for (const i of [this.active, 1 - this.active]) {
      const el = this.players[i]
      const ready = el !== undefined && (el.readyState >= 2 || (seeking && el.seeking && el.readyState >= 1))
      if (el && this.holds[i] === clip.id && ready && el.error === null) return { el, clip }
    }
    return null
  }

  /** Whether a player holding a clip under `t` is seeking, so has no new frame to draw yet. */
  seekingAt(t: number): boolean {
    const wanted = new Set(this.clipsAt(t).map((c) => c.id))
    if (wanted.size === 0) return false
    return this.players.some((el, i) => this.holds[i] !== null && wanted.has(this.holds[i]!) && el.seeking)
  }

  /** Every player silent, whatever its clip says, or as its clip says again. */
  silence(on: boolean): void {
    this.silenced = on
    for (let i = 0; i < 2; i++) {
      const el = this.players[i]
      const held = this.clips.find((c) => c.id === this.holds[i])
      if (el) el.muted = on || (held ? held.muted : el.muted)
    }
  }

  setClips(clips: C[]): void {
    this.clips = [...clips].sort((a, b) => a.startSec - b.startSec)
    for (let i = 0; i < 2; i++) {
      const held = this.clips.find((c) => c.id === this.holds[i])
      const el = this.players[i]
      // A clip taken away, now played from another file, or whose file
      // failed to load, as one being rebuilt does, is let go of, and loaded
      // afresh when it is next wanted.
      if (!held || held.path !== this.paths[i] || el?.error) this.holds[i] = null
      else if (el) {
        // Its own volume; a fade is put back on top of it on the next tick.
        el.volume = held.volume
        el.muted = this.silenced || held.muted
      }
    }
  }

  /**
   * Let the one player holding the clip under `t` run on from where it is
   * parked, or stop it again: the burst of sound heard while the playhead is
   * dragged.
   *
   * Only that one player. The other is parked at the start of the clip after
   * it, and playing both would put the beginning of the next clip over the top
   * of the one being listened to.
   */
  run(t: number, on: boolean): void {
    const clip = this.under(t)
    const other = this.also(t)
    for (let i = 0; i < 2; i++) {
      const el = this.players[i]
      if (!el) continue
      const wanted = clip !== undefined && this.holds[i] === clip.id ? clip : other !== undefined && this.holds[i] === other.id ? other : null
      if (!on || !wanted) {
        el.pause()
        continue
      }
      const rate = playerRate(wanted, 1)
      if (el.playbackRate !== rate) el.playbackRate = rate
      void el.play().catch(() => undefined)
    }
  }

  private under(t: number): C | undefined {
    return this.clips.find((c) => t >= c.startSec && t < c.endSec)
  }

  /**
   * The second clip under `t`, where two cover it at once: the other side of a
   * crossfade, whose span a transition stretched over this one's.
   *
   * Only a sound lane has these today. A picture lane is given spans that hand
   * over in the middle of a window instead, because the canvas can draw one
   * picture at a time until it learns to blend two.
   */
  private also(t: number): C | undefined {
    const found = this.clips.filter((c) => t >= c.startSec && t < c.endSec)
    return found[1]
  }

  private after(t: number): C | undefined {
    return this.clips.find((c) => c.startSec > t)
  }

  private load(slot: number, clip: C, at: number): void {
    const el = this.players[slot]
    if (!el) return
    // Only ever one player holds a clip. Two, parked at different times, and
    // the one drawn could be the one standing still.
    if (this.holds[1 - slot] === clip.id) this.holds[1 - slot] = null
    if (this.holds[slot] !== clip.id || this.paths[slot] !== clip.path || el.error !== null) {
      if (this.paths[slot] !== clip.path || el.error !== null) {
        el.src = fileUrl(clip.path)
        this.framed[slot] = false
      }
      this.holds[slot] = clip.id
      this.paths[slot] = clip.path
    }
    heard(el, clip, at)
    el.muted = this.silenced || clip.muted
    this.sentAt[slot] = performance.now()
    setMediaTime(el, timeIn(clip, at))
  }

  /**
   * Stop, and hold the clip under `t` ready on its frame, and the next after it.
   *
   * A clip the player on screen does not hold is loaded into the other one, so
   * the frame on screen stays there until the new one has its own, rather than
   * going black while it loads. The next clip waits until then too: loading it
   * would take the frame on screen away.
   */
  park(t: number): void {
    for (const el of this.players) {
      el.pause()
      if (el.playbackRate !== 1) el.playbackRate = 1
    }
    const clip = this.under(t)
    if (clip) {
      // To the other player when it holds the clip already, or when the one
      // on screen has a frame worth keeping. One still loading a clip the
      // pointer has since left is simply given the new one: swapping back
      // would load over the frame kept on screen.
      const other = 1 - this.active
      // One on screen with the clip's file open already only seeks, and keeps its frame while it does.
      const keep = this.keepsFrame && this.framed[this.active] && this.paths[this.active] !== clip.path
      if (this.holds[this.active] !== clip.id && (this.holds[other] === clip.id || keep)) {
        this.active = other
      }
      this.load(this.active, clip, t)
      const el = this.players[this.active]
      if (this.keepsFrame && el && el.error === null && el.readyState < 2 && !this.framed[this.active]) return
    }
    // The other side of a crossfade waits on the same frame, not on its own
    // first one: it is already part way through by the time it is heard.
    const other = this.also(t)
    const next = other ?? this.after(t)
    if (next) this.load(1 - this.active, next, other ? t : next.startSec)
  }

  /**
   * Where the sequence is now, while it plays at `speed`. `correct` says the
   * time can be trusted to hold the players to. `source` says this lane's
   * player is the one the clock is read from: it plays at exactly the speed,
   * and nothing else, or the clock would run as fast as it did.
   */
  tick(t: number, correct: boolean, source = false, speed = 1): void {
    const clip = this.under(t)
    const current = this.players[this.active]
    if (!current) return
    if (!clip) {
      if (!current.paused) current.pause()
    } else {
      if (this.holds[this.active] !== clip.id) {
        if (this.holds[1 - this.active] === clip.id) {
          current.pause()
          this.active = 1 - this.active
        } else if (this.playingOn(clip, t)) {
          // A split, or any edit, made while it plays: the player already
          // plays this very footage, so it carries on. Moved to where it
          // already is, it stalled and played again what was just heard.
          this.holds[this.active] = clip.id
          heard(current, clip, t)
          current.muted = this.silenced || clip.muted
        } else {
          this.load(this.active, clip, t)
        }
      }
      const el = this.players[this.active]!
      // A fade runs while it plays, so its volume is set on every tick rather
      // than once when the clips are handed over.
      if (clip.fadeAt) heard(el, clip, t)
      const want = timeIn(clip, t)
      // A file that failed to load, as an offline one does, is tried again
      // when the clips are next set or the lane parked, not on every frame.
      // One that has played to its end stays there: play() on an ended
      // player starts it again from the beginning, which put a song that ran
      // to the end of its file 6 seconds out on its last frame.
      if (el.error !== null || el.ended) {
        // Nothing to play.
      } else if (holding(clip, t)) {
        // Before the recording's first frame: held on it until the clip gets there.
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - want) > 0.05) setMediaTime(el, want)
      } else if (el.paused) {
        if (Math.abs(el.currentTime - want) > 0.05) setMediaTime(el, want)
        el.playbackRate = source ? playerRate(clip, speed) : starting(playerRate(clip, speed))
        void el.play().catch(() => undefined)
      } else if (source) {
        if (el.playbackRate !== playerRate(clip, speed)) el.playbackRate = playerRate(clip, speed)
      } else if (correct) {
        keepInStep(el, want, playerRate(clip, speed))
      }
    }
    const idle = 1 - this.active
    const other = this.also(t)
    if (other) {
      // Both sides of a crossfade play at once, each at its own point on its
      // own curve. The clip after next has to wait: there are two players.
      if (this.holds[idle] !== other.id) this.load(idle, other, t)
      const el = this.players[idle]
      if (el && el.error === null && !el.ended) {
        heard(el, other, t)
        if (holding(other, t)) {
          if (!el.paused) el.pause()
        } else if (el.paused) {
          el.playbackRate = starting(playerRate(other, speed))
          void el.play().catch(() => undefined)
        } else if (correct) keepInStep(el, timeIn(other, t), playerRate(other, speed))
      }
      return
    }
    // The next clip waits, loaded and parked on its first frame.
    const next = this.after(t)
    if (next && this.holds[idle] !== next.id && (!clip || next.id !== clip.id)) this.load(idle, next, next.startSec)
  }

  /**
   * Whether the player on screen is playing `clip`'s footage at `t` already:
   * its file, running, and near enough the place that being kept in step
   * brings it there without a seek.
   */
  private playingOn(clip: C, t: number): boolean {
    const el = this.players[this.active]
    if (!el || this.paths[this.active] !== clip.path || el.paused || el.error !== null || el.seeking) return false
    return !holding(clip, t) && Math.abs(el.currentTime - timeIn(clip, t)) < SEEK_DRIFT_SEC
  }

  pause(): void {
    for (const el of this.players) el.pause()
  }

  /**
   * Playing backwards: stopped, with the clip under `t` shown on its frame
   * there. A new frame is asked for only once the last has arrived, so it goes
   * as fast as the file can seek, and the seeks never pile up.
   *
   * Over a blend the other side is moved with it, or the picture coming in
   * would stand still while the one going out ran backwards under it.
   */
  showAt(t: number): void {
    const other = this.also(t)
    if (other) {
      const idle = 1 - this.active
      if (this.holds[idle] !== other.id) this.load(idle, other, t)
      const el = this.players[idle]
      if (el && !el.seeking && el.readyState >= 1) {
        if (!el.paused) el.pause()
        setMediaTime(el, timeIn(other, t))
      }
    }
    const clip = this.under(t)
    const current = this.players[this.active]
    if (!clip || !current) return
    if (this.holds[this.active] !== clip.id) {
      if (this.holds[1 - this.active] === clip.id) {
        current.pause()
        this.active = 1 - this.active
      } else {
        this.load(this.active, clip, t)
        return
      }
    }
    const el = this.players[this.active]!
    if (!el.paused) el.pause()
    if (el.seeking || el.readyState < 1) return
    setMediaTime(el, timeIn(clip, t))
  }

  /**
   * Stop and let go of both players. `release` is told of each as it goes, so
   * whatever else holds on to it, as the loudness boost's source node does,
   * can let go too.
   */
  destroy(release?: (el: HTMLMediaElement) => void): void {
    for (const el of this.players) {
      release?.(el)
      el.pause()
      el.removeAttribute('src')
      el.load()
      el.remove()
    }
  }
}

/** An audio track's players. */
export function audioLane(host: HTMLElement | null, trackId: string): Lane {
  return new Lane(host, () => {
    const el = document.createElement('audio')
    el.preload = 'auto'
    el.dataset.testid = 'track-player'
    el.dataset.track = trackId
    return el
  })
}

/**
 * A video track's players. Silent unless a clip's linked first stream plays
 * from its picture's own player, and laid out behind the canvas rather than
 * hidden, since a video nobody can see may stop giving frames.
 */
export function videoLane(host: HTMLElement | null, trackId: string): Lane<PictureLaneClip> {
  return new Lane<PictureLaneClip>(host, () => {
    const el = document.createElement('video')
    el.preload = 'auto'
    el.muted = true
    el.playsInline = true
    el.controls = false
    el.dataset.testid = 'track-video'
    el.dataset.track = trackId
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.transformOrigin = 'top left'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '0'
    el.style.visibility = 'hidden'
    return el
  }, true)
}
