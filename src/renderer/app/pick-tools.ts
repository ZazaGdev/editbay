/**
 * Task 116: tools run from the command search that need something to act on.
 * Chosen there, the pointer becomes a picker, and the clip or the asset
 * clicked next is what it acts on, as its line in the right-click menu does.
 */

import { findClip } from '../../shared/project'
import { REMOVE_BACKGROUND, toolsFor } from '../../shared/clip-tools'
import { makeToolChoice } from '../components/tool-choice'
import { SOUND_FILE } from '../components/SourceFolders'
import { showToast } from '../state/toasts'
import type { AppState } from './app-state'

/** Whether it can be done to this: true, or why not, which the hint shows. */
type Can = true | string

export interface PickTool {
  id: string
  /** Its line in the command search. */
  label: string
  keywords: string[]
  /** What the hint asks to be clicked. */
  asks: string
  clip: (clipId: string) => Can
  onClip: (clipId: string) => void
  /** An asset in the effects folder, by its path, for a tool that takes one. */
  asset?: { can: (path: string) => Can; on: (path: string) => void }
}

export function pickTools(app: AppState): PickTool[] {
  const { timeline, editClip, select, selected, putEffect, setCaptionsScope, setCaptionsOpen, show } = app
  const found = (clipId: string) => (timeline ? findClip(timeline, clipId) : null)
  const anyClip = (clipId: string): Can => (found(clipId) ? true : 'That clip is no longer on the timeline')
  return [
    {
      id: REMOVE_BACKGROUND.id,
      label: REMOVE_BACKGROUND.name,
      keywords: ['green', 'screen', 'key', 'chroma', 'transparent', 'tool'],
      asks: 'click a clip, or an asset to put over the selected clip',
      clip: (clipId) => {
        const f = found(clipId)
        if (!f || f.kind !== 'video') return 'Only a clip with a picture has a background'
        const media = timeline!.media.find((m) => m.id === f.clip.mediaId)
        return toolsFor(media).includes(REMOVE_BACKGROUND) ? true : 'A text, a shape or a colour has no background to take out'
      },
      onClip: (clipId) => {
        const f = found(clipId)
        if (!f || f.kind !== 'video' || !timeline) return
        select(clipId)
        void makeToolChoice(REMOVE_BACKGROUND.choices(f.clip)[0]!, f.clip, timeline.fps, editClip)
      },
      // As the asset's "Put over it, removing the background", with the colour read from it.
      asset: {
        can: (path) => (SOUND_FILE.test(path) ? 'A sound has no background' : selected === null ? 'Select a clip on the timeline first' : true),
        on: (path) => {
          const over = selected
          if (over === null) return
          void window.api.effectBackground(path).then((background) => {
            if (background === null) showToast({ kind: 'background-none', text: 'No plain background found, so this background cannot be removed.' })
            else void putEffect(path, { clipId: over }, background)
          })
        }
      }
    },
    {
      id: 'captions-for-clip',
      label: 'Make captions for a clip',
      keywords: ['subtitles', 'words', 'transcribe'],
      asks: 'click the clip to make captions for',
      clip: anyClip,
      onClip: (clipId) => {
        select(clipId)
        setCaptionsScope('selected')
        setCaptionsOpen(true)
      }
    },
    {
      id: 'show-source',
      label: 'Show where a clip came from',
      keywords: ['source', 'file', 'reveal', 'find', 'bin'],
      asks: 'click the clip to find in Sources',
      clip: anyClip,
      onClip: (clipId) => {
        const f = found(clipId)
        if (f) show(f.clip.mediaId)
      }
    }
  ]
}
