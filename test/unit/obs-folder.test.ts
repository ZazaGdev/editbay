import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { iniPath, obsRecordingFolder, parseIni, recordingFolderIn } from '../../src/main/obs/obs-folder'

const APPDATA = 'C:\\Users\\me\\AppData\\Roaming'

/** A reader over a few files, by path; anything else cannot be read. */
function files(entries: Record<string, string>): (path: string) => Promise<string | null> {
  const byPath = new Map(Object.entries(entries).map(([k, v]) => [join(k), v]))
  return async (path) => byPath.get(join(path)) ?? null
}

const profile = (dir: string, base = APPDATA): string => join(base, 'obs-studio', 'basic', 'profiles', dir, 'basic.ini')

describe('parseIni', () => {
  it('reads sections and keys, past a byte order mark, blank lines and comments', () => {
    const ini = parseIni('\uFEFF[General]\r\nName=Editbay\r\n\r\n; a comment\r\n[Output]\r\nMode = Advanced\r\n')
    expect(ini.get('General')?.get('Name')).toBe('Editbay')
    expect(ini.get('Output')?.get('Mode')).toBe('Advanced')
  })

  it('keeps an equals sign inside a value', () => {
    expect(parseIni('[A]\nkey=a=b').get('A')?.get('key')).toBe('a=b')
  })
})

describe('iniPath', () => {
  it('undoes the doubled backslashes OBS writes', () => {
    expect(iniPath('C:\\\\Users\\\\me\\\\Videos')).toBe('C:\\Users\\me\\Videos')
  })

  it('leaves forward slashes as they are', () => {
    expect(iniPath('D:/OBS-recordings')).toBe('D:/OBS-recordings')
  })
})

describe('recordingFolderIn', () => {
  it('takes the Advanced folder in Advanced mode', () => {
    const basic = parseIni('[Output]\nMode=Advanced\n[SimpleOutput]\nFilePath=C:\\\\Videos\n[AdvOut]\nRecFilePath=D:/OBS-recordings')
    expect(recordingFolderIn(basic)).toBe('D:/OBS-recordings')
  })

  it('takes the Simple folder in Simple mode, or when no mode is written', () => {
    const simple = '[SimpleOutput]\nFilePath=C:\\\\Videos\n[AdvOut]\nRecFilePath=D:/OBS-recordings'
    expect(recordingFolderIn(parseIni(`[Output]\nMode=Simple\n${simple}`))).toBe('C:\\Videos')
    expect(recordingFolderIn(parseIni(simple))).toBe('C:\\Videos')
  })

  it('takes the custom ffmpeg output’s folder when Advanced mode records through it', () => {
    const basic = parseIni('[Output]\nMode=Advanced\n[AdvOut]\nRecType=1\nRecFilePath=D:/a\nFFFilePath=E:/b')
    expect(recordingFolderIn(basic)).toBe('E:/b')
  })

  it('says nothing when the folder is not written', () => {
    expect(recordingFolderIn(parseIni('[Output]\nMode=Advanced\n[AdvOut]\nRecFilePath='))).toBeNull()
  })
})

describe('obsRecordingFolder', () => {
  it('follows the profile named in user.ini, as OBS 31 and later write it', async () => {
    const read = files({
      [join(APPDATA, 'obs-studio', 'user.ini')]: '[Basic]\nProfile=Wide recording\nProfileDir=Wide_recording',
      [join(APPDATA, 'obs-studio', 'global.ini')]: '[General]\nFirstRun=true',
      [profile('Wide_recording')]: '[Output]\nMode=Advanced\n[AdvOut]\nRecFilePath=D:/OBS-recordings',
      [profile('Untitled')]: '[SimpleOutput]\nFilePath=C:\\\\Videos'
    })
    expect(await obsRecordingFolder(APPDATA, null, read)).toBe('D:/OBS-recordings')
  })

  it('falls back to global.ini for older versions', async () => {
    const read = files({
      [join(APPDATA, 'obs-studio', 'global.ini')]: '[Basic]\nProfileDir=Untitled',
      [profile('Untitled')]: '[SimpleOutput]\nFilePath=C:\\\\Users\\\\me\\\\Videos'
    })
    expect(await obsRecordingFolder(APPDATA, null, read)).toBe('C:\\Users\\me\\Videos')
  })

  it('finds the profiles where [Locations] has moved them', async () => {
    const read = files({
      [join(APPDATA, 'obs-studio', 'user.ini')]: '[Basic]\nProfileDir=Mine',
      [join(APPDATA, 'obs-studio', 'global.ini')]: '[Locations]\nProfiles=E:\\\\Portable',
      [profile('Mine', 'E:\\Portable')]: '[SimpleOutput]\nFilePath=E:\\\\Recordings'
    })
    expect(await obsRecordingFolder(APPDATA, null, read)).toBe('E:\\Recordings')
  })

  it('says nothing when OBS is not installed, or its profile is gone', async () => {
    expect(await obsRecordingFolder(APPDATA, 'C:\\Videos', files({}))).toBeNull()
    const read = files({ [join(APPDATA, 'obs-studio', 'user.ini')]: '[Basic]\nProfileDir=Gone' })
    expect(await obsRecordingFolder(APPDATA, 'C:\\Videos', read)).toBeNull()
  })

  it('takes OBS’s own default for a profile that names no folder', async () => {
    const read = files({
      [join(APPDATA, 'obs-studio', 'user.ini')]: '[Basic]\nProfileDir=Fresh',
      [profile('Fresh')]: '[Output]\nMode=Simple'
    })
    expect(await obsRecordingFolder(APPDATA, 'C:\\Users\\me\\Videos', read)).toBe('C:\\Users\\me\\Videos')
  })
})
