/**
 * A small "?" in place of a sentence of explanation sitting in a panel (task
 * 60): the sentence shows on hover, and a click opens the tutorial that
 * explains the whole of it.
 */

import type { CSSProperties, JSX } from 'react'
import { IconButton } from './IconButton'

/** Heard by the window, which opens the tutorials at the entry named. */
export const OPEN_TUTORIAL = 'editbay-open-tutorial'

/** Open the tutorials at one entry, by its file name such as `150-remove-silences`. */
export function openTutorial(id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_TUTORIAL, { detail: id }))
}

export function HelpTip(props: {
  /** What it explains, in a sentence or two, read on hover. */
  text: string
  /** The tutorial a click opens. */
  tutorial: string
  testid?: string | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  return (
    <IconButton
      icon="help"
      label={`${props.text} Click for the tutorial.`}
      testid={props.testid ?? 'help-tip'}
      data={{ 'data-tutorial': props.tutorial }}
      size="small"
      variant="ghost"
      onClick={() => openTutorial(props.tutorial)}
      style={{ width: 20, height: 20, flexShrink: 0, ...props.style }}
    />
  )
}
