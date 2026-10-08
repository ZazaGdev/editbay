import { join } from 'node:path'
import { cleanCredits } from '../../shared/credits'
import { cleanSourceFolders, firstSourceFolders } from '../../shared/source-folders'
import { readKept } from './read-kept'
import type { AppSettings } from '../../shared/types'
import { writeAtomic } from '../media/cache'
import {
  DEFAULT_PICTURE_KIND,
  DEFAULT_SOUND_KIND,
  DEFAULT_TRANSITION_SECONDS,
  pictureKind,
  soundKind
} from '../../shared/transitions'
import { DEFAULT_FILENAME_PATTERN } from '../../shared/workspace'
import { cleanFraming, cleanSavedLayouts } from '../../shared/saved-layouts'
import { cleanSavedShapes } from '../../shared/shape'
import { cleanSavedCaptionStyles, cleanSavedTextStyles } from '../../shared/saved-styles'
import { PRESETS } from '../../shared/presets'
import { DEFAULT_TEXT, cleanTextStyle } from '../../shared/text'

import { DEFAULT_PRESET_ID } from '../../shared/project'

/**
 * The app's own settings: yours rather than a project's, so they live with
 * the keymap and the recent list and follow you from one project to the next.
 */

const FILE_NAME = 'settings.json'

export function settingsPath(settingsDir: string): string {
  return join(settingsDir, FILE_NAME)
}

export function defaultSettings(): AppSettings {
  return {
    saveAutomatically: true,
    microphoneId: null,
    muteWhileRecording: false,
    transitionSeconds: DEFAULT_TRANSITION_SECONDS,
    transitionPictureKind: DEFAULT_PICTURE_KIND,
    transitionSoundKind: DEFAULT_SOUND_KIND,
    transitionOnEveryCut: false,
    sourceFolders: firstSourceFolders({}),
    credits: {},
    exportFolder: null,
    exportMode: 'join',
    exportPattern: DEFAULT_FILENAME_PATTERN,
    exportExisting: 'ask',
    showAfterExport: false,
    savedLayouts: [],
    savedShapes: [],
    savedCaptionStyles: [],
    savedTextStyles: [],
    lastShape: DEFAULT_PRESET_ID,
    textStyle: null,
    lastFraming: null
  }
}

/** The longest a remembered transition length may be: past this it is a mistake, not a preference. */
const MAX_TRANSITION_SECONDS = 30

/** Whatever was read from disk, field by field, falling back to the default for anything wrong. */
export function sanitiseSettings(raw: unknown): AppSettings {
  const d = defaultSettings()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d
  const r = raw as Record<string, unknown>
  return {
    saveAutomatically: typeof r.saveAutomatically === 'boolean' ? r.saveAutomatically : d.saveAutomatically,
    microphoneId: typeof r.microphoneId === 'string' && r.microphoneId !== '' ? r.microphoneId : d.microphoneId,
    muteWhileRecording: typeof r.muteWhileRecording === 'boolean' ? r.muteWhileRecording : d.muteWhileRecording,
    transitionSeconds:
      typeof r.transitionSeconds === 'number' && r.transitionSeconds > 0 && r.transitionSeconds <= MAX_TRANSITION_SECONDS
        ? r.transitionSeconds
        : d.transitionSeconds,
    // A kind this build does not have goes back to the default rather than
    // being kept: it would add a transition that could not be drawn.
    transitionPictureKind: pictureKind(r.transitionPictureKind)?.id ?? d.transitionPictureKind,
    transitionSoundKind: soundKind(r.transitionSoundKind)?.id ?? d.transitionSoundKind,
    transitionOnEveryCut: typeof r.transitionOnEveryCut === 'boolean' ? r.transitionOnEveryCut : d.transitionOnEveryCut,
    // Kept as they are once there are any; made the first time from what
    // Sources had before, Recordings and the library's two folders.
    sourceFolders: Array.isArray(r.sourceFolders) ? cleanSourceFolders(r.sourceFolders) : firstSourceFolders(r),
    credits: cleanCredits(r.credits),
    exportFolder: typeof r.exportFolder === 'string' && r.exportFolder.trim() !== '' ? r.exportFolder : d.exportFolder,
    exportMode: r.exportMode === 'join' || r.exportMode === 'batch' ? r.exportMode : d.exportMode,
    exportPattern: typeof r.exportPattern === 'string' && r.exportPattern.trim() !== '' ? r.exportPattern : d.exportPattern,
    exportExisting:
      r.exportExisting === 'ask' || r.exportExisting === 'replace' || r.exportExisting === 'keepBoth' ? r.exportExisting : d.exportExisting,
    showAfterExport: typeof r.showAfterExport === 'boolean' ? r.showAfterExport : d.showAfterExport,
    // A damaged layout goes and the rest stay: one bad entry must not lose every other.
    savedLayouts: cleanSavedLayouts(r.savedLayouts),
    savedShapes: cleanSavedShapes(r.savedShapes),
    savedCaptionStyles: cleanSavedCaptionStyles(r.savedCaptionStyles),
    savedTextStyles: cleanSavedTextStyles(r.savedTextStyles),
    // A shape this build does not have starts a new project on the default.
    lastShape: PRESETS.some((p) => p.id === r.lastShape) ? (r.lastShape as string) : d.lastShape,
    textStyle: typeof r.textStyle === 'object' && r.textStyle !== null ? { ...cleanTextStyle(r.textStyle), text: DEFAULT_TEXT.text } : null,
    // Checked as a saved layout's framing is: a damaged one is none.
    lastFraming: cleanFraming(r.lastFraming)
  }
}

/** Read the settings. A missing or unreadable file gives the defaults, never an error. */
export async function loadSettings(path: string): Promise<AppSettings> {
  try {
    const raw = await readKept(path)
    return raw === undefined ? defaultSettings() : sanitiseSettings(raw)
  } catch {
    return defaultSettings()
  }
}

/** Save the settings, whole or not at all. */
export async function saveSettings(path: string, settings: AppSettings): Promise<AppSettings> {
  const clean = sanitiseSettings(settings)
  await writeAtomic(path, Buffer.from(JSON.stringify(clean, null, 2)))
  return clean
}
