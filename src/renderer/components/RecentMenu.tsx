import { useCallback, useEffect, useState, type JSX } from 'react'
import type { EarlierVersions, RecentProject } from '../../shared/types'
import { REASON_WORDS, type KeptVersion } from '../../shared/versions'
import { ink, space, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { DropMenu } from './DropMenu'

function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : path
}

/** When a version was kept, as a person says it: today and yesterday by name, otherwise the date. */
export function whenKept(at: number, now = Date.now()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date): string => x.toDateString()
  if (day(d) === day(new Date(now))) return `Today, ${time}`
  if (day(d) === day(new Date(now - 24 * 3600 * 1000))) return `Yesterday, ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

/**
 * The last ten projects, most recent first, opened with one click. A project
 * whose file has gone is greyed out, and clicking it takes it off the list.
 *
 * Under them, the open project's earlier versions, and work never saved
 * (plan 84): everything the app kept rather than throw away, opened again
 * with one click. `askedFor` opens the menu, from Search every action.
 */
export function RecentMenu(props: { onOpen: (path: string) => void; askedFor?: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RecentProject[]>([])
  const [earlier, setEarlier] = useState<EarlierVersions | null>(null)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    // Read afresh each time it opens: a file may have moved since.
    if (!open) return
    void window.api.recentProjects().then(setItems)
    void window.api.earlierVersions().then(setEarlier)
  }, [open])

  useEffect(() => {
    if (props.askedFor) setOpen(true)
  }, [props.askedFor])

  const version = (v: KeptVersion, label: string): JSX.Element => (
    <button
      key={v.id}
      data-testid="earlier-version"
      data-reason={v.reason}
      title={`Open this version. It opens as changed, and what is in the file now is kept too.`}
      onClick={() => {
        setOpen(false)
        void window.api.openEarlierVersion(v.id)
      }}
      type="button"
      className="ui-menu__item"
      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, color: ink.primary }}
    >
      <span style={{ font: type.body }}>{whenKept(v.keptAt)}</span>
      <span style={{ font: type.meta, color: ink.muted }}>{label}</span>
    </button>
  )
  const heading = (text: string, testid: string): JSX.Element => (
    <span data-testid={testid} style={{ font: type.meta, color: ink.muted, padding: `${space.sm}px ${space.sm}px 2px`, borderTop: `1px solid ${surface.line}` }}>
      {text}
    </span>
  )
  const versions = earlier?.versions ?? []
  const unsaved = earlier?.unsaved ?? []
  const ofUntitled = versions[0]?.projectPath === null

  return (
    <DropMenu
      open={open}
      onClose={close}
      testid="recent-list"
      style={{ minWidth: 300, maxWidth: 440 }}
      anchor={
        <Button
          testid="recent-toggle"
          icon={open ? 'up' : 'down'}
          pressed={open}
          onClick={() => setOpen((o) => !o)}
          title="Recent projects"
        >
          Recent
        </Button>
      }
    >
      {items.length === 0 && (
        <span style={{ font: type.meta, color: ink.muted, padding: space.sm }}>No recent projects yet.</span>
      )}
      {items.map((item) => (
        <button
          key={item.path}
          data-testid="recent-item"
          data-path={item.path}
          data-exists={item.exists ? 'yes' : 'no'}
          title={item.exists ? item.path : `${item.path} is no longer there. Click to remove it from the list.`}
          onClick={() => {
            if (item.exists) {
              setOpen(false)
              props.onOpen(item.path)
            } else {
              void window.api.forgetRecent(item.path).then(setItems)
            }
          }}
          type="button"
          className="ui-menu__item"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 1,
            color: item.exists ? ink.primary : ink.disabled,
            textDecoration: item.exists ? 'none' : 'line-through'
          }}
        >
          <span style={{ font: type.body }}>{item.name}</span>
          <span
            style={{
              font: type.meta,
              color: ink.muted,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {folderOf(item.path)}
          </span>
        </button>
      ))}
      {versions.length > 0 && heading(ofUntitled ? 'Work never saved' : `Earlier versions of ${earlier?.name ?? ''}`, 'earlier-versions')}
      {versions.map((v) => version(v, ofUntitled ? `${v.name}: ${REASON_WORDS[v.reason]}` : REASON_WORDS[v.reason]))}
      {unsaved.length > 0 && heading('Work never saved', 'unsaved-work')}
      {unsaved.map((v) => version(v, `${v.name}: ${REASON_WORDS[v.reason]}`))}
    </DropMenu>
  )
}
