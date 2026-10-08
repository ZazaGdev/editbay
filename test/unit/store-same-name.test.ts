import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, copyFile, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveProjectTo, loadProjectFrom, type SourceAccess } from '../../src/main/project/store'
import { createProject, type ProjectMedia } from '../../src/shared/project'
import { addClipTo } from '../project-helpers'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const anywhere: SourceAccess = { allowed: new Set(), cacheDir: tmpdir(), offlineDir: join(tmpdir(), 'offline'), ask: async () => [] }

function media(id: string, path: string): ProjectMedia {
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
    filmstripPath: ''
  }
}

describe('a project copied beside a different recording of the same name', () => {
  it('keeps using the recording it was cut from while that is still there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'editbay-same-name-'))
    dirs.push(dir)
    // Day 1's project and card; Day 2's card has a first file named just the same.
    await mkdir(join(dir, 'Day1'))
    await mkdir(join(dir, 'Day2'))
    const day1 = join(dir, 'Day1', 'GX010001.MP4')
    const day2 = join(dir, 'Day2', 'GX010001.MP4')
    await writeFile(day1, 'day one')
    await writeFile(day2, 'the second day, longer')

    let p = createProject('edit', 30, { width: 1080, height: 1920 })
    p = addClipTo({ ...p, media: [media('a', day1)] }, 'a')
    await saveProjectTo(p, join(dir, 'Day1', 'edit.editbay'))
    await copyFile(join(dir, 'Day1', 'edit.editbay'), join(dir, 'Day2', 'edit.editbay'))

    const loaded = await loadProjectFrom(join(dir, 'Day2', 'edit.editbay'), anywhere)
    expect(loaded.project.media[0]!.originalPath).toBe(day1)
  })
})

describe('a project folder copied somewhere else, footage and all', () => {
  it('uses its own copy of the footage while the old folder is still there, so it keeps working once that goes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'editbay-copied-'))
    dirs.push(dir)
    await mkdir(join(dir, 'Proj'))
    await mkdir(join(dir, 'Copy'))
    const original = join(dir, 'Proj', 'clip.mp4')
    const copied = join(dir, 'Copy', 'clip.mp4')
    await writeFile(original, 'the footage')
    let p = createProject('edit', 30, { width: 1080, height: 1920 })
    p = addClipTo({ ...p, media: [media('a', original)] }, 'a')
    await saveProjectTo(p, join(dir, 'Proj', 'edit.editbay'))
    // Copied as Explorer copies: the same bytes, the same time changed.
    await copyFile(original, copied)
    const was = await stat(original)
    await utimes(copied, was.atime, was.mtime)
    await copyFile(join(dir, 'Proj', 'edit.editbay'), join(dir, 'Copy', 'edit.editbay'))

    const loaded = await loadProjectFrom(join(dir, 'Copy', 'edit.editbay'), anywhere)
    expect(loaded.project.media[0]!.originalPath).toBe(copied)
  })
})
