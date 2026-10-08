import { dialog, type BrowserWindow } from 'electron'
import type { RecentProject } from '../../shared/types'
import { splitProjectFile } from '../../shared/project-file'
import * as session from './session'
import { listVersions, readVersion } from './versions'
import type { KeptVersion } from '../../shared/versions'
import { addRecent, forgetRecent, setLast } from '../settings/recent-store'
import { describe, notify } from './windows'
import { exclusive } from './one-at-a-time'
import { versionsFolder } from './kept-copies'
import {
  PROJECT_FILTERS,
  adoptCopy,
  confirmDiscard,
  openPath,
  recentProjects,
  renameNow,
  samePath,
  saveNow,
  updateRecent,
  writeBackWorkspace
} from './open-document'

export {
  autosave,
  broadcastProject,
  broadcastStatus,
  changed,
  discardRecovery,
  isRebuilding,
  newDocument,
  onDocumentReplaced,
  openPath,
  recentProjects,
  recoveryOffer,
  restoreRecovery,
  retrySource,
  setSaveAutomatically,
  snapshot,
  startup,
  status,
  stopAutosave
} from './open-document'
export { notify, takeNotices } from './windows'
export { prepareSoundCopies } from './sound-copies'
export { relink, sourcesSettled } from './missing-sources'
export { guardClose, onCloseStop } from './one-at-a-time'

/**
 * The life of the open document: saving it, replacing it, and never losing it
 * on the way. The IPC handlers and the window's close both come through here,
 * so every path that could drop unsaved work asks the same question.
 */

/**
 * Save the document, asking where for one that has never been saved.
 * Returns where it went, or null if you cancelled or it could not be written.
 */
export function save(saveAs: boolean, win: BrowserWindow | null): Promise<string | null> {
  return exclusive(null, () => saveNow(saveAs, win))
}

/**
 * Call the document something, from the top bar. An empty or unchanged name
 * does nothing, as an empty track name does nothing.
 *
 * It makes the project differ from its file, so it counts as unsaved work and
 * the dot beside the name comes up, which is right: a name is part of what
 * gets written.
 */
export function renameProject(raw: string): Promise<void> {
  return exclusive(undefined, () => renameNow(raw))
}

/**
 * Open a project file, asking which one when no path is given. Unsaved
 * changes are dealt with first. False when nothing was opened.
 *
 * A path naming the project already open, from the recent list or a
 * double-click in Explorer, leaves it as it is rather than reloading it and
 * throwing away its undo history.
 */
export function openDocument(win: BrowserWindow | null, path?: string): Promise<boolean> {
  return exclusive(false, async () => {
    if (path && samePath(path, session.getProjectPath())) return true
    if (!(await confirmDiscard(win))) return false

    let target = path
    if (!target) {
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: PROJECT_FILTERS })
        : await dialog.showOpenDialog({ properties: ['openFile'], filters: PROJECT_FILTERS })
      target = result.filePaths[0]
      if (result.canceled || !target) return false
    }
    await writeBackWorkspace()
    return openPath(target)
  })
}

/**
 * The open project's earlier versions, newest first, and the unsaved work of
 * projects never saved, when the open one has a file. Fifteen of each.
 */
export async function earlierVersions(): Promise<{ name: string; versions: KeptVersion[]; unsaved: KeptVersion[] }> {
  const path = session.getProjectPath()
  const versions = (await listVersions(versionsFolder(), path)).slice(0, 15)
  const unsaved = path ? (await listVersions(versionsFolder(), null)).slice(0, 15) : []
  return { name: session.projectName(), versions, unsaved }
}

/**
 * Open an earlier version in place of the open document, as restoring a
 * recovery copy does. What is open is dealt with first, as for any open.
 */
export function openEarlierVersion(win: BrowserWindow | null, id: string): Promise<boolean> {
  return exclusive(false, async () => {
    let version
    try {
      version = await readVersion(versionsFolder(), id)
      splitProjectFile(version.text)
    } catch (err) {
      notify(`That earlier version could not be read: ${describe(err)}`, 'waits')
      return false
    }
    if (!(await confirmDiscard(win))) return false
    await writeBackWorkspace()
    await adoptCopy(version.text, version.projectPath)
    const path = version.projectPath
    updateRecent((r) => (path ? addRecent(r, path) : setLast(r, null)))
    return true
  })
}

/**
 * The window broke while this project was open (audit 2026-10-01): the next
 * launch starts on the start screen rather than opening it again and maybe
 * breaking again. It stays in the recent list, and its recovery copy is kept.
 */
export function forgetLastProject(): void {
  updateRecent((r) => setLast(r, null))
}

export function forgetRecentProject(path: string): Promise<RecentProject[]> {
  updateRecent((r) => forgetRecent(r, path))
  return recentProjects()
}
