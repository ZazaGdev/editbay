import { useEffect, useRef, useState, type JSX } from 'react'
import { MAIN_PICTURE, isStill, zoomOf, type Clip, type ProjectMedia, type Rect, type Timeline } from '../../shared/project'
import { faceCentredCrop, followFaceKeys } from '../../shared/face-follow'
import { Button } from '../ui/Button'
import { showToast } from '../state/toasts'
import type { Edit } from './zoom-parts'

/**
 * Follow face (plan 100): finds the face in the clip on this PC and puts
 * keyframes on the picture's zoom that keep it in the crop, the crop's size
 * as it is now. The face followed is the one the crop is on, so a crop put
 * roughly over someone follows them. One undo takes it all back.
 */
export function FollowFace(props: { clip: Clip; media: ProjectMedia; timeline: Timeline; picture: string; onEdit: Edit }): JSX.Element | null {
  const { clip, media, timeline, picture } = props
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  if (isStill(media) || media.hasVideo === false) return null

  const run = async (): Promise<void> => {
    const fps = timeline.fps
    setBusy(true)
    const found = await window.api.mediaFaces(clip.mediaId, clip.sourceIn / fps, clip.sourceOut / fps, fps)
    if (!live.current) return
    setBusy(false)
    if (!found.ok) {
      showToast({ kind: 'follow-face-failed', text: `Follow face could not run: ${found.message}` })
      return
    }
    const keys = followFaceKeys(found.samples, zoomOf(clip, picture).crop, media, clip, found.rate, fps)
    if (keys === null) {
      showToast({ kind: 'follow-face-none', text: 'No face found in this clip, so the crop stays where it is.' })
      return
    }
    props.onEdit({ kind: 'setZoomKeys', clipId: clip.id, keys, ...(picture === MAIN_PICTURE ? {} : { picture }) })
    showToast({ kind: 'follow-face-done', text: 'The crop now follows the face. Move any keyframe to adjust it.' })
  }

  return (
    <Button
      testid="follow-face"
      size="small"
      icon="face"
      disabled={busy}
      data={{ 'data-busy': busy ? 'yes' : 'no' }}
      title="Find the face in this clip and keyframe the crop to keep it in frame, at the crop's size. Put the crop roughly over the person first when there is more than one."
      onClick={() => void run()}
    >
      {busy ? 'Finding the face...' : 'Follow face'}
    </Button>
  )
}

/**
 * Centre on face (task 100): the same picture of every clip on the timeline,
 * Picture 2 on every clip for Picture 2, has its crop moved so the face sits
 * in its middle, one still place a clip and no keyframes, for a round picture
 * in picture of someone at a desk. The crop keeps its size. Clips with no face
 * found are left as they are. One undo takes it all back.
 */
export function CentreOnFace(props: { clip: Clip; media: ProjectMedia; timeline: Timeline; picture: string; onEdit: Edit }): JSX.Element | null {
  const { clip, media, timeline, picture } = props
  const [done, setDone] = useState<{ of: number; at: number } | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  if (isStill(media) || media.hasVideo === false) return null
  // Which picture by position, as Paste crop takes it: 0 for the main one, 1 for Picture 2.
  const which = clip.layers.findIndex((l) => l.id === picture)
  if (picture !== MAIN_PICTURE && which < 0) return null
  const slot = picture === MAIN_PICTURE ? 0 : which + 1

  const run = async (): Promise<void> => {
    const fps = timeline.fps
    const clips = timeline.videoTracks.flatMap((r) => r.clips).filter((c) => {
      const m = timeline.media.find((x) => x.id === c.mediaId)
      return m !== undefined && !isStill(m) && m.hasVideo !== false && (slot === 0 || c.layers[slot - 1] !== undefined)
    })
    const crops: { clipId: string; crop: Rect }[] = []
    let failed: string | null = null
    for (const [i, c] of clips.entries()) {
      setDone({ of: clips.length, at: i + 1 })
      const m = timeline.media.find((x) => x.id === c.mediaId)!
      const found = await window.api.mediaFaces(c.mediaId, c.sourceIn / fps, c.sourceOut / fps, fps)
      if (!live.current) return
      if (!found.ok) {
        failed = found.message
        break
      }
      const own = slot === 0 ? MAIN_PICTURE : c.layers[slot - 1]!.id
      const crop = faceCentredCrop(found.samples, zoomOf(c, own).crop, m, found.rate)
      if (crop) crops.push({ clipId: c.id, crop })
    }
    setDone(null)
    if (failed !== null) {
      showToast({ kind: 'centre-face-failed', text: `Centre on face could not run: ${failed}` })
      return
    }
    if (crops.length === 0) {
      showToast({ kind: 'centre-face-none', text: 'No face found in any clip, so every crop stays where it is.' })
      return
    }
    props.onEdit({ kind: 'setCropsOn', crops, ...(slot > 0 ? { slot } : {}) })
    const missed = clips.length - crops.length
    showToast({
      kind: 'centre-face-done',
      text: `The face is in the middle on ${crops.length === 1 ? 'one clip' : `${crops.length} clips`}.${missed > 0 ? ` No face found on ${missed === 1 ? 'one' : missed}, left as ${missed === 1 ? 'it was' : 'they were'}.` : ''}`
    })
  }

  return (
    <Button
      testid="centre-face"
      size="small"
      icon="face"
      disabled={done !== null}
      data={{ 'data-busy': done !== null ? 'yes' : 'no' }}
      title="Move this picture's crop on every clip so the face sits in its middle, one still place a clip, at the crop's size. For a round picture in picture of someone at a desk."
      onClick={() => void run()}
    >
      {done !== null ? `Centring ${done.at} of ${done.of}...` : 'Centre on face'}
    </Button>
  )
}
