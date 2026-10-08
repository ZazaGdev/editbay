/** Plan 99: the box behind captions, their glow and the word being said popping, in How captions look. */
import type { JSX } from 'react'
import { CAPTION_GLOWS, DEFAULT_CAPTION_STYLE, type CaptionStyle, type CaptionStyleChange } from '../../shared/captions'
import { Check } from '../ui/Check'
import { Segmented } from '../ui/Segmented'
import { Percent, dim, row } from './inspector-parts'

/** A colour to pick, as the other caption colours are picked. */
function Swatch(props: { testid: string; label: string; value: string; onChange: (colour: string) => void }): JSX.Element {
  return (
    <input
      type="color"
      data-testid={props.testid}
      aria-label={props.label}
      title={props.label}
      value={props.value.toLowerCase()}
      onChange={(e) => props.onChange(e.target.value.toUpperCase())}
      className="ui-colour"
      style={{ width: 24, height: 20 }}
    />
  )
}

export function CaptionStyleExtras(props: { style: CaptionStyle; setStyle: (change: CaptionStyleChange, continuing?: boolean) => void }): JSX.Element {
  const { style, setStyle } = props
  const d = DEFAULT_CAPTION_STYLE
  return (
    <>
      <div style={{ ...row, alignItems: 'center', marginTop: 4 }}>
        <Check testid="caption-bg" checked={style.box ?? false} onChange={(box) => setStyle({ box })}>
          Box behind the words
        </Check>
        {style.box && <Swatch testid="caption-bg-colour" label="The box's colour" value={style.boxColour ?? d.boxColour} onChange={(boxColour) => setStyle({ boxColour })} />}
      </div>
      {style.box && (
        <div style={{ ...row, alignItems: 'center' }}>
          <span style={dim}>Box opacity</span>
          <Percent testid="caption-bg-opacity" value={style.boxOpacity ?? d.boxOpacity} min={10} max={100} step={5} title="How much of the box is drawn" onChange={(boxOpacity, c) => setStyle({ boxOpacity }, c)} />
        </div>
      )}
      <div style={{ ...row, alignItems: 'center', marginTop: 4 }}>
        <span style={dim}>Glow</span>
        <Swatch testid="caption-glow-colour" label="The glow's colour" value={style.glowColour ?? d.glowColour} onChange={(glowColour) => setStyle({ glowColour })} />
      </div>
      <Segmented
        testid="caption-glow"
        label="How far the glow round the letters reaches"
        size="small"
        stretch
        chosen={String(CAPTION_GLOWS.find((g) => Math.abs(g.glow - (style.glow ?? d.glow)) < 1e-6)?.glow ?? '')}
        onChoose={(v) => setStyle({ glow: Number(v) })}
        choices={CAPTION_GLOWS.map((g) => ({ id: String(g.glow), label: g.name, title: g.glow === 0 ? 'No glow' : `${g.name} glow` }))}
      />
      <span style={{ ...dim, marginTop: 4 }}>Word being said pops</span>
      <div style={{ ...row, alignItems: 'center' }}>
        <Check testid="caption-pop-grow" checked={style.popGrow ?? false} onChange={(popGrow) => setStyle({ popGrow })}>
          <span title="The word being said is drawn bigger than the rest">Bigger</span>
        </Check>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Check testid="caption-pop-box" checked={style.popBox ?? false} onChange={(popBox) => setStyle({ popBox })}>
            <span title="The word being said gets a box of its own behind it">Boxed</span>
          </Check>
          {style.popBox && <Swatch testid="caption-pop-box-colour" label="The colour of the box behind the word being said" value={style.popBoxColour ?? d.popBoxColour} onChange={(popBoxColour) => setStyle({ popBoxColour })} />}
        </span>
      </div>
    </>
  )
}
