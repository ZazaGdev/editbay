import { useState, type JSX } from 'react'
import { MAIN_PICTURE, simpleLoses, zoomOf, type Clip, type ProjectMedia, type Timeline } from '../../shared/project'
import { hasKeys, isSimple, keysInClip } from '../../shared/zoom-edit'
import type { Keymap } from '../../shared/keymap'
import { space } from '../theme'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import type { PlayheadStore } from '../state/playheadStore'
import { KeyframeZoom } from './KeyframeZoom'
import { SimpleZoom } from './SimpleZoom'
import { CentreOnFace, FollowFace } from './FollowFace'
import { callout, note, type Edit, type ZoomTools } from './zoom-parts'

export type { PresetEdit, ZoomTools } from './zoom-parts'

/**
 * Plan 65: the Zoom group. A switch between a Simple zoom, Start and End on
 * the clip's first and last frames, and keyframes put by hand. A clip starts
 * Simple. Keyframes asked for on a clip that has none yet are remembered
 * while it stays selected, since until one is put there is nothing to store.
 */
export function ZoomGroup(props: {
  clip: Clip
  media: ProjectMedia
  timeline: Timeline
  playhead: PlayheadStore | undefined
  /** The range marked with In and Out on the sequence, `out` not included. */
  marks: { in: number | null; out: number | null }
  keymap?: Keymap | undefined
  /** The picture whose zoom this is: the main one, or a further picture's id. */
  picture: string
  /** Whether its End is chosen, for a Simple zoom, and choosing End or Start. */
  zoomEnd: boolean
  onZoomEnd: (end: boolean) => void
  /** Whether Start, End or a keyframe is picked here, so the crop box and the Crop numbers change the zoom. */
  zoomPicked: boolean
  onZoomPicked: (picked: boolean) => void
  onEdit: Edit
  onSeek: (frame: number) => void
  tools?: ZoomTools | undefined
}): JSX.Element {
  const { clip, picture } = props
  const [keysWanted, setKeysWanted] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  // Each picture has a zoom of its own, so what is asked for is remembered for the clip and picture both.
  const whose = `${clip.id}:${picture}`
  const zoom = zoomOf(clip, picture)
  // Keyframes asked for count only while the picture has none: an undo that brings a Simple zoom back shows Simple.
  const simple = zoom.simple !== undefined || (isSimple(clip, picture) && keysWanted !== whose)
  const keys = keysInClip(clip, picture)
  const own = picture === MAIN_PICTURE ? {} : { picture }
  const which = clip.layers.findIndex((l) => l.id === picture)

  const choose = (mode: 'simple' | 'keys'): void => {
    if (mode === 'keys') {
      if (!simple) return
      if (zoom.simple !== undefined) props.onEdit({ kind: 'useKeyframes', clipId: clip.id, ...own })
      else setKeysWanted(whose)
      props.onZoomEnd(false)
      return
    }
    if (simple) return
    if (simpleLoses(clip, picture)) {
      setAsking(whose)
      return
    }
    backToSimple()
  }
  const backToSimple = (): void => {
    if (hasKeys(clip, picture)) props.onEdit({ kind: 'useSimpleZoom', clipId: clip.id, ...own })
    setKeysWanted(null)
    setAsking(null)
  }
  const between = keys.filter((k) => k.at > clip.sourceIn && k.at < clip.sourceOut - 1).length

  return (
    <div
      data-testid="zoom-group"
      data-keys={keys.length}
      data-mode={simple ? 'simple' : 'keys'}
      data-picture={picture}
      style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}
    >
      {/* Every picture has its own zoom: which one this is, said where it is edited. */}
      {clip.layers.length > 0 && (
        <p data-testid="zoom-picture" style={note}>
          The zoom of <strong>{which >= 0 ? `Picture ${which + 2}` : 'Main'}</strong>.
        </p>
      )}
      <Segmented
        testid="zoom-mode"
        label="How the picture zooms"
        size="small"
        stretch
        chosen={simple ? 'simple' : 'keys'}
        onChoose={choose}
        choices={[
          { id: 'simple', label: 'Simple', title: "A Start and an End picture, on the clip's first and last frames" },
          { id: 'keys', label: 'Keyframes', title: 'Keyframes anywhere in the clip, as many as you like' }
        ]}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <FollowFace clip={clip} media={props.media} timeline={props.timeline} picture={picture} onEdit={props.onEdit} />
        <CentreOnFace clip={clip} media={props.media} timeline={props.timeline} picture={picture} onEdit={props.onEdit} />
      </div>
      {asking === whose && !simple && (
        <div data-testid="zoom-to-simple" role="alertdialog" aria-label="Go back to Simple?" style={callout}>
          <strong>Go back to Simple?</strong> This clip has {keys.length} keyframes. Simple keeps the picture on the clip&apos;s
          first frame as Start and on its last as End, and the {between} in between go. Undo brings them back.
          <div style={{ display: 'flex', gap: 4, marginTop: space.sm, flexWrap: 'wrap' }}>
            <Button testid="zoom-to-simple-yes" size="small" pressed onClick={backToSimple}>
              Use Simple
            </Button>
            <Button testid="zoom-to-simple-no" size="small" onClick={() => setAsking(null)}>
              Keep keyframes
            </Button>
          </div>
        </div>
      )}
      {simple ? (
        <SimpleZoom {...props} onKeyframes={() => choose('keys')} />
      ) : (
        <KeyframeZoom {...props} />
      )}
    </div>
  )
}
