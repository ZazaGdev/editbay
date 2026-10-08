/** The Inspector for a selected caption: its words, its times, and how every caption in the sequence looks. */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Timeline } from '../../shared/project'
import { formatTimecode } from '../../shared/time'
import { CAPTION_OUTLINES, CAPTION_SHADOWS, CAPTION_SPACINGS, DEFAULT_CAPTION_STYLE, HIGHLIGHT_COLOURS, captionText, type CaptionClip, type CaptionStyleChange } from '../../shared/captions'
import { installedFonts } from './TextPanel'
import { CAPTION_FONTS } from '../../shared/caption-fonts'
import { ApplyToAll } from './ApplyToAll'
import { CaptionStyleExtras } from './CaptionStyleExtras'
import { SavedStyles } from './SavedStyles'
import { captionStyleToSave } from '../../shared/saved-styles'
import { surface, ink, space, radius } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Select } from '../ui/Select'

import { Segmented } from '../ui/Segmented'
import { Group, Percent, dim, mono, row, small, type Edit } from './inspector-parts'
import { HelpTip } from '../ui/HelpTip'

/**
 * A caption's words as a line of text to type into. Enter or leaving the
 * field applies it, Escape puts back what it was: a word changed keeps its
 * timing, one added shares the time of the word beside it, and one deleted
 * gives its time to its neighbours. Typed in its own case: capitals only show.
 */
function CaptionWords(props: { caption: CaptionClip; onCommit: (text: string) => void }): JSX.Element {
  const now = props.caption.words.map((w) => w.text).join(' ')
  const [text, setText] = useState(now)
  useEffect(() => setText(now), [now])
  /** What was typed and not applied yet, which goes to this caption even if the field goes first. */
  const typed = useRef<string | null>(null)
  const latest = useRef({ now, onCommit: props.onCommit })
  latest.current = { now, onCommit: props.onCommit }
  const commit = (): void => {
    const t = typed.current
    typed.current = null
    if (t !== null && t.trim().replace(/\s+/g, ' ') !== latest.current.now) latest.current.onCommit(t)
    // Shows its own words again, as they came out, when they could not be taken as typed.
    setText(latest.current.now)
  }
  // Another caption clicked, or a clip, takes the field away: what was typed is applied first.
  useEffect(() => commit, [])
  return (
    <div className="ui-field__box" style={{ height: 26, marginTop: 6 }}>
    <input
      data-testid="caption-words"
      value={text}
      onChange={(e) => {
        typed.current = e.target.value
        setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          typed.current = null
          setText(now)
          const input = e.currentTarget
          window.setTimeout(() => input.blur(), 0)
        }
      }}
      className="ui-field__input"
    />
    </div>
  )
}

/** A caption selected: its words to type into, its times, and how every caption in the sequence looks. */
export function CaptionPanel(props: {
  caption: CaptionClip
  timeline: Timeline
  onEdit: Edit
  relocating: boolean
  onRelocate: () => void
  relocateHandPlaced: boolean
  onRelocateHandPlaced: (on: boolean) => void
  /** The one section drawn beside the timeline, when this is drawn there rather than in the Inspector (plan 92). */
  only?: string | null
  /** How many other sequences the project has, and putting this look on their captions too (task 34). */
  otherSequences?: number
  onApplyToAll?: () => void
}): JSX.Element {
  const { caption, timeline: t } = props
  const style = t.captions.style
  const setStyle = (change: CaptionStyleChange, continuing = false): void => props.onEdit({ kind: 'setCaptionStyle', style: change }, continuing)
  // The fonts on this PC, after the bundled ones (plan 87).
  const [pcFamilies, setPcFamilies] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void installedFonts().then((f) => live && setPcFamilies(f))
    return () => {
      live = false
    }
  }, [])
  const bundledFamilies = new Set(CAPTION_FONTS.map((f) => f.family))
  const chooseFont = (value: string): void => {
    if (!value.startsWith('pc:')) return setStyle({ font: value, pcFont: null })
    // Its figures read from its file, so the layout fits it here and on any computer.
    void window.api.captionFontFor(value.slice(3)).then((figures) => {
      if (figures) setStyle({ pcFont: figures })
    })
  }
  return (
    <section data-testid={props.only ? undefined : 'caption-panel'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Group name="Caption">
      <div style={row}>
        <span style={dim}>Starts at</span>
        <span data-testid="caption-start" data-frame={caption.timelineStart} style={mono}>
          {formatTimecode(caption.timelineStart, t.fps)}
        </span>
      </div>
      <div style={row}>
        <span style={dim}>Length</span>
        <span data-testid="caption-length" data-frames={caption.length} style={mono}>
          {formatTimecode(caption.length, t.fps)}
        </span>
      </div>
      <CaptionWords key={caption.id} caption={caption} onCommit={(text) => props.onEdit({ kind: 'setCaptionWords', captionId: caption.id, text })} />
      <p style={{ ...small, color: ink.muted, margin: `${space.xs}px 0 0` }}>
        Shows as: <span data-testid="caption-text">{captionText(caption, style)}</span>
      </p>
      <div style={{ ...row, alignItems: 'center', marginTop: space.xs }}>
        <span style={dim}>Where</span>
        <span data-testid="caption-where" data-where={caption.at ? 'hand' : 'style'}>
          {caption.at ? 'Moved by hand' : 'Where the style puts it'}
        </span>
      </div>
      {caption.at ? (
        <Button
          testid="caption-follow-style"
          size="small"
          style={{ alignSelf: 'flex-start' }}
          title="Put it back where the style puts every caption, and move it with them again"
          onClick={() => props.onEdit({ kind: 'placeCaption', captionId: caption.id, at: null })}
        >
          Follow the style
        </Button>
      ) : (
        <HelpTip text="Double click it on the Output view to move it on its own." tutorial="545-move-captions-on-the-picture" />
      )}
      </Group>

      <Group name="How captions look" testid="caption-style">
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Size</span>
          <Percent testid="caption-size" value={style.size} min={3} max={14} step={0.5} title="How tall the letters are, as a share of the frame's height" onChange={(size, c) => setStyle({ size }, c)} />
        </div>
        <div style={row}>
          <span style={dim}>Font</span>
          <Select
            testid="caption-font"
            label="The font every caption is drawn in"
            value={style.pcFont ? `pc:${style.pcFont.family}` : (style.font ?? DEFAULT_CAPTION_STYLE.font)}
            blurOnChange
            height={24}
            onChange={chooseFont}
            choices={[
              ...CAPTION_FONTS.map((f) => ({ value: f.id, label: f.label })),
              // One a project carried here names, even when it is not on this PC.
              ...(style.pcFont && !pcFamilies.includes(style.pcFont.family) ? [{ value: `pc:${style.pcFont.family}`, label: style.pcFont.family }] : []),
              ...pcFamilies.filter((f) => !bundledFamilies.has(f)).map((f) => ({ value: `pc:${f}`, label: f }))
            ]}
          />
        </div>
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Height in frame</span>
          <Percent testid="caption-height" value={style.height} min={10} max={90} step={1} title="Where the middle of a caption sits, from the top of the frame" onChange={(height, c) => setStyle({ height }, c)} />
        </div>
        <div style={row}>
          <span style={dim}>Words at a time</span>
          <Select
            testid="caption-words-per"
            label="How many words show at a time"
            value={String(style.wordsPerCaption)}
            blurOnChange
            height={24}
            onChange={(v) => setStyle({ wordsPerCaption: Number(v) })}
            choices={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
        <div style={row}>
          <span style={dim}>Capitals</span>
          <Check testid="caption-capitals" checked={style.capitals} onChange={(capitals) => setStyle({ capitals })}>
            <span className="ui-hidden">Capitals</span>
          </Check>
        </div>
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Word being said</span>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {HIGHLIGHT_COLOURS.map((h) => (
              <button
                key={h.colour}
                data-testid="caption-highlight"
                data-colour={h.colour}
                title={h.name}
                onClick={() => setStyle({ highlight: h.colour })}
                style={{
                  width: 18,
                  height: 18,
                  padding: 0,
                  borderRadius: radius.chip,
                  cursor: 'pointer',
                  // The swatch is the colour itself, which is your data, not a token.
                  background: h.colour,
                  border:
                    style.highlight.toUpperCase() === h.colour
                      ? `2px solid ${ink.primary}`
                      : `1px solid ${surface.lineStrong}`
                }}
              />
            ))}
            <input
              type="color"
              data-testid="caption-highlight-custom"
              value={style.highlight.toLowerCase()}
              title="Another colour"
              onChange={(e) => setStyle({ highlight: e.target.value.toUpperCase() })}
              className="ui-colour"
              style={{ width: 24, height: 20 }}
            />
          </span>
        </div>
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Words</span>
          <input
            type="color"
            data-testid="caption-word-colour"
            aria-label="The colour of the words"
            value={(style.wordColour ?? DEFAULT_CAPTION_STYLE.wordColour).toLowerCase()}
            title="The colour of every word but the one being said"
            onChange={(e) => setStyle({ wordColour: e.target.value.toUpperCase() })}
            className="ui-colour"
            style={{ width: 24, height: 20 }}
          />
        </div>
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Outline</span>
          <input
            type="color"
            data-testid="caption-outline-colour"
            aria-label="The outline's colour"
            value={(style.outlineColour ?? DEFAULT_CAPTION_STYLE.outlineColour).toLowerCase()}
            title="The outline's colour"
            onChange={(e) => setStyle({ outlineColour: e.target.value.toUpperCase() })}
            className="ui-colour"
            style={{ width: 24, height: 20 }}
          />
        </div>
        {/* On a line of its own: four choices beside a label run past a narrow Inspector. */}
        <Segmented
          testid="caption-outline"
          label="How thick the outline round the letters is"
          size="small"
          stretch
          chosen={String(CAPTION_OUTLINES.find((o) => Math.abs(o.outline - (style.outline ?? DEFAULT_CAPTION_STYLE.outline)) < 1e-6)?.outline ?? '')}
          onChoose={(v) => setStyle({ outline: Number(v) })}
          choices={CAPTION_OUTLINES.map((o) => ({ id: String(o.outline), label: o.name, title: `${o.name} outline` }))}
        />
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Shadow</span>
          <input
            type="color"
            data-testid="caption-shadow-colour"
            aria-label="The shadow's colour"
            value={(style.shadowColour ?? DEFAULT_CAPTION_STYLE.shadowColour).toLowerCase()}
            title="The shadow's colour"
            onChange={(e) => setStyle({ shadowColour: e.target.value.toUpperCase() })}
            className="ui-colour"
            style={{ width: 24, height: 20 }}
          />
        </div>
        <Segmented
          testid="caption-shadow"
          label="How far the shadow falls, down and to the right"
          size="small"
          stretch
          chosen={String(CAPTION_SHADOWS.find((o) => Math.abs(o.shadow - (style.shadow ?? DEFAULT_CAPTION_STYLE.shadow)) < 1e-6)?.shadow ?? '')}
          onChoose={(v) => setStyle({ shadow: Number(v) })}
          choices={CAPTION_SHADOWS.map((o) => ({ id: String(o.shadow), label: o.name, title: `${o.name} shadow` }))}
        />
        <span style={{ ...dim, marginTop: 4 }}>Letter spacing</span>
        <Segmented
          testid="caption-spacing"
          label="How far apart the letters are"
          size="small"
          stretch
          chosen={String(CAPTION_SPACINGS.find((o) => Math.abs(o.spacing - (style.spacing ?? DEFAULT_CAPTION_STYLE.spacing)) < 1e-6)?.spacing ?? '')}
          onChoose={(v) => setStyle({ spacing: Number(v) })}
          choices={CAPTION_SPACINGS.map((o) => ({ id: String(o.spacing), label: o.name, title: `${o.name} letter spacing` }))}
        />
        <CaptionStyleExtras style={style} setStyle={setStyle} />

        <p style={{ ...small, color: ink.muted, margin: '6px 0 0' }}>For every caption in this sequence.</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: 6 }}>
          <Button
            testid="caption-relocate"
            size="small"
            pressed={props.relocating}
            title="Then drag the caption on the Output view: every caption that follows the style moves there. Escape when done"
            onClick={props.onRelocate}
          >
            Relocate
          </Button>
          <Check testid="caption-relocate-hand" checked={props.relocateHandPlaced} onChange={props.onRelocateHandPlaced}>
            <span title="Off, captions you placed yourself are left alone. On, they are moved with the rest.">
              Include captions you moved by hand
            </span>
          </Check>
        </div>
        <Button
          testid="caption-regroup"
          size="small"
          style={{ marginTop: 6, alignSelf: 'flex-start' }}
          title="Break every caption again where a reader would pause: at a sentence's end, a comma, or before and or because. Words you fixed stay fixed; captions you split or trimmed are grouped again with the rest"
          onClick={() => props.onEdit({ kind: 'regroupCaptions' })}
        >
          Group again
        </Button>
        <SavedStyles<CaptionStyleChange>
          which="savedCaptionStyles"
          testid="caption-saved"
          baseName="My caption style"
          current={() => captionStyleToSave(style)}
          onUse={(saved) => setStyle(saved)}
        />
        {props.onApplyToAll && (props.otherSequences ?? 0) > 0 && (
          <ApplyToAll
            testid="caption-apply-all"
            label="Apply to all sequences"
            title="Give the captions of every other sequence in this project this look, keeping where they sit"
            question="Apply this caption style everywhere?"
            explain={`The captions of ${props.otherSequences === 1 ? 'the other sequence' : `all ${props.otherSequences} other sequences`} in this project will take on this look: font, size, colours, outline, shadow, spacing, box, glow, word pop, capitals and words per caption. Each keeps where its captions sit. One undo puts them back.`}
            confirm="Apply to all"
            onApply={props.onApplyToAll}
          />
        )}
      </Group>
    </section>
  )
}
