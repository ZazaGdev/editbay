import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { formatLevelDb } from '../../shared/sound'
import { surface, ink, meaning, motion, radius, type } from '../theme'

/** Above this the fill turns amber, and above the second it turns to the stop colour. */
const WARM = 0.7
const HOT = 0.9
/** How long the highest reading stays up before it falls back, in milliseconds. */
const HOLD_MS = 900

/** The colour a level is drawn in: green, amber near the top, the stop colour at it. */
function toneOf(level: number): string {
  if (level >= HOT) return meaning.stop
  if (level >= WARM) return meaning.attention
  return meaning.done
}

/**
 * How loud the sound is where the playhead is.
 *
 * It is not a progress bar: it runs green, turns amber near the top and takes
 * the stop colour at it, and it holds its highest reading for most of a second
 * before falling back, so a peak can be seen rather than guessed at. Playing,
 * the readings arrive a frame at a time and the loudest one would otherwise be
 * gone before it could be read.
 *
 * It says LEVEL beside itself, and its reading is in decibels. A bare bar with
 * a percentage on it was taken for the preview volume, which sits next to it
 * and is a different thing entirely: this is the level the project has and the
 * level that gets exported, and it is not something you can set.
 *
 * Null is not zero. Nothing is heard at the playhead, or the waveform of what
 * is has not loaded: the bar is drawn empty and says so, rather than claiming
 * silence.
 */
export function LevelMeter(props: {
  /** 0 to 1, or null when there is nothing to say. */
  level: number | null
  testid?: string | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const [held, setHeld] = useState(0)
  /** When the level was first seen below the peak that is up, or null while it is not. */
  const fellAt = useRef<number | null>(null)

  useEffect(() => {
    const level = props.level ?? 0
    if (level >= held) {
      // Still at the peak, or above it: the peak is now this one.
      fellAt.current = null
      setHeld(level)
      return
    }
    // Below it. The hold runs from the first reading under the peak, not from
    // each one after: every frame of a quiet passage is a new lower reading,
    // and starting again on each would leave the peak up for good.
    const now = Date.now()
    if (fellAt.current === null) fellAt.current = now
    const left = HOLD_MS - (now - fellAt.current)
    const drop = (): void => {
      fellAt.current = null
      setHeld(level)
    }
    if (left <= 0) {
      drop()
      return
    }
    const timer = window.setTimeout(drop, left)
    return () => window.clearTimeout(timer)
  }, [props.level, held])

  const level = props.level
  const known = level !== null
  const shown = known ? Math.max(0, Math.min(1, held)) : 0

  return (
    <span
      data-testid={props.testid}
      data-level={known ? level.toFixed(3) : ''}
      data-held={shown.toFixed(3)}
      role="meter"
      aria-label="How loud the sound is at the playhead"
      aria-valuenow={Math.round(shown * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={formatLevelDb(known ? shown : null)}
      title={
        known
          ? 'How loud the sound is at the playhead, as the sequence has it. This is the level that gets exported, not what your speakers give.'
          : 'Nothing is heard at the playhead'
      }
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...props.style }}
    >
      <span
        aria-hidden="true"
        style={{ font: type.label, letterSpacing: type.labelTracking, color: ink.muted }}
      >
        LEVEL
      </span>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 56,
          height: 6,
          background: surface.sunken,
          border: `1px solid ${surface.line}`,
          borderRadius: radius.round,
          overflow: 'hidden',
          boxSizing: 'border-box',
          // The marks the amber and the red begin at, so the scale can be read.
          backgroundImage: `linear-gradient(to right, transparent ${WARM * 100}%, ${surface.lineStrong} ${WARM * 100}%, ${surface.lineStrong} calc(${WARM * 100}% + 1px), transparent calc(${WARM * 100}% + 1px))`
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${shown * 100}%`,
            height: '100%',
            background: toneOf(shown),
            transition: `width ${motion.quick} ${motion.easeOut}, background ${motion.quick} ${motion.easeOut}`
          }}
        />
      </span>
      <span
        data-testid={props.testid ? `${props.testid}-reading` : undefined}
        style={{ font: type.monoSmall, fontVariantNumeric: 'tabular-nums', color: ink.muted, minWidth: 52, textAlign: 'right' }}
      >
        {formatLevelDb(known ? shown : null)}
      </span>
    </span>
  )
}
