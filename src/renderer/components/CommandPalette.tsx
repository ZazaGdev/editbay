import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { findCommands, type Command } from '../../shared/commands'
import { GROUPS } from '../../shared/keymap'
import { surface, ink, accent, space, radius, type } from '../theme'
import { Icon } from '../ui/Icon'
import { Kbd } from '../ui/Kbd'
import { SectionLabel } from '../ui/SectionLabel'
import { Modal } from './Modal'

/** How many of the last actions run are offered before anything is typed. */
const RECENTS = 5

/**
 * The actions run from here before, newest first. Kept for as long as the
 * window is open rather than saved: it is a shortcut back to what you were
 * just doing, not a setting.
 */
let lastRun: string[] = []

function rememberRun(id: string): void {
  lastRun = [id, ...lastRun.filter((x) => x !== id)].slice(0, RECENTS)
}

/** A heading and the commands under it, in the order they are drawn. */
interface Section {
  heading: string
  commands: Command[]
}

/**
 * What the list shows when nothing has been typed: what was run last, then
 * every action under the same four headings the Shortcuts window uses. Listing
 * them in keymap order, as this did before, put Play at the top and Export
 * halfway down with nothing to say why.
 */
function sections(commands: Command[], lastRun: readonly string[]): Section[] {
  const recent = lastRun.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => c !== undefined)
  const rest = commands.filter((c) => !recent.includes(c))
  const grouped = GROUPS.map((heading) => ({
    heading,
    commands: rest.filter((c) => (c.group ?? GROUPS[GROUPS.length - 1]) === heading)
  }))
  return [...(recent.length > 0 ? [{ heading: 'Recent', commands: recent }] : []), ...grouped].filter(
    (s) => s.commands.length > 0
  )
}

/**
 * Every action in one list, found by typing: its name and its key, so the
 * keys can be learned by using it. The arrows choose, Enter runs, Escape
 * closes. What cannot be done just now is shown greyed and not run.
 *
 * It has no title bar and no Close button: it is a box you type in, and
 * Escape is how you leave it.
 */
export function CommandPalette(props: { commands: Command[]; onClose: () => void }): JSX.Element {
  const [typed, setTyped] = useState('')
  // Recent as it was when the list opened. A switch flipped keeps the list
  // open, and moving it to the top at once would slide the rows under the
  // pointer, so the next click landed on another. It moves next time.
  const [recentAtOpen] = useState(() => [...lastRun])
  const [chosen, setChosen] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const found = useMemo(() => findCommands(props.commands, typed), [props.commands, typed])
  // Grouped only when nothing is typed. A search is ranked best first, and
  // headings over a ranked list would break the order they were ranked in.
  const shown = useMemo(
    () => (typed.trim() === '' ? sections(found, recentAtOpen) : [{ heading: '', commands: found }]),
    [found, typed, recentAtOpen]
  )
  // The same commands, in the order they are drawn, so the arrows walk what is
  // on screen rather than what the search returned.
  const walk = useMemo(() => shown.flatMap((s) => s.commands), [shown])

  // A new search starts at the top.
  useEffect(() => setChosen(0), [typed])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${chosen}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  const run = (c: Command | undefined): void => {
    if (!c || c.enabled === false) return
    rememberRun(c.id)
    // A switch flips and the list stays, showing its new state, so the next
    // one can be flipped straight after. An action is done with the list.
    if (c.on === undefined) props.onClose()
    c.run()
  }

  let index = -1

  return (
    <Modal title="Search every action" testid="command-palette" onClose={props.onClose} width={520} bare>
      <div
        className="ui-field__box"
        style={{ height: 36, paddingLeft: 10, background: surface.canvas, borderRadius: radius.control }}
      >
        <span style={{ color: ink.muted, display: 'flex' }}>
          <Icon name="search" />
        </span>
        <input
          ref={box}
          data-testid="command-search"
          autoFocus
          // The keys stay here, whatever else in the box is clicked.
          onBlur={() =>
            requestAnimationFrame(() => {
              if (box.current?.isConnected && document.activeElement !== box.current) box.current.focus()
            })
          }
          type="text"
          className="ui-field__input"
          placeholder="Type what you want to do"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            // Tab would leave for the buttons behind the box.
            if (e.key === 'Tab') e.preventDefault()
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setChosen((i) => (walk.length === 0 ? 0 : (i + step + walk.length) % walk.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(walk[chosen])
            }
          }}
          style={{ font: type.body }}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div
        ref={list}
        role="listbox"
        data-testid="command-list"
        style={{
          marginTop: space.sm,
          maxHeight: 340,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        {walk.length === 0 && (
          <p data-testid="command-none" style={{ font: type.body, color: ink.muted, margin: `${space.sm}px ${space.xs}px` }}>
            Nothing does that. Try another word.
          </p>
        )}
        {shown.map((section) => (
          <div key={section.heading} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {section.heading !== '' && (
              <SectionLabel style={{ display: 'block', padding: `${space.sm}px ${space.sm}px ${space.xs}px` }}>
                {section.heading}
              </SectionLabel>
            )}
            {section.commands.map((c) => {
              index += 1
              const i = index
              return (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={i === chosen}
                  aria-disabled={c.enabled === false}
                  data-testid="command"
                  data-command={c.id}
                  data-index={i}
                  // Only a pointer that moves chooses: the list moving under a still one does not.
                  onMouseMove={() => i !== chosen && setChosen(i)}
                  // Before the search box loses focus, so the click is not lost to a blur.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(c)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: space.lg,
                    padding: `6px ${space.sm}px`,
                    borderRadius: radius.control,
                    font: type.body,
                    cursor: c.enabled === false ? 'default' : 'pointer',
                    background: i === chosen ? accent.wash : 'transparent',
                    boxShadow: i === chosen ? `inset 0 0 0 1px ${accent.washLine}` : 'none',
                    color: c.enabled === false ? ink.disabled : ink.primary
                  }}
                >
                  <span>{c.label}</span>
                  {c.on !== undefined ? (
                    <span
                      data-testid="command-state"
                      data-on={c.on ? 'yes' : 'no'}
                      style={{
                        font: type.meta,
                        padding: '1px 8px',
                        borderRadius: radius.control,
                        color: c.on ? accent.bright : ink.muted,
                        background: c.on ? accent.wash : 'transparent',
                        boxShadow: `inset 0 0 0 1px ${c.on ? accent.washLine : surface.line}`
                      }}
                    >
                      {c.on ? 'On' : 'Off'}
                    </span>
                  ) : (
                    c.key && <Kbd>{c.key}</Kbd>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}
