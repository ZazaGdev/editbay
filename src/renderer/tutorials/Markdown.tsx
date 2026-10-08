import type { JSX } from 'react'
import { blocks, inlines, type Block, type Inline } from '../../shared/markdown'
import { ink, radius, space, surface, type } from '../theme'
import { Kbd } from '../ui/Kbd'

/**
 * A tutorial's body, drawn from the token tree `shared/markdown` produces.
 *
 * Nothing here turns text into markup. The tokens are walked into elements, so
 * there is no HTML string anywhere in the path. The content is ours and is
 * bundled at build time, so this is not a live risk, but an Electron window
 * that builds markup from text is a habit worth not having and walking the
 * tokens is no harder.
 *
 * Inline code is drawn as a key, because in the tutorials it always is one,
 * and `Kbd` shows whatever the reader has actually bound.
 */
export function Markdown(props: { body: string }): JSX.Element {
  return (
    <div style={{ font: type.body, color: ink.secondary, lineHeight: 1.65 }}>
      {blocks(props.body).map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
}

/** One line of tutorial markdown, such as a step, with no paragraph around it. */
export function MarkdownLine(props: { text: string }): JSX.Element {
  return <InlineView parts={inlines(props.text)} />
}

/** A control as the window names it, so the words on the page look like the thing to press. */
function Chip(props: { children: string }): JSX.Element {
  return (
    <span
      data-testid="tutorial-chip"
      style={{
        display: 'inline-block',
        font: type.meta,
        color: ink.primary,
        background: surface.control,
        border: `1px solid ${surface.edge}`,
        borderBottomWidth: 2,
        borderRadius: radius.control,
        padding: '0 6px',
        lineHeight: '18px',
        whiteSpace: 'nowrap'
      }}
    >
      {props.children}
    </span>
  )
}

function InlineView(props: { parts: Inline[] }): JSX.Element {
  return (
    <>
      {props.parts.map((p, i) => {
        if (p.kind === 'bold') {
          return (
            <strong key={i} style={{ color: ink.primary, fontWeight: 650 }}>
              {p.text}
            </strong>
          )
        }
        if (p.kind === 'italic') return <em key={i}>{p.text}</em>
        if (p.kind === 'key') return <Kbd key={i}>{p.text}</Kbd>
        if (p.kind === 'chip') return <Chip key={i}>{p.text}</Chip>
        return <span key={i}>{p.text}</span>
      })}
    </>
  )
}

function BlockView(props: { block: Block }): JSX.Element {
  const b = props.block

  if (b.kind === 'para') {
    return (
      <p style={{ margin: `0 0 ${space.md}px` }}>
        <InlineView parts={b.text} />
      </p>
    )
  }

  if (b.kind === 'bullets' || b.kind === 'numbers') {
    const items = b.items.map((item, i) => (
      <li key={i} style={{ margin: `0 0 ${space.xs}px` }}>
        <InlineView parts={item} />
      </li>
    ))
    const style = { margin: `0 0 ${space.md}px`, paddingLeft: space.lg } as const
    return b.kind === 'bullets' ? <ul style={style}>{items}</ul> : <ol style={style}>{items}</ol>
  }

  const cell = {
    padding: `${space.xs}px ${space.sm}px`,
    borderBottom: `1px solid ${surface.line}`,
    textAlign: 'left'
  } as const

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', margin: `0 0 ${space.md}px` }}>
      <thead>
        <tr>
          {b.head.map((h, i) => (
            <th key={i} style={{ ...cell, color: ink.muted, font: type.label, letterSpacing: type.labelTracking }}>
              <InlineView parts={h} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {b.rows.map((row, i) => (
          <tr key={i}>
            {row.map((c, j) => (
              <td key={j} style={cell}>
                <InlineView parts={c} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
