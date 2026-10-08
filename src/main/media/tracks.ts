import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname } from 'node:path'
import { measureFfmpeg, runFfmpeg } from '../ffmpeg/run'
import { cacheKey, cleanedPath, commitScratch, derivedPaths, enhancedPath, exists, scratchPath, trackPaths, treatedPath } from './cache'
import { cleanedFile, trackFile, trackPeaks, type ProjectMedia } from '../../shared/project'
import { parseLoudnorm } from '../../shared/render-plan'
import { VOICE_LIMIT, voiceChain, voiceLift, voiceRecipe, type VoiceStrength } from '../../shared/voice'
import { CLICKS_CHAIN, VOICE_BAND, breathThreshold, breathsGraph, careRecipe, type VoiceCare } from '../../shared/voice-care'
import { quietestSecond } from '../../shared/peaks'
import { toStereo } from '../../shared/sound'
import { decodePeaks, extractPeaks } from './waveform'

/**
 * A recording's audio tracks after the first, each copied into a sound file of
 * its own. A browser video plays only a file's first track, so this is how the
 * others can be heard in the preview; the export reads the same copies, so the
 * two never disagree about what a track sounds like or where it starts.
 */

const COPY_RATE = 48000
const COPY_BITRATE = '192k'
/**
 * What every copy is read through: padded with silence to begin at the
 * recording's start. A waveform read from the recording ahead of its copy goes
 * through the same, so it lines up with the copy it stands in for.
 */
export const COPY_FILTER = `aresample=${COPY_RATE}:async=1:first_pts=0`

/** One track to copy: its index in the recording, from 0, and where the copy goes. */
export interface TrackCopy {
  index: number
  path: string
  /** How many channels the track has in the original, when known. */
  channels?: number
}

/**
 * How many copies are encoded at once. Reading the recording is cheap, a
 * stream copy of a two minute track takes a tenth of a second; encoding it to
 * AAC is what takes the time, about seven seconds, so the copies are encoded
 * side by side rather than one after another in a single pass. Four at most,
 * which is what OBS gives a recording beyond its first track, and never more
 * than the machine has cores to spare.
 */
const COPIES_AT_ONCE = Math.max(1, Math.min(4, availableParallelism() - 1))

/**
 * The ffmpeg arguments that write these copies. Given one, it writes one;
 * `makeTrackCopies` gives it one at a time so the encodes can run at once.
 *
 * Each copy is padded with silence at the start so it begins at the
 * recording's own start. OBS can start a track a few milliseconds after the
 * picture, and a copy that began at the track's first sound would put that
 * sound early by the same amount, which is the wrong thing to leave to a
 * player when the track is somebody talking on camera.
 */
export function trackCopyArgs(input: string, copies: TrackCopy[]): string[] {
  const args = ['-i', input]
  for (const c of copies) {
    args.push(
      '-map', `0:a:${c.index}`,
      '-af', `${COPY_FILTER},${toStereo(c.channels)}`,
      '-c:a', 'aac',
      '-b:a', COPY_BITRATE,
      '-ac', '2',
      '-movflags', '+faststart',
      '-y', c.path
    )
  }
  return args
}

/**
 * How noise is taken down. First everything under 80 Hz, below any voice,
 * which is where hum and rumble are. Then ffmpeg's `afftdn`, by up to 18 dB,
 * having learned what the noise sounds like from a second where nobody is
 * talking. Its own guess at the noise, or following it as it changes, did far
 * worse, measured on white hiss, pink noise and mains hum under a tone: 4 dB
 * of hiss taken out where learning it takes out 17, and the tone dented.
 * Learned, the hiss comes down 9 to 22 dB and the tone by nothing measurable.
 */
const LOW_CUT = 'highpass=f=80'
const REDUCE_DB = 18

/**
 * The ffmpeg arguments that write a track cleaned of noise, read from where
 * that track plays, through the same filter as a track copy so it starts
 * where the copies start.
 *
 * `quietSec` is the start of a second with nobody talking. It is read twice:
 * once on its own, played to the filter first so it learns the noise from
 * it, and again in its place in the whole track. The learning second is cut
 * off again at the end. The filter learning it where it falls instead would
 * leave everything before it uncleaned. Without one, the filter guesses.
 */
export function cleanCopyArgs(input: string, output: string, quietSec: number | null, channels?: number): string[] {
  const encode = ['-c:a', 'aac', '-b:a', COPY_BITRATE, '-ac', '2', '-movflags', '+faststart', '-y', output]
  const stereo = toStereo(channels)
  if (quietSec === null) {
    return ['-i', input, '-map', '0:a:0', '-af', `${COPY_FILTER},${stereo},${LOW_CUT},afftdn=nr=${REDUCE_DB}`, ...encode]
  }
  const same = `aresample=${COPY_RATE},${stereo}`
  const graph =
    `[0:a:0]${same}[quiet];` +
    `[1:a:0]${COPY_FILTER},${stereo}[whole];` +
    `[quiet][whole]concat=n=2:v=0:a=1,${LOW_CUT},` +
    `asendcmd=c='0 afftdn sample_noise start;1 afftdn sample_noise stop',afftdn=nr=${REDUCE_DB},` +
    `atrim=start=1,asetpts=PTS-STARTPTS[a]`
  return ['-ss', quietSec.toFixed(3), '-t', '1', '-i', input, '-i', input, '-filter_complex', graph, '-map', '[a]', ...encode]
}

/**
 * A recording's track cleaned of noise, for a sound clip with Clean up noise
 * on, kept in the source's cache folder beside its copies. Made from the file
 * the track plays from: the playable file for the first, its copy for the
 * rest. Made once; a copy already there is used. Returns where it is.
 */
export async function makeCleanCopy(m: ProjectMedia, track: number): Promise<string> {
  const from = trackFile(m, track)
  if (!from) throw new Error(`no audio track ${track + 1}`)
  const info = await stat(m.playablePath)
  const dir = derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs })).dir
  const path = cleanedPath(dir, track)
  if (await exists(path)) return path
  await mkdir(dirname(path), { recursive: true })
  // The quietest second, from the track's own waveform, which the filter learns the noise from.
  const peaksAt = trackPeaks(m, track)
  const quiet = peaksAt && (await exists(peaksAt)) ? await readFile(peaksAt).then((b) => decodePeaks(b)).then((d) => quietestSecond(d.peaks, d.peaksPerSecond)).catch(() => null) : null
  const scratch = scratchPath(path)
  try {
    await runFfmpeg(cleanCopyArgs(from.path, scratch, quiet, m.trackChannels?.[track]))
    await commitScratch(scratch, path)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
  return path
}

/** The ffmpeg arguments that measure how loud a track is, after `filters` when given. */
export function voiceMeasureArgs(input: string, filters: string | null, channels?: number): string[] {
  const head = `${COPY_FILTER},${toStereo(channels)}`
  const chain = filters === null ? head : `${head},${filters}`
  return ['-i', input, '-map', '0:a:0', '-af', `${chain},loudnorm=print_format=json`, '-f', 'null', '-']
}

/**
 * The ffmpeg arguments that write a track with its voice enhanced: through the
 * same filter as a track copy, so it starts where the copies start, then the
 * strength's chain, `liftDb` to bring it back to the loudness it had, and the
 * limiter.
 */
export function voiceCopyArgs(input: string, output: string, strength: VoiceStrength, liftDb: number, channels?: number): string[] {
  const af = `${COPY_FILTER},${toStereo(channels)},${voiceChain(strength)},volume=${liftDb.toFixed(2)}dB,${VOICE_LIMIT}`
  return ['-i', input, '-map', '0:a:0', '-af', af, '-c:a', 'aac', '-b:a', COPY_BITRATE, '-ac', '2', '-movflags', '+faststart', '-y', output]
}

/**
 * A recording's track with Enhance voice run over it, for the sound clips
 * that ask for it, kept in the source's cache folder beside its copies. Made
 * from the cleaned copy when `clean`, so noise comes out before anything
 * adds gain, and from the file the track plays from otherwise. The track and
 * the chain's output are each measured first, and the difference is put back,
 * so the voice sits as loud as it did. Made once; a copy already there is
 * used. Returns where it is.
 */
export async function makeVoiceCopy(m: ProjectMedia, track: number, strength: VoiceStrength, clean: boolean): Promise<string> {
  const input = clean ? cleanedFile(m, track) : (trackFile(m, track)?.path ?? null)
  if (!input) throw new Error(clean ? `no cleaned copy of track ${track + 1}` : `no audio track ${track + 1}`)
  const info = await stat(m.playablePath)
  const dir = derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs })).dir
  const path = enhancedPath(dir, track, voiceRecipe(strength, clean))
  if (await exists(path)) return path
  await mkdir(dirname(path), { recursive: true })
  const loudness = async (filters: string | null): Promise<number | null> =>
    parseLoudnorm(await measureFfmpeg(voiceMeasureArgs(input, filters, m.trackChannels?.[track])))?.i ?? null
  const lift = voiceLift(await loudness(null), await loudness(voiceChain(strength)))
  const scratch = scratchPath(path)
  try {
    await runFfmpeg(voiceCopyArgs(input, scratch, strength, lift, clean ? 2 : m.trackChannels?.[track]))
    await commitScratch(scratch, path)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
  return path
}

/** What a treated copy runs, each part measured or found first where it needs to be. */
export interface CareSteps {
  clicks: boolean
  /** Clean up noise, learning the noise from the second starting here, or guessing it with null. Absent for off. */
  clean?: { quietSec: number | null }
  breaths?: { amount: NonNullable<VoiceCare['breaths']>; threshold: number }
  voice?: { strength: VoiceStrength; liftDb: number }
}

/**
 * The ffmpeg arguments that write a track treated (plan 81): read as a track
 * copy is, then in the order a voice is treated, clicks out, noise down as
 * Clean up noise does it, breaths down, the voice enhanced, and the limiter.
 */
export function careCopyArgs(input: string, output: string, steps: CareSteps, channels?: number): string[] {
  const encode = ['-c:a', 'aac', '-b:a', COPY_BITRATE, '-ac', '2', '-movflags', '+faststart', '-y', output]
  const stereo = toStereo(channels)
  const clicks = steps.clicks ? `,${CLICKS_CHAIN}` : ''
  const learning = steps.clean !== undefined && steps.clean.quietSec !== null
  let graph: string
  if (learning) {
    // As `cleanCopyArgs`: the quiet second first, for the filter to learn the noise from, cut off again after.
    graph =
      `[0:a:0]aresample=${COPY_RATE},${stereo}[quiet];` +
      `[1:a:0]${COPY_FILTER},${stereo}[whole];` +
      `[quiet][whole]concat=n=2:v=0:a=1${clicks},${LOW_CUT},` +
      `asendcmd=c='0 afftdn sample_noise start;1 afftdn sample_noise stop',afftdn=nr=${REDUCE_DB},` +
      `atrim=start=1,asetpts=PTS-STARTPTS[cleaned];`
  } else {
    const clean = steps.clean !== undefined ? `,${LOW_CUT},afftdn=nr=${REDUCE_DB}` : ''
    graph = `[0:a:0]${COPY_FILTER},${stereo}${clicks}${clean}[cleaned];`
  }
  graph += steps.breaths ? breathsGraph(steps.breaths.amount, steps.breaths.threshold, '[cleaned]', '[breathed];') : '[cleaned]anull[breathed];'
  const voice = steps.voice ? `${voiceChain(steps.voice.strength)},volume=${steps.voice.liftDb.toFixed(2)}dB,` : ''
  graph += `[breathed]${voice}${VOICE_LIMIT}[a]`
  const inputs = learning ? ['-ss', steps.clean!.quietSec!.toFixed(3), '-t', '1', '-i', input, '-i', input] : ['-i', input]
  return [...inputs, '-filter_complex', graph, '-map', '[a]', ...encode]
}

/**
 * A recording's track treated for the clips of a track with breaths or
 * clicks turned on (plan 81), with the clip's own Clean up noise and Enhance
 * voice in the same pass, kept in the source's cache folder beside its
 * copies. The voice band's loudness is measured first, for where the breath
 * gate opens, and the enhance's lift as `makeVoiceCopy` measures it. Made
 * once; a copy already there is used. Returns where it is.
 */
export async function makeCareCopy(m: ProjectMedia, track: number, care: VoiceCare, clean: boolean, voice: VoiceStrength | undefined): Promise<string> {
  const from = trackFile(m, track)
  if (!from) throw new Error(`no audio track ${track + 1}`)
  const info = await stat(m.playablePath)
  const dir = derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs })).dir
  const path = treatedPath(dir, track, careRecipe(care, clean, voice))
  if (await exists(path)) return path
  await mkdir(dirname(path), { recursive: true })
  const loudness = async (filters: string | null): Promise<number | null> =>
    parseLoudnorm(await measureFfmpeg(voiceMeasureArgs(from.path, filters, m.trackChannels?.[track])))?.i ?? null
  const peaksAt = trackPeaks(m, track)
  const quiet =
    clean && peaksAt && (await exists(peaksAt))
      ? await readFile(peaksAt).then((b) => decodePeaks(b)).then((d) => quietestSecond(d.peaks, d.peaksPerSecond)).catch(() => null)
      : null
  const steps: CareSteps = {
    clicks: care.clicks === true,
    ...(clean ? { clean: { quietSec: quiet } } : {}),
    ...(care.breaths ? { breaths: { amount: care.breaths, threshold: breathThreshold(await loudness(VOICE_BAND)) } } : {}),
    ...(voice ? { voice: { strength: voice, liftDb: voiceLift(await loudness(null), await loudness(voiceChain(voice))) } } : {})
  }
  const scratch = scratchPath(path)
  try {
    await runFfmpeg(careCopyArgs(from.path, scratch, steps, m.trackChannels?.[track]))
    await commitScratch(scratch, path)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
  return path
}

/**
 * A recording's first track on its own, for the preview, where a player given
 * the recording would read its picture for nothing. Taken from the playable
 * file, which the first track plays from, and starting where it starts.
 * Returns where it is.
 */
export async function makeSoundCopy(m: ProjectMedia): Promise<string> {
  const info = await stat(m.playablePath)
  const dir = derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs })).dir
  const { path, peaksPath } = trackPaths(dir, 0)
  // A source whose waveform is being made again has none recorded yet: the copy writes one of its own.
  const channels = m.trackChannels?.[0]
  await makeTrackCopies(m.playablePath, [{ index: 0, path, peaksPath: m.peaksPath !== '' ? m.peaksPath : peaksPath, ...(channels !== undefined ? { channels } : {}) }], m.durationSec)
  return path
}

/**
 * Copy the tracks that are not in the cache yet, then write each copy's
 * waveform if it has none. Each copy is its own ffmpeg, several at a time, and
 * goes to a scratch name first, renamed when it succeeds, so a cancelled run
 * never leaves one that looks finished. One that fails stops the rest.
 *
 * Measured on a two minute recording with five tracks: 26 seconds for the four
 * copies in one pass, 7 seconds side by side.
 */
export async function makeTrackCopies(
  input: string,
  copies: (TrackCopy & { peaksPath: string })[],
  durationSec: number,
  signal?: AbortSignal
): Promise<void> {
  const missing: (TrackCopy & { scratch: string })[] = []
  for (const c of copies) {
    if (!(await exists(c.path))) missing.push({ ...c, scratch: scratchPath(c.path) })
  }
  if (missing.length > 0) {
    for (const c of missing) await mkdir(dirname(c.path), { recursive: true })
    // One failure, or the caller cancelling, stops every copy still running.
    const stop = new AbortController()
    const onAbort = (): void => stop.abort()
    if (signal?.aborted) stop.abort()
    signal?.addEventListener('abort', onAbort)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < missing.length && !stop.signal.aborted) {
        const c = missing[next++]!
        await runFfmpeg(trackCopyArgs(input, [{ index: c.index, path: c.scratch, ...(c.channels !== undefined ? { channels: c.channels } : {}) }]), { signal: stop.signal })
      }
    }
    try {
      const workers = Array.from({ length: Math.min(COPIES_AT_ONCE, missing.length) }, () =>
        worker().catch((err: unknown) => {
          stop.abort()
          throw err
        })
      )
      const results = await Promise.allSettled(workers)
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
      if (signal?.aborted) throw new Error('cancelled')
      for (const c of missing) await commitScratch(c.scratch, c.path)
    } catch (err) {
      for (const c of missing) await rm(c.scratch, { force: true })
      throw err
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
  for (const c of copies) {
    if (!(await exists(c.peaksPath))) await extractPeaks(c.path, c.peaksPath, durationSec, true, signal)
  }
}
