import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Lane, type LaneClip } from '../../../src/renderer/preview/lanes'
import { FakePlayer, finishSeeks, made } from './fake-player'

function lane(): { lane: Lane; players: FakePlayer[] } {
  const players: FakePlayer[] = []
  const l = new Lane(null, () => {
    const p = new FakePlayer('video')
    made.push(p)
    players.push(p)
    return p as unknown as HTMLMediaElement
  })
  return { lane: l, players }
}

/** A picture from 1 s to 3 s of the sequence, from the start of its file, with no sound of its own to play. */
const picture: LaneClip = { id: 'p', path: 'C:\\v\\p.mp4', startSec: 1, endSec: 3, fileAtStart: 0, volume: 0, muted: true }

/** A song from 0 s to 10 s of the sequence, from the start of its file. */
const song: LaneClip = { id: 's', path: 'C:\\m\\song.wav', startSec: 0, endSec: 10, fileAtStart: 0, volume: 0.8, muted: false }

describe('a track\'s players', () => {
  // Seeks that land only when let, as Chromium's do.
  beforeEach(() => {
    made.length = 0
    FakePlayer.slowSeeks = true
  })
  afterEach(() => {
    FakePlayer.slowSeeks = false
  })

  it('show the clip from the player parked on the playhead, not one left at its first frame', () => {
    const { lane: l, players } = lane()
    l.setClips([picture])
    l.park(0)
    // Played into the picture: the player that waited for it takes over.
    l.tick(0.5, true)
    l.tick(1.2, true)
    const playing = players.find((p) => !p.paused)!
    expect(playing).toBeDefined()
    l.pause()
    // Home, then a click half way into the picture.
    l.park(0)
    l.park(2.5)
    // Nothing to show while the seek is still landing.
    finishSeeks()
    const shown = l.shown(2.5)
    expect(shown).not.toBeNull()
    expect((shown!.el as unknown as FakePlayer).currentTime).toBeCloseTo(1.5)
  })

  it('never have two players holding one clip', () => {
    const { lane: l, players } = lane()
    l.setClips([picture])
    l.park(0)
    l.tick(1.2, true)
    l.pause()
    l.park(0)
    l.park(2)
    const parkedOnIt = players.filter((p) => Math.abs(p.currentTime - 1) < 1e-6)
    expect(parkedOnIt).toHaveLength(1)
  })

  it('do not try a player that failed on every frame', () => {
    const { lane: l, players } = lane()
    l.setClips([picture])
    l.park(1.5)
    for (const p of players) p.error = { code: 4 } as MediaError
    l.tick(1.6, true)
    l.tick(1.7, true)
    expect(players.every((p) => p.paused)).toBe(true)
  })

  it('leave a player that has played to its end there, rather than playing it again from the start', () => {
    const { lane: l, players } = lane()
    l.setClips([song])
    l.park(0)
    l.tick(0.1, true)
    const playing = players.find((p) => !p.paused)!
    expect(playing).toBeDefined()
    expect(playing.plays).toBe(1)
    // Its file is a little shorter than the clip: it ends, and stops, at 9.5 s.
    playing.currentTime = 9.5
    playing.ended = true
    playing.paused = true
    // A browser starts an ended player again from 0 when it is played.
    for (const t of [9.6, 9.7, 9.8]) l.tick(t, true)
    expect(playing.plays).toBe(1)
    expect(playing.paused).toBe(true)
    expect(playing.currentTime).toBe(9.5)
  })

  it('give each player the mute of the clip it holds, when it is loaded and when the clips change', () => {
    const { lane: l, players } = lane()
    l.setClips([{ ...song, muted: true }])
    l.park(2)
    const holding = players.find((p) => Math.abs(p.currentTime - 2) < 1e-6)!
    expect(holding).toBeDefined()
    expect(holding.muted).toBe(true)
    // Heard now, as when its sound is ticked: the player holding it follows at once.
    l.setClips([song])
    expect(holding.muted).toBe(false)
    expect(holding.volume).toBe(0.8)
    l.setClips([{ ...song, muted: true }])
    expect(holding.muted).toBe(true)
  })

  it('leave a playing player alone when not told to correct it', () => {
    const { lane: l, players } = lane()
    l.setClips([song])
    l.park(0)
    l.tick(0.1, true)
    // Its seeks land, as they do a moment after a real one is asked.
    finishSeeks()
    const playing = players.find((p) => !p.paused)!
    playing.playbackRate = 1.02
    // 150 ms ahead of the time it is told: corrected, it would be slowed.
    playing.advance(2.15 - playing.currentTime)
    l.tick(2, false)
    expect(playing.currentTime).toBe(2.15)
    expect(playing.playbackRate).toBe(1.02)
    l.tick(2, true)
    expect(playing.playbackRate).toBeLessThan(1)
  })

  it('tell whoever holds on to a player that it is going when the lane is destroyed', () => {
    const { lane: l, players } = lane()
    l.setClips([song])
    l.park(0)
    const released: unknown[] = []
    l.destroy((el) => released.push(el))
    expect(released).toEqual(players)
  })

  it('play the clock\'s own source at its own speed, never nudged, or the clock runs as fast as it does', () => {
    const { lane: l, players } = lane()
    l.setClips([song])
    l.park(0)
    l.tick(0.1, false, true)
    const playing = players.find((p) => !p.paused)!
    // Started at 1, not the speed the others catch up at.
    expect(playing.playbackRate).toBe(1)
    // Nudged while it was not the source, it goes back to 1 once it is.
    playing.playbackRate = 1.01
    playing.advance(2.15 - playing.currentTime)
    l.tick(2, true, true)
    expect(playing.playbackRate).toBe(1)
    expect(playing.currentTime).toBe(2.15)
  })
})
