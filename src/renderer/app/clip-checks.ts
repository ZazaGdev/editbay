/** Questions about one clip that the menus and the commands ask. */

import { findClip, isText, type Timeline as TimelineData } from '../../shared/project'
import { spanEnd } from '../../shared/tracks'

/**
 * Whether Split here would cut this clip: the playhead has to be inside it,
 * and not on its first frame, where a cut would leave nothing before it.
 */
export function splitsHere(t: TimelineData, clipId: string, playhead: number): boolean {
  const found = findClip(t, clipId)
  if (!found) return false
  const c = found.clip
  return playhead > c.timelineStart && playhead < spanEnd(c)
}

/** Whether a clip is a text. */
export function isTextClip(t: TimelineData, clipId: string): boolean {
  const found = findClip(t, clipId)
  const m = found ? t.media.find((x) => x.id === found.clip.mediaId) : undefined
  return m !== undefined && isText(m)
}
