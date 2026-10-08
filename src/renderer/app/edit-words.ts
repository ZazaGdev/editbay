/**
 * What the window says about an edit: the notice after an edit that changes
 * many clips at once, and why closing up is refused.
 */

import type { ClipEdit } from '../../shared/types'
import { allClips, findClip, linkedIds, shapeName, trackLabel, type Timeline as TimelineData } from '../../shared/project'
import { trimToPlayheadWords } from '../../shared/playback'

/**
 * Why closing up is refused: which track holds the clip it would push out of
 * step, since something left whole across the stretch there is in its way.
 */
export function inTheWay(t: TimelineData, blockers: { id: string }[]): string {
  const found = blockers[0] ? findClip(t, blockers[0].id) : null
  const track = found ? trackLabel(t, found.track.id) : 'a track'
  return `it would push a clip on ${track} out of step with its picture: something left whole across the stretch on that track, such as a voice over, is in the way`
}

function clips(n: number): string {
  return n === 1 ? '1 other clip' : `${n} other clips`
}

/** Frames as seconds to a tenth, as a join that brings footage back says it: "1.2 s". */
export function secondsOf(frames: number, fps: number): string {
  return `${(Math.round((frames / fps) * 10) / 10).toFixed(1)} s`
}

/** What to say after an edit that changes many clips at once, or null for any other edit. */
export function manyClipsChanged(e: ClipEdit, t: TimelineData): string | null {
  /** The other clips of the same recording: on the same track for pictures, anywhere for sound. */
  const others = (clipId: string): number => {
    const found = findClip(t, clipId)
    if (!found) return 0
    const group = new Set(linkedIds(t, clipId))
    const pool = found.kind === 'video' ? found.track.clips : t.audioTracks.flatMap((r) => r.clips)
    const sounds = t.audioTracks.flatMap((r) => r.clips).filter((c) => group.has(c.id))
    if (e.kind === 'applySoundToSource') {
      return t.audioTracks
        .flatMap((r) => r.clips)
        .filter((c) => !group.has(c.id) && sounds.some((s) => s.mediaId === c.mediaId && s.track === c.track)).length
    }
    return pool.filter((c) => c.mediaId === found.clip.mediaId && c.id !== clipId).length
  }
  /** Whether an edit took one clip of a linked group on its own. */
  const tookAlone = (clipId: string, alone: boolean | undefined): boolean => alone === true && linkedIds(t, clipId).length > 1
  const leftLinked = (what: string): string =>
    `${what} this clip only: the clips linked to it were left as they were, because it was selected on its own with Alt. Click somewhere empty and then click it, without Alt, to take the whole group.`
  switch (e.kind) {
    case 'split':
      return e.clipId !== undefined && tookAlone(e.clipId, e.alone) ? leftLinked('Cut') : null
    case 'moveClip':
      return tookAlone(e.clipId, e.alone) && !e.insert ? leftLinked('Moved') : null
    case 'removeClip':
      return tookAlone(e.clipId, e.alone) ? leftLinked('Deleted') : null
    case 'link': {
      const n = new Set(e.clipIds.flatMap((id) => linkedIds(t, id))).size
      return n > 1 ? `Linked ${n} clips. They move, trim and cut together now.` : null
    }
    case 'setShape':
      if (e.presetId === t.presetId || allClips(t).length === 0) return null
      return `Changed the shape to ${shapeName(e.presetId)}, and reshaped every clip's crop to fit.`
    case 'applyLayoutToSource':
      return `Gave ${clips(others(e.clipId))} of this recording the same pictures.`
    case 'applySoundToSource':
      return `Gave ${clips(others(e.clipId))} of this recording the same sound.`
    case 'setFraming':
      return 'Pasted the framing onto this clip.'
    case 'setFramingOn':
      return `Pasted the framing onto ${e.clipIds.length} clips.`
    case 'setCropOn':
      return e.clipIds.length > 1 ? `Pasted the crop onto ${e.clipIds.length} clips.` : null
    case 'setCropsOn':
      return e.crops.length > 1 ? `Moved the crop onto the face in ${e.crops.length} clips.` : null
    case 'setCaptionStyle':
      if (e.style.wordsPerCaption === undefined || e.style.wordsPerCaption === t.captions.style.wordsPerCaption) return null
      return e.style.wordsPerCaption === 1 ? 'Grouped the captions again, one word at a time.' : `Grouped the captions again, ${e.style.wordsPerCaption} words at a time.`
    case 'trimToFrame':
      return trimToPlayheadWords(t, e)
    case 'regroupCaptions':
      return t.captions.clips.length === 0 ? null : 'Grouped the captions again, where a reader would pause.'
    case 'removeStretches': {
      const n = e.stretches.length
      const sec = (e.stretches.reduce((sum, s) => sum + (s.to - s.from), 0) / t.fps).toFixed(1)
      return n === 1 ? `Removed 1 pause, ${sec} s.` : `Removed ${n} pauses, ${sec} s in all.`
    }
    default:
      return null
  }
}
