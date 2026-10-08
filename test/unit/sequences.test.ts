import { describe, it, expect } from 'vitest'
import {
  createProject,
  addSequence,
  duplicateSequence,
  renameSequence,
  removeSequence,
  setSequenceShape,
  setCrop,
  editSequence,
  timelineOf,
  sequenceOf,
  upsertMedia,
  uniqueSequenceName,
  mediaDurationFrames,
  v1Clips,
  clipsUsing,
  withoutMedia,
  type Project,
  type ProjectMedia
} from '../../src/shared/project'
import { applyEditTo } from '../../src/main/project/session'
import { S1, clipsOf, soundsOf, addClipTo } from '../project-helpers'

function media(id: string, durationSec: number): ProjectMedia {
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
    peaksPath: `C:\\c\\${id}\\peaks.bin`,
    filmstripPath: `C:\\c\\${id}\\filmstrip.jpg`
  }
}

/** A vertical project with two clips of a 10 second landscape source. */
function project(): Project {
  const p = createProject('holiday', 30, { width: 1080, height: 1920 })
  return addClipTo(addClipTo({ ...p, media: [media('a', 10)] }, 'a'), 'a')
}

describe('adding a sequence', () => {
  it('adds an empty one in the shape asked for, named after it, at the end', () => {
    const p = addSequence(project(), 'b', 'landscape')
    expect(p.sequences.map((s) => s.id)).toEqual([S1, 'b'])
    expect(sequenceOf(p, 'b')).toMatchObject({
      name: 'Landscape',
      nameFollowsShape: true,
      presetId: 'landscape',
      output: { width: 1920, height: 1080 },
      videoTracks: [{ id: 'v1', clips: [] }],
      audioTracks: [{ id: 'a1', clips: [] }]
    })
  })

  it('numbers a name that is already taken', () => {
    const p = addSequence(addSequence(project(), 'b', 'vertical'), 'c', 'vertical')
    expect(p.sequences.map((s) => s.name)).toEqual(['Vertical', 'Vertical 2', 'Vertical 3'])
  })

  it('does nothing for an id already in use', () => {
    const p = project()
    expect(addSequence(p, S1, 'landscape')).toBe(p)
  })

  it('shares the project sources rather than copying them', () => {
    const p = addSequence(project(), 'b', 'landscape')
    expect(timelineOf(p, 'b').media).toBe(p.media)
  })
})

describe('duplicating a sequence', () => {
  it('copies the clips with new ids, placed right after it', () => {
    const p = duplicateSequence(addSequence(project(), 'z', 'square'), S1, 'copy')
    expect(p.sequences.map((s) => s.id)).toEqual([S1, 'copy', 'z'])
    const original = clipsOf(p)
    const copy = v1Clips(timelineOf(p, 'copy'))
    expect(copy.map((c) => [c.sourceIn, c.sourceOut])).toEqual(original.map((c) => [c.sourceIn, c.sourceOut]))
    expect(copy.map((c) => c.id).some((id) => original.some((c) => c.id === id))).toBe(false)
  })

  it('gives the copy the next free name', () => {
    expect(sequenceOf(duplicateSequence(project(), S1, 'copy'), 'copy').name).toBe('Vertical 2')
  })

  it('numbers a copy of a sequence you named yourself after that name', () => {
    const p = duplicateSequence(renameSequence(project(), S1, 'Intro'), S1, 'copy')
    expect(sequenceOf(p, 'copy')).toMatchObject({ name: 'Intro 2', nameFollowsShape: false })
  })

  it('makes a copy that trimming the original never touches', () => {
    let p = duplicateSequence(project(), S1, 'copy')
    const first = clipsOf(p)[0]!
    p = editSequence(p, S1, (t) => setCrop(t, first.id, { x: 0, y: 0, w: 200, h: 200 }))
    expect(v1Clips(timelineOf(p, 'copy'))[0]!.transform.crop).not.toEqual({ x: 0, y: 0, w: 200, h: 200 })
  })
})

describe('the shape of one sequence', () => {
  it('changes only that sequence, and leaves the other crops exactly as they were', () => {
    const p = duplicateSequence(project(), S1, 'copy')
    const before = clipsOf(p).map((c) => c.transform.crop)
    const after = setSequenceShape(p, 'copy', 'landscape')
    expect(clipsOf(after).map((c) => c.transform.crop)).toEqual(before)
    expect(timelineOf(after, S1).presetId).toBe('vertical')
    const crop = v1Clips(timelineOf(after, 'copy'))[0]!.transform.crop
    expect(crop.w / crop.h).toBeCloseTo(16 / 9, 1)
  })

  it('carries a name that still follows the shape along with it', () => {
    const p = setSequenceShape(duplicateSequence(project(), S1, 'copy'), 'copy', 'landscape')
    expect(sequenceOf(p, 'copy').name).toBe('Landscape')
  })

  it('numbers the new name if another sequence already has it', () => {
    let p = addSequence(project(), 'land', 'landscape')
    p = setSequenceShape(p, S1, 'landscape')
    expect(p.sequences.map((s) => s.name)).toEqual(['Landscape 2', 'Landscape'])
  })

  it('leaves a name you gave it alone', () => {
    const p = setSequenceShape(renameSequence(project(), S1, 'Main cut'), S1, 'square')
    expect(sequenceOf(p, S1).name).toBe('Main cut')
  })
})

describe('renaming', () => {
  it('names the sequence and stops the name following its shape', () => {
    const p = renameSequence(project(), S1, '  TikTok  ')
    expect(sequenceOf(p, S1)).toMatchObject({ name: 'TikTok', nameFollowsShape: false })
  })

  it('ignores an empty name', () => {
    const p = project()
    expect(renameSequence(p, S1, '   ')).toBe(p)
  })

  it('changes nothing when given the name it already has, so its name still follows its shape', () => {
    const p = project()
    expect(renameSequence(p, S1, ' Vertical ')).toBe(p)
  })

  it('numbers a name another sequence already has, since exports are named after it', () => {
    const p = renameSequence(addSequence(project(), 'b', 'landscape'), 'b', 'vertical')
    expect(sequenceOf(p, 'b').name).toBe('vertical 2')
  })
})

describe('an edit for a sequence that has gone', () => {
  it('does nothing, rather than landing on another sequence', () => {
    const p = project()
    const first = clipsOf(p)[0]!
    expect(editSequence(p, 'gone', (t) => setCrop(t, first.id, { x: 0, y: 0, w: 100, h: 100 }))).toBe(p)
    expect(setSequenceShape(p, 'gone', 'square')).toBe(p)
    expect(applyEditTo(p, { sequenceId: 'gone', kind: 'split', frame: 100 })).toBe(p)
  })
})

describe('removing a sequence', () => {
  it('takes it away', () => {
    const p = removeSequence(addSequence(project(), 'b', 'landscape'), S1)
    expect(p.sequences.map((s) => s.id)).toEqual(['b'])
  })

  it('never takes the last one: a project always has a sequence', () => {
    const p = project()
    expect(removeSequence(p, S1)).toBe(p)
  })
})

describe('finding a sequence', () => {
  it('falls back to the first for an id that is not there', () => {
    const p = addSequence(project(), 'b', 'landscape')
    expect(sequenceOf(p, 'gone').id).toBe(S1)
    expect(v1Clips(timelineOf(p, 'gone'))).toBe(clipsOf(p))
  })

  it('finds the first free name', () => {
    const p = addSequence(project(), 'b', 'vertical')
    expect(uniqueSequenceName(p, 'Vertical')).toBe('Vertical 3')
    expect(uniqueSequenceName(p, 'vertical 2', 'b')).toBe('vertical 2')
    expect(uniqueSequenceName(p, 'Square')).toBe('Square')
  })
})

describe('a source that comes back shorter', () => {
  it('pulls the clips back inside it in every sequence', () => {
    const p = upsertMedia(duplicateSequence(project(), S1, 'copy'), media('a', 3))
    const limit = mediaDurationFrames(media('a', 3), 30)
    for (const s of p.sequences) {
      const clips = [...s.videoTracks.flatMap((r) => r.clips), ...s.audioTracks.flatMap((r) => r.clips)]
      expect(clips).toHaveLength(4)
      for (const c of clips) expect(c.sourceOut).toBeLessThanOrEqual(limit)
    }
  })
})

describe('where a source is used', () => {
  it('counts a picture and the sound that came on with it once', () => {
    // Two clips of a source with sound: each is a picture linked to its sound.
    const p = project()
    expect(clipsOf(p)).toHaveLength(2)
    expect(soundsOf(p).length).toBeGreaterThanOrEqual(2)
    expect(clipsUsing(p, 'a')).toBe(2)
  })

  it('counts every sequence', () => {
    expect(clipsUsing(duplicateSequence(project(), S1, 'copy'), 'a')).toBe(4)
  })

  it('counts nothing for a source not on the timeline', () => {
    expect(clipsUsing({ ...project(), media: [media('a', 10), media('b', 5)] }, 'b')).toBe(0)
  })
})

describe('taking a source out of the project', () => {
  it('takes out one no clip uses', () => {
    const p = { ...project(), media: [media('a', 10), media('b', 5)] }
    expect(withoutMedia(p, 'b').media.map((m) => m.id)).toEqual(['a'])
  })

  it('leaves one a clip uses, in this sequence or another', () => {
    const p = project()
    expect(withoutMedia(p, 'a')).toBe(p)
    // Used only in a second sequence: still kept.
    const copy = duplicateSequence(p, S1, 'copy')
    const onlyInCopy = removeSequence(addSequence(copy, 'blank', 'vertical'), S1)
    expect(clipsUsing(onlyInCopy, 'a')).toBe(2)
    expect(withoutMedia(onlyInCopy, 'a')).toBe(onlyInCopy)
  })
})

describe('edits through the session', () => {
  it('apply a clip edit to the sequence it names and no other', () => {
    const p = duplicateSequence(project(), S1, 'copy')
    const clip = v1Clips(timelineOf(p, 'copy'))[0]!
    const next = applyEditTo(p, { sequenceId: 'copy', kind: 'setClipIn', clipId: clip.id, frame: 30 })
    expect(v1Clips(timelineOf(next, 'copy'))[0]!.sourceIn).toBe(30)
    expect(clipsOf(next)).toEqual(clipsOf(p))
  })

  it('route the four sequence edits', () => {
    let p = project()
    p = applyEditTo(p, { kind: 'addSequence', id: 'b', presetId: 'square' })
    p = applyEditTo(p, { kind: 'duplicateSequence', sequenceId: 'b', id: 'c' })
    p = applyEditTo(p, { kind: 'renameSequence', sequenceId: 'c', name: 'Feed' })
    p = applyEditTo(p, { kind: 'removeSequence', sequenceId: S1 })
    expect(p.sequences.map((s) => [s.id, s.name])).toEqual([
      ['b', 'Square'],
      ['c', 'Feed']
    ])
  })

  it('let a shape change carry the name along', () => {
    const p = applyEditTo(project(), { sequenceId: S1, kind: 'setShape', presetId: 'square' })
    expect(sequenceOf(p, S1).name).toBe('Square')
  })
})

describe('a saved setup picked from the shape list', () => {
  const layout = {
    crop: { x: 960, y: 0, w: 960, h: 1080 },
    place: { x: 0, y: 0, w: 1, h: 1 },
    layers: [],
    layout: 'single' as const,
    width: 1920,
    height: 1080,
    frameW: 1920,
    frameH: 1080
  }

  it('changes the shape and gives the clips named its framing, in one edit', () => {
    const p = project()
    const first = clipsOf(p)[0]
    const after = applyEditTo(p, { kind: 'applySetup', sequenceId: S1, presetId: 'landscape', clipIds: [first!.id], framing: layout })
    const t = timelineOf(after, S1)
    expect(t.presetId).toBe('landscape')
    expect(sequenceOf(after, S1).name).toBe('Landscape')
    expect(v1Clips(t)[0]!.transform.crop).toEqual(layout.crop)
    // The clip not named was only reshaped for the new frame.
    expect(v1Clips(t)[1]!.transform.crop).toEqual(v1Clips(timelineOf(setSequenceShape(p, S1, 'landscape'), S1))[1]!.transform.crop)
  })

  it('does nothing for a shape this build does not have', () => {
    const p = project()
    expect(applyEditTo(p, { kind: 'applySetup', sequenceId: S1, presetId: 'cinema', clipIds: [], framing: layout })).toBe(p)
  })
})
