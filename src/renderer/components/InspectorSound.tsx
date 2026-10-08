/** The Inspector's sound: a volume you can set exactly, and a sound clip's section. */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { ProjectMedia, SoundClip, Timeline } from '../../shared/project'
import { trackCount, cleanedFile, enhancedFile, treatedFile, trackName } from '../../shared/project'
import { gainFromPercent, isSilentPeaks, peaksKey, MAX_GAIN } from '../../shared/sound'
import type { PeaksData } from '../../shared/types'
import { ink, space } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { careOf, careRecipe, type BreathAmount } from '../../shared/voice-care'

import { Segmented } from '../ui/Segmented'
import { voiceRecipe, type VoiceStrength } from '../../shared/voice'
import { Group, dim, mono, row, small, type Edit } from './inspector-parts'
import { HelpTip } from '../ui/HelpTip'

/**
 * A volume: a slider from 0% to 400%, and the figure beside it as a box you can
 * type in.
 *
 * The slider alone is 84 pixels over a 400% range, so one pixel is nearly 5%
 * and 100% cannot reliably be hit at all. It is fine for finding roughly the
 * right level by ear and useless for setting an exact one, which is what the
 * box is for. Double clicking the slider puts it back to 100%, which is the
 * one figure people want most and the hardest to land on.
 *
 * A drag is one undo step: every movement after the first carries on the step
 * the first began. A typed figure is its own step, taken when Enter is pressed
 * or the box is left.
 */
export function Level(props: {
  testid: string
  gain: number
  disabled?: boolean
  title: string
  onChange: (gain: number, continuing: boolean) => void
}): JSX.Element {
  const dragging = useRef(false)
  const moved = useRef(false)
  /**
   * When this slider last moved the gain. A double click on a range input is
   * two presses, and the first of them jumps the thumb to where it landed, so
   * the reset that follows has an edit of its own sitting in front of it.
   * Carrying on that edit rather than making a second one leaves one undo step
   * for the whole gesture, so undoing a reset goes back to the volume that was
   * set before it and not to wherever the pointer happened to be.
   */
  const changedAt = useRef(0)
  /**
   * The gain this slider last asked for. A second press of a double click
   * lands the thumb where the first already put it, and the gain shown may not
   * have caught up yet: asking for the same gain again is not a change.
   */
  const asked = useRef<number | null>(null)
  const ask = (gain: number, continuing: boolean): void => {
    if (asked.current === gain && gain !== props.gain) return
    if (gain === props.gain && asked.current === null) return
    asked.current = gain
    props.onChange(gain, continuing)
  }
  // Once the gain shown is the one asked for, nothing is waiting on it.
  useEffect(() => {
    if (asked.current === props.gain) asked.current = null
  }, [props.gain])
  const percent = Math.round(props.gain * 100)
  /**
   * What is in the box while it is being typed in, or null when it simply shows
   * the gain. Half way through typing 250 the box holds "2", and sending that
   * would drop the clip to 2% on the way to turning it up.
   */
  const [typed, setTyped] = useState<string | null>(null)

  const commit = (text: string): void => {
    setTyped(null)
    const gain = gainFromPercent(text)
    if (gain !== null && gain !== props.gain) ask(gain, false)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <input
        type="range"
        min={0}
        max={MAX_GAIN * 100}
        step={1}
        value={percent}
        disabled={props.disabled}
        title={`${props.title}. Double click to put it back to 100%`}
        data-testid={props.testid}
        data-value={percent}
        onPointerDown={() => {
          dragging.current = true
          moved.current = false
        }}
        onPointerUp={(e) => {
          dragging.current = false
          // Give focus straight back, so the keyboard still drives the editor.
          e.currentTarget.blur()
        }}
        onDoubleClick={() => {
          if (props.disabled === true || props.gain === 1) return
          // Longer than a double click takes, so the jump this gesture just
          // made is folded in, and shorter than anything else the user could
          // have done in between.
          ask(1, performance.now() - changedAt.current < 600)
        }}
        onChange={(e) => {
          const continuing = dragging.current && moved.current
          moved.current = true
          changedAt.current = performance.now()
          ask(Number(e.target.value) / 100, continuing)
        }}
        className="ui-range"
        style={{ width: 70 }}
      />
      <Field
        label={props.title}
        hideLabel
        kind="number"
        unit="%"
        step={5}
        height={22}
        testid={`${props.testid}-typed`}
        value={typed ?? String(percent)}
        onChange={setTyped}
        onCommit={commit}
        style={{ width: 60 }}
      />
    </span>
  )
}

/**
 * The sound of the selected clip, once, whichever half of a recording was
 * clicked: a row for each of its sound clips, with its track, its stream's
 * name, whether it is heard and how loud; which stream it plays; cleaning up
 * noise; and, for a recording's pieces, the same balance for all of them.
 * Picking the picture or its sound shows the same section, so a volume set
 * on one is the volume the other shows.
 */
export function SoundSection(props: {
  timeline: Timeline
  /** The sound clips shown, the selected clip's own or those linked to it. */
  sounds: SoundClip[]
  /** The sound clip selected, whose row is picked out, or null when the picture is. */
  selectedSound: string | null
  clipId: string
  /** Whether "Same sound for every clip of this recording" applies. */
  sameForAll: boolean
  peaks: Map<string, PeaksData>
  onEdit: Edit
  /** Soften breaths or Remove mouth clicks set for a recording's track, for every clip that plays it (plan 81). */
  onCare?: ((mediaId: string, track: number, change: { breaths?: BreathAmount | null; clicks?: boolean }) => void) | undefined
}): JSX.Element {
  const { timeline, sounds } = props
  const mediaOf = (s: SoundClip): ProjectMedia | undefined => timeline.media.find((m) => m.id === s.mediaId)
  // What Plays and Clean up noise act on: the sound clip selected, or every
  // sound of the picture selected. Plays is for one clip only.
  const targets = props.selectedSound ? sounds.filter((s) => s.id === props.selectedSound) : sounds
  const one = targets.length === 1 ? targets[0]! : null
  const oneMedia = one ? mediaOf(one) : undefined
  const cleaning = targets.some((s) => {
    const m = mediaOf(s)
    return s.denoise === true && m !== undefined && cleanedFile(m, s.track) === null
  })
  // The strength shown: the one they share, or the first's when they differ; null when none has it on.
  const voice = targets.find((s) => s.voice !== undefined)?.voice ?? null
  const setVoice = (v: VoiceStrength | null): void => {
    for (const s of targets) if ((s.voice ?? null) !== v) props.onEdit({ kind: 'setClipVoice', clipId: s.id, voice: v })
  }
  // Breaths and clicks belong to the recording's track: the first one's shown, and set on each track the targets play.
  const careShown = one ?? targets[0]
  const careMedia = careShown ? mediaOf(careShown) : undefined
  const care = careShown && careMedia ? careOf(careMedia, careShown.track) : undefined
  const setCare = (change: { breaths?: BreathAmount | null; clicks?: boolean }): void => {
    const seen = new Set<string>()
    for (const s of targets) {
      const key = `${s.mediaId}#${s.track}`
      if (seen.has(key)) continue
      seen.add(key)
      props.onCare?.(s.mediaId, s.track, change)
    }
  }
  const treating = targets.some((s) => {
    const m = mediaOf(s)
    const c = m ? careOf(m, s.track) : undefined
    return c !== undefined && !s.muted && m !== undefined && treatedFile(m, s.track, careRecipe(c, s.denoise === true, s.voice)) === null
  })
  const enhancing = targets.some((s) => {
    const m = mediaOf(s)
    return s.voice !== undefined && !s.muted && m !== undefined && enhancedFile(m, s.track, voiceRecipe(s.voice, s.denoise === true)) === null
  })
  return (
    <Group name="Sound" testid="sound-section">
      {one && oneMedia && (trackCount(oneMedia) > 1 || one.track > 0) && (
        <div style={row}>
          <span style={dim}>Plays</span>
          <Select
            testid="sound-clip-track"
            label="Which of the recording's streams this clip plays"
            value={String(one.track)}
            blurOnChange
            height={24}
            onChange={(v) => props.onEdit({ kind: 'setSoundTrack', clipId: one.id, track: Number(v) })}
            choices={Array.from({ length: trackCount(oneMedia) }, (_, i) => ({
              value: String(i),
              label: trackName(oneMedia, i)
            }))}
          />
        </div>
      )}
      {sounds.map((s) => {
        const media = mediaOf(s)
        const index = timeline.audioTracks.findIndex((r) => r.clips.some((c) => c.id === s.id))
        const data = props.peaks.get(peaksKey(s.mediaId, s.track))
        const silent = data !== undefined && isSilentPeaks(data)
        return (
          <div
            key={s.id}
            data-testid="linked-sound"
            data-clip-id={s.id}
            data-track-index={index}
            data-heard={s.muted ? 'no' : 'yes'}
            data-silent={silent ? 'yes' : 'no'}
            data-selected={s.id === props.selectedSound ? 'yes' : 'no'}
            style={{ ...row, alignItems: 'center' }}
          >
            <span style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0 }}>
              <span style={{ ...mono, ...(s.id === props.selectedSound ? {} : dim) }}>A{index + 1}</span>
              <Check
                testid="linked-sound-heard"
                checked={!s.muted}
                onChange={(heard) => props.onEdit({ kind: 'setClipAudio', clipId: s.id, gain: s.gain, muted: !heard })}
                style={{ minWidth: 0 }}
              >
                <span title="Heard, or muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {media ? trackName(media, s.track) : ''}
                </span>
                {silent && <span style={{ ...small, color: ink.muted }}>silent</span>}
              </Check>
            </span>
            <Level
              testid="linked-sound-level"
              title="How loud this sound plays"
              gain={s.gain}
              onChange={(gain, continuing) => props.onEdit({ kind: 'setClipAudio', clipId: s.id, gain, muted: s.muted }, continuing)}
            />
          </div>
        )
      })}
      <div style={row}>
        <span style={dim}>Noise</span>
        <Check
          testid="sound-clip-denoise"
          checked={targets.length > 0 && targets.every((s) => s.denoise === true)}
          onChange={(on) => {
            for (const s of targets) if ((s.denoise === true) !== on) props.onEdit({ kind: 'setClipDenoise', clipId: s.id, on })
          }}
        >
          Clean up noise
        </Check>
      </div>
      {/* Made once in the background; until then the clip plays as it was recorded. */}
      {cleaning && (
        <p data-testid="sound-clip-cleaning" style={{ ...dim, margin: 0, marginTop: 4 }}>
          Taking the hiss and hum out. It plays as recorded until that is done, and an export waits for it.
        </p>
      )}
      <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
        <span style={dim}>Voice</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {voice !== null && (
            <Segmented
              testid="sound-clip-voice-strength"
              label="How strongly the voice is enhanced"
              size="small"
              chosen={voice}
              onChoose={(v: VoiceStrength) => setVoice(v)}
              choices={[
                { id: 'light' as VoiceStrength, label: 'Light', title: 'A little clearer, keeping the voice as it is' },
                { id: 'normal' as VoiceStrength, label: 'Normal', title: 'Clear and even, for most voices' },
                { id: 'strong' as VoiceStrength, label: 'Strong', title: 'Close and even, as a radio voice' }
              ]}
            />
          )}
          <Check testid="sound-clip-voice" checked={voice !== null} onChange={(on) => setVoice(on ? 'normal' : null)}>
            Enhance voice
          </Check>
        </span>
      </div>
      {/* Made once in the background, as the cleaned copy is; until then it plays the best thing it has. */}
      {enhancing && (
        <p data-testid="sound-clip-enhancing" style={{ ...dim, margin: 0, marginTop: 4 }}>
          Enhancing the voice. It plays without that until it is done, and an export waits for it.
        </p>
      )}
      {props.onCare && careShown && careMedia && (
        <>
          <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
            <span style={dim}>Breaths</span>
            <Segmented
              testid="sound-clip-breaths"
              label="How far breaths are turned down"
              size="small"
              chosen={care?.breaths ?? 'off'}
              onChoose={(v: BreathAmount | 'off') => setCare({ breaths: v === 'off' ? null : v })}
              choices={[
                { id: 'off' as const, label: 'Off', title: 'Breaths as recorded' },
                { id: 'gentle' as const, label: 'Gentle', title: 'Breaths about 10 dB quieter' },
                { id: 'strong' as const, label: 'Strong', title: 'Breaths about 20 dB quieter' }
              ]}
            />
          </div>
          <div style={row}>
            <span style={dim}>Clicks</span>
            <Check testid="sound-clip-clicks" checked={care?.clicks === true} onChange={(on) => setCare({ clicks: on })}>
              Remove mouth clicks
            </Check>
          </div>
          <HelpTip
            testid="sound-clip-care-note"
            text={`Breaths and clicks are set for the whole of ${trackName(careMedia, careShown.track)}: every clip that plays it has them.`}
            tutorial="478-breaths-and-mouth-clicks"
            style={{ marginTop: 4 }}
          />
        </>
      )}
      {treating && (
        <p data-testid="sound-clip-treating" style={{ ...dim, margin: 0, marginTop: 4 }}>
          Softening the breaths and taking out the clicks. It plays without that until it is done, and an export waits for it.
        </p>
      )}
      {voice !== null && !targets.every((s) => s.denoise === true) && (
        <HelpTip
          testid="sound-clip-voice-noise"
          text="On a noisy recording, turn on Clean up noise too: evening out the voice brings the room up with it."
          tutorial="476-enhance-a-voice"
          style={{ marginTop: 4 }}
        />
      )}
      {props.sameForAll && (
        <Button
          testid="apply-sound-all"
          size="small"
          onClick={() => props.onEdit({ kind: 'applySoundToSource', clipId: props.clipId })}
          style={{ marginTop: space.xs, alignSelf: 'flex-start' }}
          title="Give every other sound clip of this recording and stream the same heard and volume"
        >
          Same sound for every clip of this recording
        </Button>
      )}
    </Group>
  )
}
