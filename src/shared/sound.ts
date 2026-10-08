import { playedCopy, trackFile, type ProjectMedia, type Timeline } from './project'
import type { VoiceStrength } from './voice'
import { peakAtSecond } from './peaks'
import { spanHolds } from './tracks'
import type { PeaksData } from './types'

/**
 * What the preview does with sound. Pure, so the arithmetic that decides what
 * you hear, and how far players may drift apart, is tested without a browser.
 */

/**
 * What every volume in the preview is multiplied by. A media element cannot
 * play louder than its file, so when anything in the sequence is set above
 * 100%, everything plays quieter by the same factor: the loudest is at 100%
 * and the balance between them is the export's.
 */
/**
 * How a track becomes two channels, given how many it has (audit
 * 2026-10-01): one channel to both sides at its own level, as a player plays
 * a mono file, and two left as they are. ffmpeg's own way puts mono 3 dB
 * down on each side, so every voice-over take was quieter in the export than
 * in the preview. More than two are mixed down as ffmpeg does; a count not
 * known, from a source brought in before it was kept, is taken as one or two.
 */
export function toStereo(channels: number | undefined): string {
  return channels !== undefined && channels > 2 ? 'aformat=channel_layouts=stereo' : 'pan=stereo|FL=FL+FC|FR=FR+FC'
}

export function previewScale(timeline: Timeline): number {
  let loudest = 1
  for (const track of timeline.audioTracks) {
    for (const c of track.clips) if (!c.muted) loudest = Math.max(loudest, c.gain)
  }
  return 1 / loudest
}

/**
 * The file the preview plays one of a source's audio tracks from, and how far
 * its player's time is from the recording's time as the export counts it.
 *
 * A track after the first plays from its copy, which starts at the
 * recording's start, so the two agree. The first plays from a sound-only copy
 * of it when there is one, made so a player need not read the picture it
 * never shows, and otherwise from the playable file, whose player counts from
 * 0 where ffmpeg counts from the file's start.
 */
export function previewSoundFile(
  m: ProjectMedia,
  track: number,
  denoise = false,
  voice?: VoiceStrength
): { path: string; offsetSec: number } | null {
  // Enhanced or cleaned, once the copy is there; the track as it is until then.
  const copy = playedCopy(m, { track, ...(denoise ? { denoise: true } : {}), ...(voice ? { voice } : {}) })
  if (copy) return { path: copy, offsetSec: 0 }
  if (track === 0 && m.soundCopy) return { path: m.soundCopy, offsetSec: 0 }
  const file = trackFile(m, track)
  if (!file) return null
  return { path: file.path, offsetSec: track === 0 ? (m.startSec ?? 0) : 0 }
}

/**
 * A volume for a media element: the export's loudness, scaled, turned down by
 * however far the monitor is turned down, and never past what an element takes.
 *
 * The monitor's volume is the listener's and not the edit's. It is the last
 * thing applied and it only ever lowers, so it can be a plain multiplication on
 * an element's own volume rather than anything to do with the audio context.
 */
export function previewVolume(loudness: number, scale: number, monitor = 1): number {
  const heard = Math.min(1, Math.max(0, monitor))
  return Math.min(1, Math.max(0, loudness * scale)) * heard
}

/** The loudest a clip can be set to, on the slider and in the box beside it alike. */
export const MAX_GAIN = 4

/**
 * The gain a volume box means, or null when what is in it says nothing yet.
 *
 * Null rather than 0 for an empty box or for letters. Half way through typing
 * 250 the box holds nothing at all for a moment, and reading that as silence
 * would drop the clip to nothing on the way to turning it up.
 *
 * A figure past the ends is brought to them rather than refused: 900 typed into
 * a box that stops at 400 means as loud as it goes, which is what to do with it.
 * A trailing per cent sign is allowed, because the box draws one.
 */
export function gainFromPercent(typed: string): number | null {
  const text = typed.trim().replace(/%$/, '').trim()
  if (text === '') return null
  // Number() rather than parseFloat: parseFloat reads "12abc" as 12, and a box
  // holding "12abc" has not been finished being typed in.
  const percent = Number(text)
  if (!Number.isFinite(percent)) return null
  return Math.min(MAX_GAIN, Math.max(0, percent / 100))
}

/** Below this on every bucket, a track is taken to hold nothing: about -54 dB. */
const SILENT_PEAK = 64

/**
 * Whether a waveform is flat. OBS records every enabled track even when
 * nothing is routed to it, so a recording can carry tracks of pure silence.
 */
export function isSilentPeaks(data: PeaksData): boolean {
  for (let i = 0; i < data.peaks.length; i++) {
    if (Math.abs(data.peaks[i] ?? 0) >= SILENT_PEAK) return false
  }
  return true
}

/** The loudest sample anywhere in a waveform, as it is stored. */
function loudestSample(data: PeaksData): number {
  let loudest = 0
  for (let i = 0; i < data.peaks.length; i++) {
    const at = Math.abs(data.peaks[i] ?? 0)
    if (at > loudest) loudest = at
  }
  return loudest
}

/**
 * The one waveform to draw for a whole recording: the loudest of the streams
 * of it that have loaded.
 *
 * Not simply the first. OBS records every enabled track whether anything is
 * routed to it or not, and a gaming recording's first track is as often a
 * microphone that is quiet for most of it as it is the game. Drawing the first
 * gives a strip that looks empty on a recording full of sound, which says the
 * recording is silent when it is not.
 *
 * Undefined when none of this recording's waveforms has loaded yet, which is
 * different from all of them being silent.
 */
export function loudestPeaks(peaks: Map<string, PeaksData>, mediaId: string): PeaksData | undefined {
  let best: PeaksData | undefined
  let bestLevel = -1
  for (const [key, data] of peaks) {
    if (!isPeaksKeyOf(key, mediaId)) continue
    const level = loudestSample(data)
    // Strictly louder, so a tie leaves the earliest stream chosen.
    if (level > bestLevel) {
      best = data
      bestLevel = level
    }
  }
  return best
}

/**
 * How loud the sequence is at `frame`, from 0 to 1, read from the waveforms
 * the timeline already draws from.
 *
 * Null rather than 0 when there is nothing to say: no sound clip covers the
 * frame, or none of those that do has its waveform yet. A meter that reads
 * nothing and one that does not know are different things, and only the first
 * should be drawn empty.
 *
 * The loudest of the clips heard, not their sum: a bucket already holds the
 * loudest sample in it, and adding them would say the sequence clips where it
 * does not. It is what the project has rather than what the speakers give:
 * `previewScale` quietens everything when a clip is set above 100%, and the
 * machine's own volume is nothing to do with the edit. The level shown is the
 * level that gets exported, which is the one worth watching.
 *
 * Only the audio tracks are read. A picture whose own sound is heard has that
 * sound on an audio track in this project, whichever player happens to play
 * it, which `playedByPicture` decides and this does not need to know.
 */
export function levelAt(t: Timeline, peaks: Map<string, PeaksData>, frame: number): number | null {
  let loudest: number | null = null
  for (const track of t.audioTracks) {
    for (const c of track.clips) {
      if (c.muted || c.gain <= 0 || !spanHolds(c, frame)) continue
      const data = peaks.get(peaksKey(c.mediaId, c.track))
      if (!data) continue
      const sec = (c.sourceIn + (frame - c.timelineStart)) / t.fps
      loudest = Math.max(loudest ?? 0, peakAtSecond(data.peaks, data.peaksPerSecond, sec) * c.gain)
    }
  }
  return loudest
}

/**
 * A level from 0 to 1 as decibels below full scale, which is the scale sound
 * is read in: full scale is 0, half the amplitude is about -6, a tenth is -20.
 *
 * Silence has no logarithm. It comes back as -Infinity, which is the honest
 * answer and is what a meter draws as the bottom of its scale.
 */
export function levelDb(level: number): number {
  const held = Math.min(1, Math.max(0, level))
  return held <= 0 ? -Infinity : 20 * Math.log10(held)
}

/**
 * What a meter writes beside its bar.
 *
 * Null is not silence: nothing is heard at the playhead, or the waveform of
 * what is has not loaded, and neither is a reading of zero.
 *
 * A tenth of a decibel near the top, where a tenth is the difference between
 * headroom and none, and whole decibels further down, where it is noise and
 * the extra figure only jitters.
 */
export function formatLevelDb(level: number | null): string {
  if (level === null) return '--'
  const db = levelDb(level)
  if (!Number.isFinite(db)) return '-∞ dB'
  return `${db > -10 ? db.toFixed(1) : String(Math.round(db))} dB`
}

/**
 * How a track's waveform is found among those loaded: a source's first
 * track by its id, as it always was, and the rest by id and track number.
 */
export function peaksKey(mediaId: string, index: number): string {
  return index === 0 ? mediaId : `${mediaId}#${index + 1}`
}

/** Whether a waveform key belongs to a source, whichever of its tracks it is. */
export function isPeaksKeyOf(key: string, mediaId: string): boolean {
  return key === mediaId || key.startsWith(`${mediaId}#`)
}

/** Further out than this, a player is moved rather than eased back. */
export const SEEK_DRIFT_SEC = 0.25
/** Closer than this, a player is left alone: under a third of a frame at 60 fps. */
const CLOSE_ENOUGH_SEC = 0.005
/** The most a player's speed is changed to bring it back: small enough not to be heard. */
const MAX_NUDGE = 0.08

export interface SyncAction {
  /** Move the player to where it should be. */
  seek: boolean
  /** The playback speed to use until the next check. */
  rate: number
}

/**
 * What to do about a player that is `driftSec` ahead of where it should be,
 * or behind when negative, playing at `rate` now, while the sequence plays at
 * `speed`. A long way out it seeks.
 * Closer, it is eased back by playing a little slower or faster, which a
 * listener does not notice as they would a seek. Speeds come in steps of 1%,
 * so a player is not handed a new speed on every frame.
 *
 * A playing player is never put back to exactly its normal speed. Chromium
 * keeps the pitch at any other speed by stretching the sound, and turning that
 * on or off puts the player 20 to 40 ms out, measured, which is the very drift
 * this is correcting. So once in step it swings between 1% slow and 1% fast,
 * a few milliseconds either side of where it should be.
 */
export function syncAction(driftSec: number, rate = 1, speed = 1): SyncAction {
  // Worked out around 1, and carried to the speed the sequence plays at: at 2x
  // the same nudges are steps of 1% of 2.
  if (speed !== 1) {
    const at = syncAction(driftSec, rate / speed)
    return { seek: at.seek, rate: at.rate * speed }
  }
  if (!Number.isFinite(driftSec) || Math.abs(driftSec) > SEEK_DRIFT_SEC) return { seek: true, rate: 1 }
  const gentle = driftSec > 0 ? 0.99 : 1.01
  if (Math.abs(driftSec) < CLOSE_ENOUGH_SEC) return { seek: false, rate: rate !== 1 && Math.abs(rate - 1) <= 0.011 ? rate : gentle }
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, driftSec * 3))
  const stepped = Math.round((1 - nudge) * 100) / 100
  return { seek: false, rate: stepped === 1 ? gentle : stepped }
}
