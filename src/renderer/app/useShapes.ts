/**
 * Shapes: one picked from the Shape menu and drawn on the Output view, drawn
 * again when it changes, and the Shape groups of the Inspector and the timeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findClip, findVideoClip, newId, sequenceOf, targetAspect, timelineOf } from '../../shared/project'
import {
  bendFor,
  bodyWithin,
  cleanShapeStyle,
  lineThrough,
  linePoints,
  nextShapeName,
  pictureAround,
  removeShape,
  resizedShape,
  saveShape,
  shapeFromDrag,
  shapeFromPath,
  type Point,
  type ShapeStyle
} from '../../shared/shape'
import { placeFromPixels, type Place } from '../../shared/layout'
import { MAX_VIDEO_TRACKS } from '../../shared/tracks'
import { renderShape } from '../shape/draw'
import type { ShapePick } from '../components/ShapeMenu'
import { showToast } from '../state/toasts'
import type { AppLocals, AppSettings, Selecting, Texts } from './app-state'

export function useShapes({
  project,
  proj,
  sequenceId,
  playhead,
  timeline,
  selected,
  view,
  setView,
  windowSettings,
  select,
  pressed,
  resized,
  savedShapes,
  savedShapesNow,
  storeShapes
}: Pick<AppLocals, 'project' | 'proj' | 'sequenceId' | 'playhead' | 'timeline' | 'selected' | 'view' | 'setView' | 'windowSettings'> &
  Pick<Selecting, 'select'> &
  Pick<Texts, 'pressed' | 'resized'> &
  Pick<AppSettings, 'savedShapes' | 'savedShapesNow' | 'storeShapes'>) {
  /**
   * A shape picked from the Shape menu, waiting to be drawn by a drag on the
   * Output view. Once let go, its outline stays until its picture is drawn,
   * `landing` saying which clip that is (task 86). Each pick is numbered, so
   * one picked meanwhile is drawn afresh.
   */
  const [shapeDrawing, setShapeDrawing] = useState<(ShapePick & { id: number; landing?: string }) | null>(null)
  const picks = useRef(0)
  const pickShape = useCallback(
    (pick: ShapePick): void => {
      if (!project) return
      if (targetAspect(timelineOf(project, sequenceOf(project, sequenceId).id)) === null) {
        showToast({ kind: 'shape', text: 'A shape needs a frame to sit in. Handoff has none: choose another shape of sequence first.' })
        return
      }
      // Drawn where the picture is: the Output view, brought up if the Source view is on its own.
      if (view === 'source' && !windowSettings.sideBySide) setView('program')
      setShapeDrawing({ ...pick, id: ++picks.current })
    },
    [project, sequenceId, view, windowSettings.sideBySide]
  )
  // Another sequence or project leaves nothing half drawn.
  useEffect(() => setShapeDrawing(null), [sequenceId, proj.docId])

  /** A shape dragged out on the Output view: drawn, and put there as a clip of its own at the playhead, selected. */
  const shapeDrawn = useCallback(
    async (a: Point, b: Point, path: Point[]): Promise<void> => {
      const pick = shapeDrawing
      if (!pick || !project) {
        setShapeDrawing(null)
        return
      }
      // Its outline stays on the Output view meanwhile, and until its picture is drawn there (task 86).
      const done = (): void => setShapeDrawing((now) => (now === pick ? null : now))
      try {
        const sequence = sequenceOf(project, sequenceId)
        const { width: W, height: H } = sequence.output
        // A pen or a highlighter keeps the path the pointer took (plan 88).
        const made = pick.style.kind === 'pen' ? shapeFromPath(pick.style, path) : shapeFromDrag(pick.style, a, b, pick.bent)
        const style = cleanShapeStyle(made.style)
        const drawn = await renderShape(style)
        const place = placeFromPixels(pictureAround(style, made.body), W, H)
        const clipId = newId()
        const after = await proj.edit({ kind: 'addShape', sequenceId: sequence.id, mediaId: newId(), clipId, at: playhead, style, drawn, place })
        if (findClip(timelineOf(after, sequence.id), clipId)) {
          setShapeDrawing((now) => (now === pick ? { ...pick, landing: clipId } : now))
          select(clipId)
        } else {
          done()
          showToast({ kind: 'shape', text: `No room for a shape here: a sequence has at most ${MAX_VIDEO_TRACKS} video tracks, and each is taken at the playhead.` })
        }
      } catch (e) {
        done()
        throw e
      }
    },
    [shapeDrawing, project, sequenceId, proj, playhead, select]
  )
  /** A shape just drawn has its picture on the Output view: its outline goes. */
  const shapeLanded = useCallback((clipId: string): void => setShapeDrawing((now) => (now?.landing === clipId ? null : now)), [])

  /**
   * A shape changed, drawn again, as a text is: the last change asked for
   * wins, and a drag of a slider is one undo step. `placed` puts that clip's
   * picture exactly there, as when an end of an arrow is dragged.
   */
  const shapeAsked = useRef(new Map<string, number>())
  const shapeStepUnbegun = useRef(new Set<string>())
  const changeShape = useCallback(
    async (mediaId: string, raw: ShapeStyle, opts: { unrecorded?: boolean; continuing?: boolean; placed?: { clipId: string; place: Place } } = {}): Promise<void> => {
      const ask = (shapeAsked.current.get(mediaId) ?? 0) + 1
      shapeAsked.current.set(mediaId, ask)
      if (!opts.continuing) shapeStepUnbegun.current.add(mediaId)
      const style = cleanShapeStyle(raw)
      const drawn = await renderShape(style)
      if (shapeAsked.current.get(mediaId) !== ask) return
      const joins = opts.continuing === true && !shapeStepUnbegun.current.has(mediaId)
      shapeStepUnbegun.current.delete(mediaId)
      await proj.edit(
        { kind: 'setShapeStyle', mediaId, style, drawn, ...(opts.placed ? { placed: opts.placed } : {}) },
        { unrecorded: opts.unrecorded === true, ...(joins ? { continuing: true } : {}) }
      )
    },
    [proj]
  )

  /** A line's ends and bend put somewhere new, in output pixels: its picture drawn again and placed round them. */
  const shapeLine = useCallback(
    (clipId: string, from: Point, to: Point, bend: Point | null): void => {
      if (!timeline) return
      const found = findVideoClip(timeline, clipId)
      const m = found ? timeline.media.find((x) => x.id === found.clip.mediaId) : undefined
      if (!found || !m?.shape) return
      const { width: W, height: H } = timeline.output
      const made = lineThrough(m.shape, from, to, bend)
      const style = cleanShapeStyle(made.style)
      void changeShape(m.id, style, { placed: { clipId, place: placeFromPixels(pictureAround(style, made.body), W, H) } })
    },
    [timeline, changeShape]
  )

  /** A straight line bent into a curve, or a curved one straightened, keeping its ends where they are. */
  const bendShape = useCallback(
    (clipId: string, on: boolean): void => {
      if (!timeline) return
      const found = findVideoClip(timeline, clipId)
      const m = found ? timeline.media.find((x) => x.id === found.clip.mediaId) : undefined
      if (!found || !m?.shape) return
      const { width: W, height: H } = timeline.output
      const p = found.clip.transform.place
      const now = linePoints(m.shape, bodyWithin(m.shape, { x: p.x * W, y: p.y * H, w: p.w * W, h: p.h * H }))
      shapeLine(clipId, now.from, now.to, on ? bendFor(now.from, now.to, 0.25) : null)
    },
    [timeline, shapeLine]
  )

  // A shape's box made larger or smaller by hand is drawn again at that size
  // once the pointer is let go: its body takes the change, and its outline
  // and arrowheads keep their size rather than being stretched.
  useEffect(() => {
    if (!timeline || !selected || targetAspect(timeline) === null || resized.current !== selected) return
    const found = findVideoClip(timeline, selected)
    const m = found ? timeline.media.find((x) => x.id === found.clip.mediaId) : undefined
    if (!found || !m?.shape) return
    const shownW = found.clip.transform.place.w * timeline.output.width
    const shownH = found.clip.transform.place.h * timeline.output.height
    if (Math.abs(shownW - m.width) <= 2 && Math.abs(shownH - m.height) <= 2) return
    const style = m.shape
    const id = m.id
    const wait = window.setInterval(() => {
      if (pressed.current) return
      window.clearInterval(wait)
      resized.current = null
      // Part of the resize it finishes, not a step of its own: one undo takes the whole of it back.
      void changeShape(id, resizedShape(style, shownW, shownH), { unrecorded: true })
    }, 150)
    return () => window.clearInterval(wait)
  }, [timeline, selected, changeShape])

  /** The Inspector's Shape group, kept the same from one render to the next unless the saved styles change. */
  const inspectorShapes = useMemo(
    () => ({
      onChange: (mediaId: string, style: ShapeStyle, continuing: boolean) => void changeShape(mediaId, style, { continuing }),
      onBend: (clipId: string, on: boolean) => bendShape(clipId, on),
      onSave: (name: string, style: ShapeStyle) => {
        storeShapes(saveShape(savedShapesNow.current, name, style))
        showToast({ kind: 'shape', text: `Saved "${name}" in the Shape menu, for every project.` })
      },
      suggestedName: (style: ShapeStyle) => nextShapeName(savedShapes, style)
    }),
    [changeShape, bendShape, storeShapes, savedShapes]
  )
  const timelineShapes = useMemo(
    () => ({ saved: savedShapes, onPick: pickShape, onRemoveSaved: (id: string) => storeShapes(removeShape(savedShapesNow.current, id)) }),
    [savedShapes, pickShape, storeShapes]
  )

  return { shapeDrawing, setShapeDrawing, shapeDrawn, shapeLanded, shapeLine, inspectorShapes, timelineShapes }
}
