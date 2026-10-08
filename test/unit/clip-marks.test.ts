import { describe, it, expect } from 'vitest'
import { marksFit, pictureMarks, soundMarks } from '../../src/shared/clip-marks'
import { FULL_PLACE } from '../../src/shared/layout'
import type { Clip, SoundClip } from '../../src/shared/project'

/** Item 17: the marks on a clip's name strip, one for each kind of thing done to it. */

const crop = { x: 0, y: 0, w: 1920, h: 1080 }
const picture = (over: Partial<Clip> = {}, transform: Partial<Clip['transform']> = {}): Clip => ({
  id: 'c',
  mediaId: 'm',
  sourceIn: 0,
  sourceOut: 300,
  timelineStart: 0,
  transform: { mode: 'crop', crop, place: FULL_PLACE, ...transform },
  layers: [],
  layout: 'single',
  ...over
})
const sound = (over: Partial<SoundClip> = {}): SoundClip => ({
  id: 's', mediaId: 'm', track: 0, sourceIn: 0, sourceOut: 300, timelineStart: 0, gain: 1, muted: false, ...over
})

describe('the marks on a clip', () => {
  it('are none on a clip nothing has been done to', () => {
    expect(pictureMarks(picture())).toEqual([])
    expect(soundMarks(sound())).toEqual([])
  })

  it('say it zooms only when its keyframes really move the picture', () => {
    const still = picture({}, { keys: [{ at: 0, crop }, { at: 30, crop }] })
    expect(pictureMarks(still)).toEqual([])
    const zooms = picture({}, { keys: [{ at: 0, crop }, { at: 30, crop: { x: 100, y: 50, w: 1600, h: 900 } }] })
    expect(pictureMarks(zooms)).toEqual([{ kind: 'zoom', title: 'Zooms, with 2 keyframes', section: 'Zoom' }])
  })

  it('name the look, the layout, a frame round it and blurred bars', () => {
    const c = picture({ look: 'mono', layout: 'pip', blurFill: true, layers: [{ id: 'l', crop, place: { x: 0.6, y: 0, w: 0.4, h: 0.2 } }] }, { style: { radius: 24 } })
    const marks = pictureMarks(c)
    expect(marks.map((m) => m.kind)).toEqual(['look', 'framing'])
    expect(marks[1]!.title).toBe('Picture in picture, a frame round the picture, bars filled with the picture, blurred')
  })

  it('put a sound clip’s noise cleanup, enhanced voice and volume in one mark', () => {
    expect(soundMarks(sound({ denoise: true, voice: 'normal', gain: 1.5 }))).toEqual([
      { kind: 'sound', title: 'Noise cleaned up, voice enhanced, normal, volume 150%', section: 'Sound' }
    ])
  })

  it('leave out being placed for a text or an image, which always is', () => {
    const placed = picture({}, { place: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 } })
    expect(pictureMarks(placed).map((m) => m.title)).toEqual(['Placed in the frame'])
    expect(pictureMarks(placed, true)).toEqual([])
  })

  it('each open the Inspector section that holds what they mark', () => {
    const c = picture({ look: 'mono', layout: 'pip', layers: [{ id: 'l', crop, place: { x: 0.6, y: 0, w: 0.4, h: 0.2 } }] })
    expect(pictureMarks(c).map((m) => m.section)).toEqual(['Look', 'Frame'])
    // Blurred and nothing else is the Blur section's, not Look's.
    expect(pictureMarks(picture({ blur: 40 })).map((m) => m.section)).toEqual(['Blur'])
    expect(pictureMarks(picture({ blur: 40, adjust: { brightness: 10 } as NonNullable<Clip['adjust']> })).map((m) => m.section)).toEqual(['Look'])
  })

  it('fit on a wide clip, and go down to one count on a narrow one', () => {
    expect(marksFit(3, 200)).toBe(true)
    expect(marksFit(3, 60)).toBe(false)
  })
})
