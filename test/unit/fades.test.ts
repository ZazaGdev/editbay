import { describe, it, expect } from 'vitest'
import { addSource, addTrack, addTransition, createTimeline, findClip, setFade, type ProjectMedia, type SoundClip, type Timeline } from '../../src/shared/project'

/**
 * Plan 51: a fade handle on a sound clip makes a fade from or to silence, as
 * a sound transition lying wholly inside the clip, on that clip alone.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.wav`,
    playablePath: `C:\v\${id}.wav`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 0,
    height: 0,
    fps: 0,
    codec: 'pcm',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A ten second song on A2 from one second in: its clip is s.1, the sound of s. */
function song(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('song')] }
  t = addTrack(t, 'audio', 'a2')
  return addSource(t, { mediaId: 'song', clipId: 's', at: 30, onTrack: 'a2' })
}

const sound = (t: Timeline): SoundClip => findClip(t, 's.1')!.clip as SoundClip

describe('a fade dragged on a sound clip', () => {
  it('fades in from its start, inside it, as long as it is dragged', () => {
    const t = setFade(song(), 's.1', 'in', 45)
    expect(sound(t).transitionIn).toMatchObject({ length: 45, before: 0 })
    expect(sound(t).transitionOut).toBeUndefined()
  })

  it('fades out to its end, inside it', () => {
    expect(sound(setFade(song(), 's.1', 'out', 20)).transitionOut).toMatchObject({ length: 20, before: 20 })
  })

  it('changes the length of the fade already there, keeping its kind', () => {
    let t = addTransition(song(), 's.1', 'in', { kind: 'linear', length: 10, alone: true })
    t = setFade(t, 's.1', 'in', 60)
    expect(sound(t).transitionIn).toMatchObject({ kind: 'linear', length: 60, before: 0 })
  })

  it('is taken away when dragged back to nothing', () => {
    const t = setFade(setFade(song(), 's.1', 'in', 30), 's.1', 'in', 0)
    expect(sound(t).transitionIn).toBeUndefined()
  })

  it('is no longer than half the clip, so a fade in and a fade out never overlap', () => {
    const length = sound(song()).sourceOut - sound(song()).sourceIn
    expect(sound(setFade(song(), 's.1', 'in', 100_000)).transitionIn!.length).toBe(Math.floor(length / 2))
  })

  it('does nothing to a picture, or to a clip that is not there', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [{ ...media('rec'), width: 1920, height: 1080, fps: 30, codec: 'h264' }]
    }
    t = addSource(t, { mediaId: 'rec', clipId: 'c' })
    expect(setFade(t, 'c', 'in', 30)).toEqual(t)
    expect(setFade(t, 'gone', 'in', 30)).toEqual(t)
  })

  it('fades only the sound, never the picture linked to it', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [{ ...media('rec'), width: 1920, height: 1080, fps: 30, codec: 'h264' }]
    }
    t = addSource(t, { mediaId: 'rec', clipId: 'c' })
    const s = t.audioTracks[0]!.clips[0]!
    t = setFade(t, s.id, 'in', 30)
    expect((findClip(t, s.id)!.clip as SoundClip).transitionIn).toBeDefined()
    expect(findClip(t, 'c')!.clip.transitionIn).toBeUndefined()
  })
})

describe('a fade on a recording\'s own sound, in the export', () => {
  it('is written, and not lost to the chain that reads the sound straight out of the picture', async () => {
    const { planRender } = await import('../../src/shared/render-plan')
    const { presetById } = await import('../../src/shared/presets')
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }),
      media: [{ ...media('rec'), width: 1920, height: 1080, fps: 30, codec: 'h264' }]
    }
    t = addSource(t, { mediaId: 'rec', clipId: 'c' })
    const s = t.audioTracks[0]!.clips[0]!
    t = setFade(setFade(t, s.id, 'in', 30), s.id, 'out', 15)
    const plan = planRender({
      timeline: t,
      names: { project: 'p', sequence: 's', joined: 'p' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: 'D:\out',
      scratchDir: 'D:\out\.s',
      filenamePattern: '{project}'
    })
    const graph = plan.segments.map((x) => x.args[x.args.indexOf('-filter_complex') + 1]).join(';')
    expect(graph).toContain('afade=t=in:curve=')
    expect(graph).toContain('afade=t=out:curve=')
  })
})
