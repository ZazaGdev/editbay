import { describe, it, expect } from 'vitest'
import {
  ALIGNMENTS,
  PICTURE_KINDS,
  transitionFamilies,
  DEFAULT_SOUND_KIND,
  alignmentOf,
  aligned,
  blends,
  cleanTransition,
  curveGain,
  fadeGainAt,
  heldFrames,
  heldInWindow,
  resolvedKind,
  shownSpan,
  shownSpans,
  tidyTransition,
  transitionWindows,
  washAt,
  washColour,
  washOver,
  type Transition,
  type Transitioned
} from '../../src/shared/transitions'
import { blendFilters } from '../../src/shared/render-overlays'

/**
 * Plan 29. A transition is a window over a seam, and both clips it touches are
 * shown past their own edge inside it. Pure, so the arithmetic the drawing,
 * the export and the preview must agree on is tested without a window.
 */

/** A clip a hundred frames long at `start`, reading its recording from `sourceIn`. */
function clip(id: string, start: number, length = 100, sourceIn = 500): Transitioned {
  return { id, mediaId: 'm', sourceIn, sourceOut: sourceIn + length, timelineStart: start }
}

function put(c: Transitioned, side: 'in' | 'out', t: Partial<Transition> & { kind?: string }): Transitioned {
  const whole: Transition = { kind: t.kind ?? 'dissolve', length: t.length ?? 30, before: t.before ?? 15 }
  return side === 'in' ? { ...c, transitionIn: whole } : { ...c, transitionOut: whole }
}

describe('alignment, read back out of the offset', () => {
  it('names the three Premiere has', () => {
    expect(alignmentOf({ kind: 'dissolve', length: 30, before: 15 })).toBe('centre')
    expect(alignmentOf({ kind: 'dissolve', length: 30, before: 30 })).toBe('beforeCut')
    expect(alignmentOf({ kind: 'dissolve', length: 30, before: 0 })).toBe('afterCut')
  })

  it('calls anything else nothing, which the menu shows as Custom', () => {
    expect(alignmentOf({ kind: 'dissolve', length: 30, before: 7 })).toBeNull()
  })

  it('puts one on an alignment and reads the same one back', () => {
    const t: Transition = { kind: 'dissolve', length: 45, before: 7 }
    for (const a of ALIGNMENTS) expect(alignmentOf(aligned(t, a.id))).toBe(a.id)
  })

  it('centres an odd length without leaving the alignment unreadable', () => {
    expect(alignmentOf(aligned({ kind: 'dissolve', length: 31, before: 0 }, 'centre'))).toBe('centre')
  })
})

describe('a transition made safe on its own', () => {
  it('never comes out shorter than a frame', () => {
    expect(tidyTransition({ kind: 'dissolve', length: 0, before: 0 }).length).toBe(1)
    expect(tidyTransition({ kind: 'dissolve', length: -9, before: 0 }).length).toBe(1)
  })

  it('holds the offset inside the length', () => {
    expect(tidyTransition({ kind: 'dissolve', length: 10, before: 40 }).before).toBe(10)
    expect(tidyTransition({ kind: 'dissolve', length: 10, before: -3 }).before).toBe(0)
  })

  it('reads a stored one back, and gives back nothing for anything that is not one', () => {
    expect(cleanTransition({ kind: 'dissolve', length: 30, before: 15 }, 'picture')).toEqual({
      kind: 'dissolve',
      length: 30,
      before: 15
    })
    expect(cleanTransition(null, 'picture')).toBeUndefined()
    expect(cleanTransition({ kind: 'dissolve' }, 'picture')).toBeUndefined()
    expect(cleanTransition({ kind: 'dissolve', length: 'long', before: 0 }, 'picture')).toBeUndefined()
  })

  it('keeps a transition whose kind this build does not have, on the default kind', () => {
    const read = cleanTransition({ kind: 'kaleidoscope', length: 30, before: 15 }, 'sound')
    expect(read?.kind).toBe(DEFAULT_SOUND_KIND)
    expect(read?.length).toBe(30)
  })
})

describe('the kind that actually gets drawn', () => {
  it('leaves a blend alone where there is a clip on the other side', () => {
    expect(resolvedKind('dissolve', 'picture', true)).toBe('dissolve')
  })

  it('falls back to a dip to black where there is not', () => {
    expect(resolvedKind('dissolve', 'picture', false)).toBe('toBlack')
    expect(resolvedKind('pushLeft', 'picture', false)).toBe('toBlack')
  })

  it('leaves a dip alone either way, because it needs nobody', () => {
    expect(resolvedKind('toWhite', 'picture', false)).toBe('toWhite')
    expect(washColour('toWhite')).toBe('white')
    expect(washColour('dissolve')).toBeNull()
  })

  it('leaves a sound curve alone, because a curve needs nobody either', () => {
    expect(resolvedKind('smooth', 'sound', false)).toBe('smooth')
  })
})

describe('the window over a seam', () => {
  const track = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15 })]

  it('straddles the cut where the alignment puts it', () => {
    const [w] = transitionWindows(track, 'picture')
    expect(w).toMatchObject({ clipId: 'b', side: 'in', cut: 100, from: 85, to: 115 })
  })

  it('names the clip on each side of it, whichever one stores it', () => {
    const [w] = transitionWindows(track, 'picture')
    expect(w?.fromClipId).toBe('a')
    expect(w?.toClipId).toBe('b')
    expect(blends(w!)).toBe(true)
  })

  it('stretches both clips, not only the one that stores it', () => {
    const shown = shownSpans(track, 'picture')
    expect(shown.get('a')).toEqual({ from: 0, to: 115 })
    expect(shown.get('b')).toEqual({ from: 85, to: 200 })
  })

  it('leaves a clip with no transition on it exactly as long as it was', () => {
    const shown = shownSpans([clip('a', 0), clip('b', 100)], 'picture')
    expect(shown.get('a')).toEqual({ from: 0, to: 100 })
    expect(shown.get('b')).toEqual({ from: 100, to: 200 })
  })

  it('has nothing on the other side where the clips do not touch', () => {
    const [w] = transitionWindows([clip('a', 0), put(clip('b', 140), 'in', { length: 30, before: 15 })], 'picture')
    expect(w?.fromClipId).toBeNull()
    expect(w?.kind).toBe('toBlack')
  })

  it('has nothing on the other side at the very start of the sequence', () => {
    const [w] = transitionWindows([put(clip('a', 0), 'in', { length: 30, before: 15 })], 'picture')
    expect(w).toMatchObject({ from: 0, to: 15, fromClipId: null, toClipId: 'a' })
  })

  it('hangs off the end of the last clip, which is what makes the sequence longer', () => {
    const one = put(clip('a', 0), 'out', { length: 30, before: 15, kind: 'toBlack' })
    expect(shownSpan([one], one, 'picture')).toEqual({ from: 0, to: 115 })
  })
})

describe('a dip through a colour, which never wants two pictures at once', () => {
  const track = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15, kind: 'toBlack' })]

  it('hands the picture over in the middle of the window', () => {
    const [w] = transitionWindows(track, 'picture')
    expect(w?.splitAt).toBe(100)
    expect(blends(w!)).toBe(false)
  })

  it('hands over on the cut when more of it falls after, so it is darkest on the cut (task 1092)', () => {
    // The owner's own: 22 frames, 9 before the cut.
    const off = [clip('a', 0), put(clip('b', 100), 'in', { length: 22, before: 9, kind: 'toBlack' })]
    const [w] = transitionWindows(off, 'picture')
    expect(w).toMatchObject({ from: 91, to: 113, splitAt: 100 })
    expect(washAt(w!, 100)).toBe(1)
    expect(washAt(w!, 99)).toBeLessThan(1)
    expect(washAt(w!, 101)).toBeLessThan(1)
    const shown = shownSpans(off, 'picture')
    expect(shown.get('a')?.to).toBe(100)
    expect(shown.get('b')?.from).toBe(100)
  })

  it('puts the same colour over both clips of a dip, whichever the preview draws (task 1092)', () => {
    const late = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 0, kind: 'toBlack' })]
    const windows = transitionWindows(late, 'picture')
    // Handed over at 115, the second clip is already on the players from the cut.
    expect(washOver(windows, 'a', 105)).toEqual(washOver(windows, 'b', 105))
    expect(washOver(windows, 'b', 105)!.alpha).toBeCloseTo(5 / 15, 6)
  })

  it('shows the first clip up to the handover and the second from it', () => {
    const shown = shownSpans(track, 'picture')
    expect(shown.get('a')?.to).toBe(100)
    expect(shown.get('b')?.from).toBe(100)
  })

  it('hands over in the middle of the window and not at the cut', () => {
    const early = [clip('a', 0), put(clip('b', 100), 'in', { length: 40, before: 40, kind: 'toBlack' })]
    const [w] = transitionWindows(early, 'picture')
    expect(w).toMatchObject({ from: 60, to: 100, splitAt: 80 })
    expect(shownSpans(early, 'picture').get('b')?.from).toBe(80)
  })

  it('has no handover where there is only one picture to show', () => {
    const [w] = transitionWindows([put(clip('a', 0), 'out', { length: 30, before: 15, kind: 'toBlack' })], 'picture')
    expect(w?.splitAt).toBeNull()
  })

  it('goes to the colour and comes back, which is what xfade does', () => {
    const [w] = transitionWindows(track, 'picture')
    expect(washAt(w!, 85)).toBe(0)
    expect(washAt(w!, 100)).toBe(1)
    expect(washAt(w!, 92)).toBeCloseTo(7 / 15, 6)
    expect(washAt(w!, 107)).toBeCloseTo(1 - 7 / 15, 6)
    expect(washAt(w!, 200)).toBe(0)
  })

  it('goes one way only where there is nothing on the other side', () => {
    const [out] = transitionWindows([put(clip('a', 0), 'out', { length: 20, before: 20, kind: 'toBlack' })], 'picture')
    expect(washAt(out!, 80)).toBe(0)
    expect(washAt(out!, 90)).toBeCloseTo(0.5, 6)
    const [into] = transitionWindows([put(clip('a', 0), 'in', { length: 20, before: 0, kind: 'toBlack' })], 'picture')
    expect(washAt(into!, 0)).toBe(1)
    expect(washAt(into!, 10)).toBeCloseTo(0.5, 6)
  })

  it('flashes: stays on the picture until the last quarter before the cut, then fades back as a dip does (plan 95)', () => {
    const flash = [clip('a', 0), put(clip('b', 100), 'in', { length: 40, before: 20, kind: 'flash' })]
    const [w] = transitionWindows(flash, 'picture')
    expect(w).toMatchObject({ from: 80, to: 120, splitAt: 100 })
    expect(washAt(w!, 90)).toBe(0)
    expect(washAt(w!, 95)).toBe(0)
    expect(washAt(w!, 98)).toBeCloseTo((0.9 - 0.75) / 0.25, 6)
    expect(washAt(w!, 100)).toBe(1)
    expect(washAt(w!, 110)).toBeCloseTo(0.5, 6)
    // With nothing after it, it still goes white late.
    const [end] = transitionWindows([put(clip('a', 0), 'out', { length: 20, before: 20, kind: 'flash' })], 'picture')
    expect(washAt(end!, 90)).toBe(0)
    expect(washAt(end!, 98)).toBeCloseTo(0.6, 6)
  })

  it('lays no colour over a blend, which mixes the two pictures instead', () => {
    const [w] = transitionWindows([clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15 })], 'picture')
    expect(washAt(w!, 100)).toBe(0)
  })
})

describe('the clamps, which are applied every time the window is read', () => {
  it('never reaches past the far end of the clip that stores it', () => {
    const [w] = transitionWindows([put(clip('a', 0, 10), 'in', { length: 40, before: 0 })], 'picture')
    expect(w).toMatchObject({ from: 0, to: 10 })
  })

  it('never reaches past the far end of the clip it joins', () => {
    const track = [clip('a', 0, 10, 0), put(clip('b', 10), 'in', { length: 40, before: 40 })]
    const [w] = transitionWindows(track, 'picture')
    expect(w?.from).toBe(0)
  })

  it('shrinks when a neighbour is trimmed later, and grows back when it is undone', () => {
    const long = [clip('a', 0, 100, 0), put(clip('b', 100), 'in', { length: 60, before: 60 })]
    expect(transitionWindows(long, 'picture')[0]?.from).toBe(40)
    // The same stored transition, over a clip cut down to twenty frames.
    const short = [clip('a', 80, 20, 80), put(clip('b', 100), 'in', { length: 60, before: 60 })]
    expect(transitionWindows(short, 'picture')[0]?.from).toBe(80)
    expect(transitionWindows(long, 'picture')[0]?.from).toBe(40)
  })

  it('never covers a clip it does not join', () => {
    // A fade to black on a clip with another right after it: it cannot reach
    // over that one, because the one it dips is this one.
    const track = [put(clip('a', 0), 'out', { length: 30, before: 15, kind: 'toBlack' }), put(clip('b', 100), 'in', { length: 10, before: 5 })]
    const [first] = transitionWindows(track, 'picture')
    expect(first?.to).toBe(100)
    expect(first?.fromClipId).toBe('a')
    expect(first?.toClipId).toBeNull()
  })

  it('puts two fades at one seam on their own sides of the cut', () => {
    const track = [
      put(clip('a', 0), 'out', { length: 30, before: 15, kind: 'toBlack' }),
      put(clip('b', 100), 'in', { length: 30, before: 15, kind: 'toBlack' })
    ]
    const [out, into] = transitionWindows(track, 'picture')
    expect(out).toMatchObject({ from: 85, to: 100, toClipId: null })
    expect(into).toMatchObject({ from: 100, to: 115, fromClipId: null })
    expect(alignmentOf({ ...out!.stored, length: out!.to - out!.from, before: out!.to - out!.from })).toBe('beforeCut')
  })

  it('never starts before the sequence does', () => {
    const [w] = transitionWindows([put(clip('a', 5), 'in', { length: 40, before: 40 })], 'picture')
    expect(w?.from).toBe(0)
  })

  it('keeps at least one frame however hard it is squeezed', () => {
    const track = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 30, kind: 'toBlack' }), clip('c', 200)]
    const squeezed = [put(track[0]!, 'out', { length: 30, before: 0, kind: 'toBlack' }), track[1]!, track[2]!]
    for (const w of transitionWindows(squeezed, 'picture')) expect(w.to - w.from).toBeGreaterThanOrEqual(1)
  })

  it('lets two fades meet in a gap without sharing a frame', () => {
    const track = [
      put(clip('a', 0), 'out', { length: 60, before: 0, kind: 'toBlack' }),
      put(clip('b', 160), 'in', { length: 60, before: 60, kind: 'toBlack' })
    ]
    const [first, second] = transitionWindows(track, 'picture')
    expect(first?.to).toBeLessThanOrEqual(second!.from)
  })
})

describe('sound', () => {
  const track = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15, kind: 'even' })]
  const windows = transitionWindows(track, 'sound')

  it('overlaps both sounds over the whole window, so neither drops out', () => {
    const shown = shownSpans(track, 'sound')
    expect(shown.get('a')?.to).toBe(115)
    expect(shown.get('b')?.from).toBe(85)
  })

  it('brings one down as it brings the other up', () => {
    expect(fadeGainAt(windows, 'a', 85)).toBeCloseTo(1, 6)
    expect(fadeGainAt(windows, 'b', 85)).toBeCloseTo(0, 6)
    expect(fadeGainAt(windows, 'a', 114)).toBeLessThan(0.1)
    expect(fadeGainAt(windows, 'b', 114)).toBeGreaterThan(0.9)
  })

  it('holds the loudness through the middle of an even crossfade', () => {
    for (const frame of [88, 94, 100, 106, 112]) {
      const out = fadeGainAt(windows, 'a', frame)
      const into = fadeGainAt(windows, 'b', frame)
      expect(out * out + into * into).toBeCloseTo(1, 6)
    }
  })

  it('dips in the middle on a linear one, which is the point of having both', () => {
    const linear = transitionWindows([clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15, kind: 'linear' })], 'sound')
    const middle = fadeGainAt(linear, 'a', 100) + fadeGainAt(linear, 'b', 100)
    expect(middle).toBeCloseTo(1, 6)
  })

  it('leaves a sound alone anywhere no fade covers it', () => {
    expect(fadeGainAt(windows, 'a', 20)).toBe(1)
    expect(fadeGainAt(windows, 'b', 150)).toBe(1)
  })

  it('matches ffmpeg on the curves it names', () => {
    expect(curveGain('tri', 0.25)).toBeCloseTo(0.25, 6)
    expect(curveGain('qsin', 0.5)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(curveGain('exp', 1)).toBeCloseTo(1, 6)
    expect(curveGain('exp', 0)).toBeCloseTo(0.00001, 9)
  })
})

describe('footage that runs out, which Premiere fills with a held frame', () => {
  it('counts nothing held where the recording has frames to spare', () => {
    const track = [clip('a', 0), put(clip('b', 100), 'in', { length: 30, before: 15 })]
    const shown = shownSpans(track, 'picture')
    expect(heldFrames(track[0]!, shown.get('a')!, 900)).toEqual({ head: 0, tail: 0 })
    expect(heldFrames(track[1]!, shown.get('b')!, 900)).toEqual({ head: 0, tail: 0 })
  })

  it('counts each end against the clip actually shown there, not against the one that stores it', () => {
    // The outgoing clip is used to its last frame and the incoming one from its
    // first, so a window at the cut has nothing behind it at either end.
    const track = [clip('a', 0, 100, 0), put(clip('b', 100, 100, 0), 'in', { length: 30, before: 15 })]
    const [w] = transitionWindows(track, 'picture')
    const held = heldInWindow(track, 'picture', w!, () => 100)
    expect(held).toEqual({ head: 15, tail: 15 })
  })

  it('counts nothing held where both clips have footage to spare', () => {
    const track = [clip('a', 0, 100, 500), put(clip('b', 100, 100, 500), 'in', { length: 30, before: 15 })]
    const [w] = transitionWindows(track, 'picture')
    expect(heldInWindow(track, 'picture', w!, () => 900)).toEqual({ head: 0, tail: 0 })
  })

  it('counts the frames with nothing behind them at each end', () => {
    // Ten frames of the recording before the cut, and a window reaching back fifteen.
    const track = [clip('a', 0, 100, 0), put(clip('b', 100, 100, 10), 'in', { length: 30, before: 15 })]
    const shown = shownSpans(track, 'picture')
    expect(heldFrames(track[1]!, shown.get('b')!, 900).head).toBe(5)
    // The recording ends five frames past the outgoing clip's own last frame.
    expect(heldFrames(track[0]!, shown.get('a')!, 105).tail).toBe(10)
  })
})

describe('the picture kinds as the menu offers them', () => {
  it('lists a kind that comes in several directions once, with its four', () => {
    const listed = transitionFamilies()
    const wipe = listed.find((x) => 'family' in x && x.family === 'Wipe')
    expect(wipe && 'kinds' in wipe ? wipe.kinds.map((k) => k.direction) : []).toEqual(['left', 'right', 'up', 'down'])
    for (const family of ['Push', 'Cover', 'Reveal']) {
      const f = listed.find((x) => 'family' in x && x.family === family)
      expect(f && 'kinds' in f ? f.kinds.length : 0).toBe(4)
    }
    // Every kind is in it once, and one with no direction on its own.
    const ids = listed.flatMap((x) => ('kind' in x ? [x.kind.id] : x.kinds.map((k) => k.id)))
    expect(ids.sort()).toEqual(PICTURE_KINDS.map((k) => k.id).sort())
    expect(listed.some((x) => 'kind' in x && x.kind.id === 'circleOpen')).toBe(true)
  })

  it('renders each kind its own way: an xfade name of its own, or its own filters laid on one, or a late start (plan 95)', () => {
    const at = { leadSec: 0, durSec: 1 }
    const ways = PICTURE_KINDS.map((k) => `${k.xfade}|${JSON.stringify(blendFilters(k.id, at, 30, 1080, false))}|${k.late ?? 0}`)
    expect(new Set(ways).size).toBe(ways.length)
  })
})
