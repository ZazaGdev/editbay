/**
 * Texts and plain colours: adding one, drawing it again when it changes,
 * typing its words on the Output view, and drawing again what is missing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BLACK_SCREEN, findClip, findVideoClip, newId, sequenceOf, targetAspect, timelineOf, type Gap } from '../../shared/project'
import { DEFAULT_TEXT, scaledText, type TextStyle } from '../../shared/text'
import { MAX_VIDEO_TRACKS } from '../../shared/tracks'
import { renderColour, renderText } from '../text/draw'
import { renderShape } from '../shape/draw'
import { showToast } from '../state/toasts'
import type { AppLocals, Selecting } from './app-state'

export function useTexts({
  project,
  proj,
  sequenceId,
  playhead,
  timeline,
  selected,
  lastTextStyle,
  select
}: Pick<AppLocals, 'project' | 'proj' | 'sequenceId' | 'playhead' | 'timeline' | 'selected' | 'lastTextStyle'> & Pick<Selecting, 'select'>) {
  /**
   * Words over the video at the playhead: drawn first, then put on the
   * sequence as a source and a clip in one step, and selected, so its Text
   * section is the next thing to use.
   */
  const addText = useCallback(async (): Promise<void> => {
    if (!project) return
    const sequence = sequenceOf(project, sequenceId)
    if (targetAspect(timelineOf(project, sequence.id)) === null) {
      showToast({ kind: 'text', text: 'Text needs a shape with a frame to sit in. Handoff has none: choose another shape first.' })
      return
    }
    // As the text last changed looks, in any project, saying "Your text".
    const style = { ...(lastTextStyle.current ?? DEFAULT_TEXT), text: DEFAULT_TEXT.text }
    const drawn = await renderText(style)
    const clipId = newId()
    const after = await proj.edit({ kind: 'addText', sequenceId: sequence.id, mediaId: newId(), clipId, at: playhead, style, drawn })
    if (findClip(timelineOf(after, sequence.id), clipId)) select(clipId)
    else showToast({ kind: 'text', text: `No room for text here: a sequence has at most ${MAX_VIDEO_TRACKS} video tracks, and each is taken at the playhead.` })
  }, [project, proj, sequenceId, playhead, select])

  /**
   * A black screen, for an end card: at the playhead on V1, or straight after
   * its last clip, or above V1 where V1 is taken; or filling a gap exactly,
   * from the gap's menu. Selected, so its colour is the next thing to change.
   */
  const addBlackScreen = useCallback(
    async (fill?: Gap): Promise<void> => {
      if (!project) return
      const sequence = sequenceOf(project, sequenceId)
      const drawn = await renderColour(BLACK_SCREEN, sequence.output.width, sequence.output.height)
      const clipId = newId()
      const after = await proj.edit({
        kind: 'addColour',
        sequenceId: sequence.id,
        mediaId: newId(),
        clipId,
        at: fill ? fill.from : playhead,
        colour: BLACK_SCREEN,
        drawn,
        ...(fill ? { length: fill.to - fill.from, trackId: fill.trackId } : {})
      })
      if (findClip(timelineOf(after, sequence.id), clipId)) select(clipId)
      else showToast({ kind: 'text', text: `No room for a black screen here: a sequence has at most ${MAX_VIDEO_TRACKS} video tracks, and each is taken at the playhead.` })
    },
    [project, proj, sequenceId, playhead, select]
  )

  /** A plain colour changed from the Inspector: drawn again at the sequence's size, then kept. */
  const changeColour = useCallback(
    async (mediaId: string, colour: string): Promise<void> => {
      if (!project) return
      const sequence = sequenceOf(project, sequenceId)
      const drawn = await renderColour(colour, sequence.output.width, sequence.output.height)
      await proj.edit({ kind: 'setColour', mediaId, colour, drawn })
    },
    [project, proj, sequenceId]
  )

  /**
   * A text changed: drawn again, then kept. Drawing takes a moment, so a
   * change that arrives while an earlier one is drawing wins, and the earlier
   * one's picture is never kept over it.
   */
  const textAsked = useRef(new Map<string, number>())
  // A change that began an undo step and was overtaken before it was kept:
  // the one that overtakes it begins the step instead, rather than joining the one before.
  const textStepUnbegun = useRef(new Set<string>())
  const changeText = useCallback(
    async (mediaId: string, style: TextStyle, unrecorded = false, continuing = false): Promise<void> => {
      const ask = (textAsked.current.get(mediaId) ?? 0) + 1
      textAsked.current.set(mediaId, ask)
      if (!continuing) textStepUnbegun.current.add(mediaId)
      const drawn = await renderText(style)
      if (textAsked.current.get(mediaId) !== ask) return
      const joins = continuing && !textStepUnbegun.current.has(mediaId)
      textStepUnbegun.current.delete(mediaId)
      await proj.edit({ kind: 'setText', mediaId, style, drawn }, { unrecorded, ...(joins ? { continuing: true } : {}) })
    },
    [proj]
  )

  /**
   * A text's words being typed where it sits on the Output view: which text,
   * the words so far, and the words it had, which Escape puts back. The
   * picture is drawn again once, when the typing finishes.
   */
  const [textEdit, setTextEdit] = useState<{ clipId: string; mediaId: string; words: string; before: string } | null>(null)
  const startTextEdit = useCallback(
    (clipId: string) => {
      const found = timeline ? findVideoClip(timeline, clipId) : null
      const m = found ? timeline!.media.find((x) => x.id === found.clip.mediaId) : undefined
      if (!found || !m?.text) return
      if (selected !== clipId) select(clipId)
      setTextEdit({ clipId, mediaId: m.id, words: m.text.text, before: m.text.text })
    },
    [timeline, selected, select]
  )
  const endTextEdit = useCallback(
    (words: string | null) => {
      const edit = textEdit
      setTextEdit(null)
      if (!edit || words === null || words === edit.before) return
      const style = timeline?.media.find((m) => m.id === edit.mediaId)?.text
      // One edit for the whole of the typing, so one undo takes it back.
      if (style) void changeText(edit.mediaId, { ...style, text: words })
    },
    [textEdit, timeline, changeText]
  )

  // Every text's picture on disk: one missing, as after the cache is cleared
  // or on another PC, is drawn again from its words before anything reads it.
  const textsChecked = useRef(new Set<string>())
  useEffect(() => {
    const texts = (project?.media ?? []).filter((m) => (m.text !== undefined || m.shape !== undefined || m.colour !== undefined) && !textsChecked.current.has(m.playablePath))
    if (texts.length === 0) return
    for (const m of texts) textsChecked.current.add(m.playablePath)
    void window.api.missingTexts(texts.map((m) => m.playablePath)).then(async (missing) => {
      for (const m of texts) {
        if (!missing.includes(m.playablePath)) continue
        if (m.colour) {
          const drawn = await renderColour(m.colour, m.width, m.height)
          await proj.edit({ kind: 'setColour', mediaId: m.id, colour: m.colour, drawn }, { unrecorded: true })
          continue
        }
        if (m.shape) {
          const drawn = await renderShape(m.shape)
          await proj.edit({ kind: 'setShapeStyle', mediaId: m.id, style: m.shape, drawn }, { unrecorded: true })
          continue
        }
        if (!m.text) continue
        const drawn = await renderText(m.text)
        // Told even when it lands where it was, so the preview loads it again.
        // Not a step of history: it is the same text, drawn where this PC keeps it.
        await proj.edit({ kind: 'setText', mediaId: m.id, style: m.text, drawn }, { unrecorded: true })
      }
    })
  }, [project?.media, proj])

  // A text's box made larger or smaller by a corner is drawn again at that
  // size once the pointer is let go, sharp rather than stretched.
  const pressed = useRef(false)
  useEffect(() => {
    const down = (): void => {
      pressed.current = true
    }
    const up = (): void => {
      pressed.current = false
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
    }
  }, [])
  /**
   * The clip whose box was last moved or scaled by hand. Only that is ever
   * drawn again at a new size: an undo that brings back an older size is not
   * a scale, and drawing after it would make a new edit and lose the redo.
   */
  const resized = useRef<string | null>(null)
  useEffect(() => {
    if (!timeline || !selected || targetAspect(timeline) === null || resized.current !== selected) return
    const found = findVideoClip(timeline, selected)
    const m = found ? timeline.media.find((x) => x.id === found.clip.mediaId) : undefined
    if (!found || !m?.text) return
    const shownW = found.clip.transform.place.w * timeline.output.width
    if (Math.abs(shownW - m.width) <= 2) return
    const style = m.text
    const id = m.id
    const wait = window.setInterval(() => {
      if (pressed.current) return
      window.clearInterval(wait)
      resized.current = null
      // Part of the scale it finishes, not a step of its own: one undo takes the whole scale back.
      void changeText(id, scaledText(style, shownW / m.width), true)
    }, 150)
    return () => window.clearInterval(wait)
  }, [timeline, selected, changeText])

  return { addText, addBlackScreen, changeColour, changeText, textEdit, setTextEdit, startTextEdit, endTextEdit, pressed, resized }
}
