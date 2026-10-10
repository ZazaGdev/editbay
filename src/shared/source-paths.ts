import type { ProjectMedia, TrackFile } from './project'
import type { Workspace } from './workspace'

/**
 * Which paths a project file may make the app touch.
 *
 * A project names its files by absolute path, and opening one checks each of
 * them. Were one of those paths on another computer, `\\host\share\a.mp4`,
 * checking it would connect to that computer, and Windows signs in to a share
 * with the user's own account, handing it something an attacker can crack or
 * pass on. So a project sent by someone else could reach out the moment it
 * was opened. A path on a share is used only once the user has allowed that
 * share; anything that is not a drive path or a share, a URL or a device
 * path, is never used.
 *
 * What was made from a source, its waveform, filmstrip and copies, is also
 * written when it is missing, to the path the project names. So those paths
 * are only kept when they are in the app's own cache: anywhere else, a
 * project could have the app write a file of its choosing where it liked.
 */

export type PathKind = 'local' | 'share' | 'other'

const LOCAL = /^[A-Za-z]:[\\/]/
// Two slashes, a host and a share. A host of `?` or `.` is a device path
// (`\\?\`, `\\.\`), which is not a share. A host is a name or an address,
// with `@` for a WebDAV one like `host@SSL`: anything else, such as a
// `;Redirector` prefix, would show the user one name and reach another.
const SHARE = /^[\\/]{2}([A-Za-z0-9][A-Za-z0-9.\-@_]*)[\\/]([^\\/]+)/

export function pathKind(path: string): PathKind {
  if (path.includes('\0')) return 'other'
  if (LOCAL.test(path)) return 'local'
  if (SHARE.test(path)) return 'share'
  return 'other'
}

/** The share a path is on, as `\\host\share` in lower case, or null for one that is not on a share. */
export function shareOf(path: string): string | null {
  if (pathKind(path) !== 'share') return null
  const m = path.match(SHARE)
  return m ? `\\\\${(m[1] ?? '').toLowerCase()}\\${(m[2] ?? '').toLowerCase()}` : null
}

/** Whether the app may touch `path`: a drive path, or one on a share in `allowed`. */
export function mayUse(path: string, allowed: ReadonlySet<string>): boolean {
  const kind = pathKind(path)
  if (kind === 'local') return true
  if (kind === 'other') return false
  const share = shareOf(path)
  return share !== null && allowed.has(share)
}

/**
 * Whether `path` is inside `dir`, by what Windows would open rather than by
 * how it is spelled: `..` could climb out of a folder the path starts in.
 */
export function insideDir(path: string, dir: string): boolean {
  const parts = (p: string): string[] => p.toLowerCase().split(/[\\/]+/).filter((x) => x !== '')
  const inner = parts(path)
  const outer = parts(dir)
  if (inner.some((x) => x === '..' || x === '.')) return false
  return inner.length > outer.length && outer.every((x, i) => inner[i] === x)
}

export interface PathRules {
  /** The shares the user has allowed, as `shareOf` gives them. */
  allowed: ReadonlySet<string>
  /** Where a source out of reach is said to be: a folder of the app's own, with nothing in it. */
  offlineDir: string
  /** The app's own cache, the only place what is made from a source is written. */
  cacheDir: string
}

/**
 * The shares a project's sources are on that are not yet allowed, each once.
 * Only where the sources themselves are: what was made from them is kept
 * only in the app's own cache, whatever the answer, so it is not asked about.
 */
export function sharesToAsk(media: readonly ProjectMedia[], allowed: ReadonlySet<string>): string[] {
  const out = new Set<string>()
  for (const m of media) {
    for (const p of [m.originalPath, m.playablePath]) {
      const share = shareOf(p)
      if (share !== null && !allowed.has(share)) out.add(share)
    }
  }
  return [...out]
}

/**
 * A playlist names other files, wherever they are, and ffmpeg reads them: a
 * project naming one as a source could have it reach out to another computer
 * (audit 2026-10-08). No recording is one, so a source that is opens as missing.
 */
// Windows drops dots and spaces at the end of a name when it opens a file, so
// `clip.m3u8.` opens `clip.m3u8` (audit 2026-10-10).
const PLAYLIST = /\.(m3u8?|mpd)[. ]*$/i

/**
 * Whether a file's first bytes are a playlist's, whatever it is called: the
 * window's own player reads one named `.mp4` too, and follows what it names
 * (audit 2026-10-10). An HLS playlist starts `#EXTM3U`, a DASH one is XML
 * whose first element is `MPD`.
 */
export function looksLikePlaylist(head: string): boolean {
  const text = head.replace(/^\uFEFF/, '').trimStart()
  if (text.startsWith('#EXTM3U')) return true
  return /^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w.-]*:)?MPD[\s>]/.test(text)
}

/**
 * The path a `file:` URL opens on Windows, or null for one that is not a
 * `file:` URL or cannot be read. `file://host/share/a.ts` is the share
 * `\\host\share`, as is `file:////host/share/a.ts`.
 */
export function fileUrlPath(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'file:') return null
  let path: string
  try {
    path = decodeURIComponent(u.pathname)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host !== '' && host !== 'localhost') return `\\\\${host}${path.replace(/\//g, '\\')}`
  // `/C:/a.mp4` is the drive path; anything else keeps its leading slashes, so `//host/share` is a share.
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

/**
 * Whether the window may load `url`: anything that is not a `file:` URL,
 * which the page's own rules govern, and a `file:` URL only on a drive or on
 * a share in `allowed`. A playlist the window's player reads can name a file
 * on any computer, and loading it signs in there with the user's Windows
 * account (audit 2026-10-10).
 */
export function mayLoad(url: string, allowed: ReadonlySet<string>): boolean {
  if (!/^file:/i.test(url)) return true
  const path = fileUrlPath(url)
  return path !== null && mayUse(path, allowed)
}

/** A file name Windows accepts, from the last part of any path or URL. */
function fileName(path: string): string {
  const last = path.split(/[\\/]/).filter((p) => p !== '').pop() ?? ''
  const clean = last.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
  return clean === '' ? 'missing' : clean
}

/**
 * A source with every path it may not use taken out, so nothing touches them.
 *
 * What was made from the source, its waveform, filmstrip and copies, is
 * dropped unless it is in the app's own cache, and made again there. A path
 * the source itself is at becomes one in `offlineDir` that is not there,
 * keeping its file name, so the source opens as missing and can be found
 * again by name or by hand.
 */
export function withUsablePaths(m: ProjectMedia, rules: PathRules): ProjectMedia {
  const ok = (p: string): boolean => p === '' || (mayUse(p, rules.allowed) && !PLAYLIST.test(p))
  const made = (p: string): boolean => p === '' || (mayUse(p, rules.allowed) && insideDir(p, rules.cacheDir))
  const filesOk = (list: TrackFile[] | undefined): boolean => (list ?? []).every((f) => made(f.path) && made(f.peaksPath))
  const { soundCopy, trackFiles, copying, cleaned, enhanced, treated, ...rest } = m
  // A cleaned, enhanced or treated copy anywhere but the cache is forgotten, and made again there.
  const cleanedOk = (cleaned ?? []).every((c) => typeof c.path === 'string' && c.path !== '' && made(c.path))
  const enhancedOk = (enhanced ?? []).every((c) => typeof c.path === 'string' && c.path !== '' && typeof c.recipe === 'string' && made(c.path))
  const treatedOk = (treated ?? []).every((c) => typeof c.path === 'string' && c.path !== '' && typeof c.recipe === 'string' && made(c.path))
  const fine =
    ok(m.originalPath) &&
    ok(m.playablePath) &&
    made(m.peaksPath) &&
    made(m.filmstripPath) &&
    made(soundCopy ?? '') &&
    filesOk(trackFiles) &&
    filesOk(copying) &&
    cleanedOk &&
    enhancedOk &&
    treatedOk
  if (fine) return m
  const offline = (p: string): string => (ok(p) ? p : `${rules.offlineDir}\\${fileName(p)}`)
  return {
    ...rest,
    originalPath: offline(m.originalPath),
    playablePath: offline(m.playablePath),
    peaksPath: made(m.peaksPath) ? m.peaksPath : '',
    filmstripPath: made(m.filmstripPath) ? m.filmstripPath : '',
    ...(soundCopy !== undefined && made(soundCopy) ? { soundCopy } : {}),
    ...(trackFiles !== undefined && filesOk(trackFiles) ? { trackFiles } : {}),
    ...(copying !== undefined && filesOk(copying) ? { copying } : {}),
    ...(cleaned !== undefined && cleanedOk ? { cleaned } : {}),
    ...(enhanced !== undefined && enhancedOk ? { enhanced } : {}),
    ...(treated !== undefined && treatedOk ? { treated } : {})
  }
}

/**
 * Every field a source keeps, and whether it names a file. Those that do are
 * the ones `withUsablePaths` checks. Listed in full so that a field added to
 * `ProjectMedia` stops the build until it is placed here, and one that names
 * a file cannot be added without its test in `source-paths.test.ts` asking
 * for it to be checked.
 */
export const MEDIA_FIELDS: Record<keyof ProjectMedia, 'file' | 'no file'> = {
  id: 'no file',
  originalPath: 'file',
  playablePath: 'file',
  conformed: 'no file',
  conformReasons: 'no file',
  durationSec: 'no file',
  width: 'no file',
  height: 'no file',
  fps: 'no file',
  codec: 'no file',
  hasAudio: 'no file',
  peaksPath: 'file',
  filmstripPath: 'file',
  audioTracks: 'no file',
  trackNames: 'no file',
  trackChannels: 'no file',
  chapters: 'no file',
  hasVideo: 'no file',
  bt601: 'no file',
  still: 'no file',
  text: 'no file',
  colour: 'no file',
  shape: 'no file',
  frames: 'no file',
  frameRate: 'no file',
  once: 'no file',
  soundCopy: 'file',
  cleaned: 'file',
  enhanced: 'file',
  care: 'no file',
  treated: 'file',
  startSec: 'no file',
  trackFiles: 'file',
  copying: 'file',
  addedAt: 'no file',
  markIn: 'no file',
  markOut: 'no file'
}

/** Where a source kept offline really was, as the file said. */
export interface Withheld {
  originalPath: string
  playablePath: string
}

/**
 * A project's sources and workspace with every path they may not use taken
 * out, and where each source kept offline really was.
 *
 * The workspace names a folder too, the one the last export went to, which
 * the Export window checks for files as soon as it opens: one the rules do
 * not allow is forgotten, and the export goes beside the project instead.
 */
export function usableProject(
  media: readonly ProjectMedia[],
  workspace: Workspace,
  rules: PathRules
): { media: ProjectMedia[]; workspace: Workspace; withheld: Map<string, Withheld> } {
  const withheld = new Map<string, Withheld>()
  const out = media.map((m) => {
    const usable = withUsablePaths(m, rules)
    if (usable.originalPath !== m.originalPath || usable.playablePath !== m.playablePath) {
      withheld.set(m.id, { originalPath: m.originalPath, playablePath: m.playablePath })
    }
    return usable
  })
  const folder = workspace.export.folder
  const kept = folder === null || mayUse(folder, rules.allowed) ? workspace : { ...workspace, export: { ...workspace.export, folder: null } }
  return { media: out, workspace: kept, withheld }
}

/**
 * The sources as they go back into the file: one still kept offline is
 * written where it really was, so keeping it offline for now never loses
 * where it is. One found again since is written where it was found.
 */
export function withWithheld(media: readonly ProjectMedia[], withheld: ReadonlyMap<string, Withheld>, offlineDir: string): ProjectMedia[] {
  if (withheld.size === 0) return [...media]
  return media.map((m) => {
    const was = withheld.get(m.id)
    if (!was) return m
    const original = insideDir(m.originalPath, offlineDir)
    const playable = insideDir(m.playablePath, offlineDir)
    if (!original && !playable) return m
    return { ...m, ...(original ? { originalPath: was.originalPath } : {}), ...(playable ? { playablePath: was.playablePath } : {}) }
  })
}
