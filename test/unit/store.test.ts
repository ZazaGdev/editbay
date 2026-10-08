import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SourceAccess } from '../../src/main/project/store'
import { serialiseProject, parseProject, saveProjectTo, loadProjectFrom } from '../../src/main/project/store'
import { createProject, setClipIn, editSequence, v1Clips, SCHEMA_VERSION, type ProjectMedia } from '../../src/shared/project'
import { S1, clipsOf, firstTimeline, addClipTo } from '../project-helpers'
import { defaultWorkspace } from '../../src/shared/workspace'

/** Opens as if everything the project names were on this computer, in a cache that holds the whole temp folder. */
const anywhere: SourceAccess = { allowed: new Set(), cacheDir: tmpdir(), offlineDir: join(tmpdir(), 'offline'), ask: async () => [] }

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-store-'))
  dirs.push(dir)
  return dir
}

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
    peaksPath: join(path, '..', 'peaks.bin'),
    filmstripPath: join(path, '..', 'strip.jpg')
  }
}

describe('serialise and parse', () => {
  it('round trip preserves every edit', () => {
    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', 'C:\\v\\a.mp4')] }
    p = addClipTo(p, 'a')
    p = editSequence(p, S1, (t) => setClipIn(t, v1Clips(t)[0]!.id, 42))

    expect(parseProject(serialiseProject(p))).toEqual(p)
  })

  it('rejects something that is not a project', () => {
    expect(() => parseProject('{"hello":true}')).toThrow(/not a .*project/i)
    expect(() => parseProject('not json at all')).toThrow()
  })

  it('rejects a document whose clips are not a list', () => {
    expect(() => parseProject('{"schemaVersion":1,"clips":"nope","media":[]}')).toThrow(/not a .*project/i)
  })

  it('refuses a document from a newer version of the app', () => {
    const p = createProject('demo', 30, { width: 1080, height: 1920 })
    const future = JSON.stringify({ ...p, schemaVersion: SCHEMA_VERSION + 1 })
    expect(() => parseProject(future)).toThrow(/newer version/i)
  })

  it('fills in a field an older document did not have', () => {
    const old = { schemaVersion: 1, fps: 30, media: [], clips: [] }
    const back = parseProject(JSON.stringify(old))
    expect(firstTimeline(back).output).toEqual({ width: 1080, height: 1920 })
    expect(back.name).toBe('Untitled')
  })

  it('stamps the current schema version onto whatever it read', () => {
    // A document as old as schema 0: one timeline, its clips at the top.
    const old = JSON.stringify({ schemaVersion: 0, name: 'demo', fps: 30, output: { width: 1080, height: 1920 }, media: [], clips: [] })
    expect(parseProject(old).schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('saveProjectTo and loadProjectFrom', () => {
  it('writes a file that loads back identically', async () => {
    const dir = await workDir()
    const file = join(dir, 'demo.editbay')
    const source = join(dir, 'a.mp4')
    await writeFile(source, 'pretend this is video')

    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', source)] }
    p = addClipTo(p, 'a')

    await saveProjectTo(p, file)
    const loaded = await loadProjectFrom(file, anywhere)
    expect(loaded.project).toEqual(p)
    expect(loaded.missingMedia).toEqual([])
  })

  it('reports media whose file has gone, and keeps the edit', async () => {
    const dir = await workDir()
    const file = join(dir, 'demo.editbay')
    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', join(dir, 'never-existed.mp4'))] }
    p = addClipTo(p, 'a')

    await saveProjectTo(p, file)
    const loaded = await loadProjectFrom(file, anywhere)
    expect(loaded.missingMedia).toEqual(['a'])
    // A missing file is something to fix, not a reason to throw away the cut.
    expect(clipsOf(loaded.project)).toHaveLength(1)
  })

  it('writes readable json, because this file outlives the app', async () => {
    const dir = await workDir()
    const file = join(dir, 'demo.editbay')
    await saveProjectTo(createProject('demo', 30, { width: 1080, height: 1920 }), file)
    expect((await readFile(file)).toString()).toContain('\n  ')
  })

  it('replaces an earlier save rather than appending to it', async () => {
    const dir = await workDir()
    const file = join(dir, 'demo.editbay')
    await saveProjectTo(createProject('first', 30, { width: 1080, height: 1920 }), file)
    await saveProjectTo(createProject('second', 30, { width: 1080, height: 1920 }), file)
    expect((await loadProjectFrom(file, anywhere)).project.name).toBe('second')
  })
})

describe('the workspace in the file', () => {
  it('comes back as it was saved', async () => {
    const dir = await workDir()
    const file = join(dir, 'demo.editbay')
    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', join(dir, 'a.mp4'))] }
    p = addClipTo(p, 'a')
    const ws = {
      activeSequenceId: S1,
      timelines: { [S1]: { playhead: 17, selectedClipId: clipsOf(p)[0]!.id, zoom: 8, view: 'program' as const, trackHeights: {} } },
      aspectLocked: false,
      trackSize: 'large' as const,
      monitorVolume: 0.5,
      export: { folder: dir, mode: 'batch' as const, filenamePattern: '{clip}', subtitleFile: false, transcriptFile: false, sharpen: false, fast: false, fileNames: {} }
    }

    await saveProjectTo(p, file, ws)
    expect((await loadProjectFrom(file, anywhere)).workspace).toEqual(ws)
  })

  it('is the default for a file saved before it existed', async () => {
    const dir = await workDir()
    const file = join(dir, 'old.editbay')
    // A version 1 document: one timeline, its clips at the top, and no workspace.
    await writeFile(file, JSON.stringify({ schemaVersion: 1, name: 'old', fps: 30, output: { width: 1080, height: 1920 }, media: [], clips: [] }))
    expect((await loadProjectFrom(file, anywhere)).workspace).toEqual(defaultWorkspace())
  })
})

describe('moving a folder that holds the project and its footage', () => {
  it('finds the footage in its new place', async () => {
    const dir = await workDir()
    const before = join(dir, 'before')
    await mkdir(join(before, 'footage'), { recursive: true })
    const source = join(before, 'footage', 'a.mp4')
    await writeFile(source, 'pretend this is video')

    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', source)] }
    p = addClipTo(p, 'a')
    await saveProjectTo(p, join(before, 'demo.editbay'))

    const after = join(dir, 'after')
    await rename(before, after)

    const loaded = await loadProjectFrom(join(after, 'demo.editbay'), anywhere)
    expect(loaded.missingMedia).toEqual([])
    expect(loaded.project.media[0]!.originalPath).toBe(join(after, 'footage', 'a.mp4'))
    expect(loaded.project.media[0]!.playablePath).toBe(join(after, 'footage', 'a.mp4'))
  })

  it('still finds footage that stayed where it was', async () => {
    const dir = await workDir()
    const source = join(dir, 'a.mp4')
    await writeFile(source, 'pretend this is video')
    await mkdir(join(dir, 'projects'))

    let p = createProject('demo', 30, { width: 1080, height: 1920 })
    p = { ...p, media: [media('a', source)] }
    await saveProjectTo(p, join(dir, 'projects', 'demo.editbay'))
    await rename(join(dir, 'projects'), join(dir, 'moved'))

    const loaded = await loadProjectFrom(join(dir, 'moved', 'demo.editbay'), anywhere)
    expect(loaded.project.media[0]!.originalPath).toBe(source)
    expect(loaded.missingMedia).toEqual([])
  })
})

describe('a project someone else made', () => {
  /** A project file naming `m`, as anyone could write one. */
  async function crafted(m: ProjectMedia): Promise<{ file: string; dir: string }> {
    const dir = await workDir()
    const file = join(dir, 'sent.editbay')
    let p = createProject('sent', 30, { width: 1080, height: 1920 })
    p = addClipTo({ ...p, media: [m] }, m.id)
    await saveProjectTo(p, file)
    return { file, dir }
  }

  it('asks before touching a file on another computer, and keeps it offline unless allowed', async () => {
    const { file, dir } = await crafted(media('a', '\\\\attacker.invalid\\s\\Holiday.mp4'))
    const asked: string[][] = []
    const access: SourceAccess = {
      allowed: new Set(),
      cacheDir: dir,
      offlineDir: join(dir, 'offline'),
      ask: async (shares) => {
        asked.push(shares)
        return []
      }
    }
    const loaded = await loadProjectFrom(file, access)
    expect(asked).toEqual([['\\\\attacker.invalid\\s']])
    expect(loaded.project.media[0]!.originalPath).toBe(join(dir, 'offline', 'Holiday.mp4'))
    expect(loaded.project.media[0]!.playablePath).toBe(join(dir, 'offline', 'Holiday.mp4'))
    expect(loaded.missingMedia).toEqual(['a'])
    // The cut stays: the source can be found again.
    expect(clipsOf(loaded.project)).toHaveLength(1)
  })

  it('forgets an export folder on another computer, which the Export window would check for files', async () => {
    const dir = await workDir()
    const file = join(dir, 'sent.editbay')
    const ws = { ...defaultWorkspace(), export: { ...defaultWorkspace().export, folder: '\\\\attacker.invalid\\drop' } }
    await saveProjectTo(createProject('sent', 30, { width: 1080, height: 1920 }), file, ws)
    expect((await loadProjectFrom(file, { ...anywhere, cacheDir: dir })).workspace.export.folder).toBeNull()
  })

  it('remembers where a source kept offline really was, so saving never loses it', async () => {
    const { file, dir } = await crafted(media('a', '\\\\nas.invalid\\footage\\Holiday.mp4'))
    const loaded = await loadProjectFrom(file, { ...anywhere, cacheDir: dir, offlineDir: join(dir, 'offline') })
    expect(loaded.withheld.get('a')?.originalPath).toBe('\\\\nas.invalid\\footage\\Holiday.mp4')
  })

  it('never uses a URL or a device path, and does not ask about one', async () => {
    const { file, dir } = await crafted(media('a', 'http://attacker.invalid/a.mp4'))
    let asked = false
    const loaded = await loadProjectFrom(file, { ...anywhere, cacheDir: dir, offlineDir: join(dir, 'offline'), ask: async () => ((asked = true), []) })
    expect(asked).toBe(false)
    expect(loaded.project.media[0]!.originalPath).toBe(join(dir, 'offline', 'a.mp4'))
  })

  it('keeps nothing made from a source outside the app\'s own cache, so nothing is written there', async () => {
    const source = join(await workDir(), 'a.mp4')
    await writeFile(source, 'pretend this is video')
    const startup = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat'
    const { file, dir } = await crafted({ ...media('a', source), peaksPath: startup, filmstripPath: startup })
    const loaded = await loadProjectFrom(file, { ...anywhere, cacheDir: join(dir, 'cache') })
    expect(loaded.project.media[0]!.originalPath).toBe(source)
    expect(loaded.project.media[0]!.peaksPath).toBe('')
    expect(loaded.project.media[0]!.filmstripPath).toBe('')
  })
})

describe('projects saved before the output shape existed', () => {
  /** A version 1 document, from before sequences, with whatever shape field it had. */
  const v1 = (extra: Record<string, unknown>): string =>
    JSON.stringify({ schemaVersion: 1, name: 'demo', fps: 30, output: { width: 1080, height: 1920 }, media: [], clips: [], ...extra })

  it('load as vertical, which is what they were effectively using', () => {
    expect(firstTimeline(parseProject(v1({}))).presetId).toBe('vertical')
  })

  it('keep a shape they did save', () => {
    expect(firstTimeline(parseProject(v1({ presetId: 'square' }))).presetId).toBe('square')
  })

  it('fall back to vertical rather than failing on a shape that no longer exists', () => {
    expect(firstTimeline(parseProject(v1({ presetId: 'retired' }))).presetId).toBe('vertical')
  })
})
