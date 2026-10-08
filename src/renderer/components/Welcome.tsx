import { useEffect, useRef, useState, type JSX } from 'react'
import { MAX_PROJECT_NAME, UNTITLED } from '../../shared/project'
import type { Recording, RecentProject } from '../../shared/types'
import { actionLabel, keyLabel, type ActionId, type Keymap } from '../../shared/keymap'
import { surface, ink, radius, space, type } from '../theme'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { Kbd } from '../ui/Kbd'
import { SectionLabel } from '../ui/SectionLabel'

/** How many recent projects are offered. */
const RECENT = 5
/** How often the newest recording is looked at again. */
const REFRESH_MS = 3000

/**
 * What an empty window says: how to start, the projects worked on lately, the
 * newest recording from OBS, and the three things you actually do, drawn, with
 * the keys as they are set.
 *
 * Three rather than the five it listed before: bringing a recording in and
 * putting it on the timeline are one thing you do, and framing is part of
 * cutting. Five numbered lines read as a manual; three read as the work.
 */
export function Welcome(props: {
  keymap: Keymap
  /** What the project is called, as the top bar shows it. */
  name: string
  /** Call the project something: the same as renaming it in the top bar. */
  onRename: (name: string) => void
  onAddFiles: () => void
  onOpenProject: () => void
  onOpenRecent: (path: string) => void
  onImport: (path: string) => void
  onTutorials: () => void
}): JSX.Element {
  const [recent, setRecent] = useState<RecentProject[]>([])
  // Empty while it is Untitled, which the field shows greyed as its placeholder.
  const shown = props.name === UNTITLED ? '' : props.name
  /** The name being typed, or null while the field shows the project's own. */
  const [typing, setTyping] = useState<string | null>(null)
  const typed = useRef<string | null>(null)
  typed.current = typing
  const rename = useRef(props.onRename)
  rename.current = props.onRename
  const keepName = (): void => {
    // From the ref, which Escape has already emptied when it is what took the field away.
    const t = typed.current
    typed.current = null
    if (t !== null && t.trim() !== '' && t.trim() !== shown) props.onRename(t)
    setTyping(null)
  }
  // A name typed and then files dropped in: the screen goes as they land, and the name is kept.
  useEffect(
    () => () => {
      const t = typed.current
      if (t !== null && t.trim() !== '') rename.current(t)
    },
    []
  )
  const [newest, setNewest] = useState<Recording | null>(null)

  useEffect(() => {
    let live = true
    void window.api.recentProjects().then((r) => live && setRecent(r.filter((p) => p.exists).slice(0, RECENT)))
    // Looked at again as often as main looks at the folder, so a recording
    // that finishes while this is on screen is offered.
    const look = (): void =>
      void window.api.recordings().then((l) => live && setNewest(l.recordings.find((r) => !r.recording) ?? null))
    look()
    const timer = setInterval(look, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  // The key as it is set, or the action's name for one with no key.
  const key = (id: ActionId): string => keyLabel(props.keymap, id) || `"${actionLabel(id)}"`
  const steps: { icon: IconName; name: string; what: string; keys: string[] }[] = [
    {
      icon: 'picture',
      name: 'Bring it in',
      what: 'Drop recordings anywhere in this window, then drag one down onto a track.',
      keys: []
    },
    {
      icon: 'split',
      name: 'Cut it down',
      what: 'Split at the playhead, trim a clip to it, and drag the crop box over the picture.',
      keys: [key('split'), key('trimStartToPlayhead'), key('trimEndToPlayhead')]
    },
    {
      icon: 'export',
      name: 'Send it out',
      what: 'One video, or one file per clip, in the shape the app you post to wants.',
      keys: [key('export')]
    }
  ]

  return (
    <div
      data-testid="welcome"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 4,
        overflowY: 'auto',
        display: 'flex',
        padding: 24,
        boxSizing: 'border-box',
        // Over the caption, the frame's outline and the guides.
        background: surface.well,
        color: ink.primary
      }}
    >
      {/* Centred by its margins, which give way when it is taller than the monitor, so the top can still be scrolled to. */}
      <div style={{ margin: 'auto', maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/*
          Not focused when the screen opens: dropping files or pressing Add is
          the usual first step, and a focused field would take keys such as F1.
          Enter, leaving the field, or files landing all keep what is typed.
        */}
        <label className="ui-field">
          <span className="ui-field__label">Project name</span>
          <span className="ui-field__box" style={{ height: 32 }}>
            <input
              type="text"
              data-testid="welcome-name"
              className="ui-field__input"
              placeholder={UNTITLED}
              value={typing ?? shown}
              maxLength={MAX_PROJECT_NAME}
              onChange={(e) => setTyping(e.target.value)}
              onBlur={keepName}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  typed.current = null
                  e.currentTarget.blur()
                }
              }}
              style={{ width: '100%', minWidth: 0, font: type.body }}
            />
          </span>
        </label>
        <div>
          <h2 style={{ font: type.display, color: ink.primary, margin: `0 0 ${space.xs}px` }}>Start with a recording</h2>
          <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>
            Drop video, sound or image files anywhere in this window, or:
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
          <Button testid="welcome-add" variant="primary" size="large" icon="add" onClick={props.onAddFiles}>
            Add files
          </Button>
          <Button testid="welcome-open" size="large" icon="open" onClick={props.onOpenProject}>
            Open project
          </Button>
          {newest && (
            <Button
              testid="welcome-recording"
              size="large"
              icon="picture"
              onClick={() => props.onImport(newest.path)}
              title={newest.path}
            >
              Import {newest.name}
            </Button>
          )}
        </div>

        {recent.length > 0 && (
          <div>
            <SectionLabel style={{ display: 'block', marginBottom: 6 }}>Recent projects</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recent.map((r) => (
                <button
                  key={r.path}
                  data-testid="welcome-recent"
                  onClick={() => props.onOpenRecent(r.path)}
                  title={r.path}
                  type="button"
                  className="ui-menu__item"
                  style={{
                    border: `1px solid ${surface.line}`,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          data-testid="welcome-steps"
          data-count={steps.length}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.sm }}
        >
          {steps.map((s) => (
            <div
              key={s.name}
              data-testid="welcome-step"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: space.md,
                borderRadius: radius.panel,
                background: surface.panel,
                border: `1px solid ${surface.line}`
              }}
            >
              <span style={{ color: ink.secondary }}>
                <Icon name={s.icon} size={18} />
              </span>
              <span style={{ font: type.title, color: ink.primary }}>{s.name}</span>
              <span style={{ font: type.meta, color: ink.secondary, flexGrow: 1 }}>{s.what}</span>
              {s.keys.length > 0 && (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
                  {s.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>

        {/*
          Under the three things, not above them, so it does not read as
          homework before you are allowed to start. It is the line a first-time
          user actually sees, and the only place the tutorials are offered
          before you know the key.
        */}
        <button
          data-testid="welcome-tutorials"
          onClick={props.onTutorials}
          style={{
            alignSelf: 'center',
            font: type.meta,
            color: ink.secondary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: space.xs
          }}
        >
          New to this? Read the tutorials <Kbd>{key('showTutorials')}</Kbd>
        </button>
      </div>
    </div>
  )
}
