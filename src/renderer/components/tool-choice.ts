import type { ToolChoice } from '../../shared/clip-tools'
import type { Clip } from '../../shared/project'
import type { ClipEdit } from '../../shared/types'
import { showToast } from '../state/toasts'
import { backgroundName } from '../../shared/looks'

/**
 * Make one of a tool's choices on a clip. A choice that has to look at the
 * clip first, as Remove background does for the colour it stands on (task 32),
 * reads the picture the clip starts on and says what it found; when there is
 * nothing it can take out, it says so and changes nothing.
 */
export async function makeToolChoice(choice: ToolChoice, clip: Clip, fps: number, onEdit: (e: ClipEdit) => void): Promise<void> {
  if (!choice.detect) {
    onEdit(choice.edit(clip.id))
    return
  }
  const found = await window.api.mediaBackground(clip.mediaId, clip.sourceIn / fps)
  if (found === null) {
    showToast({ kind: 'background-none', text: 'No plain background found, so this background cannot be removed.' })
    return
  }
  onEdit(choice.edit(clip.id, found))
  showToast({ kind: 'background-removed', text: `Removed the ${backgroundName(found)} background.` })
}
