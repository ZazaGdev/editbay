import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent, type RefObject } from 'react'
import { hasPicture, markedSpan, sourceFrames, type ProjectMedia } from '../../shared/project'
import { filmstripLayout, stripTiles, tileFit, tileHeight, tileIndexForTime } from '../../shared/filmstrip'
import { fileUrl } from '../../shared/file-url'
import { formatTimecode } from '../../shared/time'
import { loudestPeaks } from '../../shared/sound'
import type { PeaksData } from '../../shared/types'
import { surface, ink, accent, meaning, track as trackColour, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Waveform } from './Waveform'
import { HelpTip } from '../ui/HelpTip'

/** How tall the strip under the frame is, and how much of it the waveform takes. */
const STRIP_HEIGHT = 78
const WAVE_HEIGHT = 18

/**
 * How still the pointer has to be before the real frame is fetched, in
 * milliseconds. Long enough that sweeping the whole strip asks for nothing,
 * short enough that stopping to look does not feel like waiting.
 */
const SETTLE_MS = 140

/**
 * A recording looked through before it lands: the frame under the pointer, the
 * whole of it as a filmstrip, and In and Out marked on it.
 *
 * Add to timeline puts all 28 minutes on V1 and you cut it down from there.
 * This is the other order, the one Resolve's source tape and Final Cut's
 * skimmer both take: look first, mark the part worth having, and put that on.
 *
 * While the pointer moves, the frame shown is a tile of the filmstrip already
 * loaded, not the real frame of the file. A real frame on every movement means
 * seeking a player through a 28 minute file over and over, which is the
 * opposite of skimming.
 *
 * A tile is 160 pixels wide though, and this box is several hundred, so what
 * the sweep shows is soft. So the pointer stopping for a moment fetches the
 * real frame and lays it over the tile, at the file's own resolution. Moving
 * again takes it away at once. The tile is underneath the whole time and is
 * never waited on: a seek that is slow, or that never lands, costs nothing but
 * the sharpening.
 */
export function SourceStrip(props: {
  media: ProjectMedia
  fps: number
  /** Every waveform loaded so far. The loudest of this recording's is the one drawn. */
  peaks: Map<string, PeaksData>
  /** Mark In or Out at a frame of the recording, or clear one with null. */
  onMark: (marks: { in?: number | null; out?: number | null }) => void
  /** Put the marked part, or the whole recording, at the end of V1. */
  onAdd: (whole: boolean) => void
  onClose: () => void
}): JSX.Element {
  const { media, fps } = props
  const strip = useRef<HTMLDivElement>(null)
  const frameBox = useRef<HTMLDivElement>(null)
  const stripSize = useBoxSize(strip)
  const frameSize = useBoxSize(frameBox)
  const frames = sourceFrames(media, fps)
  const span = markedSpan(media, fps)
  const marked = media.markIn !== undefined || media.markOut !== undefined
  /** Where the pointer is on the strip, in frames of the recording. */
  const [at, setAt] = useState(0)
  /**
   * The same frame, read by the keys. A key pressed in the same breath as the
   * movement that chose the frame would otherwise mark the frame before it:
   * the handler holds whatever the last render closed over, and a render has
   * not happened yet.
   */
  const atNow = useRef(0)
  atNow.current = at

  // I and O mark, as they trim on the timeline, and Escape closes. Taken here
  // while this is open, so the editor behind never sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        props.onClose()
        return
      }
      if (e.code !== 'KeyI' && e.code !== 'KeyO') return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const here = atNow.current
      const edge = e.code === 'KeyI' ? 'in' : 'out'
      const wanted = edge === 'in' ? here : here + 1
      const had = edge === 'in' ? media.markIn : media.markOut
      // The same key on the same frame again clears it.
      props.onMark({ [edge]: had !== undefined && had === wanted ? null : wanted })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props, media.markIn, media.markOut])

  /** Sound on its own, or a recording whose strip never got made: the box has no frame to show. */
  const noPicture = media.filmstripPath === '' || !hasPicture(media)

  const layout = filmstripLayout(media.durationSec)
  const tileH = tileHeight(layout.tileWidth, media.width, media.height)
  const stripUrl = fileUrl(media.filmstripPath)

  /** How tall the pictures on the strip are, and how wide one of them is there. */
  const tileLaneH = noPicture ? 0 : STRIP_HEIGHT - 2 - WAVE_HEIGHT
  const tileLaneW = media.height > 0 ? Math.max(8, Math.round((tileLaneH * media.width) / media.height)) : 8
  const tiles = noPicture ? [] : stripTiles(layout, media.durationSec, stripSize.w, tileLaneW)

  const frameAt = (e: MouseEvent<HTMLDivElement>): number => {
    const r = strip.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return Math.max(0, Math.min(frames - 1, Math.round(((e.clientX - r.left) / r.width) * frames)))
  }

  /**
   * The real frame, laid over the tile once the pointer has been still for a
   * beat. Null while it is moving, so what is on screen never claims to be a
   * frame the pointer has already left.
   */
  const player = useRef<HTMLVideoElement>(null)
  const [sharpAt, setSharpAt] = useState<number | null>(null)
  const settle = useRef(0)

  useEffect(() => {
    if (noPicture) return
    window.clearTimeout(settle.current)
    // Moving: the tile is the picture again, immediately.
    setSharpAt(null)
    settle.current = window.setTimeout(() => {
      const el = player.current
      if (!el) return
      const seconds = Math.min(media.durationSec, Math.max(0, at / fps))
      const show = (): void => setSharpAt(at)
      // `seeked` fires once the frame is decoded and drawable. A file that
      // cannot seek there simply never fires it and the tile stays up.
      el.addEventListener('seeked', show, { once: true })
      el.currentTime = seconds
      // Already exactly there, so no seek happens and no event comes.
      if (Math.abs(el.currentTime - seconds) < 0.001 && el.readyState >= 2) {
        el.removeEventListener('seeked', show)
        show()
      }
    }, SETTLE_MS)
    return () => window.clearTimeout(settle.current)
  }, [at, fps, media.durationSec, noPicture])

  // The skim player loads its whole recording ahead, and a video taken out of
  // the page keeps its file and its decoder until it is emptied, so closing
  // the strip lets go of both, as the preview's own players do. Held from
  // when it appeared: by the time this runs the ref has already let go.
  useEffect(() => {
    const el = player.current
    if (!el) return
    return () => {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }, [noPicture])

  const percent = (frame: number): string => `${(frame / frames) * 100}%`
  // Scanning every waveform of the recording is not free, and the pointer
  // re-renders this on every movement, so it is worked out once per load.
  const wave = useMemo(() => loudestPeaks(props.peaks, media.id), [props.peaks, media.id])

  return (
    <div
      data-testid="source-strip"
      data-media-id={media.id}
      data-at={at}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
        padding: space.md,
        boxSizing: 'border-box',
        background: surface.well
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
        <span
          style={{
            font: type.label,
            letterSpacing: type.labelTracking,
            color: ink.muted,
            padding: '2px 8px',
            borderRadius: radius.chip,
            background: surface.overlay
          }}
        >
          SKIMMING
        </span>
        <span style={{ font: type.body, color: ink.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {media.originalPath.split(/[\\/]/).pop()}
        </span>
        <span data-testid="source-at" style={{ font: type.mono, fontVariantNumeric: 'tabular-nums', color: ink.secondary }}>
          {formatTimecode(at, fps)}
        </span>
        <span style={{ flexGrow: 1 }} />
        <Button testid="source-mark-in" size="small" onClick={() => props.onMark({ in: at })} title="Mark In here (I)">
          Mark in
        </Button>
        <Button testid="source-mark-out" size="small" onClick={() => props.onMark({ out: at + 1 })} title="Mark Out here (O)">
          Mark out
        </Button>
        <IconButton icon="close" label="Stop skimming" testid="source-close" size="small" variant="ghost" onClick={props.onClose} />
      </div>

      {/* The frame under the pointer, as big as there is room for. */}
      <div
        ref={frameBox}
        data-testid="source-frame"
        data-sharp={noPicture ? 'no' : sharpAt === at ? 'yes' : 'no'}
        style={{
          flexGrow: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.control,
          border: `1px solid ${surface.lineStrong}`,
          background: surface.canvas,
          backgroundImage: noPicture ? 'none' : `url("${stripUrl}")`,
          backgroundRepeat: 'no-repeat',
          overflow: 'hidden',
          // One tile of the sheet, whole, in the middle of the box. Contained
          // rather than filling it: a crop judged against a stretched picture
          // is the wrong crop.
          ...tileFit(layout, tileIndexForTime(layout, at / fps, media.durationSec), tileH, frameSize.w, frameSize.h, 'contain')
        }}
      >
        {/*
          The real frame, over the tile. Contained to match the tile exactly,
          so the sharpening is a change of quality and not of shape. Muted and
          never played: it exists to be seeked, and the Monitor's own player
          behind this is a different element and is left alone.
        */}
        {!noPicture && (
          <video
            ref={player}
            data-testid="source-sharp"
            src={fileUrl(media.playablePath)}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: sharpAt === at ? 1 : 0,
              pointerEvents: 'none'
            }}
          />
        )}
        {noPicture && (
          <span style={{ font: type.body, color: ink.muted }}>Nothing to look at. Mark this one by its shape below.</span>
        )}
      </div>

      {/* The whole recording: the marked part banded, the skimmer where the pointer is. */}
      <div
        ref={strip}
        data-testid="source-filmstrip"
        onMouseMove={(e) => {
          const frame = frameAt(e)
          atNow.current = frame
          setAt(frame)
        }}
        style={{
          flexShrink: 0,
          position: 'relative',
          height: STRIP_HEIGHT,
          boxSizing: 'border-box',
          borderRadius: radius.control,
          border: `1px solid ${surface.lineStrong}`,
          background: surface.canvas,
          overflow: 'hidden',
          cursor: 'crosshair'
        }}
      >
        {/* The recording itself, as many pictures as fit across it. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: tileLaneH,
            display: 'flex',
            pointerEvents: 'none'
          }}
        >
          {tiles.map((index, i) => (
            <span
              key={i}
              data-testid="source-tile"
              data-tile={index}
              style={{
                flexGrow: 1,
                flexBasis: 0,
                minWidth: 0,
                backgroundImage: `url("${stripUrl}")`,
                backgroundRepeat: 'no-repeat',
                ...tileFit(layout, index, tileH, stripSize.w / Math.max(1, tiles.length), tileLaneH, 'cover')
              }}
            />
          ))}
        </span>
        {marked && (
          <span
            data-testid="source-marked"
            data-from={span.from}
            data-to={span.to}
            style={{
              position: 'absolute',
              left: percent(span.from),
              width: percent(span.to - span.from),
              top: 0,
              bottom: 0,
              background: accent.band,
              borderLeft: `2px solid ${accent.base}`,
              borderRight: `2px solid ${accent.base}`,
              boxSizing: 'border-box',
              pointerEvents: 'none'
            }}
          />
        )}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: percent(at),
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: meaning.playhead,
            pointerEvents: 'none'
          }}
        />
        <span
          aria-hidden="true"
          data-testid="source-wave"
          data-heard={wave ? 'yes' : 'no'}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: WAVE_HEIGHT,
            background: surface.overlay,
            pointerEvents: 'none'
          }}
        >
          <Waveform
            data={wave}
            startSec={0}
            endSec={media.durationSec}
            width={Math.max(1, stripSize.w)}
            height={WAVE_HEIGHT}
            color={trackColour.sound}
          />
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
        <HelpTip text="Move across the strip to skim it. I and O mark the part worth having." tutorial="650-skim-before-adding" />
        <span
          data-testid="source-marked-length"
          data-frames={span.to - span.from}
          style={{ font: type.mono, fontVariantNumeric: 'tabular-nums', color: ink.primary }}
        >
          {formatTimecode(span.to - span.from, fps)}
        </span>
        <span style={{ flexGrow: 1 }} />
        {marked && (
          <Button testid="source-add-whole" size="small" onClick={() => props.onAdd(true)}>
            Add the whole {formatTimecode(frames, fps)}
          </Button>
        )}
        <Button testid="source-add" variant="primary" size="small" icon="add" onClick={() => props.onAdd(false)}>
          {marked ? `Add the marked ${formatTimecode(span.to - span.from, fps)}` : 'Add to timeline'}
        </Button>
      </div>
    </div>
  )
}

/**
 * How big a box is on screen, kept up to date as the window is resized.
 *
 * A tile of a sprite sheet cannot be fitted to a box in CSS alone: the shape
 * has to be worked out in pixels, so the pixels have to be known.
 */
function useBoxSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      // Half a pixel either way is not worth a render.
      setSize((was) => (Math.abs(was.w - r.width) < 0.5 && Math.abs(was.h - r.height) < 0.5 ? was : { w: r.width, h: r.height }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [ref])
  return size
}
