import { ipcMain, dialog, shell, BrowserWindow, app, type OpenDialogOptions } from 'electron'
import { fontFor } from './fonts/system-fonts'
import type { FontFigures } from '../shared/font-file'
import { testLaunch } from './test-launch'
import { isAbsolute, relative } from 'node:path'
import type { AppSettings, Recording, RecordingsListing, FolderListing, FolderSearch } from '../shared/types'
import { cacheRoot } from './media/cache'
import { cacheSize, pruneCache } from './media/prune'
import { cacheInUse } from './media/cache-in-use'
import { trustSharesOf, trustedShares } from './settings/trusted-shares'
import { mayUse } from '../shared/source-paths'
import { defaultSettings, loadSettings, sanitiseSettings, saveSettings } from './settings/app-settings'
import { obsRecordingFolder } from './obs/obs-folder'
import { RecordingsWatcher, type Where } from './obs/recordings'
import { copyInto, insideOf, readLevel, searchBelow } from './folders'
import { detectBackground } from './media/background'
import type { BackgroundColour } from '../shared/looks'
import { addRecordings, effectsFolderOf } from '../shared/source-folders'
import { makeAssetFolders } from './assets'
import { packUrl } from '../shared/free-packs'
import * as session from './project/session'
import * as lifecycle from './project/lifecycle'
import { broadcast } from './ipc-broadcast'
// Called only once settings are read or changed, never while the modules load,
// so the import back from ipc-export for `settings` is harmless.
import { exporting } from './ipc-export'

/** The app's settings as kept, read once at startup. */
export let settings: Promise<AppSettings> = Promise.resolve(defaultSettings())

/**
 * Where OBS's settings are. A test launch reads them only from a folder it
 * names, never the settings of whoever is at the machine.
 */
const obsAppData = testLaunch && !app.isPackaged ? (process.env.EDITBAY_OBS_APPDATA ?? null) : app.getPath('appData')

/**
 * The Recordings entry's folder when one was chosen for it, or else the one
 * OBS records to; nothing at all when Recordings has been taken out of Sources.
 */
const recordingsWhere: Where = async () => {
  const entry = (await settings).sourceFolders.find((f) => f.kind === 'recordings')
  if (!entry) return { folder: null, fromObs: false }
  if (entry.folder) return { folder: entry.folder, fromObs: false }
  // OBS records to Videos until told otherwise, and may not write that down.
  return { folder: obsAppData ? await obsRecordingFolder(obsAppData, app.getPath('videos')) : null, fromObs: true }
}

const recordings = new RecordingsWatcher(recordingsWhere, (r: Recording) => broadcast('obs:finished', r))


/** The app's settings once they have been read, for startup to wait on. */
export function settingsRead(): Promise<AppSettings> {
  return settings
}

/** The settings' handlers, and the settings read once at startup. */
export function registerSettingsIpc(settingsFile: string): void {
  settings = loadSettings(settingsFile).then((s) => {
    lifecycle.setSaveAutomatically(s.saveAutomatically, exporting)
    session.setStartShape(s.lastShape)
    return s
  })

  ipcMain.handle('settings:get', (): Promise<AppSettings> => settings)
  // The figures a caption font from this PC is laid out by, read from its file (plan 87). Null when it is not installed.
  ipcMain.handle('fonts:captionFont', async (_e, family: unknown): Promise<FontFigures | null> =>
    typeof family === 'string' && family.length < 200 ? ((await fontFor(family))?.figures ?? null) : null
  )
  ipcMain.handle('cache:size', (): Promise<number> => cacheSize(cacheRoot()))
  // Asked for in Settings: what the open project does not use goes now, not after it has gone unused a while.
  ipcMain.handle('cache:free', (): Promise<number> => pruneCache(cacheRoot(), cacheInUse(), 0))
  ipcMain.handle('settings:set', async (_e, change: Partial<AppSettings>): Promise<AppSettings> => {
    // One change after another, each on top of the last: two made at once
    // must not both start from the same settings, or the later loses the earlier.
    settings = settings.then((was) => {
      const wanted = sanitiseSettings({ ...was, ...change })
      // A folder to export to is one chosen here, so on a drive or a share you use (audit 2026-10-01).
      if (wanted.exportFolder !== null && !mayUse(wanted.exportFolder, trustedShares())) wanted.exportFolder = was.exportFolder
      // Kept in memory even if the file could not be written, so the window and
      // main agree, and you are told, since they would be gone at the next start.
      return saveSettings(settingsFile, wanted).catch((err: unknown) => {
        lifecycle.notify(`Your settings could not be saved (${err instanceof Error ? err.message : String(err)}). They apply until Editbay closes.`, 'waits')
        return wanted
      })
    })
    const kept = await settings
    // Plan 96: the assets folder has its Video, Audio and Images in it from the moment it is chosen.
    const assets = effectsFolderOf(kept.sourceFolders)?.folder
    if (assets) await makeAssetFolders(assets)
    lifecycle.setSaveAutomatically(kept.saveAutomatically, exporting)
    session.setStartShape(kept.lastShape)
    return kept
  })
}

/** The recordings and your own folders that Sources lists. */
export function registerSourcesIpc(settingsFile: string): void {
  // Task 44: a suggested pack's page, in the browser. Only the pages on the list, never an address the window names.
  ipcMain.handle('packs:open', async (_e, id: unknown): Promise<boolean> => {
    const url = typeof id === 'string' ? packUrl(id) : null
    if (!url) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('obs:list', (): Promise<RecordingsListing> => recordings.listing())

  ipcMain.handle('obs:chooseFolder', async (event): Promise<RecordingsListing | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const current = (await recordings.listing()).folder
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Where are your recordings?',
      ...(current ? { defaultPath: current } : {})
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const folder = result.canceled ? null : (result.filePaths[0] ?? null)
    if (!folder) return null
    // Recordings on that folder, and back in Sources if it had been taken out.
    const now = await settings
    const list = now.sourceFolders.some((f) => f.kind === 'recordings') ? now.sourceFolders : addRecordings(now.sourceFolders)
    const wanted = sanitiseSettings({ ...now, sourceFolders: list.map((f) => (f.kind === 'recordings' ? { ...f, folder } : f)) })
    settings = saveSettings(settingsFile, wanted).catch(() => wanted)
    await settings
    await recordings.reset()
    return recordings.poll()
  })
  recordings.start()

  // Your own folders, read fresh each time Sources asks: a file dropped into
  // one should be there the next time it looks. The window names an entry and
  // a path under its folder, never a folder of its own choosing.
  const entryFolder = async (id: unknown): Promise<{ folder: string; newestFirst: boolean } | null> => {
    if (typeof id !== 'string') return null
    const entry = (await settings).sourceFolders.find((f) => f.id === id)
    if (!entry) return null
    const folder = entry.kind === 'recordings' ? (await recordings.listing()).folder : entry.folder
    return folder ? { folder, newestFirst: entry.newestFirst } : null
  }
  ipcMain.handle('folders:list', async (_e, id: unknown, under: unknown): Promise<FolderListing> => {
    const entry = await entryFolder(id)
    if (!entry) return { folder: null, dirs: [], files: null, more: 0 }
    return readLevel(entry.folder, typeof under === 'string' ? under : '', entry.newestFirst)
  })
  ipcMain.handle('folders:search', async (_e, id: unknown, words: unknown): Promise<FolderSearch> => {
    const entry = await entryFolder(id)
    if (!entry || typeof words !== 'string') return { files: [], cut: false }
    return searchBelow(entry.folder, words.slice(0, 200))
  })
  ipcMain.handle('folders:copyInto', async (_e, id: unknown, under: unknown, paths: unknown): Promise<string[]> => {
    const entry = await entryFolder(id)
    if (!entry || typeof under !== 'string' || !Array.isArray(paths)) return []
    return copyInto(entry.folder, under, paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p)))
  })
  // Only a file in the effects folder: the window names a path, and nothing else is read for it.
  ipcMain.handle('effects:background', async (_e, path: unknown): Promise<BackgroundColour | null> => {
    if (typeof path !== 'string') return null
    const entry = effectsFolderOf((await settings).sourceFolders)
    if (!entry?.folder || insideOf(entry.folder, relative(entry.folder, path)) === null) return null
    return detectBackground(path)
  })

  ipcMain.handle('folders:pick', async (event, from?: unknown): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Which folder should Sources list?',
      ...(typeof from === 'string' && from !== '' ? { defaultPath: from } : {})
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const chosen = result.canceled ? null : (result.filePaths[0] ?? null)
    // You chose it, so the share it is on, if it is on one, is one you use.
    if (chosen) await trustSharesOf([chosen])
    return chosen
  })
}
