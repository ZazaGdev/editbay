import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'
import { accent, ink, radius, space, surface, type } from './theme'

/**
 * What the window shows when something in it breaks while drawing (audit
 * 2026-10-01). Without it the window went blank, with no menu to get out by,
 * and every launch after opened the same project and went blank again.
 *
 * The project itself is safe in the main process, and a recovery copy is
 * written a moment after every change, so this offers to save it, open
 * another, start a new one, or draw the window again. Main is told, so the
 * next launch does not open this project by itself.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.api.windowCrashed(`${error.message}\n${info.componentStack ?? ''}`).catch(() => undefined)
  }

  override render(): ReactNode {
    const error = this.state.error
    if (!error) return this.props.children
    return <Fallback message={error.message} />
  }
}

function Fallback(props: { message: string }): JSX.Element {
  const button = (label: string, testid: string, run: () => void, primary = false): JSX.Element => (
    <button
      type="button"
      data-testid={testid}
      onClick={run}
      style={{
        font: type.body,
        padding: `${space.sm}px ${space.md}px`,
        borderRadius: radius.control,
        border: `1px solid ${surface.line}`,
        background: primary ? accent.base : surface.raised,
        color: primary ? ink.onAccent : ink.primary,
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  )
  return (
    <main
      data-testid="crash-screen"
      style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: surface.canvas, color: ink.primary }}
    >
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: space.md, padding: space.xl }}>
        <h1 style={{ font: type.title, margin: 0 }}>Something in the window broke</h1>
        <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>
          Your project is safe: it is kept outside the window, and a recovery copy is written a moment after every change. Save it now, or open
          another project.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
          {button('Save', 'crash-save', () => void window.api.saveProject(false), true)}
          {button('Save as', 'crash-save-as', () => void window.api.saveProject(true))}
          {button('Open another project', 'crash-open', () => void window.api.openProject().then((opened) => opened && location.reload()))}
          {button('New project', 'crash-new', () => void window.api.newProject().then((made) => made && location.reload()))}
          {button('Draw the window again', 'crash-reload', () => location.reload())}
        </div>
        <pre className="ui-selectable" style={{ font: type.monoSmall, color: ink.muted, whiteSpace: 'pre-wrap', margin: 0 }}>
          {props.message}
        </pre>
      </div>
    </main>
  )
}
