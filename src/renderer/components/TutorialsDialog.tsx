import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  CATEGORIES,
  countByCategory,
  findTutorials,
  type Category,
  type Hit,
  type Snippet,
  type Step,
  type Tutorial
} from '../../shared/tutorials'
import { TUTORIALS } from '../tutorials/load'
import { ShowMe } from '../tutorials/ShowMe'
import type { Picker } from '../tutorials/show-target'
import { TutorialEntry, type View } from '../tutorials/TutorialEntry'
import { accent, ink, radius, space, surface, type } from '../theme'
import { Modal } from './Modal'
import { commandKey } from '../../shared/system'

/** Offered when a search finds nothing, rather than an empty panel. */
const STARTING_POINTS = ['040-your-first-edit', '150-remove-silences', '050-the-keys-worth-learning']

/** "All" sits in front of the eight categories while a search is running. */
type Tab = Category | 'All'

/**
 * The tutorials, in tabs, with one search across every one of them.
 *
 * The whole design turns on one moment: someone with the Framing tab open
 * types "silence" and the answer is in Cutting. So a search always looks
 * everywhere, the tabs become filters with counts while one is running, "All"
 * is selected by default so the cross-category result is the one you see, and
 * every result says which category it came from. Without that the search and
 * the tabs would quietly disagree.
 */
export function TutorialsDialog(props: {
  onClose: () => void
  /** The entry to open at, by its id, as a "?" beside a control asks (task 60). */
  at?: string | undefined
  /** The playhead and the app's own selecting, for a Show me that selects a clip first (task 84). */
  pick?: Picker | undefined
}): JSX.Element {
  const [typed, setTyped] = useState('')
  const opening = TUTORIALS.find((x) => x.id === props.at)
  const [tab, setTab] = useState<Tab>(opening?.category ?? 'Getting started')
  const startAt = opening ? TUTORIALS.filter((x) => x.category === opening.category).indexOf(opening) : 0
  const [chosen, setChosen] = useState(startAt)
  const [view, setView] = useState<View>('steps')
  /** The step whose Show me is pointing, while the window steps aside for it. */
  const [pointing, setPointing] = useState<Step | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const searching = typed.trim() !== ''
  const hits = useMemo(() => (searching ? findTutorials(TUTORIALS, typed) : []), [typed, searching])
  const counts = useMemo(() => countByCategory(hits), [hits])

  /** What the list shows: ranked hits while searching, otherwise the tab's own entries. */
  const shown: Hit[] = useMemo(() => {
    if (!searching) {
      return TUTORIALS.filter((t) => t.category === tab).map((t) => ({ tutorial: t, rank: 0 }))
    }
    return tab === 'All' ? hits : hits.filter((h) => h.tutorial.category === tab)
  }, [searching, hits, tab])

  // A new search starts at the top of its results, and on "All", because the
  // point of searching is to leave the tab you were on.
  // Not as it opens, which may be at an entry asked for.
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) return
    setChosen(0)
    if (typed.trim() !== '') setTab('All')
  }, [typed])

  useEffect(() => {
    if (opened.current) setChosen(0)
    opened.current = true
  }, [tab])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${chosen}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [chosen, shown])

  // The window is usable by typing the moment it opens.
  useEffect(() => box.current?.focus(), [])

  const tabs: Tab[] = searching ? ['All', ...CATEGORIES] : [...CATEGORIES]
  const open = shown[Math.min(chosen, shown.length - 1)]?.tutorial

  // Every entry opens on its steps.
  useEffect(() => setView('steps'), [open?.id])

  // Back from Show me, the search box has the keys again.
  useEffect(() => {
    if (!pointing) box.current?.focus()
  }, [pointing])

  // On the window and in the capture phase, because `Modal` already takes
  // Escape there and stops it propagating. Its own handler does nothing while
  // `keepOpen` is set, and a second listener on the same node still runs, so
  // this is where the keys have to live rather than on the element.
  //
  // The search box always holds focus, so the plain arrows cannot be used for
  // anything that would fight the caret: Up and Down move the list because a
  // one-line input has no use for them, and changing tab needs Ctrl.
  const onKeys = useRef<(e: KeyboardEvent) => void>(() => undefined)
  onKeys.current = (e: KeyboardEvent): void => {
    if (pointing) {
      // While Show me points, Escape brings the tutorial back and nothing else
      // reaches the keys: the window is out of the way, not closed.
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPointing(null)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      // Escape clears a search first and closes only when there is nothing to
      // clear, so one press never throws away what you typed and the window
      // together.
      if (searching) setTyped('')
      else props.onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setChosen((c) => Math.min(c + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setChosen((c) => Math.max(c - 1, 0))
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && commandKey(e)) {
      const at = tabs.indexOf(tab)
      const next = e.key === 'ArrowRight' ? at + 1 : at - 1
      if (next >= 0 && next < tabs.length) {
        e.preventDefault()
        setTab(tabs[next]!)
      }
    } else if (e.key === 'f' && commandKey(e)) {
      e.preventDefault()
      box.current?.focus()
      box.current?.select()
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => onKeys.current(e)
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  if (pointing) return <ShowMe step={pointing} pick={props.pick} onDone={() => setPointing(null)} />

  return (
    <Modal title="Tutorials" testid="tutorials" onClose={props.onClose} width={900} keepOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, height: 560 }}>
        <input
          ref={box}
          data-testid="tutorial-search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Search every tutorial"
          aria-label="Search every tutorial"
          style={{
            font: type.body,
            color: ink.primary,
            background: surface.sunken,
            border: `1px solid ${surface.lineStrong}`,
            borderRadius: radius.control,
            padding: `${space.sm}px ${space.md}px`,
            outline: 'none'
          }}
        />

        <div data-testid="tutorial-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
          {tabs.map((t) => {
            const n = searching ? (t === 'All' ? hits.length : (counts.get(t) ?? 0)) : 0
            const on = t === tab
            return (
              <button
                key={t}
                data-testid="tutorial-tab"
                data-tab={t}
                data-count={searching ? n : undefined}
                aria-pressed={on}
                onClick={() => setTab(t)}
                disabled={searching && n === 0}
                style={{
                  font: type.meta,
                  color: on ? ink.onAccent : searching && n === 0 ? ink.disabled : ink.secondary,
                  background: on ? accent.base : surface.control,
                  border: `1px solid ${on ? accent.base : surface.lineStrong}`,
                  borderRadius: radius.chip,
                  padding: `3px ${space.sm}px`,
                  cursor: searching && n === 0 ? 'default' : 'pointer'
                }}
              >
                {t}
                {searching ? ` ${n}` : ''}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: space.md, flex: 1, minHeight: 0 }}>
          <div
            ref={list}
            data-testid="tutorial-list"
            style={{ width: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {shown.length === 0 ? (
              <NothingFound onPick={(id) => pick(id, setTyped, setTab, setChosen)} />
            ) : (
              shown.map((h, i) => (
                <Row
                  key={h.tutorial.id}
                  hit={h}
                  index={i}
                  chosen={i === chosen}
                  showCategory={searching && tab === 'All'}
                  onPick={() => setChosen(i)}
                />
              ))
            )}
          </div>

          <div
            data-testid="tutorial-body"
            data-tutorial={open?.id}
            style={{
              flex: 1,
              overflowY: 'auto',
              background: surface.panel,
              border: `1px solid ${surface.line}`,
              borderRadius: radius.panel,
              padding: space.lg
            }}
          >
            {open ? <TutorialEntry tutorial={open} view={view} onView={setView} onShowMe={setPointing} /> : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function pick(
  id: string,
  setTyped: (s: string) => void,
  setTab: (t: Tab) => void,
  setChosen: (n: number) => void
): void {
  const t = TUTORIALS.find((x) => x.id === id)
  if (!t) return
  setTyped('')
  setTab(t.category)
  setChosen(TUTORIALS.filter((x) => x.category === t.category).findIndex((x) => x.id === id))
}

function NothingFound(props: { onPick: (id: string) => void }): JSX.Element {
  return (
    <div data-testid="tutorial-none" style={{ font: type.body, color: ink.muted, padding: space.sm }}>
      <p style={{ margin: `0 0 ${space.md}px` }}>Nothing matched. These are where most people start:</p>
      {STARTING_POINTS.map((id) => {
        const t = TUTORIALS.find((x) => x.id === id)
        return t ? (
          <button
            key={id}
            data-testid="tutorial-starting-point"
            onClick={() => props.onPick(id)}
            style={{
              display: 'block',
              font: type.body,
              color: accent.bright,
              background: 'none',
              border: 'none',
              padding: `2px 0`,
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            {t.title}
          </button>
        ) : null
      })}
    </div>
  )
}

function Row(props: {
  hit: Hit
  index: number
  chosen: boolean
  showCategory: boolean
  onPick: () => void
}): JSX.Element {
  const { tutorial, snippet } = props.hit
  return (
    <button
      data-testid="tutorial-row"
      data-index={props.index}
      data-tutorial={tutorial.id}
      data-category={tutorial.category}
      aria-pressed={props.chosen}
      onClick={props.onPick}
      style={{
        textAlign: 'left',
        background: props.chosen ? accent.wash : 'transparent',
        border: `1px solid ${props.chosen ? accent.washLine : 'transparent'}`,
        borderRadius: radius.control,
        padding: `${space.sm}px ${space.md}px`,
        cursor: 'pointer'
      }}
    >
      <div style={{ font: type.body, color: ink.primary }}>{tutorial.title}</div>
      {props.showCategory ? (
        <div style={{ font: type.label, letterSpacing: type.labelTracking, color: ink.muted, marginTop: 2 }}>
          {tutorial.category.toUpperCase()}
        </div>
      ) : null}
      {snippet ? <Marked snippet={snippet} /> : null}
    </button>
  )
}

/** The line a search matched, with the term picked out of it. */
function Marked(props: { snippet: Snippet }): JSX.Element {
  const { line, from, to } = props.snippet
  return (
    <div
      data-testid="tutorial-snippet"
      style={{
        font: type.meta,
        color: ink.muted,
        marginTop: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
    >
      {line.slice(0, from)}
      <span style={{ color: accent.bright }}>{line.slice(from, to)}</span>
      {line.slice(to)}
    </div>
  )
}

export type { Tutorial }
