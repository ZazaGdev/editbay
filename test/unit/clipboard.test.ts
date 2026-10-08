import { describe, it, expect } from 'vitest'
import { copyClips, pasteClips } from '../../src/shared/clipboard'
import { groupClips, groupedIds } from '../../src/shared/groups'
import {
  addClip,
  addTextTo,
  createProject,
  editSequence,
  findClip,
  setLook,
  timelineOf,
  type Clip,
  type Project,
  type ProjectMedia,
  type SoundClip
} from '../../src/shared/project'
import { DEFAULT_TEXT } from '../../src/shared/text'
import { S1 } from '../project-helpers'

/** Plan 63: clips copied whole and pasted at another time, never over anything. */

function media(id: string, seconds: number): ProjectMedia {
  return {
    id, originalPath: `C:/v/${id}.mp4`, playablePath: `C:/v/${id}.mp4`, conformed: false, conformReasons: [],
    durationSec: seconds, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, peaksPath: '', filmstripPath: ''
  }
}

/** A recording on V1 with its sound on A1, 0 to 120, given a look. */
function project(): Project {
  const p = { ...createProject('t', 30, { width: 1080, height: 1920 }), media: [media('rec', 4)] }
  return editSequence(p, S1, (t) => setLook(addClip(t, 'rec', 'c'), 'c', 'mono'))
}

let counter = 0
const ids = (): string => `n${++counter}`
const t = (p: Project) => timelineOf(p, S1)

describe('copying clips', () => {
  it('takes the linked sound with a picture, unless taken alone', () => {
    const p = project()
    expect(copyClips(t(p), ['c'])!.clips.map((c) => c.kind).sort()).toEqual(['audio', 'video'])
    expect(copyClips(t(p), ['c'], true)!.clips.map((c) => c.kind)).toEqual(['video'])
    expect(copyClips(t(p), ['nothing'])).toBeNull()
  })
})

describe('pasting clips', () => {
  it('puts the whole clip again at the playhead, its sound linked to it and not to the original, as new ids', () => {
    const p = project()
    const copied = copyClips(t(p), ['c'])!
    const { project: after, placed, left } = pasteClips(p, S1, copied, 300, ids)
    expect(left).toBe(0)
    expect(placed).toHaveLength(2)
    const pic = findClip(t(after), placed.find((id) => findClip(t(after), id)!.kind === 'video')!)!.clip as Clip
    const snd = findClip(t(after), placed.find((id) => findClip(t(after), id)!.kind === 'audio')!)!.clip as SoundClip
    expect(pic.timelineStart).toBe(300)
    expect(snd.timelineStart).toBe(300)
    expect(pic.look).toBe('mono')
    expect(pic.link).toBe(snd.link)
    expect(pic.link).not.toBe((findClip(t(after), 'c')!.clip as Clip).link)
    // The original is where it was.
    expect(findClip(t(after), 'c')!.clip.timelineStart).toBe(0)
  })

  it('makes a pasted group a group of its own, so picking or deleting the copy leaves the original', () => {
    const p = editSequence(project(), S1, (x) => groupClips(addClip(x, 'rec', 'd'), ['c', 'd'], 'g'))
    const copied = copyClips(t(p), groupedIds(t(p), 'c'))!
    const { project: after, placed } = pasteClips(p, S1, copied, 300, ids)
    const timeline = t(after)
    const pictures = placed.map((id) => findClip(timeline, id)!).filter((f) => f.kind === 'video').map((f) => f.clip as Clip)
    expect(pictures).toHaveLength(2)
    expect(pictures[0]!.group).toBeDefined()
    expect(pictures[0]!.group).not.toBe('g')
    expect(pictures[1]!.group).toBe(pictures[0]!.group)
    expect(groupedIds(timeline, pictures[0]!.id).sort()).toEqual([...placed].sort())
    expect(groupedIds(timeline, 'c')).not.toContain(pictures[0]!.id)
  })

  it('never pastes over a clip: a taken stretch sends the copy to a free track, a new one if need be', () => {
    const p = project()
    const copied = copyClips(t(p), ['c'])!
    const { project: after, placed } = pasteClips(p, S1, copied, 30, ids)
    const timeline = t(after)
    expect(timeline.videoTracks).toHaveLength(2)
    expect(timeline.audioTracks).toHaveLength(2)
    for (const id of placed) expect(findClip(timeline, id)!.index).toBe(1)
    expect(findClip(timeline, 'c')!.clip.timelineStart).toBe(0)
  })

  it('makes a pasted text its own text, so changing one leaves the other', () => {
    const drawn = { path: 'C:/cache/text/a.png', width: 400, height: 120 }
    const p = addTextTo(project(), S1, { mediaId: 'words', clipId: 'w', at: 0, style: DEFAULT_TEXT, drawn })
    const copied = copyClips(t(p), ['w'])!
    expect(copied.texts.map((m) => m.id)).toEqual(['words'])
    const { project: after, placed } = pasteClips(p, S1, copied, 200, ids)
    const pasted = findClip(t(after), placed[0]!)!.clip
    expect(pasted.mediaId).not.toBe('words')
    const source = after.media.find((m) => m.id === pasted.mediaId)!
    expect(source.text).toEqual(after.media.find((m) => m.id === 'words')!.text)
  })

  it('keeps clips copied together the same distance apart', () => {
    let p = project()
    p = editSequence(p, S1, (x) => addClip(x, 'rec', 'd'))
    const copied = copyClips(t(p), ['c', 'd'], true)!
    const { project: after, placed } = pasteClips(p, S1, copied, 600, ids)
    const starts = placed.map((id) => findClip(t(after), id)!.clip.timelineStart).sort((a, b) => a - b)
    expect(starts).toEqual([600, 720])
  })
})
