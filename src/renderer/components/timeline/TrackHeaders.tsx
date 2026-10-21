/**
 * The column of track names beside the tracks: the corner under the ruler,
 * the caption track, and each track with its lock, eye, mute and solo.
 */

import type { JSX, RefObject } from 'react'
import type { Timeline as TimelineData, TrackKind } from '../../../shared/project'
import { newId } from '../../../shared/project'
import { trackLabel } from '../../../shared/project'
import { whatTrackCarries } from '../../../shared/clip-name'
import { captionAt } from '../../../shared/captions'
import { surface, track as trackColour } from '../../theme'
import { Button } from '../../ui/Button'
import { HEADER_WIDTH, TrackHeader } from '../TrackHeader'
import { RULER_HEIGHT } from '../Ruler'
import { CAPTION_TRACK_HEIGHT } from '../CaptionTrack'
import { LANE_HEIGHT } from './drag'
import type { TimelineProps } from './props'

const LABEL_WIDTH = HEADER_WIDTH

export function TrackHeaders({ props, t, heightOf, cornerPin, captioned, lanesShown, videoOrder }: {
  props: TimelineProps
  t: TimelineData
  heightOf: (trackId: string, kind: TrackKind) => number
  cornerPin: RefObject<HTMLDivElement | null>
  captioned: boolean
  lanesShown: (kind: TrackKind) => boolean
  videoOrder: number[]
}): JSX.Element {
  /**
   * A track's header. V1 and A1 never go: every sequence keeps one of each,
   * and a track with anything on it has to be emptied first, so the menu says
   * which of the two it is rather than offering a dead command.
   */
  const trackHeader = (kind: TrackKind, index: number): JSX.Element => {
    const track = kind === 'video' ? t.videoTracks[index]! : t.audioTracks[index]!
    const name = trackLabel(t, track.id)
    const canGo = index > 0 && track.clips.length === 0
    return (
      <TrackHeader
        key={track.id}
        trackId={track.id}
        name={name}
        carries={whatTrackCarries(t, track.id)}
        colour={kind === 'video' ? trackColour.picture : trackColour.sound}
        height={heightOf(track.id, kind)}
        {...(props.onTrackHeight ? { onHeight: (px: number) => props.onTrackHeight?.(track.id, px) } : {})}
        whyNotRemove={index === 0 ? `Every sequence keeps ${name}` : 'Take what is on it away first'}
        locked={track.locked === true}
        onLocked={(locked) => props.onEdit({ kind: 'setTrackLocked', trackId: track.id, locked })}
        onName={(given) => props.onEdit({ kind: 'setTrackName', trackId: track.id, name: given })}
        nameGiven={track.name ?? ''}
        {...(kind === 'video'
          ? {
              hidden: track.hidden === true,
              onHidden: (hidden: boolean) => props.onEdit({ kind: 'setTrackHidden', trackId: track.id, hidden })
            }
          : {})}
        {...(kind === 'audio'
          ? {
              muted: track.muted === true,
              onMuted: (muted: boolean) => props.onEdit({ kind: 'setTrackMuted', trackId: track.id, muted }),
              solo: props.solo.has(track.id),
              onSolo: (on: boolean) => props.onSolo(track.id, on),
              duck: track.duck === true,
              onDuck: (duck: boolean) => props.onEdit({ kind: 'setTrackDuck', trackId: track.id, duck })
            }
          : {})}
        {...(canGo ? { onRemove: () => props.onEdit({ kind: 'removeTrack', trackId: track.id }) } : {})}
      />
    )
  }
  /**
   * Beside the empty lane past the last track of a kind, while there is room
   * for another: the button that adds one there, above the video tracks or
   * below the audio ones (task 62).
   */
  const laneLabel = (kind: TrackKind): JSX.Element | null =>
    lanesShown(kind) ? (
      <div key={`lane-label-${kind}`} style={{ height: LANE_HEIGHT, display: 'flex', alignItems: 'center', padding: '0 4px', boxSizing: 'border-box' }}>
        <Button
          testid={kind === 'video' ? 'add-video-track' : 'add-audio-track'}
          size="small"
          variant="ghost"
          icon="add"
          title={props.addTrackTitles[kind]}
          onClick={() => props.onEdit({ kind: 'addTrack', trackKind: kind, trackId: newId() })}
          style={{ height: 20, padding: '0 6px' }}
        >
          {kind === 'video' ? 'Video track' : 'Audio track'}
        </Button>
      </div>
    ) : null

  return (
    <div data-testid="track-headers" style={{ flex: `0 0 ${LABEL_WIDTH}px` }}>
      <div ref={cornerPin} data-testid="ruler-corner" style={{ height: RULER_HEIGHT, position: 'relative', zIndex: 4, background: surface.raised }} />
      {captioned && (
        <TrackHeader key="captions" name="Captions" carries="words" colour={trackColour.camera} height={CAPTION_TRACK_HEIGHT}>
          <Button
            testid="caption-style-open"
            size="small"
            variant="ghost"
            title="How captions look: selects the caption at the playhead"
            onClick={() => {
              const c = captionAt(t.captions.clips, props.playhead.get()) ?? t.captions.clips[0]
              if (c) props.onSelectCaption(c.id)
            }}
            style={{ height: 18, padding: '0 5px' }}
          >
            Aa
          </Button>
        </TrackHeader>
      )}
      {laneLabel('video')}
      {videoOrder.map((i) => trackHeader('video', i))}
      {t.audioTracks.map((_, i) => trackHeader('audio', i))}
      {laneLabel('audio')}
    </div>
  )
}
