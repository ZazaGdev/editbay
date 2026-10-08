import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { textAt } from '../../src/shared/playback'
import { DEFAULT_TEXT } from '../../src/shared/text'

/** The text a double click on the Output view types into: the one on top under the pointer, at the playhead. */

function media(id: string, text: boolean): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.png`,
    playablePath: `C:\v\${id}.png`,
    conformed: false,
    conformReasons: [],
    durationSec: 5,
    width: 400,
    height: 100,
    fps: 30,
    codec: 'png',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    ...(text ? { text: DEFAULT_TEXT } : {})
  }
}

/** A text on V1 from 0 to 150, placed in the middle band of the frame. */
function withText(hidden = false): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }, 'vertical'), media: [media('words', true)] }
  t = addClip(t, 'words', 'w')
  const v1 = t.videoTracks[0]!
  const clips = v1.clips.map((c) => ({ ...c, transform: { ...c.transform, place: { x: 0.25, y: 0.4, w: 0.5, h: 0.1 } } }))
  return { ...t, videoTracks: [{ ...v1, clips, ...(hidden ? { hidden: true } : {}) }] }
}

describe('the text under a point', () => {
  it('is the text whose box holds the point, at a frame it is on', () => {
    expect(textAt(withText(), 10, 0.5, 0.45)).toBe('w')
  })

  it('is nothing outside its box, after it ends, or on a hidden track', () => {
    expect(textAt(withText(), 10, 0.1, 0.45)).toBeNull()
    expect(textAt(withText(), 150, 0.5, 0.45)).toBeNull()
    expect(textAt(withText(true), 10, 0.5, 0.45)).toBeNull()
  })

  it('is nothing for a picture that is not a text', () => {
    const t = withText()
    const plain = { ...t, media: t.media.map((m) => ({ ...m, text: undefined })) } as unknown as Timeline
    expect(textAt(plain, 10, 0.5, 0.45)).toBeNull()
  })
})
