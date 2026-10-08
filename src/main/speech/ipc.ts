import { tracksCopied } from '../media/import'
import { testLaunch } from '../test-launch'
import { app, ipcMain, net } from 'electron'
import { join } from 'node:path'
import type { SpeechDownloadResult, SpeechProgress, SpeechStatus, TranscribeResult } from '../../shared/types'
import { listenTracks, sequenceOf, stretchedTimeline, timelineOf, type Timeline } from '../../shared/project'
import { mergeStretches, wordsBack, type Stretch, type TimedWord } from '../../shared/captions'
import { ProcessError } from '../ffmpeg/spawn'
import * as session from '../project/session'
import { SOURCES, SpeechError, engineIntact, engineReady, enginePaths, installEngine, removeEngine, type SpeechSources } from './engine'
import { transcribe, type SpeechRunner } from './transcribe'
import { rememberHeard } from './heard'

/**
 * Making captions from the speech: the engine downloaded once, on first use,
 * into the app's data folder, and a sequence listened to on the tracks chosen.
 */


/**
 * A test launch can stand a script in for whisper-cli, run with Electron as
 * Node, and download the engine from somewhere of its own, each read when it
 * is needed so a test can change them as it goes. Nothing else can: the
 * program run is always the one checked against the app's own checksums.
 */
// The stand-in engine is run by Editbay's own program as Node, which the
// installed app's switches forbid: only the packaged test's copy can.
function fakeEngine(): string | null {
  return testLaunch ? (process.env.EDITBAY_SPEECH_FAKE ?? null) : null
}

function testSources(): SpeechSources | null {
  // Never in the installed app, which could otherwise be pointed at another program to download and run (audit 2026-10-01).
  const given = testLaunch && !app.isPackaged ? process.env.EDITBAY_SPEECH_SOURCES : undefined
  return given ? (JSON.parse(given) as SpeechSources) : null
}

function sources(): SpeechSources {
  return testSources() ?? SOURCES
}

function speechFolder(): string {
  return join(app.getPath('userData'), 'speech')
}

async function ready(): Promise<boolean> {
  // A stand-in engine needs nothing downloaded, unless the test is of the download.
  if (fakeEngine() && !testSources()) return true
  return engineReady(speechFolder(), sources())
}

async function runner(): Promise<SpeechRunner> {
  const fake = fakeEngine()
  if (fake) return { command: process.execPath, prefix: [fake], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  // The program run is the one downloaded, as it is now, not only as it was then (audit 2026-10-01).
  // A test's own download is its own build, checked only as it arrives.
  if (!testSources() && !(await engineIntact(speechFolder()))) {
    await removeEngine(speechFolder())
    throw new SpeechError('The speech engine on this computer has changed since it was downloaded, so it was not run. Make captions again to download it afresh.')
  }
  return { command: enginePaths(speechFolder(), sources()).cli, prefix: [] }
}

let downloading: AbortController | null = null
let listening: AbortController | null = null
/** The download and the listening under way, to wait for once they are stopped. */
const running = new Set<Promise<unknown>>()

/** Keep `work` among what is running until it settles. */
function tracked<T>(work: Promise<T>): Promise<T> {
  running.add(work)
  void work.finally(() => running.delete(work)).catch(() => undefined)
  return work
}

/** What of speech is under way that closing would stop, if anything (audit 2026-10-01). */
export function speechBusy(): 'captions' | 'download' | null {
  if (downloading) return 'download'
  if (listening) return 'captions'
  return null
}

/**
 * Stop the download and the listening, and wait until they have: a download
 * stopped removes its part file, so none is left behind to fill the disk.
 */
export async function stopSpeech(): Promise<void> {
  downloading?.abort()
  listening?.abort()
  await Promise.allSettled([...running])
}

/** What went wrong, in words a person can use: the engine's and ffmpeg's own are for the details. */
export function speechTrouble(err: unknown, doing: string): { error: string; details?: string } {
  if (err instanceof SpeechError) return { error: err.message }
  const details = err instanceof ProcessError ? err.stderr.trim().split('\n').slice(-25).join('\n') : String(err)
  return { error: `The speech could not be ${doing}.`, details }
}

/** Whether the speech engine is on this computer, ready to listen. */
export function speechReady(): Promise<boolean> {
  return ready()
}

let tell: (p: SpeechProgress) => void = () => undefined

/**
 * Listen to a sequence for its transcript, as Make captions would, without
 * making any captions: the tracks Make captions would listen to, or every
 * track with sound when none holds the talking head or a voice over. One
 * listening at a time, shared with Make captions. Its progress goes out as
 * Make captions' does, and to `onProgress`.
 */
export async function listenForTranscript(timeline: Timeline, opts: { signal: AbortSignal; onProgress?: (fraction: number) => void }): Promise<TimedWord[]> {
  if (listening) throw new SpeechError('The speech is already being listened to, for captions. Try again once that has finished.')
  if (!(await ready())) throw new SpeechError('The speech model is not downloaded yet.')
  const chosen = listenTracks(timeline)
  const trackIds = chosen.length > 0 ? chosen : timeline.audioTracks.filter((r) => r.clips.length > 0).map((r) => r.id)
  if (trackIds.length === 0) throw new SpeechError('There is no sound in this sequence to listen to.')
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  opts.signal.addEventListener('abort', stop, { once: true })
  listening = controller
  try {
    return await transcribe({
      timeline,
      trackIds,
      runner: await runner(),
      model: enginePaths(speechFolder(), sources()).model,
      dtw: enginePaths(speechFolder(), sources()).dtw,
      scratchDir: join(app.getPath('temp'), `editbay-speech-${Date.now()}`),
      onProgress: (fraction) => {
        tell({ stage: 'transcribe', fraction })
        opts.onProgress?.(fraction)
      },
      signal: controller.signal
    })
  } finally {
    opts.signal.removeEventListener('abort', stop)
    listening = null
  }
}

export function registerSpeechIpc(broadcast: (channel: string, payload: unknown) => void): void {
  const progress = (p: SpeechProgress): void => broadcast('speech:progress', p)
  tell = progress

  ipcMain.handle('speech:status', async (): Promise<SpeechStatus> => ({ ready: await ready(), downloading: downloading !== null }))

  ipcMain.handle('speech:download', (): Promise<SpeechDownloadResult> => tracked(download()))

  async function download(): Promise<SpeechDownloadResult> {
    if (downloading) return { ok: false, error: 'The speech model is already being downloaded.' }
    const controller = new AbortController()
    downloading = controller
    try {
      await installEngine(speechFolder(), {
        fetch: (url, init) => net.fetch(url, init),
        onProgress: (fraction) => progress({ stage: 'download', fraction }),
        signal: controller.signal,
        sources: sources()
      })
      return { ok: true }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true }
      return { ok: false, error: err instanceof SpeechError ? err.message : 'The speech model could not be downloaded. Check the internet connection and try again.' }
    } finally {
      downloading = null
    }
  }

  ipcMain.handle('speech:cancelDownload', (): void => {
    downloading?.abort()
  })

  ipcMain.handle('speech:transcribe', (_e, sequenceId: string, trackIds: string[], asked?: unknown): Promise<TranscribeResult> => tracked(transcribeNow(sequenceId, trackIds, asked)))

  async function transcribeNow(sequenceId: string, trackIds: string[], asked?: unknown): Promise<TranscribeResult> {
    // Plan 78: only these stretches of the sequence, when some are given.
    const stretches = Array.isArray(asked)
      ? mergeStretches(
          asked.filter((s): s is Stretch => typeof s?.from === 'number' && typeof s?.to === 'number' && Number.isFinite(s.from) && Number.isFinite(s.to))
        )
      : []
    if (listening) return { ok: false, error: 'Captions are already being made.' }
    if (!(await ready())) return { ok: false, error: 'The speech model is not downloaded yet.' }
    const controller = new AbortController()
    listening = controller
    try {
      // The other tracks of a recording just imported may still be being
      // copied, and captions listen to those copies.
      await tracksCopied(new Set(session.getProject().media.map((m) => m.id)), controller.signal)
      if (controller.signal.aborted) return { ok: false, cancelled: true }
      const project = session.getProject()
      if (!project.sequences.some((s) => s.id === sequenceId)) return { ok: false, error: 'That sequence is no longer in the project.' }
      // Kept as it was heard: the window may cut or move clips while it listens.
      const heard = timelineOf(project, sequenceOf(project, sequenceId).id)
      const heardId = rememberHeard(heard)
      // Only the stretches asked for, played one after another, and the words put back where they were said.
      const listenedTo = stretches.length > 0 ? stretchedTimeline(heard, stretches) : heard
      const said = await transcribe({
        timeline: listenedTo,
        trackIds,
        runner: await runner(),
        model: enginePaths(speechFolder(), sources()).model,
        dtw: enginePaths(speechFolder(), sources()).dtw,
        scratchDir: join(app.getPath('temp'), `editbay-speech-${Date.now()}`),
        onProgress: (fraction) => progress({ stage: 'transcribe', fraction }),
        signal: controller.signal
      })
      const words = stretches.length > 0 ? wordsBack(said, stretches) : said
      return { ok: true, words, heardId }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true }
      return { ok: false, ...speechTrouble(err, 'listened to') }
    } finally {
      listening = null
    }
  }

  ipcMain.handle('speech:cancelTranscribe', (): void => {
    listening?.abort()
  })
}
