import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, framingOf, setFraming, type Framing, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { framingEditedClip, lastFramingFor, lastFramingOf } from '../../src/shared/last-framing'

/** Plan 93: the framing used last, given or offered to a recording put on a project where nothing is framed yet. */

function media(id: string, width = 1920, height = 1080, still = false): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width,
    height,
    fps: 30,
    codec: 'h264',
    hasAudio: !still,
    peaksPath: '',
    filmstripPath: '',
    ...(still ? { still: true } : {})
  }
}

/** A landscape sequence holding the recordings named, one after another on V1. */
function holding(...items: [string, ProjectMedia][]): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }), media: items.map(([, m]) => m) }
  for (const [clipId, m] of items) t = addClip(t, m.id, clipId)
  return t
}

/** A framing made on a 1920x1080 recording: in a box in the top left rather than filling the frame. */
function made(): Framing {
  const t = holding(['x', media('x')])
  return { ...framingOf(t, 'x')!, place: { x: 0.05, y: 0.05, w: 0.5, h: 0.5 } }
}

describe('the last framing, for a recording just put on the timeline', () => {
  it('is given to a recording the same size as the one it was made on, where nothing is framed yet', () => {
    expect(lastFramingFor(holding(['c', media('a')]), 'c', made())).toBe('apply')
  })

  it('is offered to a recording of another size', () => {
    expect(lastFramingFor(holding(['c', media('a', 2560, 1440)]), 'c', made())).toBe('offer')
  })

  it('is neither without one, nor for an image laid over the footage', () => {
    expect(lastFramingFor(holding(['c', media('a')]), 'c', null)).toBeNull()
    expect(lastFramingFor(holding(['c', media('p', 1920, 1080, true)]), 'c', made())).toBeNull()
  })

  it('leaves a project alone once a recording in it is framed some other way', () => {
    const t = holding(['b', media('b')], ['c', media('a')])
    const other = setFraming(t, 'b', { ...made(), place: { x: 0.4, y: 0.4, w: 0.6, h: 0.6 } })
    expect(lastFramingFor(other, 'c', made())).toBeNull()
  })

  it('goes on to every recording it was given to and that still carries it, as an episode recorded as several files', () => {
    const t = holding(['b', media('b')], ['c', media('a', 2560, 1440)])
    const first = setFraming(t, 'b', made())
    expect(lastFramingFor(first, 'c', made(), new Set(['b']))).toBe('offer')
    // Given to a recording of another size, its crops are scaled, and it still counts as carried.
    const scaled = setFraming(holding(['b', media('b', 2560, 1440)], ['c', media('a')]), 'b', made())
    expect(lastFramingFor(scaled, 'c', made(), new Set(['b']))).toBe('apply')
  })

  it('stops once a recording is framed by hand, even the same way', () => {
    const t = setFraming(holding(['b', media('b')], ['c', media('a')]), 'b', made())
    expect(lastFramingFor(t, 'c', made())).toBeNull()
    // Given it, then framed again by hand.
    const changed = setFraming(t, 'b', { ...made(), place: { x: 0.4, y: 0.4, w: 0.6, h: 0.6 } })
    expect(lastFramingFor(changed, 'c', made(), new Set(['b']))).toBeNull()
  })

  it('is not given to a recording already framed, as one put down with a background taken out and framed after', () => {
    const t = setFraming(holding(['c', media('a')]), 'c', { ...made(), place: { x: 0.4, y: 0.4, w: 0.6, h: 0.6 } })
    expect(lastFramingFor(t, 'c', made())).toBeNull()
  })
})

describe('what is remembered as the last framing', () => {
  it('is a recording clip’s framing, never an image’s', () => {
    expect(lastFramingOf(holding(['c', media('a')]), 'c')).not.toBeNull()
    expect(lastFramingOf(holding(['c', media('p', 1920, 1080, true)]), 'c')).toBeNull()
  })

  it('comes from the edits that frame a clip, through a selection of several too, and not from the others', () => {
    expect(framingEditedClip({ kind: 'setPlace', clipId: 'c', picture: 'main', place: { x: 0, y: 0, w: 1, h: 1 }, reshapeCrop: false })).toBe('c')
    expect(framingEditedClip({ kind: 'setFramingOn', clipIds: ['d', 'e'], framing: made() })).toBe('d')
    expect(framingEditedClip({ kind: 'onSelected', edit: { kind: 'applyLayout', clipId: 'c', layout: 'pip' }, also: ['d'] })).toBe('c')
    expect(framingEditedClip({ kind: 'setLook', clipId: 'c', look: 'mono' })).toBeNull()
  })
})
