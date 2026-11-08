/**
 * A track whose header was clicked (task 2612): what its header already sets,
 * in the Inspector, and nothing more. Its name, Lock, and Hide for a video
 * track or Mute, Solo and Duck for an audio one. The caption track's setting
 * is how captions look, which its button opens.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { Timeline } from '../../shared/project'
import { trackLabel, trackOf } from '../../shared/project'
import { whatTrackCarries } from '../../shared/clip-name'
import { MAX_TRACK_NAME } from '../../shared/tracks'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Field } from '../ui/Field'
import { dim, heading, row } from './inspector-parts'
import type { Edit } from './inspector-parts'

export function TrackPanel(props: {
  timeline: Timeline
  /** A track's id, or 'captions' for the caption track. */
  trackId: string
  onEdit: Edit
  /** The tracks heard alone, in the preview only. */
  solo?: ReadonlySet<string> | undefined
  onSolo?: ((trackId: string, on: boolean) => void) | undefined
  /** Open how captions look, as the caption header's Aa does. */
  onCaptionLook?: (() => void) | undefined
}): JSX.Element | null {
  const t = props.timeline
  const found = props.trackId === 'captions' ? null : trackOf(t, props.trackId)
  const given = found?.track.name ?? ''
  const [typing, setTyping] = useState(given)
  const sent = useRef<string | null>(null)
  useEffect(() => {
    setTyping(given)
    sent.current = null
  }, [given, props.trackId])

  if (props.trackId === 'captions') {
    return (
      <section data-testid="track-panel" data-track="Captions">
        {heading('Captions')}
        <div style={row}>
          <span style={dim}>Carries</span>
          <span>{t.captions.clips.length} captions</span>
        </div>
        <Button testid="track-panel-caption-look" size="small" onClick={() => props.onCaptionLook?.()} style={{ marginTop: 6 }}>
          How captions look
        </Button>
      </section>
    )
  }
  if (!found) return null
  const { track, kind } = found
  const id = track.id
  const name = trackLabel(t, id)
  // Enter keeps the name and hands focus back, and leaving the box keeps it
  // too: once, not twice, before the project has the new name.
  const keep = (value: string): void => {
    if (value === given || value === sent.current) return
    sent.current = value
    props.onEdit({ kind: 'setTrackName', trackId: id, name: value })
  }

  return (
    <section data-testid="track-panel" data-track={name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {heading(kind === 'video' ? 'Video track' : 'Audio track')}
      <div style={row}>
        <span style={dim}>Carries</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{whatTrackCarries(t, id)}</span>
      </div>
      <Field
        label="Name"
        testid="track-panel-name"
        value={typing}
        placeholder={name}
        onChange={(v) => setTyping(v.slice(0, MAX_TRACK_NAME))}
        onCommit={keep}
        onEscape={() => setTyping(given)}
      />
      <Check testid="track-panel-lock" checked={track.locked === true} onChange={(locked) => props.onEdit({ kind: 'setTrackLocked', trackId: id, locked })}>
        Locked against every edit
      </Check>
      {kind === 'video' && (
        <Check testid="track-panel-hide" checked={track.hidden === true} onChange={(hidden) => props.onEdit({ kind: 'setTrackHidden', trackId: id, hidden })}>
          Hidden, here and in the export
        </Check>
      )}
      {kind === 'audio' && (
        <>
          <Check testid="track-panel-mute" checked={track.muted === true} onChange={(muted) => props.onEdit({ kind: 'setTrackMuted', trackId: id, muted })}>
            Muted, here and in the export
          </Check>
          {props.onSolo && (
            <Check testid="track-panel-solo" checked={props.solo?.has(id) === true} onChange={(on) => props.onSolo?.(id, on)}>
              Solo, in the preview only
            </Check>
          )}
          <Check testid="track-panel-duck" checked={track.duck === true} onChange={(duck) => props.onEdit({ kind: 'setTrackDuck', trackId: id, duck })}>
            Duck under the other tracks
          </Check>
        </>
      )}
    </section>
  )
}
