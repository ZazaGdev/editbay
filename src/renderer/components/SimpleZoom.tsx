import { useRef, type JSX } from 'react'
import { MAIN_PICTURE, PRESET_SCALE, clipLength, startEndOf, zoomOf, type Clip, type ProjectMedia, type Rect, type SimpleEase, type Timeline } from '../../shared/project'
import { MAX_SCALE, SIMPLE_EASE_NAMES, cropEdit, pastOwnPixels, scaleOf, shapeOf, withCentre, withScale } from '../../shared/zoom-edit'
import { accent, ink, meaning, radius, space, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { usePlayheadRead, type PlayheadStore } from '../state/playheadStore'
import { AmountRow, ZoomNumber, callout, note, type Edit, type ZoomTools } from './zoom-parts'
import { HelpTip } from '../ui/HelpTip'

/**
 * A Simple zoom: the Start and End pictures, the one chosen framed with Scale
 * and Position here or the crop box, and how it gets from one to the other.
 * Choosing one puts the playhead on its frame, so the Output view shows it.
 */
export function SimpleZoom(props: {
  clip: Clip
  media: ProjectMedia
  timeline: Timeline
  playhead: PlayheadStore | undefined
  picture: string
  zoomEnd: boolean
  onZoomEnd: (end: boolean) => void
  onEdit: Edit
  onSeek: (frame: number) => void
  onKeyframes: () => void
  tools?: ZoomTools | undefined
}): JSX.Element {
  const { clip, media, timeline, picture } = props
  const amount = props.tools?.amount ?? Math.round(PRESET_SCALE * 100)
  const own = picture === MAIN_PICTURE ? {} : { picture }
  const first = clip.timelineStart
  const last = first + Math.max(0, clipLength(clip) - 1)
  const playhead = usePlayheadRead(props.playhead, (f) => Math.min(last + 1, Math.max(first - 1, f)))
  const { start, end } = startEndOf(clip, picture)
  const zoom = zoomOf(clip, picture)
  const moving = zoom.simple !== undefined
  const ease: SimpleEase = zoom.simple ?? 'smooth'
  const endChosen = props.zoomEnd
  const crop = endChosen ? end : start
  const shape = shapeOf(clip, picture)
  const scaleOfCrop = (r: Rect): number => scaleOf(r, media.width, media.height, shape)
  const scale = scaleOfCrop(crop)
  const place = (clip.layers.find((l) => l.id === picture) ?? clip.transform).place
  const softer = timeline.output.width > 0 && pastOwnPixels(crop, place, timeline.output.width)

  /** Where a visit to one of the numbers started. */
  const visit = useRef<Rect | null>(null)
  const put = (rect: Rect, continuing: boolean): void => props.onEdit(cropEdit(clip, playhead, rect, picture, endChosen), continuing)
  const field = {
    onEnter: () => {
      visit.current = crop
    },
    onLeave: () => {
      visit.current = null
    },
    onRevert: () => {
      if (visit.current) put(visit.current, true)
    }
  }
  const base = (): Rect => visit.current ?? crop
  const pick = (which: 'start' | 'end'): void => {
    // Beside the picture, never in its place: choosing End keeps the picture chosen.
    props.onZoomEnd(which === 'end')
    props.onSeek(which === 'end' ? last : first)
  }
  const closer = withScale(start, (scaleOfCrop(start) * amount) / 100, media.width, media.height, shape)
  const along = clipLength(clip) > 1 ? (playhead - first) / (last - first) : 0

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <EndCard
          testid="zoom-start"
          name="Start"
          meta="First frame"
          chosen={!endChosen}
          crop={start}
          media={media}
          onClick={() => pick('start')}
        />
        <EndCard
          testid="zoom-end"
          name="End"
          meta={moving ? `Last frame, ${Math.round((scaleOfCrop(end) / scaleOfCrop(start)) * 100)}%` : 'Last frame, same as Start'}
          chosen={endChosen}
          crop={end}
          media={media}
          onClick={() => pick('end')}
        />
      </div>
      <HelpTip text={`The crop box and the numbers below change the ${endChosen ? 'End' : 'Start'} picture.`} tutorial="215-zoom-in-and-out" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
        <ZoomNumber
          label="Scale %"
          testid="zoom-scale"
          value={Math.round(scale)}
          step={5}
          title={`How close in the ${endChosen ? 'End' : 'Start'} picture is: 100% is the most of the recording its shape can show, ${MAX_SCALE}% the closest`}
          {...field}
          onApply={(n, continuing) => put(withScale(base(), n, media.width, media.height, shape), continuing)}
        />
        <ZoomNumber
          label="X"
          testid="zoom-x"
          value={Math.round(crop.x + crop.w / 2)}
          step={2}
          title="Where the middle of what is shown is, across the recording, in its pixels"
          {...field}
          onApply={(n, continuing) => {
            const b = base()
            put(withCentre(b, n, b.y + b.h / 2, media.width, media.height), continuing)
          }}
        />
        <ZoomNumber
          label="Y"
          testid="zoom-y"
          value={Math.round(crop.y + crop.h / 2)}
          step={2}
          title="Where the middle of what is shown is, down the recording, in its pixels"
          {...field}
          onApply={(n, continuing) => {
            const b = base()
            put(withCentre(b, b.x + b.w / 2, n, media.width, media.height), continuing)
          }}
        />
      </div>
      {softer && (
        <p data-testid="zoom-softer" style={{ ...note, marginTop: 0 }}>
          Past the recording&apos;s own pixels, so softer.
        </p>
      )}

      <span style={{ font: type.meta, color: ink.muted, marginTop: 2 }}>Gets there</span>
      <Segmented
        testid="zoom-ease"
        label="How it gets from Start to End"
        size="small"
        stretch
        chosen={ease}
        onChoose={(e) => props.onEdit({ kind: 'setSimpleZoom', clipId: clip.id, change: { ease: e }, ...own })}
        choices={SIMPLE_EASE_NAMES.map((n) => ({
          id: n.ease,
          label: n.label,
          title: n.title,
          whyDisabled: moving ? undefined : 'The picture stays still: frame End differently first'
        }))}
      />
      <div
        data-testid="zoom-ends"
        aria-hidden="true"
        style={{
          position: 'relative',
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          font: type.meta,
          color: ink.secondary,
          background: surface.sunken,
          border: `1px solid ${surface.line}`,
          borderRadius: radius.chip
        }}
      >
        <span style={{ position: 'relative', zIndex: 1, background: surface.sunken, paddingRight: 4 }}>Start</span>
        {moving && (
          <span style={{ position: 'absolute', left: 44, right: 36, top: '50%', height: 2, marginTop: -1, background: `linear-gradient(90deg, ${accent.washLine}, ${accent.bright})` }} />
        )}
        <span style={{ position: 'relative', zIndex: 1, background: surface.sunken, paddingLeft: 4 }}>End</span>
        {playhead >= first && playhead <= last && (
          <span style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${along * 100}% - 0.5px)`, width: 1, background: meaning.playhead, zIndex: 2 }} />
        )}
      </div>
      <HelpTip text="Start is always the clip's first frame and End its last. Trim the clip and the move stretches or squeezes to fit." tutorial="215-zoom-in-and-out" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <Button
          testid="zoom-swap"
          size="small"
          disabled={!moving}
          whyDisabled="The picture stays still: there is nothing to swap"
          title="Swap Start and End, so a zoom in becomes a zoom out"
          onClick={() => props.onEdit({ kind: 'setSimpleZoom', clipId: clip.id, change: { start: end, end: start }, ...own })}
        >
          Swap
        </Button>
        <Button
          testid="zoom-still"
          size="small"
          disabled={!moving}
          whyDisabled="The picture already stays still"
          title="End the same as Start, so the picture stays still"
          onClick={() => props.onEdit({ kind: 'setSimpleZoom', clipId: clip.id, change: { end: start }, ...own })}
        >
          No move
        </Button>
        <Button testid="zoom-more" size="small" variant="ghost" title="Turn Start and End into two keyframes, to add more" onClick={props.onKeyframes}>
          Add more points&hellip;
        </Button>
      </div>
      {!moving && (
        <div data-testid="zoom-still-note" style={callout}>
          This clip stays still. Choose <strong>End</strong> and frame it differently to make it move, or start from one of these:
          <div style={{ display: 'flex', gap: 4, marginTop: space.sm, flexWrap: 'wrap' }}>
            <Button
              testid="zoom-simple-in"
              size="small"
              title={`End ${amount}% in on Start, around its middle`}
              onClick={() => props.onEdit({ kind: 'setSimpleZoom', clipId: clip.id, change: { end: closer }, ...own })}
            >
              Zoom in to {amount}%
            </Button>
            <Button
              testid="zoom-simple-out"
              size="small"
              title={`Start ${amount}% in, ending on the picture as it is`}
              onClick={() => props.onEdit({ kind: 'setSimpleZoom', clipId: clip.id, change: { start: closer, end: start }, ...own })}
            >
              Zoom out from {amount}%
            </Button>
          </div>
          {props.tools && <AmountRow tools={props.tools} />}
        </div>
      )}
    </>
  )
}

/**
 * Start or End: a small map of the recording with what the picture frames
 * lit, its name, and when it shows. Chosen, it is the one the crop box edits.
 */
function EndCard(props: {
  testid: string
  name: string
  meta: string
  chosen: boolean
  crop: Rect
  media: ProjectMedia
  onClick: () => void
}): JSX.Element {
  const w = 44
  const h = props.media.width > 0 ? Math.max(12, Math.round((w * props.media.height) / props.media.width)) : 25
  const sx = w / Math.max(1, props.media.width)
  const sy = h / Math.max(1, props.media.height)
  return (
    <button
      type="button"
      data-testid={props.testid}
      aria-pressed={props.chosen}
      title={`Edit the ${props.name} picture, and go to its frame`}
      onClick={props.onClick}
      style={{
        textAlign: 'left',
        padding: 6,
        cursor: 'pointer',
        color: ink.primary,
        font: type.meta,
        background: surface.raised,
        border: `1px solid ${props.chosen ? accent.bright : surface.lineStrong}`,
        boxShadow: props.chosen ? `inset 0 0 0 1px ${accent.bright}` : 'none',
        borderRadius: radius.control
      }}
    >
      <svg width={w} height={h} aria-hidden="true" style={{ display: 'block', marginBottom: 4 }}>
        <rect x={0.5} y={0.5} width={w - 1} height={h - 1} fill={surface.sunken} stroke={surface.lineStrong} />
        <rect
          x={props.crop.x * sx}
          y={props.crop.y * sy}
          width={Math.max(1, props.crop.w * sx)}
          height={Math.max(1, props.crop.h * sy)}
          fill={accent.tint}
          stroke={props.chosen ? accent.bright : ink.secondary}
        />
      </svg>
      <strong style={{ display: 'block' }}>{props.name}</strong>
      <span style={{ color: ink.muted }}>{props.meta}</span>
    </button>
  )
}
