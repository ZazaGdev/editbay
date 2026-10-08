import type { JSX } from 'react'
import { ink, space, type } from '../theme'

/**
 * Task 47: after an export, the credits its description needs, each line as
 * it must be given, or that none are needed. They are written beside the
 * video too, as a .credits.txt of the same name.
 */
export function ExportCredits(props: { lines: readonly string[] }): JSX.Element {
  if (props.lines.length === 0) {
    return (
      <p data-testid="export-credits" data-count={0} style={{ font: type.body, color: ink.muted, marginTop: space.sm }}>
        No credits needed in the description.
      </p>
    )
  }
  return (
    <div data-testid="export-credits" data-count={props.lines.length} className="ui-selectable" style={{ marginTop: space.sm }}>
      <p style={{ font: type.body, color: ink.primary, margin: 0 }}>Put these credits in the video's description (also saved beside it):</p>
      {props.lines.map((l) => (
        <p key={l} data-testid="export-credit" style={{ font: type.body, color: ink.secondary, margin: '2px 0 0', userSelect: 'text' }}>
          {l}
        </p>
      ))}
    </div>
  )
}
