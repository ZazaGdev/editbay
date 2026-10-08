/**
 * What the command search offers for the features added lately (task 54):
 * the assets folder and its free packs, saving a clip as an asset, the looks
 * and the Inspector's sections.
 */

import type { Command } from '../../shared/commands'
import { LOOKS } from '../../shared/looks'
import { findVideoClip } from '../../shared/project'
import { SECTION_NAMES, showAll } from '../../shared/section-layout'
import { effectsFolderOf, setEffectsFolder } from '../../shared/source-folders'
import { saveAsAsset } from './save-asset'
import type { AppState } from './app-state'

/** Heard by Sources, which opens its list of free packs. */
export const OPEN_FREE_PACKS = 'editbay-open-free-packs'

export function recentCommands(app: AppState): Command[] {
  const { timeline, selected, selectedClips, sequenceId, editClip, windowSettings, setWindowSettings, fold } = app
  const picture = timeline && selected ? findVideoClip(timeline, selected) : null
  const layout = windowSettings.sections
  return [
    {
      id: 'chooseAssetsFolder',
      label: 'Choose the assets folder',
      keywords: ['asset', 'assets', 'library', 'effects', 'folder'],
      group: 'Project',
      run: () =>
        void window.api.appSettings().then(async (s) => {
          const folder = await window.api.pickSourceFolder(effectsFolderOf(s.sourceFolders)?.folder ?? undefined)
          if (folder) await window.api.setAppSettings({ sourceFolders: setEffectsFolder(s.sourceFolders, folder) })
        })
    },
    {
      id: 'freePacks',
      label: 'Get free assets: music, sound effects and overlays',
      keywords: ['asset', 'assets', 'pack', 'packs', 'download', 'free', 'credit'],
      group: 'Project',
      run: () => {
        // Sources lists them, so it is opened first if folded away.
        fold('binFolded')(false)
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_FREE_PACKS)))
      }
    },
    {
      id: 'saveAsAsset',
      label: 'Save the selected clips as an asset',
      keywords: ['asset', 'assets', 'library', 'reuse'],
      group: 'Editing',
      enabled: selectedClips.length > 0,
      run: () => void saveAsAsset(sequenceId, selectedClips)
    },
    {
      id: 'look:none',
      label: 'Take the look off the clip',
      keywords: ['look', 'colour', 'color', 'filter', 'none', 'as recorded'],
      group: 'Editing',
      enabled: picture !== null && picture.clip.look !== undefined,
      run: () => selected && editClip({ kind: 'setLook', clipId: selected, look: null })
    },
    ...LOOKS.map((l) => ({
      id: `look:${l.id}`,
      label: `Give the clip the ${l.name} look`,
      keywords: ['look', 'colour', 'color', 'filter'],
      group: 'Editing',
      enabled: picture !== null,
      run: () => selected && editClip({ kind: 'setLook', clipId: selected, look: l.id })
    })),
    {
      id: 'sectionsAll',
      label: 'Show every section in the Inspector',
      keywords: ['inspector', 'sections', 'picker', 'hidden'],
      group: 'View',
      enabled: layout.hidden.length > 0,
      run: () => setWindowSettings({ sections: showAll(layout) })
    },
    ...SECTION_NAMES.map((name) => ({
      id: `section:${name}`,
      label: `Open ${name} in the Inspector`,
      keywords: ['inspector', 'section', 'unfold'],
      group: 'View',
      run: () => {
        fold('inspectorFolded')(false)
        setWindowSettings({
          inspectorFolds: { ...windowSettings.inspectorFolds, [name]: false },
          ...(layout.hidden.includes(name) ? { sections: { ...layout, hidden: layout.hidden.filter((n) => n !== name) } } : {})
        })
      }
    }))
  ]
}
