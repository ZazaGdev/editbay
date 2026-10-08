import type { CSSProperties, JSX, ReactNode } from 'react'

/**
 * The small capitals that name a part of a panel: SOURCE, CLIP, FRAME, CROP,
 * SOUND. Every one of them is this, so they stop disagreeing about case and
 * weight the way the panels did before.
 */
export function SectionLabel(props: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <span className="ui-label" style={props.style}>
      {props.children}
    </span>
  )
}

