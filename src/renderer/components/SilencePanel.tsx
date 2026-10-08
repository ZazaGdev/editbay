import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { PAUSE_JUDGEMENTS, judgementOf, type SilenceSettings } from '../../shared/silences'
import { formatTimecode } from '../../shared/time'
import { surface, ink, accent, meaning, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { IconButton } from '../ui/IconButton'
import { SectionLabel } from '../ui/SectionLabel'
import { Segmented } from '../ui/Segmented'
import { HelpTip } from '../ui/HelpTip'

/**
 * Remove silences: a review of every pause found, above the timeline, while
 * the same pauses are shaded on the tracks below.
 *
 * It used to be a strip of three raw numbers in the middle of a sentence, one
 * action styled exactly like Cancel, and no way to check a single pause before
 * committing to all fourteen. Now it says what the edit will be afterwards,
 * offers three named ways to judge a pause with the numbers behind them, and
 * lists every pause so each can be heard and kept or taken first.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A length in seconds, to one decimal: how long a pause is. */
function seconds(frames: number, fps: number): string {
  return `${(frames / fps).toFixed(1)} s`
}

/**
 * A number box that lets you type freely, and passes a number on once what is
 * typed is one. Put back to the setting it shows when it loses focus.
 */
function NumberField(props: {
  testid: string
  value: number
  step: number
  min: number
  max: number
  width: number
  onChange: (value: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(props.value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(String(props.value))
  }, [props.value, focused])
  return (
    <input
      data-testid={props.testid}
      type="number"
      value={text}
      step={props.step}
      min={props.min}
      max={props.max}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number.parseFloat(e.target.value)
        if (Number.isFinite(n)) props.onChange(n)
      }}
      onKeyDown={(e) => {
        // Enter or Esc is done typing: focus goes back to the window, so Space plays and Esc closes again.
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
      className="ui-field__input"
      style={{ width: props.width }}
    />
  )
}

/** A number box with its unit, drawn as one control. */
function NumberBox(props: { children: JSX.Element; unit: string }): JSX.Element {
  return (
    <span className="ui-field ui-field--number" style={{ display: 'inline-flex' }}>
      <span className="ui-field__box" style={{ height: 24 }}>
        {props.children}
        <span className="ui-field__unit">{props.unit}</span>
      </span>
    </span>
  )
}

/** One pause found: where it is, how long, and what is to be done with it. */
export interface ReviewPause {
  from: number
  to: number
  kept: boolean
  /** It cannot be taken out: taking it would push something out of step. */
  blocked: boolean
}

export function SilencePanel(props: {
  /** Every audio track, as the timeline labels it, with what is on it. */
  tracks: { id: string; label: string; title: string }[]
  listen: ReadonlySet<string>
  onListen: (trackId: string, on: boolean) => void
  settings: SilenceSettings
  onSettings: (change: Partial<SilenceSettings>) => void
  /** Every pause found, in the order they run. */
  pauses: ReviewPause[]
  /** The pauses to take out, and how many frames they come to. */
  cutCount: number
  cutFrames: number
  /** How long the sequence is now, in frames. */
  total: number
  fps: number
  /** A waveform that counts has not loaded yet. */
  waiting: boolean
  /** Keep this pause, or take it after all. */
  onTogglePause: (from: number) => void
  /** Keep every pause, or take every one that can be taken. */
  onKeepAll: () => void
  onTakeAll: () => void
  /** Play the sequence around a pause, so it can be heard before it goes. */
  onHear: (from: number) => void
  onRemove: () => void
  onClose: () => void
}): JSX.Element {
  const s = props.settings
  const chosen = judgementOf(s)
  const [showNumbers, setShowNumbers] = useState(chosen === null)
  /** Which pause the keyboard is on, as a row of the list. */
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const keptCount = props.pauses.filter((p) => p.kept).length
  const blockedCount = props.pauses.filter((p) => p.blocked).length
  const after = Math.max(0, props.total - props.cutFrames)

  // The list is found again whenever a setting changes, so the row the
  // keyboard is on goes back to the first rather than to a pause that is no
  // longer there.
  useEffect(() => setAt(0), [props.pauses.length])
  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const walk = (e: KeyboardEvent<HTMLDivElement>): void => {
    const rows = props.pauses.length
    if (rows === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows) % rows)
      return
    }
    const pause = props.pauses[at]
    if (!pause) return
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (!pause.blocked) props.onTogglePause(pause.from)
      return
    }
    if (e.key === ' ') {
      // Space plays the whole sequence everywhere else; in this list it plays
      // the pause the keyboard is on, which is the point of the list.
      e.preventDefault()
      e.stopPropagation()
      props.onHear(pause.from)
    }
  }

  const summary = props.waiting
    ? 'The waveforms are still loading. Their clips are searched once they are in.'
    : props.listen.size === 0
      ? 'Tick a track to listen to.'
      : props.pauses.length === 0
        ? 'No pauses found. Try a tighter judgement.'
        : `${plural(props.cutCount, 'to take out', 'to take out')}, ${keptCount} kept` +
          (blockedCount > 0 ? `, ${blockedCount} that cannot go` : '')

  const row = { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10 }
  const field = { display: 'inline-flex', alignItems: 'center', gap: 6 }

  return (
    <div
      data-testid="silence-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
        padding: `${space.sm}px 10px`,
        marginBottom: space.sm,
        borderRadius: radius.panel,
        background: surface.raised,
        border: `1px solid ${surface.lineStrong}`,
        font: type.meta,
        color: ink.secondary,
        position: 'relative'
      }}
    >
      {/*
        In the corner, where a hand reaches first, rather than only at the
        bottom beside Cancel. It does what Cancel does and what Escape does:
        closes the review and leaves the timeline exactly as it was.

        Placed rather than laid out, because the row beside it wraps on a
        narrow window and a close control that wraps with it is not in the
        corner any more. The row keeps room for it on its right.
      */}
      <IconButton
        icon="close"
        label="Close without changing anything (Esc)"
        testid="silence-close"
        size="small"
        variant="ghost"
        onClick={props.onClose}
        style={{ position: 'absolute', top: 4, right: 6 }}
      />
      <div style={{ ...row, paddingRight: 26 }}>
        <SectionLabel>Remove silences</SectionLabel>
        <HelpTip
          testid="silence-help"
          text="Each pause found is listed: Up and Down step through them, Space hears one, Enter keeps or takes it."
          tutorial="150-remove-silences"
          style={{ marginLeft: -6 }}
        />
        <span style={field} title="The sound listened to for pauses: the talking head's own sound unless you tick others">
          Listen to
          {props.tracks.map((t) => (
            <Check
              key={t.id}
              testid="silence-track"
              data={{ 'data-track-id': t.id }}
              checked={props.listen.has(t.id)}
              onChange={(on) => props.onListen(t.id, on)}
              style={{ gap: 4 }}
            >
              <span title={t.title}>{t.label}</span>
            </Check>
          ))}
        </span>
        <span style={field}>
          A pause is
          <Segmented
            testid="pause-judgement"
            label="How strictly a pause is judged"
            size="small"
            chosen={chosen ?? ('none' as never)}
            onChoose={(id) => {
              const found = PAUSE_JUDGEMENTS.find((j) => j.id === id)
              if (found) props.onSettings(found.settings)
            }}
            choices={PAUSE_JUDGEMENTS.map((j) => ({ id: j.id, label: j.name, title: j.what }))}
          />
        </span>
        <Button
          testid="pause-numbers"
          size="small"
          variant="ghost"
          pressed={showNumbers}
          icon={showNumbers ? 'up' : 'down'}
          onClick={() => setShowNumbers((o) => !o)}
          title="The three numbers behind the judgement"
        >
          {chosen === null ? 'Your own numbers' : 'The numbers behind this'}
        </Button>
      </div>

      {showNumbers && (
        <div data-testid="pause-numbers-row" style={row}>
          <label style={field} title="Sound quieter than this, at its loudest, counts as silence">
            Quieter than
            <NumberBox unit="dB">
              <NumberField
                testid="silence-level"
                value={s.levelDb}
                step={1}
                min={-80}
                max={-10}
                width={44}
                onChange={(levelDb) => props.onSettings({ levelDb })}
              />
            </NumberBox>
          </label>
          <label style={field} title="How long a silence must last to be a pause">
            Lasting at least
            <NumberBox unit="s">
              <NumberField
                testid="silence-shortest"
                value={s.shortestSec}
                step={0.1}
                min={0.1}
                max={5}
                width={40}
                onChange={(shortestSec) => props.onSettings({ shortestSec })}
              />
            </NumberBox>
          </label>
          <label style={field} title="How much of each pause stays: half after the words before it, half before the words after">
            Breath kept
            <NumberBox unit="s">
              <NumberField
                testid="silence-leave"
                value={s.leaveSec}
                step={0.05}
                min={0}
                max={2}
                width={40}
                onChange={(leaveSec) => props.onSettings({ leaveSec })}
              />
            </NumberBox>
          </label>
        </div>
      )}

      {/* The one thing it never said: what you gain by pressing it. */}
      <div style={{ ...row, alignItems: 'baseline', gap: space.md }}>
        <SectionLabel>What you get back</SectionLabel>
        <span
          data-testid="silence-after"
          data-after={after}
          data-now={props.total}
          data-saved={props.cutFrames}
          style={{ font: type.mono, fontVariantNumeric: 'tabular-nums', fontSize: 20, color: ink.primary }}
        >
          {formatTimecode(after, props.fps)}
        </span>
        <span style={{ color: ink.muted }}>
          from <span style={{ font: type.mono }}>{formatTimecode(props.total, props.fps)}</span>
        </span>
        {props.cutFrames > 0 && (
          <span style={{ font: type.mono, color: meaning.done }}>-{formatTimecode(props.cutFrames, props.fps)}</span>
        )}
      </div>

      <div style={{ ...row, gap: space.sm }}>
        <SectionLabel>{props.pauses.length === 0 ? 'No pauses' : plural(props.pauses.length, 'pause', 'pauses')}</SectionLabel>
        <Button testid="pause-keep-all" size="small" onClick={props.onKeepAll} disabled={props.pauses.length === 0} whyDisabled="No pauses were found">
          Keep all
        </Button>
        <Button testid="pause-take-all" size="small" onClick={props.onTakeAll} disabled={props.pauses.length === 0} whyDisabled="No pauses were found">
          Take all
        </Button>
      </div>

      <div
        ref={list}
        role="listbox"
        tabIndex={0}
        aria-label="The pauses found"
        data-testid="pause-list"
        onKeyDown={walk}
        style={{
          maxHeight: 132,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: 2,
          borderRadius: radius.control,
          background: surface.canvas
        }}
      >
        {props.pauses.map((p, i) => (
          <div
            key={p.from}
            role="option"
            aria-selected={i === at}
            data-testid="pause-row"
            data-row={i}
            data-from={p.from}
            data-kept={p.kept ? 'yes' : 'no'}
            data-blocked={p.blocked ? 'yes' : 'no'}
            onMouseMove={() => i !== at && setAt(i)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              padding: `3px ${space.sm}px`,
              borderRadius: radius.chip,
              background: i === at ? accent.wash : 'transparent',
              boxShadow: i === at ? `inset 0 0 0 1px ${accent.washLine}` : 'none',
              color: p.kept ? ink.muted : ink.primary
            }}
          >
            <span style={{ font: type.mono, fontVariantNumeric: 'tabular-nums' }}>{formatTimecode(p.from, props.fps)}</span>
            <span style={{ color: ink.muted, minWidth: 48 }}>{seconds(p.to - p.from, props.fps)}</span>
            {p.blocked ? (
              <span style={{ color: meaning.attention, flexGrow: 1 }}>
                Kept: taking it would push something on another track out of step.
              </span>
            ) : (
              <span style={{ flexGrow: 1 }} />
            )}
            <Button
              testid="pause-toggle"
              data={{ 'data-from': String(p.from) }}
              size="small"
              variant={p.kept ? 'normal' : 'ghost'}
              disabled={p.blocked}
              whyDisabled="This one cannot be taken out"
              onClick={() => props.onTogglePause(p.from)}
            >
              {p.kept ? 'Take' : 'Keep'}
            </Button>
          </div>
        ))}
      </div>

      <div style={row}>
        <span
          data-testid="silence-summary"
          data-cut={props.cutCount}
          data-kept={keptCount}
          data-blocked={blockedCount}
          data-waiting={props.waiting ? 'yes' : 'no'}
          style={{ color: blockedCount > 0 ? meaning.attention : ink.secondary }}
        >
          {summary}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Button testid="silence-cancel" size="small" onClick={props.onClose} title="Close without changing anything (Esc)">
            Cancel
          </Button>
          <Button
            testid="silence-remove"
            variant="primary"
            size="small"
            disabled={props.cutCount === 0 || props.waiting}
            whyDisabled={
              props.waiting
                ? 'The waveforms are still loading'
                : props.listen.size === 0
                  ? 'Tick a track to listen to first'
                  : 'Nothing is left to take out'
            }
            onClick={props.onRemove}
          >
            {props.cutCount === 0 ? 'Remove' : `Take ${plural(props.cutCount, 'pause', 'pauses')} out`}
          </Button>
        </span>
      </div>
    </div>
  )
}
