import { describe, it, expect } from 'vitest'
import * as session from '../../src/main/project/session'
import { createTimeline, isMarked, markedSpan, setSourceMarksOn, sourceFrames, type Project, type ProjectMedia } from '../../src/shared/project'

/**
 * Plan 21, step 2: the part of a recording worth having, marked before it goes
 * anywhere near the timeline. The recording's own, so a second pass through
 * the same 28 minutes starts where the first one left off.
 */

function media(id: string, durationSec: number): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A project holding one ten second recording, at 30 fps. */
function project(): Project {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  return {
    name: 'p',
    fps: 30,
    media: [media('talk', 10)],
    sequences: [
      {
        id: 's1',
        name: 'Vertical',
        nameFollowsShape: true,
        presetId: t.presetId,
        output: t.output,
        videoTracks: t.videoTracks,
        audioTracks: t.audioTracks,
        captions: t.captions
      }
    ]
  } as Project
}

function marksOf(p: Project): { markIn?: number; markOut?: number } {
  const m = p.media[0]!
  return { ...(m.markIn !== undefined ? { markIn: m.markIn } : {}), ...(m.markOut !== undefined ? { markOut: m.markOut } : {}) }
}

describe('how long a recording is', () => {
  it('is its length in frames at the project rate, not at its own', () => {
    expect(sourceFrames(media('a', 10), 30)).toBe(300)
    expect(sourceFrames(media('a', 10), 60)).toBe(600)
  })

  it('is never nothing, however short the file says it is', () => {
    expect(sourceFrames(media('a', 0), 30)).toBe(1)
  })
})

describe('the part worth having', () => {
  it('is the whole recording while nothing is marked', () => {
    const m = media('talk', 10)
    expect(isMarked(m)).toBe(false)
    expect(markedSpan(m, 30)).toEqual({ from: 0, to: 300 })
  })

  it('runs from In to the end when only In is marked', () => {
    const m = { ...media('talk', 10), markIn: 90 }
    expect(isMarked(m)).toBe(true)
    expect(markedSpan(m, 30)).toEqual({ from: 90, to: 300 })
  })

  it('runs from the start to Out when only Out is marked', () => {
    expect(markedSpan({ ...media('talk', 10), markOut: 120 }, 30)).toEqual({ from: 0, to: 120 })
  })

  it('is held inside the recording, so a mark from a longer version asks for nothing missing', () => {
    const span = markedSpan({ ...media('talk', 10), markIn: 9000, markOut: 12_000 }, 30)
    expect(span.to).toBeLessThanOrEqual(300)
    expect(span.from).toBeLessThan(span.to)
  })
})

describe('marking a recording', () => {
  it('sets In and Out, and they stay on the recording', () => {
    let p = setSourceMarksOn(project(), 'talk', { in: 60 })
    p = setSourceMarksOn(p, 'talk', { out: 150 })
    expect(marksOf(p)).toEqual({ markIn: 60, markOut: 150 })
    expect(markedSpan(p.media[0]!, 30)).toEqual({ from: 60, to: 150 })
  })

  it('clears one with null, leaving the other', () => {
    let p = setSourceMarksOn(project(), 'talk', { in: 60, out: 150 })
    p = setSourceMarksOn(p, 'talk', { in: null })
    expect(marksOf(p)).toEqual({ markOut: 150 })
  })

  it('drops the other when the two would say nothing, keeping the one just set', () => {
    // Out before In: the In just set stays and the old Out goes.
    let p = setSourceMarksOn(project(), 'talk', { out: 90 })
    p = setSourceMarksOn(p, 'talk', { in: 120 })
    expect(marksOf(p)).toEqual({ markIn: 120 })

    // And the other way round.
    let q = setSourceMarksOn(project(), 'talk', { in: 120 })
    q = setSourceMarksOn(q, 'talk', { out: 90 })
    expect(marksOf(q)).toEqual({ markOut: 90 })
  })

  it('holds a mark inside the recording', () => {
    const p = setSourceMarksOn(project(), 'talk', { in: 9000 })
    expect(marksOf(p).markIn).toBe(300)
  })

  it('leaves every other recording alone, and does nothing for one that is not there', () => {
    const p = project()
    expect(setSourceMarksOn(p, 'gone', { in: 10 })).toEqual(p)
  })

  it('leaves the sequences exactly as they were', () => {
    const p = project()
    expect(setSourceMarksOn(p, 'talk', { in: 60 }).sequences).toEqual(p.sequences)
  })
})

describe('undoing a mark', () => {
  it('takes the mark back, as every other edit is undone, while what the app made since stays', () => {
    session.resetProject()
    const before = session.replaceMedia(project().media[0]!)
    const marked = session.applyEdit({ kind: 'setSourceMarks', mediaId: 'talk', in: 60, out: 150 })
    expect(marksOf(marked)).toEqual({ markIn: 60, markOut: 150 })
    session.replaceMedia({ ...session.getProject().media[0]!, soundCopy: 'C:\cache\k\sound.m4a' })
    const undone = session.setProject(before)
    expect(marksOf(undone)).toEqual({})
    expect(undone.media[0]!.soundCopy).toBe('C:\cache\k\sound.m4a')
    // And redone, back to the marks.
    expect(marksOf(session.setProject(marked))).toEqual({ markIn: 60, markOut: 150 })
    session.resetProject()
  })
})
