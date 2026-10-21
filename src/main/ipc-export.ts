import { ipcMain, dialog, shell, BrowserWindow, app, clipboard, Notification, type OpenDialogOptions } from 'electron'
import { fontFor } from './fonts/system-fonts'
import { testLaunch } from './test-launch'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { PeaksData, ExportRequest, ExportPreview, ExportResult, TranscriptResult, ExportProgress, SavedAsset } from '../shared/types'
import { planRender, exportNames, freeName, samePathKey, trackCopiesRead, type ExportNames, type RenderPlan } from '../shared/render-plan'
import { sourceFiles } from '../shared/export-keep'
import { formatTimecode } from '../shared/time'
import { exists, writeAtomic } from './media/cache'
import { presetById } from '../shared/presets'
import { ExportFailure, runExport } from './render/runner'
import { trustSharesOf, trustedShares } from './settings/trusted-shares'
import { mayUse, shareOf } from '../shared/source-paths'
import { sequenceOf, timelineDuration, timelineOf, trackPeaks, wantingCareCopy, wantingCleanCopy, wantingVoiceCopy, type Project, type Timeline } from '../shared/project'
import { canEncodeOnGpu } from './ffmpeg/locate'
import { captureFfmpeg } from './ffmpeg/run'
import { copyingTracks, tracksCopied } from './media/import'
import { decodePeaks } from './media/waveform'
import { peaksKey } from '../shared/sound'
import * as session from './project/session'
import * as lifecycle from './project/lifecycle'
import { listenForTranscript, speechReady, speechTrouble } from './speech/ipc'
import { captionsTranscript, transcriptOf, type TimedWord } from '../shared/captions'
import { formatFilename } from '../shared/filename'
import { broadcast } from './ipc-broadcast'
// Read only when an export is asked for, never while the modules load, so the
// import back from ipc-settings for `exporting` is harmless.
import { settings } from './ipc-settings'
import { effectsFolderOf } from '../shared/source-folders'
import { ASSET_FOLDERS, assetCut } from '../shared/asset-clip'
import { creditsFor } from './credits'
import { creditsText, mediaPathsIn } from '../shared/credits'

let exportAbort: AbortController | null = null
/** Settles once the running export has stopped and cleaned up after itself. */
let exportSettled: Promise<void> = Promise.resolve()

/** Stop the running export, if there is one, and wait until it has cleaned up. */
export async function stopExport(): Promise<void> {
  exportAbort?.abort()
  await exportSettled
}

/** Whether an export is running, for anything that must not happen during one. */
export function exporting(): boolean {
  return exportAbort !== null
}


interface PlannedExport {
  /** The sequence's id and name. */
  id: string
  name: string
  timeline: Timeline
  plan: RenderPlan
  scratchDir: string
}

/**
 * Whether an export may go to `dir`. A folder on another computer only on a
 * share you have used: one you chose, the one the project is on, or the one
 * set in Settings. A project names its last export folder, and one from
 * someone else could name their own computer, which Windows signs in to as you.
 */
async function exportFolderAllowed(dir: string): Promise<boolean> {
  // A Windows project's last folder, opened on a Mac, would be written as a
  // folder named `D:\...` under wherever the app was started (task 1388).
  if (process.platform === 'darwin' && /^[A-Za-z]:[\\/]/.test(dir)) return false
  const yours = [session.getProjectPath(), (await settings).exportFolder].flatMap((p) => {
    const share = p ? shareOf(p) : null
    return share ? [share] : []
  })
  return mayUse(dir, new Set([...trustedShares(), ...yours]))
}

function notAllowed(dir: string): string {
  if (process.platform === 'darwin' && /^[A-Za-z]:[\\/]/.test(dir)) {
    return `${dir} is a Windows folder, not one on this Mac. Choose a folder to export to.`
  }
  return `${dir} is on another computer this project has not been given. Choose the folder again to export there.`
}

/**
 * The plans an export makes: one for each sequence asked for that has
 * anything on it, in order. Each takes names that none before it took and
 * none in `keep` has, so exporting every sequence into one folder, or keeping
 * the files already there, never writes one file over another. None ever takes
 * the name of a file the project's sources are made of, whatever `keep` says.
 */
/**
 * The waveforms of every sound on a track that does not duck, for the
 * sequences that have a track that does: where the voice is, which the
 * export ducks the others under. None at all when nothing ducks, which is
 * nearly always, so an ordinary export reads nothing extra. A waveform that
 * cannot be read is left out, and counts as silence, as it does in the window.
 */
async function voicePeaks(project: Project): Promise<Map<string, PeaksData>> {
  const out = new Map<string, PeaksData>()
  for (const s of project.sequences) {
    if (!s.audioTracks.some((r) => r.duck === true)) continue
    for (const track of s.audioTracks) {
      if (track.duck === true) continue
      for (const c of track.clips) {
        const key = peaksKey(c.mediaId, c.track)
        const m = project.media.find((x) => x.id === c.mediaId)
        const path = m ? trackPeaks(m, c.track) : null
        if (out.has(key) || !path) continue
        try {
          out.set(key, decodePeaks(await readFile(path)))
        } catch {
          // Silence, as a waveform not loaded yet is in the window.
        }
      }
    }
  }
  return out
}

/** A sequence's names, with the name typed for its one video, when one was, in place of the one it would be given. */
function named(names: ExportNames, request: ExportRequest): ExportNames {
  const typed = request.fileName?.trim()
  return typed && request.mode === 'join' && !request.allSequences ? { ...names, joined: typed } : names
}

/**
 * The sequences an export has to listen to for a transcript: those asked for
 * that are one video, have no captions to take the words from, and have
 * something on them.
 */
function toListenTo(request: ExportRequest, project: Project): string[] {
  if (request.transcriptFile !== true || request.mode !== 'join') return []
  const ids = request.allSequences ? project.sequences.map((s) => s.id) : [request.sequenceId]
  return ids.filter((id) => {
    const t = timelineOf(project, id)
    return presetById(t.presetId).joinable && t.captions.clips.length === 0 && timelineDuration(t) > 0
  })
}

function planExport(
  request: ExportRequest,
  scratchBase: string,
  keep: string[],
  peaks?: ReadonlyMap<string, PeaksData>,
  heard?: ReadonlyMap<string, TimedWord[]>
): { plans: PlannedExport[]; empty: string[] } {
  const project = session.getProject()
  if (!request.allSequences && !project.sequences.some((s) => s.id === request.sequenceId)) {
    throw new Error('That sequence is no longer in the project.')
  }
  const ids = request.allSequences ? project.sequences.map((s) => s.id) : [request.sequenceId]
  const plans: PlannedExport[] = []
  const empty: string[] = []
  const taken = [...sourceFiles(project.media), ...keep]
  for (const [i, id] of ids.entries()) {
    const name = sequenceOf(project, id).name
    const timeline = timelineOf(project, id)
    if (timelineDuration(timeline) === 0) {
      empty.push(name)
      continue
    }
    const scratchDir = join(scratchBase, `sequence-${i + 1}`)
    let plan: RenderPlan
    try {
      plan = planRender({
        timeline,
        names: named(exportNames(project, id), request),
        preset: presetById(timeline.presetId),
        mode: request.mode,
        outputDir: request.outputDir,
        scratchDir,
        filenamePattern: request.filenamePattern,
        keep: taken,
        ...(request.range && !request.allSequences ? { range: request.range } : {}),
        ...(request.subtitleFile ? { subtitleFile: true } : {}),
        ...(request.transcriptFile ? { transcriptFile: true } : {}),
        ...(heard?.has(id) ? { heard: heard.get(id)! } : {}),
        ...(request.sharpen ? { sharpen: true } : {}),
        ...(request.fast ? { fast: true } : {}),
        ...(peaks ? { peaks } : {})
      })
    } catch (err) {
      // One file per clip is made of V1's clips, so a sequence with sound or
      // pictures only on its other tracks has nothing to give that way. Left out, as
      // an empty one is, rather than stopping every other sequence.
      if (err instanceof Error && /nothing on the timeline/i.test(err.message) && !request.range) {
        empty.push(name)
        continue
      }
      throw err
    }
    taken.push(...plan.outputs, ...plan.beside.map((b) => b.path))
    plans.push({ id, name, timeline, plan, scratchDir })
  }
  return { plans, empty }
}

/**
 * Where the captions' font is: beside the app's own files once installed,
 * and in the project's resources folder when run from its source.
 */
function captionFontsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts')
}

/** Every file in a folder, by its full path, or none when the folder is not there yet. */
async function filesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => join(dir, name))
  } catch {
    return []
  }
}

/**
 * Notifications on screen. Held until clicked or closed: one nobody holds can
 * be collected, and clicking it in the Action Center then does nothing.
 */
const notices = new Set<Notification>()

/**
 * Tell you an export has finished, when the window is not in front: its
 * taskbar button flashes and Windows shows a notification. A test run records
 * what it would have said instead of putting it on the screen of whoever is
 * at the machine.
 */
function tellDone(win: BrowserWindow | null, text: string): void {
  if (!win || win.isDestroyed()) return
  // A minimized window can still count as focused, but it is not in front.
  if (win.isFocused() && !win.isMinimized()) return
  if (testLaunch) {
    const g = globalThis as { editbayNotified?: string[] }
    ;(g.editbayNotified ??= []).push(text)
    return
  }
  win.flashFrame(true)
  if (!Notification.isSupported()) return
  const notice = new Notification({ title: 'Editbay', body: text })
  notices.add(notice)
  notice.on('click', () => {
    notices.delete(notice)
    if (win.isDestroyed()) return
    win.show()
    win.focus()
  })
  notice.on('close', () => notices.delete(notice))
  notice.show()
}

/** Every file an export has written, as `samePathKey` gives them: the only files the window may open. */
const exported = new Set<string>()
/**
 * The files of the fonts from this PC that these timelines' captions are
 * written in (plan 87), and the families not found on this computer, which
 * libass then burns in with another.
 */
async function pcCaptionFonts(timelines: Timeline[]): Promise<{ files: string[]; missing: string[] }> {
  const families = new Set(timelines.flatMap((t) => (t.captions.clips.length > 0 && t.captions.style.pcFont ? [t.captions.style.pcFont.family] : [])))
  const files: string[] = []
  const missing: string[] = []
  for (const family of families) {
    const found = await fontFor(family)
    if (found) files.push(found.path)
    else missing.push(family)
  }
  return { files, missing }
}

/** The open project's sources, the only ones whose track copies anything waits for. */
export function openMedia(): Set<string> {
  return new Set(session.getProject().media.map((m) => m.id))
}

function broadcastExport(progress: ExportProgress): void {
  broadcast('export:progress', progress)
}

/** The export's handlers, and the reveal, open and copy ones beside them, registered where they always were. */
export function registerExportIpc(): void {
  ipcMain.handle('export:pickFolder', async (event, from?: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Where should the export go?',
      ...(from ? { defaultPath: from } : {})
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const chosen = result.canceled ? null : (result.filePaths[0] ?? null)
    // You chose it, so the share it is on, if it is on one, is one you use.
    if (chosen) await trustSharesOf([chosen])
    return chosen
  })

  // Beside the project file, where its footage usually is, or Videos for a
  // project not saved yet. Never nowhere: an export is never refused for want of a folder.
  // A folder of your own, when you have set one in Settings, comes first.
  ipcMain.handle('export:defaultFolder', async (): Promise<string> => {
    const yours = (await settings).exportFolder
    if (yours) return yours
    const path = session.getProjectPath()
    return path ? dirname(path) : app.getPath('videos')
  })

  ipcMain.handle('shell:reveal', async (_e, path: string): Promise<void> => {
    // Never a share you have not used: Windows would sign in to it to show it (audit 2026-10-01).
    if (!mayUse(path, trustedShares())) return
    shell.showItemInFolder(path)
  })

  ipcMain.handle('shell:open', async (_e, path: string): Promise<void> => {
    // Only what an export wrote: the window has no business opening anything else.
    if (!exported.has(samePathKey(path))) return
    await shell.openPath(path)
  })

  ipcMain.handle('clipboard:write', (_e, text: string): void => {
    clipboard.writeText(text)
  })

  ipcMain.handle('export:cancel', (): void => {
    exportAbort?.abort()
  })

  // One frame, as an image: a cover, made by exporting that frame
  // exactly as the video would have it and taking the picture from it.
  ipcMain.handle(
    'export:frame',
    async (_e, request: { sequenceId: string; frame: number; outputDir: string; sharpen?: boolean }): Promise<{ ok: boolean; path?: string; error?: string }> => {
      if (exportAbort) return { ok: false, error: 'An export is running. Save the frame once it has finished.' }
      // Holding the export's place, so an export started meanwhile waits rather than running beside it.
      const controller = new AbortController()
      exportAbort = controller
      let settled = (): void => undefined
      exportSettled = new Promise((resolve) => (settled = resolve))
      try {
        return await saveFrameNow(request, controller.signal)
      } finally {
        exportAbort = null
        settled()
      }
    }
  )

  // Plan 96: clips saved into the assets folder as they play, one job at a time like any export.
  ipcMain.handle('export:asset', async (_e, sequenceId: unknown, clipIds: unknown): Promise<SavedAsset> => {
    if (typeof sequenceId !== 'string' || !Array.isArray(clipIds) || !clipIds.every((x) => typeof x === 'string')) return { ok: false, error: 'Nothing to save.' }
    if (exportAbort) return { ok: false, error: 'An export is running. Save the clip once it has finished.' }
    const controller = new AbortController()
    exportAbort = controller
    let settled = (): void => undefined
    exportSettled = new Promise((resolve) => (settled = resolve))
    try {
      return await saveAssetNow(sequenceId, clipIds as string[], controller.signal)
    } finally {
      exportAbort = null
      settled()
    }
  })

  async function saveAssetNow(sequenceId: string, clipIds: string[], signal: AbortSignal): Promise<SavedAsset> {
    const assets = effectsFolderOf((await settings).sourceFolders)?.folder
    if (!assets) return { ok: false, error: 'Choose an assets folder in Sources first.' }
    const project = session.getProject()
    if (!project.sequences.some((s) => s.id === sequenceId)) return { ok: false, error: 'That sequence is no longer in the project.' }
    const cut = assetCut(timelineOf(project, sequenceId), clipIds)
    if (!cut) return { ok: false, error: 'Those clips are no longer on the timeline.' }
    await tracksCopied(openMedia(), signal)
    if (signal.aborted) return { ok: false, error: 'Stopped before the clip was saved.' }
    const scratch = join(app.getPath('temp'), `editbay-asset-${Date.now()}`)
    try {
      const image = cut.kind === 'image'
      const planned = planRender({
        timeline: cut.timeline,
        names: { ...exportNames(project, sequenceId), joined: 'asset' },
        preset: presetById(cut.timeline.presetId),
        mode: 'join',
        outputDir: join(scratch, 'out'),
        scratchDir: join(scratch, 'work'),
        filenamePattern: '{project}',
        range: image ? { from: cut.from, to: cut.from + 1 } : { from: cut.from, to: cut.to },
        ...(cut.sound ? {} : { silent: true })
      })
      // A picture nearly lossless, as Save frame makes it.
      const plan = image
        ? { ...planned, loudness: null, segments: planned.segments.map((s) => ({ ...s, args: s.args.map((a, i, all) => (all[i - 1] === '-crf' ? '1' : a)) })) }
        : planned
      const pcFonts = (await pcCaptionFonts([cut.timeline])).files
      const [video] = await runExport({ plan, fps: project.fps, scratchDir: join(scratch, 'work'), onProgress: () => {}, fontsDir: captionFontsDir(), pcFonts, signal })
      if (!video) return { ok: false, error: 'The clip could not be saved.' }
      const dir = join(assets, ASSET_FOLDERS[cut.kind])
      await mkdir(dir, { recursive: true })
      const first = cut.timeline.videoTracks.flatMap((r) => r.clips)[0] ?? cut.timeline.audioTracks.flatMap((r) => r.clips)[0]
      const source = project.media.find((m) => m.id === first?.mediaId)
      const stem = (source?.text?.text.split('\n')[0] ?? basename(source?.originalPath ?? 'clip').replace(/\.[^.]+$/, '')).replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 60) || 'clip'
      const ext = cut.kind === 'image' ? 'png' : cut.kind === 'audio' ? 'm4a' : 'mp4'
      const taken = new Set((await filesIn(dir)).map(samePathKey))
      const out = freeName(join(dir, `${stem} ${formatTimecode(first?.sourceIn ?? 0, project.fps).replace(/[:;]/g, '-')}.${ext}`), taken)
      if (cut.kind === 'image') await captureFfmpeg(['-v', 'error', '-i', video, '-frames:v', '1', '-y', out])
      else if (cut.kind === 'audio') await captureFfmpeg(['-v', 'error', '-i', video, '-vn', '-c:a', 'copy', '-y', out])
      else await copyFile(video, out)
      return { ok: true, path: out, kind: cut.kind }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function saveFrameNow(request: { sequenceId: string; frame: number; outputDir: string; sharpen?: boolean }, signal: AbortSignal): Promise<{ ok: boolean; path?: string; error?: string }> {
      if (!(await exportFolderAllowed(request.outputDir))) return { ok: false, error: notAllowed(request.outputDir) }
      const project = session.getProject()
      if (!project.sequences.some((s) => s.id === request.sequenceId)) return { ok: false, error: 'That sequence is no longer in the project.' }
      const timeline = timelineOf(project, request.sequenceId)
      const end = timelineDuration(timeline)
      if (end === 0) return { ok: false, error: 'There is nothing on the timeline to take a frame of.' }
      const frame = Math.max(0, Math.min(end - 1, Math.round(request.frame)))
      await tracksCopied(openMedia(), signal)
      if (signal.aborted) return { ok: false, error: 'Stopped before the frame was made.' }
      const scratch = join(app.getPath('temp'), `editbay-frame-${Date.now()}`)
      try {
        const names = exportNames(project, request.sequenceId)
        const planned = planRender({
          timeline,
          names: { ...names, joined: 'frame' },
          preset: presetById(timeline.presetId),
          mode: 'join',
          outputDir: join(scratch, 'out'),
          scratchDir: join(scratch, 'work'),
          filenamePattern: '{project}',
          range: { from: frame, to: frame + 1 },
          silent: true,
          ...(request.sharpen ? { sharpen: true } : {})
        })
        // Nearly lossless, since it is a picture people will look at closely,
        // and not levelled: there is a frame of sound, and nothing to hear.
        const plan = {
          ...planned,
          loudness: null,
          segments: planned.segments.map((s) => ({ ...s, args: s.args.map((a, i, all) => (all[i - 1] === '-crf' ? '1' : a)) }))
        }
        const pcFonts = (await pcCaptionFonts([timeline])).files
        const [video] = await runExport({ plan, fps: project.fps, scratchDir: join(scratch, 'work'), onProgress: () => {}, fontsDir: captionFontsDir(), pcFonts, signal })
        if (!video) return { ok: false, error: 'The frame could not be made.' }
        await mkdir(request.outputDir, { recursive: true })
        const stamp = formatTimecode(frame, project.fps).replace(/[:;]/g, '-')
        const taken = new Set((await filesIn(request.outputDir)).map(samePathKey))
        const out = freeName(join(request.outputDir, `${names.joined} ${stamp}.png`), taken)
        await captureFfmpeg(['-v', 'error', '-i', video, '-frames:v', '1', '-y', out])
        return { ok: true, path: out }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
      }
  }

  // The transcript alone, with no video: from the captions when there are
  // some, which is at once, or else listened to. Never over a file already
  // there, as a frame is not. Holds the export's place while it listens, so
  // Cancel and closing the window stop it as they stop an export.
  ipcMain.handle(
    'export:transcript',
    async (_e, request: { sequenceId: string; range?: { from: number; to: number }; outputDir: string; fileName?: string }): Promise<TranscriptResult> => {
      if (exportAbort) return { ok: false, error: 'An export is running. Save the transcript once it has finished.' }
      const controller = new AbortController()
      exportAbort = controller
      let settled = (): void => undefined
      exportSettled = new Promise((resolve) => (settled = resolve))
      try {
        if (!(await exportFolderAllowed(request.outputDir))) return { ok: false, error: notAllowed(request.outputDir) }
        const project = session.getProject()
        if (!project.sequences.some((s) => s.id === request.sequenceId)) return { ok: false, error: 'That sequence is no longer in the project.' }
        const timeline = timelineOf(project, request.sequenceId)
        const end = timelineDuration(timeline)
        if (end === 0) return { ok: false, error: 'There is nothing on the timeline to make a transcript of.' }
        const from = Math.max(0, Math.round(request.range?.from ?? 0))
        const to = Math.min(end, Math.round(request.range?.to ?? end))
        const captioned = timeline.captions.clips.length > 0
        let text: string | null
        if (captioned) text = captionsTranscript({ clips: timeline.captions.clips, from, to, fps: timeline.fps })
        else {
          await tracksCopied(openMedia(), controller.signal)
          if (controller.signal.aborted) return { ok: false, cancelled: true }
          text = transcriptOf(await listenForTranscript(timeline, { signal: controller.signal }), from, to, timeline.fps)
        }
        if (text === null) return { ok: false, error: captioned ? 'No caption is in that part of the sequence.' : 'No speech was heard in that part of the sequence.' }
        const names = exportNames(project, request.sequenceId)
        const name = formatFilename('{project}', { project: request.fileName?.trim() || names.joined, sequence: names.sequence, index: 1, clip: '' }, 'txt')
        const taken = new Set((await filesIn(request.outputDir)).map(samePathKey))
        const out = freeName(join(request.outputDir, name), taken)
        await writeAtomic(out, Buffer.from(text, 'utf8'))
        exported.add(samePathKey(out))
        return { ok: true, path: out }
      } catch (err) {
        if (controller.signal.aborted) return { ok: false, cancelled: true }
        return { ok: false, ...speechTrouble(err, 'listened to') }
      } finally {
        exportAbort = null
        settled()
      }
    }
  )

  ipcMain.handle('export:preview', async (_e, request: ExportRequest): Promise<ExportPreview> => {
    try {
      if (!(await exportFolderAllowed(request.outputDir))) throw new Error(notAllowed(request.outputDir))
      // A sequence the export will listen to has not been heard yet: one word
      // standing in, where the part starts, puts its transcript among the files.
      const at = request.range && !request.allSequences ? request.range.from : 0
      const standIn = new Map(toListenTo(request, session.getProject()).map((id) => [id, [{ text: '...', start: at, length: 1 }]]))
      const { plans, empty } = planExport(request, join(app.getPath('temp'), 'editbay-preview'), [], undefined, standIn)
      // The subtitle and transcript files too: they are written, and can be written over.
      const outputs = plans.flatMap((p) => [...p.plan.outputs, ...p.plan.beside.map((b) => b.path)])
      const existing: string[] = []
      for (const o of outputs) if (await exists(o)) existing.push(o)
      return { outputs, existing, empty }
    } catch (err) {
      return { outputs: [], existing: [], empty: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('export:start', async (event, request: ExportRequest): Promise<ExportResult> => {
    if (exportAbort) return { ok: false, outputs: [], busy: true, error: 'An export is already running.' }
    // Taken before anything is awaited, so a request that arrives meanwhile is refused too.
    const controller = new AbortController()
    exportAbort = controller
    let settled = (): void => undefined
    exportSettled = new Promise((resolve) => (settled = resolve))
    const win = BrowserWindow.fromWebContents(event.sender)
    // Somewhere of our own, so a half finished export never sits in the folder
    // the user is about to look in.
    const scratchBase = join(app.getPath('temp'), `editbay-export-${Date.now()}`)
    const outputs: string[] = []
    let started = false
    // The project it was asked for: another opened while it waits is never exported in its place (audit 2026-10-01).
    const doc = session.getDocId()
    const replaced = (): ExportResult | null =>
      session.getDocId() === doc ? null : { ok: false, outputs: [], error: 'Another project was opened while the export was waiting, so it stopped. Export again from this one.' }

    try {
      // A recording just imported may still have its other tracks being
      // copied. The export reads those copies, and planned without them it
      // would leave their sound out, so it waits, and says what for.
      if (copyingTracks(openMedia())) {
        broadcastExport({ stage: 'segment', fraction: 0, message: 'Waiting for the audio tracks still being copied' })
        // Stopping, from the window or by closing it, does not wait for them.
        await tracksCopied(openMedia(), controller.signal)
        if (controller.signal.aborted) return { ok: false, outputs: [], cancelled: true }
      }
      // A clip with Clean up noise on is exported from its cleaned copy, so
      // one still being made is waited for rather than left out.
      // So is a voice being enhanced, which may be made from a cleaned copy:
      // the same pass makes both, the cleaned copy first.
      const cleaning = wantingCleanCopy(session.getProject()).length > 0
      if (cleaning || wantingVoiceCopy(session.getProject()).length > 0 || wantingCareCopy(session.getProject()).length > 0) {
        broadcastExport({
          stage: 'segment',
          fraction: 0,
          message: cleaning ? 'Waiting for the sound being cleaned of noise' : 'Waiting for the voice being enhanced'
        })
        // Stopping does not wait for it either.
        await Promise.race([
          lifecycle.prepareSoundCopies(),
          new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }))
        ])
        if (controller.signal.aborted) return { ok: false, outputs: [], cancelled: true }
      }
      if (!(await exportFolderAllowed(request.outputDir))) return { ok: false, outputs: [], error: notAllowed(request.outputDir) }
      const first = replaced()
      if (first) return first
      // A transcript of a sequence with no captions: its speech listened to
      // first, as Make captions would, and nothing put on the timeline.
      const listen = toListenTo(request, session.getProject())
      const heard = new Map<string, TimedWord[]>()
      if (listen.length > 0 && !(await speechReady())) {
        return { ok: false, outputs: [], error: 'The speech model is not downloaded yet, and the transcript needs it to listen to the speech.' }
      }
      for (const [i, id] of listen.entries()) {
        const message = `Listening to the speech for the transcript${listen.length > 1 ? ` (${i + 1} of ${listen.length})` : ''}`
        broadcastExport({ stage: 'segment', fraction: 0, message })
        try {
          const timeline = timelineOf(session.getProject(), id)
          heard.set(id, await listenForTranscript(timeline, { signal: controller.signal, onProgress: (fraction) => broadcastExport({ stage: 'segment', fraction, message }) }))
        } catch (err) {
          if (controller.signal.aborted) return { ok: false, outputs: [], cancelled: true }
          return { ok: false, outputs: [], ...speechTrouble(err, 'listened to') }
        }
      }
      const late = replaced()
      if (late) return late
      let plans: PlannedExport[]
      try {
        // Keeping both means every file already in the folder is kept, so each
        // new one takes the first name free of all of them.
        const keep = request.existing === 'keepBoth' ? await filesIn(request.outputDir) : []
        // Fast only where the card works: anywhere else it is made the usual way.
        // Waited for only until Cancel, which stops the export there.
        const stopped = new Promise<'stopped'>((resolve) => controller.signal.addEventListener('abort', () => resolve('stopped'), { once: true }))
        const gpu = request.fast === true ? await Promise.race([canEncodeOnGpu(), stopped]) : false
        if (gpu === 'stopped' || controller.signal.aborted) return { ok: false, outputs: [], cancelled: true }
        const usable = gpu ? request : { ...request, fast: false }
        plans = planExport(usable, scratchBase, keep, await voicePeaks(session.getProject()), heard).plans
      } catch (err) {
        return { ok: false, outputs: [], error: err instanceof Error ? err.message : String(err) }
      }
      if (plans.length === 0) return { ok: false, outputs: [], error: 'There is nothing on the timeline to export.' }

      // A track's copy is missing while a cleared cache is being rebuilt, or for
      // good if its recording has gone. Say which, rather than let ffmpeg fail.
      for (const p of plans) {
        for (const copy of trackCopiesRead(p.timeline, p.plan.join ? 'join' : 'batch')) {
          if (!(await exists(copy.path))) {
            return { ok: false, outputs: [], error: `${copy.label} is not ready yet. Try again once it has been prepared.` }
          }
        }
      }

      started = true
      const fonts = await pcCaptionFonts(plans.map((p) => p.timeline))
      const allFrames = Math.max(1, plans.reduce((sum, p) => sum + p.plan.totalFrames, 0))
      const fps = session.getProject().fps
      let before = 0
      const credits: string[] = []
      try {
        for (const [i, item] of plans.entries()) {
          const last = i === plans.length - 1
          const written = await runExport({
            plan: item.plan,
            fps,
            scratchDir: item.scratchDir,
            signal: controller.signal,
            fontsDir: captionFontsDir(),
            pcFonts: fonts.files,
            onProgress: (p) => {
              const overall = Math.min(1, (before + p.fraction * item.plan.totalFrames) / allFrames)
              broadcastExport({
                ...p,
                // One sequence done is not the export done while more follow.
                stage: p.stage === 'done' && !last ? 'join' : p.stage,
                fraction: overall,
                ...(plans.length > 1 ? { sequenceIndex: i + 1, sequenceCount: plans.length, sequenceName: item.name } : {})
              })
              if (win && !win.isDestroyed()) win.setProgressBar(overall)
            }
          })
          outputs.push(...written)
          before += item.plan.totalFrames
          // Task 47: the credits this video's description needs, written beside it.
          const lines = await creditsFor(mediaPathsIn(item.timeline, request.range && !request.allSequences ? request.range : null), (await settings).credits)
          for (const l of lines) if (!credits.includes(l)) credits.push(l)
          if (lines.length > 0 && written[0]) {
            const file = written[0].replace(/\.[^.\\/]+$/, '') + '.credits.txt'
            await writeAtomic(file, Buffer.from(creditsText(lines), 'utf8'))
            outputs.push(file)
          }
        }
        broadcastExport({ stage: 'done', fraction: 1 })
        tellDone(win, outputs.length === 1 ? `Exported ${basename(outputs[0]!)}` : `Exported ${outputs.length} files`)
        // Listened to, and nothing said in the part exported: no transcript, and why.
        const unheard = plans.filter((p) => heard.has(p.id) && !p.plan.beside.some((b) => /\.txt$/i.test(b.path)))
        const notes = [
          ...unheard.map((p) => `No speech was heard${plans.length > 1 ? ` in ${p.name}` : ''}, so no transcript was written.`),
          ...fonts.missing.map((f) => `The captions' font, ${f}, is not on this computer, so they were burned in with another.`)
        ]
        return { ok: true, outputs, credits, ...(notes.length > 0 ? { notes } : {}) }
      } catch (err) {
        const cancelled = controller.signal.aborted
        const message = err instanceof Error ? err.message : String(err)
        broadcastExport({ stage: cancelled ? 'cancelled' : 'failed', fraction: 0, message })
        if (cancelled) return { ok: false, outputs, cancelled: true, error: 'Export cancelled.' }
        tellDone(win, `The export failed. ${message}`)
        return {
          ok: false,
          outputs,
          error: message,
          ...(err instanceof ExportFailure ? { details: err.details } : {})
        }
      }
    } finally {
      exportAbort = null
      // Only the files an export wrote may be opened from the window.
      for (const o of outputs) exported.add(samePathKey(o))
      if (started && win && !win.isDestroyed()) win.setProgressBar(-1)
      await rm(scratchBase, { recursive: true, force: true }).catch(() => undefined)
      settled()
    }
  })

  ipcMain.handle('export:gpu', async (): Promise<boolean> => canEncodeOnGpu())
}
