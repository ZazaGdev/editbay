import { describe, it, expect } from 'vitest'
import { DEFAULT_TEXT, cleanTextStyle, scaledText, textKey, textName } from '../../src/shared/text'
import {
  addClip,
  addTextTo,
  createProject,
  findVideoClip,
  setTextOn,
  timelineOf,
  editSequence,
  type Project,
  type ProjectMedia
} from '../../src/shared/project'
import { clipLabel } from '../../src/shared/clip-name'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { S1, firstTimeline } from '../project-helpers'
import * as session from '../../src/main/project/session'

/**
 * Text over the video: a style made safe, scaled and named, and a text as a
 * source of its own, put above V1 and changed with the picture drawn from it.
 */

const drawn = { path: 'C:\\cache\\text\\a.png', width: 400, height: 120 }

function recording(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

function withFootage(): Project {
  const p = createProject('t', 30, { width: 1080, height: 1920 })
  return editSequence({ ...p, media: [recording('rec')] }, S1, (t) => addClip(t, 'rec', 'r'))
}

const add = (p: Project, clipId = 'c', mediaId = 'm', at = 30): Project =>
  addTextTo(p, S1, { mediaId, clipId, at, style: DEFAULT_TEXT, drawn })

describe('a text style', () => {
  it('is made safe, a damaged value taking the default', () => {
    const clean = cleanTextStyle({ text: 'hi\r\nthere', size: 99999, colour: 'red', align: 'sideways', boxOpacity: 2 })
    expect(clean.text).toBe('hi\nthere')
    expect(clean.size).toBe(800)
    expect(clean.colour).toBe(DEFAULT_TEXT.colour)
    expect(clean.align).toBe('center')
    expect(clean.boxOpacity).toBe(1)
    expect(cleanTextStyle(null)).toEqual(DEFAULT_TEXT)
  })

  it('scales everything measured in pixels together', () => {
    const big = scaledText({ ...DEFAULT_TEXT, box: true }, 2)
    expect(big.size).toBe(DEFAULT_TEXT.size * 2)
    expect(big.outlineWidth).toBe(DEFAULT_TEXT.outlineWidth * 2)
    expect(big.boxPadding).toBe(DEFAULT_TEXT.boxPadding * 2)
    expect(big.lineSpacing).toBe(DEFAULT_TEXT.lineSpacing)
  })

  it('has the same key for the same words and style, and another for any change', () => {
    expect(textKey(DEFAULT_TEXT)).toMatch(/^[0-9a-f]{16}$/)
    expect(textKey({ ...DEFAULT_TEXT })).toBe(textKey(DEFAULT_TEXT))
    expect(textKey({ ...DEFAULT_TEXT, text: 'Your text!' })).not.toBe(textKey(DEFAULT_TEXT))
  })

  it('is named by its first line with words in it', () => {
    expect(textName({ ...DEFAULT_TEXT, text: '\n  Hello  \nworld' })).toBe('Hello')
    expect(textName({ ...DEFAULT_TEXT, text: '   ' })).toBe('Text')
  })
})

describe('a text on a sequence', () => {
  it('goes on the lowest track above V1 with room, a new one when there is none, five seconds long', () => {
    let p = add(withFootage())
    let t = firstTimeline(p)
    expect(t.videoTracks).toHaveLength(2)
    const found = findVideoClip(t, 'c')!
    expect(found.index).toBe(1)
    expect(found.clip.sourceOut - found.clip.sourceIn).toBe(150)
    // Over the same time, the second text needs a track of its own; later, it shares.
    p = add(p, 'd', 'n', 60)
    t = firstTimeline(p)
    expect(findVideoClip(t, 'd')!.index).toBe(2)
    p = add(p, 'e', 'o', 400)
    expect(findVideoClip(firstTimeline(p), 'e')!.index).toBe(1)
  })

  it('lands at the size it was drawn, in the middle of the frame', () => {
    const c = findVideoClip(firstTimeline(add(withFootage())), 'c')!.clip
    expect(c.transform.place.w * 1080).toBeCloseTo(400)
    expect(c.transform.place.h * 1920).toBeCloseTo(120)
    expect(c.transform.place.x * 1080 + 200).toBeCloseTo(540)
  })

  it('is a picture with no file of its own, named by its words on the timeline', () => {
    const p = add(withFootage())
    const m = p.media.find((x) => x.id === 'm')!
    expect(m.still).toBe(true)
    expect(m.text?.text).toBe('Your text')
    expect(m.originalPath).toBe('')
    expect(clipLabel(timelineOf(p, S1), 'c')).toBe('Your text')
  })

  it('takes a new picture whole when its words change, growing about its middle', () => {
    let p = add(withFootage())
    const before = findVideoClip(firstTimeline(p), 'c')!.clip.transform.place
    p = setTextOn(p, 'm', { ...DEFAULT_TEXT, text: 'Much longer words' }, { path: 'C:\\cache\\text\\b.png', width: 800, height: 120 })
    const m = p.media.find((x) => x.id === 'm')!
    expect(m.playablePath).toBe('C:\\cache\\text\\b.png')
    expect(m.width).toBe(800)
    const c = findVideoClip(firstTimeline(p), 'c')!.clip
    expect(c.transform.crop).toEqual({ x: 0, y: 0, w: 800, h: 120 })
    expect(c.transform.place.w * 1080).toBeCloseTo(800)
    expect(c.transform.place.x + c.transform.place.w / 2).toBeCloseTo(before.x + before.w / 2)
  })

  it('reads its style back from a saved project, made safe', () => {
    const p = add(withFootage())
    const saved = JSON.parse(joinProjectFile(p, defaultWorkspace()))
    saved.media.find((m: { id: string }) => m.id === 'm').text.size = 'huge'
    const read = splitProjectFile(JSON.stringify(saved)).project
    expect(read.media.find((m) => m.id === 'm')!.text!.size).toBe(DEFAULT_TEXT.size)
  })
})

describe('undoing a text', () => {
  it('takes its source back with it, where an imported file keeps the one it has now', () => {
    const before = add(withFootage())
    const after = setTextOn(before, 'm', { ...DEFAULT_TEXT, text: 'Changed' }, { path: 'C:\\cache\\text\\b.png', width: 300, height: 120 })
    session.adoptDocument(after, null, defaultWorkspace(), false)
    const back = session.setProject(before)
    expect(back.media.find((m) => m.id === 'm')!.text!.text).toBe('Your text')
    // Undoing the text's arrival takes the text away with its clip.
    session.adoptDocument(before, null, defaultWorkspace(), false)
    const none = session.setProject(withFootage())
    expect(none.media.some((m) => m.id === 'm')).toBe(false)
  })
})


describe('a text that cannot go on', () => {
  it('leaves nothing behind when every track is taken where it would land', () => {
    let p = withFootage()
    // Seven more video tracks, eight in all, each with a text over the same time.
    for (let i = 0; i < 7; i++) p = add(p, `c${i}`, `m${i}`, 30)
    expect(firstTimeline(p).videoTracks).toHaveLength(8)
    const full = add(p, 'late', 'late-m', 30)
    expect(full).toBe(p)
    expect(full.media.some((m) => m.id === 'late-m')).toBe(false)
  })

  it('is refused under Handoff, which only ever draws V1', () => {
    const p = createProject('t', 30, { width: 1080, height: 1920 })
    const handoff = { ...p, sequences: p.sequences.map((s) => ({ ...s, presetId: 'handoff' })) }
    expect(add(handoff)).toBe(handoff)
  })
})

describe('undoing past a text drawn again', () => {
  it('keeps the picture drawn since, when the words and style are the same', () => {
    const before = add(withFootage())
    const redrawn = setTextOn(before, 'm', DEFAULT_TEXT, { path: 'D:\\elsewhere\\a.png', width: 400, height: 120 })
    session.adoptDocument(redrawn, null, defaultWorkspace(), false)
    const back = session.setProject(before)
    expect(back.media.find((m) => m.id === 'm')!.playablePath).toBe('D:\\elsewhere\\a.png')
  })
})
