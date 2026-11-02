/**
 * The Inspector's Speed section (plan 105): a clip played faster, as a
 * time-lapse, or slower, as slow motion. Picked from a list or typed, with
 * its sound kept outside 0.5x to 2x, and slow motion blended or in plain
 * frames.
 */
import { useState, type JSX } from 'react'
import { linkedIds, allClips, type Clip, type SoundClip, type Timeline } from '../../shared/project'
import { spanLength } from '../../shared/tracks'
import { HEARD_FROM, HEARD_TO, MAX_SPEED, MIN_SPEED, SPEED_PRESETS, cleanSpeed, heardAt, speedLabel } from '../../shared/speed'
import { speedRefusal } from '../../shared/speed-edit'
import { ink } from '../theme'
import { Check } from '../ui/Check'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { Group, dim, row, small, type Edit } from './inspector-parts'

/** A speed as the list and the box write it: `4`, `0.5`, `1.25`. */
function figure(speed: number): string {
  return String(Number(speed.toFixed(2)))
}

export function SpeedSection(props: { timeline: Timeline; clip: Clip | SoundClip; onEdit: Edit }): JSX.Element {
  const { timeline: t, clip } = props
  const speed = clip.speed ?? 1
  const ids = linkedIds(t, clip.id)
  const group = allClips(t).filter((c) => ids.includes(c.id))
  const sounds = t.audioTracks.flatMap((r) => r.clips.filter((c) => ids.includes(c.id)))
  const pictures = t.videoTracks.flatMap((r) => r.clips.filter((c) => ids.includes(c.id)))
  /** What is in the box while it is being typed in, or null when it shows the speed. */
  const [typed, setTyped] = useState<string | null>(null)
  /** Why the last speed asked for could not be set, until another is. */
  const [refused, setRefused] = useState<string | null>(null)

  const ask = (wanted: number): void => {
    const why = speedRefusal(t, clip.id, wanted)
    setRefused(why)
    if (why === null && cleanSpeed(wanted) !== clip.speed) props.onEdit({ kind: 'setSpeed', clipId: clip.id, speed: wanted })
  }
  const commit = (text: string): void => {
    setTyped(null)
    const n = Number.parseFloat(text.replace(',', '.').replace(/x$/i, ''))
    if (Number.isFinite(n) && n > 0) ask(n)
  }

  const listed = (SPEED_PRESETS as readonly number[]).includes(speed)
  const choices = [
    ...SPEED_PRESETS.map((s) => ({ value: figure(s), label: s === 1 ? '1x (normal)' : speedLabel(s) })),
    ...(listed ? [] : [{ value: figure(speed), label: speedLabel(speed) }])
  ]
  const seconds = (spanLength(clip) / t.fps).toFixed(1)
  const kept = sounds.some((s) => s.keepSound === true)
  const plain = pictures.some((c) => c.plainFrames === true)
  return (
    <Group name="Speed" testid="speed-section" badge={speed !== 1 ? <span style={{ ...small, color: ink.secondary }}>{speedLabel(speed)}</span> : undefined}>
      <div style={{ ...row, alignItems: 'center' }}>
        <Select
          label="Speed"
          testid="clip-speed-choice"
          value={figure(speed)}
          choices={choices}
          onChange={(v) => ask(Number(v))}
        />
        <Field
          label={`Any speed from ${MIN_SPEED}x to ${MAX_SPEED}x`}
          hideLabel
          kind="number"
          unit="x"
          step={0.05}
          height={22}
          testid="clip-speed-typed"
          value={typed ?? figure(speed)}
          onChange={setTyped}
          onCommit={commit}
          style={{ width: 70 }}
        />
      </div>
      <div style={row}>
        <span style={dim}>Lasts</span>
        <span data-testid="clip-speed-length" data-frames={spanLength(clip)}>
          {seconds} s{speed > 1 ? ', a time-lapse' : speed < 1 ? ', in slow motion' : ''}
        </span>
      </div>
      {refused !== null && (
        <p data-testid="clip-speed-refused" role="status" style={{ ...small, color: ink.secondary, margin: '2px 0' }}>
          {refused}
        </p>
      )}
      {sounds.length > 0 && !heardAt(speed) && (
        <Check
          testid="clip-speed-keep-sound"
          checked={kept}
          onChange={(on) => props.onEdit({ kind: 'setSpeed', clipId: clip.id, keepSound: on })}
        >
          Keep the sound at this speed
        </Check>
      )}
      {sounds.length > 0 && !heardAt(speed) && !kept && (
        <p style={{ ...small, color: ink.muted, margin: '2px 0' }}>
          Sound is silent below {HEARD_FROM}x and above {HEARD_TO}x unless kept.
        </p>
      )}
      {pictures.length > 0 && speed < 1 && (
        <Check
          testid="clip-speed-smooth"
          checked={!plain}
          onChange={(on) => props.onEdit({ kind: 'setSpeed', clipId: clip.id, plainFrames: !on })}
        >
          Smooth slow motion (blend frames)
        </Check>
      )}
      {group.length > 1 && <p style={{ ...small, color: ink.muted, margin: '2px 0' }}>Its linked clips play at the same speed.</p>}
    </Group>
  )
}
