/**
 * The column of track names beside the tracks: the corner under the ruler,
 * the caption track, and each track with its lock, eye, mute and solo.
 */

import { useRef, useState, type JSX, type RefObject } from 'react'
import type { Timeline as TimelineData, TrackKind } from '../../../shared/project'
import { newId } from '../../../shared/project'
import { CAPTION_TRACK_ID, captionsAbove, trackLabel } from '../../../shared/project'
import { whatTrackCarries } from '../../../shared/clip-name'
import { captionAt } from '../../../shared/captions'
import { accent, surface, track as trackColour } from '../../theme'
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
  const column = useRef<HTMLDivElement>(null)
  /** Where a header being dragged would put its track, as a line across the column. */
  const [landing, setLanding] = useState<number | null>(null)
  /**
   * A header dragged up or down (task 2613): its track lands among the tracks
   * of its own kind, before the first header whose middle is below the
   * pointer. The video headers run V1 at the bottom, so their place counts up
   * from there.
   */
  const dragTrack = (kind: TrackKind, trackId: string) => (clientY: number | null, end: boolean): void => {
    const box = column.current
    if (!box || clientY === null) return setLanding(null)
    // The caption track is one of the pictures' tracks while it is there (task 2621).
    const ids = kind === 'video' ? [...t.videoTracks.map((r) => r.id), ...(captioned ? [CAPTION_TRACK_ID] : [])] : t.audioTracks.map((r) => r.id)
    const others = ids
      .filter((id) => id !== trackId)
      .map((id) => box.querySelector<HTMLElement>(`[data-testid="track-header"][data-track-id="${CSS.escape(id)}"]`)?.getBoundingClientRect())
      .filter((r): r is DOMRect => r !== undefined)
      .sort((a, b) => a.top - b.top)
    if (others.length === 0) return setLanding(null)
    const above = others.filter((r) => r.top + r.height / 2 < clientY).length
    if (end) {
      setLanding(null)
      const to = kind === 'video' ? ids.length - 1 - above : above
      if (to !== placeOf(kind, trackId)) props.onEdit({ kind: 'moveTrack', trackId, to })
      return
    }
    const top = box.getBoundingClientRect().top
    setLanding((above < others.length ? others[above]!.top : others[others.length - 1]!.bottom) - top)
  }
  /** The video tracks from V1 up, by id, with the caption track at its place among them while there is one. */
  const stack = t.videoTracks.map((r) => r.id)
  if (captioned) stack.splice(captionsAbove(t), 0, CAPTION_TRACK_ID)
  const placeOf = (kind: TrackKind, id: string): number => (kind === 'video' ? stack.indexOf(id) : t.audioTracks.findIndex((r) => r.id === id))
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
        selected={props.selectedTrackId === track.id}
        {...((kind === 'video' ? stack : t.audioTracks).length > 1 ? { onDrag: dragTrack(kind, track.id) } : {})}
        {...(props.onSelectTrack ? { onSelect: () => props.onSelectTrack?.(track.id) } : {})}
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
   * While there is room for another track of a kind: the button that adds
   * one, above the video tracks or below the audio ones (task 62). Both sit
   * in the strip beside the ruler (task 2612), where they no longer crowd the
   * header under them.
   */
  const addTrack = (kind: TrackKind): JSX.Element | null =>
    lanesShown(kind) ? (
      <Button
        testid={kind === 'video' ? 'add-video-track' : 'add-audio-track'}
        size="small"
        variant="ghost"
        icon="add"
        title={props.addTrackTitles[kind]}
        onClick={() => props.onEdit({ kind: 'addTrack', trackKind: kind, trackId: newId() })}
        style={{ height: 20, padding: '0 4px', flex: '1 1 0', minWidth: 0 }}
      >
        {kind === 'video' ? 'Video' : 'Audio'}
      </Button>
    ) : null
  /** The caption track's header, dragged up or down among the video tracks' (task 2621). */
  const captionsHeader = (): JSX.Element => (
    <TrackHeader key={CAPTION_TRACK_ID} trackId={CAPTION_TRACK_ID} name="Captions" carries="words" colour={trackColour.camera} height={CAPTION_TRACK_HEIGHT}
      selected={props.selectedTrackId === CAPTION_TRACK_ID}
      onDrag={dragTrack('video', CAPTION_TRACK_ID)}
      {...(props.onSelectTrack ? { onSelect: () => props.onSelectTrack?.(CAPTION_TRACK_ID) } : {})}
    >
      <Button
        testid="caption-style-open"
        size="small"
        variant="ghost"
        title="How captions look: selects the caption at the playhead"
        onClick={() => {
          const c = captionAt(t.captions.clips, props.playhead.get()) ?? t.captions.clips[0]
          if (c) props.onSelectCaption(c.id)
        }}
        style={{ height: 20, padding: '0 5px' }}
      >
        Aa
      </Button>
    </TrackHeader>
  )
  /** Captions over every video track, where they have always been: above the lane for a new one, as before they could move. */
  const onTop = captioned && captionsAbove(t) === t.videoTracks.length
  /** The empty lane past the last track of a kind, which the tracks beside it draw: the headers keep its room so they stay level with them. */
  const lane = (kind: TrackKind): JSX.Element | null =>
    lanesShown(kind) ? <div key={`lane-${kind}`} style={{ height: LANE_HEIGHT }} /> : null

  return (
    // Its own width and no wider, whatever it holds: the tracks beside it take the rest, and their zoom is worked out from it.
    <div ref={column} data-testid="track-headers" style={{ flex: `0 0 ${LABEL_WIDTH}px`, minWidth: LABEL_WIDTH, position: 'relative' }}>
      {landing !== null && (
        <div
          data-testid="track-landing"
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, right: 0, top: landing - 1, height: 2, background: accent.base, zIndex: 6, pointerEvents: 'none' }}
        />
      )}
      <div
        ref={cornerPin}
        data-testid="ruler-corner"
        style={{ height: RULER_HEIGHT, position: 'relative', zIndex: 4, background: surface.raised, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px', boxSizing: 'border-box' }}
      >
        {addTrack('video')}
        {addTrack('audio')}
      </div>
      {onTop && captionsHeader()}
      {lane('video')}
      {videoOrder.map((i) => [...(!onTop && captioned && i === captionsAbove(t) - 1 ? [captionsHeader()] : []), trackHeader('video', i)])}
      {!onTop && captioned && captionsAbove(t) === 0 && captionsHeader()}
      {t.audioTracks.map((_, i) => trackHeader('audio', i))}
      {lane('audio')}
    </div>
  )
}
