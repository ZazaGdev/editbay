import type { ClipEdit } from './types'
import type { Clip, ProjectMedia } from './project'
import { backgroundName, type FoundBackground } from './looks'

/**
 * Tools that change what a clip's picture shows rather than how it is
 * framed, coloured or cut (plan 90): each one a line in the clip menu's Tools
 * and a part of the Inspector's Tools group. Background removal is the first;
 * another goes in this list, and both places pick it up.
 */
export interface ClipTool {
  id: string
  name: string
  /** Whether a clip of this media can have it: a recording or a picture, not a text or a shape. */
  appliesTo: (media: ProjectMedia) => boolean
  /** Its choices, in menu order, each with the edit that makes it and whether it is the one set now. */
  choices: (clip: Clip) => readonly ToolChoice[]
}

export interface ToolChoice {
  id: string
  label: string
  /** The one set now on the clip. */
  current: boolean
  /** Made only once the clip's background has been looked at: `found` is the colour it stands on. */
  detect?: true
  edit: (clipId: string, found?: FoundBackground) => ClipEdit
}

/** A picture that is drawn rather than recorded has no background to take out. */
function recordedOrPicture(m: ProjectMedia): boolean {
  return m.text === undefined && m.shape === undefined && m.colour === undefined
}

export const REMOVE_BACKGROUND: ClipTool = {
  id: 'remove-background',
  name: 'Remove background',
  appliesTo: recordedOrPicture,
  // Task 32: one action, which looks at the clip for the colour to take out.
  choices: (clip) => [
    {
      id: 'remove',
      label: clip.removeBackground ? `Removed ${backgroundName(clip.removeBackground)} background` : 'Remove background',
      current: clip.removeBackground !== undefined,
      detect: true,
      edit: (clipId: string, found?: FoundBackground): ClipEdit => {
        const was = clip.removeBackground
        const colour = found ?? (was ? { colour: was.colour, ...(was.rgb ? { rgb: was.rgb } : {}) } : { colour: 'green' as const })
        // Looked at again, it keeps how strongly it was set.
        return { kind: 'setRemoveBackground', clipId, removal: { ...colour, ...(was?.strength !== undefined ? { strength: was.strength } : {}) } }
      }
    },
    {
      id: 'none',
      label: 'Keep the background',
      current: clip.removeBackground === undefined,
      edit: (clipId: string): ClipEdit => ({ kind: 'setRemoveBackground', clipId, removal: null })
    }
  ]
}

/** Every tool, in the order they are listed. */
export const CLIP_TOOLS: readonly ClipTool[] = [REMOVE_BACKGROUND]

/** The tools a clip of this media can have. */
export function toolsFor(media: ProjectMedia | undefined): readonly ClipTool[] {
  return media ? CLIP_TOOLS.filter((t) => t.appliesTo(media)) : []
}
