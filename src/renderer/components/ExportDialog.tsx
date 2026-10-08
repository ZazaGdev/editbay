import { useEffect, useRef, useState, type JSX } from 'react'
import { ExportCredits } from './ExportCredits'
import { presetById } from '../../shared/presets'
import type { Timeline } from '../../shared/project'
import type { ExportMode } from '../../shared/workspace'
import type { ExportPreview, ExportRequest } from '../../shared/types'
import type { ExportRun } from '../state/useExportRun'
import type { SpeechRun } from '../state/useSpeech'
import { Modal } from './Modal'
import { surface, ink, meaning, danger, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Meter } from '../ui/Meter'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { SectionLabel } from '../ui/SectionLabel'
import { formatTimecode } from '../../shared/time'
import { HelpTip } from '../ui/HelpTip'

/** What the dialog needs to know about each sequence, for "all of them". */
export interface SequenceSummary {
  id: string
  name: string
  presetId: string
  /** How long it is, in frames at the project rate. */
  frames: number
  /** Whether anything is on it besides V1's clips and their own sound, which one file per clip leaves out. */
  besidesV1: boolean
  /** Whether any clip on V1 has layers, which Handoff leaves out. */
  hasLayers: boolean
  /** Whether it has captions, which Handoff leaves out too. */
  hasCaptions: boolean
}

/** YouTube counts a video as a Short up to this long, and Instagram's Reels stop here too. */
const SHORT_LIMIT_SEC = 180
const TOKENS = ['{project}', '{sequence}', '{index}', '{clip}']
/** How many file names "Will write" lists before saying how many more. */
const LISTED = 3

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function folderName(path: string): string {
  return fileName(path.replace(/[\\/]+$/, '')) || path
}

/** How a sequence is exported with the Files setting chosen: Handoff is always one file per clip. */
function modeFor(s: SequenceSummary, mode: ExportMode): ExportMode {
  return presetById(s.presetId).joinable ? mode : 'batch'
}

/**
 * Whether a sequence comes out as one video too long to post as a Short or a
 * Reel. One file per clip is a file for each clip, so its length says nothing.
 */
function tooLongForShorts(s: SequenceSummary, fps: number, mode: ExportMode): boolean {
  const preset = presetById(s.presetId)
  const tall = preset.width !== null && preset.height !== null && preset.height >= preset.width
  return tall && modeFor(s, mode) === 'join' && s.frames / fps > SHORT_LIMIT_SEC
}

const row = { display: 'flex', flexDirection: 'column' as const, gap: space.xs, marginTop: space.md }
const note = { font: type.meta, color: meaning.attention, display: 'block', marginTop: 6 }

/**
 * Where an export is set up, started, watched and collected. Closing it
 * leaves a running export running: the top bar shows how far it has got.
 */
export function ExportDialog(props: {
  /** Opened to export every sequence, as the command for that does. */
  startWithAll?: boolean
  timeline: Timeline
  /** The sequence on screen. */
  sequenceId: string
  sequences: SequenceSummary[]
  fps: number
  /** The folder, files and name pattern are saved with the project, so they live above the dialog. */
  folder: string | null
  mode: ExportMode
  pattern: string
  onFolder: (folder: string) => void
  onMode: (mode: ExportMode) => void
  onPattern: (pattern: string) => void
  /** Also write the captions beside a joined video as a subtitle file. Kept with the other export settings. */
  subtitleFile?: boolean
  onSubtitleFile?: (on: boolean) => void
  /** Also write every word of the captions beside a joined video as a text file. Kept with the other export settings. */
  transcriptFile?: boolean
  onTranscriptFile?: (on: boolean) => void
  /** Sharpen the picture a little in the export. Kept with the other export settings. */
  sharpen?: boolean
  onSharpen?: (on: boolean) => void
  /** Encode on the graphics card, where one can. Kept with the other export settings. */
  fast?: boolean
  onFast?: (on: boolean) => void
  /** The name typed for this sequence's one video, or null for the one it would be given. Kept with the other export settings. */
  fileName?: string | null
  /** The name it would be given, which the box starts with. */
  defaultFileName?: string
  /** A name typed, or null when the box is emptied back to the name it would be given. */
  onFileName?: (name: string | null) => void
  /** What to do when a file is already there: ask, or do this without asking. From Settings. */
  existing?: 'ask' | 'replace' | 'keepBoth'
  run: ExportRun
  /** The range marked with In and Out on this sequence, or null when none is. */
  marked?: { from: number; to: number } | null
  /** The stretch the selected clips cover, first start to last end, or null when none is selected. */
  selectedSpan?: { from: number; to: number } | null
  /** Save only the transcript of this sequence, or of the part given, as a text file. */
  onSaveTranscript?: (range: { from: number; to: number } | null) => void
  /** The transcript alone is being saved, and may be being listened for. */
  transcriptSaving?: boolean
  /** The speech engine, which a transcript of a sequence with no captions listens with. */
  speech?: SpeechRun
  onClose: () => void
}): JSX.Element {
  const { mode, pattern, run } = props
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null)
  const [all, setAll] = useState(props.startWithAll === true)
  /** Which part of this sequence: all of it, the marked range, or what the selected clips cover. */
  const [part, setPart] = useState<'whole' | 'marked' | 'selected'>('whole')
  // A part that has gone, as a range cleared while the dialog is open, is the whole again.
  const span = all ? null : part === 'marked' ? (props.marked ?? null) : part === 'selected' ? (props.selectedSpan ?? null) : null
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  /** The files an export would write over, while it asks what to do about them. */
  const [asking, setAsking] = useState<ExportPreview | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  /** Between pressing Export and the export starting, while it checks what is already there. */
  const [checking, setChecking] = useState(false)
  const patternBox = useRef<HTMLInputElement>(null)
  /** What is in the file name box while it is typed in: emptied, it stays empty until it is left. */
  const [typedName, setTypedName] = useState<string | null>(null)

  const preset = presetById(props.timeline.presetId)
  const folder = props.folder ?? defaultFolder
  const several = props.sequences.length > 1
  const chosen = all ? props.sequences : props.sequences.filter((s) => s.id === props.sequenceId)
  // Each sequence is exported its own way: a Handoff one is always one file per clip.
  const someBatch = chosen.some((s) => modeFor(s, mode) === 'batch')
  // The Files setting means nothing when every sequence chosen is Handoff, which is always one file per clip.
  const onlyHandoff = chosen.length > 0 && chosen.every((s) => !presetById(s.presetId).joinable)
  // A subtitle file goes beside one video with captions in it; one file per clip has none.
  const subtitled = chosen.some((s) => s.hasCaptions && modeFor(s, mode) === 'join')
  // A transcript goes beside any one video: from its captions, or listened to when it has none.
  const joinedAny = chosen.some((s) => modeFor(s, mode) === 'join')
  const wantsTranscript = joinedAny && props.transcriptFile === true
  const listened = wantsTranscript ? chosen.filter((s) => !s.hasCaptions && s.frames > 0 && modeFor(s, mode) === 'join') : []
  // The speech model is downloaded once; until it is, a transcript that has to listen cannot be made.
  const needsModel = listened.length > 0 && props.speech?.ready === false
  const current = props.sequences.find((s) => s.id === props.sequenceId)
  // One video of one sequence is named here. Every sequence at once, or one
  // file per clip, is named by its sequence and the name pattern.
  const naming = !all && !someBatch && props.onFileName !== undefined
  // Letters Windows will not have in a file name, which are written as _.
  const badLetters = [...new Set((props.fileName ?? '').match(/[\\/:*?"<>|]/g) ?? [])]
  const whyNoSubtitles = !chosen.some((s) => s.hasCaptions)
    ? all && several
      ? 'No sequence here has captions'
      : 'This sequence has no captions'
    : 'Only for one video, not one file per clip'

  /** Whether this machine can encode on the graphics card: null until it has been tried. */
  const [gpu, setGpu] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.exportOnGpu().then(setGpu)
  }, [])
  useEffect(() => {
    void window.api.defaultExportFolder().then(setDefaultFolder)
  }, [])
  // Asked afresh: the speech model's folder may have gone since the window last looked.
  const check = props.speech?.check
  useEffect(() => {
    void check?.()
  }, [check])

  const request = (existing?: 'replace' | 'keepBoth'): ExportRequest | null =>
    folder
      ? {
          sequenceId: props.sequenceId,
          ...(all ? { allSequences: true } : {}),
          ...(span ? { range: span } : {}),
          // The setting as chosen: each sequence applies it, or one file per clip for Handoff.
          mode,
          outputDir: folder,
          filenamePattern: pattern,
          ...(existing ? { existing } : {}),
          ...(subtitled && props.subtitleFile === true ? { subtitleFile: true } : {}),
          ...(wantsTranscript ? { transcriptFile: true } : {}),
          ...(props.sharpen === true ? { sharpen: true } : {}),
          ...(props.fast === true && gpu === true ? { fast: true } : {}),
          ...(naming && props.fileName ? { fileName: props.fileName } : {})
        }
      : null

  // What it would write, worked out by main the way the export itself will be,
  // so the names shown are the names written.
  const key = JSON.stringify(request())
  useEffect(() => {
    const r = JSON.parse(key) as ExportRequest | null
    if (!r) return
    let stale = false
    const timer = window.setTimeout(() => {
      void window.api.previewExport(r).then((p) => {
        if (!stale) setPreview(p)
      })
    }, 150)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
    // The timeline is here so an edit elsewhere, or a finished export, brings the names up to date.
  }, [key, props.timeline, run.done])

  // A question asked about one folder and set of names is no answer for another.
  useEffect(() => setAsking(null), [key])

  const start = async (existing: 'replace' | 'keepBoth'): Promise<void> => {
    const r = request(existing)
    if (!r) return
    setAsking(null)
    setShowDetails(false)
    // An export into the folder offered by default remembers it, as one chosen would be.
    if (props.folder === null) props.onFolder(r.outputDir)
    await run.start(r)
  }

  const exportClicked = async (): Promise<void> => {
    const r = request()
    if (!r || checking) return
    setChecking(true)
    try {
      // Checked again now, not trusted from a moment ago: a file may have appeared since.
      const fresh = await window.api.previewExport(r)
      setPreview(fresh)
      if (fresh.error || fresh.outputs.length === 0) return
      // Asked unless Settings says what to do: then it is done, and the list of
      // files still marks the ones that were there.
      const answer = props.existing ?? 'ask'
      if (fresh.existing.length > 0 && answer === 'ask') setAsking(fresh)
      else void start(fresh.existing.length > 0 && answer === 'keepBoth' ? 'keepBoth' : 'replace')
    } finally {
      setChecking(false)
    }
  }

  const insertToken = (token: string): void => {
    const box = patternBox.current
    const at = box?.selectionStart ?? pattern.length
    const to = box?.selectionEnd ?? at
    props.onPattern(pattern.slice(0, at) + token + pattern.slice(to))
    window.requestAnimationFrame(() => {
      box?.focus()
      box?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const progress = run.progress
  const label = (): string => {
    if (!progress) return ''
    const of = progress.sequenceCount ? `${progress.sequenceName} (${progress.sequenceIndex} of ${progress.sequenceCount}): ` : ''
    if (progress.message) return progress.message
    if (progress.stage === 'join') return `${of}joining the clips`
    if (progress.clipIndex && progress.clipCount) {
      return `${of}clip ${progress.clipIndex} of ${progress.clipCount}, ${progress.clipLabel ?? ''}`
    }
    return `${of}starting`
  }

  const outputs = preview?.outputs ?? []
  const existingSet = new Set((preview?.existing ?? []).map((p) => p.toLowerCase()))
  // Only the part exported counts towards a Short's length.
  const long = chosen
    .map((s) => (span && s.id === props.sequenceId ? { ...s, frames: span.to - span.from } : s))
    .filter((s) => tooLongForShorts(s, props.fps, mode))

  return (
    <Modal title="Export" testid="export-panel" onClose={props.onClose} sticky={asking !== null} width={520}>
      {several && (
        <div style={{ ...row, marginTop: 0 }}>
          <SectionLabel>What</SectionLabel>
          <Check
            radio
            name="export-what"
            testid="export-this"
            checked={!all}
            onChange={() => setAll(false)}
            disabled={run.running}
            whyDisabled="An export is running"
          >
            This sequence: {props.sequences.find((s) => s.id === props.sequenceId)?.name}
          </Check>
          <Check
            radio
            name="export-what"
            testid="export-all"
            checked={all}
            onChange={() => setAll(true)}
            disabled={run.running}
            whyDisabled="An export is running"
          >
            All {props.sequences.length} sequences, one after another, each in its own shape
          </Check>
        </div>
      )}
      {!all && (
        <div style={{ ...row, marginTop: several ? space.md : 0 }}>
          <SectionLabel>Part</SectionLabel>
          <Check radio name="export-part" testid="export-part-whole" checked={span === null} onChange={() => setPart('whole')} disabled={run.running} whyDisabled="An export is running">
            The whole sequence
          </Check>
          <Check
            radio
            name="export-part"
            testid="export-part-marked"
            checked={part === 'marked' && span !== null}
            onChange={() => setPart('marked')}
            disabled={run.running || !props.marked}
            whyDisabled={run.running ? 'An export is running' : 'Mark In and Out on the timeline first'}
          >
            The marked range{props.marked ? `, ${formatTimecode(props.marked.to - props.marked.from, props.fps)}` : ''}
          </Check>
          <Check
            radio
            name="export-part"
            testid="export-part-selected"
            checked={part === 'selected' && span !== null}
            onChange={() => setPart('selected')}
            disabled={run.running || !props.selectedSpan}
            whyDisabled={run.running ? 'An export is running' : 'Select clips on the timeline first'}
          >
            What the selected clips cover{props.selectedSpan ? `, ${formatTimecode(props.selectedSpan.to - props.selectedSpan.from, props.fps)}` : ''}
          </Check>
        </div>
      )}
      {!several && (
        <p style={{ font: type.body, color: ink.secondary, margin: 0, marginTop: space.md }}>
          {preset.label}. {preset.hint.replace(/\.$/, '')}.
        </p>
      )}

      {chosen
        .filter((s) => s.hasLayers && presetById(s.presetId).width === null)
        .map((s) => (
          <span key={s.id} data-testid="export-layers-note" style={note}>
            {several ? `${s.name}: l` : 'L'}ayers are left out under Handoff: each clip exports its main picture.
          </span>
        ))}
      {chosen
        .filter((s) => s.hasCaptions && presetById(s.presetId).width === null)
        .map((s) => (
          <span key={`${s.id}-captions`} data-testid="export-captions-note" style={note}>
            {several ? `${s.name}: c` : 'C'}aptions are left out under Handoff, which has no frame to put them in.
          </span>
        ))}

      <div style={row}>
        <Select
          testid="export-mode"
          label="Files"
          showLabel
          value={onlyHandoff ? 'batch' : mode}
          disabled={onlyHandoff || run.running}
          whyDisabled={onlyHandoff ? 'Handoff is always one file per clip' : 'An export is running'}
          onChange={(v) => props.onMode(v === 'batch' ? 'batch' : 'join')}
          choices={[
            { value: 'join', label: 'One video' },
            { value: 'batch', label: 'One file per clip' }
          ]}
        />
      </div>
      {props.onSubtitleFile && (
        <div style={{ marginTop: space.sm }}>
          {/* The captions stay burned into the video as well: this is for players that show their own. */}
          <Check
            testid="export-subtitle-file"
            checked={subtitled && props.subtitleFile === true}
            disabled={!subtitled || run.running}
            whyDisabled={run.running ? 'An export is running' : whyNoSubtitles}
            onChange={(on) => props.onSubtitleFile?.(on)}
          >
            Also save the captions as a subtitle file (.srt), for YouTube
          </Check>
        </div>
      )}
      {props.onTranscriptFile && (
        <div style={{ marginTop: space.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Every word said as text to read, for a description, show notes or a post. */}
          <Check
            testid="export-transcript-file"
            checked={wantsTranscript}
            disabled={!joinedAny || run.running}
            whyDisabled={run.running ? 'An export is running' : 'Only for one video, not one file per clip'}
            onChange={(on) => props.onTranscriptFile?.(on)}
          >
            Also save the full transcript as a text file (.txt)
          </Check>
          {listened.length > 0 && (
            <span data-testid="export-transcript-listens" style={note}>
              {several && all ? `${listened.map((s) => s.name).join(', ')} ${listened.length > 1 ? 'have' : 'has'}` : 'This has'} no
              captions, so the export listens to the speech for the transcript first.
            </span>
          )}
          {needsModel && props.speech && (
            <span style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <span style={note}>It listens with the speech model, which is downloaded once.</span>
              <Button
                testid="export-speech-download"
                size="small"
                icon="download"
                onClick={() => void props.speech?.download()}
                disabled={props.speech.downloading}
                whyDisabled="It is downloading"
              >
                {props.speech.downloading ? `Downloading ${Math.round(props.speech.downloadFraction * 100)}%` : 'Download the speech model'}
              </Button>
              {props.speech.downloadError && <span style={{ ...note, color: danger.ink }}>{props.speech.downloadError}</span>}
            </span>
          )}
        </div>
      )}
      {props.onFast && (
        <div style={{ marginTop: space.sm, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <Segmented
            testid="export-speed"
            label="How the video is encoded"
            size="small"
            chosen={props.fast === true && gpu === true ? 'fast' : 'best'}
            onChoose={(id) => props.onFast?.(id === 'fast')}
            choices={[
              {
                id: 'best',
                label: 'Best quality',
                title: 'Encoded on the processor: the smallest file for its quality, and the slowest',
                whyDisabled: run.running ? 'An export is running' : undefined
              },
              {
                id: 'fast',
                label: 'Fast',
                title: 'Encoded on the graphics card: several times faster, a slightly larger file',
                whyDisabled: run.running
                  ? 'An export is running'
                  : gpu === null
                    ? 'Checking the graphics card'
                    : gpu
                      ? undefined
                      : 'Needs an NVIDIA graphics card, and none that works was found'
              }
            ]}
          />
        </div>
      )}
      {props.onSharpen && (
        <div style={{ marginTop: space.sm }}>
          <Check
            testid="export-sharpen"
            checked={props.sharpen === true}
            disabled={run.running}
            whyDisabled="An export is running"
            onChange={(on) => props.onSharpen?.(on)}
          >
            Sharpen the picture a little, for soft webcam footage
          </Check>
          <HelpTip testid="export-sharpen-help" text="In the exported video only: the preview shows the picture as recorded." tutorial="750-fast-or-best-quality" />
        </div>
      )}
      {chosen
        .filter((s) => s.besidesV1 && modeFor(s, mode) === 'batch')
        .map((s) => (
          <span key={s.id} data-testid="export-rows-note" style={note}>
            {several ? `${s.name}: e` : 'E'}ach file is one clip on V1 with its own sound, so the other tracks are left out.
          </span>
        ))}

      <div style={row}>
        <SectionLabel>Folder</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            testid="export-folder"
            icon="open"
            onClick={() => void window.api.pickExportFolder(folder ?? undefined).then((f) => f && props.onFolder(f))}
            disabled={run.running}
            whyDisabled="An export is running"
            title={folder ?? 'Choose a folder'}
            style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', overflow: 'hidden' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder ?? 'Choose a folder...'}</span>
          </Button>
          <Button
            onClick={() => folder && void window.api.revealPath(folder)}
            disabled={!folder}
            whyDisabled="Choose a folder first"
          >
            Open
          </Button>
        </div>
      </div>

      {naming && (
        <div style={row}>
          <SectionLabel>File name</SectionLabel>
          <span style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
            <span className="ui-field" style={{ flex: 1 }}>
              <span className="ui-field__box" style={{ height: 28 }}>
                <input
                  data-testid="export-file-name"
                  value={typedName ?? props.fileName ?? props.defaultFileName ?? ''}
                  disabled={run.running}
                  aria-label="File name"
                  onChange={(e) => {
                    setTypedName(e.target.value)
                    props.onFileName?.(e.target.value.trim() === '' ? null : e.target.value)
                  }}
                  onBlur={() => setTypedName(null)}
                  className="ui-field__input"
                />
              </span>
            </span>
            <span style={{ font: type.meta }}>.mp4</span>
          </span>
          {badLetters.length > 0 && (
            <span data-testid="export-file-name-note" style={note}>
              A file name cannot have {badLetters.join(' ')} in it, so {badLetters.length > 1 ? 'they are' : 'it is'} written as _.
            </span>
          )}
        </div>
      )}

      {someBatch && (
        <div style={row}>
          <SectionLabel>Name for each file</SectionLabel>
          <span className="ui-field" style={{ width: '100%' }}>
            <span className="ui-field__box" style={{ height: 28 }}>
              <input
                ref={patternBox}
                data-testid="export-pattern"
                value={pattern}
                disabled={run.running}
                onChange={(e) => props.onPattern(e.target.value)}
                className="ui-field__input"
                style={{ font: type.mono }}
              />
            </span>
          </span>
          <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap' }}>
            {TOKENS.map((t) => (
              <Button
                key={t}
                testid="export-token"
                data={{ 'data-token': t }}
                size="small"
                onClick={() => insertToken(t)}
                disabled={run.running}
                whyDisabled="An export is running"
                title={`Put ${t} in the name where the cursor is`}
                style={{ font: type.monoSmall }}
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
      )}

      {!run.running && outputs.length > 0 && (
        <div
          data-testid="export-will-write"
          data-count={outputs.length}
          style={{ ...row, font: type.mono, color: ink.secondary }}
        >
          <SectionLabel>Will write</SectionLabel>
          {outputs.slice(0, LISTED).map((o) => (
            <span key={o} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName(o)}
              {existingSet.has(o.toLowerCase()) && (
                <span style={{ color: meaning.attention }}> (already there)</span>
              )}
            </span>
          ))}
          {outputs.length > LISTED && (
            <span style={{ font: type.meta, color: ink.muted }}>and {outputs.length - LISTED} more</span>
          )}
        </div>
      )}
      {preview?.empty.map((name) => (
        <span key={name} style={note}>
          {name} has nothing to export this way and is left out.
        </span>
      ))}
      {long.map((s) => (
        <span key={s.id} data-testid="export-too-long" style={note}>
          {several ? `${s.name} is` : 'This is'} longer than 3 minutes, which is more than a YouTube Short or an
          Instagram Reel can be.
        </span>
      ))}
      {preview?.error && !run.running && <span style={{ ...note, color: danger.ink }}>{preview.error}</span>}

      {asking ? (
        <div
          data-testid="export-exists"
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
          <p style={{ margin: '0 0 10px' }}>
            {asking.existing.length === 1
              ? `${fileName(asking.existing[0]!)} is already in ${folderName(folder ?? '')}.`
              : `${asking.existing.length} of the ${asking.outputs.length} files are already in ${folderName(folder ?? '')}.`}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button testid="export-replace" variant="primary" onClick={() => void start('replace')}>
              Replace
            </Button>
            <Button
              testid="export-keep-both"
              onClick={() => void start('keepBoth')}
              title='Keep what is there, and write the new files beside it as "name (2)"'
            >
              Keep both
            </Button>
            <Button testid="export-ask-cancel" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          testid="export-start"
          variant="primary"
          size="large"
          icon="export"
          onClick={() => void exportClicked()}
          disabled={run.running || checking || !folder || outputs.length === 0 || needsModel || props.transcriptSaving === true}
          whyDisabled={
            run.running || checking || props.transcriptSaving === true
              ? 'An export is already running'
              : !folder
                ? 'Choose a folder first'
                : needsModel
                  ? 'Download the speech model first, or untick the transcript'
                  : 'There is nothing to export yet'
          }
          style={{ marginTop: space.lg, width: '100%' }}
        >
          {run.running ? 'Exporting...' : chosen.length > 1 ? `Export ${chosen.length} sequences` : 'Export'}
        </Button>
      )}
      {props.onSaveTranscript && !asking && (
        <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
          <Button
            testid="export-save-transcript"
            icon="text"
            onClick={() => props.onSaveTranscript?.(span)}
            disabled={run.running || props.transcriptSaving === true || (all && several)}
            whyDisabled={
              run.running || props.transcriptSaving === true
                ? 'An export is running'
                : 'One sequence at a time: choose This sequence'
            }
            title="Every word said in the part chosen, as a text file in the export folder, with no video: from the captions, or listened to when there are none"
            style={{ flex: 1 }}
          >
            {props.transcriptSaving === true
              ? current && !current.hasCaptions
                ? `Listening for the transcript... ${Math.round((props.speech?.transcribeFraction ?? 0) * 100)}%`
                : 'Saving the transcript...'
              : 'Save only the transcript (.txt)'}
          </Button>
          {props.transcriptSaving === true && current && !current.hasCaptions && (
            <Button testid="export-transcript-stop" onClick={() => void window.api.cancelExport()}>
              Stop
            </Button>
          )}
        </div>
      )}

      {run.running && (
        <div style={{ marginTop: space.md }}>
          <Meter testid="export-progress" fraction={progress?.fraction ?? 0} label="Exporting" />
          <div style={{ display: 'flex', gap: space.sm, marginTop: 6, font: type.meta, color: ink.secondary }}>
            <span data-testid="export-percent">{Math.round((progress?.fraction ?? 0) * 100)}%</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label()}</span>
            {run.remaining && <span data-testid="export-remaining">{run.remaining}</span>}
          </div>
          <Button testid="export-cancel" size="small" onClick={run.cancel} style={{ marginTop: space.sm }}>
            Cancel
          </Button>
        </div>
      )}

      {run.done && (
        <div data-testid="export-done" data-count={run.done.length} style={{ marginTop: 14 }}>
          <p style={{ font: type.body, margin: '0 0 6px', color: meaning.done }}>
            {run.done.length === 1 ? 'Exported 1 file.' : `Exported ${run.done.length} files.`}
          </p>
          {/*
            Scrolls only when there are more files than fit: a list of one or
            two that may scroll showed a scrollbar for a fraction of a pixel,
            at some display scales, and it took the buttons' room. Padded by
            the focus ring's width, drawn back out by as much, so a ring always
            fits inside it.
          */}
          <div
            data-testid="export-files"
            style={{
              maxHeight: 180,
              overflowY: run.done.length > 6 ? 'auto' : 'visible',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 4,
              margin: -4
            }}
          >
            {run.done.map((path) => (
              <div key={path} data-testid="export-file" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span
                  title={path}
                  style={{
                    flex: 1,
                    font: type.meta,
                    color: ink.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {fileName(path)}
                </span>
                <Button testid="export-play" size="small" icon="play" onClick={() => void window.api.openPath(path)}>
                  Play
                </Button>
                <Button
                  testid="export-reveal"
                  size="small"
                  icon="open"
                  onClick={() => void window.api.revealPath(path)}
                >
                  Show in folder
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {run.credits && <ExportCredits lines={run.credits} />}

      {run.notes.map((n) => (
        <p key={n} data-testid="export-note" style={{ font: type.body, color: ink.secondary, marginTop: space.sm }}>
          {n}
        </p>
      ))}

      {run.cancelled && (
        <p data-testid="export-cancelled" style={{ font: type.body, color: ink.muted, marginTop: space.md }}>
          Export cancelled.
        </p>
      )}

      {run.error && (
        <div data-testid="export-error" className="ui-selectable" style={{ marginTop: space.md }}>
          <p style={{ font: type.body, color: danger.ink, margin: 0 }}>{run.error}</p>
          {run.details && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Button testid="export-details-toggle" size="small" onClick={() => setShowDetails((s) => !s)}>
                {showDetails ? 'Hide details' : 'Details'}
              </Button>
              {showDetails && (
                <Button
                  testid="export-copy"
                  size="small"
                  icon="copy"
                  onClick={() => void window.api.copyText(run.details ?? '')}
                >
                  Copy
                </Button>
              )}
            </div>
          )}
          {showDetails && run.details && (
            <pre
              data-testid="export-details"
              style={{
                font: type.monoSmall,
                color: ink.secondary,
                maxHeight: 180,
                overflow: 'auto',
                background: surface.canvas,
                padding: space.sm,
                borderRadius: radius.control,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {run.details}
            </pre>
          )}
        </div>
      )}
    </Modal>
  )
}
