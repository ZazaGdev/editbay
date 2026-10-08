import { describe, it, expect } from 'vitest'
import { createProject, playedByPicture, playedCopy, timelineOf, type SoundClip, setVoiceCare, wantingCareCopy, withTimeline, addClip, createTimeline, FIRST_SEQUENCE_ID, type ProjectMedia } from '../../src/shared/project'
import { breathThreshold, breathsGraph, careOf, careRecipe, cleanCare } from '../../src/shared/voice-care'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import * as session from '../../src/main/project/session'
const { applyEditTo } = session

/**
 * Plan 81 (bugs and notes 2, note 31): Soften breaths and Remove mouth
 * clicks, set for a recording's track and heard on every clip that plays it.
 */

function media(id: string): ProjectMedia {
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

function project(): ReturnType<typeof createProject> {
  const p = { ...createProject('p', 30, { width: 1080, height: 1920 }), media: [media('a')] }
  const t = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: p.media }, 'a', 'c')
  return withTimeline(p, FIRST_SEQUENCE_ID, t)
}

describe('breaths and clicks on a track', () => {
  it('names each mix of switches, so each has its own copy', () => {
    expect(careRecipe({ track: 0, clicks: true }, false, undefined)).toBe('c1-clicks')
    expect(careRecipe({ track: 0, breaths: 'gentle' }, true, 'normal')).toBe('c1-clean-gentle-normal')
    expect(careRecipe({ track: 0, breaths: 'strong', clicks: true }, true, undefined)).toBe('c1-clicks-clean-strong')
  })

  it('opens the breath gate 20 dB under the voice band, within sensible bounds', () => {
    expect(breathThreshold(-12)).toBeCloseTo(Math.pow(10, -32 / 20), 5)
    expect(breathThreshold(null)).toBeCloseTo(Math.pow(10, -50 / 20), 5)
    expect(breathThreshold(-90)).toBeCloseTo(Math.pow(10, -50 / 20), 5)
    expect(breathThreshold(20)).toBe(0.5)
  })

  it('gates the voice from its own band, a moment ahead, and brings it back into time', () => {
    const g = breathsGraph('gentle', 0.02, '[in]', '[out]')
    expect(g).toContain('highpass=f=100,lowpass=f=900')
    expect(g).toContain('adelay=delays=20:all=1')
    expect(g).toContain('sidechaingate=threshold=0.02:range=0.316')
    expect(g).toContain('atrim=start=0.02')
    expect(breathsGraph('strong', 0.02, '[in]', '[out]')).toContain('range=0.1:')
  })

  it('is set for the track, kept only while something is on, and one undo step', () => {
    const p = project()
    const on = applyEditTo(p, { kind: 'setVoiceCare', mediaId: 'a', track: 0, breaths: 'gentle' })
    expect(careOf(on.media[0]!, 0)).toEqual({ track: 0, breaths: 'gentle' })
    const both = setVoiceCare(on, 'a', 0, { clicks: true })
    expect(careOf(both.media[0]!, 0)).toEqual({ track: 0, breaths: 'gentle', clicks: true })
    const off = setVoiceCare(setVoiceCare(both, 'a', 0, { breaths: null }), 'a', 0, { clicks: false })
    expect(off.media[0]!.care).toBeUndefined()
    // A track the recording does not have is not set.
    expect(setVoiceCare(p, 'a', 5, { clicks: true })).toBe(p)
  })

  it('plays from a player of its own in the preview, so the treatment is heard there as in the export', () => {
    const p = project()
    const sound = (x: typeof p): SoundClip => timelineOf(x, FIRST_SEQUENCE_ID).audioTracks[0]!.clips[0]!
    expect(playedByPicture(timelineOf(p, FIRST_SEQUENCE_ID), sound(p))).not.toBeNull()
    const on = setVoiceCare(p, 'a', 0, { clicks: true })
    expect(playedByPicture(timelineOf(on, FIRST_SEQUENCE_ID), sound(on))).toBeNull()
  })

  it('plays the treated copy once it is made, and until then what it played before', () => {
    const p = setVoiceCare(project(), 'a', 0, { breaths: 'strong' })
    const wanted = wantingCareCopy(p)
    expect(wanted.map((w) => [w.media.id, w.track, careRecipe(w.care, w.clean, w.voice)])).toEqual([['a', 0, 'c1-strong']])
    const clip = { track: 0 }
    expect(playedCopy(p.media[0]!, clip)).toBeNull()
    const made = { ...p.media[0]!, treated: [{ track: 0, recipe: 'c1-strong', path: 'C:\\cache\\treated-1-c1-strong.m4a' }] }
    expect(playedCopy(made, clip)).toBe('C:\\cache\\treated-1-c1-strong.m4a')
    expect(wantingCareCopy({ ...p, media: [made] })).toEqual([])
    // With nothing on, the treated copy is not played.
    expect(playedCopy({ ...made, care: [] }, clip)).toBeNull()
  })

  it('is undone from the snapshot, while a treated copy made since is kept', () => {
    const before = project()
    session.adoptDocument(before, null, defaultWorkspace(), true)
    const on = session.applyEdit({ kind: 'setVoiceCare', mediaId: 'a', track: 0, clicks: true })
    expect(careOf(on.media[0]!, 0)).toEqual({ track: 0, clicks: true })
    session.replaceMedia({ ...session.getProject().media[0]!, treated: [{ track: 0, recipe: 'c1-clicks', path: 'x.m4a' }] })
    const undone = session.setProject(before)
    expect(undone.media[0]!.care).toBeUndefined()
    expect(undone.media[0]!.treated).toEqual([{ track: 0, recipe: 'c1-clicks', path: 'x.m4a' }])
    session.resetProject()
  })

  it('keeps it through saving and opening, and drops what is damaged', () => {
    const p = setVoiceCare(setVoiceCare(project(), 'a', 0, { breaths: 'gentle' }), 'a', 0, { clicks: true })
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(back.media[0]!.care).toEqual([{ track: 0, breaths: 'gentle', clicks: true }])
    expect(cleanCare([{ track: 0, breaths: 'loud' }, { track: -1, clicks: true }, { track: 1, clicks: true }, 'x'])).toEqual([{ track: 1, clicks: true }])
    expect(cleanCare('nonsense')).toBeUndefined()
  })
})
