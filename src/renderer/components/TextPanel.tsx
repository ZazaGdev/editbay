import { useEffect, useRef, useState, type JSX } from 'react'
import { CAPTION_FONTS } from '../../shared/caption-fonts'
import { TEXT_FONTS, popularOf } from '../../shared/popular-fonts'

import { DEFAULT_TEXT, cleanTextStyle, TEXT_MAX_SIZE, TEXT_MIN_SIZE, type TextAlign, type TextStyle } from '../../shared/text'
import { Button } from '../ui/Button'
import { ApplyToAll } from './ApplyToAll'
import { SavedStyles } from './SavedStyles'
import { textStyleToSave } from '../../shared/saved-styles'
import { textStyledAs } from '../../shared/apply-to-all'
import { ink, radius, space, surface, type } from '../theme'
import { Check } from '../ui/Check'
import { Field } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { HelpTip } from '../ui/HelpTip'
import { RUNNING_SYSTEM } from '../../shared/system'

/**
 * A text's words and how they look, in the Inspector. Every change draws the
 * text again and is one undo step, and typing is one step per pause rather
 * than one per key.
 */

const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, font: type.meta, color: ink.primary, padding: '3px 0' } as const
const dim = { color: ink.muted } as const

/** Fonts every Windows machine, or every Mac, has, for when the list of installed ones cannot be read. */
const FALLBACK_FONTS =
  RUNNING_SYSTEM === 'mac'
    ? ['Arial', 'Arial Black', 'Avenir Next', 'Comic Sans MS', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Menlo', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']
    : ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Georgia', 'Impact', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']

let installed: Promise<string[]> | null = null

/** The popular font families on this PC, read once (task 1087). Captions offer them too (plan 87). */
export function installedFonts(): Promise<string[]> {
  installed ??= (async () => {
    try {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
      const families = popularOf((query ? await query() : []).map((f) => f.family))
      return families.length > 0 ? families : FALLBACK_FONTS
    } catch {
      return FALLBACK_FONTS
    }
  })()
  return installed
}

/** A colour and its name, as one swatch you press. */
function Colour(props: { label: string; value: string; testid: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <input
      type="color"
      aria-label={props.label}
      title={props.label}
      data-testid={props.testid}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="ui-colour"
      style={{ width: 28, height: 20 }}
    />
  )
}

/** How long typing rests before the number is drawn, so "61" does not draw a tiny "6" on its way. */
const NUMBER_TYPING_PAUSE_MS = 150

/**
 * A number in a box, drawn on the text as it changes: a moment after typing
 * rests, or at once with the arrow keys or the wheel. The whole visit to the
 * box is one undo step (`continuing` is true after its first change), and
 * Escape puts back the number it had when the box was entered.
 */
function Num(props: {
  label: string
  value: number
  testid: string
  unit?: string
  step?: number
  /** Below this, a number being typed is on its way to a larger one, and is not drawn yet. */
  min?: number
  onChange: (n: number, continuing: boolean) => void
}): JSX.Element {
  const shown = (n: number): string => String(Math.round(n * 100) / 100)
  const [text, setText] = useState(shown(props.value))
  const focused = useRef(false)
  /** The number when the box was entered, which Escape puts back. */
  const entry = useRef(props.value)
  /** The number this visit last sent, or null while it has sent none. */
  const applied = useRef<number | null>(null)
  const escaped = useRef(false)
  const timer = useRef(0)
  useEffect(() => {
    if (!focused.current) setText(shown(props.value))
  }, [props.value])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const parse = (v: string): number | null => {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) ? n : null
  }
  const apply = (n: number): void => {
    if (n === (applied.current ?? entry.current)) return
    props.onChange(n, applied.current !== null)
    applied.current = n
  }
  return (
    <Field
      label={props.label}
      hideLabel
      kind="number"
      value={text}
      wheel
      onFocus={() => {
        focused.current = true
        entry.current = props.value
        applied.current = null
        escaped.current = false
      }}
      onChange={(v, stepped) => {
        setText(v)
        window.clearTimeout(timer.current)
        const n = parse(v)
        if (n === null) return
        if (stepped === true) apply(props.min === undefined ? n : Math.max(props.min, n))
        else if (props.min === undefined || n >= props.min) timer.current = window.setTimeout(() => apply(n), NUMBER_TYPING_PAUSE_MS)
      }}
      onEscape={() => {
        window.clearTimeout(timer.current)
        escaped.current = true
        if (applied.current !== null) props.onChange(entry.current, true)
        applied.current = null
        setText(shown(entry.current))
      }}
      onCommit={(v) => {
        window.clearTimeout(timer.current)
        if (!focused.current) return
        const n = parse(v)
        if (!escaped.current && n !== null) apply(n)
        focused.current = false
        applied.current = null
        // What the text has now: the number taken, or the one it had when nothing could be.
        setText(shown(n !== null && !escaped.current ? n : props.value))
      }}
      step={props.step ?? 1}
      testid={props.testid}
      style={{ width: 76 }}
      height={24}
      {...(props.unit ? { unit: props.unit } : {})}
    />
  )
}

export function TextPanel(props: {
  style: TextStyle
  /** A change to the text: drawn again and kept, as one undo step, or joined to the last with `continuing`. */
  onChange: (style: TextStyle, continuing?: boolean) => void
  /** How many other texts the project has, and putting this style on all of them (task 34). */
  others?: number
  onApplyToAll?: () => void
}): JSX.Element {
  const style = props.style
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void installedFonts().then((f) => live && setFonts(f))
    return () => {
      live = false
    }
  }, [])

  // The words as they are typed, sent a moment after the typing stops.
  const [words, setWords] = useState(style.text)
  const typing = useRef(0)
  const box = useRef<HTMLTextAreaElement>(null)
  // Words from elsewhere, as an undo or the preview's own text box, are shown,
  // but never while the box is being typed in. The words sent a moment ago
  // come back once the picture is drawn, and by then more has been typed:
  // taking them put back the older words, lost what was typed since, and threw
  // the caret to the end, on every pause.
  useEffect(() => {
    if (document.activeElement !== box.current) setWords(style.text)
  }, [style.text])
  useEffect(() => () => window.clearTimeout(typing.current), [])
  // The style as it is now, for a change sent later: one worked out from the
  // style when the typing began put back a font or size changed meanwhile.
  const latest = useRef(style)
  latest.current = style

  const set = (change: Partial<TextStyle>, continuing = false): void => props.onChange(cleanTextStyle({ ...latest.current, ...change }), continuing)
  // The fonts that come with the app first, then the popular ones on this PC.
  const bundled = [...CAPTION_FONTS.map((f) => f.family), ...TEXT_FONTS.map((f) => f.family)]
  const fontChoices = [...bundled, ...fonts.filter((f) => !bundled.includes(f))]
  if (!fontChoices.includes(style.font)) fontChoices.unshift(style.font)

  return (
    <div data-testid="text-panel" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <textarea
        ref={box}
        data-testid="text-words"
        aria-label="The words"
        value={words}
        rows={Math.min(6, Math.max(2, words.split('\n').length))}
        onChange={(e) => {
          const next = e.target.value
          setWords(next)
          window.clearTimeout(typing.current)
          typing.current = window.setTimeout(() => set({ text: next }), 350)
        }}
        onBlur={() => {
          window.clearTimeout(typing.current)
          if (words !== style.text) set({ text: words })
        }}
        // The editor's keys are for the editor, not while the words are typed.
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          font: type.body,
          color: ink.primary,
          background: surface.well,
          border: `1px solid ${surface.lineStrong}`,
          borderRadius: radius.control,
          padding: '6px 8px',
          resize: 'vertical',
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: space.xs
        }}
      />
      <div style={row}>
        <span style={dim}>Font</span>
        <Select
          label="Font"
          value={style.font}
          onChange={(font) => set({ font })}
          choices={fontChoices.map((f) => ({ value: f, label: f }))}
          testid="text-font"
          height={24}
          style={{ maxWidth: 170 }}
        />
      </div>
      <div style={row}>
        <span style={dim}>Size</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          <Num label="Size" value={style.size} unit="px" testid="text-size" min={TEXT_MIN_SIZE} onChange={(size, c) => set({ size: Math.min(TEXT_MAX_SIZE, Math.max(TEXT_MIN_SIZE, size)) }, c)} />
          <Colour label="The letters' colour" value={style.colour} testid="text-colour" onChange={(colour) => set({ colour })} />
        </span>
      </div>
      <div style={row}>
        <Check checked={style.bold} onChange={(bold) => set({ bold })} testid="text-bold">
          Bold
        </Check>
        <Check checked={style.italic} onChange={(italic) => set({ italic })} testid="text-italic">
          Italic
        </Check>
      </div>
      <div style={row}>
        <span style={dim}>Align</span>
        <Segmented
          label="Align the lines"
          size="small"
          chosen={style.align}
          onChoose={(align: TextAlign) => set({ align })}
          testid="text-align"
          choices={[
            { id: 'left' as TextAlign, label: 'Left' },
            { id: 'center' as TextAlign, label: 'Centre' },
            { id: 'right' as TextAlign, label: 'Right' }
          ]}
        />
      </div>
      <div style={row}>
        <span style={dim}>Line spacing</span>
        <Num label="Line spacing" value={style.lineSpacing} step={0.05} testid="text-spacing" onChange={(lineSpacing, c) => set({ lineSpacing }, c)} />
      </div>

      <div style={row}>
        <span style={dim}>Outline</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          <Num label="Outline width" value={style.outlineWidth} unit="px" testid="text-outline" onChange={(outlineWidth, c) => set({ outlineWidth }, c)} />
          <Colour label="The outline's colour" value={style.outlineColour} testid="text-outline-colour" onChange={(outlineColour) => set({ outlineColour })} />
        </span>
      </div>

      <div style={row}>
        <Check checked={style.shadow} onChange={(shadow) => set({ shadow })} testid="text-shadow">
          Shadow
        </Check>
        {style.shadow && <Colour label="The shadow's colour" value={style.shadowColour} testid="text-shadow-colour" onChange={(shadowColour) => set({ shadowColour })} />}
      </div>
      {style.shadow && (
        <div style={row}>
          <span style={dim}>Blur, across, down</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Num label="Shadow blur" value={style.shadowBlur} testid="text-shadow-blur" onChange={(shadowBlur, c) => set({ shadowBlur }, c)} />
            <Num label="Shadow across" value={style.shadowX} testid="text-shadow-x" onChange={(shadowX, c) => set({ shadowX }, c)} />
            <Num label="Shadow down" value={style.shadowY} testid="text-shadow-y" onChange={(shadowY, c) => set({ shadowY }, c)} />
          </span>
        </div>
      )}

      <div style={row}>
        <Check checked={style.glow} onChange={(glow) => set({ glow })} testid="text-glow">
          Glow
        </Check>
        {style.glow && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
            <Num label="How far the glow reaches" value={style.glowSize} unit="px" testid="text-glow-size" onChange={(glowSize, c) => set({ glowSize }, c)} />
            <Colour label="The glow's colour" value={style.glowColour} testid="text-glow-colour" onChange={(glowColour) => set({ glowColour })} />
          </span>
        )}
      </div>

      <div style={row}>
        <Check checked={style.box} onChange={(box) => set({ box })} testid="text-box">
          Box behind it
        </Check>
        {style.box && <Colour label="The box's colour" value={style.boxColour} testid="text-box-colour" onChange={(boxColour) => set({ boxColour })} />}
      </div>
      {style.box && (
        <>
          <div style={row}>
            <span style={dim}>Opacity</span>
            <Num label="Box opacity" value={Math.round(style.boxOpacity * 100)} unit="%" testid="text-box-opacity" onChange={(n, c) => set({ boxOpacity: n / 100 }, c)} />
          </div>
          <div style={row}>
            <span style={dim}>Corners, padding</span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Num label="Box corners" value={style.boxRadius} unit="px" testid="text-box-radius" onChange={(boxRadius, c) => set({ boxRadius }, c)} />
              <Num label="Box padding" value={style.boxPadding} unit="px" testid="text-box-padding" onChange={(boxPadding, c) => set({ boxPadding }, c)} />
            </span>
          </div>
        </>
      )}
      <HelpTip
        text="Drag a corner of its box on the Output view to make it larger or smaller. A new text starts as the last one you changed."
        tutorial="316-add-text"
        style={{ marginTop: 4 }}
      />
      <Button
        testid="text-reset"
        size="small"
        title="The style every text starts with, keeping these words"
        onClick={() => props.onChange(cleanTextStyle({ ...DEFAULT_TEXT, text: latest.current.text }))}
        style={{ alignSelf: 'flex-start', marginTop: 4 }}
      >
        Reset to default
      </Button>
      <SavedStyles<TextStyle>
        which="savedTextStyles"
        testid="text-saved"
        baseName="My text style"
        current={() => textStyleToSave(latest.current)}
        onUse={(saved) => props.onChange(cleanTextStyle(textStyledAs(saved, latest.current)))}
      />
      {props.onApplyToAll && (props.others ?? 0) > 0 && (
        <ApplyToAll
          testid="text-apply-all"
          label="Apply to all texts"
          title="Give every other text in this project this text's look, keeping its own words, place and timing"
          question="Apply this style to every text?"
          explain={`${props.others === 1 ? 'The other text' : `All ${props.others} other texts`} in this project, in every sequence, will take on this text's font, size, colours, outline, shadow and box. Each keeps its own words, alignment, place and timing. One undo puts them back.`}
          confirm="Apply to all"
          onApply={props.onApplyToAll}
        />
      )}
    </div>
  )
}
