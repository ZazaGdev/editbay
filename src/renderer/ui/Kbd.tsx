import type { CSSProperties, JSX } from 'react'

/**
 * A key, drawn as one. It always shows the key as the keymap has it, never a
 * default, so a key you changed reads as you changed it.
 */
export function Kbd(props: { children: string; style?: CSSProperties }): JSX.Element {
  return (
    <kbd className="ui-kbd" style={props.style}>
      {props.children}
    </kbd>
  )
}
