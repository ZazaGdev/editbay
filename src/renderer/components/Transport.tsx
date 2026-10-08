import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { formatTimecode, parseTimecode } from '../../shared/time'
import { withKey, type Keymap } from '../../shared/keymap'
import { SAFE_ZONE_CHOICES, type SafeZoneChoice } from '../../shared/safe-zones'
import type { MonitorView } from './Monitor'
import { DropMenu } from './DropMenu'
import { MenuHeading, MenuSeparator } from './ContextMenu'
import { formatElapsed } from '../../shared/voiceover'
import { microphones, type Microphone } from '../voiceover/recorder'
import { surface, ink, accent, meaning, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { IconButton } from '../ui/IconButton'
import { LevelMeter } from '../ui/LevelMeter'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { guidesTurned } from '../state/useSettings'

/** What the Guides menu sets. */
export interface GuideSettings {
  guides: boolean
  thirds: boolean
  safeZone: SafeZoneChoice
  /** The 3:4 box Instagram's profile grid shows of a cover. */
  coverGuide: boolean
}

const menuRow = { gap: space.sm, padding: `5px ${space.sm}px`, font: type.body } as const

/** A voice over under way: the microphone opening, recording, or being saved and put in place. */
export type VoiceOverState =
  | { phase: 'starting' }
  | { phase: 'recording'; elapsed: number; level: number }
  | { phase: 'saving' }

/** How a voice over is recorded, which the Record menu sets. */
export interface RecordSettings {
  /** The microphone, or null for the system's default. */
  microphoneId: string | null
  muteWhileRecording: boolean
}

export function Transport(props: {
  playing: boolean
  playhead: number
  total: number
  fps: number
  view: MonitorView
  canPlay: boolean
  keymap: Keymap
  onPlayPause: () => void
  onStep: (frames: number) => void
  onHome: () => void
  onEnd: () => void
  /** Go to a frame typed into the timecode. */
  onSeek: (frame: number) => void
  onView: (view: MonitorView) => void
  guides: GuideSettings
  onGuides: (change: Partial<GuideSettings>) => void
  /** Whether pictures moved on the Output view snap, and turning that off and on. */
  placeSnap?: boolean | undefined
  onPlaceSnap?: ((on: boolean) => void) | undefined
  onFullscreen: () => void
  /** A voice over under way, or null. Moving the playhead is held throughout, as its keys are. */
  recording: VoiceOverState | null
  /** Start recording a voice over, or stop and keep it. */
  onRecord: () => void
  record: RecordSettings
  onRecordSettings: (change: Partial<RecordSettings>) => void
  /** The Source and Output views side by side, for a frame taller than wide. */
  sideBySide: boolean
  /** False for a frame that is not taller than wide, which shows one view at a time. */
  canSideBySide: boolean
  /**
   * Whether the sequence's frame is taller than it is wide. The areas the apps
   * cover are only drawn on one that is, so on any other the menu says so
   * rather than offering a choice that cannot take effect.
   */
  verticalFrame: boolean
  onSideBySide: (on: boolean) => void
  /** How fast Space and the play button play, and the speeds there are. */
  speed: number
  speeds: number[]
  onSpeed: (speed: number) => void
  /** The speed playing goes at just now, from J or L, below 0 backwards; null while stopped. */
  rate: number | null
  /** Playing repeats the selected clip, or the whole sequence. */
  loop: boolean
  onLoop: () => void
  /**
   * How loud the preview is played, 0 to 1. Listening, not editing: nothing
   * exported moves with it, and no clip's own volume changes.
   */
  monitorVolume: number
  onMonitorVolume: (volume: number) => void
  /**
   * How loud the sequence is at the playhead, 0 to 1, or null when nothing is
   * heard there. Worked out from the waveforms, not measured from the
   * speakers: see `levelAt`.
   */
  level: number | null
}): JSX.Element {
  const k = props.keymap
  const [guidesMenu, setGuidesMenu] = useState(false)
  const closeGuidesMenu = useCallback(() => setGuidesMenu(false), [])
  const [recordMenu, setRecordMenu] = useState(false)
  const closeRecordMenu = useCallback(() => setRecordMenu(false), [])
  const [volumeMenu, setVolumeMenu] = useState(false)
  const closeVolumeMenu = useCallback(() => setVolumeMenu(false), [])
  /** The microphones there are, looked up each time the Record menu opens. */
  const [mics, setMics] = useState<Microphone[]>([])
  useEffect(() => {
    if (recordMenu) void microphones().then(setMics)
  }, [recordMenu])
  const voiceOver = props.recording
  const recording = voiceOver?.phase === 'recording' ? voiceOver : null
  /** The playhead stays where it is from R until the take is in place. */
  const held = voiceOver !== null
  /** What is being typed into the timecode, while it is being typed. */
  const [typing, setTyping] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const timecode = useRef<HTMLButtonElement>(null)
  /** Whether focus goes back to the timecode once the box that replaced it has gone. */
  const [refocus, setRefocus] = useState(false)

  useEffect(() => {
    if (typing !== null || !refocus) return
    setRefocus(false)
    timecode.current?.focus()
  }, [typing, refocus])

  const go = (): void => {
    const frame = typing === null ? null : parseTimecode(typing, props.fps)
    if (frame === null) {
      setRefused(true)
      return
    }
    setTyping(null)
    setRefused(false)
    setRefocus(true)
    props.onSeek(frame)
  }

  /** The playhead is held while a voice over runs, so every move of it is off. */
  const whileRecording = 'The playhead stays put while a voice over is recording'

  const group = { display: 'flex', alignItems: 'center', gap: 6 } as const
  const monitorPercent = Math.round(Math.min(1, Math.max(0, props.monitorVolume)) * 100)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space.md, width: '100%', flexWrap: 'wrap' }}>
      {/* What you are looking at. */}
      <span style={{ ...group, flex: '1 1 auto' }}>
        <Segmented
          testid="view"
          label="What the monitor shows"
          chosen={props.view}
          onChoose={props.onView}
          choices={[
            {
              id: 'source' as MonitorView,
              label: 'Source',
              title: withKey('Show the whole source, to crop it', k, 'toggleView')
            },
            {
              id: 'program' as MonitorView,
              label: 'Output',
              title: withKey('Show the finished frame', k, 'toggleView')
            }
          ]}
        />
        <Button
          testid="side-by-side"
          size="small"
          pressed={props.sideBySide && props.canSideBySide}
          disabled={!props.canSideBySide}
          whyDisabled="Side by side is for a frame taller than wide"
          onClick={() => props.onSideBySide(!props.sideBySide)}
          title={props.sideBySide ? 'Show one view at a time' : 'Show the Source and the Output side by side'}
        >
          Both
        </Button>
      </span>

      {/* The transport, in the middle, where the hand goes for it. */}
      <span style={{ ...group, flexShrink: 0 }}>
      <IconButton
        icon="toStart"
        label={withKey('Go to start', k, 'goToStart')}
        testid="home"
        disabled={held}
        whyDisabled={whileRecording}
        onClick={props.onHome}
      />
      <IconButton
        icon="frameBack"
        label={withKey('Back one frame', k, 'stepBack')}
        testid="step-back"
        disabled={held}
        whyDisabled={whileRecording}
        onClick={() => props.onStep(-1)}
      />
      <IconButton
        icon={props.playing ? 'pause' : 'play'}
        label={withKey(props.playing ? 'Pause' : 'Play', k, 'playPause')}
        testid="play-pause"
        data={{ 'data-playing': props.playing ? 'yes' : 'no' }}
        variant={props.playing ? 'normal' : 'primary'}
        disabled={!props.canPlay}
        whyDisabled="There is nothing on the timeline to play"
        onClick={props.onPlayPause}
        style={{ width: 42 }}
      />
      <IconButton
        icon="frameOn"
        label={withKey('Forward one frame', k, 'stepForward')}
        testid="step-forward"
        disabled={held}
        whyDisabled={whileRecording}
        onClick={() => props.onStep(1)}
      />
      <IconButton
        icon="toEnd"
        label={withKey('Go to end', k, 'goToEnd')}
        testid="end"
        disabled={held}
        whyDisabled={whileRecording}
        onClick={props.onEnd}
      />
      {/*
        Record and its settings are one split control, sharing a border, not
        two buttons that happen to sit near each other. The chevron belongs to
        the button on its left and nothing said so.

        Joined only while the chevron is there. Once a take is under way the
        settings go, and a button with one square side and nothing beside it
        looks broken.
      */}
      <span style={{ display: 'inline-flex' }}>
        <IconButton
          icon={recording ? 'stopRecording' : 'record'}
          label={withKey(recording ? 'Stop and keep the voice over' : 'Record a voice over from the playhead', k, 'recordVoice')}
          testid="record"
          data={{ 'data-recording': recording ? 'yes' : (voiceOver?.phase ?? 'no') }}
          disabled={voiceOver?.phase === 'saving'}
          whyDisabled="The voice over is being saved"
          onClick={props.onRecord}
          {...(voiceOver === null ? { joined: 'start' as const } : {})}
          style={{ color: meaning.stop }}
        />
        {voiceOver === null && (
          <DropMenu
            open={recordMenu}
            onClose={closeRecordMenu}
            up
            testid="record-menu"
            anchor={
              <IconButton
                icon="down"
                label="Voice over settings"
                testid="record-menu-toggle"
                joined="end"
                pressed={recordMenu}
                onClick={() => setRecordMenu((o) => !o)}
                style={{ width: 22 }}
              />
            }
          >
            <MenuHeading>Record from</MenuHeading>
            <Check
              radio
              name="record-mic"
              testid="record-mic"
              data={{ 'data-device-id': '' }}
              checked={props.record.microphoneId === null}
              onChange={() => props.onRecordSettings({ microphoneId: null })}
              style={menuRow}
            >
              The system&apos;s default microphone
            </Check>
            {mics.map((m) => (
              <Check
                key={m.id}
                radio
                name="record-mic"
                testid="record-mic"
                data={{ 'data-device-id': m.id }}
                checked={props.record.microphoneId === m.id}
                onChange={() => props.onRecordSettings({ microphoneId: m.id })}
                style={menuRow}
              >
                {m.label}
              </Check>
            ))}
            <MenuSeparator />
            <Check
              testid="record-mute"
              checked={props.record.muteWhileRecording}
              onChange={(muteWhileRecording) => props.onRecordSettings({ muteWhileRecording })}
              style={menuRow}
            >
              <span title="For recording without headphones, so the speakers are not recorded too">
                Mute the sequence while recording
              </span>
            </Check>
          </DropMenu>
        )}
      </span>
      {voiceOver && voiceOver.phase !== 'recording' ? (
        <span data-testid="record-status" style={{ font: type.meta, color: meaning.stop }}>
          {voiceOver.phase === 'starting' ? 'Opening the microphone...' : 'Saving the voice over...'}
        </span>
      ) : recording ? (
        <span
          style={{
            display: 'inline-flex',
            gap: 6,
            alignItems: 'center',
            font: type.mono,
            fontVariantNumeric: 'tabular-nums',
            color: meaning.stop
          }}
        >
          <span data-testid="record-time">{formatElapsed(recording.elapsed)}</span>
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 6,
              borderRadius: radius.round,
              background: surface.sunken,
              overflow: 'hidden',
              display: 'inline-block'
            }}
          >
            <span
              data-testid="record-level"
              data-level={recording.level.toFixed(2)}
              style={{
                display: 'block',
                height: '100%',
                width: `${Math.round(Math.min(1, recording.level * 1.5) * 100)}%`,
                // Green until it is nearly clipping, when it says so in the stop colour.
                background: recording.level > 0.9 ? meaning.stop : meaning.done
              }}
            />
          </span>
          <span style={{ font: type.meta, color: ink.secondary }}>Esc throws it away</span>
        </span>
      ) : null}

      <span title="How fast Space and the play button play" style={{ display: 'inline-flex' }}>
        <Select
          testid="speed"
          label="How fast Space and the play button play"
          value={String(props.speed)}
          disabled={held}
          whyDisabled={whileRecording}
          blurOnChange
          onChange={(v) => props.onSpeed(Number(v))}
          choices={props.speeds.map((sp) => ({ value: String(sp), label: `${sp}x` }))}
        />
      </span>
      <IconButton
        icon="loop"
        label={withKey('Loop: play the selected clip, or the whole sequence, over and over', k, 'toggleLoop')}
        testid="loop"
        disabled={held}
        whyDisabled={whileRecording}
        pressed={props.loop}
        onClick={props.onLoop}
      />
      {props.rate !== null && props.rate !== 1 && (
        <span
          data-testid="shuttle-rate"
          data-rate={props.rate}
          style={{ font: type.mono, fontWeight: 600, color: meaning.attention }}
        >
          {props.rate}x
        </span>
      )}

      {typing === null ? (
        <button
          ref={timecode}
          type="button"
          data-testid="monitor-timecode"
          disabled={held}
          onClick={() => {
            setTyping(formatTimecode(props.playhead, props.fps))
            setRefused(false)
          }}
          title="Click to type where to go: 1:23, 1:23:10 (frames after the seconds), 83s, or 120f"
          className="ui-btn ui-btn--ghost"
          style={{
            font: type.mono,
            fontVariantNumeric: 'tabular-nums',
            color: ink.primary,
            marginLeft: space.xs,
            height: 28,
            padding: `0 ${space.sm}px`,
            cursor: 'text'
          }}
        >
          {formatTimecode(props.playhead, props.fps)} / {formatTimecode(props.total, props.fps)}
        </button>
      ) : (
        <input
          data-testid="timecode-input"
          autoFocus
          value={typing}
          aria-invalid={refused}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setTyping(e.target.value)
            setRefused(false)
          }}
          onKeyDown={(e) => {
            // Handled here: left to go on, the same Enter would press the timecode
            // button that focus returns to, and open this box again.
            if (e.key === 'Enter') {
              e.preventDefault()
              go()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setTyping(null)
              setRefocus(true)
            }
          }}
          onBlur={() => setTyping(null)}
          title={refused ? 'Not a time. Try 1:23, 1:23:10, 83s or 120f.' : 'Enter to go there, Escape to leave it'}
          className="ui-field__input"
          style={{
            font: type.mono,
            fontVariantNumeric: 'tabular-nums',
            marginLeft: space.xs,
            width: 130,
            height: 28,
            padding: `0 ${space.sm}px`,
            background: surface.canvas,
            border: `1px solid ${refused ? meaning.stop : accent.base}`,
            borderRadius: radius.control
          }}
        />
      )}

      </span>

      {/* What is drawn over the picture. */}
      <span style={{ ...group, flex: '1 1 auto', justifyContent: 'flex-end' }}>
        <LevelMeter testid="level-meter" level={props.level} />
        <DropMenu
          open={volumeMenu}
          onClose={closeVolumeMenu}
          up
          align="right"
          testid="monitor-volume-menu"
          anchor={
            <Button
              testid="monitor-volume"
              icon={monitorPercent === 0 ? 'muted' : 'volume'}
              data={{ 'data-volume': String(monitorPercent) }}
              pressed={monitorPercent !== 100}
              onClick={() => setVolumeMenu((o) => !o)}
              title="How loud the preview plays. It changes nothing that is exported."
            >
              {/* Only when it is not all the way up: a control that looks the
                  same turned down is one you leave down and never find. */}
              {monitorPercent === 100 ? 'Volume' : `${monitorPercent}%`}
            </Button>
          }
        >
          <MenuHeading>How loud the preview plays</MenuHeading>
          <div style={{ ...menuRow, display: 'flex', alignItems: 'center' }}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={monitorPercent}
              data-testid="monitor-volume-level"
              data-value={monitorPercent}
              aria-label="Preview volume"
              onChange={(e) => props.onMonitorVolume(Number(e.target.value) / 100)}
              className="ui-range"
              style={{ width: 120 }}
            />
            <span style={{ font: type.mono, fontVariantNumeric: 'tabular-nums', color: ink.secondary, minWidth: 38, textAlign: 'right' }}>
              {monitorPercent}%
            </span>
          </div>
          <MenuSeparator />
          <Check
            testid="monitor-volume-full"
            checked={monitorPercent === 100}
            onChange={() => props.onMonitorVolume(1)}
            style={menuRow}
          >
            All the way up
          </Check>
        </DropMenu>
        {props.onPlaceSnap && (
          <Button
            testid="place-snap"
            icon="snap"
            pressed={props.placeSnap !== false}
            onClick={() => props.onPlaceSnap?.(props.placeSnap === false)}
            title={
              props.placeSnap === false
                ? 'Pictures moved on the Output view go exactly where they are put. Press to have them snap; Alt snaps one drag'
                : 'Pictures moved on the Output view snap to the edges, the middles and each other. Press to turn it off; Alt frees one drag'
            }
          >
            Snap
          </Button>
        )}
        <DropMenu
          open={guidesMenu}
          onClose={closeGuidesMenu}
          up
          align="right"
          testid="guides-menu"
          anchor={
            <Button
              testid="guides-toggle"
              icon="guides"
              pressed={props.guides.guides}
              onClick={() => setGuidesMenu((o) => !o)}
              title={withKey('Lines to compose by, and where the apps cover the picture', k, 'toggleGuides')}
            >
              Guides
            </Button>
          }
        >
          <Check
            testid="guides-show"
            checked={props.guides.guides}
            onChange={(guides) => props.onGuides(guidesTurned(props.guides, guides))}
            style={menuRow}
          >
            Show guides
          </Check>
          <MenuSeparator />
          {/*
            Two unrelated ideas live under this one button, and each says what
            it is rather than both going by the word "guides": lines for
            composing a shot, and the parts of the picture an app hides behind
            its own buttons.

            While the guides are off, nothing below shows as on, and a click on
            one turns the guides on with just that.
          */}
          <MenuHeading>Lines to compose by</MenuHeading>
          <Check
            testid="guides-thirds"
            checked={props.guides.guides && props.guides.thirds}
            onChange={(thirds) =>
              props.onGuides(props.guides.guides ? { thirds } : { thirds: true, safeZone: 'none', guides: true })
            }
            style={menuRow}
          >
            Centre and thirds
          </Check>
          <Check
            testid="guides-cover"
            checked={props.guides.guides && props.guides.coverGuide}
            onChange={(coverGuide) =>
              props.onGuides(props.guides.guides ? { coverGuide } : { coverGuide: true, thirds: false, safeZone: 'none', guides: true })
            }
            style={menuRow}
          >
            Instagram grid, 3:4
          </Check>
          {/*
            Named for what it is rather than filed under "guides", which was
            one word over two unrelated ideas: lines to compose a shot by, and
            the parts of the picture an app hides behind its own buttons.
          */}
          <MenuHeading>Where the apps put their buttons</MenuHeading>
          {!props.verticalFrame && (
            <div
              data-testid="guides-not-vertical"
              style={{ ...menuRow, font: type.meta, color: meaning.attention, whiteSpace: 'normal', maxWidth: 220 }}
            >
              These are for a frame taller than it is wide. This sequence is not one, so there is nothing to draw.
            </div>
          )}
          {SAFE_ZONE_CHOICES.map((c) => (
            <Check
              key={c.id}
              radio
              name="safe-zone"
              testid="guides-safe"
              data={{ 'data-choice': c.id }}
              checked={props.guides.guides && props.guides.safeZone === c.id}
              disabled={!props.verticalFrame}
              whyDisabled="The apps lay a landscape or square video out differently, so these numbers do not apply to this sequence"
              onChange={() =>
                props.onGuides(props.guides.guides ? { safeZone: c.id } : { safeZone: c.id, thirds: false, guides: true })
              }
              style={menuRow}
            >
              {c.id === 'none' ? 'Nothing' : c.name}
            </Check>
          ))}
        </DropMenu>
        <IconButton
          icon="fullScreen"
          label={`${withKey('Full screen', k, 'fullscreen')}. Escape leaves.`}
          testid="fullscreen"
          onClick={props.onFullscreen}
        />
      </span>
    </div>
  )
}
