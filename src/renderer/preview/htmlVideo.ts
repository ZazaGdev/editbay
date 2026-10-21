import type { Timeline } from '../../shared/project'
import { isStill, shownTracks, timelineDuration } from '../../shared/project'
import { fitInBox } from '../../shared/crop-geometry'
import { previewScale } from '../../shared/sound'
import type { WorkspaceView } from '../../shared/workspace'
import type { MonitorBox, MonitorLayout } from '../../shared/monitor-layout'
import { zoomedFit, type SourceZoom } from '../../shared/source-zoom'
import type { PreviewEngine } from './engine'
import { drawOutput, drawPlan, mixFor } from './compositor'
import { DrawnClips } from './drawnClips'
import { SEEK_PATIENCE_MS, audioLane, sequenceTimeOf, videoLane, type Lane, type LaneClip, type PictureLaneClip } from './lanes'
import { StillLane } from './stills'
import { isMuted } from '../../shared/tracks'
import type { Stretch } from '../../shared/silences'
import { PreviewLoudness } from './loudness'
import { blendAt, transitionWindows, type TransitionWindow } from '../../shared/transitions'
import { planPicture } from './planPicture'
import { SCRUB_BURST_MS, SETTLE_MS, canvasScale, cutTo, lowestPlaying, place, type Shown } from './pictureShowing'
import { PICTURE_PATIENCE_MS, PictureStart } from './pictureStart'
import { SoundEngine } from './soundEngine'
import { soundVoices } from './soundVoices'
import { soundLaneClips, videoLaneClips, type Listening } from './laneClips'

/**
 * Plays the sequence with two players for every track, one playing the clip
 * under the playhead and one holding the next, loaded and parked on its
 * first frame, swapped at a cut. V1 is a track like the others.
 *
 * The preview has a clock of its own. While the picture on the lowest video
 * track under the playhead plays steadily, the clock is taken from it, since
 * lip sync is judged against the picture; that player is never corrected.
 * Every other player is held to the clock. With no picture there, as in a gap
 * or past the last picture, the clock runs on by itself.
 *
 * The Source view shows a video itself, fitted in its part of the monitor.
 * The Output view draws the finished frame onto a canvas in its part: every
 * picture of every clip under the playhead, V1's first. The videos stay laid
 * out behind the canvas rather than hidden, because Chromium may stop
 * delivering frames from a video it thinks nobody can see. With both views
 * side by side, the video the Source view shows is beside the canvas and the
 * rest are behind it.
 */
export class HtmlVideoEngine implements PreviewEngine {
  private timeline: Timeline | null = null
  /** The picture transitions of the sequence, for the colour a dip draws. */
  private pictureWindows: TransitionWindow[] = []
  /**
   * How long the sequence is, in frames. Worked out once per timeline rather
   * than on every frame of playback: it walks every clip and every caption.
   */
  private duration = 0
  private frame = 0
  /** Where the sequence is, in seconds: the clock while playing, the playhead otherwise. */
  private sec = 0
  private playing = false
  private raf = 0
  private positionHandlers = new Set<(frame: number) => void>()
  private endedHandlers = new Set<() => void>()
  private clockHandlers = new Set<(sec: number, at: number) => void>()
  /** Whether the clock has taken its time from the picture since playback started. */
  private settled = false
  /** The whole sequence silent, while a voice over records. */
  private muted = false
  /**
   * How loud the preview plays, 0 to 1. The listener's, not the edit's: it is
   * the last thing applied to a player's own volume and it only ever lowers,
   * so nothing about the mix or the export moves with it.
   */
  private monitorVolume = 1
  /** Lighter copies the preview plays in place of the recordings, by the recording's id. */
  private proxies: ReadonlyMap<string, string> = new Map()
  /** The audio tracks listened to alone, empty when every one is heard. */
  private solo = new Set<string>()
  /** Where the voice is, which a track that ducks comes down under. */
  private voice: Stretch[] = []
  /** On the wall clock, the picture held to it, while a voice over records. */
  private wallClock = false
  /** 'program' while the Output view is shown, alone or beside the Source view. */
  private view: WorkspaceView = 'source'
  /** The size of the Output view, which the canvas is drawn at. */
  private box = { width: 0, height: 0 }
  /** Where each view is in the monitor, or null for one not shown. */
  private layout: MonitorLayout = { source: null, program: null }
  /** How fast playing goes, and which way: below 0 backwards. */
  private rate = 1
  /** Frames played over and over, or null. */
  private loop: { from: number; to: number } | null = null
  /** The Source view zoomed in on a recording, by its file, or null for fitted. */
  private sourceZoom: { path: string; zoom: SourceZoom } | null = null
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  /** Device pixels per layout pixel, as the canvas was last sized for. */
  private scale = 1
  private stopWatchingScale: (() => void) | null = null
  /** Playing louder than a media element allows, for a clip set above 100%. */
  private readonly loudness = new PreviewLoudness()
  /**
   * Plan 106: the sound while playing forwards at normal speed, seamless at
   * cuts, and the clock while it plays. The players' own sound is silenced
   * for the clips it plays, which are `soundIds`.
   */
  private readonly sound = new SoundEngine((req) => window.api.soundPcm(req))
  private soundOn = false
  /** Whether its first sound is set to start: until then the clock stands. */
  private soundReady = false
  private soundIds = new Set<string>()
  /** It could not play once: the players play this time instead. */
  private soundRefused = false
  /**
   * While the playhead is being dragged: when the burst of sound now playing
   * should stop, and the animation frame watching for that. Zero and 0 when
   * nothing is being dragged.
   */
  private scrubUntil = 0
  private scrubRaf = 0
  /**
   * Whether the canvas holds nothing worth keeping, as after it is resized,
   * which clears it. The last frame is kept over a picture on its way only
   * when there is one.
   */
  private blank = true
  /** A draw held back for a picture on its way, tried again once that has taken too long. */
  private heldDraw: ReturnType<typeof setTimeout> | null = null
  private host: HTMLElement | null = null
  /** Each video track's players, by track id. */
  private readonly videoLanes = new Map<string, Lane<PictureLaneClip>>()
  /** Each audio track's players, by track id. */
  private readonly audioLanes = new Map<string, Lane>()
  /** Each video track's pictures, by track id. */
  private readonly stillLanes = new Map<string, StillLane>()
  /** The selected clip, whose recording the Source view shows when it is a picture under the playhead. */
  private focus: string | null = null
  /** The preview's clock: where the sequence was, in seconds, and when. */
  private clock = { sec: 0, at: 0 }
  /** When playback last started, so nothing is held to the clock before the players have got going. */
  private startedAt = 0
  /** The picture the clock is taken from, and since when it has been. */
  private source: { clipId: string | null; since: number } = { clipId: null, since: 0 }
  /** Play held until the picture really plays: see `pictureStart.ts`. */
  private readonly start = new PictureStart((el) => this.pictureStarted(el))
  /** The pictures last laid out, so the Source view is laid out again only when they change. */
  private laidOut = ''
  /**
   * An edit came while playing. The playhead may go back once, on the next
   * frame: a stretch closed up before it moves the picture it plays earlier.
   */
  private edited = false

  constructor() {
    const c = document.createElement('canvas')
    c.dataset.testid = 'program-canvas'
    c.style.position = 'absolute'
    c.style.left = '0'
    c.style.top = '0'
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.pointerEvents = 'none'
    c.style.zIndex = '1'
    c.style.visibility = 'hidden'
    this.canvas = c
    this.ctx = c.getContext('2d')
  }

  mount(host: HTMLElement): void {
    this.host = host
    host.appendChild(this.canvas)
    this.watchScale()
    // The captions' font arrives a moment after the window does: drawn again then.
    document.fonts?.addEventListener('loadingdone', this.fontsLoaded)
  }

  private fontsLoaded = (): void => this.draw()

  /**
   * Size the canvas again when the window moves to a display with another
   * scale, which changes no layout size and so fires no resize.
   */
  private watchScale(): void {
    this.stopWatchingScale?.()
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    const changed = (): void => {
      this.setLayout(this.layout, this.programZoomed)
      this.watchScale()
    }
    query.addEventListener('change', changed, { once: true })
    this.stopWatchingScale = () => query.removeEventListener('change', changed)
  }

  /** The Output view zoomed in (task 53): its frame drawn here, larger than the view and cut to it. */
  private programZoomed: MonitorBox | null = null

  setLayout(layout: MonitorLayout, zoomed: MonitorBox | null = this.programZoomed): void {
    this.layout = layout
    const program = layout.program
    this.programZoomed = zoomed
    const drawn = program && zoomed ? zoomed : program
    this.view = program ? 'program' : 'source'
    this.box = drawn ? { width: drawn.width, height: drawn.height } : { width: 0, height: 0 }
    // Sized in device pixels: a canvas at layout size is blurry on a scaled
    // display. The scale is kept, so drawing always matches the size.
    this.scale = canvasScale(this.box, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(this.box.width * this.scale))
    const h = Math.max(1, Math.round(this.box.height * this.scale))
    if (this.canvas.width !== w || this.canvas.height !== h) this.blank = true
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    if (drawn) place(this.canvas, drawn)
    this.canvas.style.clipPath = program && drawn ? cutTo(drawn, program) : ''
    this.canvas.style.visibility = program ? 'visible' : 'hidden'
    this.layoutVideos()
    this.draw()
  }

  setSourceZoom(zoom: { path: string; zoom: SourceZoom } | null): void {
    this.sourceZoom = zoom
    this.layoutVideos()
  }

  /** A clip left out of the picture until it is drawn again, as a shape is while its ends are dragged (task 59). */
  private hidden: string | null = null
  setHidden(clipId: string | null): void {
    if (clipId === this.hidden) return
    this.hidden = clipId
    this.layoutVideos()
    this.draw()
  }

  private readonly drawnClips = new DrawnClips()
  /** Tell `done` once the Output view has drawn a clip's picture, as a shape just drawn waits to be (task 86). */
  whenDrawn(clipId: string, done: () => void): () => void {
    return this.drawnClips.when(clipId, done)
  }

  setFocus(clipId: string | null): void {
    this.focus = clipId
    this.layoutVideos()
  }

  /**
   * The clips under the playhead on each video track, lowest first, and the
   * player showing each when it has a frame. Under Handoff, which has no frame
   * to place anything in, V1's alone.
   *
   * Two from one track over a blend, the outgoing one first, because that is
   * the order they are drawn in. Everything downstream reads the first as the
   * picture underneath, which it still is.
   *
   * A hidden track is passed over, the way a muted one is not heard. The
   * export does the same, and if the two ever disagree the export is right.
   */
  private shown(sec: number): Shown[] {
    const t = this.timeline
    if (!t) return []
    const tracks = shownTracks(t)
    return tracks.flatMap((track) => {
      const lane = this.videoLanes.get(track.id)
      const stills = this.stillLanes.get(track.id)
      // A player seeking goes on showing its last frame.
      const playing: Shown[] = lane ? lane.clipsAt(sec).map((clip) => ({ track: track.id, lane, clip, el: lane.playerFor(clip.id) })) : []
      const pictures: Shown[] = stills ? stills.clipsAt(sec).map((clip) => ({ track: track.id, lane: null, clip, el: stills.imageFor(clip, sec) })) : []
      if (pictures.length === 0) return playing
      // A blend between a recording and a picture: the one going out first.
      return [...playing, ...pictures].sort((a, b) => a.clip.startSec - b.clip.startSec)
    })
  }

  /**
   * Fit the videos to the monitor as the Source view shows them: the selected
   * picture when it is under the playhead, otherwise the one on the lowest
   * track there. Black while that one's player has nothing to show, as while
   * its file loads or when it is offline. Nothing is hidden outright: a video
   * nobody can see may stop giving frames, so the ones not shown are only made
   * see-through, and while the Output view is shown they are all under the
   * canvas, laid out in its place when the Source view is beside it.
   */
  private layoutVideos(): void {
    const pictures = this.shown(this.sec)
    const wanted = pictures.find((p) => p.clip.id === this.focus) ?? pictures[0] ?? null
    // Paused, with the picture wanted still loading: what is on screen stays
    // until it has a frame, rather than going black in between.
    if (!this.playing && wanted?.el === null && wanted.lane?.waiting(wanted.clip.id)) {
      this.holdOn()
      return
    }
    this.laidOut = pictures.map((p) => `${p.clip.id}:${p.el ? 1 : 0}`).join(',')
    const { source, program } = this.layout
    // Where the video the Source view shows goes: its own view, or behind the canvas when the Output view is alone.
    const showIn = source ?? program
    const elements: HTMLElement[] = [
      ...[...this.videoLanes.values()].flatMap((lane) => lane.elements),
      ...[...this.stillLanes.values()].flatMap((lane) => lane.elements)
    ]
    for (const el of elements) {
      el.style.visibility = 'visible'
      const showing = wanted !== null && wanted.el === el
      el.style.clipPath = ''
      if (showing && showIn) {
        // Zoomed in the Source view: bigger than its view, and cut to it, so
        // none of it shows over the Output view beside it.
        // By the recording's file, so a cut to another clip of it stays zoomed on the very frame it is drawn.
        const zoom = source && this.sourceZoom?.path === wanted.clip.path ? this.sourceZoom.zoom : null
        const size = { w: wanted.clip.width, h: wanted.clip.height }
        const fit = zoomedFit(fitInBox(size.w, size.h, showIn.width, showIn.height), showIn, size, zoom)
        place(el, { x: showIn.x + fit.offsetX, y: showIn.y + fit.offsetY, width: fit.width, height: fit.height })
        if (zoom) {
          const top = Math.max(0, -fit.offsetY)
          const left = Math.max(0, -fit.offsetX)
          const right = Math.max(0, fit.offsetX + fit.width - showIn.width)
          const bottom = Math.max(0, fit.offsetY + fit.height - showIn.height)
          el.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
        }
      } else if (showIn) {
        // Behind the canvas, or with the Source view alone, in it and see-through:
        // never left outside the monitor where a layout before put it.
        place(el, program ?? showIn)
      }
      el.style.opacity = (program || showing) && !(showing && wanted.clip.id === this.hidden) ? '1' : '0'
    }
  }

  /**
   * What is on screen is being kept over a picture on its way. One that never
   * gets there is not waited on for good: after a while it is shown as it is.
   */
  private holdOn(): void {
    this.heldDraw ??= setTimeout(() => {
      this.heldDraw = null
      this.layoutVideos()
      this.draw()
    }, SEEK_PATIENCE_MS + 20)
  }

  /** Draw the Output view: every picture of every clip under the playhead, V1's first. */
  private draw(): void {
    if (this.view !== 'program' || !this.ctx || !this.timeline) return
    // A shape whose handles are being dragged is drawn by its outline meanwhile (task 59).
    const pictures = this.shown(this.sec).filter((p) => p.clip.id !== this.hidden)
    // Paused, not over the last frame while a picture is on its way to its new
    // one: it is drawn as it arrives, and black is never drawn in between.
    if (!this.playing && !this.blank && pictures.some((p) => p.lane?.waiting(p.clip.id))) {
      this.holdOn()
      return
    }
    if (this.heldDraw !== null) {
      clearTimeout(this.heldDraw)
      this.heldDraw = null
    }
    this.blank = false
    const frame = Math.floor(this.sec * this.timeline.fps + 1e-6)
    const blend = blendAt(this.pictureWindows, frame)
    // A clip blending into another is drawn whole, as the export composes it.
    const blending = new Set(blend ? [blend.fromClipId, blend.toClipId] : [])
    const plan = drawPlan(
      this.timeline,
      pictures.map((p) => planPicture(p, frame, this.pictureWindows, blending, pictures[0]?.track)),
      this.box
    )
    // How the two sides of a blend are mixed, worked out against the frame the
    // plan settled on: a wipe is cut to it and a push moves across it.
    if (blend) {
      const mix = mixFor(blend.kind, blend.p, plan.frame, this.timeline.output.width)
      for (const step of plan.steps) {
        const id = pictures[step.source]?.clip.id
        if (id === blend.fromClipId) step.mix = mix.out
        else if (id === blend.toClipId) step.mix = mix.into
      }
    }
    drawOutput(this.ctx, this.timeline, frame, pictures.map((p) => p.el as HTMLVideoElement | HTMLImageElement | null), plan, this.scale)
    this.drawnClips.drew(pictures.filter((p) => p.el).map((p) => p.clip.id))
  }

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline
    // Every picture transition of the sequence, for the colour drawn over a
    // clip while it dips. Worked out here rather than on every frame.
    this.pictureWindows = timeline.videoTracks.flatMap((r) => transitionWindows(r.clips, 'picture'))
    this.duration = timelineDuration(timeline)
    this.syncLanes()
    if (this.playing) this.edited = true
    if (!this.playing) this.park()
    this.layoutVideos()
    // An edit while paused, such as dragging a place, shows at once.
    this.draw()
  }

  seek(frame: number): void {
    this.pause()
    this.frame = Math.max(0, frame)
    this.sec = this.frame / (this.timeline?.fps ?? 30)
    this.park()
    this.layoutVideos()
    this.draw()
    this.emitPosition(this.frame)
  }

  /**
   * A frame shown without moving the playhead: the timeline skimmed under the
   * pointer. Told null, the picture goes back to the playhead.
   *
   * Nothing is reported back, unlike a seek, because nothing has moved. The
   * playhead is still where it was and `frame` is left alone, so letting go of
   * the skim puts the picture back on it with no arithmetic.
   */
  showFrame(frame: number | null): void {
    if (this.playing) return
    this.sec = Math.max(0, frame ?? this.frame) / (this.timeline?.fps ?? 30)
    this.park()
    this.layoutVideos()
    this.draw()
  }

  /**
   * The playhead dragged to a frame, and the sound there heard.
   *
   * It moves to the frame exactly as `seek` does, and reports it, because a
   * drag of the ruler is a move and not a look. What it adds is a short burst:
   * the player holding the clip under the frame is let run for a moment and
   * then stopped again, so dragging across a recording is something you can
   * hear rather than only read off a waveform.
   *
   * A burst is short enough that letting go in the middle of one leaves the
   * picture and the sound a few frames apart at worst, and `endScrub` parks
   * everything back on the playhead anyway.
   */
  scrub(frame: number): void {
    this.seek(frame)
    // A drag is a gesture, so a context suspended until one can start now.
    this.loudness.resume(this.elements())
    this.scrubUntil = performance.now() + SCRUB_BURST_MS
    for (const lane of this.lanes()) lane.run(this.sec, true)
    if (this.scrubRaf === 0) this.scrubRaf = requestAnimationFrame(this.scrubTick)
  }

  /** The drag is over: stop the sound and put every player back on the playhead. */
  endScrub(): void {
    if (this.scrubRaf !== 0) {
      cancelAnimationFrame(this.scrubRaf)
      this.scrubRaf = 0
    }
    this.scrubUntil = 0
    for (const lane of this.lanes()) lane.run(this.sec, false)
    if (this.playing) return
    this.park()
    this.layoutVideos()
    this.draw()
  }

  /**
   * Watching for the end of a burst. On the animation frame rather than a
   * timer so it stops with everything else the moment the window is hidden,
   * and so the engine has one kind of clock rather than two.
   */
  private scrubTick = (): void => {
    this.scrubRaf = 0
    if (performance.now() >= this.scrubUntil) {
      for (const lane of this.lanes()) lane.run(this.sec, false)
      return
    }
    this.scrubRaf = requestAnimationFrame(this.scrubTick)
  }

  /** How fast it plays: a voice over always records at 1. */
  private get speed(): number {
    return this.wallClock ? 1 : Math.abs(this.rate) || 1
  }

  /** Whether it plays backwards, which a voice over never does. */
  private get backwards(): boolean {
    return !this.wallClock && this.rate < 0
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate === 0 || rate === this.rate) return
    this.rate = rate
    // Going on from here at the new speed, or the other way. Backwards from the
    // start, or forwards from the end, it cannot go on: it has ended.
    if (this.playing) {
      this.pause()
      this.play()
      if (!this.playing) for (const handler of this.endedHandlers) handler()
    }
  }

  setLoop(loop: { from: number; to: number } | null): void {
    this.loop = loop && loop.to > loop.from ? loop : null
  }

  play(): void {
    const t = this.timeline
    if (this.playing || !t) return
    if (this.backwards) {
      this.playBackwards()
      return
    }
    // With a loop, from its start, unless already inside it.
    const loop = this.wallClock ? null : this.loop
    if (loop && (this.frame < loop.from || this.frame >= loop.to)) {
      this.frame = loop.from
      this.sec = this.frame / t.fps
      this.park()
      this.layoutVideos()
      this.draw()
      this.emitPosition(this.frame)
    }
    if (this.frame >= this.duration) return
    // An audio context waits for a gesture before it runs, and pressing play
    // is one: this is where a mix asking to be louder than 100% gets it.
    this.loudness.resume(this.elements())
    if (this.soundPlays()) {
      this.playWithSound(t)
      return
    }
    this.playing = true
    const now = performance.now()
    this.sec = this.frame / t.fps
    this.clock = { sec: this.sec, at: now }
    this.startedAt = now
    this.source = { clipId: null, since: now }
    this.settled = false
    const lowest = lowestPlaying(this.shown(this.sec))?.lane
    if (lowest && !this.wallClock) {
      // The picture alone, and the rest once it plays.
      lowest.tick(this.sec, false, true, this.speed)
      // Told to play, it is no longer paused. One left paused, as one held
      // before its recording's first frame, has nothing to wait for.
      const el = lowestPlaying(this.shown(this.sec))?.el ?? null
      if (el && !el.paused) this.start.begin(el, this.speed)
    }
    if (!this.start.waitingOn) for (const lane of this.lanes()) lane.tick(this.sec, false, lane === lowest && !this.wallClock, this.speed)
    this.emitClock(this.sec, now)
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Whether the sound engine plays this time: forwards at normal speed, not recording a voice over. */
  private soundPlays(): boolean {
    return !this.wallClock && !this.backwards && this.speed === 1 && !this.soundRefused && this.sound.usable
  }

  /**
   * Plan 106: play with the sound engine as the clock. The clock stands until
   * its first sound is set to start; the pictures are started then, a moment
   * before it is heard, and held to it from when it is.
   */
  private playWithSound(t: Timeline): void {
    this.soundOn = true
    this.soundReady = false
    // The players' own sound silenced for the clips the engine plays.
    this.syncLanes()
    this.playing = true
    const now = performance.now()
    this.sec = this.frame / t.fps
    this.clock = { sec: this.sec, at: now }
    this.startedAt = now
    this.settled = false
    const from = this.sec
    void this.sound.start(from).then((ok) => {
      if (!this.playing || !this.soundOn) return
      if (!ok) {
        // Played on the players instead, as before there was an engine.
        this.pause()
        this.soundRefused = true
        this.play()
        this.soundRefused = false
        return
      }
      this.soundReady = true
      for (const lane of this.lanes()) lane.tick(from, false, false, this.speed)
    })
    this.raf = requestAnimationFrame(this.tick)
  }

  /** A frame of playing with the sound engine: the clock is what is being heard, and every player follows it. */
  private tickWithSound(t: Timeline): void {
    if (!this.soundReady) {
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    const now = performance.now()
    const sec = this.sound.heardSec() ?? this.sec
    const heard = this.sound.heard()
    this.clock = { sec, at: now }
    // What is being heard, where it can be read beside the picture.
    this.canvas.dataset.heardSec = heard ? sec.toFixed(4) : ''
    this.canvas.dataset.heardClips = heard ? this.sound.sounding(sec).join(',') : ''
    if (heard && !this.settled) {
      this.settled = true
      this.emitClock(sec, now)
    }
    // Held to it once it is heard; until then each is getting going from where Play was pressed.
    for (const lane of this.lanes()) lane.tick(sec, heard, false, this.speed)
    this.advance(t, sec, lowestPlaying(this.shown(sec))?.lane)
  }

  /** The picture plays, or was waited on long enough: the clock goes on from where it really is, and every player with it. */
  private pictureStarted(el: HTMLMediaElement): void {
    if (!this.playing) return
    const now = performance.now()
    const lowest = lowestPlaying(this.shown(this.sec))
    if (lowest && lowest.el === el && el.readyState >= 1) this.sec = sequenceTimeOf(lowest.clip, el.currentTime)
    this.clock = { sec: this.sec, at: now }
    this.startedAt = now
    this.source = { clipId: lowest?.clip.id ?? null, since: now }
    for (const lane of this.lanes()) lane.tick(this.sec, false, lane === lowest?.lane, this.speed)
    this.emitClock(this.sec, now)
  }

  /**
   * Backwards, silent: the playhead goes back on the clock, and every picture
   * is asked for its frame there, each a new one only once its last has
   * arrived. It stops at the start.
   */
  private playBackwards(): void {
    const t = this.timeline
    if (!t || this.frame <= 0) return
    this.playing = true
    this.sec = this.frame / t.fps
    this.clock = { sec: this.sec, at: performance.now() }
    for (const lane of this.lanes()) lane.pause()
    this.raf = requestAnimationFrame(this.tickBackwards)
  }

  private tickBackwards = (): void => {
    const t = this.timeline
    if (!this.playing || !t) return
    const sec = Math.max(0, this.clock.sec - ((performance.now() - this.clock.at) / 1000) * this.speed)
    this.sec = sec
    for (const lane of this.videoLanes.values()) lane.showAt(sec)
    this.stillsAt(sec)
    const frame = Math.max(0, Math.floor(sec * t.fps + 1e-6))
    if (frame !== this.frame) {
      this.frame = frame
      this.emitPosition(frame)
    }
    const shownNow = this.shown(sec)
      .map((p) => `${p.clip.id}:${p.el ? 1 : 0}`)
      .join(',')
    if (shownNow !== this.laidOut) this.layoutVideos()
    // Not over the last frames while new ones are on their way: each is drawn as it arrives.
    if (![...this.videoLanes.values()].some((lane) => lane.seekingAt(sec))) this.draw()
    if (sec <= 0) {
      this.finish()
      return
    }
    this.raf = requestAnimationFrame(this.tickBackwards)
  }

  pause(): void {
    this.playing = false
    this.start.stop()
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    for (const lane of this.lanes()) lane.pause()
    if (this.soundOn) {
      this.sound.stop()
      this.soundOn = false
      this.soundReady = false
      delete this.canvas.dataset.heardSec
      delete this.canvas.dataset.heardClips
      // The players' own sound back, for a drag of the playhead or another speed.
      this.syncLanes()
    }
  }

  isPlaying(): boolean {
    return this.playing
  }

  hasPicture(): boolean {
    return this.shown(this.sec).some((p) => p.el !== null)
  }

  onPosition(handler: (frame: number) => void): () => void {
    this.positionHandlers.add(handler)
    return () => this.positionHandlers.delete(handler)
  }

  onEnded(handler: () => void): () => void {
    this.endedHandlers.add(handler)
    return () => this.endedHandlers.delete(handler)
  }

  onClock(handler: (sec: number, at: number) => void): () => void {
    this.clockHandlers.add(handler)
    return () => this.clockHandlers.delete(handler)
  }

  setWallClock(on: boolean): void {
    this.wallClock = on
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    for (const lane of this.lanes()) lane.silence(muted)
    if (this.timeline) this.sound.setMaster(muted ? 0 : 1 / previewScale(this.timeline))
  }

  setVoice(stretches: readonly Stretch[]): void {
    const wanted = stretches.map((s) => `${s.from}-${s.to}`).join(',')
    if (wanted === this.voice.map((s) => `${s.from}-${s.to}`).join(',')) return
    this.voice = [...stretches]
    // Handed their clips again with the new curve, as for a new volume: nothing seeks.
    this.syncLanes()
  }

  /**
   * The lighter copies to play in place of the recordings. Each clip's player
   * loads its copy, or its recording again, where it is; the crops are scaled
   * to the copy's size when drawn.
   */
  setProxies(proxies: ReadonlyMap<string, string>): void {
    const key = (m: ReadonlyMap<string, string>): string => [...m].map(([id, p]) => `${id}=${p}`).sort().join('|')
    if (key(proxies) === key(this.proxies)) return
    this.proxies = new Map(proxies)
    this.syncLanes()
    if (!this.playing) this.park()
    this.draw()
  }

  setMonitorVolume(volume: number): void {
    const wanted = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
    if (wanted === this.monitorVolume) return
    this.monitorVolume = wanted
    // Every player is handed its clip again with the new volume worked in. The
    // clips themselves have not changed, so nothing seeks and nothing stops.
    this.syncLanes()
  }

  /**
   * The tracks being listened to alone. Empty means every track is heard, as
   * a solo turned off puts it back.
   *
   * Solo lives here rather than in the project: it is a way of listening, not
   * a decision about the edit, so it is never saved and never exported. A
   * solo left on by accident must not change what comes out of the app.
   */
  setSolo(trackIds: readonly string[]): void {
    const wanted = [...trackIds].sort().join(',')
    if (wanted === [...this.solo].sort().join(',')) return
    this.solo = new Set(trackIds)
    this.syncLanes()
    if (!this.playing) this.park()
  }

  /** Whether an audio track is heard at all: not muted, and soloed if anything is. */
  private audible(trackId: string): boolean {
    const track = this.timeline?.audioTracks.find((r) => r.id === trackId)
    if (isMuted(track)) return false
    return this.solo.size === 0 || this.solo.has(trackId)
  }


  private emitClock(sec: number, at: number): void {
    for (const handler of this.clockHandlers) handler(sec, at)
  }

  destroy(): void {
    document.fonts?.removeEventListener('loadingdone', this.fontsLoaded)
    this.pause()
    this.canvas.remove()
    for (const lane of this.lanes()) lane.destroy(this.release)
    for (const lane of this.stillLanes.values()) lane.destroy()
    this.videoLanes.clear()
    this.audioLanes.clear()
    this.stillLanes.clear()
    this.stopWatchingScale?.()
    this.loudness.close()
    this.sound.close()
    if (this.heldDraw !== null) clearTimeout(this.heldDraw)
    this.positionHandlers.clear()
    this.endedHandlers.clear()
    this.clockHandlers.clear()
  }

  private emitPosition(frame: number): void {
    for (const handler of this.positionHandlers) handler(frame)
  }

  private lanes(): Lane<LaneClip>[] {
    return [...this.videoLanes.values(), ...this.audioLanes.values()]
  }

  /** Every player of every lane. */
  private elements(): HTMLMediaElement[] {
    return this.lanes().flatMap((lane) => [...lane.elements])
  }

  /** A player going for good: nothing of the loudness boost is left holding it. */
  private release = (el: HTMLMediaElement): void => this.loudness.release(el)

  /** Every lane parked on the playhead: stopped, with the clip under it ready on its frame. */
  private park(): void {
    for (const lane of this.lanes()) lane.park(this.sec)
    this.stillsAt(this.sec)
    // The sound at the playhead decoded now, so Play there starts at once.
    if (!this.playing && this.soundPlays()) this.sound.prepare(this.sec)
  }

  /** Every track's animations loaded near `sec`, and let go of far from it. */
  private stillsAt(sec: number): void {
    for (const stills of this.stillLanes.values()) stills.setTime(sec)
  }

  /** How the preview is being listened to, for working out each track's clips (`laneClips.ts`). */
  private listening(): Listening {
    return { proxies: this.proxies, monitorVolume: this.monitorVolume, audible: (id) => this.audible(id), voice: this.voice, engine: this.soundIds }
  }

  /** A pair of players for every track, told its clips. */
  private syncLanes(): void {
    const t = this.timeline
    // The sound engine's clips first, so the players know which of theirs to leave silent.
    const voices = t ? soundVoices(t, (id) => this.audible(id), this.monitorVolume, this.voice) : []
    this.soundIds = this.soundOn ? new Set(voices.map((v) => v.id)) : new Set()
    this.sound.setVoices(voices)
    this.sound.setMaster(this.muted ? 0 : t ? 1 / previewScale(t) : 1)
    const video = t?.videoTracks ?? []
    for (const [id, lane] of this.videoLanes) {
      if (video.some((r) => r.id === id)) continue
      lane.destroy(this.release)
      this.videoLanes.delete(id)
    }
    for (const [id, lane] of this.stillLanes) {
      if (video.some((r) => r.id === id)) continue
      lane.destroy()
      this.stillLanes.delete(id)
    }
    for (const track of video) {
      let stills = this.stillLanes.get(track.id)
      if (!stills) {
        stills = new StillLane(this.host, track.id, () => {
          this.layoutVideos()
          this.draw()
        })
        this.stillLanes.set(track.id, stills)
      }
      const clips = t ? videoLaneClips(t, track, this.listening()) : []
      const pictures = new Set(
        track.clips.filter((c) => t?.media.some((m) => m.id === c.mediaId && isStill(m))).map((c) => c.id)
      )
      stills.setClips(clips.filter((c) => pictures.has(c.id)))
      let lane = this.videoLanes.get(track.id)
      if (!lane) {
        lane = videoLane(this.host, track.id)
        // Drawn again whenever one of its players has a new frame to show,
        // as after a seek while paused, whichever track it is on.
        for (const el of lane.elements) {
          for (const event of ['seeked', 'loadeddata', 'error']) {
            el.addEventListener(event, () => {
              // A clip loaded while paused: now the next after it can be too.
              if (event === 'loadeddata' && !this.playing && this.scrubRaf === 0) this.park()
              this.layoutVideos()
              this.draw()
            })
          }
        }
        lane.silence(this.muted)
        this.videoLanes.set(track.id, lane)
      }
      lane.setClips(clips.filter((c) => !pictures.has(c.id)))
    }
    const audio = t?.audioTracks ?? []
    for (const [id, lane] of this.audioLanes) {
      if (audio.some((r) => r.id === id)) continue
      lane.destroy(this.release)
      this.audioLanes.delete(id)
    }
    for (const track of audio) {
      let lane = this.audioLanes.get(track.id)
      if (!lane) {
        lane = audioLane(this.host, track.id)
        lane.silence(this.muted)
        this.audioLanes.set(track.id, lane)
      }
      lane.setClips(t ? soundLaneClips(t, track, this.listening()) : [])
    }
    // Every clip is played at its own loudness divided by the loudest, so it
    // fits what an element takes. This puts the divide back, which is the only
    // way a clip above 100% is heard above 100%.
    this.loudness.want(t ? 1 / previewScale(t) : 1, this.elements())
  }

  private tick = (): void => {
    const t = this.timeline
    if (!this.playing || !t) return
    if (this.soundOn) {
      this.tickWithSound(t)
      return
    }
    const now = performance.now()
    // Waiting for the picture to play, the clock stands where Play was pressed: for so long at most.
    if (this.start.waitingOn && now - this.startedAt < PICTURE_PATIENCE_MS) {
      this.clock = { sec: this.clock.sec, at: now }
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    this.start.done()
    let sec = this.clock.sec + ((now - this.clock.at) / 1000) * this.speed

    // The picture on the lowest video track with a clip here is what lip
    // sync is judged against: while it plays steadily, the clock is its time.
    const pictures = this.shown(sec)
    // A picture has no time to take the clock from: the recording above it has.
    const lowest = lowestPlaying(pictures)
    const lowestId = lowest?.clip.id ?? null
    if (lowestId !== this.source.clipId) this.source = { clipId: lowestId, since: now }
    const el = lowest?.el ?? null
    const steady =
      lowest !== null && el !== null && now - this.source.since > SETTLE_MS && !el.paused && el.readyState >= 3 && !el.seeking
    if (steady && lowest && el && !this.wallClock) {
      sec = sequenceTimeOf(lowest.clip, el.currentTime)
      this.clock = { sec, at: now }
      if (!this.settled) {
        this.settled = true
        this.emitClock(sec, now)
      }
    }
    // Every other player is held to the clock once it can be trusted: while
    // that picture plays steadily, or, with no picture here, once playback
    // has got going. Never in the moment around a cut, when the picture is
    // getting going and its time says little.
    const trusted = lowest === null || this.wallClock ? now - this.startedAt > SETTLE_MS : steady
    for (const lane of this.videoLanes.values()) {
      // On the wall clock the picture is held to it like every other player.
      const source = lane === lowest?.lane && !this.wallClock
      lane.tick(sec, !source && trusted, source, this.speed)
    }
    for (const lane of this.audioLanes.values()) lane.tick(sec, trusted, false, this.speed)
    this.advance(t, sec, lowest?.lane)
  }

  /** The rest of a frame of playing, the clock at `sec`: the playhead, the loop, the picture and the end. */
  private advance(t: Timeline, sec: number, lowest: Lane<PictureLaneClip> | undefined): void {
    this.stillsAt(sec)
    this.sec = sec

    const end = this.duration
    // Never backwards, as taking the clock from the picture can move it back
    // a moment, unless an edit moved what plays here earlier.
    const floor = this.edited ? 0 : this.frame
    this.edited = false
    const frame = Math.min(end, Math.max(floor, Math.floor(sec * t.fps + 1e-6)))
    // At the end of the loop, back to its start, playing on.
    const loop = this.wallClock ? null : this.loop
    if (loop && frame >= loop.to) {
      this.pause()
      this.frame = loop.from
      this.sec = loop.from / t.fps
      this.park()
      this.layoutVideos()
      this.draw()
      this.emitPosition(this.frame)
      this.play()
      return
    }
    if (frame !== this.frame) {
      this.frame = frame
      this.emitPosition(frame)
    }
    const shownNow = this.shown(sec)
      .map((p) => `${p.clip.id}:${p.el ? 1 : 0}`)
      .join(',')
    if (shownNow !== this.laidOut) this.layoutVideos()
    // Not over the last frame while the picture underneath seeks, as after a
    // loop goes round: its new frame is drawn as it arrives.
    if (!lowest?.seekingAt(sec)) this.draw()
    if (frame >= end) {
      this.finish()
      return
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  private finish(): void {
    this.pause()
    for (const handler of this.endedHandlers) handler()
  }
}
