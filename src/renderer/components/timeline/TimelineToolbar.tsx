/**
 * The timeline's header: the sequence tabs, what you add at the playhead, the
 * timecode and the range, and the buttons for tracks, snapping, Fit, track
 * size and zoom.
 */

import type { JSX } from 'react'
import type { Timeline as TimelineData } from '../../../shared/project'
import { TRACK_SIZES, type TrackSize } from '../../../shared/timeline-layout'
import { formatTimecode } from '../../../shared/time'
import { accent, ink, radius, space, type } from '../../theme'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { SectionLabel } from '../../ui/SectionLabel'
import { ShapeMenu } from '../ShapeMenu'
import type { TimelineProps } from './props'

/** What a track size is called, for the button that steps through them. */
function sizeName(size: TrackSize): string {
  return TRACK_SIZES.find((s) => s.id === size)?.name ?? size
}

export function TimelineToolbar({ props, t, total }: { props: TimelineProps; t: TimelineData; total: number }): JSX.Element {
  // Onto a second line when the timeline is narrow, as it is with sections beside it (plan 92), rather than cut off at its right end.
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, rowGap: space.xs }}>
      {props.header ?? (
        <SectionLabel>Timeline</SectionLabel>
      )}
      {/* What you add to the timeline itself, at the playhead, apart from how it is viewed on the right. */}
      {(props.onAddText || props.onAddBlackScreen) && (
        <span style={{ display: 'flex', gap: space.xs }}>
          {props.onAddText && (
            <IconButton icon="text" label="Add text over the video, at the playhead (T)" testid="add-text" size="small" onClick={props.onAddText} />
          )}
          {props.shapes && <ShapeMenu saved={props.shapes.saved} onPick={props.shapes.onPick} onRemoveSaved={props.shapes.onRemoveSaved} />}
          {props.onAddBlackScreen && (
            <IconButton
              icon="blackScreen"
              label="Add a black screen at the playhead, for an end card (Shift+B)"
              testid="add-black-screen"
              size="small"
              onClick={props.onAddBlackScreen}
            />
          )}
        </span>
      )}
      <span
        data-testid="timecode"
        data-playhead={props.playhead}
        data-total={total}
        style={{ font: type.mono, fontVariantNumeric: 'tabular-nums', color: ink.secondary }}
      >
        {formatTimecode(props.playhead, t.fps)} / {formatTimecode(total, t.fps)}
      </span>
      {props.range && (
        <span
          data-testid="range-length"
          data-from={props.range.from}
          data-to={props.range.to}
          title="The range marked with In and Out. Delete takes it out."
          style={{
            font: type.mono,
            fontVariantNumeric: 'tabular-nums',
            color: accent.bright,
            padding: `1px ${space.sm}px`,
            borderRadius: radius.chip,
            background: accent.wash,
            border: `1px solid ${accent.washLine}`
          }}
        >
          Range {formatTimecode(props.range.to - props.range.from, t.fps)}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: space.xs }}>
        <Button
          testid="remove-silences"
          size="small"
          icon="sound"
          disabled={!props.canRemoveSilences}
          whyDisabled="Put a clip on V1 first: the pauses are found in its talking"
          onClick={props.onRemoveSilences}
          title={props.removeSilencesTitle}
        >
          Remove silences
        </Button>
        {/* Named after the row it brings back, and pressed while that row is
            up, so it says which way it is now as well as what it does. */}
        <Button
          testid="overview-toggle"
          size="small"
          pressed={props.overview}
          onClick={() => props.onOverview(!props.overview)}
          title={
            props.overview
              ? 'Hide the strip showing the whole edit'
              : 'Show the strip showing the whole edit, above the ruler'
          }
        >
          ALL
        </Button>
        <Button
          testid="timeline-snap"
          size="small"
          icon="snap"
          pressed={props.snapping}
          onClick={() => props.onSnapping(!props.snapping)}
          title={props.snapTitle ?? (props.snapping ? 'Snapping is on: press to turn it off' : 'Snapping is off: press to turn it on')}
        >
          Snap
        </Button>
        <Button testid="timeline-fit" size="small" icon="fullScreen" onClick={props.onFit} title={props.fitTitle}>
          Fit
        </Button>
        <Button
          testid="track-size"
          size="small"
          data={{ 'data-size': props.trackSize }}
          onClick={props.onTrackSize}
          title={`Tracks are ${sizeName(props.trackSize)}. Press for the next size.`}
        >
          {sizeName(props.trackSize)}
        </Button>
        <IconButton
          icon="remove"
          label="Zoom out"
          testid="zoom-out"
          data={{ 'data-zoom': String(props.zoom) }}
          size="small"
          onClick={() => props.onZoom(-1)}
        />
        <IconButton icon="add" label="Zoom in" testid="zoom-in" size="small" onClick={() => props.onZoom(1)} />
      </span>
    </header>
  )
}
