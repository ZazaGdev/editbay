import { describe, it, expect } from 'vitest'
import type { Timeline } from '../../src/shared/project'
import { moveClipTo, rearrangeBlockers } from '../../src/shared/move-trim'
import { sourceAt, spanEnd } from '../../src/shared/tracks'
import { sequence, shot, pic, snd } from '../shots'

/**
 * Ctrl+drag, take out and put in, of a shot whose sound leads in or runs on
 * (audit 2026-10-19, fix first 2): only its picture's stretch is taken out of
 * V1 and opened up again, so no black is left and the shot it lands in is cut
 * where it lands; what would push a clip out of step is named for the drag.
 */

/** Where V1's pictures sit, in order, as `id[start-end]`. */
function v1(t: Timeline): string {
  return [...t.videoTracks[0]!.clips]
    .sort((a, b) => a.timelineStart - b.timelineStart)
    .map((c) => `${c.mediaId}[${c.timelineStart}-${spanEnd(c)}]`)
    .join(' ')
}

/** No frame of V1 is black up to the end of its last picture. */
function noBlack(t: Timeline): void {
  const clips = [...t.videoTracks[0]!.clips].sort((a, b) => a.timelineStart - b.timelineStart)
  let end = 0
  for (const c of clips) {
    expect(c.timelineStart, v1(t)).toBe(end)
    end = spanEnd(c)
  }
}

// A 0-100, B 100-300, C 300-400 with C's sound leading in from 275 under B.
const jcut = (): Timeline =>
  sequence(shot('A', 0, 100), { ...shot('B', 100, 200), sound: [300, 100, 275] }, { id: 'C', at: 300, from: 300, to: 400, sound: [275, 275, 400] })

describe('Ctrl+drag of a shot whose sound leads in', () => {
  it('put in part way through the shot before leaves no black and cuts that shot only where it lands', () => {
    const t = moveClipTo(jcut(), 'C', 'v1', 139, { insert: true })
    expect(v1(t)).toBe('A[0-100] B[100-139] C[139-239] B[239-400]')
    noBlack(t)
    // Its sound leads in again by 25 frames, in step with its picture.
    expect(snd(t, 'C').timelineStart).toBe(114)
    expect(sourceAt(snd(t, 'C'), pic(t, 'C').timelineStart)).toBe(pic(t, 'C').sourceIn)
  })

  it('dragged by its sound, the picture still lands by its offset and leaves no black', () => {
    // Let go 6 frames on, inside its own stretch: nothing to take out or put in.
    const p = jcut()
    expect(moveClipTo(p, 'Cs', p.audioTracks[0]!.id, 281, { insert: true })).toBe(p)
    // Let go at 114: its picture goes in at 139, as dragging the picture there does.
    const t = moveClipTo(p, 'Cs', p.audioTracks[0]!.id, 114, { insert: true })
    expect(v1(t)).toBe('A[0-100] B[100-139] C[139-239] B[239-400]')
    noBlack(t)
  })

  it('put in after the last shot is made, not refused', () => {
    const p = sequence(shot('A', 0, 100), { ...shot('B', 100, 100), sound: [300, 100, 185] }, { id: 'C', at: 200, from: 300, to: 400, sound: [285, 185, 300] }, shot('D', 300, 100))
    expect(rearrangeBlockers(p, 'C', 'v1', 400)).toEqual([])
    const t = moveClipTo(p, 'C', 'v1', 400, { insert: true })
    expect(v1(t)).toBe('A[0-100] B[100-200] D[200-300] C[300-400]')
    noBlack(t)
    expect(snd(t, 'C').timelineStart).toBe(285)
  })

  it('names what is in the way when taking the shot out would push a lead-in under another sound', () => {
    // Taking B out moves C up, and C's lead-in would run under A's own sound.
    const p = sequence(shot('A', 0, 100), { ...shot('B', 100, 100), sound: [300, 100, 185] }, { id: 'C', at: 200, from: 300, to: 400, sound: [285, 185, 300] }, shot('D', 300, 100))
    expect(rearrangeBlockers(p, 'B', 'v1', 400).map((c) => c.id)).toContain('Cs')
    expect(moveClipTo(p, 'B', 'v1', 400, { insert: true })).toBe(p)
  })
})
