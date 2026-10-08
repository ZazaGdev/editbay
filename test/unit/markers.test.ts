import { describe, it, expect } from 'vitest'
import {
  addMarker,
  chapterMarkers,
  cleanMarkers,
  colourMarker,
  inOrder,
  markerAt,
  moveMarker,
  nextMarker,
  previousMarker,
  removeMarker,
  renameMarker,
  type Marker
} from '../../src/shared/markers'

/**
 * Plan 27. A note left on a frame of the sequence, so a moment worth
 * keeping can be found again. Pure, so where a key lands you and what a stored
 * file gives back are tested without a window.
 */

/** A list built by dropping markers at these frames, in this order. */
function at(...frames: number[]): Marker[] {
  return frames.reduce<Marker[]>((markers, f) => addMarker(markers, f), [])
}

const frames = (markers: readonly Marker[]): number[] => markers.map((m) => m.frame)

describe('dropping a marker', () => {
  it('puts one on the frame asked for', () => {
    expect(frames(at(120))).toEqual([120])
  })

  it('keeps them in the order they are drawn and jumped through', () => {
    expect(frames(at(300, 60, 180))).toEqual([60, 180, 300])
  })

  it('leaves a frame that already has one alone rather than stacking a second on it', () => {
    const one = at(120)
    const again = addMarker(one, 120)
    expect(again).toHaveLength(1)
    expect(again[0]!.id).toBe(one[0]!.id)
  })

  it('lands on a whole frame, and never before the start', () => {
    expect(frames(at(12.6))).toEqual([13])
    expect(frames(at(-40))).toEqual([0])
  })

  it('takes a name when one is given, and none when it is not', () => {
    expect(addMarker([], 30, 'the good bit')[0]!.name).toBe('the good bit')
    expect(at(30)[0]!.name).toBe('')
  })

  it('never changes the list it was given', () => {
    const before = at(60)
    addMarker(before, 120)
    expect(before).toHaveLength(1)
  })
})

describe('moving a marker', () => {
  it('takes it to the frame asked for and keeps the order', () => {
    const markers = at(60, 180)
    const moved = moveMarker(markers, markers[0]!.id, 300)
    expect(frames(moved)).toEqual([180, 300])
  })

  it('refuses to land on a frame another one already holds', () => {
    const markers = at(60, 180)
    expect(frames(moveMarker(markers, markers[0]!.id, 180))).toEqual([60, 180])
  })

  it('lets one stay exactly where it is', () => {
    const markers = at(60)
    expect(frames(moveMarker(markers, markers[0]!.id, 60))).toEqual([60])
  })
})

describe('naming, colouring and removing', () => {
  it('takes a name and drops the space around it', () => {
    const markers = at(60)
    expect(renameMarker(markers, markers[0]!.id, '  frag out  ')[0]!.name).toBe('frag out')
  })

  it('reads a name of nothing but spaces as no name at all', () => {
    const markers = at(60)
    expect(renameMarker(markers, markers[0]!.id, '   ')[0]!.name).toBe('')
  })

  it('takes one of the colours a clip can be marked with', () => {
    const markers = at(60)
    expect(colourMarker(markers, markers[0]!.id, 'amber')[0]!.colour).toBe('amber')
  })

  it('leaves no colour behind rather than an unknown one', () => {
    const markers = colourMarker(at(60), at(60)[0]!.id, 'chartreuse')
    expect(markers[0]).not.toHaveProperty('colour')
  })

  it('takes a colour off again', () => {
    const one = at(60)
    const amber = colourMarker(one, one[0]!.id, 'amber')
    expect(colourMarker(amber, one[0]!.id, undefined)[0]).not.toHaveProperty('colour')
  })

  it('removes the one named and nothing else', () => {
    const markers = at(60, 180)
    expect(frames(removeMarker(markers, markers[0]!.id))).toEqual([180])
  })
})

describe('jumping between markers', () => {
  const markers = at(60, 180, 300)

  it('goes to the next one after where you are', () => {
    expect(nextMarker(markers, 0)?.frame).toBe(60)
    expect(nextMarker(markers, 60)?.frame).toBe(180)
  })

  it('goes to the last one before where you are', () => {
    expect(previousMarker(markers, 300)?.frame).toBe(180)
    expect(previousMarker(markers, 181)?.frame).toBe(180)
  })

  it('says there is nowhere to go rather than standing still on the one you are on', () => {
    expect(nextMarker(markers, 300)).toBeNull()
    expect(previousMarker(markers, 60)).toBeNull()
    expect(nextMarker([], 0)).toBeNull()
    expect(previousMarker([], 500)).toBeNull()
  })

  it('finds the one on a frame', () => {
    expect(markerAt(markers, 180)?.frame).toBe(180)
    expect(markerAt(markers, 181)).toBeNull()
  })
})

describe('reading stored markers back', () => {
  it('keeps a list that is already right', () => {
    const stored = [
      { id: 'a', frame: 300, name: 'end', colour: 'blue' },
      { id: 'b', frame: 60, name: 'start' }
    ]
    expect(cleanMarkers(stored)).toEqual([
      { id: 'b', frame: 60, name: 'start' },
      { id: 'a', frame: 300, name: 'end', colour: 'blue' }
    ])
  })

  it('gives nothing back for a file that has none, and never throws', () => {
    for (const junk of [undefined, null, 'markers', 42, {}, true]) {
      expect(() => cleanMarkers(junk)).not.toThrow()
      expect(cleanMarkers(junk)).toEqual([])
    }
  })

  it('drops an entry that is not a marker rather than losing the rest', () => {
    expect(frames(cleanMarkers([{ frame: 60 }, null, 'no', { name: 'no frame' }, { frame: 'late' }, { frame: 180 }]))).toEqual([60, 180])
  })

  it('keeps one marker per frame, whatever a hand-edited file says', () => {
    expect(frames(cleanMarkers([{ frame: 60 }, { frame: 60 }, { frame: 60.4 }]))).toEqual([60])
  })

  it('gives a marker an id when the file has none for it', () => {
    const [marker] = cleanMarkers([{ frame: 60 }])
    expect(marker!.id).toBeTruthy()
  })

  it('drops a colour the app does not have', () => {
    expect(cleanMarkers([{ frame: 60, colour: 'chartreuse' }])[0]).not.toHaveProperty('colour')
  })
})

describe('inOrder', () => {
  it('breaks a tie the same way every time, so nothing jitters', () => {
    const a: Marker = { id: 'a', frame: 60, name: '' }
    const b: Marker = { id: 'b', frame: 60, name: '' }
    expect(inOrder([b, a]).map((m) => m.id)).toEqual(['a', 'b'])
    expect(inOrder([a, b]).map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('a recording\'s chapters as markers', () => {
  const whole = [{ sourceIn: 0, sourceOut: 900, timelineStart: 0 }]

  it('puts one on the frame the chapter falls on', () => {
    const made = chapterMarkers([], [{ atSec: 4, title: 'the good bit' }], whole, 30)
    expect(made).toEqual([{ id: expect.any(String), frame: 120, name: 'the good bit' }])
  })

  it('places it through the clip, not from the start of the sequence', () => {
    // The clip shows the recording from 10 seconds on, and sits 2 seconds in.
    const clips = [{ sourceIn: 300, sourceOut: 900, timelineStart: 60 }]
    // A chapter 12 seconds into the recording is 2 seconds into the clip.
    expect(chapterMarkers([], [{ atSec: 12, title: '' }], clips, 30).map((m) => m.frame)).toEqual([120])
  })

  it('leaves out a chapter the cut has thrown away', () => {
    const clips = [{ sourceIn: 300, sourceOut: 600, timelineStart: 0 }]
    const chapters = [{ atSec: 2, title: 'before' }, { atSec: 12, title: 'inside' }, { atSec: 25, title: 'after' }]
    expect(chapterMarkers([], chapters, clips, 30).map((m) => m.name)).toEqual(['inside'])
  })

  it('gives a recording used twice two markers for one chapter', () => {
    const clips = [
      { sourceIn: 0, sourceOut: 300, timelineStart: 0 },
      { sourceIn: 0, sourceOut: 300, timelineStart: 600 }
    ]
    expect(chapterMarkers([], [{ atSec: 2, title: 'twice' }], clips, 30).map((m) => m.frame)).toEqual([60, 660])
  })

  it('counts from where the recording own time starts, not from zero', () => {
    // Sound that begins 0.5 s before the picture puts every chapter 15 frames out at 30 fps.
    expect(chapterMarkers([], [{ atSec: 4.5 }].map((c) => ({ ...c, title: '' })), whole, 30, 0.5).map((m) => m.frame)).toEqual([120])
  })

  it('keeps the markers that were already there', () => {
    const had = addMarker([], 600, 'mine')
    const made = chapterMarkers(had, [{ atSec: 4, title: 'theirs' }], whole, 30)
    expect(made.map((m) => m.name)).toEqual(['theirs', 'mine'])
  })

  it('changes nothing the second time the same chapters are brought in', () => {
    const chapters = [{ atSec: 4, title: 'once' }, { atSec: 9, title: 'twice' }]
    const once = chapterMarkers([], chapters, whole, 30)
    const again = chapterMarkers(once, chapters, whole, 30)
    expect(again.map((m) => m.frame)).toEqual(once.map((m) => m.frame))
    expect(again.map((m) => m.id)).toEqual(once.map((m) => m.id))
  })

  it('gives nothing back for a recording with no chapters, or one not on the timeline', () => {
    expect(chapterMarkers([], [], whole, 30)).toEqual([])
    expect(chapterMarkers([], [{ atSec: 4, title: 'x' }], [], 30)).toEqual([])
  })

  it('survives a rate of nothing rather than working out a frame from it', () => {
    expect(chapterMarkers([], [{ atSec: 4, title: 'x' }], whole, 0)).toEqual([])
  })
})
