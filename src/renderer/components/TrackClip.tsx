import { memo, useEffect, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { Clip, ProjectMedia, SoundClip } from '../../shared/project'
import { filmstripLayout, tileIndexForTime, tileHeight, tileRect } from '../../shared/filmstrip'
import { fileUrl } from '../../shared/file-url'
import { handleWidthFor, MIN_CLIP_WIDTH } from '../../shared/timeline-layout'
import { snapTrim, snapTrimTo } from '../../shared/tracks'
import type { PeaksData } from '../../shared/types'
import { markColour, markName } from '../../shared/marks'
import { formatTimecode } from '../../shared/time'
import { Waveform } from './Waveform'
import { ClipKeyframes } from './ClipKeyframes'
import { Icon, type IconName } from '../ui/Icon'
import { marksFit, pictureMarks, soundMarks, type ClipMark, type ClipMarkKind } from '../../shared/clip-marks'
import { COMMAND_KEY_NAME, commandKey } from '../../shared/system'
import { surface, ink, accent, meaning, danger, clip as clipColour, radius, type } from '../theme'

/**
 * Where one tile of a source's filmstrip sits, for the frame drawn above a
 * trim handle: the background size and position that show that tile alone,
 * scaled to `width`.
 */
function edgeTile(media: ProjectMedia, sourceFrame: number, fps: number, width: number): {
  backgroundSize: string
  backgroundPosition: string
} {
  const layout = filmstripLayout(media.durationSec)
  const h = tileHeight(layout.tileWidth, media.width, media.height)
  const index = tileIndexForTime(layout, Math.max(0, sourceFrame) / fps, media.durationSec)
  const tile = tileRect(layout, index, h)
  const scale = width / layout.tileWidth
  return {
    backgroundSize: `${layout.cols * layout.tileWidth * scale}px ${layout.rows * h * scale}px`,
    backgroundPosition: `${-tile.x * scale}px ${-tile.y * scale}px`
  }
}

/** How wide the frame drawn above a trim handle is. */
const EDGE_FRAME_W = 96

interface Tile {
  left: number
  width: number
  x: number
  y: number
}

/** Tiles spread across the clip's own trimmed range, at roughly one per 80 pixels. */
export function stripTiles(
  media: ProjectMedia,
  clip: { sourceIn: number; sourceOut: number },
  fps: number,
  width: number
): Tile[] {
  const layout = filmstripLayout(media.durationSec)
  const h = tileHeight(layout.tileWidth, media.width, media.height)
  const count = Math.max(1, Math.floor(width / 80))
  const startSec = clip.sourceIn / fps
  const spanSec = (clip.sourceOut - clip.sourceIn) / fps
  return Array.from({ length: count }, (_, i) => {
    const t = startSec + (spanSec * (i + 0.5)) / count
    const r = tileRect(layout, tileIndexForTime(layout, t, media.durationSec), h)
    return { left: (width * i) / count, width: width / count, x: r.x, y: r.y }
  })
}

/** Two rounded links of a chain: this clip moves with others. */

const MARK_ICONS: Record<ClipMarkKind, IconName> = { zoom: 'zoomed', look: 'look', framing: 'framing', sound: 'sound' }

/**
 * What has been done to a clip, as small marks beside its name: one each for
 * a zoom, a look, a framing and a sound worked on, each saying on hover what
 * it is. On a clip too narrow for them all, one "fx" and how many.
 */
function EffectMarks(props: { marks: ClipMark[]; width: number; onOpen: ((section: string, altKey: boolean) => void) | undefined }): JSX.Element | null {
  if (props.marks.length === 0) return null
  // A press on a mark opens the section it is about, rather than starting a
  // drag of the clip. The one "fx" opens the first.
  const open = (section: string) => (e: PointerEvent): void => {
    if (e.button !== 0 || !props.onOpen) return
    e.stopPropagation()
    props.onOpen(section, e.altKey)
  }
  if (!marksFit(props.marks.length, props.width)) {
    return (
      <span
        data-testid="clip-effects"
        data-count={props.marks.length}
        title={props.marks.map((m) => m.title).join('\n')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0, pointerEvents: 'auto' }}
      >
        <Icon name="effects" size={10} />
        {props.marks.length}
      </span>
    )
  }
  return (
    <>
      {props.marks.map((m) => (
        <span key={m.kind} data-testid="clip-mark-effect" data-effect={m.kind} title={m.title} onPointerDown={open(m.section)} style={{ display: 'inline-flex', flexShrink: 0, pointerEvents: 'auto', cursor: props.onOpen ? 'pointer' : undefined }}>
          <Icon name={MARK_ICONS[m.kind]} size={10} />
        </span>
      ))}
    </>
  )
}

function LinkMark(): JSX.Element {
  return (
    <svg data-testid="clip-link" width="12" height="8" viewBox="0 0 12 8" style={{ display: 'block' }} aria-label="linked">
      <rect x="0.75" y="1.75" width="6" height="4.5" rx="2.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.25" y="1.75" width="6" height="4.5" rx="2.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * What a clip on the timeline is drawn from. Every handler is told which clip
 * it is about rather than being made for this clip alone, so the timeline can
 * hand every clip the same few handlers and a clip whose own props are
 * unchanged is not drawn again. The playhead moving draws none of them.
 */
interface TrackClipProps {
  /**
   * Its start or end is a cut inside its group (plan 80): no trim handle
   * there, square to the piece beside it, and the cut marked, so the group
   * reads as one clip.
   */
  inner?: { start: boolean; end: boolean } | undefined
  /** A zoom keyframe's diamond clicked: the frame of the sequence it is shown on, to put the playhead there. */
  onKeyframe?: ((frame: number) => void) | undefined
  /** A zoom keyframe's diamond dragged along the clip: the keyframe moved, from and to the clip's own frames. */
  onKeyframeMove?: ((clipId: string, picture: string, from: number, to: number) => void) | undefined
  /** An effect mark pressed: the Inspector section it is about, to open. */
  onEffectMark?: ((section: string) => void) | undefined
  /** On the clip selected, the picture chosen, whose zoom its diamonds show. */
  zoomPicture?: string | undefined
  /** Whether zoom keyframes are marked on clips at all. */
  showKeys?: boolean | undefined

  clip: Clip | SoundClip
  kind: 'video' | 'audio'
  media: ProjectMedia
  /** What the clip is called: its source, which cut of it, and its stream. */
  label: string
  /** Its track's colour, on the name strip and on its own edges. */
  colour: string
  /** How tall its track is drawn, which the timeline's size control sets. */
  height: number
  /** Told what a trim of this clip caught, and told null when it caught nothing. */
  onSnap?: ((frame: number | null) => void) | undefined
  /** Told while a trim of this clip is closing up, so what is in the way can be shown. */
  /** A drag of an edge that closes up, where it has got to, or its end with `on` false. */
  onClosingUp?: ((clipId: string, on: boolean, trim?: { edge: 'start' | 'end'; frame: number; alone: boolean }) => void) | undefined
  /** What stops this clip's edge drag closing up, in words, while it is dragged: it then trims only. */
  trimBlocked?: string | null | undefined
  /** Right clicked, or the menu key pressed on it: where to open its menu. */
  onMenu?: ((clipId: string, at: { x: number; y: number }) => void) | undefined
  /**
   * The frame of the sequence under the pointer, told afresh as it moves and
   * told null when the pointer leaves: the clip looked through without going
   * there. Never told during a drag or a trim, which have the pointer already.
   */
  onSkim?: ((frame: number | null) => void) | undefined
  /** Hatched in red: closing up over it would push it out of step. */
  blocking?: boolean | undefined
  fps: number
  pxPerFrame: number
  selected: boolean
  /** Selected on its own, without the clips linked to it, as Alt+click selects it. */
  selectedAlone: boolean
  offline: boolean
  /** Its waveform or playable file is being rebuilt after the cache lost it. */
  rebuilding: boolean
  /** Bumped when its derived files are rebuilt, so the filmstrip is fetched again. */
  revision: number
  /** A sound clip's waveform, once it has been read. Its own and no other, so another's arriving leaves it be. */
  peaks: PeaksData | undefined
  /** Where the clip is drawn from, when it is being dragged somewhere else. */
  dragging: boolean
  /**
   * A click selects it with its linked clips, or alone with Alt held. With
   * Shift held it is added to the selection, or taken out of it, and no drag
   * begins: Shift is for picking several, not for moving them.
   */
  onSelect: (clipId: string, alone: boolean, add: boolean) => void
  /** The format painter is armed and this clip can take a framing: a press paints it. */
  onPaint?: ((clipId: string) => void) | undefined
  /**
   * Where a trim drag has taken an edge, as a frame of the recording, measured
   * from where the drag began. `continuing` marks every movement after the
   * first. `alone` trims it without the clips linked to it. `closeUp`, the
   * plain drag on V1 since plan 82, closes up or opens up the sequence with it;
   * Ctrl held trims only.
   */
  onTrim: (clipId: string, edge: 'start' | 'end', frame: number, continuing: boolean, alone: boolean, closeUp: boolean) => void
  /** The timeline scrolling as a trim nears its edge: where it is scrolled to, and following and stopping. */
  edgeScroll?: { left: () => number; follow: (x: number, scrolled: () => void) => void; stop: () => void }
  /** Whether a plain drag of its edge closes up the sequence, Ctrl trimming only: it, or a clip linked to it, is on V1. */
  ripples: boolean
  onDragStart: (clipId: string, clientX: number, clientY: number, alone: boolean) => void
  /**
   * What a trim's edge snaps to, taken when the trim begins, for a plain trim
   * and for one that closes up, and how near it has to come, in frames. Alt
   * held turns snapping off for that movement. `alone` is whether the trim
   * leaves the clips linked to this one where they are.
   */
  snap: {
    targets: (clipId: string, alone: boolean, edge: 'start' | 'end', closesUp: boolean) => number[]
    /** The targets still on screen, asked afresh on every movement of the drag. */
    onScreen: (targets: number[]) => number[]
    within: number
  }
  /**
   * The part of the clip near the part of the timeline in view, in its own
   * pixels from its left edge: its filmstrip is drawn there and nowhere else.
   */
  shownFrom: number
  shownTo: number
  /**
   * A sound clip's fade from or to silence, dragged by the handle at the top
   * of either end: how many frames, 0 for none. `continuing` marks every
   * movement after the first, so the drag is one undo.
   */
  onFade?: ((clipId: string, side: 'in' | 'out', length: number, continuing: boolean) => void) | undefined
  /** Which of its ends have nothing against them and so take a fade handle. */
  fadeable?: 'both' | 'in' | 'out' | 'none' | undefined
}

/** How wide the band drawn at each of a clip's edges is, inside its wider trim handle. */
const EDGE_BAND_PX = 8

/** How big a fade handle is, at the top corner of a sound clip. */
const FADE_HANDLE_PX = 9

/**
 * A clip on any track, placed at its own time: a video clip shows its
 * filmstrip, a sound clip its waveform, and both their names. Dragged by its
 * body to move it, by its edges to trim it. A trim drag is one undo step.
 */
export const TrackClip = memo(function TrackClip(props: TrackClipProps): JSX.Element {
  const c = props.clip
  const length = c.sourceOut - c.sourceIn
  const width = Math.max(MIN_CLIP_WIDTH, length * props.pxPerFrame)
  const height = props.height
  const [trim, setTrim] = useState<{
    edge: 'start' | 'end'
    alone: boolean
    startX: number
    /** Where the timeline was scrolled to when the drag began, so a scroll during it is allowed for. */
    startScroll: number
    from: number
    /** Where the clip started, and started in its recording, when the drag began. */
    startAt: number
    inAt: number
    outAt: number
    targets: number[]
    /** What it snaps to when it closes up, where more of the timeline moves with it. */
    closingTargets: number[]
  } | null>(null)
  /** What was last sent in this drag, so a movement that changes nothing sends nothing. */
  const sent = useRef<string | null>(null)
  /**
   * Where the trim has got to, for the frame drawn above the handle: the frame
   * of the recording the cut would land on, and how far it has moved. Held
   * here rather than read back off the clip, so the picture has its own clock
   * and the playhead does not jump about while a trim is dragged.
   */
  const [trimAt, setTrimAt] = useState<{ frame: number; moved: number; closesUp: boolean } | null>(null)
  /**
   * The props as they are now, for the trim's listeners. Read from here, the
   * listeners are added once when the trim begins rather than taken down and
   * added again every time the clip is drawn during it.
   */
  const live = useRef(props)
  useLayoutEffect(() => {
    live.current = props
  })

  useEffect(() => {
    if (!trim) return
    // Always from where the drag began, never added to wherever the edge has
    // got to: a limit it ran into would otherwise keep what it clamped away.
    const move = (e: globalThis.PointerEvent): void => {
      const props = live.current
      // Near an edge the timeline scrolls, and the edge goes on with the view.
      props.edgeScroll?.follow(e.clientX, () => move(e))
      const scrolled = (props.edgeScroll?.left() ?? 0) - trim.startScroll
      const asked = trim.from + Math.round((e.clientX - trim.startX + scrolled) / props.pxPerFrame)
      // On V1 the rest of the sequence follows the edge, as I and O do, so a
      // longer clip brings its footage back and a shorter one leaves no gap
      // (plan 82). Ctrl trims it alone, stopping at the next clip. A clip
      // taken on its own trims alone too: closing up would take its group.
      const closesUp = props.ripples && !commandKey(e) && !trim.alone
      const frame = e.altKey
        ? asked
        : snapTrim({
            closesUp,
            edge: trim.edge,
            frame: asked,
            startAt: trim.startAt,
            inAt: trim.inAt,
            outAt: trim.outAt,
            targets: props.snap.onScreen(closesUp ? trim.closingTargets : trim.targets),
            within: props.snap.within
          })
      // What it caught, so the timeline can draw a line at it. Snapping is
      // silent today, and an edge that jumps for no visible reason reads as a
      // fault until you work out what pulled it.
      const caught = e.altKey
        ? null
        : snapTrimTo({
            closesUp,
            edge: trim.edge,
            frame: asked,
            startAt: trim.startAt,
            inAt: trim.inAt,
            outAt: trim.outAt,
            targets: props.snap.onScreen(closesUp ? trim.closingTargets : trim.targets),
            within: props.snap.within
          }).caught
      props.onSnap?.(caught)
      props.onClosingUp?.(props.clip.id, closesUp === true, { edge: trim.edge, frame, alone: trim.alone })
      setTrimAt({ frame, moved: frame - trim.from, closesUp })
      const key = `${frame}:${closesUp}`
      if (key === sent.current || (sent.current === null && frame === trim.from)) return
      props.onTrim(props.clip.id, trim.edge, frame, sent.current !== null, trim.alone, closesUp)
      sent.current = key
    }
    const up = (): void => {
      const props = live.current
      props.edgeScroll?.stop()
      props.onSnap?.(null)
      props.onClosingUp?.(props.clip.id, false)
      setTrimAt(null)
      setTrim(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [trim])

  /**
   * Whether a press on this clip takes it on its own: with Alt held, or when
   * it is already selected on its own. A plain press on a clip not selected
   * selects it with its linked clips.
   */
  const pressAlone = (altKey: boolean): boolean => altKey || (props.selected && props.selectedAlone)

  const grab = (edge: 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const alone = pressAlone(e.altKey)
    props.onSelect(c.id, alone, false)
    sent.current = null
    setTrim({
      edge,
      alone,
      startX: e.clientX,
      startScroll: props.edgeScroll?.left() ?? 0,
      from: edge === 'start' ? c.sourceIn : c.sourceOut,
      startAt: c.timelineStart,
      inAt: c.sourceIn,
      outAt: c.sourceOut,
      targets: props.snap.targets(c.id, props.selected && props.selectedAlone, edge, false),
      closingTargets: props.snap.targets(c.id, props.selected && props.selectedAlone, edge, true)
    })
  }

  // The grab area keeps its width, so a trim is as easy to catch, and the band
  // drawn in it is narrower, at the clip's own edge: at most 8 pixels, so the
  // two that meet at a cut read 16 wide rather than 24 (tasks 124 and 126).
  const handleW = handleWidthFor(width)
  const drawnW = Math.max(1, Math.min(EDGE_BAND_PX, handleW - 1))
  const edgeColour = props.selected ? accent.base : surface.edge
  const handle = {
    position: 'absolute' as const,
    top: 0,
    width: handleW,
    height: '100%',
    cursor: 'ew-resize',
    opacity: 0.9,
    zIndex: 1
  }
  const band = (side: 'left' | 'right'): string => `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${edgeColour} ${drawnW}px, transparent ${drawnW}px)`
  const name = props.media.originalPath.split(/[\\/]/).pop() ?? ''
  const sound = props.kind === 'audio' ? (c as SoundClip) : null
  const picture = props.kind === 'video' ? (c as Clip) : null
  // Worked out where the whole sequence is known: a clip cannot count which
  // cut of its recording it is from its own props.
  const label = props.label
  // What the clip was marked with, if anything. A band down its left edge, so
  // it still reads on a clip too narrow for its name.
  const mark = markColour(c.mark)
  // Only the tiles near the part of the timeline in view: a long clip zoomed
  // in has hundreds, nearly all of them out of sight. Each keeps its place in
  // the whole strip as its key, so scrolling adds and takes away tiles at the
  // ends and leaves the rest where they are.
  // A text has no filmstrip: its words are in the name strip.
  const tiles = picture && !props.media.text && !props.media.shape
    ? stripTiles(props.media, c, props.fps, width)
        .map((t, i) => ({ ...t, i }))
        .filter((t) => t.left + t.width > props.shownFrom && t.left < props.shownTo)
    : []
  // A query the file system ignores, so a filmstrip rebuilt at the same path
  // is fetched again rather than served from the failed first attempt.
  /** Which fade handle is being dragged, so it stays under the pointer once its fade exists. */
  const [fading, setFading] = useState<'in' | 'out' | null>(null)
  const stripUrl = fileUrl(props.media.filmstripPath) + (props.revision > 0 ? `?v=${props.revision}` : '')
  // A keyframe dragged along the clip snaps to what a clip's edge does: the
  // other clips' edges and the playhead.
  const keySnap = { targets: () => props.snap.targets(c.id, true, 'start', false), within: props.snap.within }

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation()
        // The format painter is armed: a press gives this clip the framing, and does nothing else.
        if (props.onPaint && e.button === 0) {
          props.onPaint(c.id)
          return
        }
        // Alt+click takes this clip on its own, without the clips linked to it.
        const alone = pressAlone(e.altKey)
        // A right press opens the menu, which acts on the selection. It
        // selects as any press does, which keeps a selection this clip is in,
        // and never starts a drag, whose click would narrow it again.
        if (e.button === 2) {
          props.onSelect(c.id, alone, false)
          return
        }
        // Every press, so the Inspector shows the clip pressed, even of the group already selected.
        props.onSelect(c.id, alone, e.shiftKey)
        // Shift+click picks: a drag would move a clip the press was only adding to the selection.
        if (!e.shiftKey) props.onDragStart(c.id, e.clientX, e.clientY, alone)
      }}
      onMouseMove={(e) => {
        if (!props.onSkim || trim || props.dragging) return
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width <= 0) return
        const along = Math.round((e.clientX - r.left) / props.pxPerFrame)
        props.onSkim(c.timelineStart + Math.max(0, Math.min(length - 1, along)))
      }}
      onMouseLeave={() => props.onSkim?.(null)}
      onContextMenu={(e) => {
        if (!props.onMenu) return
        e.preventDefault()
        e.stopPropagation()
        // The clip under the pointer is the one the menu acts on, so it is
        // chosen first, exactly as a left click chooses it.
        props.onSelect(c.id, false, false)
        props.onMenu(c.id, { x: e.clientX, y: e.clientY })
      }}
      title={props.label === '' ? name : props.label}
      data-testid={picture ? 'clip' : 'sound-clip'}
      data-clip-id={c.id}
      data-media-id={c.mediaId}
      data-kind={props.kind}
      data-source={props.media.text ? 'text' : props.media.shape ? 'shape' : props.media.still ? 'still' : picture ? 'video' : 'sound'}
      data-start={c.timelineStart}
      data-length-frames={length}
      data-selected={props.selected ? 'yes' : 'no'}
      data-muted={sound?.muted ? 'yes' : 'no'}
      data-link={c.link ?? ''}
      data-group={c.group ?? ''}
      data-offline={props.offline ? 'yes' : 'no'}
      data-rebuilding={props.rebuilding ? 'yes' : 'no'}
      data-peaks={sound && props.peaks !== undefined ? 'yes' : 'no'}
      style={{
        position: 'absolute',
        left: c.timelineStart * props.pxPerFrame,
        top: 2,
        width,
        height: height - 4,
        // A clip narrower than it is drawn sits over the one after it, so it can still be grabbed.
        zIndex: width > length * props.pxPerFrame ? 2 : 1,
        overflow: 'hidden',
        borderRadius: props.inner
          ? `${props.inner.start ? 0 : radius.chip}px ${props.inner.end ? 0 : radius.chip}px ${props.inner.end ? 0 : radius.chip}px ${props.inner.start ? 0 : radius.chip}px`
          : radius.chip,
        outline: props.selected
          ? `2px solid ${accent.base}`
          : `1px solid ${sound ? clipColour.soundLine : clipColour.pictureLine}`,
        outlineOffset: -1,
        background: props.offline ? clipColour.offline : sound ? clipColour.sound : clipColour.picture,
        opacity: props.dragging ? 0.35 : sound?.muted ? 0.45 : 1,
        cursor: props.onPaint ? 'copy' : 'grab',
        userSelect: 'none'
      }}
    >
      {sound ? (
        <Waveform
          data={props.peaks}
          startSec={c.sourceIn / props.fps}
          endSec={c.sourceOut / props.fps}
          width={width}
          height={height - 4}
          color={props.selected ? clipColour.waveSelected : clipColour.wave}
        />
      ) : (
        tiles.map((t) => (
          <div
            key={t.i}
            style={{
              position: 'absolute',
              left: t.left,
              top: 0,
              width: t.width,
              height: height - 4,
              backgroundImage: props.offline || props.rebuilding ? 'none' : `url("${stripUrl}")`,
              backgroundPosition: `-${t.x}px -${t.y}px`,
              backgroundRepeat: 'no-repeat',
              opacity: 0.85
            }}
          />
        ))
      )}
      {picture && props.showKeys !== false && props.onKeyframe && (
        <ClipKeyframes
          clip={picture}
          zoomPicture={props.zoomPicture}
          width={width}
          pxPerFrame={props.pxPerFrame}
          fps={props.fps}
          selected={props.selected}
          snap={keySnap}
          onSnap={props.onSnap}
          onSelect={(altKey) => props.onSelect(c.id, pressAlone(altKey), false)}
          onKeyframe={(frame) => props.onKeyframe?.(frame)}
          onKeyframeMove={props.onKeyframeMove}
        />
      )}
      {/*
        The name on its own strip rather than floating over the filmstrip: a
        name over a frame is readable on a dark shot and gone on a bright one,
        whatever shadow it carries.
      */}
      {mark !== null && (
        <span
          data-testid="clip-mark"
          data-mark={c.mark}
          aria-label={`marked ${markName(c.mark)}`}
          title={`Marked ${markName(c.mark)}`}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: mark, pointerEvents: 'none', zIndex: 3 }}
        />
      )}
      <span
        data-testid="clip-name"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 15,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '0 6px',
          boxSizing: 'border-box',
          background: surface.overlay,
          font: type.meta,
          color: props.selected ? ink.primary : clipColour.ink,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          pointerEvents: 'none'
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: radius.handle, background: mark ?? props.colour, flexShrink: 0 }}
        />
        {c.link !== undefined && <LinkMark />}
        <EffectMarks
          marks={sound ? soundMarks(sound) : picture ? pictureMarks(picture, props.media.still === true || props.media.text !== undefined) : []}
          width={width}
          onOpen={props.onEffectMark && ((section, altKey) => {
            props.onSelect(c.id, pressAlone(altKey), false)
            props.onEffectMark?.(section)
          })}
        />
        {/*
          A text says so with a T and shows its words here, once, as small as
          any clip's name: its own drawn picture across the strip shouted over
          every other clip on the timeline.
        */}
        {props.media.text && (
          <span data-testid="clip-text" style={{ display: 'inline-flex', flexShrink: 0 }}>
            <Icon name="text" size={10} />
          </span>
        )}
        {props.media.shape && (
          <span data-testid="clip-shape" style={{ display: 'inline-flex', flexShrink: 0 }}>
            <Icon name="shape" size={10} />
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {props.offline ? 'missing file' : props.rebuilding ? 'rebuilding' : label}
        </span>
        {sound?.muted && <span style={{ color: ink.muted, flexShrink: 0 }}>muted</span>}
      </span>
      {/*
        The frame the cut would land on, floating above the handle, with how
        far the edge has moved. A trim shows a moving edge and nothing else
        today, so where the cut actually falls is a guess until you let go.
      */}
      {trimAt && picture && !props.offline && !props.rebuilding && (
        <span
          data-testid="edge-frame"
          data-frame={trimAt.frame}
          data-moved={trimAt.moved}
          style={{
            position: 'absolute',
            left: trim?.edge === 'start' ? 0 : undefined,
            right: trim?.edge === 'end' ? 0 : undefined,
            bottom: '100%',
            marginBottom: 6,
            width: EDGE_FRAME_W,
            padding: 3,
            borderRadius: radius.chip,
            background: surface.overlay,
            border: `1px solid ${accent.base}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 6,
            pointerEvents: 'none'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: EDGE_FRAME_W - 6,
              height: Math.round(((EDGE_FRAME_W - 6) * props.media.height) / Math.max(1, props.media.width)),
              background: surface.well,
              backgroundImage: `url("${stripUrl}")`,
              backgroundRepeat: 'no-repeat',
              ...edgeTile(props.media, trimAt.frame, props.fps, EDGE_FRAME_W - 6)
            }}
          />
          <span style={{ font: type.monoSmall, color: ink.primary, textAlign: 'center' }}>
            {trimAt.moved === 0 ? 'no change' : `${trimAt.moved > 0 ? '+' : ''}${trimAt.moved} frames`}
          </span>
          {props.ripples && (
            <span data-testid="edge-mode" style={{ font: type.meta, color: ink.secondary, textAlign: 'center' }}>
              {/* Saying so when something stops the rest following, and the drag trims only (audit 2026-10-01). */}
              {trimAt.closesUp ? (props.trimBlocked ? `Trim only: ${props.trimBlocked} is in the way` : `The rest follows. ${COMMAND_KEY_NAME}: trim only`) : 'Trim only'}
            </span>
          )}
          <span style={{ font: type.monoSmall, color: ink.muted, textAlign: 'center' }}>
            {formatTimecode(Math.max(0, trimAt.frame), props.fps)}
          </span>
        </span>
      )}

      {/*
        In the way: closing up over this clip would push it out of step, so it
        is hatched while the drag is held rather than named in a notice after.
      */}
      {props.blocking === true && (
        <span
          data-testid="clip-blocking"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `repeating-linear-gradient(45deg, ${danger.line} 0 6px, transparent 6px 12px)`,
            border: `1.5px solid ${meaning.stop}`,
            borderRadius: radius.chip,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}

      {picture && picture.layers.length > 0 && !props.offline && !props.rebuilding && (
        <span
          data-testid="clip-pictures"
          data-count={picture.layers.length + 1}
          title="Pictures laid out in this clip"
          style={{
            position: 'absolute',
            right: 10,
            top: 4,
            padding: '1px 5px',
            borderRadius: radius.chip,
            background: surface.overlay,
            font: type.meta,
            color: meaning.attention,
            pointerEvents: 'none'
          }}
        >
          {picture.layers.length + 1} pictures
        </span>
      )}
      {/*
        Fade handles, at the top of each end of a sound clip with no fade on
        that side yet: dragged in, a fade from or to silence. Once there is one
        the transition is drawn over the clip with handles of its own, so this
        one steps aside, except while it is the one being dragged.
      */}
      {sound &&
        props.onFade &&
        (['in', 'out'] as const)
          .filter((side) => props.fadeable === 'both' || props.fadeable === side)
          .filter((side) => fading === side || (side === 'in' ? sound.transitionIn : sound.transitionOut) === undefined)
          .map((side) => (
            <div
              key={side}
              data-testid={`fade-${side}`}
              title={side === 'in' ? 'Drag right to fade in from silence' : 'Drag left to fade out to silence'}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                e.preventDefault()
                const startX = e.clientX
                let continuing = false
                setFading(side)
                const move = (m: globalThis.PointerEvent): void => {
                  const dx = (m.clientX - startX) / props.pxPerFrame
                  props.onFade?.(c.id, side, Math.max(0, Math.round(side === 'in' ? dx : -dx)), continuing)
                  continuing = true
                }
                const up = (): void => {
                  window.removeEventListener('pointermove', move)
                  setFading(null)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up, { once: true })
              }}
              style={{
                position: 'absolute',
                top: 0,
                ...(side === 'in' ? { left: 0 } : { right: 0 }),
                width: FADE_HANDLE_PX,
                height: FADE_HANDLE_PX,
                background: accent.base,
                borderRadius: side === 'in' ? '0 0 100% 0' : '0 0 0 100%',
                cursor: 'ew-resize',
                zIndex: 6
              }}
            />
          ))}
      {props.inner?.start === true && (
        <div
          data-testid="group-cut"
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderLeft: `1px dashed ${ink.muted}`, pointerEvents: 'none', zIndex: 1 }}
        />
      )}
      {/* No trimming while the painter is armed: the whole clip is what a press paints. */}
      {!props.onPaint && (
        <>
          {props.inner?.start !== true && <div data-testid="trim-start" onPointerDown={grab('start')} style={{ ...handle, left: 0, background: band('left') }} />}
          {props.inner?.end !== true && <div data-testid="trim-end" onPointerDown={grab('end')} style={{ ...handle, right: 0, background: band('right') }} />}
        </>
      )}
    </div>
  )
})
