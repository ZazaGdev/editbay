import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Where OBS saves its recordings, read from OBS's own settings, so the
 * Recordings list finds them with nothing to set up.
 *
 * OBS keeps its settings in ini files under %APPDATA%\obs-studio. The profile
 * in use is named in user.ini (global.ini before OBS 31), and that profile's
 * basic.ini holds the recording folder: [AdvOut] RecFilePath in Advanced
 * output mode, [SimpleOutput] FilePath in Simple mode, and [AdvOut] FFFilePath
 * when Advanced mode records through a custom ffmpeg output.
 */

export type Ini = Map<string, Map<string, string>>

/** An ini file's sections and keys. Later keys win; a byte order mark and comments are ignored. */
export function parseIni(text: string): Ini {
  const ini: Ini = new Map()
  let section = new Map<string, string>()
  ini.set('', section)
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    const heading = line.match(/^\[(.*)\]$/)
    if (heading) {
      section = ini.get(heading[1]!) ?? new Map()
      ini.set(heading[1]!, section)
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) section.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  return ini
}

/** OBS writes each backslash in a path twice. */
export function iniPath(value: string): string {
  return value.replace(/\\\\/g, '\\')
}

function value(ini: Ini | null, section: string, key: string): string | undefined {
  const v = ini?.get(section)?.get(key)
  return v === undefined || v === '' ? undefined : v
}

/** The recording folder a profile's basic.ini names, or null when it names none. */
export function recordingFolderIn(basic: Ini): string | null {
  const advanced = value(basic, 'Output', 'Mode') === 'Advanced'
  if (advanced) {
    // RecType 1 is a custom ffmpeg output, which keeps its own folder.
    const custom = value(basic, 'AdvOut', 'RecType') === '1'
    const path = custom ? value(basic, 'AdvOut', 'FFFilePath') : value(basic, 'AdvOut', 'RecFilePath')
    return path ? iniPath(path) : null
  }
  const path = value(basic, 'SimpleOutput', 'FilePath')
  return path ? iniPath(path) : null
}

/** Reads a file as text, or null when it cannot be read. */
export type TextReader = (path: string) => Promise<string | null>

const readText: TextReader = (path) => readFile(path, 'utf8').catch(() => null)

/**
 * The folder OBS records to, from the profile in use, or null when OBS is not
 * installed. A profile that names no folder records to OBS's own default,
 * `otherwise`, when given.
 */
export async function obsRecordingFolder(
  appData: string,
  otherwise: string | null = null,
  read: TextReader = readText
): Promise<string | null> {
  const home = join(appData, 'obs-studio')
  const user = await read(join(home, 'user.ini'))
  const global = await read(join(home, 'global.ini'))
  const userIni = user === null ? null : parseIni(user)
  const globalIni = global === null ? null : parseIni(global)
  const profileDir = value(userIni, 'Basic', 'ProfileDir') ?? value(globalIni, 'Basic', 'ProfileDir')
  if (!profileDir) return null
  // [Locations] Profiles moves the profiles away from %APPDATA%, keeping the same layout under it.
  const base = value(globalIni, 'Locations', 'Profiles') ?? value(userIni, 'Locations', 'Profiles')
  const profiles = join(base ? iniPath(base) : appData, 'obs-studio', 'basic', 'profiles')
  const basic = await read(join(profiles, profileDir, 'basic.ini'))
  return basic === null ? null : (recordingFolderIn(parseIni(basic)) ?? otherwise)
}
