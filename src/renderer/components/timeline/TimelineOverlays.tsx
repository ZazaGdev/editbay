/**
 * What is drawn across every track: the line at what a drag caught, the
 * playhead, the marked range and the pauses Remove silences found.
 */

import type { JSX } from 'react'
import { accent, meaning, pause as pauseColour } from '../../theme'
import { usePlayheadRead, type PlayheadStore } from '../../state/playheadStore'
import type { Drag } from './drag'
import type { TimelineProps } from './props'

/** The playhead's line across every track: the one thing here a tick of playback draws again. */
function PlayheadLine({ playhead, pxPerFrame }: { playhead: PlayheadStore; pxPerFrame: number }): JSX.Element {
  const left = usePlayheadRead(playhead, (frame) => frame * pxPerFrame)
  return (
    <div
      data-testid="playhead-line"
      style={{
        position: 'absolute',
        left,
        top: 0,
        bottom: 0,
        width: 1,
        background: meaning.playhead,
        pointerEvents: 'none',
        zIndex: 5
      }}
    />
  )
}

export function TimelineOverlays({ props, snapped, pxPerFrame, binDrag, drag }: {
  props: TimelineProps
  snapped: number | null
  pxPerFrame: number
  binDrag: boolean
  drag: Drag | null
}): JSX.Element {
  return (
    <>
      {/*
        What a drag caught. Snapping is silent today and an edge that
        jumps for no visible reason reads as a fault, so the line says
        what pulled it.
      */}
      {snapped !== null && (
        <div
          data-testid="snap-guide"
          data-frame={snapped}
          style={{
            position: 'absolute',
            left: snapped * pxPerFrame,
            top: 0,
            bottom: 0,
            width: 1,
            marginLeft: -0.5,
            background: meaning.attention,
            pointerEvents: 'none',
            zIndex: 6
          }}
        />
      )}

      <PlayheadLine playhead={props.playhead} pxPerFrame={pxPerFrame} />

      {/* The marked range, tinted across every track, so Delete acting on it is no surprise. */}
      {props.range && (
        <div
          data-testid="range-shade"
          data-from={props.range.from}
          data-to={props.range.to}
          style={{
            position: 'absolute',
            left: props.range.from * pxPerFrame,
            top: 0,
            bottom: 0,
            width: Math.max(2, (props.range.to - props.range.from) * pxPerFrame),
            background: accent.tint,
            outline: `1px solid ${accent.tintLine}`,
            outlineOffset: -1,
            pointerEvents: 'none',
            // Over the clips, under the playhead and the pauses.
            zIndex: 3
          }}
        />
      )}

      {props.pauses?.map((p) => (
        <div
          key={p.from}
          data-testid="pause"
          data-from={p.from}
          data-to={p.to}
          data-kept={p.kept ? 'yes' : 'no'}
          data-blocked={p.blocked ? 'yes' : 'no'}
          title={
            p.kept
              ? 'Kept. Click to take this pause out after all.'
              : p.blocked
                ? "This pause stays: a clip left whole across it, such as a voice over, would push a recording's sound out of step. Click to keep it."
                : 'A pause to take out. Click to keep it.'
          }
          onClick={() => props.onTogglePause?.(p.from)}
          style={{
            position: 'absolute',
            left: p.from * pxPerFrame,
            top: 0,
            bottom: 0,
            width: Math.max(2, (p.to - p.from) * pxPerFrame),
            background: p.kept ? pauseColour.kept : p.blocked ? pauseColour.blocked : pauseColour.cut,
            outline: p.kept
              ? `1px dashed ${pauseColour.keptLine}`
              : p.blocked
                ? `1px dashed ${pauseColour.blockedLine}`
                : `1px solid ${pauseColour.cutLine}`,
            outlineOffset: -1,
            cursor: 'pointer',
            // Out of the way of a clip or a source being dragged, so it lands on the track underneath.
            pointerEvents: binDrag || drag !== null ? 'none' : undefined,
            // Over the clips, under the playhead.
            zIndex: 4
          }}
        />
      ))}
    </>
  )
}
