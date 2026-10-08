/**
 * Plan 96: a clip saved into the assets folder, as it plays. What is saved is
 * the clips asked for and nothing else: a timeline that holds only them, over
 * the stretch they cover, and which of the assets folder's parts it goes to.
 */

import type { Timeline } from './project'
import { isStill } from './drawn-media'
import { spanEnd } from './tracks'

export type AssetKind = 'video' | 'audio' | 'image'

/** The folders Editbay makes inside the assets folder, and which one each kind of asset goes to. */
export const ASSET_FOLDERS: Record<AssetKind, string> = { video: 'Video', audio: 'Audio', image: 'Images' }

export interface AssetCut {
  /** The timeline with only the clips being saved, and no captions. */
  timeline: Timeline
  /** The frames they cover, `to` not included. */
  from: number
  to: number
  kind: AssetKind
  /** Whether any sound is saved with it. */
  sound: boolean
}

/**
 * The clips as one asset: a video clip with the sound clips saved beside it
 * is a video with its sound, a video clip alone a video, a still picture
 * alone an image, and sound alone a sound. Null when none of them is on the
 * timeline.
 */
export function assetCut(t: Timeline, clipIds: readonly string[]): AssetCut | null {
  const want = new Set(clipIds)
  const videoTracks = t.videoTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => want.has(c.id)) }))
  const audioTracks = t.audioTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => want.has(c.id)) }))
  const pictures = videoTracks.flatMap((r) => r.clips)
  const sounds = audioTracks.flatMap((r) => r.clips)
  const all = [...pictures, ...sounds]
  if (all.length === 0) return null
  const from = Math.min(...all.map((c) => c.timelineStart))
  const to = Math.max(...all.map((c) => spanEnd(c)))
  const still = pictures.length === 1 && sounds.length === 0 && isStill(t.media.find((m) => m.id === pictures[0]!.mediaId) ?? {})
  const kind: AssetKind = pictures.length === 0 ? 'audio' : still ? 'image' : 'video'
  return { timeline: { ...t, videoTracks, audioTracks, captions: { ...t.captions, clips: [] } }, from, to, kind, sound: sounds.length > 0 }
}
