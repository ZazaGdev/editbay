import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  createTimeline,
  findClip,
  linkedIds,
  setClipMark,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { CLIP_MARKS, cleanMark, markColour, markName } from '../../src/shared/marks'
import { overviewBlocks } from '../../src/shared/overview'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Plan 24: a colour on a clip, meaning whatever the owner decided. It goes on
 * the clips linked to it as well, because a picture and its sound came onto
 * the timeline together and are one thing to mark.
 */

function media(id: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    ...overrides
  }
}

const SOUND = { hasVideo: false, width: 0, height: 0 }

/** A take on V1 with its sound linked on A1, and music on A2 that is linked to nothing. */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 10), media('song', 20, SOUND)]
  }
  t = addClip(t, 'talk', 'p1')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

function markOfClip(t: Timeline, clipId: string): string | undefined {
  return findClip(t, clipId)?.clip.mark
}

describe('the colours there are', () => {
  it('are five, each with an id, a name and a colour', () => {
    expect(CLIP_MARKS.length).toBe(5)
    for (const m of CLIP_MARKS) {
      expect(m.id).not.toBe('')
      expect(m.name).not.toBe('')
      expect(m.colour).toMatch(/^#[0-9A-F]{6}$/i)
    }
    expect(new Set(CLIP_MARKS.map((m) => m.id)).size).toBe(5)
  })

  it('answer nothing for anything that is not one of them', () => {
    expect(markColour('puce')).toBeNull()
    expect(markName(undefined)).toBeNull()
    expect(cleanMark('puce')).toBeUndefined()
    expect(cleanMark('red')).toBe('red')
  })
})

describe('marking a clip', () => {
  it('carries no mark until it is marked', () => {
    const t = cut()
    expect(markOfClip(t, 'p1')).toBeUndefined()
    expect('mark' in findClip(t, 'p1')!.clip).toBe(false)
  })

  it('puts the colour on the clip', () => {
    const t = setClipMark(cut(), 'p1', 'red')
    expect(markOfClip(t, 'p1')).toBe('red')
  })

  it('puts it on the clips linked to it as well', () => {
    const t = cut()
    const linked = linkedIds(t, 'p1')
    expect(linked.length).toBeGreaterThan(1)
    const marked = setClipMark(t, 'p1', 'green')
    for (const id of linked) expect(markOfClip(marked, id)).toBe('green')
  })

  it('leaves a clip that is linked to nothing else alone', () => {
    const t = setClipMark(cut(), 'p1', 'blue')
    expect(markOfClip(t, 'music')).toBeUndefined()
  })

  it('takes the mark off again', () => {
    const t = setClipMark(setClipMark(cut(), 'p1', 'blue'), 'p1', null)
    for (const id of linkedIds(t, 'p1')) expect(markOfClip(t, id)).toBeUndefined()
  })

  it('takes the mark off rather than storing a colour nothing can draw', () => {
    const t = setClipMark(setClipMark(cut(), 'p1', 'blue'), 'p1', 'puce')
    expect(markOfClip(t, 'p1')).toBeUndefined()
  })

  it('does nothing at all for a clip that is not there', () => {
    const t = cut()
    expect(setClipMark(t, 'gone', 'red')).toEqual(t)
  })

  it('goes through the session as an edit of its own', () => {
    const t = applyClipEdit(cut(), { kind: 'setClipMark', clipId: 'music', mark: 'amber' })
    expect(markOfClip(t, 'music')).toBe('amber')
  })
})

describe('a mark on the overview strip', () => {
  it('rides on the block, so the strip can draw it in that colour', () => {
    const t = setClipMark(cut(), 'p1', 'purple')
    const blocks = overviewBlocks(t)
    expect(blocks.filter((b) => b.mark === 'purple').length).toBe(linkedIds(t, 'p1').length)
    expect(blocks.some((b) => b.mark === undefined)).toBe(true)
  })
})
