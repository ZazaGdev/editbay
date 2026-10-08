import { duckGainAt } from '../../../src/shared/ducking'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addClip,
  addSource,
  addTrack,
  setTrackDuck,
  closeUpClip,
  createTimeline,
  setClipOut,
  addTransition,
  splitClip,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../../src/shared/project'
import { FakePlayer, clock, finishLoads, finishSeeks, made } from './fake-player'

/**
 * The preview engine on a pretend page, with its clock and its animation
 * frames stepped by hand: just enough of a document for it to make its
 * players and canvas, and players whose time moves only while they play.
 */

const frames: (() => void)[] = []

/** How many times the canvas has been painted, each draw starting with a black fill. */
let paints = 0
/** How many pictures have been drawn onto it: two in a frame means two are being blended. */
let draws = 0
const g = globalThis as unknown as Record<string, unknown>
g.document = {
  createElement(tag: string) {
    if (tag === 'canvas') {
      const c: Record<string, unknown> = { style: {}, dataset: {}, width: 0, height: 0, remove() {} }
      c.getContext = () => ({
        canvas: c,
        setTransform() {},
        fillRect() {
          paints += 1
        },
        drawImage() {
          draws += 1
        },
        // What a blend needs of a context: the state stack, a clip for a wipe
        // and a move for a push.
        save() {},
        restore() {},
        beginPath() {},
        rect() {},
        clip() {},
        translate() {},
        fillStyle: '',
        globalAlpha: 1,
        imageSmoothingQuality: ''
      })
      return c
    }
    const p = new FakePlayer(tag)
    made.push(p)
    return p
  }
}
g.window = { devicePixelRatio: 1, matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) }
g.requestAnimationFrame = (cb: () => void): number => frames.push(cb)
g.cancelAnimationFrame = (): void => {
  frames.length = 0
}
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.now }, configurable: true })

const { HtmlVideoEngine } = await import('../../../src/renderer/preview/htmlVideo')

function media(id: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    ...overrides
  }
}

/** V1 one clip from 0 to 300, its sound on A1 with it, and a song on A2 from 0 to 600, running on past it. */
function songPastV1(): { t: Timeline; v1: string } {
  let t = createTimeline(30, { width: 1080, height: 1920 })
  t = { ...t, media: [media('a'), media('song', { hasVideo: false, width: 0, height: 0, playablePath: 'C:\\m\\song.wav' })] }
  t = addClip(t, 'a')
  const v1 = v1Clips(t)[0]!.id
  t = setClipOut(t, v1, 300)
  t = addTrack(t, 'audio', 'A2')
  t = addSource(t, { clipId: 's', mediaId: 'song', at: 0, onTrack: 'A2' })
  return { t, v1 }
}

/** The players the engine's lanes made for one track: `track-video` for a video track, `track-player` for an audio one. */
function players(testid: 'track-video' | 'track-player', track: string): FakePlayer[] {
  return made.filter((p) => p.dataset.testid === testid && p.dataset.track === track)
}

describe('the preview, edited while it plays across the end of V1', () => {
  let engine: InstanceType<typeof HtmlVideoEngine>
  let frame = -1

  /** Let `n` animation frames go by, a thirtieth of a second each, with every playing player moving on at its own speed. */
  function play(n: number): void {
    for (let i = 0; i < n; i++) {
      clock.now += 1000 / 30
      for (const v of made) if (!v.paused && clock.now >= v.startsAt) v.advance(v.playbackRate / 30)
      for (const cb of frames.splice(0)) cb()
    }
  }

  beforeEach(() => {
    made.length = 0
    frames.length = 0
    engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 540, height: 960 } })
    engine.onPosition((f) => (frame = f))
  })

  it('stops V1\'s picture and sound when an edit ends V1 before the playhead, and plays on to the end of the song', () => {
    const { t, v1 } = songPastV1()
    engine.setTimeline(t)
    expect(players('track-video', 'v1')).toHaveLength(2)
    engine.seek(0)
    engine.play()
    play(150)
    const playingV1 = players('track-video', 'v1').find((v) => !v.paused)!
    expect(playingV1).toBeDefined()
    // V1's sound plays from its picture's own player, and from nothing else.
    expect(playingV1.muted).toBe(false)
    expect(players('track-player', 'a1').every((p) => p.paused)).toBe(true)
    expect(players('track-player', 'A2').some((p) => !p.paused)).toBe(true)
    // O while playing: V1 trimmed to the playhead, so the playhead is past its end.
    engine.setTimeline(setClipOut(t, v1, frame))
    play(60)
    expect(playingV1.paused).toBe(true)
    expect(players('track-player', 'a1').every((p) => p.paused)).toBe(true)
    expect(engine.isPlaying()).toBe(true)
    expect(frame).toBeGreaterThan(200)
    expect(players('track-player', 'A2').some((p) => !p.paused)).toBe(true)
  })

  it('plays a clip with a transition at its start at the footage of its own frames, picture and sound, and so on through a cut after it', () => {
    // a from 0 to 150, then b from 150, which starts with a crossfade reaching 5 frames back before it.
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a'), media('b')] }
    t = addClip(t, 'a')
    t = setClipOut(t, v1Clips(t)[0]!.id, 150)
    t = addClip(t, 'b')
    const b = v1Clips(t)[1]!
    t = addTransition(t, b.id, 'in', { length: 10 })
    // Then b split at 250, as S does: the second piece has no transition of its own.
    t = splitClip(t, 250)
    engine.setTimeline(t)
    const fileAt = (frame: number): number => (b.sourceIn + (frame - b.timelineStart)) / 30
    const playerOf = (testid: 'track-video' | 'track-player', track: string, file: string): FakePlayer =>
      players(testid, track).find((p) => p.src.includes(file) && !p.paused)!
    engine.seek(200)
    engine.play()
    // The sound starts once the picture shows frames at speed, two of them in.
    play(3)
    // Well inside b, both its picture and its sound are where its own frames say.
    expect(playerOf('track-video', 'v1', 'b.mp4').currentTime).toBeCloseTo(fileAt(203), 1)
    expect(playerOf('track-player', 'a1', 'b.mp4').currentTime).toBeCloseTo(fileAt(203), 1)
    // Across the cut at 250 the footage carries straight on: never back.
    const before = playerOf('track-video', 'v1', 'b.mp4').currentTime
    play(60)
    expect(playerOf('track-video', 'v1', 'b.mp4').currentTime).toBeGreaterThan(before)
    expect(playerOf('track-video', 'v1', 'b.mp4').currentTime).toBeCloseTo(fileAt(frame), 1)
  })

  /** a from 0 to 150, then all of b from 150, which starts with a transition of `kind` reaching 5 frames back before it. */
  function intoWholeClip(kind?: string): { t: Timeline; fileAt: (frame: number) => number } {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a'), media('b')] }
    t = addClip(t, 'a')
    t = setClipOut(t, v1Clips(t)[0]!.id, 150)
    t = addClip(t, 'b')
    const b = v1Clips(t)[1]!
    t = addTransition(t, b.id, 'in', { length: 10, ...(kind ? { kind } : {}) })
    return { t, fileAt: (frame) => Math.max(0, (b.sourceIn + (frame - b.timelineStart)) / 30) }
  }

  it('holds a whole clip on its first frame while a transition reaches back before it, and the playhead never skips', () => {
    const { t, fileAt } = intoWholeClip()
    engine.setTimeline(t)
    engine.seek(140)
    engine.play()
    let last = frame
    for (let i = 0; i < 40; i++) {
      play(1)
      expect(frame - last).toBeLessThanOrEqual(2)
      last = frame
      const b = players('track-video', 'v1').find((p) => p.src.includes('b.mp4'))
      if (frame >= 146 && b) expect(b.currentTime).toBeCloseTo(fileAt(frame), 1)
    }
    expect(frame).toBeGreaterThan(170)
  })

  it('keeps picture and sound together through a dip to black against a crossfade of the sound', () => {
    const { t, fileAt } = intoWholeClip('toBlack')
    engine.setTimeline(t)
    engine.seek(200)
    engine.play()
    play(1)
    const picture = players('track-video', 'v1').find((p) => p.src.includes('b.mp4') && !p.paused)!
    const sound = players('track-player', 'a1').find((p) => p.src.includes('b.mp4') && !p.paused)
    expect(picture.currentTime).toBeCloseTo(fileAt(frame), 1)
    if (sound) expect(sound.currentTime).toBeCloseTo(picture.currentTime, 1)
  })

  it('plays straight on through a split made while it plays, with no seek, so nothing is heard twice', () => {
    // A1 ducks, so V1's sound plays from a player of its own, held to the clock and never exactly on it.
    const t = setTrackDuck(songPastV1().t, 'a1', true)
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    play(100)
    const playing = made.filter((p) => !p.paused)
    expect(players('track-player', 'a1').filter((p) => !p.paused)).toHaveLength(1)
    expect(playing.length).toBeGreaterThan(0)
    const seeks = playing.map((p) => p.seeks)
    // S while playing: every track cut at the playhead, which is now at the start of the second pieces.
    engine.setTimeline(splitClip(t, frame))
    play(30)
    for (const [i, p] of playing.entries()) {
      expect(p.paused).toBe(false)
      expect(p.seeks).toBe(seeks[i])
    }
    expect(made.filter((p) => !p.paused)).toEqual(playing)
  })

  it('plays V1 again when an edit brings it back under the playhead while it runs on past it', () => {
    const { t, v1 } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    play(350)
    expect(frame).toBeGreaterThan(300)
    expect(players('track-video', 'v1').every((v) => v.paused)).toBe(true)
    // Undo of a trim: V1 runs to 500 again, under the playhead.
    engine.setTimeline(setClipOut(t, v1, 500))
    play(30)
    const playing = players('track-video', 'v1').filter((v) => !v.paused)
    expect(playing).toHaveLength(1)
    expect(engine.hasPicture()).toBe(true)
    // Its picture follows the playhead rather than standing still.
    expect(Math.abs(playing[0]!.currentTime - frame / 30)).toBeLessThan(0.1)
    expect(playing[0]!.muted).toBe(false)
  })

  it('keeps time with the clock on the wall while a picture plays', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = addClip({ ...t, media: [media('a')] }, 'a')
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    // Fifteen seconds of wall clock.
    play(450)
    expect(Math.abs(frame - 450)).toBeLessThanOrEqual(2)
    const v1 = players('track-video', 'v1').find((v) => !v.paused)!
    expect(v1.playbackRate).toBe(1)
  })

  it('lets the playhead go back with the picture when a stretch before it is closed up while playing', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = addClip({ ...t, media: [media('a')] }, 'a')
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    // S twice while playing, a second apart, then Shift+Delete on the piece between.
    play(61)
    const first = frame
    t = splitClip(t, first)
    engine.setTimeline(t)
    play(30)
    const second = frame
    t = splitClip(t, second)
    engine.setTimeline(t)
    play(16)
    const before = frame
    const middle = v1Clips(t).find((c) => c.timelineStart === first)!
    t = closeUpClip(t, middle.id)
    engine.setTimeline(t)
    play(1)
    // Back by the piece taken out, where the picture now is.
    expect(Math.abs(frame - (before + 1 - (second - first)))).toBeLessThanOrEqual(2)
    const back = frame
    play(30)
    expect(frame).toBeGreaterThanOrEqual(back + 28)
  })

  it('says where the sequence is and when, as playback starts and again once the picture has taken over the clock', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = addClip({ ...t, media: [media('a')] }, 'a')
    const clocks: [number, number][] = []
    engine.onClock((sec, at) => clocks.push([sec, at]))
    engine.setTimeline(t)
    engine.seek(30)
    const started = clock.now
    engine.play()
    expect(clocks).toEqual([[1, started]])
    // Again once the picture really plays, from where it is then: two frames in.
    play(30)
    expect(clocks).toHaveLength(3)
    const [real, realAt] = clocks[1]!
    expect(realAt).toBeGreaterThan(started)
    expect(Math.abs(real - 1 - (realAt - started) / 1000)).toBeLessThan(1 / 30 + 1e-9)
    // And past the moment the picture needs to settle, it gives the clock its time, once.
    // Where the picture was then, which has played in step with the clock on the wall since.
    const [sec, at] = clocks[2]!
    expect(at).toBeGreaterThan(realAt + 300)
    expect(Math.abs(sec - 1 - (at - started) / 1000)).toBeLessThan(1 / 30 + 1e-9)
    play(30)
    expect(clocks).toHaveLength(3)
    // Again from the start after a pause.
    engine.pause()
    engine.play()
    expect(clocks).toHaveLength(4)
  })

  it('plays every player silent while muted, and as each clip says again after', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    play(10)
    const v1 = players('track-video', 'v1').find((v) => !v.paused)!
    const song = players('track-player', 'A2').find((p) => !p.paused)!
    expect(v1.muted).toBe(false)
    expect(song.muted).toBe(false)
    engine.setMuted(true)
    expect(made.every((p) => p.muted)).toBe(true)
    // A track added while muted is silent too.
    engine.setTimeline(addTrack(t, 'audio', 'A3'))
    expect(made.every((p) => p.muted)).toBe(true)
    engine.setMuted(false)
    expect(v1.muted).toBe(false)
    expect(song.muted).toBe(false)
  })

  it('plays a burst of sound where the playhead is dragged to, and stops it on its own', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    expect(made.every((p) => p.paused)).toBe(true)

    engine.scrub(60)
    const song = players('track-player', 'A2')
    // The one player holding the clip under the playhead. The other is parked
    // on what comes next, and playing it too would put two clips over each other.
    expect(song.filter((p) => !p.paused)).toHaveLength(1)
    expect(players('track-video', 'v1').filter((v) => !v.paused)).toHaveLength(1)

    // The burst ends by itself, without the drag ending: a pointer held still
    // must not leave the sound running on past the playhead.
    play(4)
    expect(made.every((p) => p.paused)).toBe(true)
  })

  it('moves the playhead while it is dragged, exactly as a plain seek does', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.scrub(90)
    expect(frame).toBe(90)
    engine.scrub(150)
    expect(frame).toBe(150)
    engine.endScrub()
    // Letting go moves nothing. The playhead is where the drag left it.
    expect(frame).toBe(150)
    expect(engine.isPlaying()).toBe(false)
  })

  it('carries a burst on rather than restarting it as the drag goes on', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.scrub(30)
    play(2)
    // Still inside the first burst, and moved on: it is not cut off by the move.
    engine.scrub(40)
    expect(made.some((p) => !p.paused)).toBe(true)
    play(4)
    expect(made.every((p) => p.paused)).toBe(true)
  })

  it('stops the sound the moment the drag ends, whatever is left of the burst', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.scrub(60)
    expect(made.some((p) => !p.paused)).toBe(true)
    engine.endScrub()
    expect(made.every((p) => p.paused)).toBe(true)
    // And nothing starts up again once the drag is over.
    play(4)
    expect(made.every((p) => p.paused)).toBe(true)
  })

  it('turns the preview down without touching a clip, and puts it back', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    play(10)
    const song = players('track-player', 'A2').find((p) => !p.paused)!
    const full = song.volume
    expect(full).toBeGreaterThan(0)

    engine.setMonitorVolume(0.5)
    expect(song.volume).toBeCloseTo(full / 2, 5)
    // Turned down, not silenced: mute is a different thing and stays off.
    expect(song.muted).toBe(false)
    // Still playing. Turning the listening down is not an edit and stops nothing.
    expect(song.paused).toBe(false)

    engine.setMonitorVolume(0)
    expect(song.volume).toBe(0)

    engine.setMonitorVolume(1)
    expect(song.volume).toBeCloseTo(full, 5)
  })

  it('keeps the preview turned down for a clip that arrives after it was turned down', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.setMonitorVolume(0.25)
    engine.seek(0)
    engine.play()
    play(10)
    const song = players('track-player', 'A2').find((p) => !p.paused)!
    expect(song.volume).toBeGreaterThan(0)
    engine.setMonitorVolume(1)
    expect(song.volume).toBeCloseTo(song.volume, 5)
    const loud = song.volume
    engine.setMonitorVolume(0.25)
    expect(song.volume).toBeCloseTo(loud / 4, 5)
  })

  it('starts the other players with a picture that is slow to get going, not ahead of it', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    // The picture a fifth of a second late, as on a busy machine; the song at once.
    FakePlayer.startDelay = 200
    try {
      engine.play()
    } finally {
      FakePlayer.startDelay = 0
    }
    play(3)
    const song = (): FakePlayer | undefined => players('track-player', 'A2').find((p) => !p.paused)
    // Nothing else plays while the picture stands still.
    expect(song()).toBeUndefined()
    play(20)
    const v1 = players('track-video', 'v1').find((v) => !v.paused)!
    expect(v1.currentTime).toBeGreaterThan(0.2)
    expect(Math.abs(song()!.currentTime - v1.currentTime)).toBeLessThan(0.04)
  })

  it('keeps the sequence on the clock on the wall across cuts while a voice over records, the picture held to it', () => {
    FakePlayer.startDelay = 100
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      const ids = ['a', 'b', 'c', 'd', 'e']
      t = { ...t, media: ids.map((id) => media(id)) }
      ids.forEach((id, i) => {
        t = addClip(t, id)
        t = setClipOut(t, v1Clips(t)[i]!.id, 90)
      })
      engine.setTimeline(t)
      engine.seek(0)
      engine.setWallClock(true)
      engine.play()
      // Past four cuts, each picture starting 100 ms late.
      play(400)
      expect(Math.abs(frame - 400)).toBeLessThanOrEqual(1)
      // The picture playing is held to that clock, not the other way round.
      const v1 = players('track-video', 'v1').find((v) => !v.paused)!
      const clip = v1Clips(t).find((c) => c.timelineStart <= frame && frame < c.timelineStart + 90)!
      expect(Math.abs(v1.currentTime - (frame - clip.timelineStart) / 30)).toBeLessThan(0.1)
    } finally {
      FakePlayer.startDelay = 0
    }
  })

  it('falls behind the clock on the wall at every cut when following the picture, as it does when not recording', () => {
    FakePlayer.startDelay = 100
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      const ids = ['a', 'b', 'c', 'd', 'e']
      t = { ...t, media: ids.map((id) => media(id)) }
      ids.forEach((id, i) => {
        t = addClip(t, id)
        t = setClipOut(t, v1Clips(t)[i]!.id, 90)
      })
      engine.setTimeline(t)
      engine.seek(0)
      engine.play()
      play(400)
      expect(frame).toBeLessThan(395)
    } finally {
      FakePlayer.startDelay = 0
    }
  })

  it('plays at the speed set: the clock, the picture it is read from, and the players held to it', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.setRate(2)
    engine.seek(0)
    engine.play()
    play(30)
    // A second at 2x is 60 frames.
    expect(Math.abs(frame - 60)).toBeLessThanOrEqual(3)
    const v1 = players('track-video', 'v1').find((v) => !v.paused)!
    expect(v1.playbackRate).toBe(2)
    const song = players('track-player', 'A2').find((v) => !v.paused)!
    expect(song.playbackRate).toBeGreaterThan(2 * 0.9)
    expect(song.playbackRate).toBeLessThan(2 * 1.1)
    expect(Math.abs(song.currentTime - frame / 30)).toBeLessThan(0.1)
  })

  it('changes speed while playing, going on from where it is', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(0)
    engine.play()
    play(30)
    const at = frame
    engine.setRate(1.5)
    play(30)
    expect(engine.isPlaying()).toBe(true)
    expect(Math.abs(frame - at - 45)).toBeLessThanOrEqual(3)
  })

  it('plays backwards, silent, every picture stepped back, and stops at the start', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(90)
    let ended = false
    engine.onEnded(() => (ended = true))
    engine.setRate(-1)
    engine.play()
    play(30)
    // A second back from 90.
    expect(Math.abs(frame - 60)).toBeLessThanOrEqual(2)
    expect(made.every((p) => p.paused)).toBe(true)
    const v1 = players('track-video', 'v1')
    expect(v1.some((v) => Math.abs(v.currentTime - frame / 30) < 0.07)).toBe(true)
    play(90)
    expect(frame).toBe(0)
    expect(engine.isPlaying()).toBe(false)
    expect(ended).toBe(true)
  })

  it('asks a picture for a new frame backwards only once the last has arrived', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.seek(150)
    engine.setRate(-1)
    engine.play()
    play(2)
    const v1 = players('track-video', 'v1').find((v) => v.currentTime > 0)!
    v1.seeking = true
    const waiting = v1.currentTime
    play(10)
    expect(v1.currentTime).toBe(waiting)
    v1.seeking = false
    play(1)
    expect(v1.currentTime).toBeLessThan(waiting)
  })

  it('goes back to the start of the loop at its end and plays on, and starts there from outside it', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.setLoop({ from: 30, to: 60 })
    engine.seek(0)
    engine.play()
    // Played from outside the loop, it starts at its start.
    expect(frame).toBe(30)
    play(45)
    // A second and a half would have been frame 75: it went round, and is still playing.
    expect(frame).toBeGreaterThanOrEqual(30)
    expect(frame).toBeLessThan(60)
    expect(engine.isPlaying()).toBe(true)
    engine.setLoop(null)
    play(60)
    expect(frame).toBeGreaterThan(60)
  })

  it('plays at the speed set with players that start late, as real ones do', () => {
    FakePlayer.startDelay = 100
    try {
      const { t } = songPastV1()
      engine.setTimeline(t)
      engine.setRate(2)
      engine.seek(0)
      engine.play()
      play(45)
      // A second and a half at 2x is 90 frames; the players are held to it once they get going.
      expect(Math.abs(frame - 90)).toBeLessThanOrEqual(8)
      expect(players('track-video', 'v1').find((v) => !v.paused)!.playbackRate).toBe(2)
    } finally {
      FakePlayer.startDelay = 0
    }
  })

  it('keeps the last frame on screen while playing backwards, drawing each new one only once it has arrived', () => {
    FakePlayer.slowSeeks = true
    try {
      const { t } = songPastV1()
      engine.setLayout({ source: { x: 0, y: 0, width: 500, height: 500 }, program: { x: 508, y: 4, width: 281, height: 492 } })
      engine.setTimeline(t)
      engine.seek(150)
      finishSeeks()
      engine.setRate(-1)
      engine.play()
      const before = paints
      // Each frame asks for the picture a little earlier; the first seek is still on its way.
      play(5)
      expect(paints).toBe(before)
      // The Source view goes on showing V1's recording meanwhile, on its side, not hidden behind the canvas.
      const onSource = players('track-video', 'v1').filter((v) => Number.parseFloat(v.style.left ?? 'NaN') < 500 && v.style.opacity === '1')
      expect(onSource).toHaveLength(1)
      // Once it arrives, it is drawn.
      finishSeeks()
      expect(paints).toBeGreaterThan(before)
    } finally {
      FakePlayer.slowSeeks = false
    }
  })

  it('plays backwards across a cut into the clip before it', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a')] }
    t = addClip(t, 'a')
    t = splitClip(t, 150)
    engine.setTimeline(t)
    engine.seek(170)
    engine.setRate(-1)
    engine.play()
    play(30)
    expect(frame).toBeLessThan(150)
    expect(players('track-video', 'v1').some((v) => Math.abs(v.currentTime - frame / 30) < 0.1)).toBe(true)
  })

  it('says it has ended when told to go faster backwards in the moment before the start', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    let ended = false
    engine.onEnded(() => (ended = true))
    engine.seek(1)
    engine.setRate(-1)
    engine.play()
    // Two thirds of a frame on: frame 0, still going.
    clock.now += 20
    for (const cb of frames.splice(0)) cb()
    expect(frame).toBe(0)
    expect(engine.isPlaying()).toBe(true)
    engine.setRate(-2)
    expect(engine.isPlaying()).toBe(false)
    expect(ended).toBe(true)
  })

  it('records a voice over on the wall clock at 1x, forward, and not round a loop, whatever is set', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    engine.setWallClock(true)
    try {
      engine.setRate(-2)
      engine.setLoop({ from: 30, to: 60 })
      engine.seek(0)
      engine.play()
      play(90)
      expect(Math.abs(frame - 90)).toBeLessThanOrEqual(2)
    } finally {
      engine.setWallClock(false)
    }
  })

  it('keeps only the last place a fast drag asks for while a seek is landing, and lands on it exactly', () => {
    FakePlayer.slowSeeks = true
    try {
      const { t } = songPastV1()
      engine.setTimeline(t)
      engine.seek(0)
      finishSeeks()
      const v1 = players('track-video', 'v1')
      const before = v1.map((p) => p.seeks)
      // A drag across V1, one move a frame, faster than long-GOP footage can seek.
      for (let f = 10; f <= 120; f += 10) engine.scrub(f)
      const seeking = v1.find((p) => p.seeking)!
      expect(seeking).toBeDefined()
      // The first move started a seek, and every later one waited for it
      // instead of throwing it away and starting again.
      expect(seeking.seeks - before[v1.indexOf(seeking)]!).toBe(1)
      // It lands, and goes straight on to the last place asked for, not any in between.
      finishSeeks()
      expect(seeking.seeking).toBe(true)
      expect(seeking.currentTime).toBe(4)
      finishSeeks()
      expect(seeking.seeking).toBe(false)
      engine.endScrub()
      finishSeeks()
      expect(seeking.currentTime).toBe(4)
      expect(frame).toBe(120)
    } finally {
      FakePlayer.slowSeeks = false
    }
  })

  it('lands a seek exactly after a drag, even one asked for while the drag was still landing', () => {
    FakePlayer.slowSeeks = true
    try {
      const { t } = songPastV1()
      engine.setTimeline(t)
      engine.seek(0)
      finishSeeks()
      engine.scrub(30)
      engine.scrub(60)
      engine.endScrub()
      // A click somewhere else before the drag's seek has landed.
      engine.seek(200)
      finishSeeks()
      finishSeeks()
      const v1 = players('track-video', 'v1').find((p) => Math.abs(p.currentTime - 200 / 30) < 1e-9)
      expect(v1).toBeDefined()
      expect(players('track-video', 'v1').some((p) => p.seeking)).toBe(false)
    } finally {
      FakePlayer.slowSeeks = false
    }
  })

  it('lets go of a player\'s loudness boost when its track goes, and of every one when the preview does', () => {
    const { t } = songPastV1()
    engine.setTimeline(t)
    const released: unknown[] = []
    ;(engine as unknown as { loudness: { release: (el: unknown) => void } }).loudness.release = (el) => released.push(el)
    // A2 removed.
    engine.setTimeline({ ...t, audioTracks: t.audioTracks.filter((r) => r.id !== 'A2') })
    expect(released).toEqual(players('track-player', 'A2'))
    engine.destroy()
    const rest = [...players('track-video', 'v1'), ...players('track-player', 'a1')]
    expect(released).toHaveLength(2 + rest.length)
    expect(released).toEqual(expect.arrayContaining(rest))
  })

  it('loads a track of GIFs only near the playhead as it plays, the next one ahead, and lets go of the rest', () => {
    const gif = (id: string): ProjectMedia =>
      media(id, { still: true, frames: 20, frameRate: 10, hasAudio: false, width: 480, height: 270, playablePath: `C:\\cache\\${id}\\0001.png` })
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [gif('g1'), gif('g2'), gif('g3')] }
    // Five seconds each, at 0 s, 60 s and 120 s.
    t = addSource(t, { clipId: 'c1', mediaId: 'g1', at: 0, onTrack: 'v1' })
    t = addSource(t, { clipId: 'c2', mediaId: 'g2', at: 1800, onTrack: 'v1' })
    t = addSource(t, { clipId: 'c3', mediaId: 'g3', at: 3600, onTrack: 'v1' })
    engine.setTimeline(t)
    engine.seek(0)
    const frames = (id: string): FakePlayer[] => made.filter((p) => p.dataset.testid === 'track-still' && p.src.includes(`/${id}/`))
    const released = made.filter((p) => p.dataset.testid === 'track-still')
    // The one under the playhead and the one to come next, not the last.
    expect(frames('g1')).toHaveLength(20)
    expect(frames('g2')).toHaveLength(20)
    expect(frames('g3')).toHaveLength(0)
    engine.play()
    // Past the second, into the gap before the third.
    play(3500)
    expect(engine.isPlaying()).toBe(true)
    expect(frames('g3')).toHaveLength(20)
    expect(frames('g1')).toHaveLength(0)
    expect(released.filter((p) => p.src === '')).toHaveLength(20)
  })
})

describe('the preview with the Source and Output views side by side', () => {
  /** Where an element is laid out, to a thousandth of a pixel: left, top, width and height. */
  function box(style: Record<string, string>): number[] {
    return [style.left, style.top, style.width, style.height].map((v) => Math.round(Number.parseFloat(v ?? 'NaN') * 1000) / 1000 + 0)
  }

  /** The canvas the engine draws the Output view on. */
  function canvasOf(engine: InstanceType<typeof HtmlVideoEngine>): { style: Record<string, string> } {
    return (engine as unknown as { canvas: { style: Record<string, string> } }).canvas
  }

  it('fits the recording the Source view shows into its side, and lays every other video out behind the canvas', () => {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a'), media('o', { hasAudio: false })] }
    t = addClip(t, 'a')
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { clipId: 'o', mediaId: 'o', at: 0, onTrack: 'v2' })
    const program = { x: 508, y: 0, width: 281, height: 500 }
    engine.setLayout({ source: { x: 0, y: 0, width: 500, height: 500 }, program })
    engine.setTimeline(t)
    engine.seek(10)

    // The canvas is the Output side, and only that.
    expect(canvasOf(engine).style).toMatchObject({ left: '508px', top: '0px', width: '281px', height: '500px', visibility: 'visible' })
    // V1's recording, 16:9, fitted into the 500 pixel square of the Source side and seen.
    const v1 = players('track-video', 'v1')
    const shown = v1.filter((v) => box(v.style)[0] === 0)
    expect(shown).toHaveLength(1)
    expect(box(shown[0]!.style)).toEqual([0, 109.375, 500, 281.25])
    expect(shown[0]!.style.opacity).toBe('1')
    // Everything else behind the canvas, whole, so it goes on giving frames for the Output view to draw.
    for (const v of [...v1.filter((x) => x !== shown[0]), ...players('track-video', 'v2')]) {
      expect(box(v.style)).toEqual([508, 0, 281, 500])
      expect(v.style.opacity).toBe('1')
    }
  })

  it('lays every video out in the one view shown once side by side is left, none where side by side put it', () => {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a'), media('o', { hasAudio: false })] }
    t = addClip(t, 'a')
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { clipId: 'o', mediaId: 'o', at: 0, onTrack: 'v2' })
    engine.setLayout({ source: { x: 0, y: 0, width: 1198, height: 700 }, program: { x: 1206, y: 4, width: 390, height: 692 } })
    engine.setTimeline(t)
    engine.seek(10)
    // The Output view alone on a monitor narrowed to 1000: nothing is left out at 1206.
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 1000, height: 700 } })
    for (const v of [...players('track-video', 'v1'), ...players('track-video', 'v2')]) {
      const [x = NaN, y = NaN, w = NaN, h = NaN] = box(v.style)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(1000)
      expect(y + h).toBeLessThanOrEqual(700)
    }
  })

  it('stays zoomed across a cut to another clip of the same recording, on the frame the cut is drawn', () => {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a')] }
    t = addClip(t, 'a')
    t = splitClip(t, 150)
    engine.setLayout({ source: { x: 0, y: 0, width: 500, height: 500 }, program: { x: 508, y: 4, width: 281, height: 492 } })
    engine.setTimeline(t)
    engine.seek(10)
    engine.setSourceZoom({ path: 'C:\\v\\a.mp4', zoom: { scale: 2, cx: 960, cy: 540 } })
    // Into the second clip, with nothing told to the engine but where it is.
    engine.seek(200)
    const shown = players('track-video', 'v1').filter((v) => (box(v.style)[0] ?? 1) <= 0)
    expect(shown).toHaveLength(1)
    expect(box(shown[0]!.style)).toEqual([-250, -31.25, 1000, 562.5])
  })

  it('zooms the recording the Source view shows when asked, cut to the Source view, and no other', () => {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a')] }
    t = addClip(t, 'a')
    const program = { x: 508, y: 4, width: 281, height: 492 }
    engine.setLayout({ source: { x: 0, y: 0, width: 500, height: 500 }, program })
    engine.setTimeline(t)
    engine.seek(10)
    const shown = (): FakePlayer => players('track-video', 'v1').find((v) => (box(v.style)[0] ?? 1) <= 0)!
    // Fitted: 1920x1080 in a 500 square, 500 by 281.25, nothing cut.
    expect(box(shown().style)).toEqual([0, 109.375, 500, 281.25])
    expect(shown().style.clipPath ?? '').toBe('')

    // Twice as big about the middle: 1000 by 562.5, its middle in the view's, cut to the view.
    engine.setSourceZoom({ path: 'C:\\v\\a.mp4', zoom: { scale: 2, cx: 960, cy: 540 } })
    expect(box(shown().style)).toEqual([-250, -31.25, 1000, 562.5])
    const cut = (shown().style.clipPath ?? '').match(/^inset\((.*)\)$/)?.[1]?.split(' ').map((v) => Math.round(Number.parseFloat(v) * 1000) / 1000)
    expect(cut).toEqual([31.25, 250, 31.25, 250])

    // A zoom meant for another recording leaves this one fitted.
    engine.setSourceZoom({ path: 'C:\\v\\other.mp4', zoom: { scale: 2, cx: 960, cy: 540 } })
    expect(box(shown().style)).toEqual([0, 109.375, 500, 281.25])
    expect(shown().style.clipPath).toBe('')
  })

  it('hides the canvas with the Source view alone, and shows only the one recording', () => {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a'), media('o', { hasAudio: false })] }
    t = addClip(t, 'a')
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { clipId: 'o', mediaId: 'o', at: 0, onTrack: 'v2' })
    engine.setLayout({ source: { x: 0, y: 0, width: 800, height: 450 }, program: null })
    engine.setTimeline(t)
    engine.seek(10)
    expect(canvasOf(engine).style.visibility).toBe('hidden')
    const seen = [...players('track-video', 'v1'), ...players('track-video', 'v2')].filter((v) => v.style.opacity === '1')
    expect(seen).toHaveLength(1)
    expect(box(seen[0]!.style)).toEqual([0, 0, 800, 450])
  })
})

describe('the preview skimmed while paused', () => {
  /** The canvas the engine draws the Output view on. */
  const layout = { source: { x: 0, y: 0, width: 500, height: 500 }, program: { x: 508, y: 4, width: 281, height: 492 } }

  /** The V1 player the Source view shows. */
  function onSource(): FakePlayer[] {
    return players('track-video', 'v1').filter((v) => Number.parseFloat(v.style.left ?? 'NaN') < 500 && v.style.opacity === '1')
  }

  function start(t: Timeline): InstanceType<typeof HtmlVideoEngine> {
    made.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout(layout)
    engine.setTimeline(t)
    return engine
  }

  it('keeps the last frame on screen while a skim seeks, and draws the new one once it arrives', () => {
    FakePlayer.slowSeeks = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      t = { ...t, media: [media('a')] }
      t = addClip(t, 'a')
      const engine = start(t)
      engine.seek(10)
      finishSeeks()
      const shown = onSource()
      expect(shown).toHaveLength(1)
      const before = paints
      engine.showFrame(100)
      // Nothing painted over the last frame, and the recording stays in the Source view.
      expect(paints).toBe(before)
      expect(onSource()).toEqual(shown)
      finishSeeks()
      expect(paints).toBeGreaterThan(before)
      expect(onSource()).toEqual(shown)
    } finally {
      FakePlayer.slowSeeks = false
    }
  })

  it('loads a clip of another file into the player not on screen, and keeps the frame on screen until it has its own', () => {
    FakePlayer.slowLoads = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      t = { ...t, media: [media('a'), media('b'), media('c')] }
      t = addClip(t, 'a')
      t = setClipOut(t, v1Clips(t)[0]!.id, 150)
      t = addSource(t, { clipId: 'b1', mediaId: 'b', at: 150, onTrack: 'v1' })
      t = setClipOut(t, 'b1', 150)
      t = addSource(t, { clipId: 'c1', mediaId: 'c', at: 300, onTrack: 'v1' })
      const engine = start(t)
      engine.seek(10)
      finishLoads()
      finishLoads()
      const [a] = onSource()
      expect(a?.src).toContain('a.mp4')
      const before = paints
      // Past b, which is already loaded as the next clip, to c, which is not.
      engine.showFrame(350)
      // The frame of a is still there, drawn and in the Source view, while c loads in the other player.
      expect(a?.src).toContain('a.mp4')
      expect(onSource()).toEqual([a])
      expect(paints).toBe(before)
      finishLoads()
      const [c] = onSource()
      expect(c).not.toBe(a)
      expect(c?.src).toContain('c.mp4')
      expect(paints).toBeGreaterThan(before)
    } finally {
      FakePlayer.slowLoads = false
    }
  })

  it('keeps the frame on screen across a skim over several clips, each of another file, faster than any loads', () => {
    FakePlayer.slowLoads = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      t = { ...t, media: ['a', 'b', 'c', 'd', 'e'].map((id) => media(id)) }
      t = addClip(t, 'a')
      t = setClipOut(t, v1Clips(t)[0]!.id, 150)
      for (const [i, id] of ['b', 'c', 'd', 'e'].entries()) {
        t = addSource(t, { clipId: `${id}1`, mediaId: id, at: 150 * (i + 1), onTrack: 'v1' })
        t = setClipOut(t, `${id}1`, 150)
      }
      const engine = start(t)
      engine.seek(10)
      finishLoads()
      finishLoads()
      const [a] = onSource()
      expect(a?.src).toContain('a.mp4')
      // Across c and on to d before either has loaded.
      for (const at of [350, 500]) {
        engine.showFrame(at)
        expect(a?.src).toContain('a.mp4')
        expect(onSource()).toEqual([a])
      }
      finishLoads()
      const [d] = onSource()
      expect(d?.src).toContain('d.mp4')
      // With d on screen, the clip after it is loaded ahead again, in the other player.
      expect(players('track-video', 'v1').some((p) => p !== d && p.src.includes('e.mp4'))).toBe(true)
    } finally {
      FakePlayer.slowLoads = false
    }
  })

  it('loads the next sound ahead while the one parked on is still loading, as a sound lane has no frame to keep', () => {
    FakePlayer.slowLoads = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      const song = (id: string): ProjectMedia => media(id, { hasVideo: false, width: 0, height: 0, playablePath: `C:\\m\\${id}.wav` })
      t = { ...t, media: [media('a'), song('one'), song('two')] }
      t = addClip(t, 'a')
      t = addTrack(t, 'audio', 'A2')
      t = addSource(t, { clipId: 's1', mediaId: 'one', at: 0, onTrack: 'A2' })
      t = setClipOut(t, 's1', 150)
      t = addSource(t, { clipId: 's2', mediaId: 'two', at: 150, onTrack: 'A2' })
      start(t)
      // Nothing has loaded yet, and the song after the one under the playhead is already on its way.
      expect(made.some((p) => p.tag === 'audio' && p.src.includes('two.wav'))).toBe(true)
    } finally {
      FakePlayer.slowLoads = false
    }
  })

  it('paints a resized Output view at once, even while a picture is on its way, since resizing cleared it', () => {
    FakePlayer.slowSeeks = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      t = { ...t, media: [media('a')] }
      t = addClip(t, 'a')
      const engine = start(t)
      engine.seek(10)
      finishSeeks()
      engine.showFrame(100)
      const before = paints
      engine.setLayout({ ...layout, program: { ...layout.program, width: 200, height: 356 } })
      expect(paints).toBeGreaterThan(before)
    } finally {
      FakePlayer.slowSeeks = false
      finishSeeks()
    }
  })

  it('draws the frame as it is once a seek has taken too long, rather than waiting on it for good', () => {
    FakePlayer.slowSeeks = true
    try {
      let t = createTimeline(30, { width: 1080, height: 1920 })
      t = { ...t, media: [media('a')] }
      t = addClip(t, 'a')
      const engine = start(t)
      engine.seek(10)
      finishSeeks()
      const before = paints
      engine.showFrame(100)
      engine.setLayout(layout)
      expect(paints).toBe(before)
      // The seek never lands; after long enough, what there is is drawn.
      clock.now += 600
      engine.setLayout(layout)
      expect(paints).toBeGreaterThan(before)
    } finally {
      FakePlayer.slowSeeks = false
      finishSeeks()
    }
  })
})

describe('the preview of a track that ducks', () => {
  it('brings its players down under the voice, by the curve the export uses', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('song', { hasVideo: false, width: 0, height: 0, playablePath: 'C:\m\song.wav' })] }
    t = addTrack(t, 'audio', 'A2')
    t = addSource(t, { clipId: 'one', mediaId: 'song', at: 0, onTrack: 'A2' })
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    const lane = (): { clips: { id: string; fadeAt?: (sec: number) => number }[] } =>
      (engine as unknown as { audioLanes: Map<string, { clips: { id: string; fadeAt?: (sec: number) => number }[] }> }).audioLanes.get('A2')!
    const voice = [{ from: 60, to: 120 }]
    engine.setVoice(voice)
    engine.setTimeline(t)
    // Not ducking yet: nothing to follow.
    expect(lane().clips[0]!.fadeAt).toBeUndefined()
    engine.setTimeline(setTrackDuck(t, 'A2', true))
    const at = lane().clips[0]!.fadeAt!
    for (const sec of [0.5, 1.9, 3, 4.2, 6]) expect(at(sec)).toBeCloseTo(duckGainAt(voice, 30, sec), 9)
    expect(at(3)).toBeLessThan(0.3)
  })
})

describe('the preview over a transition', () => {
  /**
   * Two clips of one twenty second recording on V1, the first trimmed to 150
   * frames so the two meet there and the first has footage to spare.
   */
  function twoClips(): Timeline {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a')] }
    t = addClip(t, 'a', 'first')
    t = setClipOut(t, 'first', 150)
    t = addClip(t, 'a', 'second')
    return t
  }

  /** Two music clips on A2, meeting at 150: sound of its own, not a picture's. */
  function twoSongs(): Timeline {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('song', { hasVideo: false, width: 0, height: 0, playablePath: 'C:\m\song.wav' })] }
    t = addTrack(t, 'audio', 'A2')
    t = addSource(t, { clipId: 'one', mediaId: 'song', at: 0, onTrack: 'A2' })
    // Dropped at 150, which trims the first one there and leaves it footage to spare.
    t = addSource(t, { clipId: 'two', mediaId: 'song', at: 150, onTrack: 'A2' })
    return t
  }

  /** What a lane was told about its clips: the id, and where it is shown from and to, in seconds. */
  function spans(engine: InstanceType<typeof HtmlVideoEngine>, track: string): [string, number, number][] {
    const lanes = (engine as unknown as { videoLanes: Map<string, unknown>; audioLanes: Map<string, unknown> })
    const lane = (lanes.videoLanes.get(track) ?? lanes.audioLanes.get(track)) as { clips: { id: string; startSec: number; endSec: number }[] }
    return lane.clips.map((c) => [c.id, Math.round(c.startSec * 30), Math.round(c.endSec * 30)])
  }

  it('shows one picture at a time, handing over in the middle of the window', () => {
    const t = twoClips()
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setTimeline(addTransition(t, 'second', 'in', { kind: 'toBlack', length: 30 }))
    // The cut is at 150 and the window is centred on it: the handover is there,
    // and neither clip is shown over a frame the other one is.
    const shown = spans(engine, 'v1')
    expect(shown.map((x) => x[0])).toEqual(['first', 'second'])
    expect(shown[0]![2]).toBe(150)
    expect(shown[1]![1]).toBe(150)
  })

  it('stretches a picture past its own edges for a fade with nothing on the other side', () => {
    let t = createTimeline(30, { width: 1080, height: 1920 })
    t = { ...t, media: [media('a')] }
    t = addClip(t, 'a', 'only')
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setTimeline(t)
    const end = spans(engine, 'v1')[0]?.[2] ?? 0
    engine.setTimeline(addTransition(t, 'only', 'out', { kind: 'toBlack', length: 30 }))
    // Half of a thirty frame window hangs off its end, and it is shown there.
    expect(spans(engine, 'v1')).toEqual([['only', 0, end + 15]])
  })

  it('shows both pictures over a blend, and plays both players', () => {
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 540, height: 960 } })
    engine.setTimeline(addTransition(twoClips(), 'second', 'in', { kind: 'dissolve', length: 30 }))
    // Both clips are on screen over the whole window, and neither is cut short.
    expect(spans(engine, 'v1')).toEqual([
      ['first', 0, 165],
      ['second', 135, 750]
    ])

    engine.seek(140)
    engine.play()
    for (let i = 0; i < 20; i++) {
      clock.now += 1000 / 30
      for (const v of made) if (!v.paused && clock.now >= v.startsAt) v.advance(v.playbackRate / 30)
      for (const cb of frames.splice(0)) cb()
    }
    const playing = made.filter((p) => p.dataset.testid === 'track-video' && p.dataset.track === 'v1' && !p.paused)
    expect(playing).toHaveLength(2)
  })

  it('draws both pictures while the blend runs, and one once it is over', () => {
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 540, height: 960 } })
    engine.setTimeline(addTransition(twoClips(), 'second', 'in', { kind: 'dissolve', length: 30 }))

    /** Play `n` frames and say how many pictures were drawn over them. */
    const drawnOver = (n: number): number => {
      draws = 0
      for (let i = 0; i < n; i++) {
        clock.now += 1000 / 30
        for (const v of made) if (!v.paused && clock.now >= v.startsAt) v.advance(v.playbackRate / 30)
        for (const cb of frames.splice(0)) cb()
      }
      return draws
    }

    // The window runs from 135 to 165.
    engine.seek(140)
    engine.play()
    const inside = drawnOver(10)
    const after = drawnOver(40)
    engine.pause()
    expect(inside).toBeGreaterThan(0)
    // Two pictures a frame while it blends, one a frame once it is past.
    expect(inside / 10).toBeGreaterThan(1.5)
    expect(after / 40).toBeLessThan(1.5)
  })

  it('leaves one player on the clip that is left once the blend is over', () => {
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 540, height: 960 } })
    engine.setTimeline(addTransition(twoClips(), 'second', 'in', { kind: 'dissolve', length: 30 }))
    engine.seek(140)
    engine.play()
    for (let i = 0; i < 60; i++) {
      clock.now += 1000 / 30
      for (const v of made) if (!v.paused && clock.now >= v.startsAt) v.advance(v.playbackRate / 30)
      for (const cb of frames.splice(0)) cb()
    }
    // Past the window at 165: the outgoing picture has stopped and the other plays on.
    const playing = made.filter((p) => p.dataset.testid === 'track-video' && p.dataset.track === 'v1' && !p.paused)
    expect(playing).toHaveLength(1)
  })

  it('overlaps both sounds of a crossfade, and plays both at once', () => {
    made.length = 0
    frames.length = 0
    const engine = new HtmlVideoEngine()
    engine.mount({ appendChild() {} } as unknown as HTMLElement)
    engine.setLayout({ source: null, program: { x: 0, y: 0, width: 540, height: 960 } })
    engine.setTimeline(addTransition(twoSongs(), 'two', 'in', { kind: 'even', length: 30 }))
    const shown = spans(engine, 'A2')
    expect(shown[0]).toEqual(['one', 0, 165])
    expect(shown[1]![1]).toBe(135)

    engine.seek(140)
    engine.play()
    for (let i = 0; i < 20; i++) {
      clock.now += 1000 / 30
      for (const v of made) if (!v.paused && clock.now >= v.startsAt) v.advance(v.playbackRate / 30)
      for (const cb of frames.splice(0)) cb()
    }
    const sounds = made.filter((p) => p.dataset.testid === 'track-player' && p.dataset.track === 'A2')
    const playing = sounds.filter((p) => !p.paused)
    expect(playing).toHaveLength(2)
    // One on its way down and the other on its way up, and neither silent.
    const volumes = playing.map((p) => p.volume).sort((a, b) => a - b)
    expect(volumes[0]).toBeGreaterThan(0)
    expect(volumes[1]).toBeLessThan(1)
  })
})
