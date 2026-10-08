/**
 * What is drawn over the Output view: the guides, a target per picture, the
 * caption, a text typed into, the place box and the handles and toolbars on it.
 */

import type { Dispatch, JSX, SetStateAction } from 'react'
import { ShapeDraw, ShapeHandles } from '../ShapeOnFrame'
import { MAIN_PICTURE, isOverlay, zoomOf, type Rect, type findVideoClip, type pipOf } from '../../../shared/project'
import { PIP_DEFAULT_MARGIN, type pipCorner, type PipShape } from '../../../shared/pip'
import type { PlayPosition } from '../../../shared/playback'
import type { Place } from '../../../shared/layout'
import type { Fit } from '../../../shared/crop-geometry'
import type { MonitorBox } from '../../../shared/monitor-layout'
import { titleSafeRect } from '../../../shared/safe-zones'
import type { TextStyle } from '../../../shared/text'
import { surface } from '../../theme'
import { Guides } from '../Guides'
import { PlaceOverlay } from '../PlaceOverlay'
import { PipToolbar } from '../PipToolbar'
import { TextEditBox } from '../TextEditBox'
import { CaptionBox } from '../CaptionBox'
import { captionBox, layoutCaption, type CaptionClip } from '../../../shared/captions'
import type { MonitorProps } from './monitor-props'

/** A caption as it would sit following the style, wherever it was put by hand. */
function followingStyle(c: CaptionClip): CaptionClip {
  const { at: _own, ...rest } = c
  return rest
}

export function MonitorProgram({
  props,
  at,
  program,
  outline,
  frameSize,
  framed,
  frameW,
  frameH,
  picture,
  pictureNameOf,
  grab,
  setGrab,
  shownCaption,
  typed,
  typedStyle,
  selected,
  named,
  editedClipId,
  editedPicture,
  othersOnScreen,
  pipHere,
  onShapeHidden
}: {
  props: MonitorProps
  at: PlayPosition | null
  program: MonitorBox
  outline: Fit | null
  frameSize: { width: number; height: number } | null
  framed: boolean
  frameW: number
  frameH: number
  picture: string
  pictureNameOf: (id: string) => string
  grab: { id: string; x: number; y: number } | null
  setGrab: Dispatch<SetStateAction<{ id: string; x: number; y: number } | null>>
  shownCaption: CaptionClip | undefined
  typed: ReturnType<typeof findVideoClip>
  typedStyle: TextStyle | undefined
  selected: { crop: Rect; place: Place } | null
  named: { name: string; colour: string } | undefined
  editedClipId: string | undefined
  editedPicture: string
  othersOnScreen: Rect[]
  /** The edited shape's own picture hidden while its handles are dragged (task 59), or shown again. */
  onShapeHidden: (hidden: boolean) => void
  pipHere: (NonNullable<ReturnType<typeof pipOf>> & { where: ReturnType<typeof pipCorner>; shape: PipShape }) | null
}): JSX.Element {
  return (
    <>
      {/* Before the place box, which is at the same height, so its handles are drawn over the lines. */}
      {outline && frameSize && props.guides && (
        <Guides
          fit={outline}
          frameWidth={frameSize.width}
          frameHeight={frameSize.height}
          thirds={props.guides.thirds}
          safeZone={props.guides.safeZone}
          cover={props.guides.cover === true}
        />
      )}

      {/*
        One target per picture of the clip, so a press on a picture in
        the frame starts editing it. The Pictures row in the Inspector
        used to be the only way to choose one, which made the second
        picture of a Split something you had to go and find.

        Drawn back to front and hit front to back: the pictures are
        composited in order with Picture in picture on top, so the last
        one drawn is the first that should answer a press.

        Before the place box in the DOM and at the same height, so where
        they overlap the place box wins. A press on the picture being
        edited moves it; a press on any other picks it.
      */}
      {framed && at && outline && (
        <>
          {[
            { id: MAIN_PICTURE, place: at.clip.transform.place },
            ...at.clip.layers.map((l) => ({ id: l.id, place: l.place }))
          ]
            .map((x, i) => ({ ...x, order: i }))
            .reverse()
            .map((x) => (
              <div
                key={x.id}
                data-testid="monitor-picture"
                data-picture-id={x.id}
                // Its name on hover, so the view says what a press will choose.
                title={at.clip.layers.length > 0 ? pictureNameOf(x.id) : undefined}
                data-selected={x.id === picture ? 'yes' : 'no'}
                onPointerDown={(e) => {
                  // Another picture: picked, and the same press goes on
                  // to move it, as the place box that appears for it
                  // takes the pointer from here.
                  if (x.id !== picture) {
                    setGrab({ id: x.id, x: e.clientX, y: e.clientY })
                    // Listened for from the press itself: a quick click
                    // lets go before any effect could start listening.
                    window.addEventListener('pointerup', () => setGrab(null), { once: true })
                  }
                  props.onPicture(x.id)
                }}
                style={{
                  position: 'absolute',
                  zIndex: 2,
                  left: outline.offsetX + x.place.x * outline.width,
                  top: outline.offsetY + x.place.y * outline.height,
                  width: x.place.w * outline.width,
                  height: x.place.h * outline.height,
                  cursor: x.id === picture ? 'move' : 'pointer',
                  touchAction: 'none',
                  // Turned with the picture, about the same centre, so a
                  // press lands on what is drawn and not on its upright box.
                  ...(x.id === MAIN_PICTURE && isOverlay(at.media) && at.clip.transform.rotation
                    ? { transform: `rotate(${at.clip.transform.rotation}deg)` }
                    : {})
                }}
              />
            ))}
        </>
      )}

      {/*
        The caption at the playhead, over the pictures, so a press on it
        is a press on the caption. Its box is always on the words as they
        are drawn. While Relocate is on, a drag moves the style, so it
        starts from where the style puts a caption; one placed on its own
        that the drag leaves where it is says so.
      */}
      {framed &&
        outline &&
        shownCaption &&
        props.onCaptionDrag && (
          <CaptionBox
            box={captionBox(layoutCaption(shownCaption, props.timeline.captions.style, frameW, frameH))}
            {...(props.captionMode === 'all'
              ? {
                  from: captionBox(layoutCaption(followingStyle(shownCaption), props.timeline.captions.style, frameW, frameH)),
                  staysPut: shownCaption.at !== undefined && props.relocateHandPlaced !== true
                }
              : {})}
            frameWidth={frameW}
            frameHeight={frameH}
            fit={outline}
            mode={props.captionMode ?? null}
            onPress={() => props.onCaptionPress?.(shownCaption.id)}
            onDoubleClick={() => props.onCaptionMoveOne?.(shownCaption.id)}
            onDrag={(at, continuing) => props.onCaptionDrag?.(at, continuing)}
          />
        )}

      {outline && typed && typedStyle && props.textEdit && (
        <TextEditBox
          key={props.textEdit.clipId}
          style={typedStyle}
          words={props.textEdit.words}
          box={{
            left: outline.offsetX + typed.clip.transform.place.x * outline.width,
            top: outline.offsetY + typed.clip.transform.place.y * outline.height,
            width: typed.clip.transform.place.w * outline.width,
            height: typed.clip.transform.place.h * outline.height
          }}
          onWords={(w) => props.onTextWords?.(w)}
          onEnd={(words) => props.onTextEditEnd?.(words)}
        />
      )}

      {/* Hidden while a text is typed into: its handles would sit over the words. */}
      {selected && framed && editedClipId && !props.textEdit && (
        <PlaceOverlay
          key={`${editedClipId}:${editedPicture}`}
          grab={grab?.id === editedPicture ? grab : undefined}
          place={selected.place}
          // The whole clip's crop, not the playhead's: a place reshaped
          // reshapes the clip's framing, and its zoom follows that.
          crop={zoomOf(at!.clip, editedPicture).crop}

          frameWidth={frameW}
          frameHeight={frameH}
          boxWidth={program.width}
          boxHeight={program.height}
          onChange={(place, continuing, reshaped, fromCrop) =>
            props.onPlaceChange(editedClipId, editedPicture, place, continuing, reshaped, fromCrop)
          }
          free={
            at && isOverlay(at.media) && editedPicture === MAIN_PICTURE && props.onTurn
              ? {
                  rotation: at.clip.transform.rotation ?? 0,
                  edges: !at.media.text,
                  onTurn: (degrees, continuing) => props.onTurn?.(editedClipId, degrees, continuing)
                }
              : undefined
          }
          others={othersOnScreen}
          snap={props.placeSnap !== false}
          {...(named ? { colour: named.colour, tag: named.name } : {})}

          safe={titleSafeRect(props.guides?.safeZone ?? 'none', frameW, frameH)}
          corners={
            pipHere && props.onClipEdit
              ? {
                  margin: pipHere.where.corner === 'custom' ? PIP_DEFAULT_MARGIN : pipHere.where.margin,
                  aspect: (pipHere.place.w * frameW) / Math.max(1, pipHere.place.h * frameH),
                  circle: pipHere.shape === 'circle',
                  // Part of the drag that put it there: one undo takes both back.
                  onSnap: (corner) => props.onClipEdit?.({ kind: 'setPip', clipId: editedClipId, change: { corner } }, true)
                }
              : undefined
          }
        />
      )}

      {/* A selected line or arrow, upright: handles on its ends and its bend. */}
      {selected && framed && editedClipId && outline && at?.media.shape?.kind === 'line' && editedPicture === MAIN_PICTURE &&
        !(at.clip.transform.rotation ?? 0) && !props.playing && props.onShapeLine && !props.shapeDraw && (
          <ShapeHandles
            key={`shape-handles:${editedClipId}`}
            style={at.media.shape}
            place={at.clip.transform.place}
            frame={outline}
            frameW={frameW}
            frameH={frameH}
            onChange={(from, to, bend) => props.onShapeLine?.(editedClipId, from, to, bend)}
            onHide={onShapeHidden}
          />
        )}

      {/* Drawing a shape picked from the Shape menu: a drag across the frame puts it there. */}
      {framed && outline && props.shapeDraw && (
        <ShapeDraw key={props.shapeDraw.id} style={props.shapeDraw.style} bent={props.shapeDraw.bent} frame={outline} frameW={frameW} onDrawn={props.shapeDraw.onDrawn} />
      )}

      {/* The small picture's own toolbar, beside it, while it is the picture being edited and nothing plays. */}
      {selected && framed && editedClipId && outline && program && pipHere && props.onClipEdit && !props.playing && !props.textEdit && (
        <PipToolbar
          key={`pip-toolbar:${editedClipId}:${pipHere.picture}`}
          clipId={editedClipId}
          picture={pipHere.picture}
          box={{
            left: outline.offsetX + pipHere.place.x * outline.width,
            top: outline.offsetY + pipHere.place.y * outline.height,
            width: pipHere.place.w * outline.width,
            height: pipHere.place.h * outline.height
          }}
          area={{ width: program.width, height: program.height }}
          size={pipHere.place.w}
          corner={pipHere.where.corner}
          shape={pipHere.shape}
          style={pipHere.style}
          onEdit={(e) => props.onClipEdit?.(e)}
          {...(props.onOutOfTheWay ? { onOutOfTheWay: props.onOutOfTheWay } : {})}
        />
      )}

      {outline && (
        <div
          data-testid="frame-outline"
          data-frame={`${frameSize!.width}x${frameSize!.height}`}
          style={{
            position: 'absolute',
            // Above the preview's canvas, which is at 1 and added to the stage after this.
            zIndex: 2,
            // A line 2 pixels out from the frame, so it never covers the picture's edge.
            left: outline.offsetX - 3,
            top: outline.offsetY - 3,
            width: outline.width + 6,
            height: outline.height + 6,
            border: `1px solid ${surface.overlayLine}`,
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }}
        />
      )}
    </>
  )
}
