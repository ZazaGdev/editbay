import type { JSX, ReactNode, CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { MAIN_PICTURE, allClips, findVideoClip, pipOf, targetAspect, zoomOf, startEndOf } from '../../shared/project'
import { pipCorner, pipShape } from '../../shared/pip'
import { editedAt, pictureUnder, textAt } from '../../shared/playback'
import { formatTimecode } from '../../shared/time'
import { displayToSource, fitInBox } from '../../shared/crop-geometry'
import { onEnd, shownCrop } from '../../shared/zoom-edit'
import { boxAtPlayhead } from '../../shared/box-keys'
import { outputSizeFor, presetById } from '../../shared/presets'
import type { HtmlVideoEngine } from '../preview/htmlVideo'
import { captionAt } from '../../shared/captions'
import { surface, ink, accent, pictureColour, radius, type } from '../theme'
import { EDITOR_ROOM, NO_ROOM, monitorLayout, type MonitorBox } from '../../shared/monitor-layout'
import type { MonitorProps, MonitorView } from './monitor/monitor-props'
import { useBoxSize } from './monitor/useBoxSize'
import { useMonitorEngine } from './monitor/useMonitorEngine'
import { useFullscreen } from './monitor/useFullscreen'
import { useSourceZoom } from './monitor/useSourceZoom'
import { useProgramZoom } from './monitor/useProgramZoom'
import { useSpacePan } from './monitor/useSpacePan'
import { ZoomChip } from './monitor/ZoomChip'
import { MonitorSource } from './monitor/MonitorSource'
import { MonitorProgram } from './monitor/MonitorProgram'

export type { MonitorView } from './monitor/monitor-props'

/** Where a box of the monitor is, as a style. */
function boxStyle(box: MonitorBox): CSSProperties {
  return { position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }
}

export function Monitor(props: MonitorProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<HtmlVideoEngine | null>(null)
  const size = useBoxSize(stageRef)
  const framed = targetAspect(props.timeline) !== null
  const { width: frameW, height: frameH } = props.timeline.output

  // The picture edited: the selected clip when it is a picture under the
  // playhead, on any track, and otherwise the one on the lowest video track
  // there. The nudge keys edit the same one.
  const under = (c: { timelineStart: number; sourceIn: number; sourceOut: number }): boolean =>
    props.playhead >= c.timelineStart && props.playhead < c.timelineStart + (c.sourceOut - c.sourceIn)
  const at = editedAt(props.framing ?? props.timeline, props.playhead, props.selectedClipId)
  // Anything at all: sound alone shows black, not "no clip".
  const anythingHere = allClips(props.timeline).some(under)

  // The picture being edited, if this clip has it; otherwise its main picture.
  // Its crop box shows its crop at the playhead, which for a picture that
  // zooms is its keyframes' there, and moves as it plays. A Simple zoom's box
  // is its Start or its End, whichever is chosen, with the other drawn dashed.
  const layer = at?.clip.layers.find((l) => l.id === props.picture)
  const picture = layer ? layer.id : MAIN_PICTURE
  const zoomEnd = props.zoomEnd === true
  // A box its keyframes move is shown where they put it at the playhead (plan 97).
  const boxNow = at ? boxAtPlayhead(at.clip, props.playhead, picture) : null
  const selected = at
    ? { crop: shownCrop(at.clip, props.playhead, picture, zoomEnd), place: boxNow ?? (layer ?? at.clip.transform).place }
    : null
  const ends = at && zoomOf(at.clip, picture).simple !== undefined ? startEndOf(at.clip, picture) : null
  const endChosen = at !== null && at !== undefined && onEnd(at.clip, picture, zoomEnd)
  const editedClipId = at?.clip.id
  const editedBlur = props.blurBox !== null && props.blurBox !== undefined ? (at?.clip.blurBoxes?.[props.blurBox] ?? null) : null
  const editedPicture = picture
  /**
   * Bugs and notes 2, note 25: on a clip with more than one picture, the one
   * being edited named and in its own colour on both views, as on its buttons.
   */
  const pictureNameOf = (id: string): string => {
    const i = at ? at.clip.layers.findIndex((l) => l.id === id) : -1
    return i < 0 ? 'Main' : `Picture ${i + 2}`
  }
  const named =
    at && at.clip.layers.length > 0
      ? { name: pictureNameOf(picture), colour: pictureColour(at.clip.layers.findIndex((l) => l.id === picture) + 1) }
      : undefined
  /** A press on a picture not being edited, still held: the place box that appears for it carries on from it. */
  const [grab, setGrab] = useState<{ id: string; x: number; y: number } | null>(null)
  const others = at
    ? [at.clip.transform.crop, ...at.clip.layers.map((l) => l.crop)].filter((_, i) =>
        picture === MAIN_PICTURE ? i !== 0 : at.clip.layers[i - 1]?.id !== picture
      )
    : []
  const sourceSize = at ? { w: at.media.width, h: at.media.height } : null

  useMonitorEngine(props, stageRef, engineRef)

  useFullscreen(props, stageRef)

  // Where each view goes: both side by side for a frame taller than wide,
  // unless the monitor is on the whole screen, which shows the one the keys
  // act on; otherwise that one alone.
  const layout = useMemo(
    () =>
      monitorLayout(
        { width: size.width, height: size.height },
        props.view,
        framed ? { width: frameW, height: frameH } : null,
        props.sideBySide && !props.fullscreen,
        // Room round the pictures in the editor, so a box on the frame's edge
        // is not cut off; none on the whole screen.
        props.fullscreen ? NO_ROOM : EDITOR_ROOM
      ),
    [size.width, size.height, props.view, framed, frameW, frameH, props.sideBySide, props.fullscreen]
  )
  const both = layout.source !== null && layout.program !== null

  // The Output view zoomed in by Ctrl and the wheel (task 53): its frame drawn
  // larger, where `drawn` says, and cut to the view.
  const programZoom = useProgramZoom({ program: layout.program, stageRef })
  const zoomedIn = programZoom.shown
  const drawn: MonitorBox | null =
    layout.program && zoomedIn
      ? { x: layout.program.x + zoomedIn.offsetX, y: layout.program.y + zoomedIn.offsetY, width: zoomedIn.width, height: zoomedIn.height }
      : null

  // The engine works out where everything goes; it only needs to know where
  // each view is.
  useLayoutEffect(() => {
    const engine = engineRef.current
    if (!engine || size.width === 0) return
    engine.setLayout(layout, drawn)
  }, [size.width, layout, drawn?.x, drawn?.y, drawn?.width, drawn?.height])

  // The frame the Output view shows, outlined, so black bars in the picture can be
  // told from the monitor around it. Handoff has no fixed frame: it writes the
  // main picture's crop at its own size.
  const frameSize = framed
    ? { width: frameW, height: frameH }
    : at
      ? outputSizeFor(presetById(props.timeline.presetId), at.clip.transform.crop)
      : null
  // Everything over the Output view goes where its frame is drawn, zoomed or not.
  const program = drawn ?? layout.program
  const source = layout.source
  const outline =
    frameSize && program && program.width > 0 ? fitInBox(frameSize.width, frameSize.height, program.width, program.height) : null
  // The caption on screen now, at the playhead, as the canvas draws it. None
  // while playing: a caption changes too often to be pressed then.
  const shownCaption = !props.playing ? captionAt(props.timeline.captions.clips, props.playhead) : undefined
  const captions = {
    source: named ? `Source: ${named.name}` : 'Source',
    program: framed ? `Output ${frameW}x${frameH}` : 'Output: each clip at its own size, as Handoff writes it'
  }
  // Side by side, one caption says what both are, on the Source side: the
  // Output side has no black around the frame, so a caption there would cover
  // the picture and the apps' safe zones.
  const bothCaption = named ? `Left, the source of ${named.name}. Right, the output ${frameW}x${frameH}` : `Left, the source. Right, the output ${frameW}x${frameH}`

  const { zoom, setZoomed, shownFit, pressed, startPan } = useSourceZoom({ at, source, sourceSize, stageRef, engineRef })
  // A shape's picture left out while its handles are dragged, its outline standing in (task 59).
  const [shapeHidden, setShapeHidden] = useState(false)
  const hiddenClip = shapeHidden ? (editedClipId ?? null) : null
  useEffect(() => engineRef.current?.setHidden(hiddenClip), [hiddenClip])
  // A shape just drawn keeps its outline until its picture is drawn (task 86), and is not waited on for long.
  const landing = props.shapeDraw?.landing
  const landed = useRef(props.shapeDraw?.onLanded)
  landed.current = props.shapeDraw?.onLanded
  useEffect(() => {
    if (!landing) return
    const done = (): void => landed.current?.()
    const t = window.setTimeout(done, 1500)
    const stop = engineRef.current?.whenDrawn(landing, done)
    return () => {
      window.clearTimeout(t)
      stop?.()
    }
  }, [landing])
  /** Whether a view is zoomed in, and so pans with the middle button, or a left drag with Space held. */
  const zoomedView = (view: MonitorView): boolean => (view === 'source' ? zoom !== null : programZoom.zoom !== null)
  const space = useSpacePan((x, y) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return false
    const inBox = (b: MonitorBox | null): boolean => b !== null && x >= r.left + b.x && x <= r.left + b.x + b.width && y >= r.top + b.y && y <= r.top + b.y + b.height
    return (zoom !== null && inBox(layout.source)) || (programZoom.zoom !== null && inBox(layout.program))
  })

  /** A view's own part of the monitor: a press in it makes it the one the keys act on. */
  // Everything else on the Output view at the playhead, in output pixels, for
  // a moved box to line up with: other clips' pictures and the edited clip's
  // other pictures. Whole-frame ones add nothing the frame's own lines do not.
  const othersOnScreen = framed
    ? props.timeline.videoTracks
        .filter((r) => !r.hidden)
        .flatMap((r) => r.clips.filter((c) => props.playhead >= c.timelineStart && props.playhead < c.timelineStart + (c.sourceOut - c.sourceIn)))
        .flatMap((c) => [
          ...(c.id === editedClipId && editedPicture === MAIN_PICTURE ? [] : [c.transform.place]),
          ...c.layers.filter((l) => !(c.id === editedClipId && l.id === editedPicture)).map((l) => l.place)
        ])
        .filter((p) => !(p.x <= 0 && p.y <= 0 && p.w >= 1 && p.h >= 1))
        .map((p) => ({ x: p.x * frameW, y: p.y * frameH, w: p.w * frameW, h: p.h * frameH }))
    : []

  // The clip's picture in picture, when the picture being edited is its small one.
  const pipNow = editedClipId && framed ? pipOf(props.timeline, editedClipId) : null
  const pipHere =
    pipNow && pipNow.picture === editedPicture
      ? {
          ...pipNow,
          ...(boxNow ? { place: boxNow } : {}),
          where: pipCorner(boxNow ?? pipNow.place, frameW, frameH),
          shape: pipShape(pipNow.style, pipNow.place, frameW, frameH)
        }
      : null

  /**
   * A double click on the Output view: the text on top there, if any, is typed
   * into. Otherwise the clip's picture on top there is chosen, whichever is
   * chosen now: a full frame picture's box covers the small one, so a single
   * press there moves the big one instead.
   */
  const doubleClickAt = (clientX: number, clientY: number, sideBox: HTMLElement): void => {
    if (!outline || !framed || props.playing || props.textEdit) return
    const r = sideBox.getBoundingClientRect()
    const x = (clientX - r.left - outline.offsetX) / outline.width
    const y = (clientY - r.top - outline.offsetY) / outline.height
    const id = textAt(props.timeline, props.playhead, x, y)
    if (id) {
      props.onTextEditStart?.(id)
      return
    }
    const under = at ? pictureUnder(at.clip, x, y) : null
    if (under !== null) props.onPictureChosen?.(under)
  }
  const typed = props.textEdit ? findVideoClip(props.timeline, props.textEdit.clipId) : null
  const typedStyle = typed ? props.timeline.media.find((m) => m.id === typed.clip.mediaId)?.text : undefined

  /**
   * A point of the edited picture's recording, in its pixels, under a place
   * on a view, or null where the view shows none of it: on the Source view
   * the recording itself, on the Output view the picture as it is drawn at
   * the playhead, through its place and its crop there.
   */
  const recordingAt = (view: MonitorView, x: number, y: number): { x: number; y: number } | null => {
    if (!at) return null
    if (view === 'source') {
      if (!shownFit) return null
      const r = displayToSource({ x, y, w: 0, h: 0 }, shownFit)
      return r.x >= 0 && r.y >= 0 && r.x <= at.media.width && r.y <= at.media.height ? { x: r.x, y: r.y } : null
    }
    if (!outline || !selected) return null
    const fx = (x - outline.offsetX) / outline.width
    const fy = (y - outline.offsetY) / outline.height
    const p = selected.place
    const ux = (fx - p.x) / p.w
    const uy = (fy - p.y) / p.h
    if (ux < 0 || uy < 0 || ux > 1 || uy > 1) return null
    return { x: selected.crop.x + ux * selected.crop.w, y: selected.crop.y + uy * selected.crop.h }
  }
  /** Where a point of the recording is drawn on a view, or null where that view does not show it. */
  const shownAt = (view: MonitorView, point: { x: number; y: number }): { x: number; y: number } | null => {
    if (view === 'source') return shownFit ? { x: shownFit.offsetX + point.x * shownFit.scale, y: shownFit.offsetY + point.y * shownFit.scale } : null
    if (!outline || !selected) return null
    const c = selected.crop
    const ux = (point.x - c.x) / c.w
    const uy = (point.y - c.y) / c.h
    if (ux < 0 || uy < 0 || ux > 1 || uy > 1) return null
    const p = selected.place
    return { x: outline.offsetX + (p.x + ux * p.w) * outline.width, y: outline.offsetY + (p.y + uy * p.h) * outline.height }
  }
  /** Over a view while a zoom can be aimed: every press there is a point to aim at, and the target is drawn. */
  const aimLayer = (view: MonitorView): JSX.Element | null => {
    if (!props.aiming || !props.onAim) return null
    const mark = props.aimPoint ? shownAt(view, props.aimPoint) : null
    return (
      <div
        data-testid="aim-layer"
        data-side={view}
        title="Click where the zoom should close in"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          const point = recordingAt(view, e.clientX - r.left, e.clientY - r.top)
          if (point) props.onAim?.({ x: Math.round(point.x), y: Math.round(point.y) })
        }}
        style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'crosshair', touchAction: 'none' }}
      >
        {mark && (
          <span
            data-testid="aim-target"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: mark.x - 9,
              top: mark.y - 9,
              width: 18,
              height: 18,
              boxSizing: 'border-box',
              borderRadius: radius.round,
              border: `2px solid ${accent.bright}`,
              boxShadow: `0 0 0 1px ${surface.overlay}`,
              pointerEvents: 'none'
            }}
          />
        )}
      </div>
    )
  }

  /**
   * A view of the monitor at `box`. Its contents go at `inner`, its own pixels
   * from the box's top left: the box itself, or the Output view's frame drawn
   * larger while it is zoomed in, cut to the box.
   */
  const side = (view: MonitorView, box: MonitorBox, inner: MonitorBox, children: ReactNode): JSX.Element => {
    const zoomedHere = zoomedView(view)
    return (
      <div
        key={view}
        data-testid="monitor-view"
        data-side={view}
        // Zoomed in, the picture and the boxes over it run past the view's edges: cut them there.
        style={{ ...boxStyle(box), ...(zoomedHere ? { overflow: 'hidden' } : {}) }}
      >
        <div
          data-testid="monitor-side"
          data-side={view}
          data-focused={props.view === view ? 'yes' : 'no'}
          onDoubleClick={
            view === 'program'
              ? (e) => {
                  // Two quick presses of a control over the picture, such as the small picture's toolbar, are not for the picture.
                  if ((e.target as HTMLElement).closest('button, input, select, textarea')) return
                  doubleClickAt(e.clientX, e.clientY, e.currentTarget)
                }
              : undefined
          }
          onPointerDownCapture={(e) => {
            if (view === 'source') pressed.current = true
            if (both && props.view !== view) props.onView(view)
            // Zoomed in, the middle button pans from anywhere in the view, the boxes over it included, and so does a left drag with Space held.
            if (zoomedHere && (e.button === 1 || (e.button === 0 && space.held))) {
              e.stopPropagation()
              if (e.button === 0) space.used()
              if (view === 'source') startPan(e)
              else programZoom.startPan(e)
            }
          }}
          style={boxStyle(inner)}
        >
          {children}
          {aimLayer(view)}
          {zoomedHere && space.held && (
            <div data-testid="monitor-hand" aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 7, cursor: 'grab' }} />
          )}
        </div>
        {view === 'program' && programZoom.zoom && (
          <ZoomChip testid="program-zoom" resetTestid="program-fit" scale={programZoom.zoom.scale} onReset={() => programZoom.setZoom(null)} />
        )}

        {both && props.view === view && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              border: `1px solid ${accent.base}`,
              borderRadius: radius.chip,
              pointerEvents: 'none'
            }}
          />
        )}
      </div>
    )
  }

  // `data-clip` is the clip the crop box edits, so a test can see that it is
  // the one the Inspector has: one clip at a time.
  return (
    <div
      ref={stageRef}
      data-testid="monitor-stage"
      onPointerDownCapture={(e) => {
        // A press while a shape is drawn is for the shape, where the playhead is, not for the selected clip (task 91).
        if (!props.shapeDraw && props.onFraming?.()) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      data-view={props.view}
      data-both={both ? 'yes' : 'no'}
      data-fullscreen={props.fullscreen ? 'yes' : 'no'}
      data-has-picture={at ? 'yes' : 'no'}
      data-clip={at?.clip.id ?? ''}
      data-skim={props.skim ?? ''}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        width: '100%',
        background: surface.well,
        borderRadius: radius.control,
        overflow: 'hidden'
      }}
    >
      {/* What the views are, in the room above them rather than over the picture (bugs and notes 2, note 30). */}
      {!props.fullscreen && (source ?? program) && (
        <span
          data-testid="monitor-caption"
          style={{
            position: 'absolute',
            zIndex: 3,
            left: (source ?? program)!.x,
            top: 3,
            maxWidth: `calc(100% - ${(source ?? program)!.x * 2}px)`,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '1px 8px',
            borderRadius: radius.chip,
            background: surface.overlay,
            color: ink.primary,
            font: type.meta,
            pointerEvents: 'none'
          }}
        >
          {both ? bothCaption : source ? captions.source : captions.program}
        </span>
      )}
      {source &&
        side(
          'source',
          source,
          { x: 0, y: 0, width: source.width, height: source.height },
          <MonitorSource
            props={props}
            at={at}
            source={source}
            sourceSize={sourceSize}
            zoom={zoom}
            setZoomed={setZoomed}
            startPan={startPan}
            shownFit={shownFit}
            selected={selected}
            named={named}
            others={others}
            ends={ends}
            endChosen={endChosen}
            editedClipId={editedClipId}
            editedPicture={editedPicture}
            editedBlur={editedBlur}
            framed={framed}
            frameW={frameW}
            frameH={frameH}
          />
        )}

      {program &&
        layout.program &&
        side(
          'program',
          layout.program,
          { x: program.x - layout.program.x, y: program.y - layout.program.y, width: program.width, height: program.height },
          <MonitorProgram
            props={props}
            at={at}
            program={program}
            outline={outline}
            frameSize={frameSize}
            framed={framed}
            frameW={frameW}
            frameH={frameH}
            picture={picture}
            pictureNameOf={pictureNameOf}
            grab={grab}
            setGrab={setGrab}
            shownCaption={shownCaption}
            typed={typed}
            typedStyle={typedStyle}
            selected={selected}
            named={named}
            editedClipId={editedClipId}
            editedPicture={editedPicture}
            othersOnScreen={othersOnScreen}
            pipHere={pipHere}
            onShapeHidden={setShapeHidden}
          />
        )}

      {/*
        The picture is not on the playhead while a clip is skimmed, and it is
        the one thing in the window that usually is. Said plainly, so a frame
        that does not match the timecode below reads as looking rather than
        as a fault.
      */}
      {props.skim !== null && props.skim !== undefined && (
        <span
          data-testid="monitor-skimming"
          style={{
            position: 'absolute',
            zIndex: 3,
            right: 8,
            top: 8,
            padding: '2px 8px',
            borderRadius: radius.chip,
            background: surface.overlay,
            color: ink.primary,
            font: type.meta,
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none'
          }}
        >
          Looking at {formatTimecode(props.skim, props.timeline.fps)}
        </span>
      )}

      {props.welcome}

      {!props.welcome && !anythingHere && (
        <p
          data-testid="monitor-empty"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: type.meta,
            color: ink.muted,
            margin: 0
          }}
        >
          {allClips(props.timeline).length === 0
            ? (props.noClips ?? 'Drag a source onto the timeline, or press Add to timeline.')
            : 'No clip under the playhead.'}
        </p>
      )}
    </div>
  )
}
