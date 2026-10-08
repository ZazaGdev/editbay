import { describe, it, expect } from 'vitest'
import { sourceFiles } from '../../src/shared/export-keep'
import { planRender, samePathKey, type RenderRequest } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'
import { addClip, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'

function media(id: string, path: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
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

function timelineOf(...m: ProjectMedia[]): Timeline {
  const base = createTimeline(30, { width: 1080, height: 1920 })
  return m.reduce((p, x) => addClip({ ...p, media: [...p.media, x] }, x.id), base)
}

function request(timeline: Timeline, overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    timeline,
    names: { project: 'Holiday', sequence: 'Vertical', joined: 'Holiday' },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: 'D:\\Trip',
    scratchDir: 'C:\\temp\\scratch',
    filenamePattern: '{clip}',
    keep: sourceFiles(timeline.media),
    ...overrides
  }
}

const outputsOf = (r: RenderRequest): string[] => planRender(r).outputs.map(samePathKey)

describe('an export beside its own footage', () => {
  it('never takes the name of the recording a project saved beside it is named after', () => {
    // Holiday.editbay beside Holiday.mp4: the joined export is named after the project.
    const t = timelineOf(media('a', 'D:\\Trip\\Holiday.mp4'))
    expect(planRender(request(t)).outputs).toEqual(['D:\\Trip\\Holiday (2).mp4'])
  })

  it('matches names as Windows does, whatever their case and slashes', () => {
    const t = timelineOf(media('a', 'd:/trip/HOLIDAY.MP4'))
    expect(outputsOf(request(t))).not.toContain(samePathKey('D:\\Trip\\Holiday.mp4'))
  })

  it('never takes the name of a clip\'s own recording for a file of its own', () => {
    // A pattern of just the clip's name gives each file its recording's name.
    const t = timelineOf(media('a', 'D:\\Trip\\a.mp4'), media('b', 'D:\\Trip\\b.mp4'))
    const outputs = outputsOf(request(t, { mode: 'batch' }))
    expect(outputs).toHaveLength(2)
    for (const m of t.media) expect(outputs).not.toContain(samePathKey(m.originalPath))
  })

  it('keeps a conformed source\'s original and its copies, not only what plays', () => {
    const m = media('a', 'D:\\cache\\conformed.mp4', {
      originalPath: 'D:\\Trip\\Holiday.mp4',
      conformed: true,
      soundCopy: 'D:\\cache\\sound.m4a',
      trackFiles: [{ path: 'D:\\cache\\track-2.m4a', peaksPath: 'D:\\cache\\peaks-2.bin' }]
    })
    expect(sourceFiles([m])).toEqual(['D:\\Trip\\Holiday.mp4', 'D:\\cache\\conformed.mp4', 'D:\\cache\\sound.m4a', 'D:\\cache\\track-2.m4a'])
  })
})
