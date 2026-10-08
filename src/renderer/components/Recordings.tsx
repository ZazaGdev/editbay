import { useEffect, useState, type JSX } from 'react'
import { pollAfterAnswer } from '../state/poll'
import type { Recording, RecordingsListing } from '../../shared/types'
import { ink, space, type } from '../theme'
import { Button } from '../ui/Button'

/** How often the list is refreshed while it is open, as often as main looks. */
const REFRESH_MS = 3000

function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

export function when(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The newest recordings, looked at again every few seconds while `active`, and null until the first answer. */
export function useRecordings(active: boolean): [RecordingsListing | null, (l: RecordingsListing) => void] {
  const [listing, setListing] = useState<RecordingsListing | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    const stop = pollAfterAnswer(
      () =>
        window.api.recordings().then((l) => {
          if (live) setListing(l)
        }),
      REFRESH_MS
    )
    return () => {
      live = false
      stop()
    }
  }, [active])
  return [listing, setListing]
}

/** The recordings named with the search, or every one when nothing is searched for. */
export function recordingsMatching(listing: RecordingsListing | null, search: string): Recording[] | null {
  return listing ? listing.recordings.filter((r) => search === '' || r.name.toLowerCase().includes(search)) : null
}

/**
 * What Recordings shows opened: its folder, with a way to choose another,
 * and the newest recordings in it, each ready to import, still being
 * recorded, or already in the project.
 */
export function RecordingsBody(props: {
  listing: RecordingsListing | null
  onListing: (l: RecordingsListing) => void
  /** The recordings to show: all of them, or those the search found. */
  matches: Recording[] | null
  /** Every file in the bin, by its path in lower case. */
  imported: Set<string>
  onImport: (path: string) => void
}): JSX.Element {
  const { listing } = props
  const change = async (): Promise<void> => {
    const l = await window.api.chooseRecordingsFolder()
    if (l) props.onListing(l)
  }
  return (
    <div data-testid="recordings-list" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', font: type.meta, color: ink.muted }}>
        <span
          data-testid="recordings-folder"
          title={listing?.folder ?? ''}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {listing === null
            ? 'Looking...'
            : listing.folder === null
              ? "OBS's recording folder was not found. Choose one with Change..."
              : `${listing.folder}${listing.fromObs ? ', from OBS' : ''}`}
        </span>
        <Button testid="recordings-change" size="small" onClick={() => void change()}>
          Change...
        </Button>
      </div>
      {listing !== null && listing.folder !== null && listing.recordings.length === 0 && (
        <p style={{ font: type.meta, color: ink.muted, margin: 0 }}>No recordings there yet.</p>
      )}
      {props.matches?.map((r) => {
        const inProject = props.imported.has(r.path.toLowerCase())
        return (
          <div
            key={r.path}
            data-testid="recording"
            data-name={r.name}
            data-state={r.recording ? 'recording' : inProject ? 'imported' : 'ready'}
            style={{ display: 'flex', gap: 6, alignItems: 'center', font: type.meta, color: ink.primary }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div title={r.path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </div>
              <div style={{ font: type.meta, color: ink.muted }}>
                {when(r.modifiedAt)}, {size(r.size)}
                {r.recording ? ', recording...' : inProject ? ', in this project' : ''}
              </div>
            </div>
            {!r.recording && !inProject && (
              <Button testid="recording-import" size="small" onClick={() => props.onImport(r.path)}>
                Import
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
