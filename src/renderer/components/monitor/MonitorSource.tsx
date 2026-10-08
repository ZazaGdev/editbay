/**
 * What is drawn over the Source view: the pan and its zoom, and the crop box or a blurred box being moved.
 */

import type { Dispatch, JSX, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import type { PlayPosition } from '../../../shared/playback'
import type { Rect } from '../../../shared/project'
import { placeAspect, type Place } from '../../../shared/layout'
import type { Fit } from '../../../shared/crop-geometry'
import { boxFromPixels, boxInPixels, type BlurBox } from '../../../shared/blur'
import type { MonitorBox } from '../../../shared/monitor-layout'
import type { SourceZoom } from '../../../shared/source-zoom'
import { CropOverlay } from '../CropOverlay'
import { ZoomChip } from './ZoomChip'
import type { MonitorProps } from './monitor-props'

export function MonitorSource({
  props,
  at,
  source,
  sourceSize,
  zoom,
  setZoomed,
  startPan,
  shownFit,
  selected,
  named,
  others,
  ends,
  endChosen,
  editedClipId,
  editedPicture,
  editedBlur,
  framed,
  frameW,
  frameH
}: {
  props: MonitorProps
  at: PlayPosition | null
  source: MonitorBox
  sourceSize: { w: number; h: number } | null
  zoom: SourceZoom | null
  setZoomed: Dispatch<SetStateAction<{ mediaId: string; zoom: SourceZoom } | null>>
  startPan: (e: ReactPointerEvent) => void
  shownFit: Fit | null
  selected: { crop: Rect; place: Place } | null
  named: { name: string; colour: string } | undefined
  others: Rect[]
  ends: { start: Rect; end: Rect } | null
  endChosen: boolean
  editedClipId: string | undefined
  editedPicture: string
  editedBlur: BlurBox | null
  framed: boolean
  frameW: number
  frameH: number
}): JSX.Element {
  return (
    <>
      {/* Under the crop box: a drag on the picture pans it while zoomed, a double-click fits it again. */}
      <div
        data-testid="source-pan"
        onPointerDown={(e) => {
          if (e.button === 0) startPan(e)
        }}
        onDoubleClick={() => setZoomed(null)}
        style={{ position: 'absolute', inset: 0, zIndex: 2, cursor: zoom ? 'grab' : 'default' }}
      />
      {zoom && <ZoomChip testid="source-zoom" resetTestid="source-fit" scale={zoom.scale} onReset={() => setZoomed(null)} />}
      {/* A blurred box being moved, in place of the crop, on the recording it hides part of. */}
      {sourceSize && editedClipId && editedBlur && (
        <CropOverlay
          key={`${editedClipId}:blur:${props.blurBox}`}
          crop={boxInPixels(editedBlur, sourceSize.w, sourceSize.h)}
          label={`Blurred box ${(props.blurBox ?? 0) + 1}`}
          sourceWidth={sourceSize.w}
          sourceHeight={sourceSize.h}
          boxWidth={source.width}
          boxHeight={source.height}
          {...(shownFit ? { fit: shownFit } : {})}
          aspect={null}
          onChange={(rect, continuing) => {
            const boxes = (at?.clip.blurBoxes ?? []).map((b, i) => (i === props.blurBox ? boxFromPixels(rect, sourceSize.w, sourceSize.h, b.amount) : b))
            props.onBlurBoxes?.(editedClipId, boxes, continuing)
          }}
        />
      )}
      {/* A text's picture is its words: there is nothing of it to crop. */}
      {selected && sourceSize && editedClipId && !at?.media.text && !editedBlur && (
        <CropOverlay
          // A new clip or picture is a new overlay, which ends any drag begun
          // on the last one rather than carrying it on against this one.
          key={`${editedClipId}:${editedPicture}:${endChosen ? 'end' : 'start'}`}
          crop={selected.crop}
          picture={named}
          others={others}
          {...(ends
            ? {
                label: endChosen ? 'End' : 'Start',
                partner: { crop: endChosen ? ends.start : ends.end, label: endChosen ? 'Start' : 'End', isStart: endChosen }
              }
            : {})}
          sourceWidth={sourceSize.w}
          sourceHeight={sourceSize.h}
          boxWidth={source.width}
          boxHeight={source.height}
          {...(shownFit ? { fit: shownFit } : {})}
          // The crop's shape follows its own place, which for a clip with no
          // layers is the whole frame, so nothing changes for those.
          aspect={props.aspectLocked && framed ? placeAspect(selected.place, frameW, frameH) : null}
          onChange={(rect, continuing) => props.onCropChange(editedClipId, editedPicture, rect, continuing)}
        />
      )}
    </>
  )
}
