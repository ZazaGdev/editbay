import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  FinishedTake,
  MediaAsset,
  Notice,
  FfmpegStatus,
  ProjectEdit,
  PeaksData,
  OpenedDocument,
  RecoveryOffer,
  RecentProject,
  EarlierVersions,
  ImportProgress
} from '../shared/types'
import { samePathKey } from '../shared/render-plan'
import { cacheRoot, exists, textPath, writeAtomic } from './media/cache'
import { loadOverrides, saveOverrides, keymapPath } from './settings/keymap-store'
import { trustSharesForNow, trustSharesOf } from './settings/trusted-shares'
import { insideDir } from '../shared/source-paths'
import { settingsPath } from './settings/app-settings'
import { sanitiseOverrides, type Overrides } from '../shared/keymap'
import { clipsUsing, trackPeaks, type Project } from '../shared/project'
import { cleanWorkspace, defaultWorkspace, type Workspace } from '../shared/workspace'
import { joinProjectFile, splitProjectFile } from '../shared/project-file'
import { verifyFfmpeg } from './ffmpeg/locate'
import { makeProxy, stopLighterCopies } from './media/proxy'
import { detectRemovable } from './media/background'
import { findFaces } from './media/face-find'
import type { FacesFound } from '../shared/face-follow'
import type { FoundBackground } from '../shared/looks'
import { adoptMissing, forgetAsset, getAsset, importFile, listAssets, stopTrackCopies } from './media/import'
import { ImportQueue } from './media/queue'
import { decodePeaks } from './media/waveform'
import * as session from './project/session'
import * as lifecycle from './project/lifecycle'
import { appendTake, beginTake, cancelTake, finishTake } from './voiceover/takes'
import { takeName, takesFolder } from '../shared/voiceover'
import { registerSpeechIpc } from './speech/ipc'
import { broadcast } from './ipc-broadcast'
import { openMedia, registerExportIpc, stopExport } from './ipc-export'
import { registerSettingsIpc, registerSourcesIpc } from './ipc-settings'

// Moved out by what they do (plan 91), and still imported from here.
export { exporting } from './ipc-export'
export { settingsRead } from './ipc-settings'

/** The document a voice over take was begun on: it goes into that one or none. */
let takeDoc = -1

/** Files you chose in the window for bringing in, as `samePathKey` spells them: their shares are allowed for good. */
const picked = new Set<string>()

/**
 * Files dropped on the open document, imported one at a time. A source that
 * is ready joins the project, as it always has.
 */
const imports = new ImportQueue(session.getDocId, {
  progress: (p: ImportProgress) => broadcast('assets:progress', p),
  changed: (a: MediaAsset) => broadcast('assets:changed', a),
  removed: (id: string) => broadcast('assets:removed', id),
  ready: (a: MediaAsset) => {
    session.addAsset(a)
    lifecycle.broadcastProject()
    lifecycle.changed()
  },
  // The other tracks of a recording that was ready before they were copied:
  // into the project, as a rebuilt source goes, if it is still there.
  tracksCopied: (a: MediaAsset, error?: string) => {
    if (!session.getProject().media.some((m) => m.id === a.id)) return
    session.replaceMedia(session.mediaFromAsset(a))
    lifecycle.broadcastProject()
    if (error) {
      lifecycle.notify(
        `The other audio tracks of ${a.originalPath.split(/[\\/]/).pop()} could not be copied, so only its first plays. They are tried again when the project is next opened. ${error}`,
        'fades'
      )
    }
  },
  tryAgain: (id: string) => (inProject(id) ? retryProjectSource(id) : null)
})

function inProject(id: string): boolean {
  return session.getProject().media.some((m) => m.id === id)
}

/**
 * A source of the project that failed is a missing file, which only lifecycle
 * may bring back: it keeps the notice about missing files and its clips in step.
 */
async function retryProjectSource(id: string): Promise<MediaAsset | null> {
  await lifecycle.retrySource(id)
  return getAsset(id) ?? null
}

/**
 * What a locked track is called in a notice: V1, A2, and its id where a
 * sequence somehow does not hold it, which only a bug could reach.
 */
function trackName(p: Project, trackId: string): string {
  for (const s of p.sequences) {
    const v = s.videoTracks.findIndex((r) => r.id === trackId)
    if (v >= 0) return `V${v + 1}`
    const a = s.audioTracks.findIndex((r) => r.id === trackId)
    if (a >= 0) return `A${a + 1}`
  }
  return trackId
}

export function registerIpc(): void {
  const settingsFile = settingsPath(app.getPath('userData'))
  lifecycle.onCloseStop(stopExport)
  registerSettingsIpc(settingsFile)

  // A voice over take: saved beside the project as it records, and made into
  // a WAV when it stops. The window imports it and puts it on the timeline.
  ipcMain.handle('voice:begin', async (_e, sampleRate: number): Promise<string> => {
    const path = await beginTake(
      takesFolder(session.getProjectPath(), app.getPath('documents'), { join, dirname }),
      takeName(new Date()),
      Math.round(sampleRate)
    )
    takeDoc = session.getDocId()
    return path
  })
  ipcMain.handle('voice:chunk', (_e, samples: Uint8Array): Promise<void> => appendTake(samples))
  ipcMain.handle('voice:finish', async (_e, line: { drop: number; pad: number }): Promise<FinishedTake | null> => {
    const path = await finishTake(line)
    if (!path) return null
    const doc = takeDoc
    const stillWanted = (): boolean => doc === session.getDocId()
    if (!stillWanted()) return { path, asset: null, why: 'another project was opened' }
    // A WAV needs no converting, so it is imported at once rather than
    // waiting in the queue behind a recording being converted: until it is on
    // the timeline, the window holds every edit.
    const asset = await importFile(path, (p) => broadcast('assets:progress', p), (a) => broadcast('assets:changed', a), { stillWanted })
    if (asset.status !== 'ready') return { path, asset: null, why: asset.error ?? 'it did not import' }
    if (!stillWanted()) return { path, asset: null, why: 'another project was opened' }
    session.addAsset(asset)
    lifecycle.broadcastProject()
    lifecycle.changed()
    return { path, asset }
  })
  ipcMain.handle('voice:cancel', (): Promise<void> => cancelTake())

  registerSpeechIpc(broadcast)

  // Shortcuts are yours rather than a project's, so they live with the app's
  // settings and follow you from one project to the next.
  ipcMain.handle('keymap:load', (): Promise<Overrides> => loadOverrides(keymapPath(app.getPath('userData'))))
  ipcMain.handle('keymap:save', (_e, overrides: Overrides): Promise<Overrides> =>
    // Applied whether or not it could be written, and you are told when it could not.
    saveOverrides(keymapPath(app.getPath('userData')), overrides).catch((err: unknown) => {
      lifecycle.notify(`Your shortcuts could not be saved (${err instanceof Error ? err.message : String(err)}). They apply until Editbay closes.`, 'waits')
      return sanitiseOverrides(overrides)
    })
  )

  registerExportIpc()

  // Looked up in the open project by id: the window never names a file to read or write.
  ipcMain.handle('media:lighterCopy', async (_e, mediaId: unknown): Promise<string | null> => {
    if (typeof mediaId !== 'string') return null
    const m = session.getProject().media.find((x) => x.id === mediaId)
    return m ? makeProxy(m) : null
  })
  // Task 32: the background a clip stands on, read from its recording where the clip starts; any plain colour (plan 98).
  ipcMain.handle('media:background', async (_e, mediaId: unknown, from: unknown): Promise<FoundBackground | null> => {
    if (typeof mediaId !== 'string') return null
    const m = session.getProject().media.find((x) => x.id === mediaId)
    return m ? detectRemovable(m.playablePath, typeof from === 'number' && from > 0 ? from : 0) : null
  })
  // Plan 100: the faces on a clip's stretch of its recording, for Follow face; `fps` is the frames `from` and `to` were counted in.
  ipcMain.handle('media:faces', async (_e, mediaId: unknown, from: unknown, to: unknown, fps: unknown): Promise<FacesFound> => {
    const m = typeof mediaId === 'string' ? session.getProject().media.find((x) => x.id === mediaId) : undefined
    if (!m || typeof from !== 'number' || typeof to !== 'number' || typeof fps !== 'number' || !(fps > 0) || !(to > from)) {
      return { ok: false, message: 'There is no recording to look at.' }
    }
    try {
      return { ok: true, ...(await findFaces(m.playablePath, { fromSec: from, toSec: to }, { width: m.width, height: m.height, fps })) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('media:stopLighterCopies', (): void => stopLighterCopies())

  ipcMain.handle('ffmpeg:status', async (): Promise<FfmpegStatus> => {
    try {
      const caps = await verifyFfmpeg()
      return { ok: true, message: caps.version }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('files:pick', async (): Promise<string[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video, sound and images',
          extensions: [
            'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv',
            'wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus',
            'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'
          ]
        },
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv'] },
        { name: 'Sound', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
      ]
    })
    if (result.canceled) return []
    for (const p of result.filePaths) picked.add(samePathKey(p))
    return result.filePaths
  })

  ipcMain.handle('assets:list', (): MediaAsset[] => listAssets())

  // Files dropped on one project belong to it: once another has been opened,
  // the rest are not added to that one, and the one being converted stops.
  // So do the audio tracks being copied behind another project's sources.
  lifecycle.onDocumentReplaced(() => {
    imports.clear()
    stopTrackCopies(openMedia())
    stopLighterCopies()
  })

  ipcMain.handle('assets:import', async (_e, paths: string[]): Promise<MediaAsset[]> => {
    // Files you bring in yourself: the shares they are on are ones you use,
    // and a project naming them later opens without asking. For good when you
    // chose them here; dropped ones only until Editbay closes.
    const chosen = paths.filter((p) => picked.has(samePathKey(p)))
    trustSharesForNow(paths.filter((p) => !picked.has(samePathKey(p))))
    await trustSharesOf(chosen)
    return imports.add(paths)
  })

  ipcMain.handle('assets:cancel', (_e, id: string): void => {
    imports.cancel(id)
  })

  // A missing source of the project is handed on to lifecycle by the queue.
  ipcMain.handle('assets:retry', async (_e, id: string): Promise<void> => {
    await imports.retry(id)
  })

  // Out of the bin and the project, when no clip in any sequence uses it.
  // Not an edit, as importing is not: nothing to undo. The file is untouched.
  // Not while it is being prepared again, which would put it back.
  ipcMain.handle('assets:remove', (_e, id: string): boolean => {
    if (imports.has(id) || lifecycle.isRebuilding(id)) return false
    if (clipsUsing(session.getProject(), id) > 0) return false
    if (!session.removeMedia(id)) return false
    forgetAsset(id)
    broadcast('assets:removed', id)
    lifecycle.broadcastProject()
    lifecycle.broadcastStatus()
    lifecycle.changed()
    return true
  })

  ipcMain.handle('assets:show', (_e, id: string): void => {
    const asset = getAsset(id)
    if (asset) shell.showItemInFolder(asset.originalPath)
  })

  registerSourcesIpc(settingsFile)

  ipcMain.handle('project:current', (): Project => session.getProject())

  ipcMain.handle('project:session', (): OpenedDocument => lifecycle.snapshot())

  // Edits and undo name the document they were made in. One that arrives
  // after another document has opened, such as an undo pressed just as a
  // recent project loads, is dropped rather than applied to the wrong one.
  ipcMain.handle('project:edit', (_e, docId: number, edit: ProjectEdit, continuing = false): Project => {
    if (docId !== session.getDocId()) return session.getProject()
    // A picture the window drew is one it saved here, in the cache's text folder: never another file (plan 88).
    const drawn = (edit as { drawn?: { path?: unknown } }).drawn
    if (drawn !== undefined && (typeof drawn.path !== 'string' || !insideDir(drawn.path, join(cacheRoot(), 'text')))) return session.getProject()
    // And every picture of several texts restyled at once (task 34).
    const texts = (edit as { texts?: unknown }).texts
    if (texts !== undefined && (!Array.isArray(texts) || texts.some((t: { drawn?: { path?: unknown } } | null) => typeof t?.drawn?.path !== 'string' || !insideDir(t.drawn.path, join(cacheRoot(), 'text'))))) {
      return session.getProject()
    }
    const project = session.applyEdit(edit, continuing === true)
    // A lock that refuses in silence is worse than no lock: it says the work
    // is safe and leaves nothing on screen to say why nothing happened.
    const refused = session.takeLockRefusal()
    // Fades: nothing was lost and nothing is being asked, so clearing a box
    // before carrying on is a lot of ceremony for "nothing happened".
    if (refused !== null) lifecycle.notify(`${trackName(project, refused)} is locked, so nothing on it changed.`, 'fades')
    lifecycle.broadcastStatus()
    lifecycle.changed()
    void lifecycle.prepareSoundCopies()
    return project
  })

  ipcMain.handle('project:set', (_e, docId: number, project: Project): Project => {
    if (docId !== session.getDocId()) return session.getProject()
    // Read as a saved file is, so a snapshot the window kept is checked and
    // tidied the same way, and a damaged one changes nothing (audit 2026-10-01).
    let checked: Project
    try {
      checked = splitProjectFile(joinProjectFile(project, defaultWorkspace())).project
    } catch {
      return session.getProject()
    }
    const next = session.setProject(checked)
    // An undo can bring back a clip of a source taken out of the bin since: the source comes back with it.
    for (const a of adoptMissing(next.media, lifecycle.status().offline)) broadcast('assets:changed', a)
    lifecycle.broadcastStatus()
    lifecycle.changed()
    void lifecycle.prepareSoundCopies()
    return next
  })

  // Where you are in the project. Kept here so that saving, autosaving and
  // closing can write it without asking the window for anything. A workspace
  // sent for a document that has since been replaced is dropped: it describes
  // clips that are no longer there.
  ipcMain.handle('workspace:set', (_e, docId: number, workspace: Workspace): void => {
    if (docId !== session.getDocId()) return
    session.setWorkspace(cleanWorkspace(workspace, session.getProject()))
  })

  ipcMain.handle('project:new', (event): Promise<boolean> =>
    lifecycle.newDocument(BrowserWindow.fromWebContents(event.sender))
  )

  ipcMain.handle('project:open', (event, path?: string): Promise<boolean> =>
    lifecycle.openDocument(BrowserWindow.fromWebContents(event.sender), path)
  )

  ipcMain.handle('project:rename', (_event, name: string): Promise<void> => lifecycle.renameProject(name))
  ipcMain.handle('project:save', (event, saveAs: boolean): Promise<string | null> =>
    lifecycle.save(saveAs, BrowserWindow.fromWebContents(event.sender))
  )

  ipcMain.handle('notices:take', (): Notice[] => lifecycle.takeNotices())

  ipcMain.handle('project:recent', (): Promise<RecentProject[]> => lifecycle.recentProjects())
  ipcMain.handle('project:forgetRecent', (_e, path: string): Promise<RecentProject[]> =>
    lifecycle.forgetRecentProject(path)
  )

  ipcMain.handle('recovery:offer', (): RecoveryOffer | null => lifecycle.recoveryOffer())
  ipcMain.handle('recovery:restore', (event): Promise<void> =>
    lifecycle.restoreRecovery(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('recovery:discard', (): Promise<void> => lifecycle.discardRecovery())

  // The window broke while drawing: its project is not opened by itself at the next launch.
  ipcMain.handle('window:crashed', (): void => lifecycle.forgetLastProject())

  ipcMain.handle('versions:list', (): Promise<EarlierVersions> => lifecycle.earlierVersions())
  // Only ever a version's own name in the versions folder: the lifecycle checks it is one.
  ipcMain.handle('versions:open', (event, id: string): Promise<boolean> =>
    lifecycle.openEarlierVersion(BrowserWindow.fromWebContents(event.sender), String(id))
  )

  // A text is drawn by the window; its picture is kept here, named for its words and style.
  ipcMain.handle('text:save', async (_e, key: string, png: Uint8Array): Promise<string> => {
    // Or one picture of a run, numbered from 0001, as a shape drawing itself on is (plan 88).
    if (!/^[0-9a-f]{16}(-\d{4})?$/.test(key)) throw new Error('not a text key')
    const path = textPath(key)
    if (!(await exists(path))) {
      await mkdir(dirname(path), { recursive: true })
      await writeAtomic(path, Buffer.from(png))
    }
    return path
  })

  ipcMain.handle('text:missing', async (_e, paths: string[]): Promise<string[]> => {
    // Only the project's own drawn pictures: the window asks after no other file (audit 2026-10-01).
    const drawn = new Set(session.getProject().media.filter((m) => m.text || m.shape || m.colour).map((m) => m.playablePath))
    const missing: string[] = []
    for (const p of paths) if (drawn.has(p) && !(await exists(p))) missing.push(p)
    return missing
  })

  ipcMain.handle('media:peaks', async (_e, mediaId: string, track = 0): Promise<PeaksData> => {
    const m = session.getProject().media.find((x) => x.id === mediaId)
    if (!m) throw new Error(`unknown media: ${mediaId}`)
    // A track still being copied has its waveform already, read from the recording.
    const peaksPath = trackPeaks(m, track)
    if (!peaksPath) throw new Error(`no audio track ${track + 1} in ${mediaId}`)
    return decodePeaks(await readFile(peaksPath))
  })

  ipcMain.handle('media:relink', (event, mediaId: string): Promise<Project> =>
    lifecycle.relink(BrowserWindow.fromWebContents(event.sender), mediaId)
  )
}
