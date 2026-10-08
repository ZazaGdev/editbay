import { BrowserWindow, app, dialog, type SaveDialogOptions } from 'electron'
import { basename, dirname, join } from 'node:path'
import { readFile, rename, stat } from 'node:fs/promises'
import type {
  OpenedDocument,
  ProjectStatus,
  RecentProject,
  RecoveryOffer
} from '../../shared/types'
import { SCHEMA_VERSION, cleanProjectName, hasPicture, isStill, type Project, type ProjectMedia } from '../../shared/project'
import { defaultWorkspace, type Workspace } from '../../shared/workspace'
import { joinProjectFile, splitProjectFile } from '../../shared/project-file'
import { shareOf, usableProject, withWithheld, type Withheld } from '../../shared/source-paths'
import { PROJECT_EXT, PROJECT_EXTS } from '../../shared/project-ext'
import { sanitiseFilename } from '../../shared/filename'
import { adoptMedia, importFile, markMissing } from '../media/import'
import { cacheRoot, exists } from '../media/cache'
import { cacheUsedBy, markUsed, recordOriginals } from '../media/prune'
import { loadTrustedShares, onTrustWriteFailed, trustSharesOf } from '../settings/trusted-shares'
import { recording as takeRecording } from '../voiceover/takes'
import { speechBusy } from '../speech/ipc'
import { saveProjectTo, loadProjectFrom, serialiseProject } from './store'
import {
  chooseRecovery,
  listRecovery,
  readRecoveryDocument,
  recoveryDir,
  recoveryFileName,
  removeRecovery,
  setAside,
  writeRecovery,
  type RecoveryCopy
} from './recovery'
import * as session from './session'
import { keepVersion, newestKeptAt } from './versions'
import { keepBeforeSaving, type VersionReason } from '../../shared/versions'
import { sameRecording } from './reopen'
import {
  addRecent,
  emptyRecent,
  forgetRecent,
  loadRecent,
  recentPath,
  saveRecent,
  setLast,
  type RecentState
} from '../settings/recent-store'
import { describe, messageBox, notify, send } from './windows'
import { exclusive } from './one-at-a-time'
import { fileHolds, inOrder, setRecoveryAside, versionsFolder } from './kept-copies'
import { sendAsset, sendProgress, settle, useDifferent, whileOpen } from './missing-sources'
import { prepareSoundCopies } from './sound-copies'
import { NOTHING_MISSING, checkSources, offlineDir, sourceAccess, tidyBeside, type SourceCheck } from './opening-checks'

/**
 * The open document's state, and everything that changes it: what is missing,
 * saving by hand and on its own, the recovery copy, the recent list, and
 * putting a document in place. See lifecycle.ts.
 */

// Both extensions, so a project saved before the rename still appears in the
// Open dialog rather than being filtered out of its own folder.
export const PROJECT_FILTERS = [{ name: 'Editbay project', extensions: [...PROJECT_EXTS] }]

let offline: string[] = []
let rebuilding: string[] = []
/** Where each source of the open document that is kept offline really was, written back there on every save. */
let withheld = new Map<string, Withheld>()

/** Where recovery copies go. Unset until startup, and then nothing is autosaved. */
let recoveryFolder: string | null = null
/** The open document's copy, if one has been written. */
let recoveryFile: string | null = null
/** The project as the last copy held it, so an unchanged project is not written again. */
let lastAutosaved: string | null = null
/** The copy offered at launch, set aside until it is restored or discarded. */
let offered: RecoveryCopy | null = null
/**
 * A set-aside copy that was restored. It goes once the restored work is safe
 * elsewhere: in a fresh copy of its own, or saved, or given up.
 */
let restoredFrom: string | null = null
/** Whether the offered copy was set aside by this launch, rather than left from an earlier one. */
let heldThisLaunch = false

let autosaveTimer: ReturnType<typeof setInterval> | null = null

let recent: RecentState = emptyRecent()
/** Where the recent list is kept. Unset until startup, and then it is not written. */
let recentFile: string | null = null
let recentWork: Promise<void> = Promise.resolve()

/**
 * The project file as this app last read or wrote it. Where you were is only
 * written back into a file that still matches, so a file renamed, replaced by
 * a sync or saved by another version meanwhile is left alone.
 */
let diskStamp: { path: string; mtimeMs: number; size: number } | null = null

export function samePath(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase()
}

export function status(): ProjectStatus {
  return {
    name: session.projectName(),
    path: session.getProjectPath(),
    changed: session.isChanged(),
    offline: stillMissing(),
    rebuilding
  }
}

/**
 * The missing sources the project still has. One taken out of the bin is no
 * longer missing, but stays on the list: an undo that brings back its clip
 * brings it back missing, as it was.
 */
export function stillMissing(): string[] {
  const here = new Set(session.getProject().media.map((m) => m.id))
  return offline.filter((id) => here.has(id))
}

/** Whether a source is being prepared again, which nothing else may change meanwhile. */
export function isRebuilding(id: string): boolean {
  return rebuilding.includes(id)
}

/**
 * Try a missing source's own file again, as when it has been put back. It
 * goes the way Find does, so the notice, its clips and the bin all follow.
 * True when the source is back.
 */
export async function retrySource(id: string): Promise<boolean> {
  const doc = session.getDocId()
  const m = session.getProject().media.find((x) => x.id === id)
  if (!m || rebuilding.includes(id)) return false
  if (!(await exists(m.originalPath))) {
    if (doc === session.getDocId()) notify(`${basename(m.originalPath)} is still not where it was.`, 'fades')
    return false
  }
  const outcome = await relinkOne(doc, m, m.originalPath, true)
  if (outcome === 'different') {
    notify(`${basename(m.originalPath)} is back, but it is a different recording, so it was not used.`, 'fades')
  }
  return outcome === 'relinked'
}

export function snapshot(): OpenedDocument {
  return {
    docId: session.getDocId(),
    project: session.getProject(),
    workspace: session.getWorkspace(),
    status: status()
  }
}

export function broadcastStatus(): void {
  send('project:status', status())
}

/**
 * Tell every open window the document changed.
 *
 * Edits return the new document to whoever asked, but some changes start in
 * main, and a window that is not told would keep drawing a document that no
 * longer exists.
 */
export function broadcastProject(): void {
  send('project:changed', session.getProject())
  broadcastStatus()
}

/** A whole new document: every window starts over from it, workspace and all. */
function broadcastOpened(): void {
  send('project:opened', snapshot())
}

export async function stampOf(path: string): Promise<{ path: string; mtimeMs: number; size: number } | null> {
  try {
    const info = await stat(path)
    return { path, mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

/**
 * How long after the last change a project is saved on its own, when saving
 * automatically is on. The variable exists so the tests need not wait.
 */
const SAVE_AUTOMATICALLY_MS = (!app.isPackaged && Number(process.env.EDITBAY_SAVE_AUTOMATICALLY_MS)) || 30_000

let saveAutomatically = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let exportRunning: () => boolean = () => false
/** Whether the last automatic save failed, so the notice is given once, not every half minute. */
let autoSaveFailed = false
/** Whether saving on its own was held back for a file that is not as it was left, so that is told once. */
let autoSaveHeld = false
/**
 * Whether the document has not been saved since it was opened, restored or
 * made, so the first save over its file keeps what was there (plan 84).
 */
let firstSaveSinceAdopt = true
/** Whether the last recovery copy failed, so the notice is given once. */
let recoveryFailed = false

/** Turn saving on its own on or off. `exporting` says whether an export is running. */
export function setSaveAutomatically(on: boolean, exporting: () => boolean): void {
  saveAutomatically = on
  exportRunning = exporting
  if (!on && saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (on) changed()
}

/**
 * The document changed. With saving on its own, a project that has a file is
 * saved once changes have stopped for a while. A project with no file yet is
 * left to the recovery copy: saving it would mean asking where.
 */
export function changed(): void {
  copySoon()
  if (!saveAutomatically) return
  if (saveTimer) clearTimeout(saveTimer)
  const doc = session.getDocId()
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveOnItsOwn(doc)
  }, SAVE_AUTOMATICALLY_MS)
}

/**
 * How soon after a change the recovery copy is written, and the longest it
 * waits while changes keep coming, as during a drag (plan 84). A copy the
 * same as the last is not written, so this costs a serialisation and nothing
 * more while nothing changes.
 */
const RECOVERY_SOON_MS = 1500
const RECOVERY_AT_MOST_MS = 10_000
let copyTimer: ReturnType<typeof setTimeout> | null = null
let copyDueBy: number | null = null

function copySoon(): void {
  const now = Date.now()
  copyDueBy ??= now + RECOVERY_AT_MOST_MS
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(
    () => {
      copyTimer = null
      copyDueBy = null
      void autosave()
    },
    Math.max(0, Math.min(RECOVERY_SOON_MS, copyDueBy - now))
  )
}

async function saveOnItsOwn(doc: number): Promise<void> {
  // Never under an export, which is reading what it was given: try again later.
  if (exportRunning()) {
    changed()
    return
  }
  // Behind any question or save already running, and only for the document it was meant for.
  await exclusive(null, async () => {
    const path = session.getProjectPath()
    if (!saveAutomatically || doc !== session.getDocId() || !path || !session.isChanged()) return null
    // Only over the file as this app last read or wrote it. One changed by
    // another computer through a synced folder, moved or deleted, or written
    // by an older version is left as it is, and you are told once.
    const why = await notAsLeft(path)
    if (why !== null) {
      if (!autoSaveHeld) {
        autoSaveHeld = true
        notify(why, 'waits')
      }
      return null
    }
    const saved = await saveNow(false, null, true)
    if (saved === null && !autoSaveFailed) {
      autoSaveFailed = true
      notify(`${session.projectName()} could not be saved automatically. Save it yourself to be sure your work is kept.`, 'waits')
    }
    return saved
  })
}

/**
 * Why the project file is not the one this app last read or wrote, in words
 * for a notice, or null when it is.
 */
async function notAsLeft(path: string): Promise<string | null> {
  const name = session.projectName()
  const now = await stampOf(path)
  if (!now) {
    return `${name} is no longer where it was opened from, so it is not saved on its own. Use Save As to choose where it goes.`
  }
  if (!diskStamp || !samePath(diskStamp.path, path)) {
    return `${name} was made by an older version of Editbay, so it is not saved on its own, which keeps it opening there. Save it yourself to bring it up to date.`
  }
  if (now.mtimeMs !== diskStamp.mtimeMs || now.size !== diskStamp.size) {
    return `${name} was changed on disk since Editbay opened it, perhaps on another computer, so it is not saved on its own. Save to keep your version: the other is kept in Earlier versions, in the Recent menu.`
  }
  return null
}

/**
 * Call the document something, and call its file the same thing.
 *
 * The name and the file's name stay in step: a project called Holiday cut
 * lives in Holiday cut.editbay, so what the Recent list shows and what the bar
 * shows are never two different things. The file name is the name run through
 * `sanitiseFilename`, which is as close as a filesystem allows.
 *
 * Nothing happens at all if the file cannot be renamed. A name in the window
 * that does not match the file on disk is the thing this exists to prevent, so
 * a failure says so and leaves both alone.
 */
export async function renameNow(raw: string): Promise<void> {
  const name = cleanProjectName(raw)
  if (name === null || name === session.projectName()) return

  const from = session.getProjectPath()
  // Never saved: there is no file to rename, and the name is what the first
  // save offers as one.
  if (from === null) {
    session.renameProject(name)
    broadcastProject()
    return
  }

  const to = join(dirname(from), `${sanitiseFilename(name)}.${PROJECT_EXT}`)
  // Saved meanwhile somewhere else, through a synced folder: the file is
  // renamed but not written over, and saving on its own still sees it as
  // changed. Comparing after the rename compared the file with itself, and
  // wrote this computer's older version over the other's (audit 2026-10-08).
  const now = await stampOf(from)
  const elsewhere = now !== null && diskStamp !== null && samePath(diskStamp.path, from) && (now.mtimeMs !== diskStamp.mtimeMs || now.size !== diskStamp.size)
  if (!samePath(to, from)) {
    // Never over the top of something else. Numbering it instead would give
    // the file a name the project does not have, which is the whole fault.
    if (await exists(to)) {
      notify(`There is already a ${basename(to)} in that folder, so the project was not renamed.`, 'fades')
      return
    }
    try {
      await rename(from, to)
    } catch (err) {
      notify(`${basename(from)} could not be renamed: ${describe(err)}`, 'fades')
      return
    }
    session.setProjectPath(to)
    diskStamp = elsewhere && diskStamp ? { ...diskStamp, path: to } : await stampOf(to)
    updateRecent((r) => addRecent(forgetRecent(r, from), to))
    // The copy of unsaved work is kept under the file's name, which is gone.
    // Left there, it would be offered at the next launch as a crash from a
    // project that no longer exists. A copy under the new name is written
    // first, so the unsaved work is never without one.
    void inOrder(async () => {
      const old = recoveryFile
      if (!old) return
      lastAutosaved = null
      await writeCopy().catch(() => undefined)
      // Kept only while it is the one copy there is of work still unsaved.
      if (recoveryFile === old && session.isChanged()) return
      if (recoveryFile === old) recoveryFile = null
      await removeRecovery(old)
    })
  }

  // Written back when there was nothing else waiting to be saved, so the file
  // says what it is called rather than carrying the old name inside the new
  // name until the next save. With other work unsaved it is left unsaved, in
  // one piece, rather than being committed by a rename nobody asked to save.
  const clean = !session.isChanged()
  session.renameProject(name)
  if (elsewhere) {
    notify(`${basename(to)} was changed on disk since Editbay opened it, perhaps on another computer, so it was renamed but not written over. Save to keep your version: the other is kept in Earlier versions, in the Recent menu.`, 'waits')
  } else if (clean) {
    const workspace = session.getWorkspace()
    try {
      await saveProjectTo(onDisk(session.getProject()), to, workspace)
      session.markSaved(to, session.getProject(), workspace)
      diskStamp = await stampOf(to)
    } catch {
      // The file is renamed and the name is right on screen. Writing it is
      // what the next save is for.
    }
  }
  broadcastProject()
}

/**
 * Keep the file a save is about to write over as an earlier version, when
 * `keepBeforeSaving` says to. Null when the save may go ahead; otherwise why
 * it may not: a file changed elsewhere is someone's work, and is never
 * written over unless it was kept first. A file the app wrote itself is
 * written over even if keeping it failed, since the work being saved is newer.
 */
async function keepWhatIsThere(target: string): Promise<string | null> {
  const there = await stampOf(target)
  if (!there) return null
  const ours = diskStamp !== null && samePath(diskStamp.path, target) && there.mtimeMs === diskStamp.mtimeMs && there.size === diskStamp.size
  try {
    const reason = keepBeforeSaving({
      changedElsewhere: !ours,
      firstSave: firstSaveSinceAdopt,
      newestKeptAt: await newestKeptAt(versionsFolder(), target),
      now: Date.now()
    })
    if (reason === null) return null
    await keepVersion(versionsFolder(), { projectPath: target, name: session.nameFromPath(target), reason, text: (await readFile(target)).toString('utf8') })
    return null
  } catch (err) {
    if (ours) return null
    return `${basename(target)} was not written over, because the version on disk could not be kept first: ${describe(err)}`
  }
}

/**
 * Keep the open document's unsaved work as an earlier version, before it is
 * given up. True once it is kept, or there was nothing new to keep.
 */
async function keepUnsaved(reason: VersionReason): Promise<boolean> {
  try {
    const project = session.getProject()
    await keepVersion(versionsFolder(), {
      projectPath: session.getProjectPath(),
      name: session.projectName(),
      reason,
      text: joinProjectFile(onDisk(project), session.getWorkspace())
    })
    return true
  } catch (err) {
    notify(`The changes to ${session.projectName()} could not be kept as an earlier version: ${describe(err)}`, 'waits')
    return false
  }
}

/** `quiet` is for saving on its own: a failure is told once, by the caller, rather than in a box. */
export async function saveNow(saveAs: boolean, win: BrowserWindow | null, quiet = false): Promise<string | null> {
  let target = session.getProjectPath()
  /** Whether a file was picked in this call, which is when the file names the project. */
  const chosen = saveAs || !target
  if (chosen) {
    const options: SaveDialogOptions = { defaultPath: `${session.projectName()}.${PROJECT_EXT}`, filters: PROJECT_FILTERS }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    target = result.filePath
  }
  // Either the file it already had or the one just picked. The compiler cannot
  // see that from `chosen` alone, and a project with neither cannot be written.
  if (!target) return null

  // Taken before the write, so an edit that lands while it is writing still
  // counts as unsaved rather than being marked saved without being written.
  //
  // The file names the project only when the file was just chosen. A plain
  // save keeps whatever it is called, or a name typed into the top bar would
  // be undone by the next save and the renaming would be no renaming at all.
  const project: Project = chosen
    ? { ...session.getProject(), name: session.nameFromPath(target) }
    : session.getProject()
  const workspace = session.getWorkspace()
  const refused = await keepWhatIsThere(target)
  if (refused !== null) {
    if (!quiet) dialog.showErrorBox('The project was not saved', refused)
    else notify(refused, 'waits')
    return null
  }
  try {
    await saveProjectTo(onDisk(project), target, workspace)
  } catch (err) {
    if (!quiet) dialog.showErrorBox('The project could not be saved', `${target}\n\n${describe(err)}`)
    return null
  }
  firstSaveSinceAdopt = false
  session.markSaved(target, project, workspace)
  // Saved, however it was: the next failure to save on its own is worth telling again.
  autoSaveFailed = false
  autoSaveHeld = false
  diskStamp = await stampOf(target)
  void dropRecovery()
  updateRecent((r) => addRecent(r, target))
  broadcastProject()
  return target
}

/**
 * Ask what to do with unsaved changes before something would throw them away.
 * True means carry on: they were saved, or you chose not to keep them.
 * Only ever called from inside `exclusive`.
 */
export async function confirmDiscard(win: BrowserWindow | null): Promise<boolean> {
  if (!session.isChanged()) return true
  // With Save automatically on, the changes were about to be saved anyway: a
  // file as the app left it is saved now, without asking (plan 84).
  const path = session.getProjectPath()
  if (saveAutomatically && path && !exportRunning() && (await notAsLeft(path)) === null && (await saveNow(false, win, true)) !== null) return true
  const response = await messageBox(win, {
    type: 'warning',
    title: 'Editbay',
    message: `Save changes to ${session.projectName()}?`,
    detail: "If you don't save them, they are kept in Earlier versions, in the Recent menu.",
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (response === 0) return (await saveNow(false, win)) !== null
  if (response !== 1) return false
  if (await keepUnsaved('not-saved')) return true
  // Never thrown away unkept without asking again.
  const anyway = await messageBox(win, {
    type: 'warning',
    title: 'Editbay',
    message: `The changes to ${session.projectName()} could not be kept`,
    detail: 'Going on now loses them for good.',
    buttons: ['Keep working', 'Lose them'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return anyway === 1
}

/**
 * Write where you were back into the project file of a document you are
 * leaving, so opening it again lands there. Only when the edit itself has no
 * unsaved changes, and only into a file that is still the one this app last
 * read or wrote: after "Don't save" the file is left exactly as it was.
 */
export async function writeBackWorkspace(): Promise<void> {
  const path = session.getProjectPath()
  if (!path || session.isChanged() || !session.isWorkspaceChanged()) return
  const now = await stampOf(path)
  if (!now || !diskStamp || !samePath(diskStamp.path, path)) return
  if (now.mtimeMs !== diskStamp.mtimeMs || now.size !== diskStamp.size) return
  const workspace = session.getWorkspace()
  try {
    await saveProjectTo(onDisk(session.getProject()), path, workspace)
    session.markSaved(path, session.getProject(), workspace)
    diskStamp = await stampOf(path)
  } catch {
    // Where you were is a convenience. Failing to write it is not worth a message.
  }
}

let replaced: () => void = () => undefined

/** Told whenever another document takes the place of the open one. */
export function onDocumentReplaced(listener: () => void): void {
  replaced = listener
}

/** Put a whole document in place and tell every window. */
function adopt(project: Project, path: string | null, workspace: Workspace, saved: boolean, check: SourceCheck, kept = new Map<string, Withheld>()): void {
  withheld = kept
  // A file held back from saving on its own is told about again for the next document.
  autoSaveHeld = false
  firstSaveSinceAdopt = true
  // The document being replaced was saved or given up before this point, so
  // its recovery copy has nothing left to recover.
  void dropRecovery()
  session.adoptDocument(project, path, workspace, saved)
  // What it uses in the cache is used now, so it is not taken for unused and removed.
  void markUsed(cacheRoot(), cacheUsedBy(cacheRoot(), project.media)).catch(() => undefined)
  void recordOriginals(cacheRoot(), project.media).catch(() => undefined)
  replaced()
  offline = check.offline
  rebuilding = [...check.rebuild, ...check.reimport].map((m) => m.id)
  // The bin shows what this document references, not what the last one did.
  adoptMedia(project.media, check.offline)
  broadcastOpened()
  if (rebuilding.length > 0) settle(session.getDocId(), check)
  void prepareSoundCopies()
}

export function replaceSource(m: ProjectMedia): void {
  session.replaceMedia(m)
  broadcastProject()
}

export function doneRebuilding(id: string, failed: boolean): void {
  rebuilding = rebuilding.filter((x) => x !== id)
  if (failed && !offline.includes(id)) offline = [...offline, id]
  broadcastStatus()
}

type RelinkResult = 'relinked' | 'unusable' | 'different' | 'gone'

/**
 * Point a source at a file, keeping its id. With `mustMatch`, the file was
 * found by name rather than chosen, and is only taken if it is the same
 * recording: otherwise the source stays missing, untouched.
 */
export async function relinkOne(doc: number, missing: ProjectMedia, path: string, mustMatch: boolean, win: BrowserWindow | null = null): Promise<RelinkResult> {
  rebuilding = [...rebuilding, missing.id]
  broadcastStatus()
  const asset = await importFile(path, sendProgress, sendAsset, { id: missing.id, stillWanted: whileOpen(doc) })
  if (doc !== session.getDocId() || !session.getProject().media.some((x) => x.id === missing.id)) return 'gone'
  if (asset.status !== 'ready') {
    notify(`${basename(path)} could not be used: ${asset.error ?? 'import failed'}`, 'fades')
    sendAsset(markMissing(missing))
    doneRebuilding(missing.id, true)
    return 'unusable'
  }
  if (hasPicture(missing) && asset.hasVideo === false) {
    // Its clips are pictures, on V1 and the video rows: a sound file has none to give them.
    notify(`${basename(path)} is only sound, so it cannot stand in for ${basename(missing.originalPath)}, which has a picture.`, 'fades')
    sendAsset(markMissing(missing))
    doneRebuilding(missing.id, true)
    return 'unusable'
  }
  if (isStill(missing) !== isStill(asset)) {
    // A picture's clips are measured against a length a recording does not
    // have, and a recording's against one a picture does not.
    const was = isStill(missing) ? 'a picture' : 'a recording'
    notify(`${basename(path)} cannot stand in for ${basename(missing.originalPath)}, which is ${was}.`, 'fades')
    sendAsset(markMissing(missing))
    doneRebuilding(missing.id, true)
    return 'unusable'
  }
  if (mustMatch && !sameRecording(missing, asset)) {
    sendAsset(markMissing(missing))
    doneRebuilding(missing.id, true)
    return 'different'
  }
  // Picked by hand but not the same recording: asked about first, saying
  // what it would cost, since clips past its end are cut short for good
  // (audit 2026-10-01).
  if (!mustMatch && !sameRecording(missing, asset) && !(await useDifferent(win, missing, asset, path))) {
    sendAsset(markMissing(missing))
    doneRebuilding(missing.id, true)
    return 'different'
  }
  replaceSource({ ...session.mediaFromAsset(asset), id: missing.id })
  offline = offline.filter((id) => id !== missing.id)
  doneRebuilding(missing.id, false)
  return 'relinked'
}

export function newDocument(win: BrowserWindow | null): Promise<boolean> {
  return exclusive(false, async () => {
    if (!(await confirmDiscard(win))) return false
    await writeBackWorkspace()
    adopt(session.blankProject(), null, defaultWorkspace(), true, NOTHING_MISSING)
    diskStamp = null
    updateRecent((r) => setLast(r, null))
    return true
  })
}

/** The project as it is written to a file: sources kept offline where they really are. */
function onDisk(project: Project): Project {
  return withheld.size === 0 ? project : { ...project, media: withWithheld(project.media, withheld, offlineDir()) }
}

/** Open a file without asking about the current document. For launch, and after asking. */
export async function openPath(target: string): Promise<boolean> {
  // Before reading: a newer version put in place while this one is being
  // checked must not be taken for the one that was read.
  const stamp = await stampOf(target)
  let loaded
  try {
    loaded = await loadProjectFrom(target, sourceAccess())
  } catch (err) {
    notify(`${basename(target)} could not be opened: ${describe(err)}`, 'fades')
    return false
  }
  const project = { ...loaded.project, name: session.nameOnOpen(loaded.project.name, target) }
  const check = await checkSources(project)
  adopt(project, target, loaded.workspace, true, check, loaded.withheld)
  // You opened it, so the share it is on, if it is on one, is one you use.
  await trustSharesOf([target])
  // A file an older version wrote is not rewritten behind your back: the
  // version that wrote it would no longer open it.
  diskStamp = loaded.fileSchema === SCHEMA_VERSION ? stamp : null
  updateRecent((r) => addRecent(r, target))
  void tidyBeside(target)
  return true
}

/**
 * Everything a clean close does once unsaved changes are dealt with.
 *
 * The autosave stops first, so nothing it writes after this point can come
 * back as a recovery offer for work you chose not to keep.
 */
export async function closeCleanly(): Promise<void> {
  stopAutosave()
  try {
    await writeBackWorkspace()
  } finally {
    await dropRecovery()
    await recentWork
  }
}

/** Remove the open document's copy, once it has been saved or given up. */
function dropRecovery(): Promise<void> {
  return inOrder(async () => {
    const file = recoveryFile
    const held = restoredFrom
    recoveryFile = null
    restoredFrom = null
    lastAutosaved = null
    if (file) await removeRecovery(file)
    if (held) await removeRecovery(held)
  })
}

/**
 * Write a copy of the open document now, if it has changes that are not on
 * disk and has changed since the last copy. Throws if it cannot be written.
 * Only ever run inside `inOrder`.
 */
async function writeCopy(): Promise<void> {
  if (!recoveryFolder || !session.isChanged()) return
  const path = session.getProjectPath()
  // A copy on offer that could not be set aside still sits where this
  // project's copies go. Writing there would replace it.
  if (offered && !offered.held && offered.file.toLowerCase().endsWith(recoveryFileName(path))) return
  const project = session.getProject()
  const text = serialiseProject(project)
  if (text === lastAutosaved) return
  // Paths stay absolute: the copy does not live beside the project.
  recoveryFile = await writeRecovery(
    recoveryFolder,
    { recoveryOf: path, name: project.name, writtenAt: Date.now() },
    joinProjectFile(onDisk(project), session.getWorkspace())
  )
  lastAutosaved = text
  // The restored work now has a copy of its own.
  const held = restoredFrom
  restoredFrom = null
  if (held) await removeRecovery(held)
}

/**
 * Write a recovery copy, project and workspace together, if there is anything
 * new to keep. One that cannot be written is told once, not every half minute:
 * until it can, a crash would lose what is not saved.
 */
export function autosave(): Promise<void> {
  return inOrder(async () => {
    try {
      await writeCopy()
      recoveryFailed = false
    } catch (err) {
      if (recoveryFailed) return
      recoveryFailed = true
      notify(`A recovery copy of ${session.projectName()} could not be written: ${describe(err)}. Save your work to be sure it is kept.`, 'waits')
    }
  })
}

/**
 * Get going at launch, before the window exists.
 *
 * A recovery copy still on disk means the app did not close cleanly last
 * time. The newest worth having is set aside and offered, and meanwhile the
 * window shows the saved version of that project, if it has one. Copies a
 * later save made pointless are removed. Then the autosave starts.
 *
 * Each step stands alone: one that fails is skipped rather than stopping the
 * app from opening a window.
 */
export async function startup(settingsDir: string, autosaveMs: number, launchPath: string | null): Promise<void> {
  recentFile = recentPath(settingsDir)
  recent = await loadRecent(recentFile)
  await loadTrustedShares(settingsDir)
  onTrustWriteFailed((reason) => notify(`The list of network folders you allowed could not be saved (${reason}). A project there may ask again next time.`, 'fades'))
  recoveryFolder = recoveryDir(settingsDir)

  try {
    const copies = await listRecovery(recoveryFolder)
    const holds = new Set<string>()
    for (const c of copies) if (await fileHolds(c)) holds.add(c.file)
    const choice = chooseRecovery(copies, (c) => holds.has(c.file))
    for (const c of choice.stale) await setRecoveryAside(c).catch(() => undefined)
    const offer = choice.offer
    // Should setting it aside fail, it is offered from where it is, and the
    // autosave leaves that slot alone until it is answered.
    heldThisLaunch = offer !== null && !offer.held
    offered = offer ? await setAside(offer).catch(() => offer) : null
  } catch (err) {
    notify(`The recovery folder could not be read: ${describe(err)}`, 'waits')
  }

  // In the same queue as every other open, so a project double-clicked while
  // the app is still starting is opened after this rather than beside it, and
  // this steps aside for it (audit 2026-10-01).
  const docAtStart = session.getDocId()
  await exclusive(undefined, async () => {
    if (session.getDocId() !== docAtStart) return
    try {
      // What to show first: a file you opened the app with, then the saved
      // version of a project with a copy on offer, then the project that was
      // open last time.
      if (launchPath) {
        await openPath(launchPath)
      } else if (offered) {
        if (offered.recoveryOf && (await exists(offered.recoveryOf))) await openPath(offered.recoveryOf)
      } else if (recent.last) {
        const last = recent.last
        if (await exists(last)) {
          await openPath(last)
        } else {
          notify(`${basename(last)} is no longer at ${last}, so Editbay started with a new project.`, 'fades')
          updateRecent((r) => setLast(r, null))
        }
      }
    } catch (err) {
      notify(`The last project could not be opened: ${describe(err)}`, 'fades')
    }
  })

  stopAutosave()
  autosaveTimer = setInterval(() => void autosave(), autosaveMs)
}

export function stopAutosave(): void {
  if (autosaveTimer) clearInterval(autosaveTimer)
  autosaveTimer = null
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = null
  copyDueBy = null
}

export function recoveryOffer(): RecoveryOffer | null {
  if (!offered) return null
  // A copy set aside by an earlier launch was offered then and never
  // answered, which says nothing about how the app closed this time.
  return { name: offered.name, writtenAt: offered.writtenAt, unanswered: offered.held && !heldThisLaunch }
}

/**
 * Open the offered copy in place of whatever is showing. It opens as changed,
 * because it is not what the project file holds: it still has to be saved.
 */
export function restoreRecovery(win: BrowserWindow | null): Promise<void> {
  return exclusive(undefined, async () => {
    const copy = offered
    if (!copy) return
    if (!(await confirmDiscard(win))) return

    let text
    try {
      text = await readRecoveryDocument(copy.file)
      splitProjectFile(text)
    } catch (err) {
      notify(`The recovery copy of ${copy.name} could not be read: ${describe(err)}`, 'waits')
      return
    }
    await writeBackWorkspace()
    offered = null
    await adoptCopy(text, copy.recoveryOf)
    // Write it straight back as the open document's own copy, which lets go
    // of the set-aside one. Were that write to fail, the next autosave, a save
    // or giving the work up lets go of it instead.
    void inOrder(async () => {
      restoredFrom = copy.file
      await writeCopy()
    })
    const path = copy.recoveryOf
    updateRecent((r) => (path ? addRecent(r, path) : setLast(r, null)))
  })
}

/**
 * Open a copy of a project, a recovery copy or an earlier version, in place
 * of whatever is showing, attached to the project's file. It opens as
 * changed, because it is not what the file holds, and the first save keeps
 * what the file does hold as an earlier version before writing over it.
 */
export async function adoptCopy(text: string, projectPath: string | null): Promise<void> {
  const file = splitProjectFile(text)
  // Held to the same rules as a project being opened, without asking: a
  // copy written before those rules existed may name anything.
  // The project's own share is allowed, as it is when the project is opened.
  const rules = sourceAccess()
  const own = projectPath ? shareOf(projectPath) : null
  const usable = usableProject(file.project.media, file.workspace, { ...rules, allowed: new Set([...rules.allowed, ...(own ? [own] : [])]) })
  const project = { ...file.project, media: usable.media }
  const check = await checkSources(project)
  adopt(project, projectPath, usable.workspace, false, check, usable.withheld)
  diskStamp = projectPath ? await stampOf(projectPath) : null
}

export function discardRecovery(): Promise<void> {
  return exclusive(undefined, async () => {
    const copy = offered
    offered = null
    if (copy) await inOrder(() => setRecoveryAside(copy))
  })
}

/** Change the recent list and write it, one write at a time. */
export function updateRecent(change: (r: RecentState) => RecentState): void {
  recent = change(recent)
  const file = recentFile
  if (!file) return
  const state = recent
  recentWork = recentWork.then(() => saveRecent(file, state)).then(
    () => undefined,
    () => undefined
  )
}

/** The recent list as the window shows it, noting which files have gone. */
export async function recentProjects(): Promise<RecentProject[]> {
  const out: RecentProject[] = []
  for (const path of recent.projects) {
    out.push({ path, name: session.nameFromPath(path), exists: await exists(path) })
  }
  return out
}

/**
 * Ask before closing stops an export or a voice-over take. Closing ends
 * either at once: the export's file is left unfinished, and the take is never
 * put on the timeline. True means carry on and close.
 */
export async function confirmStop(win: BrowserWindow): Promise<boolean> {
  const exporting = exportRunning()
  const recording = takeRecording()
  // Making captions and downloading the speech model count too (audit 2026-10-01).
  const speech = speechBusy()
  if (!exporting && !recording && !speech) return true
  const [message, detail] = exporting
    ? ['An export is still running', 'Closing now stops it. Nothing it was writing is kept, and a file it was to replace stays as it was.']
    : recording
      ? ['A voice-over is still recording', 'Closing now stops it, and the take is not put on the timeline.']
      : speech === 'captions'
        ? ['Captions are still being made', 'Closing now stops it, and the captions are not put on the timeline.']
        : ['The speech model is still downloading', 'Closing now stops it. What has come so far is removed, and the download starts again the next time it is needed.']
  const response = await messageBox(win, {
    type: 'warning',
    title: 'Editbay',
    message,
    detail,
    buttons: ['Keep working', 'Close anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}
