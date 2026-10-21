import { describe, it, expect } from 'vitest'
import { EditListError, buildFromEditList, readEditList, type EditListV1 as EditList, type EditListV2, type SourceFacts } from '../../src/shared/edit-list'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { type Project, type SoundClip } from '../../src/shared/project'
import { toStereo } from '../../src/shared/sound'
import { firstTimeline } from '../project-helpers'

/**
 * Task 1188. Sound in an edit list: sound effects laid on the reel's clock,
 * songs under the cut in seconds of the cut, and the reel's own sound raised
 * or lowered over a stretch. Each lands as the app would leave it by hand.
 */

const SCREEN = 'D:\\OBS\\screen.mkv'
const POP = 'D:\\Editbay\\sfx\\pop.wav'
const SONG = 'D:\\Music\\bed.mp3'
const facts = new Map<string, SourceFacts>([
  [SCREEN, { durationSec: 60, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, hasVideo: true, audioTracks: 1 }],
  [POP, { durationSec: 0.5, width: 0, height: 0, fps: 0, codec: 'pcm_s16le', hasAudio: true, hasVideo: false, audioTracks: 1 }],
  [SONG, { durationSec: 120, width: 0, height: 0, fps: 0, codec: 'mp3', hasAudio: true, hasVideo: false, audioTracks: 1 }]
])

/** A screen recording with 2 s taken out at 10 s, two pops, a quiet stretch raised, and a song under it all. */
function list(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [{ id: 'screen', path: SCREEN, offsetSec: 0 }],
    main: 'screen',
    sound: 'screen',
    cuts: [{ fromSec: 10, toSec: 12, why: 'pause' }],
    zooms: [],
    markers: [],
    sounds: [
      { path: POP, fromSec: 20, gainDb: -6, why: 'sticker in', mark: true },
      { path: POP, fromSec: 30 }
    ],
    gains: [{ fromSec: 15, toSec: 18, gainDb: 6, why: 'phone voice' }],
    music: [{ path: SONG, startSec: 4, gainDb: -20, fadeOutSec: 2 }]
  }
}

function build(l: unknown = list()): Project {
  return buildFromEditList(readEditList(l), facts, 'rough cut').project
}

function refusal(edit: (l: EditList) => void): string {
  const l = list()
  edit(l)
  try {
    build(l)
  } catch (err) {
    expect(err).toBeInstanceOf(EditListError)
    return (err as Error).message
  }
  throw new Error('the list was built, and should have been refused')
}

const onTracks = (p: Project, prefix: string): SoundClip[] =>
  firstTimeline(p)
    .audioTracks.filter((r) => r.id.startsWith(prefix))
    .flatMap((r) => r.clips)

describe('reading sound', () => {
  it('gives it back as written', () => {
    expect(readEditList(list())).toEqual(list())
  })

  it('takes music in a version 2 list, beside its reels', () => {
    const { version: _v, shape: _s, music, ...reel } = list()
    const l: EditListV2 = { version: 2, shape: 'landscape', reels: [reel], music: music! }
    expect(readEditList(l)).toEqual(l)
  })

  it('refuses a gain louder than the app goes, of 0 dB, or overlapping another', () => {
    expect(refusal((l) => (l.gains![0]!.gainDb = 13))).toMatch(/^gains\[0\]\.gainDb: .*\+12\.0 dB/)
    expect(refusal((l) => (l.gains![0]!.gainDb = 0))).toMatch(/^gains\[0\]\.gainDb: .*changes nothing/)
    expect(refusal((l) => l.gains!.push({ fromSec: 17, toSec: 19, gainDb: 3 }))).toMatch(/^gains\[1\]: overlaps gains\[0\]/)
  })

  it('refuses a misspelt field, and a fade of nothing', () => {
    expect(refusal((l) => ((l.sounds![0] as unknown as Record<string, unknown>).atSec = 3))).toMatch(/^sounds\[0\]\.atSec: is not a field/)
    expect(refusal((l) => (l.music![0]!.fadeInSec = 0))).toMatch(/^music\[0\]\.fadeInSec: /)
  })
})

describe('sound effects', () => {
  it('land where their moment lands in the cut, whole, at their volume, on one track for one file', () => {
    const pops = onTracks(build(), 'sound')
    // 20 s and 30 s, each 2 s earlier for the pause taken out before them.
    expect(pops.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [540, 0, 15],
      [840, 0, 15]
    ])
    expect(pops[0]!.gain).toBeCloseTo(0.501187, 6)
    expect(pops[1]!.gain).toBe(1)
    expect(firstTimeline(build()).audioTracks.filter((r) => r.id.startsWith('sound'))).toHaveLength(1)
  })

  it('take a track each where they overlap', () => {
    const l = list()
    l.sounds![1]!.fromSec = 20.2
    expect(firstTimeline(build(l)).audioTracks.filter((r) => r.id.startsWith('sound'))).toHaveLength(2)
  })

  it('are marked where they come in when asked', () => {
    expect(firstTimeline(build()).markers.map((m) => [m.frame, m.name])).toEqual([[540, 'sticker in']])
  })

  it('refuse a file with a picture, one inside a cut, and one past the end of the cut', () => {
    expect(refusal((l) => (l.sounds![0]!.path = SCREEN))).toMatch(/^sounds\[0\]\.path: .*has a picture/)
    expect(refusal((l) => (l.sounds![0]!.fromSec = 11))).toMatch(/^sounds\[0\]\.fromSec: .*taken out/)
    expect(refusal((l) => (l.sounds![0]!.fromSec = 59.8))).toMatch(/^sounds\[0\]: .*past the end/)
  })
})

describe('a song under the cut', () => {
  it('runs from its start into the file to the end of the cut, quiet, fading out', () => {
    const [song] = onTracks(build(), 'music')
    // The cut is 58 s, 1740 frames; the song starts 4 s, 120 frames, into its file.
    expect([song!.timelineStart, song!.sourceIn, song!.sourceOut]).toEqual([0, 120, 1860])
    expect(song!.gain).toBeCloseTo(0.1, 6)
    expect(song!.transitionOut).toEqual({ kind: 'even', length: 60, before: 60 })
  })

  it('keeps its own fade when the cut dips to black at the end', () => {
    const l = list()
    l.endDipToBlackSec = 1
    const [song] = onTracks(build(l), 'music')
    expect(song!.transitionOut).toEqual({ kind: 'even', length: 60, before: 60 })
  })

  it('stops at the end of the song when the song runs out first', () => {
    const l = list()
    l.music![0]!.startSec = 100
    const [song] = onTracks(build(l), 'music')
    expect([song!.timelineStart, song!.sourceIn, song!.sourceOut]).toEqual([0, 3000, 3600])
  })

  it('refuses an end past the song, or past the cut', () => {
    expect(
      refusal((l) => {
        l.music![0]!.startSec = 100
        l.music![0]!.toCutSec = 30
      })
    ).toMatch(/^music\[0\]: .*which ends at 120\.00 s/)
    expect(refusal((l) => (l.music![0]!.toCutSec = 59))).toMatch(/^music\[0\]: .*past the end/)
  })
})

describe('one side of the voice on both', () => {
  it("puts the side on every piece of the reel's sound, and keeps it through the project file", () => {
    const l = list()
    l.soundChannel = 'left'
    const p = build(l)
    const a1 = firstTimeline(p).audioTracks[0]!.clips
    expect(a1.length).toBeGreaterThan(1)
    expect(a1.every((c) => c.channel === 'left')).toBe(true)
    expect(onTracks(p, 'sound').every((c) => c.channel === undefined)).toBe(true)
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })

  it('refuses a side that is not left or right', () => {
    expect(refusal((l) => ((l as unknown as Record<string, unknown>).soundChannel = 'mono'))).toMatch(/^soundChannel: must be one of left, right/)
  })

  it('pans the export from that side, and leaves a mono track as it is', () => {
    expect(toStereo(2, 'left')).toBe('pan=stereo|c0=c0|c1=c0')
    expect(toStereo(2, 'right')).toBe('pan=stereo|c0=c1|c1=c1')
    expect(toStereo(1, 'right')).toBe(toStereo(1))
  })
})

describe('a gain over a stretch', () => {
  it("cuts the reel's sound at its edges, with its picture, and raises what is between", () => {
    const t = firstTimeline(build())
    const a1 = t.audioTracks[0]!.clips
    // 15 s and 18 s land 2 s earlier: 390 and 480.
    expect(a1.map((c) => [c.timelineStart, c.gain])).toEqual([
      [0, 1],
      [300, 1],
      [390, Number((10 ** (6 / 20)).toFixed(6))],
      [480, 1]
    ])
    expect(t.videoTracks[0]!.clips.map((c) => c.timelineStart)).toEqual([0, 300, 390, 480])
    expect(a1.map((c) => c.link)).toEqual(t.videoTracks[0]!.clips.map((c) => c.link))
  })

  it('reads back through the project file unchanged', () => {
    const p = build()
    expect(splitProjectFile(joinProjectFile(p, defaultWorkspace())).project).toEqual(p)
  })
})
