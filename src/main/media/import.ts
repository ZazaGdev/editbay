import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { MediaAsset, ImportProgress } from '../../shared/types'
import type { ProjectMedia } from '../../shared/project'
import { isGifPath, isStillPath, probeAnimation, probeAny, probeFile, probeSound, probeStill, conformReasons, soundPlaysAsItIs, type SoundProbe } from './probe'
import { detectVfr } from './vfr'
import { cacheKey, derivedPaths, exists, trackPaths } from './cache'
import { recordOriginal } from './prune'
import { conformFile, conformSound, targetFrameRate } from './conform'
import { extractPeaks } from './waveform'
import { extractFilmstrip } from './thumbnails'
import { COPY_FILTER, makeTrackCopies } from './tracks'
import { animationRate, countFrames, extractStillFilmstrip, makeStill, unpackAnimation } from './still'
import { join } from 'node:path'
import { STILL_SEC } from '../../shared/project'
import { verifyFfmpeg } from '../ffmpeg/locate'
import { isBt601 } from '../../shared/colour-space'
import { ProcessError } from '../ffmpeg/spawn'

const assets = new Map<string, MediaAsset>()
/** cache key of a source file, to the asset already built from it. */
const byCacheKey = new Map<string, string>()

/**
 * The cache folders of imports under way. Such a source is not in the project
 * until it is ready, so freeing the cache took its folder out from under it
 * (audit 2026-10-08).
 */
const importing = new Set<string>()

/** The cache folders of imports under way, by name, which freeing the cache leaves alone. */
export function cacheKeysImporting(): ReadonlySet<string> {
  return importing
}

export function listAssets(): MediaAsset[] {
  return [...assets.values()]
}

/** Forget every asset. Used when a new project starts, so the bin matches it. */
export function clearAssets(): void {
  assets.clear()
  byCacheKey.clear()
}

/**
 * Register sources that came from an opened project, so the bin shows them
 * without re-importing. Those in `missing` cannot be found, and say so.
 */
export function adoptMedia(media: ProjectMedia[], missing: string[] = []): void {
  clearAssets()
  for (const m of media) {
    assets.set(
      m.id,
      missing.includes(m.id) ? { ...m, status: 'failed', error: 'file not found' } : { ...m, status: 'ready' }
    )
  }
}

/**
 * The source already in the bin for this file, ready, if there is one: the
 * same file, by its path, size and time, as a dropped file is matched.
 */
export async function knownReady(path: string): Promise<MediaAsset | null> {
  try {
    const info = await stat(path)
    const known = byCacheKey.get(cacheKey({ path, size: info.size, mtimeMs: info.mtimeMs }))
    const existing = known ? assets.get(known) : undefined
    return existing && existing.status === 'ready' ? existing : null
  } catch {
    return null
  }
}

/** A card for a file waiting its turn, shown the moment it is dropped. */
export function queuedAsset(id: string, path: string): MediaAsset {
  const asset: MediaAsset = {
    id,
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec: 0,
    width: 0,
    height: 0,
    fps: 0,
    codec: '',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    status: 'queued'
  }
  assets.set(id, asset)
  return asset
}

export function getAsset(id: string): MediaAsset | undefined {
  return assets.get(id)
}

/** Take a source out of the bin. What it made in the cache stays, for the next import of the same file. */
/** The copies still being made behind sources that are ready, by source, and how to stop them. */
const copying = new Map<string, { done: Promise<void>; stop: AbortController }>()

/**
 * Resolves once every copy being made behind these ready sources is done, or
 * has failed, or `signal` stops the wait. What reads the other tracks' sound,
 * the export and captions, waits on this rather than find no copy there and
 * leave the sound out. Only the open project's sources are waited for: one
 * project's long copy held up another's export (audit 2026-10-01).
 */
export async function tracksCopied(only: ReadonlySet<string>, signal?: AbortSignal): Promise<void> {
  const waits = [...copying].filter(([id]) => only.has(id)).map(([, c]) => c.done)
  if (waits.length === 0 || signal?.aborted) return
  await Promise.race([
    Promise.all(waits),
    new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
  ])
}

/** Whether any of these sources still has copies on their way. */
export function copyingTracks(only: ReadonlySet<string>): boolean {
  return [...copying.keys()].some((id) => only.has(id))
}

/**
 * Stop the copies of every source but these, as when another project is
 * opened: theirs is work for a project no longer open, which makes them again
 * when it is (audit 2026-10-01).
 */
export function stopTrackCopies(keep: ReadonlySet<string>): void {
  for (const [id, c] of copying) if (!keep.has(id)) c.stop.abort()
}

export function forgetAsset(id: string): void {
  assets.delete(id)
  for (const [key, known] of byCacheKey) if (known === id) byCacheKey.delete(key)
}

/** Thrown out of an import that was cancelled, so its caller can drop the card rather than show a failure. */
export class ImportCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'ImportCancelled'
  }
}

/**
 * Put back in the bin any source of the project it does not list, as when an
 * undo brings back a clip of a source that was removed: missing again if its
 * file was missing, ready otherwise. Returns those put back.
 */
export function adoptMissing(media: ProjectMedia[], missing: string[]): MediaAsset[] {
  const back: MediaAsset[] = []
  for (const m of media) {
    if (assets.has(m.id)) continue
    back.push(missing.includes(m.id) ? markMissing(m) : { ...m, status: 'ready' })
    assets.set(m.id, back[back.length - 1]!)
  }
  return back
}

/**
 * Show a source as missing again, as it was before a file was tried in its
 * place and turned out to be a different recording. Returns what the bin now holds.
 */
export function markMissing(m: ProjectMedia): MediaAsset {
  const asset: MediaAsset = { ...m, status: 'failed', error: 'file not found' }
  assets.set(m.id, asset)
  return asset
}

export interface ImportOptions {
  /**
   * The id to import under. Given when the file replaces a source the project
   * already has, as on relink or a rebuild after the cache was cleared, so the
   * bin updates that source rather than listing a second one.
   */
  id?: string
  /**
   * Asked before every update is shown. False once the document the import
   * was for has been replaced, so its progress never lands in the next
   * project's bin.
   */
  stillWanted?: () => boolean
  /** Stops the import between stages, and ffmpeg in the middle of a conversion. */
  signal?: AbortSignal
  /**
   * Given, a recording with more than one audio track is ready as soon as
   * every track's waveform is there, and its other tracks are copied behind
   * it: this is called with the source again once they are, or with why not.
   * Left out, the import waits for the copies, as every caller that puts the
   * source into the project once, and is told nothing later, needs it to.
   */
  onTracksCopied?: (asset: MediaAsset, error?: string) => void
}

/**
 * The rest of an import for a sound file: converted when it would not play
 * dependably as it is, then its waveform. It has no picture, so no filmstrip.
 */
async function prepareSound(
  start: MediaAsset,
  probe: SoundProbe,
  paths: ReturnType<typeof derivedPaths>,
  publish: (a: MediaAsset) => void,
  onProgress: ProgressSink,
  signal: AbortSignal | undefined
): Promise<MediaAsset> {
  const id = start.id
  const convert = !soundPlaysAsItIs(probe)
  let asset: MediaAsset = {
    ...start,
    hasVideo: false,
    conformReasons: convert ? ['sound-format'] : [],
    durationSec: probe.durationSec,
    width: 0,
    height: 0,
    fps: 0,
    codec: probe.audio.codec,
    hasAudio: true,
    // Only the first of a sound file's tracks plays: the rest are never copied out.
    audioTracks: 1,
    trackNames: probe.trackNames.slice(0, 1),
    trackChannels: probe.trackChannels.slice(0, 1)
  }
  publish(asset)
  let playablePath = probe.path
  let playable = probe
  if (convert) {
    playablePath = paths.sound
    if (!(await exists(paths.sound))) {
      asset = { ...asset, status: 'conforming' }
      publish(asset)
      onProgress({ id, status: 'conforming', stage: 'converting', fraction: 0 })
      await conformSound(
        probe.path,
        paths.sound,
        probe.durationSec,
        (fraction) => onProgress({ id, status: 'conforming', stage: 'converting', fraction }),
        signal,
        probe.audio.channels
      )
    }
    playable = await probeSound(paths.sound, signal)
  }
  asset = {
    ...asset,
    status: 'analysing',
    playablePath,
    conformed: convert,
    durationSec: playable.durationSec,
    codec: playable.audio.codec,
    startSec: playable.startSec
  }
  publish(asset)
  stopIfCancelled(signal)
  onProgress({ id, status: 'analysing', stage: 'waveform' })
  if (!(await exists(paths.peaks))) await extractPeaks(playablePath, paths.peaks, playable.durationSec, true, signal, { filter: COPY_FILTER })
  stopIfCancelled(signal)
  return { ...asset, peaksPath: paths.peaks, filmstripPath: '', status: 'ready' }
}

/**
 * The rest of an import for a picture: an upright copy in the cache, which is
 * what it plays and exports from, its filmstrip, and a waveform with nothing
 * in it, as a recording with no sound has. It has no length, so it is given
 * the nominal one every trim is measured against.
 */
async function prepareStill(
  start: MediaAsset,
  paths: ReturnType<typeof derivedPaths>,
  publish: (a: MediaAsset) => void,
  onProgress: ProgressSink,
  signal: AbortSignal | undefined
): Promise<MediaAsset> {
  const id = start.id
  const original = await probeStill(start.originalPath, signal)
  stopIfCancelled(signal)
  let asset: MediaAsset = { ...start, still: true, hasAudio: false, audioTracks: 0, durationSec: STILL_SEC, codec: original.codec }
  publish(asset)
  if (!(await exists(paths.picture))) {
    asset = { ...asset, status: 'conforming' }
    publish(asset)
    onProgress({ id, status: 'conforming', stage: 'converting', fraction: 0 })
    await makeStill(start.originalPath, paths.picture, original.width, original.height, signal)
  }
  // Its size upright, from the copy: ffprobe gives the original as stored.
  const upright = await probeStill(paths.picture, signal)
  asset = {
    ...asset,
    status: 'analysing',
    playablePath: paths.picture,
    conformed: true,
    width: upright.width,
    height: upright.height
  }
  publish(asset)
  stopIfCancelled(signal)
  onProgress({ id, status: 'analysing', stage: 'filmstrip' })
  if (!(await exists(paths.peaks))) await extractPeaks(paths.picture, paths.peaks, STILL_SEC, false, signal)
  if (!(await exists(paths.filmstrip))) await extractStillFilmstrip(paths.picture, paths.filmstrip, upright.width, upright.height, signal)
  stopIfCancelled(signal)
  return { ...asset, peaksPath: paths.peaks, filmstripPath: paths.filmstrip, status: 'ready' }
}

/**
 * The rest of an import for a GIF that moves: its frames unpacked into the
 * cache at a steady rate, the first of them its playable file, and its
 * filmstrip from that. One with a single frame is a picture like any other.
 */
async function prepareAnimation(
  start: MediaAsset,
  paths: ReturnType<typeof derivedPaths>,
  publish: (a: MediaAsset) => void,
  onProgress: ProgressSink,
  signal: AbortSignal | undefined
): Promise<MediaAsset> {
  const probe = await probeAnimation(start.originalPath, signal)
  if (probe.frames <= 1) return prepareStill(start, paths, publish, onProgress, signal)
  const id = start.id
  const rate = animationRate(probe.frames, probe.durationSec)
  const dir = join(paths.dir, 'frames')
  let asset: MediaAsset = { ...start, still: true, hasAudio: false, audioTracks: 0, durationSec: STILL_SEC, codec: 'gif' }
  publish(asset)
  let frames = await countFrames(dir)
  if (frames === 0) {
    asset = { ...asset, status: 'conforming' }
    publish(asset)
    onProgress({ id, status: 'conforming', stage: 'converting', fraction: 0 })
    frames = await unpackAnimation(start.originalPath, dir, rate, probe.width, probe.height, signal)
  }
  const first = join(dir, '0001.png')
  const upright = await probeStill(first, signal)
  asset = {
    ...asset,
    status: 'analysing',
    playablePath: first,
    conformed: true,
    width: upright.width,
    height: upright.height,
    frames,
    frameRate: rate,
    fps: rate
  }
  publish(asset)
  stopIfCancelled(signal)
  onProgress({ id, status: 'analysing', stage: 'filmstrip' })
  if (!(await exists(paths.peaks))) await extractPeaks(first, paths.peaks, STILL_SEC, false, signal)
  if (!(await exists(paths.filmstrip))) await extractStillFilmstrip(first, paths.filmstrip, upright.width, upright.height, signal)
  stopIfCancelled(signal)
  return { ...asset, peaksPath: paths.peaks, filmstripPath: paths.filmstrip, status: 'ready' }
}

function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ImportCancelled()
}

export type ProgressSink = (p: ImportProgress) => void
export type AssetSink = (a: MediaAsset) => void

/**
 * Take one file all the way through the pipeline.
 * Every stage reports progress; a failure leaves the asset in the failed state
 * with the reason, rather than throwing away what was learned.
 */
export async function importFile(
  path: string,
  onProgress: ProgressSink,
  onAsset: AssetSink,
  options: ImportOptions = {}
): Promise<MediaAsset> {
  const id = options.id ?? randomUUID()
  const wanted = options.stillWanted ?? ((): boolean => true)
  const signal = options.signal
  const publish = (a: MediaAsset): MediaAsset => {
    if (!wanted()) return a
    assets.set(id, a)
    onAsset(a)
    return a
  }

  // Re-importing a file that is already in the bin returns what is there,
  // rather than adding a duplicate under a new id. Without this, dropping the
  // same file twice fills the bin with copies, and only one of them is the one
  // the project actually references.
  try {
    const info = await stat(path)
    const known = byCacheKey.get(cacheKey({ path, size: info.size, mtimeMs: info.mtimeMs }))
    const existing = known ? assets.get(known) : undefined
    if (existing && existing.status === 'ready' && options.id !== undefined && existing.id !== options.id) {
      // Already imported under another id: the source being replaced takes
      // the same file under its own id, which is what its clips point at.
      onProgress({ id, status: 'ready', fraction: 1 })
      return publish({ ...existing, id })
    }
    if (existing && existing.status === 'ready') {
      onAsset(existing)
      onProgress({ id: existing.id, status: 'ready', fraction: 1 })
      return existing
    }
  } catch {
    // Fall through: the real import below reports the problem properly.
  }

  let asset: MediaAsset = {
    id,
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec: 0,
    width: 0,
    height: 0,
    fps: 0,
    codec: '',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    status: 'probing'
  }
  publish(asset)
  onProgress({ id, status: 'probing', stage: 'reading' })

  let releaseKey = (): void => undefined
  try {
    const caps = await verifyFfmpeg()
    const info = await stat(path)
    const key = cacheKey({ path, size: info.size, mtimeMs: info.mtimeMs })
    const paths = derivedPaths(key)
    importing.add(key)
    releaseKey = () => void importing.delete(key)
    await recordOriginal(paths.dir, path)
    if (isStillPath(path)) {
      const prepare = isGifPath(path) ? prepareAnimation : prepareStill
      const ready = await prepare(asset, paths, (a) => (asset = publish(a)), onProgress, signal)
      if (wanted()) byCacheKey.set(key, id)
      onProgress({ id, status: 'ready', fraction: 1 })
      return publish(ready)
    }
    const probed = await probeAny(path, signal)
    if (probed.kind === 'sound') {
      stopIfCancelled(signal)
      const ready = await prepareSound(asset, probed.probe, paths, (a) => (asset = publish(a)), onProgress, signal)
      if (wanted()) byCacheKey.set(key, id)
      onProgress({ id, status: 'ready', fraction: 1 })
      return publish(ready)
    }
    const probe = probed.probe

    const isVfr = await detectVfr(path, probe.video.nominalFps, probe.video.averageFps, signal)
    const reasons = conformReasons(probe, isVfr)
    stopIfCancelled(signal)

    asset = publish({
      ...asset,
      conformReasons: reasons,
      durationSec: probe.durationSec,
      width: probe.video.width,
      height: probe.video.height,
      fps: targetFrameRate(probe),
      codec: probe.video.codec,
      hasAudio: probe.audio !== null,
      // Counted on the original: a conformed copy keeps only the first track.
      audioTracks: probe.audioTracks,
      trackNames: probe.trackNames,
      trackChannels: probe.trackChannels,
      chapters: probe.chapters
    })

    let playablePath = path
    let playable = probe
    if (reasons.length > 0) {
      playablePath = paths.conformed
      if (!(await exists(paths.conformed))) {
        asset = publish({ ...asset, status: 'conforming' })
        onProgress({ id, status: 'conforming', stage: 'converting', fraction: 0 })
        await conformFile({
          probe,
          output: paths.conformed,
          hasZscale: caps.hasZscale,
          // An MPEG-TS or FLV whose picture plays: only put into an MP4, which takes seconds.
          rewrapOnly: reasons.length === 1 && reasons[0] === 'container',
          onProgress: (fraction) => onProgress({ id, status: 'conforming', stage: 'converting', fraction }),
          ...(signal ? { signal } : {})
        })
      }
      // The conformed file is what gets played and rendered, so it is what the
      // rest of the app must be told about. Flattening variable timing changes
      // the frame count, and a stale duration puts trim points past the end.
      playable = await probeFile(paths.conformed, signal)
    }

    asset = publish({
      ...asset,
      status: 'analysing',
      playablePath,
      conformed: reasons.length > 0,
      durationSec: playable.durationSec,
      width: playable.video.width,
      height: playable.video.height,
      fps: targetFrameRate(playable),
      hasAudio: playable.audio !== null,
      startSec: playable.startSec,
      // By what the file played says: a conformed copy is BT.709 already.
      ...(isBt601(playable.video.colorSpace) ? { bt601: true as const } : {})
    })
    stopIfCancelled(signal)
    onProgress({ id, status: 'analysing', stage: 'waveform' })

    if (!(await exists(paths.peaks))) {
      // Timed as the export reads the recording: a sound that starts a little
      // after the picture, as a phone's often does, is drawn that much later,
      // not from the start, so Remove silences and ducking cut where it is heard.
      await extractPeaks(playablePath, paths.peaks, playable.durationSec, playable.audio !== null, signal, { filter: COPY_FILTER })
    }
    stopIfCancelled(signal)
    onProgress({ id, status: 'analysing', stage: 'filmstrip' })
    if (!(await exists(paths.filmstrip))) {
      await extractFilmstrip(playablePath, paths.filmstrip, playable.durationSec, signal)
    }
    stopIfCancelled(signal)

    // The tracks after the first, each on its own. From the original, never
    // from a conformed copy, which keeps only the first; both start at the
    // recording's start, so they stay in step with it.
    const extra = Array.from({ length: Math.max(0, probe.audioTracks - 1) }, (_, i) => ({
      index: i + 1,
      ...(probe.trackChannels[i + 1] !== undefined ? { channels: probe.trackChannels[i + 1]! } : {}),
      ...trackPaths(paths.dir, i + 1)
    }))
    if (extra.length > 0) {
      onProgress({ id, status: 'analysing', stage: 'tracks', tracks: extra.length })
      // Waveforms first, straight from the recording: decoding is quick, a
      // fifth of a second a track, where encoding a copy is the slow part.
      // Through the copy's own filter, so each lines up with the copy it
      // stands in for and is not made again once that copy exists.
      for (const t of extra) {
        if (!(await exists(t.peaksPath))) {
          await extractPeaks(path, t.peaksPath, playable.durationSec, true, signal, { track: t.index, filter: COPY_FILTER })
        }
      }
      stopIfCancelled(signal)
      const tell = options.onTracksCopied
      if (tell) {
        const files = extra.map((t) => ({ path: t.path, peaksPath: t.peaksPath }))
        const early: MediaAsset = { ...asset, copying: files, peaksPath: paths.peaks, filmstripPath: paths.filmstrip, status: 'ready' }
        // Still this source, still in the bin: one taken out meanwhile is not put back.
        const stillHere = (): boolean => wanted() && assets.get(id)?.copying !== undefined
        const stop = new AbortController()
        const behind = makeTrackCopies(path, extra, playable.durationSec, stop.signal)
          .then(async () => {
            const { copying: _done, ...rest } = early
            const finished: MediaAsset = { ...rest, trackFiles: files }
            if (stillHere()) tell(publish(finished))
          })
          .catch((err: unknown) => {
            const { copying: _done, ...rest } = early
            if (stillHere()) tell(publish(rest), err instanceof Error ? err.message : String(err))
          })
          .finally(() => copying.delete(id))
        copying.set(id, { done: behind, stop })
        // The whole of it is kept only once the copies are there, so a cached
        // import of the same file never takes copies on their way for copies made.
        if (wanted()) byCacheKey.set(key, id)
        onProgress({ id, status: 'ready', fraction: 1 })
        return publish(early)
      }
      await makeTrackCopies(path, extra, playable.durationSec, signal)
    }
    stopIfCancelled(signal)

    const ready: MediaAsset = {
      ...asset,
      ...(extra.length > 0 ? { trackFiles: extra.map((t) => ({ path: t.path, peaksPath: t.peaksPath })) } : {}),
      peaksPath: paths.peaks,
      filmstripPath: paths.filmstrip,
      status: 'ready'
    }
    if (wanted()) byCacheKey.set(key, id)
    onProgress({ id, status: 'ready', fraction: 1 })
    return publish(ready)
  } catch (err) {
    if (signal?.aborted) throw new ImportCancelled()
    const message = err instanceof Error ? err.message : String(err)
    const details = err instanceof ProcessError && err.stderr ? err.stderr : undefined
    onProgress({ id, status: 'failed', message })
    return publish({ ...asset, status: 'failed', error: message, ...(details ? { errorDetails: details } : {}) })
  } finally {
    releaseKey()
  }
}
