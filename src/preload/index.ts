import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  EditbayApi,
  ImportProgress,
  MediaAsset,
  ExportProgress,
  OpenedDocument,
  ProjectStatus,
  Recording,
  SpeechProgress
} from '../shared/types'
import type { Project } from '../shared/project'

const api: EditbayApi = {
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  exportOnGpu: () => ipcRenderer.invoke('export:gpu'),
  lighterCopy: (mediaId) => ipcRenderer.invoke('media:lighterCopy', mediaId),
  mediaBackground: (mediaId, from) => ipcRenderer.invoke('media:background', mediaId, from),
  mediaFaces: (mediaId, from, to, fps) => ipcRenderer.invoke('media:faces', mediaId, from, to, fps),
  stopLighterCopies: () => ipcRenderer.invoke('media:stopLighterCopies'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  importFiles: (paths) => ipcRenderer.invoke('assets:import', paths),
  listAssets: () => ipcRenderer.invoke('assets:list'),
  // File.path was removed from Electron. This is the only way to get a dropped
  // file's real path, and it must happen on this side of the bridge.
  pathForFile: (file) => webUtils.getPathForFile(file),
  onImportProgress: (handler) => {
    const listener = (_e: unknown, p: ImportProgress): void => handler(p)
    ipcRenderer.on('assets:progress', listener)
    return () => ipcRenderer.off('assets:progress', listener)
  },
  onAssetChanged: (handler) => {
    const listener = (_e: unknown, a: MediaAsset): void => handler(a)
    ipcRenderer.on('assets:changed', listener)
    return () => ipcRenderer.off('assets:changed', listener)
  },
  onAssetRemoved: (handler) => {
    const listener = (_e: unknown, id: string): void => handler(id)
    ipcRenderer.on('assets:removed', listener)
    return () => ipcRenderer.off('assets:removed', listener)
  },
  cancelImport: (id) => ipcRenderer.invoke('assets:cancel', id),
  retryImport: (id) => ipcRenderer.invoke('assets:retry', id),
  removeSource: (id) => ipcRenderer.invoke('assets:remove', id),
  showSource: (id) => ipcRenderer.invoke('assets:show', id),

  recordings: () => ipcRenderer.invoke('obs:list'),
  chooseRecordingsFolder: () => ipcRenderer.invoke('obs:chooseFolder'),
  listFolder: (id: string, under: string) => ipcRenderer.invoke('folders:list', id, under),
  searchFolder: (id: string, words: string) => ipcRenderer.invoke('folders:search', id, words),
  copyIntoFolder: (id: string, under: string, paths: string[]) => ipcRenderer.invoke('folders:copyInto', id, under, paths),
  pickSourceFolder: (from?: string) => ipcRenderer.invoke('folders:pick', from),
  openPack: (id: string) => ipcRenderer.invoke('packs:open', id),
  effectBackground: (path: string) => ipcRenderer.invoke('effects:background', path),
  onRecordingFinished: (handler) => {
    const listener = (_e: unknown, r: Recording): void => handler(r)
    ipcRenderer.on('obs:finished', listener)
    return () => ipcRenderer.off('obs:finished', listener)
  },

  currentProject: () => ipcRenderer.invoke('project:current'),
  session: () => ipcRenderer.invoke('project:session'),
  applyEdit: (docId, edit, continuing) => ipcRenderer.invoke('project:edit', docId, edit, continuing === true),
  setProject: (docId, project) => ipcRenderer.invoke('project:set', docId, project),
  newProject: () => ipcRenderer.invoke('project:new'),
  openProject: (path) => ipcRenderer.invoke('project:open', path),
  saveProject: (saveAs) => ipcRenderer.invoke('project:save', saveAs),
  renameProject: (name) => ipcRenderer.invoke('project:rename', name),
  loadPeaks: (mediaId, track) => ipcRenderer.invoke('media:peaks', mediaId, track ?? 0),
  saveText: (key, png) => ipcRenderer.invoke('text:save', key, png),
  missingTexts: (paths) => ipcRenderer.invoke('text:missing', paths),
  relinkMedia: (mediaId) => ipcRenderer.invoke('media:relink', mediaId),
  onProjectChanged: (handler) => {
    const listener = (_e: unknown, p: Project): void => handler(p)
    ipcRenderer.on('project:changed', listener)
    return () => ipcRenderer.off('project:changed', listener)
  },
  onProjectOpened: (handler) => {
    const listener = (_e: unknown, d: OpenedDocument): void => handler(d)
    ipcRenderer.on('project:opened', listener)
    return () => ipcRenderer.off('project:opened', listener)
  },
  onProjectStatus: (handler) => {
    const listener = (_e: unknown, s: ProjectStatus): void => handler(s)
    ipcRenderer.on('project:status', listener)
    return () => ipcRenderer.off('project:status', listener)
  },
  setWorkspace: (docId, workspace) => ipcRenderer.invoke('workspace:set', docId, workspace),

  recentProjects: () => ipcRenderer.invoke('project:recent'),
  forgetRecent: (path) => ipcRenderer.invoke('project:forgetRecent', path),
  recoveryOffer: () => ipcRenderer.invoke('recovery:offer'),
  windowCrashed: (detail) => ipcRenderer.invoke('window:crashed', detail),
  restoreRecovery: () => ipcRenderer.invoke('recovery:restore'),
  earlierVersions: () => ipcRenderer.invoke('versions:list'),
  openEarlierVersion: (id) => ipcRenderer.invoke('versions:open', id),
  discardRecovery: () => ipcRenderer.invoke('recovery:discard'),
  takeNotices: () => ipcRenderer.invoke('notices:take'),
  onNotice: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on('notices:ping', listener)
    return () => ipcRenderer.off('notices:ping', listener)
  },

  pickExportFolder: (from) => ipcRenderer.invoke('export:pickFolder', from),
  defaultExportFolder: () => ipcRenderer.invoke('export:defaultFolder'),
  previewExport: (request) => ipcRenderer.invoke('export:preview', request),
  startExport: (request) => ipcRenderer.invoke('export:start', request),
  saveAsAsset: (sequenceId, clipIds) => ipcRenderer.invoke('export:asset', sequenceId, clipIds),
  saveFrame: (request) => ipcRenderer.invoke('export:frame', request),
  saveTranscript: (request) => ipcRenderer.invoke('export:transcript', request),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  revealPath: (path) => ipcRenderer.invoke('shell:reveal', path),
  openPath: (path) => ipcRenderer.invoke('shell:open', path),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  onExportProgress: (handler) => {
    const listener = (_e: unknown, p: ExportProgress): void => handler(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.off('export:progress', listener)
  },

  loadKeymap: () => ipcRenderer.invoke('keymap:load'),
  saveKeymap: (overrides) => ipcRenderer.invoke('keymap:save', overrides),

  appSettings: () => ipcRenderer.invoke('settings:get'),
  setAppSettings: (change) => ipcRenderer.invoke('settings:set', change),
  cacheSize: () => ipcRenderer.invoke('cache:size'),
  captionFontFor: (family) => ipcRenderer.invoke('fonts:captionFont', family),
  freeCache: () => ipcRenderer.invoke('cache:free'),

  voiceBegin: (sampleRate) => ipcRenderer.invoke('voice:begin', sampleRate),
  voiceChunk: (samples) => ipcRenderer.invoke('voice:chunk', samples),
  voiceFinish: (line) => ipcRenderer.invoke('voice:finish', line),
  voiceCancel: () => ipcRenderer.invoke('voice:cancel'),

  speechStatus: () => ipcRenderer.invoke('speech:status'),
  downloadSpeech: () => ipcRenderer.invoke('speech:download'),
  cancelSpeechDownload: () => ipcRenderer.invoke('speech:cancelDownload'),
  transcribe: (sequenceId, trackIds, stretches) => ipcRenderer.invoke('speech:transcribe', sequenceId, trackIds, stretches),
  cancelTranscribe: () => ipcRenderer.invoke('speech:cancelTranscribe'),
  onSpeechProgress: (handler) => {
    const listener = (_e: unknown, p: SpeechProgress): void => handler(p)
    ipcRenderer.on('speech:progress', listener)
    return () => ipcRenderer.off('speech:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
