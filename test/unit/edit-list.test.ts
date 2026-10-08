import { describe, it, expect } from 'vitest'
import { EditListError, readEditList, type EditListV1 as EditList, type EditListV2 } from '../../src/shared/edit-list'

/**
 * Plan 74. The edit list an agent writes for `npm run cli -- build`, read and
 * checked before anything is made from it: a list that reads comes back as it
 * was, and one that is wrong is refused with the field that is wrong named.
 */

/** The example in docs/edit-list.md, as an agent would write it. */
function example(): EditList {
  return {
    version: 1,
    shape: 'landscape',
    sources: [
      { id: 'screen', path: 'D:/OBS-recordings/2026-10-01 10-00-00.mkv', offsetSec: 0 },
      { id: 'camera', path: 'D:/Phone/VID_0001.mp4', offsetSec: -2.35 }
    ],
    main: 'screen',
    sound: 'screen',
    corner: { source: 'camera', at: 'bottom-right' },
    range: { fromSec: 0, toSec: 612.4 },
    cuts: [
      { fromSec: 12.1, toSec: 13.55, why: 'pause', mark: false },
      { fromSec: 40.2, toSec: 51.8, why: 'retake', words: 'so this is the, so this is the editor', mark: true }
    ],
    zooms: [
      { fromSec: 75.0, toSec: 81.5, rect: { x: 0.55, y: 0.05, w: 0.4, h: 0.4 }, how: 'cut', why: 'pointing at the export button', mark: true }
    ],
    markers: [{ atSec: 140.2, label: 'Unsure: two takes of the intro, kept both' }]
  }
}

/** The example with one change made to it, by a function that may mutate the copy. */
function changed(edit: (l: Record<string, unknown> & EditList) => void): unknown {
  const l = structuredClone(example()) as Record<string, unknown> & EditList
  edit(l)
  return l
}

function refusal(raw: unknown): string {
  try {
    readEditList(raw)
  } catch (err) {
    expect(err).toBeInstanceOf(EditListError)
    return (err as Error).message
  }
  throw new Error('the list was read, and should have been refused')
}

describe('reading a valid edit list', () => {
  it('gives the list back unchanged', () => {
    expect(readEditList(example())).toEqual(example())
  })

  it('reads one with only what is required', () => {
    const minimal = { version: 1, shape: 'vertical', sources: [{ id: 'a', path: 'a.mp4', offsetSec: 0 }], main: 'a', sound: 'a', cuts: [], zooms: [], markers: [] }
    expect(readEditList(minimal)).toEqual(minimal)
  })

  it('reads text as well, as the file holds it', () => {
    expect(readEditList(JSON.stringify(example()))).toEqual(example())
  })

  it('takes the cuts in any order', () => {
    const l = changed((x) => x.cuts.reverse())
    expect(readEditList(l)).toEqual(l)
  })

  it('takes a half of a side-by-side recording for the main picture and for the corner', () => {
    const l = changed((x) => {
      x.view = 'left'
      x.corner!.view = 'right'
    })
    expect(readEditList(l)).toEqual(l)
  })

  it('takes another audio track of the sound source', () => {
    const l = changed((x) => {
      x.soundTrack = 2
    })
    expect(readEditList(l)).toEqual(l)
  })
})

describe('refusing a malformed edit list', () => {
  it('refuses text that is not JSON', () => {
    expect(refusal('{ "version": 1,')).toMatch(/not JSON/)
  })

  it('refuses anything that is not an object', () => {
    expect(refusal([])).toMatch(/an object/)
  })

  it('refuses another version', () => {
    expect(refusal(changed((x) => ((x as Record<string, unknown>).version = 3)))).toMatch(/^version:/)
  })

  it('refuses a shape Editbay does not have, naming the ones it does', () => {
    const m = refusal(changed((x) => (x.shape = 'widescreen')))
    expect(m).toMatch(/^shape:/)
    expect(m).toContain('landscape')
  })

  it('refuses a field it does not know, so a misspelt one is not lost', () => {
    expect(refusal(changed((x) => (x.zoom = [])))).toMatch(/^zoom: /)
    expect(refusal(changed((x) => ((x.cuts[0] as unknown as Record<string, unknown>).form = 1)))).toMatch(/^cuts\[0\]\.form: /)
  })

  it('refuses a missing list', () => {
    expect(refusal(changed((x) => delete (x as Partial<EditList>).cuts))).toMatch(/^cuts: /)
  })

  it('refuses no sources, a source without a path, and two sources with one id', () => {
    expect(refusal(changed((x) => (x.sources = [])))).toMatch(/^sources: /)
    expect(refusal(changed((x) => (x.sources[1]!.path = '')))).toMatch(/^sources\[1\]\.path: /)
    expect(refusal(changed((x) => (x.sources[1]!.id = 'screen')))).toMatch(/^sources\[1\]\.id: .*screen/)
  })

  it('refuses an offset that is not a number', () => {
    expect(refusal(changed((x) => ((x.sources[1] as unknown as Record<string, unknown>).offsetSec = '-2.35')))).toMatch(/^sources\[1\]\.offsetSec: /)
  })

  it('refuses a main source with an offset, since it is the clock the others are measured against', () => {
    expect(refusal(changed((x) => (x.sources[0]!.offsetSec = 1)))).toMatch(/^sources\[0\]\.offsetSec: /)
  })

  it('refuses a main, sound or corner source that is not among the sources', () => {
    expect(refusal(changed((x) => (x.main = 'webcam')))).toMatch(/^main: .*webcam/)
    expect(refusal(changed((x) => (x.sound = 'webcam')))).toMatch(/^sound: /)
    expect(refusal(changed((x) => (x.corner!.source = 'webcam')))).toMatch(/^corner\.source: /)
  })

  it('refuses the main source in its own corner', () => {
    expect(refusal(changed((x) => (x.corner!.source = 'screen')))).toMatch(/^corner\.source: /)
  })

  it('refuses a view that is not a half', () => {
    expect(refusal(changed((x) => ((x as Record<string, unknown>).view = 'middle')))).toMatch(/^view: .*left, right/)
    expect(refusal(changed((x) => ((x.corner as unknown as Record<string, unknown>).view = 'top')))).toMatch(/^corner\.view: /)
  })

  it('refuses a corner that is not one of the four', () => {
    expect(refusal(changed((x) => ((x.corner as unknown as Record<string, unknown>).at = 'centre')))).toMatch(/^corner\.at: /)
  })

  it('refuses a sound track that is not a whole number from 0', () => {
    expect(refusal(changed((x) => (x.soundTrack = 1.5)))).toMatch(/^soundTrack: /)
    expect(refusal(changed((x) => (x.soundTrack = -1)))).toMatch(/^soundTrack: /)
  })

  it('refuses a range that ends before it starts', () => {
    expect(refusal(changed((x) => (x.range = { fromSec: 10, toSec: 5 })))).toMatch(/^range: /)
    expect(refusal(changed((x) => (x.range = { fromSec: -1, toSec: 5 })))).toMatch(/^range\.fromSec: /)
  })

  it('refuses a cut that ends before it starts, or has no reason', () => {
    expect(refusal(changed((x) => (x.cuts[1]!.toSec = 40)))).toMatch(/^cuts\[1\]: /)
    expect(refusal(changed((x) => ((x.cuts[0] as unknown as Record<string, unknown>).why = 'boring')))).toMatch(/^cuts\[0\]\.why: /)
    expect(refusal(changed((x) => ((x.cuts[0] as unknown as Record<string, unknown>).fromSec = Number.NaN)))).toMatch(/^cuts\[0\]\.fromSec: /)
  })

  it('refuses two cuts that overlap, naming both', () => {
    const m = refusal(changed((x) => (x.cuts[0]!.toSec = 41)))
    expect(m).toMatch(/^cuts\[1\]: /)
    expect(m).toContain('cuts[0]')
  })

  it('refuses words or a mark of the wrong kind', () => {
    expect(refusal(changed((x) => ((x.cuts[1] as unknown as Record<string, unknown>).words = 3)))).toMatch(/^cuts\[1\]\.words: /)
    expect(refusal(changed((x) => ((x.cuts[1] as unknown as Record<string, unknown>).mark = 'yes')))).toMatch(/^cuts\[1\]\.mark: /)
  })

  it('refuses a zoom whose rectangle is not inside the picture, or is empty', () => {
    expect(refusal(changed((x) => (x.zooms[0]!.rect.x = 0.7)))).toMatch(/^zooms\[0\]\.rect: /)
    expect(refusal(changed((x) => (x.zooms[0]!.rect.w = 0)))).toMatch(/^zooms\[0\]\.rect\.w: /)
    expect(refusal(changed((x) => ((x.zooms[0]!.rect as unknown as Record<string, unknown>).y = null)))).toMatch(/^zooms\[0\]\.rect\.y: /)
  })

  it('refuses a zoom that is neither a cut nor smooth', () => {
    expect(refusal(changed((x) => ((x.zooms[0] as unknown as Record<string, unknown>).how = 'slow')))).toMatch(/^zooms\[0\]\.how: /)
  })

  it('refuses two zooms that overlap', () => {
    const m = refusal(changed((x) => x.zooms.push({ ...x.zooms[0]!, fromSec: 80, toSec: 90 })))
    expect(m).toMatch(/^zooms\[1\]: /)
    expect(m).toContain('zooms[0]')
  })

  it('refuses a marker with no label or no time', () => {
    expect(refusal(changed((x) => (x.markers[0]!.label = '  ')))).toMatch(/^markers\[0\]\.label: /)
    expect(refusal(changed((x) => delete (x.markers[0] as Partial<EditList['markers'][number]>).atSec))).toMatch(/^markers\[0\]\.atSec: /)
  })
})

/**
 * Plan 75. Version 2 holds reels, several recordings one after another, each
 * written as a version 1 list's body is, and shots, which change the framing
 * of a reel for a stretch.
 */
function reels(): EditListV2 {
  return {
    version: 2,
    shape: 'landscape',
    reels: [
      {
        sources: [
          { id: 'a', path: 'D:/OBS-recordings/one.mkv', offsetSec: 0 },
          { id: 'a-cam', path: 'D:/OBS-recordings/one.mkv', offsetSec: 0 }
        ],
        main: 'a',
        sound: 'a',
        soundTrack: 3,
        view: 'left',
        corner: { source: 'a-cam', at: 'bottom-right', view: 'right' },
        cuts: [{ fromSec: 1, toSec: 2, why: 'pause' }],
        zooms: [],
        markers: [],
        shots: [{ fromSec: 50, toSec: 58.5, view: 'right', corner: false, why: 'closing lines to camera', mark: true }]
      },
      {
        sources: [{ id: 'a', path: 'D:/OBS-recordings/two.mkv', offsetSec: 0 }],
        main: 'a',
        sound: 'a',
        cuts: [],
        zooms: [],
        markers: []
      }
    ]
  }
}

function changedReels(edit: (l: EditListV2) => void): unknown {
  const l = structuredClone(reels())
  edit(l)
  return l
}

describe('reading a version 2 edit list', () => {
  it('gives the list back unchanged', () => {
    expect(readEditList(reels())).toEqual(reels())
  })

  it('lets each reel use its own ids, the same as another reel\'s', () => {
    expect(readEditList(reels()).version).toBe(2)
  })

  it('refuses a list with no reels, or reels and a version 1 body together', () => {
    expect(refusal(changedReels((l) => (l.reels = [])))).toMatch(/^reels: /)
    expect(refusal(changedReels((l) => ((l as unknown as Record<string, unknown>).cuts = [])))).toMatch(/^cuts: /)
  })

  it('names the reel in a refusal from inside one', () => {
    expect(refusal(changedReels((l) => (l.reels[1]!.main = 'b')))).toMatch(/^reels\[1\]\.main: /)
    expect(refusal(changedReels((l) => (l.reels[0]!.cuts[0]!.toSec = 0.5)))).toMatch(/^reels\[0\]\.cuts\[0\]: /)
    expect(refusal(changedReels((l) => ((l.reels[0] as unknown as Record<string, unknown>).version = 1)))).toMatch(/^reels\[0\]\.version: /)
  })

  it('refuses shots that overlap, naming both', () => {
    const m = refusal(changedReels((l) => l.reels[0]!.shots!.push({ fromSec: 58, toSec: 60, view: 'left', why: 'back to the screen' })))
    expect(m).toMatch(/^reels\[0\]\.shots\[1\]: overlaps reels\[0\]\.shots\[0\]/)
  })

  it('refuses a shot that changes nothing, or has no reason', () => {
    expect(refusal(changedReels((l) => (l.reels[0]!.shots = [{ fromSec: 1, toSec: 2, why: 'nothing' }])))).toMatch(/^reels\[0\]\.shots\[0\]: .*view, or corner: false/)
    expect(refusal(changedReels((l) => (l.reels[0]!.shots = [{ fromSec: 1, toSec: 2, corner: true, why: 'shown anyway' }])))).toMatch(/^reels\[0\]\.shots\[0\]: changes nothing/)
    expect(refusal(changedReels((l) => delete (l.reels[0]!.shots![0] as Partial<NonNullable<EditListV2['reels'][number]['shots']>[number]>).why))).toMatch(/^reels\[0\]\.shots\[0\]\.why: /)
  })

  it('refuses a shot that hides a corner the reel does not have', () => {
    expect(refusal(changedReels((l) => (l.reels[1]!.shots = [{ fromSec: 1, toSec: 2, corner: false, why: 'x' }])))).toMatch(/^reels\[1\]\.shots\[0\]\.corner: /)
  })

  it('refuses a shot view that is not a half', () => {
    expect(refusal(changedReels((l) => ((l.reels[0]!.shots![0] as unknown as Record<string, unknown>).view = 'top')))).toMatch(/^reels\[0\]\.shots\[0\]\.view: /)
  })

  it('refuses shots in a version 1 list, which has no reels to hold them', () => {
    expect(refusal(changed((x) => ((x as Record<string, unknown>).shots = [])))).toMatch(/^shots: /)
  })
})
