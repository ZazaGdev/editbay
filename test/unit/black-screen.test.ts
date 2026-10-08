import { describe, it, expect } from 'vitest'
import { addClip, addColourTo, addTextTo, addTrack, cleanColour, setTrackLocked, createProject, editSequence, findVideoClip, setColourOn, setClipOut, type Project, type ProjectMedia } from '../../src/shared/project'
import { clipLabel } from '../../src/shared/clip-name'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { S1, firstTimeline } from '../project-helpers'
import { DEFAULT_TEXT } from '../../src/shared/text'

/** Item 24: a plain black screen, for an end card, as a clip of its own. */

const drawn = { path: 'C:\cache\text\c0000000.png', width: 1920, height: 1080 }

function recording(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
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

/** A landscape sequence with a recording on V1 from 0 to 150. */
function withFootage(): Project {
  const p = createProject('t', 30, { width: 1920, height: 1080 })
  return editSequence({ ...p, media: [recording('rec')] }, S1, (t) => setClipOut(addClip(t, 'rec', 'r'), 'r', 150))
}

const add = (p: Project, at: number, more: { length?: number; trackId?: string; colour?: string } = {}): Project =>
  addColourTo(p, S1, { mediaId: 'm', clipId: 'b', at, colour: more.colour ?? '#000000', drawn, ...more })

describe('a black screen on a sequence', () => {
  it('goes straight after the last clip on V1 when the playhead is at or past the end, three seconds long', () => {
    for (const at of [150, 400]) {
      const t = firstTimeline(add(withFootage(), at))
      const found = findVideoClip(t, 'b')!
      expect(found.index).toBe(0)
      expect(found.clip.timelineStart).toBe(150)
      expect(found.clip.sourceOut - found.clip.sourceIn).toBe(90)
    }
  })

  it('goes above V1 where V1 is taken at the playhead, covering the footage', () => {
    const found = findVideoClip(firstTimeline(add(withFootage(), 60)), 'b')!
    expect(found.index).toBe(1)
    expect(found.clip.timelineStart).toBe(60)
  })

  it('fills a gap exactly, on its track, from the gap menu', () => {
    const p = editSequence(withFootage(), S1, (t) => addClip(t, 'rec', 'r2'))
    // r2 from 150 moved on to 250 leaves a gap of 100 frames on V1.
    const gapped = editSequence(p, S1, (t) => ({ ...t, videoTracks: t.videoTracks.map((r, i) => (i === 0 ? { ...r, clips: r.clips.map((c) => (c.id === 'r2' ? { ...c, timelineStart: 250 } : c)) } : r)) }))
    const found = findVideoClip(firstTimeline(add(gapped, 150, { length: 100, trackId: 'v1' })), 'b')!
    expect(found.index).toBe(0)
    expect(found.clip.timelineStart).toBe(150)
    expect(found.clip.sourceOut - found.clip.sourceIn).toBe(100)
  })

  it('is refused, source and all, where the gap has no room or the colour is not one', () => {
    const p = withFootage()
    expect(add(p, 60, { length: 90, trackId: 'v1' })).toBe(p)
    expect(add(p, 150, { colour: 'black' })).toBe(p)
  })

  it('is called a black screen on the timeline, and a colour by its value once changed', () => {
    const p = add(withFootage(), 150)
    expect(clipLabel(firstTimeline(p), 'b')).toContain('Black screen')
    const red = setColourOn(p, 'm', '#FF0000', drawn)
    expect(red.media.find((m) => m.id === 'm')!.colour).toBe('#ff0000')
    expect(clipLabel(firstTimeline(red), 'b')).toContain('Colour #ff0000')
  })

  it('keeps its colour through saving and opening, and a damaged one opens as black', () => {
    const p = add(withFootage(), 150, { colour: '#123456' })
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back.media.find((m) => m.id === 'm')!.colour).toBe('#123456')
    const damaged = joinProjectFile(p, defaultWorkspace()).replace('#123456', 'not a colour')
    expect(splitProjectFile(damaged).project.media.find((m) => m.id === 'm')!.colour).toBe('#000000')
  })

  it('takes only #rrggbb as a colour', () => {
    expect(cleanColour('#ABCDEF')).toBe('#abcdef')
    expect(cleanColour('red')).toBeNull()
    expect(cleanColour('#fff')).toBeNull()
  })
})

describe('a black screen or a text and a locked track (audit 2026-10-01)', () => {
  it('never goes on a locked V1, but on the next track up with room', () => {
    const locked = editSequence(withFootage(), S1, (t) => setTrackLocked(t, t.videoTracks[0]!.id, true))
    const found = findVideoClip(firstTimeline(add(locked, 150)), 'b')!
    expect(found.index).toBeGreaterThan(0)
  })

  it('never puts a text on a locked track above V1', () => {
    let p = editSequence(withFootage(), S1, (t) => addTrack(t, 'video', 'v2'))
    p = editSequence(p, S1, (t) => setTrackLocked(t, 'v2', true))
    p = addTextTo(p, S1, { mediaId: 'words', clipId: 'w', at: 0, style: DEFAULT_TEXT, drawn })
    const t = firstTimeline(p)
    const found = findVideoClip(t, 'w')!
    expect(t.videoTracks[found.index]!.id).not.toBe('v2')
    expect(t.videoTracks.find((r) => r.id === 'v2')!.clips).toHaveLength(0)
  })
})
