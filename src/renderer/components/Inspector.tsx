import { memo, useContext, type JSX } from 'react'
import type { Clip, ProjectMedia, SoundClip, Timeline } from '../../shared/project'
import { clipLength, findClip, isStill, linkedIds } from '../../shared/project'
import type { PeaksData } from '../../shared/types'
import { formatTimecode } from '../../shared/time'
import { conformWords } from '../../shared/conform-words'
import { ink, space, type } from '../theme'
import { Button } from '../ui/Button'
import { TextPanel } from './TextPanel'
import { ShapePanel } from './ShapePanel'
import type { ShapeStyle } from '../../shared/shape'
import { type BreathAmount } from '../../shared/voice-care'
import { type ZoomTools } from './ZoomGroup'

import { type SavedLayoutActions } from './SavedLayouts'
import type { SavedLayout } from '../../shared/saved-layouts'
import { type PlayheadStore } from '../state/playheadStore'

import type { Keymap } from '../../shared/keymap'
import type { TextStyle } from '../../shared/text'

import { Folds, Group, dim, mono, row, small, heading, type Edit, type InspectorFolds, type Painting } from './inspector-parts'
import { Level, SoundSection } from './InspectorSound'
import { CaptionPanel } from './InspectorCaptions'
import { PicturePanel } from './InspectorPicture'
import { Sections } from './section-host'

export { Level }
export type { InspectorFolds, Painting }

/** Where a clip is: its source, where it starts, its in, its out and its length. */
function Timing(props: { clip: Clip | SoundClip; media: ProjectMedia | undefined; fps: number }): JSX.Element {
  const { clip, media, fps } = props
  return (
    <>
      <div style={row}>
        <span style={dim}>Source</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {media?.originalPath.split(/[\\/]/).pop()}
        </span>
      </div>
      <div style={row}>
        <span style={dim}>Starts at</span>
        <span data-testid="clip-start" data-frame={clip.timelineStart} style={mono}>
          {formatTimecode(clip.timelineStart, fps)}
        </span>
      </div>
      {/* A picture has no time of its own for In and Out to be points in. */}
      {!(media && isStill(media)) && (
        <>
          <div style={row}>
            <span style={dim}>In</span>
            <span style={mono}>{formatTimecode(clip.sourceIn, fps)}</span>
          </div>
          <div style={row}>
            <span style={dim}>Out</span>
            <span style={mono}>{formatTimecode(clip.sourceOut, fps)}</span>
          </div>
        </>
      )}
      <div style={row}>
        <span style={dim}>Length</span>
        <span data-testid="clip-length" data-frames={clipLength(clip)} style={mono}>
          {formatTimecode(clipLength(clip), fps)}
        </span>
      </div>
    </>
  )
}

const NO_MARKS = { in: null, out: null }
const noSeek = (): void => undefined
const noZoomEnd = (): void => undefined

/**
 * The selected clip: a picture on a video track, or a sound clip, with the
 * sound linked to it and a way to unlink it.
 */
interface InspectorProps {
  timeline: Timeline
  /** Every waveform loaded, by source and track, to tell which streams are silent. */
  peaks: Map<string, PeaksData>
  /** The selected clip, on any track. */
  clipId: string | null
  /** The other selected clips a change to a picture's place or crop is made on too (note 32). */
  alsoChanged?: readonly string[] | undefined
  /** The selected caption, when a caption is selected rather than a clip. */
  captionId: string | null
  aspectLocked: boolean
  onAspectLock: (locked: boolean) => void
  /** The picture being edited: the main one, or a layer's id. */
  picture: string
  onPicture: (picture: string) => void
  /** Whether that picture's End is chosen, for a Simple zoom, and choosing it or Start. */
  zoomEnd?: boolean | undefined
  onZoomEnd?: ((end: boolean) => void) | undefined
  /** How far the one click zooms go and how quickly, and the one that can be aimed now. */
  zoomTools?: ZoomTools | undefined
  /** `continuing` marks the later movements of a drag, which share its first's undo step. */
  onEdit: Edit
  /** Relocate is on: a drag of the caption on the Output view moves every caption that follows the style. */
  relocating?: boolean
  onRelocate?: () => void
  relocateHandPlaced?: boolean
  onRelocateHandPlaced?: (on: boolean) => void
  /** The sections folded or opened by hand. Kept with the window, never with the project. */
  folds?: InspectorFolds
  onFold?: (name: string, folded: boolean) => void
  /** The format painter, armed from the selected clip. */
  painting?: Painting
  onPaint?: ((how: Painting) => void) | undefined
  /** Framing the selected clip begins, which brings the playhead into it. */
  onFraming?: (() => void) | undefined
  /** A text's words being typed on the Output view, which its words box shows as they come. */
  textDraft?: { clipId: string; words: string } | null
  /** Copy the crop shown in the Crop section, and paste a copied one onto the selected clips: left out while nothing is copied. */
  onCopyCrop?: (() => void) | undefined
  /** Which of the clip's blurred boxes is being moved on the Source view, if any (plan 85). */
  blurBox?: number | null | undefined
  onBlurBox?: ((index: number | null) => void) | undefined
  /** Framings saved under a name, and what the Frame group's row of them does. */
  savedLayouts?: readonly SavedLayout[] | undefined
  layoutActions?: SavedLayoutActions | undefined
  onPasteCrop?: (() => void) | undefined
  /** A text's words or style changed in its Text section. */
  onTextChange?: ((mediaId: string, style: TextStyle, continuing: boolean) => void) | undefined
  /** Task 34: how many other texts and other sequences there are, and putting a text's or the captions' style on all of them. */
  applyToAll?: {
    otherTexts: (mediaId: string) => number
    onTexts: (mediaId: string) => void
    otherSequences: number
    onCaptions: () => void
  } | undefined
  /** A plain colour changed, as a black screen's: drawn again, then kept. */
  onColourChange?: ((mediaId: string, colour: string) => void) | undefined
  /** A shape's look changed from its Shape group, its bend put on or taken off, or its look saved as a style of your own. */
  shapes?: {
    onChange: (mediaId: string, style: ShapeStyle, continuing: boolean) => void
    onBend: (clipId: string, on: boolean) => void
    onSave: (name: string, style: ShapeStyle) => void
    suggestedName: (style: ShapeStyle) => string
  } | undefined
  /** Soften breaths or Remove mouth clicks set for a recording's track (plan 81). */
  onCare?: ((mediaId: string, track: number, change: { breaths?: BreathAmount | null; clicks?: boolean }) => void) | undefined
  /** The playhead, read only by what follows it: the Zoom group and the Crop numbers of a clip that zooms. */
  playhead?: PlayheadStore | undefined
  /** The range marked with In and Out, which Zoom in and out spans. */
  marks?: { in: number | null; out: number | null } | undefined
  keymap?: Keymap | undefined
  /** Move the playhead, as the Zoom group's arrows and diamonds do. */
  onSeek?: ((frame: number) => void) | undefined
}

/**
 * What the selection is, and everything that can be set on it. Memoised: it
 * shows nothing that moves with the playhead, and it used to be drawn again on
 * every frame of playback.
 */
export const Inspector = memo(function Inspector(props: InspectorProps): JSX.Element {
  return (
    <Folds.Provider value={{ folds: props.folds ?? {}, onFold: props.onFold ?? (() => {}) }}>
      <InspectorBody {...props} />
    </Folds.Provider>
  )
})

function InspectorBody(props: InspectorProps): JSX.Element | null {
  const t = props.timeline
  // Drawing one section beside the timeline (plan 92): only its own part, and none of the panel's ids, which belong to the Inspector.
  const only = useContext(Sections)?.only ?? null
  const caption = props.captionId ? t.captions.clips.find((c) => c.id === props.captionId) : undefined
  if (caption) {
    return (
      <CaptionPanel
        caption={caption}
        only={only}
        timeline={t}
        onEdit={props.onEdit}
        relocating={props.relocating === true}
        onRelocate={props.onRelocate ?? (() => undefined)}
        relocateHandPlaced={props.relocateHandPlaced === true}
        onRelocateHandPlaced={props.onRelocateHandPlaced ?? (() => undefined)}
        otherSequences={props.applyToAll?.otherSequences ?? 0}
        {...(props.applyToAll ? { onApplyToAll: props.applyToAll.onCaptions } : {})}
      />
    )
  }
  const found = props.clipId ? findClip(t, props.clipId) : null
  if (!found) {
    if (only !== null) return null
    return (
      <section>
        {heading('Clip')}
        <p style={{ color: ink.muted, font: type.body }}>Select a clip to see its properties.</p>
      </section>
    )
  }

  const clip = found.clip
  const media = t.media.find((m) => m.id === clip.mediaId)
  const group = linkedIds(t, clip.id)
  const sounds = t.audioTracks.flatMap((r) => r.clips.filter((c) => group.includes(c.id)))
  const louder = sounds.some((s) => s.gain > 1)
  const sameSource =
    found.kind === 'video' ? found.track.clips.filter((c) => c.mediaId === clip.mediaId && c.id !== clip.id).length : 0

  return (
    <section
      data-testid={only !== null ? undefined : found.kind === 'video' ? 'picture-clip-panel' : 'sound-clip-panel'}
      style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      {/* Colour or Text, Frame, Crop, Look, Sound, Linked, Source: what is done
          to its picture, then to its sound, then what it moves with, and last
          the recording it comes from, which is read rather than worked in. */}
      {found.kind === 'video' && media?.colour && props.onColourChange && (
        <Group name="Colour" testid="colour-section">
          <div style={row}>
            <span style={dim}>Fills the frame with</span>
            <input
              type="color"
              aria-label="The colour"
              data-testid="colour-value"
              value={media.colour}
              onChange={(e) => props.onColourChange?.(media.id, e.target.value)}
              className="ui-colour"
              style={{ width: 28, height: 20 }}
            />
          </div>
        </Group>
      )}
      {found.kind === 'video' && media?.text && props.onTextChange && (
        <Group name="Text" testid="text-section">
          <TextPanel
            style={props.textDraft?.clipId === found.clip.id ? { ...media.text, text: props.textDraft.words } : media.text}
            onChange={(style, continuing) => props.onTextChange?.(media.id, style, continuing === true)}
            others={props.applyToAll?.otherTexts(media.id) ?? 0}
            {...(props.applyToAll ? { onApplyToAll: () => props.applyToAll?.onTexts(media.id) } : {})}
          />
        </Group>
      )}
      {found.kind === 'video' && media?.shape && props.shapes && (
        <Group name="Shape" testid="shape-section">
          <ShapePanel
            style={media.shape}
            onChange={(style, continuing) => props.shapes?.onChange(media.id, style, continuing)}
            onBend={(on) => props.shapes?.onBend(found.clip.id, on)}
            onSave={(name) => media.shape && props.shapes?.onSave(name, media.shape)}
            suggestedName={props.shapes.suggestedName(media.shape)}
          />
        </Group>
      )}
      {found.kind === 'video' ? (
        // Any press or focus in its picture sections is framing it.
        <div style={{ display: 'contents' }} onPointerDownCapture={props.onFraming} onFocusCapture={props.onFraming}>
        <PicturePanel
          clip={found.clip}
          media={media}
          timeline={t}
          sameSource={sameSource}
          picture={props.picture}
          zoomEnd={props.zoomEnd === true}
          onZoomEnd={props.onZoomEnd ?? noZoomEnd}
          zoomTools={props.zoomTools}
          aspectLocked={props.aspectLocked}
          onAspectLock={props.onAspectLock}
          onPicture={props.onPicture}
          onEdit={props.onEdit}
          painting={props.painting ?? null}
          onPaint={props.onPaint}
          onCopyCrop={props.onCopyCrop}
          blurBox={props.blurBox}
          onBlurBox={props.onBlurBox}
          onPasteCrop={props.onPasteCrop}
          savedLayouts={props.savedLayouts}
          layoutActions={props.layoutActions}
          playhead={props.playhead}
          marks={props.marks ?? NO_MARKS}
          keymap={props.keymap}
          onSeek={props.onSeek ?? noSeek}
          alsoChanged={props.alsoChanged}
        />
        </div>
      ) : null}
      {sounds.length > 0 && (
        <SoundSection
          timeline={t}
          sounds={sounds}
          selectedSound={found.kind === 'audio' ? clip.id : null}
          clipId={clip.id}
          sameForAll={found.kind === 'video' || group.length > 1}
          peaks={props.peaks}
          onEdit={props.onEdit}
          onCare={props.onCare}
        />
      )}
      {louder && (only === null || only === 'Sound') && (
        <p data-testid="louder-note" style={{ ...small, color: ink.muted, margin: '6px 0 0' }}>
          Louder than 100% is heard at full level in the export. The preview keeps the balance but plays everything
          quieter.
        </p>
      )}
      <Group name="Linked" when={group.length > 1}>
        <div style={{ ...row, alignItems: 'center' }}>
          <span data-testid="linked-count" data-count={group.length} style={dim}>
            Linked with {group.length - 1} {group.length === 2 ? 'clip' : 'clips'}
          </span>
          <Button
            testid="unlink"
            size="small"
            icon="unlinked"
            onClick={() => props.onEdit({ kind: 'unlink', clipId: clip.id })}
            title="Make these separate clips, which move, trim and cut on their own"
          >
            Unlink
          </Button>
        </div>
      </Group>
      <Group name="Source">
        <Timing clip={clip} media={media} fps={t.fps} />
        {media?.conformed && (
          <p style={{ font: type.meta, color: ink.muted, marginTop: space.xs }}>{conformWords(media.conformReasons)}</p>
        )}
      </Group>
    </section>
  )
}
