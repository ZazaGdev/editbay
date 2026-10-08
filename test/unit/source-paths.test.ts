import { describe, it, expect } from 'vitest'
import { MEDIA_FIELDS, insideDir, mayUse, pathKind, shareOf, sharesToAsk, usableProject, withUsablePaths, withWithheld, type PathRules } from '../../src/shared/source-paths'
import type { ProjectMedia } from '../../src/shared/project'
import { defaultWorkspace, type Workspace } from '../../src/shared/workspace'

function media(path: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id: 'a',
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
    peaksPath: 'C:\\cache\\k\\peaks.bin',
    filmstripPath: 'C:\\cache\\k\\filmstrip.jpg',
    ...overrides
  }
}

const none = new Set<string>()
const rules: PathRules = { allowed: none, offlineDir: 'C:\\app\\offline', cacheDir: 'C:\\cache' }

describe('what kind of path a project names', () => {
  it('knows a drive path, whichever way its slashes lean', () => {
    expect(pathKind('D:\\Trip\\a.mp4')).toBe('local')
    expect(pathKind('d:/trip/a.mp4')).toBe('local')
  })

  it('knows a file on another computer', () => {
    expect(pathKind('\\\\nas\\footage\\a.mp4')).toBe('share')
    expect(pathKind('//nas/footage/a.mp4')).toBe('share')
    expect(shareOf('\\\\NAS\\Footage\\day 1\\a.mp4')).toBe('\\\\nas\\footage')
  })

  it('uses nothing else: URLs, device paths, paths with no drive', () => {
    for (const p of [
      'http://attacker.example/a.mp4',
      'file:////attacker/s/a.mp4',
      'concat:C:\\a.mp4|C:\\b.mp4',
      '\\\\?\\UNC\\attacker\\s\\a.mp4',
      '\\\\.\\pipe\\x',
      '\\Windows\\a.mp4',
      'a.mp4',
      'C:\\a.mp4\0.txt'
    ]) {
      expect(pathKind(p)).toBe('other')
      expect(mayUse(p, none)).toBe(false)
    }
  })

  it('uses a share only once it is allowed', () => {
    expect(mayUse('\\\\nas\\footage\\a.mp4', none)).toBe(false)
    expect(mayUse('\\\\nas\\footage\\a.mp4', new Set(['\\\\nas\\footage']))).toBe(true)
    expect(mayUse('\\\\nas\\other\\a.mp4', new Set(['\\\\nas\\footage']))).toBe(false)
  })
})

describe('whether a path is inside a folder', () => {
  it('goes by what Windows opens, not by how the path is spelled', () => {
    expect(insideDir('C:\\cache\\k\\peaks.bin', 'C:\\cache')).toBe(true)
    expect(insideDir('c:/CACHE/k/peaks.bin', 'C:\\cache\\')).toBe(true)
    expect(insideDir('C:\\cache', 'C:\\cache')).toBe(false)
    expect(insideDir('C:\\cache-other\\a', 'C:\\cache')).toBe(false)
    expect(insideDir('C:\\cache\\..\\Windows\\a', 'C:\\cache')).toBe(false)
  })
})

describe('the shares to ask about', () => {
  it('names each share a source is on once, and leaves out those allowed', () => {
    const list = [
      media('\\\\nas\\footage\\a.mp4'),
      media('\\\\NAS\\footage\\b.mp4'),
      media('C:\\cache\\k\\conformed.mp4', { originalPath: '\\\\cam\\card\\c.mp4', conformed: true }),
      media('\\\\home\\ok\\c.mp4')
    ]
    expect(sharesToAsk(list, new Set(['\\\\home\\ok']))).toEqual(['\\\\nas\\footage', '\\\\cam\\card'])
  })

  it('does not ask about what was made from a source, which is kept only in the cache whatever the answer', () => {
    expect(sharesToAsk([media('D:\\a.mp4', { peaksPath: '\\\\evil\\s\\peaks.bin' })], none)).toEqual([])
  })

  it('takes only a plain name or address as the computer, so the one asked about is the one reached', () => {
    expect(shareOf('\\\\;LanmanRedirector\\evil\\a.mp4')).toBeNull()
    expect(pathKind('\\\\;LanmanRedirector\\evil\\a.mp4')).toBe('other')
    expect(shareOf('\\\\192.168.1.5\\footage\\a.mp4')).toBe('\\\\192.168.1.5\\footage')
    expect(shareOf('\\\\files.example.com@SSL\\dav\\a.mp4')).toBe('\\\\files.example.com@ssl\\dav')
  })
})

describe('a whole project with the paths it may not use taken out', () => {
  const ws = (folder: string | null): Workspace => ({ ...defaultWorkspace(), export: { ...defaultWorkspace().export, folder } })

  it('forgets an export folder on a share not allowed, and keeps one that is fine', () => {
    expect(usableProject([], ws('\\\\evil\\drop'), rules).workspace.export.folder).toBeNull()
    expect(usableProject([], ws('http://evil/drop'), rules).workspace.export.folder).toBeNull()
    expect(usableProject([], ws('D:\\Exports'), rules).workspace.export.folder).toBe('D:\\Exports')
    expect(usableProject([], ws(null), rules).workspace.export.folder).toBeNull()
  })

  it('remembers where each source kept offline really was', () => {
    const { withheld } = usableProject([media('\\\\nas\\footage\\a.mp4'), media('D:\\b.mp4', { id: 'b' })], ws(null), rules)
    expect([...withheld]).toEqual([['a', { originalPath: '\\\\nas\\footage\\a.mp4', playablePath: '\\\\nas\\footage\\a.mp4' }]])
  })

  it('writes a source still kept offline back where it really was, and one found since where it was found', () => {
    const { media: opened, withheld } = usableProject([media('\\\\nas\\footage\\a.mp4'), media('\\\\nas\\footage\\b.mp4', { id: 'b' })], ws(null), rules)
    const found = opened.map((m) => (m.id === 'b' ? { ...m, originalPath: 'E:\\b.mp4', playablePath: 'E:\\b.mp4' } : m))
    expect(withWithheld(found, withheld, rules.offlineDir).map((m) => m.originalPath)).toEqual(['\\\\nas\\footage\\a.mp4', 'E:\\b.mp4'])
    expect(withWithheld(found, withheld, rules.offlineDir)[0]!.playablePath).toBe('\\\\nas\\footage\\a.mp4')
  })
})

describe('a source with the paths it may not use taken out', () => {
  it('is left alone when every path is usable', () => {
    const m = media('D:\\Trip\\a.mp4')
    expect(withUsablePaths(m, rules)).toBe(m)
  })

  it('opens as missing, keeping its file name, when it is on a share not allowed', () => {
    const m = withUsablePaths(media('\\\\attacker\\s\\Holiday.mp4'), rules)
    expect(m.originalPath).toBe('C:\\app\\offline\\Holiday.mp4')
    expect(m.playablePath).toBe('C:\\app\\offline\\Holiday.mp4')
  })

  it('opens as missing when it is a playlist, which would send ffmpeg wherever it names (audit 2026-10-08)', () => {
    for (const name of ['clip.m3u8', 'clip.M3U', 'clip.mpd']) {
      const m = withUsablePaths(media(`C:\\p\\${name}`), rules)
      expect(m.originalPath).toBe(`C:\\app\\offline\\${name}`)
      expect(m.playablePath).toBe(`C:\\app\\offline\\${name}`)
    }
  })

  it('opens from a share that is allowed', () => {
    const m = media('\\\\nas\\footage\\a.mp4')
    expect(withUsablePaths(m, { ...rules, allowed: new Set(['\\\\nas\\footage']) })).toBe(m)
  })

  it('keeps a conformed source playing from the cache when only its original is out of reach', () => {
    const m = withUsablePaths(media('C:\\cache\\k\\conformed.mp4', { originalPath: 'http://x/a.mp4', conformed: true }), rules)
    expect(m.playablePath).toBe('C:\\cache\\k\\conformed.mp4')
    expect(m.originalPath).toBe('C:\\app\\offline\\a.mp4')
  })

  it('drops what was made from it, to be made again in the app\'s own cache', () => {
    const m = withUsablePaths(
      media('D:\\a.mp4', {
        peaksPath: '\\\\evil\\s\\peaks.bin',
        filmstripPath: 'http://evil/f.jpg',
        soundCopy: '\\\\evil\\s\\sound.m4a',
        trackFiles: [{ path: 'C:\\cache\\k\\track-2.m4a', peaksPath: '\\\\evil\\s\\p2.bin' }]
      }),
      rules
    )
    expect(m.originalPath).toBe('D:\\a.mp4')
    expect(m.peaksPath).toBe('')
    expect(m.filmstripPath).toBe('')
    expect(m.soundCopy).toBeUndefined()
    expect(m.trackFiles).toBeUndefined()
  })

  it('forgets a track cleaned of noise anywhere but the cache, and keeps one in it', () => {
    const inCache = [{ track: 0, path: 'C:\\cache\\k\\cleaned-1.m4a' }]
    const kept = media('D:\\a.mp4', { cleaned: inCache })
    expect(withUsablePaths(kept, rules)).toBe(kept)
    const outside = withUsablePaths(media('D:\\a.mp4', { cleaned: [{ track: 0, path: '\\\\evil\\s\\cleaned.m4a' }] }), rules)
    expect(outside.cleaned).toBeUndefined()
    expect(outside.originalPath).toBe('D:\\a.mp4')
  })

  it('forgets a track treated for breaths or clicks anywhere but the cache, and keeps one in it', () => {
    const inCache = [{ track: 0, recipe: 'r', path: 'C:\\cache\\k\\treated-1.m4a' }]
    const kept = media('D:\\a.mp4', { treated: inCache })
    expect(withUsablePaths(kept, rules)).toBe(kept)
    const outside = withUsablePaths(media('D:\\a.mp4', { treated: [{ track: 0, recipe: 'r', path: '\\\\evil\\s\\a.m4a' }] }), rules)
    expect(outside.treated).toBeUndefined()
    expect(outside.originalPath).toBe('D:\\a.mp4')
  })

  it('checks every field that names a file, so a new one cannot slip past', () => {
    // One file on another computer for each field that names a file. A field
    // marked as naming one in MEDIA_FIELDS needs an entry here, and the entry
    // has to be taken out, or this fails.
    const evil = '\\\\evil\\s\\a.m4a'
    const samples: Partial<ProjectMedia> = {
      originalPath: evil,
      playablePath: evil,
      peaksPath: evil,
      filmstripPath: evil,
      soundCopy: evil,
      cleaned: [{ track: 0, path: evil }],
      enhanced: [{ track: 0, recipe: 'r', path: evil }],
      treated: [{ track: 0, recipe: 'r', path: evil }],
      trackFiles: [{ path: evil, peaksPath: 'C:\\cache\\k\\p.bin' }],
      copying: [{ path: 'C:\\cache\\k\\t.m4a', peaksPath: evil }]
    }
    const files = Object.entries(MEDIA_FIELDS).filter(([, kind]) => kind === 'file').map(([key]) => key)
    expect(Object.keys(samples).sort()).toEqual(files.sort())
    for (const key of files) {
      const m = withUsablePaths(media('D:\\a.mp4', { [key]: samples[key as keyof ProjectMedia] }), rules)
      expect(JSON.stringify(m), key).not.toContain('evil')
    }
  })

  it('writes what it makes only in the app\'s own cache', () => {
    // A waveform is written where the project says when it is missing, and its
    // bytes follow the sound, so a project naming the Startup folder could
    // have the app write a script there.
    const startup = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat'
    const m = withUsablePaths(
      media('D:\\a.mp4', {
        peaksPath: startup,
        filmstripPath: 'C:\\cache\\..\\Windows\\f.jpg',
        trackFiles: [{ path: 'C:\\cache\\k\\track-2.m4a', peaksPath: startup }]
      }),
      rules
    )
    expect(m.peaksPath).toBe('')
    expect(m.filmstripPath).toBe('')
    expect(m.trackFiles).toBeUndefined()
  })

  it('gives a name Windows accepts to a path that was never a file', () => {
    expect(withUsablePaths(media('concat:a|b'), rules).originalPath).toBe('C:\\app\\offline\\concat_a_b')
    expect(withUsablePaths(media('\\\\.\\'), rules).originalPath).toBe('C:\\app\\offline\\missing')
  })

  it('leaves a text, which has no original, with none', () => {
    const m = withUsablePaths(media('C:\\cache\\text\\k.png', { originalPath: '', peaksPath: '\\\\evil\\s\\p.bin' }), rules)
    expect(m.originalPath).toBe('')
    expect(m.playablePath).toBe('C:\\cache\\text\\k.png')
  })
})
