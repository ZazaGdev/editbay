/**
 * What the memoised Inspector is given, with steady handlers, and where it is
 * drawn (plan 92). The Inspector's column and each section beside the timeline
 * are drawn from the same props, so a section is the same wherever it is.
 */

import { useMemo, type ComponentProps } from 'react'
import { DEFAULT_TEXT, type TextStyle } from '../../shared/text'
import { captionLook, otherTexts, textStyledAs } from '../../shared/apply-to-all'
import { renderText } from '../text/draw'
import type { SectionLayout } from '../../shared/section-layout'
import type { Inspector } from '../components/Inspector'
import type { SectionHost } from '../components/section-host'
import { useSteady } from '../state/useSteady'
import { endSectionDrag, startSectionDrag } from './sectionDrag'
import type { AppState } from './app-state'

export type InspectorProps = ComponentProps<typeof Inspector>

export function useInspectorProps(app: AppState): InspectorProps | null {
  const { windowSettings, setWindowSettings, timeline, framing, alsoChanged, peaks, selected, selectedCaption, aspectLocked, setAspectLocked, picture,
    zoomEnd, setZoomEnd, zoomPicked, setZoomPicked, zoomTools, choosePicture, captionMove, relocateHandPlaced, setRelocateHandPlaced, painter, paint, frameSelected, textEdit,
    blurBox, copiedCrop, savedLayouts, layoutActions, inspectorShapes, playheadStore, marks, keys, editClip, run, setCaptionMove, seek, setBlurBox,
    setView, changeColour, proj, changeText, lastTextStyle, project } = app
  const inspectorEdit = useSteady(editClip)
  const inspectorCopyCrop = useSteady(() => run('copyCrop'))
  const inspectorPasteCrop = useSteady(() => run('pasteCrop'))
  const inspectorRelocate = useSteady(() => setCaptionMove((m) => (m === 'all' ? null : 'all')))
  const inspectorFold = useSteady((name: string, folded: boolean) =>
    setWindowSettings({ inspectorFolds: { ...windowSettings.inspectorFolds, [name]: folded } })
  )
  const inspectorSeek = useSteady((frame: number) => seek(frame))
  // Steady, as every handler the Inspector is given: a new one each render drew it again on every frame of playback (audit 2026-10-01).
  const inspectorBlurBox = useSteady((index: number | null) => {
    setBlurBox(index)
    // Moved on the Source view, where the whole recording is.
    if (index !== null) setView('source')
  })
  const inspectorColourChange = useSteady((mediaId: string, colour: Parameters<typeof changeColour>[1]) => void changeColour(mediaId, colour))
  const inspectorCare = useSteady((mediaId: string, track: number, change: Parameters<NonNullable<InspectorProps['onCare']>>[2]) =>
    void proj.edit({ kind: 'setVoiceCare', mediaId, track, ...change })
  )
  const inspectorTextChange = useSteady((mediaId: string, style: TextStyle, continuing: boolean) => {
    void changeText(mediaId, style, false, continuing)
    // How it looks, not its words, is what a new text starts as.
    const was = timeline?.media.find((m) => m.id === mediaId)?.text
    if (was && JSON.stringify({ ...was, text: '' }) !== JSON.stringify({ ...style, text: '' })) {
      const kept = { ...style, text: DEFAULT_TEXT.text }
      lastTextStyle.current = kept
      void window.api.setAppSettings({ textStyle: kept })
    }
  })
  // Task 34: one text's look on every other text, drawn again, as one undo step.
  const applyTextsAll = useSteady(async (mediaId: string) => {
    const source = project?.media.find((m) => m.id === mediaId)?.text
    if (!project || !source) return
    const texts = await Promise.all(
      otherTexts(project, mediaId).map(async (m) => {
        const style = textStyledAs(source, m.text)
        return { mediaId: m.id, style, drawn: await renderText(style) }
      })
    )
    if (texts.length > 0) await proj.edit({ kind: 'setTexts', texts })
  })
  // Made again when the project's sources change, so the count shown is never one behind.
  const media = project?.media
  const countTexts = useMemo(() => (mediaId: string) => (media ? otherTexts({ media }, mediaId).length : 0), [media])
  const applyCaptionsAll = useSteady(() => {
    if (timeline) void proj.edit({ kind: 'captionStyleEverywhere', style: captionLook(timeline.captions.style) })
  })
  const otherSequences = Math.max(0, (project?.sequences.length ?? 1) - 1)
  const applyToAll = useMemo(
    () => ({ otherTexts: countTexts, onTexts: (id: string) => void applyTextsAll(id), otherSequences, onCaptions: applyCaptionsAll }),
    [countTexts, applyTextsAll, otherSequences, applyCaptionsAll]
  )
  if (!timeline) return null
  return {
    timeline: framing ?? timeline,
    alsoChanged,
    peaks,
    clipId: selected,
    captionId: selectedCaption,
    aspectLocked,
    onAspectLock: setAspectLocked,
    picture,
    zoomEnd,
    onZoomEnd: setZoomEnd,
    zoomPicked,
    onZoomPicked: setZoomPicked,
    zoomTools,
    onPicture: choosePicture,
    onEdit: inspectorEdit,
    relocating: captionMove === 'all',
    onRelocate: inspectorRelocate,
    relocateHandPlaced,
    onRelocateHandPlaced: setRelocateHandPlaced,
    painting: painter?.how ?? null,
    onPaint: paint,
    onFraming: frameSelected,
    textDraft: textEdit,
    onCopyCrop: inspectorCopyCrop,
    blurBox,
    onBlurBox: inspectorBlurBox,
    onPasteCrop: copiedCrop ? inspectorPasteCrop : undefined,
    savedLayouts,
    layoutActions,
    folds: windowSettings.inspectorFolds,
    onFold: inspectorFold,
    onTextChange: inspectorTextChange,
    applyToAll,
    shapes: inspectorShapes,
    onColourChange: inspectorColourChange,
    onCare: inspectorCare,
    playhead: playheadStore,
    marks,
    keymap: keys.keymap,
    onSeek: inspectorSeek
  }
}

/**
 * Where a drawing of the Inspector is: the column itself (`only` null) or one
 * section beside the timeline. Kept the same object while nothing in it
 * changes: every section reads it, and a new one each render would draw the
 * memoised Inspector again on every frame of playback.
 */
export function useSectionHost(
  only: string | null,
  layout: SectionLayout,
  setWindowSettings: AppState['setWindowSettings'],
  onApplies?: SectionHost['onApplies']
): SectionHost {
  return useMemo(
    () => ({
      only,
      layout,
      onLayout: (sections: SectionLayout) => setWindowSettings({ sections }),
      onDragStart: startSectionDrag,
      onDragEnd: endSectionDrag,
      ...(onApplies ? { onApplies } : {})
    }),
    [only, layout, setWindowSettings, onApplies]
  )
}
