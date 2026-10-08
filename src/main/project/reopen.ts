import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { hasPicture, isStill, trackCount, type ProjectMedia, type TrackFile } from '../../shared/project'
import { cacheKey, derivedPaths, exists, trackPaths } from '../media/cache'
import { extractPeaks } from '../media/waveform'
import { extractFilmstrip } from '../media/thumbnails'
import { extractStillFilmstrip } from '../media/still'
import { makeTrackCopies } from '../media/tracks'
import { probeFile } from '../media/probe'

/**
 * Opening a project without depending on the app's cache.
 *
 * A project stores absolute paths into the media cache for every conformed
 * file, waveform and filmstrip. Clearing the cache must not make a project
 * look broken while its footage is still where it was, so each source is
 * checked when a project opens and whatever can be rebuilt is.
 */

/**
 * What one source needs, in the order it is checked:
 *
 * - `ready`: the playable file is there, and so are its waveform, filmstrip
 *   and the copies of its other audio tracks.
 * - `rebuildDerived`: the playable file is there but a waveform, the
 *   filmstrip or a track's copy is missing. The clip works at once; the
 *   timeline fills in when they are done.
 * - `reimport`: the conformed file is gone but the original is where it was,
 *   so it goes through the import pipeline again.
 * - `offline`: neither is there, and it waits to be relinked.
 */
export type ReopenAction = 'ready' | 'rebuildDerived' | 'reimport' | 'offline'

export interface OnDisk {
  playable: boolean
  original: boolean
  peaks: boolean
  filmstrip: boolean
  /** Every copy of the source's other audio tracks, and their waveforms. True when it needs none. */
  tracks?: boolean
}

export function reopenAction(m: ProjectMedia, disk: OnDisk): ReopenAction {
  if (disk.playable) return disk.peaks && disk.filmstrip && disk.tracks !== false ? 'ready' : 'rebuildDerived'
  // A file that was never conformed plays from its original, so a missing
  // playable file means the original is missing too.
  if (m.conformed && disk.original) return 'reimport'
  return 'offline'
}

export async function checkSource(m: ProjectMedia): Promise<ReopenAction> {
  return reopenAction(m, {
    playable: await exists(m.playablePath),
    original: await exists(m.originalPath),
    peaks: m.peaksPath !== '' && (await exists(m.peaksPath)),
    // A sound file has no picture, and so no filmstrip to miss.
    filmstrip: !hasPicture(m) || (m.filmstripPath !== '' && (await exists(m.filmstripPath))),
    tracks: await copiesOnDisk(m)
  })
}

/**
 * Whether every copy of a source's other audio tracks is on disk with its
 * waveform. A source imported before the copies were made has none, and is
 * rebuilt like one whose cache was cleared.
 */
export async function copiesOnDisk(m: ProjectMedia): Promise<boolean> {
  const wanted = trackCount(m) - 1
  if (wanted <= 0) return true
  const files = m.trackFiles ?? []
  if (files.length < wanted) return false
  for (const f of files.slice(0, wanted)) {
    if (!(await exists(f.path)) || !(await exists(f.peaksPath))) return false
  }
  return true
}

/**
 * Copy a source's other audio tracks again, from its original, where the
 * project expects them, or into this app's own cache when that place cannot
 * be written or was never recorded.
 */
async function rebuildCopies(m: ProjectMedia): Promise<ProjectMedia> {
  const count = trackCount(m)
  const write = (files: TrackFile[]): Promise<void> =>
    makeTrackCopies(m.originalPath, files.map((f, i) => ({ index: i + 1, ...f })), m.durationSec)
  const recorded = m.trackFiles && m.trackFiles.length >= count - 1 ? m.trackFiles.slice(0, count - 1) : null
  if (recorded) {
    try {
      await write(recorded)
      return m
    } catch {
      // Fall through to this app's own cache.
    }
  }
  const info = await stat(m.originalPath)
  const dir = derivedPaths(cacheKey({ path: m.originalPath, size: info.size, mtimeMs: info.mtimeMs })).dir
  const files = Array.from({ length: count - 1 }, (_, i) => trackPaths(dir, i + 1))
  await write(files)
  return { ...m, trackFiles: files }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Offline sources that have a file of the same name in `folder`, whose
 * contents are `names`. Windows file names ignore case, and so does this.
 *
 * A name shared by two missing sources is left alone. Cameras and phones
 * reuse names like IMG_0001.MOV in every folder, so the file found could be
 * either of them, and guessing wrong would cut one recording's clips to the
 * other's length.
 */
export function matchInFolder(
  offline: Pick<ProjectMedia, 'id' | 'originalPath'>[],
  folder: string,
  names: string[]
): { id: string; path: string }[] {
  const byName = new Map(names.map((n) => [n.toLowerCase(), n]))
  const wanted = new Map<string, number>()
  for (const m of offline) {
    const key = fileName(m.originalPath).toLowerCase()
    wanted.set(key, (wanted.get(key) ?? 0) + 1)
  }
  const out: { id: string; path: string }[] = []
  for (const m of offline) {
    const key = fileName(m.originalPath).toLowerCase()
    if ((wanted.get(key) ?? 0) > 1) continue
    const found = byName.get(key)
    if (found !== undefined) out.push({ id: m.id, path: join(folder, found) })
  }
  return out
}

/**
 * Whether a file found by name is the recording a missing source was, judged
 * from what the import learned about it: the same length to within a frame,
 * the same picture size, and sound or no sound alike. A different recording
 * that happens to share the name fails at least one of these.
 */
export function sameRecording(
  missing: Pick<ProjectMedia, 'durationSec' | 'width' | 'height' | 'hasAudio' | 'fps' | 'audioTracks'>,
  found: Pick<ProjectMedia, 'durationSec' | 'width' | 'height' | 'hasAudio' | 'audioTracks'>
): boolean {
  const frame = 1 / Math.max(1, missing.fps)
  return (
    Math.abs(missing.durationSec - found.durationSec) <= frame + 1e-6 &&
    missing.width === found.width &&
    missing.height === found.height &&
    missing.hasAudio === found.hasAudio &&
    (missing.audioTracks ?? 1) === (found.audioTracks ?? 1)
  )
}

async function writeDerived(m: ProjectMedia, peaksPath: string, filmstripPath: string): Promise<void> {
  if (!(await exists(peaksPath))) await extractPeaks(m.playablePath, peaksPath, m.durationSec, m.hasAudio)
  if (hasPicture(m) && !(await exists(filmstripPath))) {
    if (isStill(m)) await extractStillFilmstrip(m.playablePath, filmstripPath, m.width, m.height)
    else await extractFilmstrip(m.playablePath, filmstripPath, m.durationSec)
  }
}

/**
 * Write a source's missing waveform and filmstrip from its playable file.
 *
 * They go back where the project expects them, so the project does not change.
 * Only when that place cannot be written, as for a project made under another
 * Windows account, do they go into this app's own cache, and the source is
 * returned with its new paths.
 */
export async function rebuildDerived(m: ProjectMedia): Promise<ProjectMedia> {
  let out = m
  try {
    if (m.peaksPath === '' || (hasPicture(m) && m.filmstripPath === '')) throw new Error('no cache paths recorded')
    await writeDerived(m, m.peaksPath, m.filmstripPath)
  } catch {
    const info = await stat(m.playablePath)
    const paths = derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs }))
    await writeDerived(m, paths.peaks, paths.filmstrip)
    out = { ...m, peaksPath: paths.peaks, filmstripPath: hasPicture(m) ? paths.filmstrip : '' }
  }
  // The copies come from the original, which a conformed source may no longer
  // have beside it. Then there is nothing to copy from: what else was rebuilt
  // is still kept, and the tracks show as not ready.
  if (await copiesOnDisk(out)) return out
  try {
    const copied = await rebuildCopies(out)
    // A source from before start times were kept gets one, which its copies
    // need to be heard in step in the preview.
    if (copied.startSec === undefined) {
      const start = (await probeFile(copied.playablePath)).startSec
      return start !== 0 ? { ...copied, startSec: start } : copied
    }
    return copied
  } catch {
    return { ...out, trackFiles: [] }
  }
}
