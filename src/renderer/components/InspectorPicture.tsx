/** The Inspector's picture: a video clip's Frame, Picture in picture, Zoom, Crop, Look, Blur and Tools groups. */
import { useRef, type JSX } from 'react'
import type { Clip, ProjectMedia, Timeline } from '../../shared/project'
import { MAIN_PICTURE, cornerPlace, isCornerPlace, isOverlay, isStill, isText, isDrawn, newId, targetAspect, pipOf, zoomOf } from '../../shared/project'
import { FULL_PLACE, isFullFrame } from '../../shared/layout'
import { cropAtEdge } from '../../shared/crop-geometry'
import { MAX_LAYERS, cropInView, isSideBySide, placeAspect, viewOf, viewsOf, type NamedLayout } from '../../shared/layout'
import { ADJUSTMENTS, BACKGROUND_STRENGTH, LOOKS } from '../../shared/looks'
import { toolsFor } from '../../shared/clip-tools'
import { makeToolChoice } from './tool-choice'
import { MOST_BOXES, newBox } from '../../shared/blur'
import { ink, pictureColour, space, radius, surface, type } from '../theme'
import { useSectionShown } from './section-host'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Check } from '../ui/Check'
import { cropsAgree, withoutPicture } from '../../shared/on-selected'
import { PipSection, canHavePip } from './PipSection'
import { ZoomGroup, type ZoomTools } from './ZoomGroup'

import { SavedLayouts, type SavedLayoutActions } from './SavedLayouts'
import type { SavedLayout } from '../../shared/saved-layouts'
import { usePlayheadRead, type PlayheadStore } from '../state/playheadStore'
import { cropEdit, onEnd, shownCrop as shownCropOf } from '../../shared/zoom-edit'

import type { Keymap } from '../../shared/keymap'
import { Group, PERCENT_GAP, PERCENT_TRACK, PERCENT_VALUE, Percent, dim, mono, row, small, type Edit, type Painting } from './inspector-parts'
import { CropNumber, FrameControls, OverlayControls } from './InspectorPictureControls'
import { HelpTip } from '../ui/HelpTip'

const LAYOUT_NAMES: Record<Clip['layout'], string> = {
  single: 'Single',
  split: 'Split',
  pip: 'Picture in picture',
  custom: 'Custom'
}

const LAYOUT_BUTTONS: { kind: NamedLayout; label: string; title: string }[] = [
  { kind: 'single', label: 'Single', title: 'One picture filling the frame' },
  { kind: 'split', label: 'Split', title: 'Two pictures, each filling half the frame' },
  { kind: 'pip', label: 'Picture in picture', title: 'A box in the top right corner over the whole frame' }
]

export function PicturePanel(props: {
  clip: Clip
  media: ProjectMedia | undefined
  timeline: Timeline
  sameSource: number
  picture: string
  zoomEnd: boolean
  onZoomEnd: (end: boolean) => void
  zoomPicked: boolean
  onZoomPicked: (picked: boolean) => void
  zoomTools?: ZoomTools | undefined
  /** The crop keeps its place's shape. */
  aspectLocked: boolean
  onAspectLock: (locked: boolean) => void
  onPicture: (picture: string) => void
  onEdit: Edit
  /** The format painter: armed for one clip, for every clip until Esc, or off. */
  painting?: Painting
  onPaint?: ((how: Painting) => void) | undefined
  onCopyCrop?: (() => void) | undefined
  /** Which of the clip's blurred boxes is being moved on the Source view, if any (plan 85). */
  blurBox?: number | null | undefined
  onBlurBox?: ((index: number | null) => void) | undefined
  /** Framings saved under a name, and what the Frame group's row of them does. */
  savedLayouts?: readonly SavedLayout[] | undefined
  layoutActions?: SavedLayoutActions | undefined
  onPasteCrop?: (() => void) | undefined
  /** The playhead, which the Zoom group and the Crop numbers of a clip that zooms follow. */
  playhead?: PlayheadStore | undefined
  marks: { in: number | null; out: number | null }
  keymap?: Keymap | undefined
  onSeek: (frame: number) => void
  /** The other selected clips a change to this picture's place or crop is made on too (note 32). */
  alsoChanged?: readonly string[] | undefined
}): JSX.Element {
  const { clip, media, timeline } = props
  const framed = targetAspect(timeline) !== null
  // Which picture the sections work on, chosen once at the top (task 101):
  // wherever Zoom or Crop is drawn, the switch is drawn above it.
  const zoomShown = useSectionShown('Zoom')
  const cropShown = useSectionShown('Crop')
  const pictureSections = zoomShown || cropShown
  const overlay = media !== undefined && isOverlay(media)
  const { width: frameW, height: frameH } = timeline.output
  const layer = clip.layers.find((l) => l.id === props.picture)
  const picture = layer ? layer.id : MAIN_PICTURE
  // The chosen picture's crop at the playhead, which for a picture that zooms
  // is its keyframes' there. Read as the crop itself, so the panel is drawn
  // again when the crop changes and not on every frame played.
  // A Simple zoom shows its Start or End, whichever is chosen, wherever the playhead is.
  const zooms = (zoomOf(clip, picture).keys?.length ?? 0) > 0
  const shownCrop = usePlayheadRead(props.playhead, (f) => {
    if (!zooms) return ''
    const r = shownCropOf(clip, f, picture, props.zoomEnd)
    return `${r.x},${r.y},${r.w},${r.h}`
  })
  const pictureCrop = (() => {
    if (shownCrop === '') return zoomOf(clip, picture).crop
    const [x, y, w, h] = shownCrop.split(',').map(Number)
    return { x: x!, y: y!, w: w!, h: h! }
  })()
  const selected = { crop: pictureCrop, place: (layer ?? clip.transform).place }
  const corner = media ? cornerPlace(media, clip.transform.crop, frameW, frameH) : null
  const inCorner = media !== undefined && isCornerPlace(media, clip.transform.crop, clip.transform.place, frameW, frameH)
  const where = isFullFrame(clip.transform.place) ? 'Full frame' : inCorner ? 'Corner' : 'Custom'
  // With the lock on, a crop keeps its place's shape: a width typed sets the height, and the other way round.
  const locked = props.aspectLocked && framed
  const shape = placeAspect(selected.place, frameW, frameH)
  /** A size of the place's shape, as large as asked but no larger than the recording. */
  const lockedSize = (w: number, h: number): { w: number; h: number } => {
    let size = { w, h }
    if (media && size.w > media.width) size = { w: media.width, h: media.width / shape }
    if (media && size.h > media.height) size = { w: media.height * shape, h: media.height }
    return { w: Math.round(size.w), h: Math.round(size.h) }
  }
  /** The playhead a visit to the Crop numbers started at, whose keyframe they change. */
  const cropAt = useRef<number | null>(null)
  const setCropTo = (rect: { x: number; y: number; w: number; h: number }, continuing = false): void =>
    props.onEdit(cropEdit(clip, cropAt.current ?? props.playhead?.get() ?? clip.timelineStart, rect, picture, props.zoomEnd, props.zoomPicked), continuing)
  /**
   * The crop when a crop number was entered: what the numbers typed there are
   * worked from, so a number typed past the edge and then taken back gives
   * back the width it took.
   */
  const cropBase = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const base = (): { x: number; y: number; w: number; h: number } => cropBase.current ?? selected.crop
  const cropField = {
    onEnter: () => {
      cropBase.current = selected.crop
      cropAt.current = props.playhead?.get() ?? null
    },
    onLeave: () => {
      cropBase.current = null
      cropAt.current = null
    },
    onRevert: () => {
      if (cropBase.current) setCropTo(cropBase.current, true)
    }
  }

  const placeAt = (place: typeof FULL_PLACE): void =>
    props.onEdit({ kind: 'setPlace', clipId: clip.id, picture: MAIN_PICTURE, place, reshapeCrop: true })

  // Bugs and notes 2, note 25: each picture in its own colour, the same on its
  // button, its boxes on the views, and the Zoom and Crop headings.
  const colourOf = (id: string): string => pictureColour(clip.layers.findIndex((l) => l.id === id) + 1)
  const pictureButton = (id: string, label: string, testid = 'picture'): JSX.Element => (
    <Button
      key={id}
      testid={testid}
      data={{ 'data-picture-id': id, 'data-selected': id === picture ? 'yes' : 'no' }}
      size="small"
      pressed={id === picture}
      onClick={() => props.onPicture(id)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: radius.round, background: colourOf(id), flexShrink: 0 }} />
        {label}
      </span>
    </Button>
  )
  /** Which picture Zoom and Crop are for, in its colour, when there is more than one. */
  const badge =
    clip.layers.length > 0 ? (
      <span
        data-testid="picture-badge"
        style={{
          marginLeft: 'auto',
          padding: '0 6px',
          font: type.meta,
          fontWeight: 600,
          lineHeight: '16px',
          borderRadius: radius.chip,
          background: colourOf(picture),
          color: ink.onAccent
        }}
      >
        {layer ? `Picture ${clip.layers.indexOf(layer) + 2}` : 'Main'}
      </span>
    ) : undefined

  // Several clips selected: a move or a crop is made on each that has this picture.
  const also = props.alsoChanged ?? []
  const skipped = also.length > 0 ? withoutPicture(timeline, clip.id, picture, also) : 0
  const pictureName = layer ? `Picture ${clip.layers.indexOf(layer) + 2}` : 'the main picture'
  const selectionNote =
    also.length > 0 ? (
      <p data-testid="selection-note" style={{ font: type.meta, color: ink.secondary, margin: `0 0 ${space.xs}px` }}>
        Changes {also.length + 1 - skipped} selected clips
        {skipped > 0 ? `; ${skipped === 1 ? 'one' : skipped} without ${pictureName} ${skipped === 1 ? 'is' : 'are'} left as ${skipped === 1 ? 'it is' : 'they are'}` : ''}.
      </p>
    ) : null
  const agree = also.length > 0 ? cropsAgree(timeline, clip.id, picture, also) : { x: true, y: true, w: true, h: true }

  return (
    <>
      {/*
        Task 101: one switch for the picture Zoom, Crop and the rest act on,
        held at the top of the Inspector while it scrolls, so animating
        Picture 2 never means going back up to choose it.
      */}
      {framed && clip.layers.length > 0 && pictureSections && (
        <div
          data-testid="picture-switch"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 3,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 4,
            padding: `${space.xs}px 0`,
            background: surface.panel,
            borderBottom: `1px solid ${surface.line}`
          }}
        >
          <span style={{ font: type.meta, color: ink.muted, marginRight: 2 }}>Working on</span>
          {pictureButton(MAIN_PICTURE, 'Main', 'switch-picture')}
          {clip.layers.map((l, i) => pictureButton(l.id, `Picture ${i + 2}`, 'switch-picture'))}
        </div>
      )}
      <Group name="Frame">
      {selectionNote}
      <div style={row}>
        <span style={dim}>{media && isText(media) ? 'Text' : media?.shape ? 'Shape' : media?.colour ? 'Colour' : media && isStill(media) ? 'Image' : 'Recording'}</span>
        <span style={mono}>
          {media?.width}x{media?.height}
        </span>
      </div>

      {/* Split and Picture in picture lay out a recording's views: an overlay has none. */}
      {!overlay && (
      <div style={row}>
        <span style={dim}>Layout</span>
        <span data-testid="layout" data-layout={clip.layout}>
          {LAYOUT_NAMES[clip.layout]}
        </span>
      </div>
      )}
      {framed ? (
        <>
          {!overlay && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {LAYOUT_BUTTONS.map((b) => (
              <Button
                key={b.kind}
                testid={`layout-${b.kind}`}
                size="small"
                pressed={clip.layout === b.kind}
                title={b.title}
                onClick={() => {
                  props.onEdit({ kind: 'applyLayout', clipId: clip.id, layout: b.kind })
                  if (b.kind === 'single') props.onPicture(MAIN_PICTURE)
                }}
              >
                {b.label}
              </Button>
            ))}
            <Button
              testid="layout-swap"
              size="small"
              title="Exchange the two views"
              disabled={clip.layers.length === 0}
              whyDisabled="There is only one picture to swap"
              onClick={() => props.onEdit({ kind: 'swapPictures', clipId: clip.id })}
            >
              Swap
            </Button>
          </div>
          )}
          {/*
            Split and Picture in picture lay out the two views a recording
            holds side by side. On one that holds a single view they still
            give the clip two pictures, each with its own crop and place,
            which is worth having: you crop them apart yourself. What was
            wrong was that both arrive showing the same shot and nothing said
            they would, so the result read as broken.
          */}
          {media && !overlay && !isSideBySide(media.width, media.height) && (
            <HelpTip
              testid="layout-one-view"
              text={`Split and Picture in picture lay out the two views a recording holds side by side, as a 3840x1080 capture does. This one is ${media.width}x${media.height} and holds one, so both pictures start from the same shot and you crop them apart.`}
              tutorial="320-layouts"
            />
          )}

          {/* An image or a text placed freely: over the whole frame, or in the corner. A recording's small picture is in its own section. */}
          {overlay && (
          <>
          <div style={{ ...row, marginTop: 6 }}>
            <span style={dim}>Place</span>
            <span data-testid="picture-place" data-place-kind={where}>
              {where}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Button
              testid="picture-full"
              size="small"
              pressed={where === 'Full frame'}
              title="Its main picture over the whole frame"
              onClick={() => placeAt(FULL_PLACE)}
            >
              Full frame
            </Button>
            <Button
              testid="picture-corner"
              size="small"
              pressed={where === 'Corner'}
              title="Its main picture in a box in the top right corner, over the tracks below"
              disabled={!corner}
              whyDisabled="This shape has no corner to put it in"
              onClick={() => corner && placeAt(corner)}
            >
              Corner
            </Button>
          </div>
          </>
          )}

          {media && isOverlay(media) && <OverlayControls clip={clip} frame={timeline.output} fps={timeline.fps} onEdit={props.onEdit} />}

          {/* Bars round the pictures: black, or the picture itself blurred. Not for an image, which keeps its clear ones. */}
          {!overlay && (
            <div style={{ ...row, marginTop: 6 }}>
              <span style={dim}>Bars</span>
              <Check
                testid="picture-blur-fill"
                checked={clip.blurFill === true}
                onChange={(on) => props.onEdit({ kind: 'setBlurFill', clipId: clip.id, on })}
              >
                Fill with the picture, blurred
              </Check>
            </div>
          )}

          {/*
            A further picture's frame: corners, border and shadow. The picture
            in picture's own small picture has them in its section instead.
          */}
          {layer !== undefined && layer.id !== pipOf(timeline, clip.id)?.picture && (
            <FrameControls
              clipId={clip.id}
              picture={layer ? layer.id : MAIN_PICTURE}
              style={layer ? layer.style : clip.transform.style}
              onEdit={props.onEdit}
            />
          )}

          <div style={{ ...row, marginTop: 6 }}>
            <span style={dim}>Pictures</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {pictureButton(MAIN_PICTURE, 'Main')}
            {clip.layers.map((l, i) => (
              <span key={l.id} style={{ display: 'inline-flex', gap: 1 }}>
                {pictureButton(l.id, `Picture ${i + 2}`)}
                <Button
                  testid="picture-remove"
                  data={{ 'data-picture-id': l.id }}
                  size="small"
                  variant="ghost"
                  icon="close"
                  title={`Remove picture ${i + 2}`}
                  onClick={() => {
                    props.onEdit({ kind: 'removeLayer', clipId: clip.id, layerId: l.id })
                    if (l.id === picture) props.onPicture(MAIN_PICTURE)
                  }}
                />
              </span>
            ))}
            <Button
              testid="add-layer"
              size="small"
              icon="add"
              disabled={clip.layers.length >= MAX_LAYERS}
              whyDisabled={`A clip can carry ${MAX_LAYERS + 1} pictures at most`}
              onClick={() => {
                const id = newId()
                props.onEdit({ kind: 'addLayer', clipId: clip.id, layerId: id })
                props.onPicture(id)
              }}
              title="Another picture of this recording, over the main one"
            >
              Add a picture
            </Button>
          </div>
          <Button
            testid="apply-layout-all"
            size="small"
            disabled={props.sameSource === 0}
            whyDisabled="This recording is on the track once"
            onClick={() => props.onEdit({ kind: 'applyLayoutToSource', clipId: clip.id })}
            style={{ marginTop: 6, alignSelf: 'flex-start' }}
            title="Give every other clip of this recording on this track the same pictures"
          >
            Apply to all clips of this recording
          </Button>
        </>
      ) : (
        <p data-testid="layers-unavailable" style={{ ...small, color: ink.muted, margin: '2px 0' }}>
          Extra pictures and places need a shape with a size. Handoff has none, so each clip on V1 shows its main picture only,
          and the tracks above V1 are left out.
        </p>
      )}
      <Button
        testid="paint-framing"
        size="small"
        icon="paint"
        pressed={props.painting !== null && props.painting !== undefined}
        data={{ 'data-painting': props.painting ?? 'off' }}
        // The second click of a double click comes with a detail of 2: it
        // keeps the painter on, where the first click alone arms it once.
        onClick={(e) => props.onPaint?.(e.detail >= 2 ? 'sticky' : props.painting ? null : 'once')}
        style={{ marginTop: 6, alignSelf: 'flex-start' }}
        title="Click, then click another clip to give it this framing. Double click to keep painting clip after clip, until Esc."
      >
        {props.painting === 'sticky' ? 'Painting framing, Esc to stop' : props.painting === 'once' ? 'Click a clip to paint it' : 'Paint this framing'}
      </Button>
      {props.layoutActions && <SavedLayouts layouts={props.savedLayouts ?? []} {...props.layoutActions} />}

      </Group>

      {/*
        Everything about the small picture, whichever way the clip got one: a
        recording's two views laid out, or a recording over another track.
      */}
      <Group name="Picture in picture" testid="pip-group" when={canHavePip(timeline, clip, media)}>
        {media && <PipSection timeline={timeline} clip={clip} media={media} onEdit={props.onEdit} onPicture={props.onPicture} />}
      </Group>

      {/*
        The main picture's zoom: Scale and Position at the playhead, and the
        keyframes that change them over the clip. A text has no crop to zoom.
      */}
      <Group name="Zoom" testid="zoom-section" when={media !== undefined && !isDrawn(media) && media.colour === undefined} badge={badge}>
        {media && (
          <ZoomGroup
            clip={clip}
            media={media}
            timeline={timeline}
            playhead={props.playhead}
            marks={props.marks}
            keymap={props.keymap}
            picture={picture}
            zoomEnd={props.zoomEnd}
            onZoomEnd={props.onZoomEnd}
            zoomPicked={props.zoomPicked}
            onZoomPicked={props.onZoomPicked}
            tools={props.zoomTools}
            onEdit={props.onEdit}
            onSeek={props.onSeek}
          />
        )}
      </Group>

      {/* A text's box is its words: there is nothing of it to crop away. */}
      <Group name="Crop" when={!(media && (isDrawn(media) || media.colour !== undefined))} badge={badge}>

      {selectionNote}
      <Check
        testid="aspect-lock"
        checked={props.aspectLocked && framed}
        disabled={!framed}
        whyDisabled="Handoff has no fixed shape to lock a crop to"
        onChange={props.onAspectLock}
        style={{ alignSelf: 'flex-start', marginBottom: space.xs }}
      >
        <span title="Keep each crop the shape of its place in the frame">Lock to shape</span>
      </Check>
      <div style={{ ...row, paddingTop: 0 }}>
        <span style={dim}>In source pixels</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
        {/* The number typed is the one taken: past the edge, the crop gets narrower or shorter instead. */}
        <CropNumber
          label="X"
          testid="crop-x"
          value={selected.crop.x}
          mixed={!agree.x}
          {...cropField}
          onApply={(x, continuing) =>
            setCropTo(media ? cropAtEdge(base(), 'x', x, { w: media.width, h: media.height }, locked ? shape : null) : { ...base(), x }, continuing)
          }
        />
        <CropNumber
          label="Y"
          testid="crop-y"
          value={selected.crop.y}
          mixed={!agree.y}
          {...cropField}
          onApply={(y, continuing) =>
            setCropTo(media ? cropAtEdge(base(), 'y', y, { w: media.width, h: media.height }, locked ? shape : null) : { ...base(), y }, continuing)
          }
        />
        <CropNumber
          label="Width"
          testid="crop-w"
          value={selected.crop.w}
          mixed={!agree.w}
          {...cropField}
          onApply={(w, continuing) => setCropTo(locked ? { ...base(), ...lockedSize(w, w / shape) } : { ...base(), w }, continuing)}
        />
        <CropNumber
          label="Height"
          testid="crop-h"
          value={selected.crop.h}
          mixed={!agree.h}
          {...cropField}
          onApply={(h, continuing) => setCropTo(locked ? { ...base(), ...lockedSize(h * shape, h) } : { ...base(), h }, continuing)}
        />
      </div>
      {media && isSideBySide(media.width, media.height) && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {viewsOf(media.width, media.height).map((view, i) => (
            <Button
              key={i}
              testid={i === 0 ? 'crop-left-view' : 'crop-right-view'}
              size="small"
              onClick={() => setCropTo(locked ? cropInView(view, shape) : view)}
              title={
                locked
                  ? `The largest crop of this picture's shape, centred on the ${i === 0 ? 'left' : 'right'} half`
                  : `The whole ${i === 0 ? 'left' : 'right'} half`
              }
            >
              {i === 0 ? 'Left view' : 'Right view'}
            </Button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      <Button
        testid="crop-reset"
        size="small"
        onClick={() => {
          const m = media
          if (!m) return
          // The shape of the selected picture's place: for a clip with no
          // layers, the whole frame, which is the export shape as always.
          const rect = framed
            ? cropInView(viewOf(selected.crop, m.width, m.height), placeAspect(selected.place, frameW, frameH))
            : { x: 0, y: 0, w: m.width, h: m.height }
          // A Simple zoom's End chosen: the reset is End's, not the whole clip's.
          props.onEdit(
            onEnd(clip, picture, props.zoomEnd)
              ? { kind: 'setSimpleZoom', clipId: clip.id, change: { end: rect }, ...(layer ? { picture } : {}) }
              : { kind: 'setCrop', clipId: clip.id, rect, picture }
          )
        }}
        title="Set this picture's crop to the largest box of its place's shape, centred"
      >
        Reset crop
      </Button>
      <Button
        testid="crop-copy"
        size="small"
        onClick={() => props.onCopyCrop?.()}
        title="Copy this crop, to paste onto other clips without their place, layers or layout"
      >
        Copy crop
      </Button>
      <Button
        testid="crop-paste"
        size="small"
        disabled={props.onPasteCrop === undefined}
        whyDisabled="Copy a crop first"
        onClick={() => props.onPasteCrop?.()}
        title="Give every selected clip the copied crop, as the same share of its picture"
      >
        Paste crop
      </Button>
      </div>
      </Group>

      {/*
        A look on every picture of the clip, at a strength, and the four
        sliders on top of it (plan 85), as the Output view draws them and the
        export writes them. None gives the recording its own colour back.
      */}
      <Group name="Look" testid="look-section">
        {/* The colour presets in one dropdown rather than a row of buttons (task 57). */}
        <div style={row} data-testid="clip-look" data-look={clip.look ?? 'none'}>
          <span style={dim}>Colour</span>
          {/* As wide as the slider tracks below and lined up with them, the space of their % after it (task 79). */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: PERCENT_GAP }}>
            <Select
              label="Colour"
              testid="look-select"
              value={clip.look ?? 'none'}
              choices={[{ value: 'none', label: 'None' }, ...LOOKS.map((l) => ({ value: l.id, label: l.name }))]}
              onChange={(v) => props.onEdit({ kind: 'setLook', clipId: clip.id, look: v === 'none' ? null : v })}
              // The slider keeps the browser's 2px either side of its track, so this does too.
              style={{ width: PERCENT_TRACK, margin: '0 2px' }}
            />
            <span style={{ minWidth: PERCENT_VALUE }} />
          </span>
        </div>
        {clip.look !== undefined && (
          <div style={row}>
            <span style={dim}>Strength</span>
            <Percent
              testid="look-strength"
              value={(clip.lookStrength ?? 100) / 100}
              min={0}
              max={100}
              step={1}
              title="How strongly the look is on: 100% is all of it"
              onChange={(v, c) => props.onEdit({ kind: 'setLookStrength', clipId: clip.id, strength: Math.round(v * 100) }, c)}
            />
          </div>
        )}
        {ADJUSTMENTS.map((a) => (
          <div key={a.id} style={row}>
            <span style={dim}>{a.name}</span>
            <Percent
              testid={`adjust-${a.id}`}
              value={(clip.adjust?.[a.id] ?? 0) / 100}
              min={-100}
              max={100}
              step={1}
              title={`${a.title}. 0 is as recorded.`}
              onChange={(v, c) => props.onEdit({ kind: 'setColourAdjust', clipId: clip.id, change: { [a.id]: Math.round(v * 100) } }, c)}
            />
          </div>
        ))}
        {clip.adjust !== undefined && (
          <Button
            testid="adjust-reset"
            size="small"
            title="Put brightness, contrast, saturation and warmth back to as recorded"
            onClick={() => props.onEdit({ kind: 'setColourAdjust', clipId: clip.id, change: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } })}
          >
            Reset the sliders
          </Button>
        )}
      </Group>

      {/*
        Blur (plan 85): the whole picture, or boxes on the recording, each
        moved and sized on the Source view as a crop is. A text, a shape or a
        colour is drawn by the app and has nothing to hide.
      */}
      {!props.media?.text && !props.media?.shape && !props.media?.colour && (
        <Group name="Blur" testid="blur-section">
          <div style={row}>
            <span style={dim}>Whole picture</span>
            <Percent
              testid="blur-whole"
              value={(clip.blur ?? 0) / 100}
              min={0}
              max={100}
              step={1}
              title="Blur all of the picture. 0 is sharp."
              onChange={(v, c) => props.onEdit({ kind: 'setBlur', clipId: clip.id, amount: Math.round(v * 100) || null }, c)}
            />
          </div>
          {(clip.blurBoxes ?? []).map((b, i) => (
            <div key={i} style={row} data-testid="blur-box-row" data-editing={props.blurBox === i ? 'yes' : 'no'}>
              <Button
                testid="blur-box-edit"
                size="small"
                pressed={props.blurBox === i}
                title={props.blurBox === i ? 'Done moving this box' : 'Move and size this box on the Source view'}
                onClick={() => props.onBlurBox?.(props.blurBox === i ? null : i)}
              >
                Box {i + 1}
              </Button>
              <Percent
                testid="blur-box-amount"
                value={b.amount / 100}
                min={1}
                max={100}
                step={1}
                title="How much this box is blurred"
                onChange={(v, c) =>
                  props.onEdit({ kind: 'setBlurBoxes', clipId: clip.id, boxes: (clip.blurBoxes ?? []).map((x, j) => (j === i ? { ...x, amount: Math.max(1, Math.round(v * 100)) } : x)) }, c)
                }
              />
              <Button
                testid="blur-box-remove"
                size="small"
                icon="close"
                title="Take this box away"
                onClick={() => {
                  if (props.blurBox !== undefined && props.blurBox !== null && props.blurBox >= i) props.onBlurBox?.(null)
                  props.onEdit({ kind: 'setBlurBoxes', clipId: clip.id, boxes: (clip.blurBoxes ?? []).filter((_, j) => j !== i) })
                }}
              />
            </div>
          ))}
          <Button
            testid="blur-box-add"
            size="small"
            disabled={(clip.blurBoxes ?? []).length >= MOST_BOXES}
            whyDisabled={`A clip can have ${MOST_BOXES} boxes`}
            title="Blur a box on the recording, such as a name or a notification, and move it on the Source view"
            onClick={() => {
              const boxes = [...(clip.blurBoxes ?? []), newBox()]
              props.onEdit({ kind: 'setBlurBoxes', clipId: clip.id, boxes })
              props.onBlurBox?.(boxes.length - 1)
            }}
          >
            Add a blurred box
          </Button>
        </Group>
      )}

      {/* Tools that change what the picture shows, background removal first (plan 90). */}
      {toolsFor(props.media).length > 0 && (
        <Group name="Tools" testid="tools-section">
          {toolsFor(props.media).map((tool) => (
            <div key={tool.id} data-testid={`tool-${tool.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={dim}>{tool.name}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tool.choices(clip).map((c) => (
                  <Button
                    key={c.id}
                    testid={`tool-${tool.id}-${c.id}`}
                    size="small"
                    pressed={c.current}
                    onClick={() => void makeToolChoice(c, clip, timeline.fps, props.onEdit)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {clip.removeBackground && (
            <div style={row}>
              <span style={dim}>Strength</span>
              <Percent
                testid="remove-background-strength"
                value={(clip.removeBackground.strength ?? BACKGROUND_STRENGTH) / 100}
                min={0}
                max={100}
                step={1}
                title="How much is taken out: higher takes out colours nearer the background's too"
                onChange={(v, c) =>
                  props.onEdit({ kind: 'setRemoveBackground', clipId: clip.id, removal: { ...clip.removeBackground!, strength: Math.round(v * 100) } }, c)
                }
              />
            </div>
          )}
        </Group>
      )}
    </>
  )
}
