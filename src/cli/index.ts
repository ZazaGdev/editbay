import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { basename, dirname, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { EditListError, buildFromEditList, cutsReport, readEditList, reelsOf, type EditList, type EditSource, type SourceFacts } from '../shared/edit-list'
import { joinProjectFile } from '../shared/project-file'
import { defaultWorkspace } from '../shared/workspace'
import { A1_ID, addSource, createTimeline, timelineOf, upsertTimelineMedia, v1Clips, type ProjectMedia, type Timeline } from '../shared/project'
import { DEFAULT_SILENCE_SETTINGS, defaultListenTracks, findPauses, type SilenceSettings } from '../shared/silences'
import { WINDOW_SEC, groupStretches, joinStretchWords, speechStretches, soundWithin, suspectOf, windowCut, windowTimeline, type SpokenAt, type Suspect } from '../shared/steady-transcript'
import { peaksKey } from '../shared/sound'
import { loudnessEnvelope, matchBySound, refineMatch } from '../shared/sync-by-sound'
import { isProjectPath } from '../shared/project-ext'
import type { PeaksData } from '../shared/types'
import { probeAny, type ProbeResult, type SoundProbe } from '../main/media/probe'
import { detectVfr } from '../main/media/vfr'
import { targetFrameRate } from '../main/media/conform'
import { decodePeaks, extractPeaks } from '../main/media/waveform'
import { COPY_FILTER } from '../main/media/tracks'
import { capture } from '../main/ffmpeg/spawn'
import { ffmpegPath } from '../main/ffmpeg/locate'
import { engineReady, enginePaths } from '../main/speech/engine'
import { SPEECH_RATE, transcribe } from '../main/speech/transcribe'
import { runFfmpeg } from '../main/ffmpeg/run'

/**
 * Editbay's command line, for agents (plan 74): the measuring a rough cut
 * needs, and a project written from an edit list, each command a thin call
 * into the code the app itself runs. Every command prints one JSON object on
 * stdout: `ok: true` and what it found, or `ok: false` and why not, with a
 * non-zero exit. Progress, where there is any, goes to stderr.
 */

const USAGE = `editbay-cli <command>

  probe <files...>                          duration, frame rate, size, codec and audio tracks of each file
  sync <files...> [--track N]               the offset of each file against the first, by matching their sound;
                                            --track is the first file's track, the others' first is used
  transcribe <file> [--track N] [--from S] [--to S] [--window S]
                                            every word heard, with its start and end, a stretch between long pauses at a time
  pauses <file> [--track N]                 the pauses Remove silences would find, with its default settings
  frames <file> <seconds...> --out <dir>    a JPEG of the picture at each time
  build <edit-list.json> --out <file>       a project made from an edit list (docs/edit-list.md)
  open <project.editbay> [--app <exe>]      start Editbay with a project`

/**
 * The folder relative paths are taken from: where the agent ran npm, which
 * npm passes on as INIT_CWD while it runs the script from the repository, or
 * this process's own folder when the tool is run with node directly.
 */
function base(): string {
  return process.env.INIT_CWD ?? process.cwd()
}

/** A path the caller gave, made whole against where the caller is. */
function given(p: string): string {
  return resolve(base(), p)
}

/** A refusal: printed as `{ ok: false, error }`, with this exit code. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly code = 1,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

interface Args {
  positional: string[]
  flags: Map<string, string>
}

/** The arguments after the command, with only the flags this command takes, each given a value. */
function parse(argv: string[], allowed: readonly string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const name = a.slice(2)
    if (!allowed.includes(name)) throw new Refusal(`unknown option --${name}${allowed.length > 0 ? `; this command takes ${allowed.map((x) => `--${x}`).join(', ')}` : ''}`, 2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Refusal(`--${name} needs a value`, 2)
    flags.set(name, value)
    i++
  }
  return { positional, flags }
}

/** `--track N`, an audio track counted from 0, or 0 when not given. */
function trackFlag(args: Args): number {
  const raw = args.flags.get('track')
  if (raw === undefined) return 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Refusal(`--track must be a whole number from 0, not ${raw}`, 2)
  return n
}

function needFiles(paths: string[], least: number, what: string): string[] {
  if (paths.length < least) throw new Refusal(`give ${what}`, 2)
  return paths.map((p) => {
    const full = given(p)
    if (!existsSync(full)) throw new Refusal(`${full} does not exist`)
    return full
  })
}

type Probed = { kind: 'video'; probe: ProbeResult; variableFrameRate: boolean } | { kind: 'sound'; probe: SoundProbe }

async function probe(file: string): Promise<Probed> {
  let found: Awaited<ReturnType<typeof probeAny>>
  try {
    found = await probeAny(file)
  } catch (err) {
    throw new Refusal(`${file} could not be read as a recording or a sound file: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (found.kind === 'sound') return found
  const v = found.probe.video
  return { kind: 'video', probe: found.probe, variableFrameRate: await detectVfr(file, v.nominalFps, v.averageFps) }
}

/** What a project needs to know about a source, from its probe. */
function factsOf(p: Probed): SourceFacts {
  if (p.kind === 'sound') {
    // Only a sound file's first track plays, so the app records it as having one, and so does this.
    return { durationSec: p.probe.durationSec, width: 0, height: 0, fps: 0, codec: p.probe.audio.codec, hasAudio: true, hasVideo: false, audioTracks: 1 }
  }
  const r = p.probe
  return {
    durationSec: r.durationSec,
    width: r.video.width,
    height: r.video.height,
    fps: targetFrameRate(r),
    codec: r.video.codec,
    hasAudio: r.audio !== null,
    hasVideo: true,
    audioTracks: r.audioTracks
  }
}

/** The audio tracks that can play: a sound file's first only, as in the app. */
function audioTracksOf(p: Probed): number {
  return p.kind === 'sound' ? 1 : p.probe.audio === null ? 0 : p.probe.audioTracks
}

/** Seconds kept to the hundredth, which is finer than any frame and easier to read. */
function sec(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Remove what an earlier run left in the temp folder, once it is a day old.
 * On Windows a process stopped from outside, as by a time limit, is ended
 * without hearing SIGTERM, so its folder stays until this finds it. A day is
 * longer than any run takes, so a run going on beside this one is left alone.
 */
async function sweepScratch(now = Date.now()): Promise<void> {
  let names: string[] = []
  try {
    names = (await readdir(tmpdir())).filter((n) => n.startsWith('editbay-cli-'))
  } catch {
    return
  }
  for (const n of names) {
    const full = join(tmpdir(), n)
    try {
      if (now - (await stat(full)).mtimeMs > 24 * 60 * 60 * 1000) await rm(full, { recursive: true, force: true })
    } catch {
      // In use or not ours to remove: tried again next time.
    }
  }
}

/**
 * Work in a folder of its own in the temp folder, removed however the work
 * ends: finished, failed, or stopped with Ctrl+C or by an agent's time limit,
 * which sends SIGINT or SIGTERM. A transcription's copies of a long recording
 * are large, and nothing else would ever remove them.
 */
async function withScratch<T>(work: (dir: string) => Promise<T>): Promise<T> {
  await sweepScratch()
  const dir = await mkdtemp(join(tmpdir(), 'editbay-cli-'))
  const stopped = (signal: NodeJS.Signals): void => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // A file still held by the program being stopped: the rest is gone.
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', stopped)
  process.once('SIGTERM', stopped)
  try {
    return await work(dir)
  } finally {
    process.off('SIGINT', stopped)
    process.off('SIGTERM', stopped)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/**
 * One audio track's peaks, as the app makes them at import: the first track
 * straight from the file, any other through the filter its copy is made with.
 */
async function peaksOf(file: string, p: Probed, track: number, dir: string): Promise<PeaksData> {
  const tracks = audioTracksOf(p)
  if (tracks === 0) throw new Refusal(`${file} has no sound`)
  if (track >= tracks) throw new Refusal(`${file} has ${tracks} audio track${tracks === 1 ? '' : 's'}, counted from 0, so it has no track ${track}`)
  const out = join(dir, `peaks-${Math.random().toString(36).slice(2)}.bin`)
  await extractPeaks(file, out, p.probe.durationSec, true, undefined, track > 0 ? { track, filter: COPY_FILTER } : {})
  return decodePeaks(await readFile(out))
}

/** A source as a timeline for the app's own functions to work on: the whole file on V1, its sound on A1. */
function soloTimeline(file: string, p: Probed, track: number, fps: number, extra: Partial<ProjectMedia> = {}): Timeline {
  const f = factsOf(p)
  const m: ProjectMedia = {
    id: 'source',
    originalPath: file,
    playablePath: file,
    conformed: false,
    conformReasons: [],
    durationSec: f.durationSec,
    width: f.width,
    height: f.height,
    fps: f.fps,
    codec: f.codec,
    hasAudio: f.hasAudio,
    peaksPath: '',
    filmstripPath: '',
    audioTracks: f.audioTracks,
    ...(f.hasVideo ? {} : { hasVideo: false }),
    ...extra
  }
  const t = upsertTimelineMedia(createTimeline(fps, { width: 1920, height: 1080 }, 'landscape'), m)
  return addSource(t, { mediaId: m.id, clipId: 'clip', at: 0, whole: true, streams: [track] })
}

async function probeCommand(argv: string[]): Promise<unknown> {
  const files = needFiles(parse(argv, []).positional, 1, 'at least one file to probe')
  const out = []
  for (const file of files) {
    const p = await probe(file)
    if (p.kind === 'sound') {
      out.push({ path: file, kind: 'sound', durationSec: p.probe.durationSec, startSec: p.probe.startSec, codec: p.probe.audio.codec, audioTracks: audioTracksOf(p), trackNames: p.probe.trackNames.slice(0, 1) })
      continue
    }
    const r = p.probe
    out.push({
      path: file,
      kind: 'video',
      durationSec: r.durationSec,
      startSec: r.startSec,
      fps: targetFrameRate(r),
      variableFrameRate: p.variableFrameRate,
      width: r.video.width,
      height: r.video.height,
      codec: r.video.codec,
      audioTracks: audioTracksOf(p),
      trackNames: r.trackNames,
      chapters: r.chapters
    })
  }
  return { files: out }
}

async function pausesCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['track'])
  const [file] = needFiles(args.positional, 1, 'the file to find pauses in')
  const track = trackFlag(args)
  const p = await probe(file!)
  if (p.kind === 'sound') throw new Refusal(`${file} has no picture: Remove silences works through the pictures on V1`)
  return withScratch(async (dir) => {
    const data = await peaksOf(file!, p, track, dir)
    // At the rate a new project has, as Remove silences sees the recording laid whole on V1.
    const fps = 30
    const t = soloTimeline(file!, p, track, fps)
    const found = findPauses(t, new Map([[peaksKey('source', track), data]]), new Set(defaultListenTracks(t)), DEFAULT_SILENCE_SETTINGS)
    const pauses = found.pauses.map((s) => ({ fromSec: sec(s.from / fps), toSec: sec(s.to / fps) }))
    return {
      file,
      track,
      settings: DEFAULT_SILENCE_SETTINGS,
      pauses,
      totalSec: sec(found.pauses.reduce((n, s) => n + (s.to - s.from), 0) / fps)
    }
  })
}

async function framesCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['out'])
  const [file, ...times] = args.positional
  const [source] = needFiles(file === undefined ? [] : [file], 1, 'a file and at least one time in seconds')
  if (times.length === 0) throw new Refusal('give at least one time in seconds', 2)
  const outDir = args.flags.get('out')
  if (outDir === undefined) throw new Refusal('give --out <dir> for the pictures', 2)
  const p = await probe(source!)
  if (p.kind === 'sound') throw new Refusal(`${source} has no picture`)
  const at = times.map((t) => {
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) throw new Refusal(`${t} is not a time in seconds`, 2)
    if (n >= p.probe.durationSec) throw new Refusal(`${n} s is past the end of ${source}, which is ${p.probe.durationSec} s long`)
    return n
  })
  const dir = given(outDir)
  await mkdir(dir, { recursive: true })
  const frames = []
  for (const n of at) {
    const out = join(dir, `frame-${n.toFixed(3)}s.jpg`)
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', n.toFixed(3), '-i', source!, '-frames:v', '1', '-q:v', '3', '-y', out], { collectStdout: false })
    if (!existsSync(out)) throw new Refusal(`no picture could be read at ${n} s of ${source}`)
    frames.push({ atSec: n, path: out })
  }
  return { file: source, frames }
}

/** Where Editbay keeps the speech engine it downloaded, which `transcribe` uses rather than downloading its own. */
function speechFolder(): string {
  // A Mac keeps app data in the home folder's Application Support (plan 104).
  const appData = process.platform === 'darwin' && process.env.HOME ? join(process.env.HOME, 'Library', 'Application Support') : process.env.APPDATA
  if (!appData) throw new Refusal('APPDATA is not set, so the speech engine Editbay downloaded cannot be found')
  return join(appData, 'editbay', 'speech')
}

/** `--from` or `--to`, seconds of the file, or undefined when not given. */
function secondsFlag(args: Args, name: string): number | undefined {
  const raw = args.flags.get(name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Refusal(`--${name} must be a number of seconds from 0, not ${raw}`, 2)
  return n
}

/** The pauses `transcribe` splits a recording at (plan 75): Remove silences' own, quiet for 2 s or more. */
const SPLIT_SETTINGS: SilenceSettings = { ...DEFAULT_SILENCE_SETTINGS, shortestSec: 2 }

async function transcribeCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['track', 'from', 'to', 'window'])
  const [file] = needFiles(args.positional, 1, 'the file to transcribe')
  const track = trackFlag(args)
  const folder = speechFolder()
  if (!(await engineReady(folder))) throw new Refusal(`the speech engine is not in ${folder}: make captions once in Editbay first, which downloads it`)
  const engine = enginePaths(folder)
  const p = await probe(file!)
  const tracks = audioTracksOf(p)
  if (tracks === 0) throw new Refusal(`${file} has no sound`)
  if (track >= tracks) throw new Refusal(`${file} has ${tracks} audio track${tracks === 1 ? '' : 's'}, counted from 0, so it has no track ${track}`)
  const length = p.probe.durationSec
  const window = secondsFlag(args, 'window') ?? WINDOW_SEC
  const fromSec = secondsFlag(args, 'from') ?? 0
  const toSec = Math.min(length, secondsFlag(args, 'to') ?? length)
  if (fromSec >= toSec) throw new Refusal(`--from ${fromSec} is not before --to ${toSec} within ${file}, which is ${length} s long`, 2)

  return withScratch(async (dir) => {
    // Where the long pauses are, found as Remove silences finds them, on a
    // picture laid over the whole file so a sound file is listened to as well.
    const fps = 100
    const data = await peaksOf(file!, p, track, dir)
    const listen = soloTimeline(file!, p, track, fps, { hasVideo: true })
    const found = findPauses(listen, new Map([[peaksKey('source', track), data]]), new Set(defaultListenTracks(listen)), SPLIT_SETTINGS)
    // Every quiet stretch, as Remove silences finds them, to tell how much sound a stretch really holds.
    const quiet = findPauses(listen, new Map([[peaksKey('source', track), data]]), new Set(defaultListenTracks(listen)), DEFAULT_SILENCE_SETTINGS).pauses.map((q) => ({
      fromSec: q.from / fps,
      toSec: q.to / fps
    }))
    // Each stretch heard alone, unless --window asks for windows of that many seconds: see `groupStretches` and `WINDOW_SEC`.
    const stretches = groupStretches(
      speechStretches(
        found.pauses.map((s) => ({ fromSec: s.from / fps, toSec: s.to / fps })),
        fromSec,
        toSec
      ),
      window
    )

    // The track decoded once into a listening copy, one channel at whisper's rate, and every
    // window cut from that rather than from the recording, which would be decoded from its start
    // for every window. Track 0 is counted from its own start, as the app's mix counts it; another
    // track from the recording's start, as the app's copy of it starts.
    const listening = join(dir, 'listening.wav')
    await runFfmpeg([
      '-i', file!,
      '-map', `0:a:${track}`,
      '-af', track > 0 ? `${COPY_FILTER},aresample=${SPEECH_RATE}` : `asetpts=PTS-STARTPTS,aresample=${SPEECH_RATE}`,
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y', listening
    ])

    const parts: { fromSec: number; words: SpokenAt[] }[] = []
    const suspect: Suspect[] = []
    for (const [i, s] of stretches.entries()) {
      process.stderr.write(`transcribing window ${i + 1} of ${stretches.length}: ${sec(s.fromSec)} s to ${sec(s.toSec)} s\n`)
      // The window alone, in a file of its own in the temp folder, heard from its own 0 s.
      const cut = windowCut(s, fps)
      const piece = join(dir, `window-${i}.wav`)
      await runFfmpeg(['-ss', cut.startSec.toFixed(2), '-t', cut.lengthSec.toFixed(2), '-i', listening, '-c:a', 'pcm_s16le', '-y', piece])
      const heard = await transcribe({
        timeline: windowTimeline(piece, cut.lengthSec, fps),
        trackIds: [A1_ID],
        runner: { command: engine.cli, prefix: [] },
        model: engine.model,
        dtw: engine.dtw,
        scratchDir: join(dir, `speech-${i}`),
        onProgress: () => undefined
      })
      await rm(piece, { force: true })
      const words = heard.map((w) => ({ text: w.text, startSec: w.start / fps, endSec: (w.start + w.length) / fps }))
      parts.push({ fromSec: cut.startSec, words })
      suspect.push(...suspectOf(s, words.map((w) => w.text), soundWithin(s, quiet)))
    }
    return {
      file,
      track,
      model: basename(engine.model),
      fromSec: sec(fromSec),
      toSec: sec(toSec),
      window,
      windows: stretches.length,
      words: joinStretchWords(parts),
      // Stretches whose words are not to be trusted: one phrase over and over ("repeat"), or words from a sound under half a second ("short sound"). Their words are kept above; treat them as unheard.
      suspect
    }
  })
}

async function syncCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['track'])
  const files = needFiles(args.positional, 2, 'at least two files to line up')
  const track = trackFlag(args)
  return withScratch(async (dir) => {
    const envelopes: { coarse: number[]; fine: number[] }[] = []
    // The track asked for is the first file's, OBS's microphone say; a phone or a camera has its voice on its first.
    for (const [i, file] of files.entries()) {
      const data = await peaksOf(file, await probe(file), i === 0 ? track : 0, dir)
      envelopes.push({ coarse: loudnessEnvelope(data.peaks, data.peaksPerSecond), fine: loudnessEnvelope(data.peaks, data.peaksPerSecond, data.peaksPerSecond) })
    }
    const [first] = envelopes
    const results = files.slice(1).map((file, i) => {
      const other = envelopes[i + 1]!
      const coarse = matchBySound(first!.coarse, other.coarse)
      if (!coarse.ok) return { path: file, ok: false, offsetSec: coarse.offsetSec, confidence: coarse.confidence, reason: coarse.reason }
      // The coarse match is a tenth of a second at best: made finer at the waveform's own hundredths.
      const fine = refineMatch(first!.fine, other.fine, 100, coarse.offsetSec, 0.2)
      return { path: file, ok: true, offsetSec: sec(fine.offsetSec), confidence: coarse.confidence }
    })
    const refused = results.filter((r) => !r.ok)
    if (refused.length > 0) {
      throw new Refusal(refused.map((r) => `${r.path}: ${r.reason}`).join('; '), 1, { reference: files[0], files: results })
    }
    return { reference: files[0], files: results.map(({ ok: _ok, ...r }) => r) }
  })
}

async function buildCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['out'])
  const [listPath] = needFiles(args.positional, 1, 'the edit list to build')
  const outFlag = args.flags.get('out')
  if (outFlag === undefined) throw new Refusal('give --out <project.editbay> for the project', 2)
  const out = given(outFlag)
  if (!isProjectPath(out)) throw new Refusal(`${out} is not a project file name: end it in .editbay`, 2)
  if (existsSync(out)) throw new Refusal(`${out} already exists, and is never written over`)

  let list
  try {
    list = readEditList((await readFile(listPath!)).toString())
  } catch (err) {
    if (err instanceof EditListError) throw new Refusal(`${listPath}: ${err.message}`)
    throw err
  }
  // A source's path is taken from the list's own folder when it is not a whole path.
  const whole = (sources: EditSource[]): EditSource[] => sources.map((s) => ({ ...s, path: resolve(dirname(listPath!), s.path) }))
  const resolved: EditList =
    list.version === 1 ? { ...list, sources: whole(list.sources) } : { ...list, reels: list.reels.map((r) => ({ ...r, sources: whole(r.sources) })) }
  // Each file probed once, however many reels or roles it has.
  const facts = new Map<string, SourceFacts>()
  for (const [r, reel] of reelsOf(resolved).entries()) {
    for (const [i, s] of reel.sources.entries()) {
      if (facts.has(s.path)) continue
      if (!existsSync(s.path)) throw new Refusal(`${resolved.version === 1 ? '' : `reels[${r}].`}sources[${i}].path: ${s.path} does not exist`)
      facts.set(s.path, factsOf(await probe(s.path)))
    }
  }

  let built
  try {
    built = buildFromEditList(resolved, facts, basename(out, extname(out)))
  } catch (err) {
    if (err instanceof EditListError) throw new Refusal(`${listPath}: ${err.message}`)
    throw err
  }
  await mkdir(dirname(out), { recursive: true })
  // Sources on the project's drive are kept relative to it as well, as the app saves them.
  const project = built.project
  await writeFile(out, joinProjectFile(project, defaultWorkspace(), { path, projectPath: out }), { flag: 'wx' })

  const t = timelineOf(project, project.sequences[0]!.id)
  const fps = project.fps
  const pieces = v1Clips(t)
  const end = pieces.reduce((n, c) => Math.max(n, c.timelineStart + c.sourceOut - c.sourceIn), 0)
  const reelOf = (frame: number): number => built.reels.findIndex((r) => frame >= r.startFrame && frame < r.endFrame)
  return {
    project: out,
    shape: t.presetId,
    durationSec: sec(end / fps),
    // Where each reel starts and ends in the cut, so times in it can be given for the cut.
    reels: built.reels.map((r, i) => ({ reel: i, path: reelsOf(resolved)[i]!.sources.find((s) => s.id === reelsOf(resolved)[i]!.main)!.path, startSec: sec(r.startFrame / fps), endSec: sec(r.endFrame / fps) })),
    // `fromSec` and `toSec` are on the reel's main recording's clock, `atSec` on the cut's.
    pieces: pieces.map((c) => ({ reel: reelOf(c.timelineStart), fromSec: sec(c.sourceIn / fps), toSec: sec(c.sourceOut / fps), atSec: sec(c.timelineStart / fps) })),
    // Every stretch taken out, `fromSec` and `toSec` on the reel's main recording's clock, with its words.
    cuts: cutsReport(resolved),
    corner: t.videoTracks.length > 1,
    zooms: reelsOf(resolved).reduce((n, r) => n + r.zooms.length, 0),
    markers: t.markers.map((m) => ({ atSec: sec(m.frame / fps), name: m.name }))
  }
}

async function openCommand(argv: string[]): Promise<unknown> {
  const args = parse(argv, ['app'])
  const [project] = needFiles(args.positional, 1, 'the project to open')
  if (!isProjectPath(project!)) throw new Refusal(`${project} is not an Editbay project`, 2)
  // Beside this tool, which is built into out/cli of the repository.
  const flag = args.flags.get('app')
  const release = join(__dirname, '..', '..', 'release')
  const built =
    process.platform === 'darwin'
      ? join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Editbay.app', 'Contents', 'MacOS', 'Editbay')
      : join(release, 'win-unpacked', 'Editbay.exe')
  const app = flag !== undefined ? given(flag) : built
  if (!existsSync(app)) throw new Refusal(`Editbay is not at ${app}: build it with npm run dist:dir, or give --app <Editbay.exe>`)
  const child = spawn(app, [project!], { detached: true, stdio: 'ignore', windowsHide: false })
  await new Promise<void>((done, fail) => {
    child.once('spawn', () => done())
    child.once('error', (err) => fail(new Refusal(`Editbay could not be started: ${err.message}`)))
  })
  child.unref()
  return { app, project, pid: child.pid }
}

const COMMANDS: Record<string, (argv: string[]) => Promise<unknown>> = {
  probe: probeCommand,
  sync: syncCommand,
  transcribe: transcribeCommand,
  pauses: pausesCommand,
  frames: framesCommand,
  build: buildCommand,
  open: openCommand
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv
  const command = name === undefined ? undefined : COMMANDS[name]
  try {
    if (name === 'help' || name === '--help') {
      process.stdout.write(`${JSON.stringify({ ok: true, usage: USAGE }, null, 2)}\n`)
      return 0
    }
    if (!command) throw new Refusal(name === undefined ? USAGE : `unknown command ${name}\n\n${USAGE}`, 2)
    const result = (await command(rest)) as Record<string, unknown>
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`)
    return 0
  } catch (err) {
    const refusal = err instanceof Refusal ? err : null
    const message = err instanceof Error ? err.message : String(err)
    process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...(refusal?.extra ?? {}) }, null, 2)}\n`)
    return refusal?.code ?? 1
  }
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
