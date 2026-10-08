import type { CSSProperties, JSX, ReactNode } from 'react'

/**
 * The layout a wrapped button hands up to its parent. These say where a
 * control sits among its neighbours rather than what it looks like, so they
 * belong to whichever element is actually the parent's child.
 */
const handedUp = [
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'justifySelf',
  'gridColumn',
  'gridRow',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom'
] as const

/** The style the button keeps: everything except what the wrapper takes over. */
export function styleInside(style: CSSProperties | undefined): CSSProperties | undefined {
  if (!style) return undefined
  // Only the margins would be applied twice. A width or a flex setting left on
  // the button makes it fill the wrapper, which is the same size, which is what
  // a button told to stretch should do.
  const { margin, marginLeft, marginRight, marginTop, marginBottom, ...rest } = style
  return rest
}

/**
 * A disabled button around a span carrying its reason.
 *
 * Chromium sends a disabled control no pointer events, so its own `title`
 * never shows. The wrapper does show, and it takes the button's place in the
 * parent's layout, so a button told to stretch still stretches once it is off.
 */
export function WhyOff(props: { why: string; style?: CSSProperties | undefined; children: ReactNode }): JSX.Element {
  const outer: CSSProperties = { display: 'inline-flex' }
  for (const key of handedUp) {
    const value = props.style?.[key]
    if (value !== undefined) Object.assign(outer, { [key]: value })
  }
  return (
    <span title={props.why} style={outer}>
      {props.children}
    </span>
  )
}
