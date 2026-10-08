import { useEffect, useRef, useState, type JSX } from 'react'
import { listenTracks, trackCount, trackName, type AudioTrack, type Timeline } from '../../shared/project'
import { captionsWithin, type Stretch } from '../../shared/captions'
import { formatTimecode } from '../../shared/time'
import { Segmented } from '../ui/Segmented'

/** Plan 78: what captions are made for: the whole sequence, the selected clips, or In to Out. */
export type CaptionScope = 'whole' | 'selected' | 'marked'
import { clipNameFromPath } from '../../shared/filename'
import type { SpeechRun } from '../state/useSpeech'
import { Modal } from './Modal'
import { surface, ink, meaning, danger, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Meter } from '../ui/Meter'
import { SectionLabel } from '../ui/SectionLabel'

const note = { font: type.meta, color: meaning.attention, display: 'block', marginTop: space.sm }
const failure = { font: type.body, color: danger.ink, margin: '10px 0 0' }

/** What is heard on a track, by the names of what is on it, or null when nothing is. */
function heardOn(t: Timeline, track: AudioTrack): string | null {
  const names: string[] = []
  for (const c of track.clips) {
    const m = t.media.find((x) => x.id === c.mediaId)
    if (!m || c.muted || c.gain <= 0) continue
    const name = trackCount(m) > 1 ? `${clipNameFromPath(m.originalPath)}, ${trackName(m, c.track)}` : clipNameFromPath(m.originalPath)
    if (!names.includes(name)) names.push(name)
  }
  if (names.length === 0) return null
  return names.length > 2 ? `${names.slice(0, 2).join('; ')} and ${names.length - 2} more` : names.join('; ')
}

function Bar(props: { testid: string; fraction: number; label: string }): JSX.Element {
  const percent = Math.round(props.fraction * 100)
  return (
    <div style={{ marginTop: space.md }}>
      <Meter testid={props.testid} fraction={props.fraction} label={props.label} />
      <div style={{ display: 'flex', gap: space.sm, marginTop: 6, font: type.meta, color: ink.secondary }}>
        <span>{percent}%</span>
        <span>{props.label}</span>
      </div>
    </div>
  )
}

/**
 * Make captions: which audio tracks to listen to, the speech model's download
 * the first time, and the listening, with its progress and a way to stop.
 * The talking head's own sound and any voice over are ticked to begin with,
 * and music is not, since it makes the words worse. The listening belongs to
 * the app, not to this window, so closing it leaves the listening running.
 */
export function CaptionsDialog(props: {
  timeline: Timeline
  speech: SpeechRun
  /** Why the last listening failed, until it is tried again. */
  error: { text: string; details?: string } | null
  /** Start listening to these tracks, over the whole sequence or only these stretches. The app puts the words on the caption track when they come. */
  onListen: (listenTo: string[], stretches?: Stretch[]) => void
  onClose: () => void
  /** Plan 78: the stretches the selected clips cover, when clips are selected. */
  selection?: Stretch[] | undefined
  /** In to Out, when both are marked. */
  marked?: Stretch | null | undefined
  /** Which to choose first; the selected clips when there are any. */
  scope?: CaptionScope | undefined
}): JSX.Element {
  const { timeline: t, speech, error } = props
  const selection = props.selection && props.selection.length > 0 ? props.selection : null
  const marked = props.marked ?? null
  const [scope, setScope] = useState<CaptionScope>(() => {
    const wanted = props.scope ?? (selection ? 'selected' : 'whole')
    return wanted === 'selected' && !selection ? 'whole' : wanted === 'marked' && !marked ? 'whole' : wanted
  })
  const stretches = scope === 'selected' ? (selection ?? []) : scope === 'marked' && marked ? [marked] : []
  const replaced = stretches.length > 0 ? captionsWithin(t.captions.clips, stretches) : t.captions.clips
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(listenTracks(t)))
  /** Asking whether to download the model, having been asked to make captions. */
  const [asking, setAsking] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  /** Make was pressed and is waiting for the download to finish. */
  const [waiting, setWaiting] = useState(false)
  const open = useRef(true)
  useEffect(() => () => void (open.current = false), [])

  const heard = t.audioTracks.map((r) => heardOn(t, r))
  const listenTo = t.audioTracks.filter((r, i) => chosen.has(r.id) && heard[i] !== null).map((r) => r.id)
  const had = t.captions.clips.length

  const listen = (): void => props.onListen(listenTo, stretches.length > 0 ? stretches : undefined)

  const make = async (): Promise<void> => {
    // Asked afresh: the engine's folder may have gone since the window last looked.
    if (!(await speech.check())) {
      if (open.current) setAsking(true)
      return
    }
    if (open.current) listen()
  }

  const download = async (): Promise<void> => {
    setAsking(false)
    setWaiting(true)
    const ready = await speech.download()
    if (!open.current) return
    setWaiting(false)
    if (ready) listen()
  }

  const busy = speech.transcribing
  return (
    <Modal title="Make captions" testid="captions-dialog" onClose={props.onClose} width={480}>
      {(selection || marked) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, marginTop: space.md }}>
          <SectionLabel>Make captions for</SectionLabel>
          <Segmented
            testid="captions-scope"
            label="What to make captions for"
            size="small"
            stretch
            chosen={scope}
            onChoose={setScope}
            choices={[
              { id: 'whole' as const, label: 'The whole sequence', title: 'Listen to all of it, and replace every caption' },
              ...(selection ? [{ id: 'selected' as const, label: 'The selected clips', title: 'Only what the selected clips cover, each on its own' }] : []),
              ...(marked ? [{ id: 'marked' as const, label: 'In to Out', title: 'Only the range marked with In and Out' }] : [])
            ]}
          />
          {stretches.length > 0 && (
            <span data-testid="captions-scope-note" style={{ font: type.meta, color: ink.secondary }}>
              {replaced.length === 0
                ? `Adds captions between ${formatTimecode(stretches[0]!.from, t.fps)} and ${formatTimecode(stretches.at(-1)!.to, t.fps)}, and leaves every other caption as it is.`
                : `Replaces the ${replaced.length === 1 ? 'caption' : `${replaced.length} captions`} between ${formatTimecode(stretches[0]!.from, t.fps)} and ${formatTimecode(stretches.at(-1)!.to, t.fps)}, and leaves every other caption as it is.`}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, marginTop: space.md }}>
        <SectionLabel>Listen to</SectionLabel>
        {t.audioTracks.map((r, i) => (
          <span key={r.id} data-testid="captions-track" data-track-id={r.id} style={{ display: 'flex', minWidth: 0 }}>
            <Check
              testid="captions-track-listen"
              checked={chosen.has(r.id) && heard[i] !== null}
              disabled={heard[i] === null || busy}
              whyDisabled={heard[i] === null ? 'Nothing is heard on this track' : 'Listening just now'}
              onChange={(on) => {
                const next = new Set(chosen)
                if (on) next.add(r.id)
                else next.delete(r.id)
                setChosen(next)
              }}
              style={{ minWidth: 0 }}
            >
              <span style={{ font: type.monoSmall, color: ink.muted }}>A{i + 1}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {heard[i] ?? 'nothing heard'}
              </span>
            </Check>
          </span>
        ))}
      </div>

      {had > 0 && stretches.length === 0 && (
        <span data-testid="captions-replace-note" style={note}>
          {t.captions.edited
            ? 'Some captions have been changed by hand. Making them again replaces every caption, those changes too.'
            : 'Making them again replaces the captions there are.'}
        </span>
      )}

      {asking ? (
        <div
          data-testid="captions-download-ask"
          style={{
            marginTop: 14,
            padding: space.md,
            borderRadius: radius.panel,
            background: surface.raised,
            border: `1px solid ${surface.lineStrong}`,
            font: type.body,
            color: ink.primary
          }}
        >
          <p style={{ margin: '0 0 10px' }}>Captions are made on this computer by a speech model. Download it once (about 200 MB)?</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button testid="captions-download" variant="primary" icon="download" onClick={() => void download()}>
              Download
            </Button>
            <Button testid="captions-download-cancel" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          testid="captions-make"
          variant="primary"
          size="large"
          onClick={() => void make()}
          disabled={busy || speech.downloading || listenTo.length === 0}
          whyDisabled={
            busy
              ? 'Listening just now'
              : speech.downloading
                ? 'The speech model is still downloading'
                : 'Tick a track with something heard on it'
          }
          style={{ marginTop: space.lg, width: '100%' }}
        >
          {busy ? 'Listening...' : replaced.length > 0 ? 'Make captions again' : 'Make captions'}
        </Button>
      )}

      {speech.downloading && (
        <>
          <Bar testid="captions-download-progress" fraction={speech.downloadFraction} label="Downloading the speech model" />
          <p style={{ font: type.meta, color: ink.muted, margin: '6px 0 0' }}>
            {waiting ? 'Captions are made as soon as it is here.' : 'It carries on if you close this.'}
          </p>
          <Button
            testid="captions-download-stop"
            size="small"
            onClick={speech.cancelDownload}
            style={{ marginTop: space.sm }}
          >
            Cancel download
          </Button>
        </>
      )}
      {speech.downloadError && !speech.downloading && <p style={failure}>{speech.downloadError}</p>}

      {busy && (
        <>
          <Bar testid="captions-progress" fraction={speech.transcribeFraction} label="Listening to the speech" />
          <p style={{ font: type.meta, color: ink.muted, margin: '6px 0 0' }}>
            It carries on if you close this, and the captions appear when it is done.
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: space.sm }}>
            <Button testid="captions-background" size="small" variant="primary" onClick={props.onClose}>
              Run in background
            </Button>
            <Button testid="captions-cancel" size="small" onClick={speech.cancelTranscribe}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {error && !busy && (
        <div data-testid="captions-error">
          <p style={failure}>{error.text}</p>
          {error.details && (
            <Button size="small" variant="ghost" onClick={() => setShowDetails((s) => !s)} style={{ marginTop: 6 }}>
              {showDetails ? 'Hide details' : 'Details'}
            </Button>
          )}
          {showDetails && error.details && (
            <pre
              style={{
                font: type.monoSmall,
                color: ink.secondary,
                maxHeight: 160,
                overflow: 'auto',
                background: surface.canvas,
                padding: space.sm,
                borderRadius: radius.control,
                whiteSpace: 'pre-wrap'
              }}
            >
              {error.details}
            </pre>
          )}
        </div>
      )}
    </Modal>
  )
}
