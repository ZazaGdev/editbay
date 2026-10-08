/**
 * A clip's sound: its track, gain and mute, cleaned and treated voice copies and
 * which are still wanted, and which tracks captions listen to.
 */

import { cleanMark } from './marks'
import { isTakeName } from './voiceover'
import { type VoiceStrength, isVoiceStrength, voiceRecipe } from './voice'
import { careOf, careRecipe, type VoiceCare, type BreathAmount, caresFor } from './voice-care'
import { transitionWindows } from './transitions'
import { clamp } from './project-core'
import type { Timeline, ProjectMedia, SoundClip, Project, Clip, AudioTrack } from './project'
import { trackFile, trackCount } from './project-media'
import { timelineOf } from './sequences'
import { updateSoundClip, findClip, linkedIds, mapClips, hasPicture, v1Clips } from './timeline-query'

/** Which of its recording's audio tracks a sound clip plays. */
/** Turn Clean up noise on or off for a sound clip. On this clip alone. */
export function setClipDenoise(p: Timeline, clipId: string, on: boolean): Timeline {
  return updateSoundClip(p, clipId, (c) => {
    const { denoise: _was, ...rest } = c
    return on ? { ...rest, denoise: true } : rest
  })
}

/** Where a recording's track is kept cleaned of noise, or null until it has been. */
export function cleanedFile(m: ProjectMedia, track: number): string | null {
  return m.cleaned?.find((c) => c.track === track)?.path ?? null
}

/** Turn Enhance voice on at a strength, or off with null, for a sound clip. On this clip alone. */
export function setClipVoice(p: Timeline, clipId: string, voice: VoiceStrength | null): Timeline {
  return updateSoundClip(p, clipId, (c) => {
    const { voice: _was, ...rest } = c
    return voice !== null && isVoiceStrength(voice) ? { ...rest, voice } : rest
  })
}

/** Where a recording's track is kept treated to a recipe, or null until it has been. */
export function treatedFile(m: ProjectMedia, track: number, recipe: string): string | null {
  return m.treated?.find((e) => e.track === track && e.recipe === recipe)?.path ?? null
}

/** Where a recording's track is kept with its voice enhanced to a recipe, or null until it has been. */
export function enhancedFile(m: ProjectMedia, track: number, recipe: string): string | null {
  return m.enhanced?.find((e) => e.track === track && e.recipe === recipe)?.path ?? null
}

/**
 * The copy a sound clip plays instead of its track, in the preview and the
 * export alike: its enhanced voice once that is made; otherwise its cleaned
 * copy when Clean up noise is on and that is made; otherwise none, and it
 * plays its track as recorded. So a clip always plays the best thing there is.
 */
export function playedCopy(m: ProjectMedia, c: Pick<SoundClip, 'track' | 'denoise' | 'voice'>): string | null {
  // Breaths or clicks treated on the track: the copy made with those and the clip's own switches, once there.
  const care = careOf(m, c.track)
  if (care) {
    const treated = treatedFile(m, c.track, careRecipe(care, c.denoise === true, c.voice))
    if (treated) return treated
  }
  if (c.voice !== undefined) {
    const enhanced = enhancedFile(m, c.track, voiceRecipe(c.voice, c.denoise === true))
    if (enhanced) return enhanced
  }
  return c.denoise === true ? cleanedFile(m, c.track) : null
}

/** One enhanced copy still to be made: which track, how strong, and whether from the cleaned copy. */
export interface VoiceCopyWanted {
  media: ProjectMedia
  track: number
  strength: VoiceStrength
  clean: boolean
}

/**
 * The enhanced copies the clips with Enhance voice on ask for and do not
 * have yet, in every sequence: what is still to be made. A muted clip is
 * heard nowhere, so it waits until it is heard. One that is to be made from
 * a cleaned copy waits for that first.
 */
export function wantingVoiceCopy(p: Project): VoiceCopyWanted[] {
  const out = new Map<string, VoiceCopyWanted>()
  for (const s of p.sequences) {
    for (const track of timelineOf(p, s.id).audioTracks) {
      for (const c of track.clips) {
        if (c.voice === undefined || c.muted) continue
        const m = p.media.find((x) => x.id === c.mediaId)
        const clean = c.denoise === true
        if (!m || trackFile(m, c.track) === null) continue
        if (clean && cleanedFile(m, c.track) === null) continue
        const recipe = voiceRecipe(c.voice, clean)
        if (enhancedFile(m, c.track, recipe) !== null) continue
        out.set(`${m.id}#${c.track}#${recipe}`, { media: m, track: c.track, strength: c.voice, clean })
      }
    }
  }
  return [...out.values()]
}

/**
 * The recordings' tracks a clip with Clean up noise on plays, which have no
 * cleaned copy yet, in every sequence: what is still to be made. A muted
 * clip is heard nowhere, so it waits until it is heard.
 */
/** One treated copy still to be made: which track, its care, and the clip's own noise and voice switches. */
export interface CareCopyWanted {
  media: ProjectMedia
  track: number
  care: VoiceCare
  clean: boolean
  voice: VoiceStrength | undefined
}

/**
 * The treated copies the clips of tracks with breaths or clicks turned on ask
 * for and do not have yet, in every sequence. A muted clip waits until it is
 * heard.
 */
export function wantingCareCopy(p: Project): CareCopyWanted[] {
  const out = new Map<string, CareCopyWanted>()
  for (const s of p.sequences) {
    for (const track of timelineOf(p, s.id).audioTracks) {
      for (const c of track.clips) {
        if (c.muted) continue
        const m = p.media.find((x) => x.id === c.mediaId)
        const care = m ? careOf(m, c.track) : undefined
        if (!m || !care || trackFile(m, c.track) === null) continue
        const recipe = careRecipe(care, c.denoise === true, c.voice)
        if (treatedFile(m, c.track, recipe) !== null) continue
        out.set(`${m.id}#${c.track}#${recipe}`, { media: m, track: c.track, care, clean: c.denoise === true, voice: c.voice })
      }
    }
  }
  return [...out.values()]
}

/**
 * Soften breaths or Remove mouth clicks set for one track of a recording, for
 * every clip that plays it: `breaths` null or `clicks` false turns that one
 * off; a field left out stays as it is.
 */
export function setVoiceCare(p: Project, mediaId: string, track: number, change: { breaths?: BreathAmount | null; clicks?: boolean }): Project {
  const m = p.media.find((x) => x.id === mediaId)
  if (!m || !Number.isInteger(track) || track < 0 || track >= trackCount(m)) return p
  const was = m.care?.find((c) => c.track === track)
  const breaths = change.breaths === undefined ? was?.breaths : change.breaths === null ? undefined : change.breaths
  const clicks = change.clicks === undefined ? was?.clicks === true : change.clicks
  const next: VoiceCare = { track, ...(breaths !== undefined ? { breaths } : {}), ...(clicks ? { clicks: true as const } : {}) }
  const others = (m.care ?? []).filter((c) => c.track !== track)
  const care = caresFor(next) ? [...others, next].sort((a, b) => a.track - b.track) : others
  const { care: _was, ...rest } = m
  const media: ProjectMedia = care.length > 0 ? { ...rest, care } : rest
  return { ...p, media: p.media.map((x) => (x.id === mediaId ? media : x)) }
}

export function wantingCleanCopy(p: Project): { media: ProjectMedia; track: number }[] {
  const out = new Map<string, { media: ProjectMedia; track: number }>()
  for (const s of p.sequences) {
    for (const track of timelineOf(p, s.id).audioTracks) {
      for (const c of track.clips) {
        if (c.denoise !== true || c.muted) continue
        const m = p.media.find((x) => x.id === c.mediaId)
        if (!m || cleanedFile(m, c.track) !== null || trackFile(m, c.track) === null) continue
        out.set(`${m.id}#${c.track}`, { media: m, track: c.track })
      }
    }
  }
  return [...out.values()]
}

export function setSoundTrack(p: Timeline, clipId: string, track: number): Timeline {
  return updateSoundClip(p, clipId, (c, m) => ({ ...c, track: clamp(Math.round(track), 0, Math.max(0, trackCount(m) - 1)) }))
}

/**
 * Mark a clip with a colour, or take its mark away.
 *
 * The mark goes on every clip linked to it as well: a picture and its sound
 * came onto the timeline together and are one thing to mark, and marking only
 * the half you right clicked would leave the sound unmarked on A1 for no
 * reason you could see.
 *
 * A colour that names no mark takes the mark away rather than storing a
 * colour nothing can draw.
 */
export function setClipMark(p: Timeline, clipId: string, mark: string | null): Timeline {
  if (!findClip(p, clipId)) return p
  const clean = cleanMark(mark)
  const ids = new Set(linkedIds(p, clipId))
  const marked = <T extends Clip | SoundClip>(c: T): T =>
    ids.has(c.id) ? { ...c, ...(clean === undefined ? { mark: undefined } : { mark: clean }) } : c
  return mapClips(p, marked, marked)
}

/** The loudest a clip may be set: four times as recorded. */
export const MAX_GAIN = 4

/** A sound clip's volume and mute. */
export function setClipAudio(p: Timeline, clipId: string, audio: { gain: number; muted: boolean }): Timeline {
  return updateSoundClip(p, clipId, (c) => ({ ...c, gain: clamp(audio.gain, 0, MAX_GAIN), muted: audio.muted }))
}

/**
 * Give every other sound clip of the same recording and stream in the
 * sequence the volume and mute of this clip's linked sound clips, or of this
 * sound clip. A recording cut into thirty pieces balanced once is balanced in
 * every piece.
 */
export function applySoundToSource(p: Timeline, clipId: string): Timeline {
  const ids = new Set(linkedIds(p, clipId))
  const from = p.audioTracks.flatMap((r) => r.clips).filter((c) => ids.has(c.id))
  if (from.length === 0) return p
  return mapClips(
    p,
    (c) => c,
    (c) => {
      if (ids.has(c.id)) return c
      const model = from.find((s) => s.mediaId === c.mediaId && s.track === c.track)
      return model ? { ...c, gain: model.gain, muted: model.muted } : c
    }
  )
}

/**
 * The picture clip whose own player plays this sound clip in the preview: a
 * heard sound of a recording's first stream, linked to a picture of the same
 * recording at exactly the same start, in and length. That is every piece of
 * talking footage straight after a drop and any number of cuts, and one
 * player for both keeps them in step by construction.
 *
 * Never a sound with a transition over it. A picture and its sound are
 * stretched differently by the same transition: a dip hands the picture over
 * in the middle of the window while both sounds carry on across all of it. One
 * player cannot do both, so a sound being faded takes a player of its own.
 */
export function playedByPicture(p: Timeline, s: SoundClip): Clip | null {
  if (s.track !== 0 || s.muted || s.link === undefined) return null
  const at = pictureIndex(p)
  if (at.faded.has(s.id)) return null
  // A ducked sound's level follows a curve, and a cleaned, enhanced or treated
  // one plays another file: each needs a player of its own.
  if (at.trackOf.get(s.id)?.duck === true || s.denoise === true || s.voice !== undefined) return null
  const m = at.media.get(s.mediaId)
  if (m && (careOf(m, s.track) !== undefined || playedCopy(m, s) !== null)) return null
  const c = at.pictures.get(s.link)?.find(
    (x) => x.mediaId === s.mediaId && x.timelineStart === s.timelineStart && x.sourceIn === s.sourceIn && x.sourceOut === s.sourceOut
  )
  return c ?? null
}

/** What `playedByPicture` looks up, found once per timeline rather than once per sound clip. */
interface PictureIndex {
  trackOf: Map<string, AudioTrack>
  /** The sound clips a transition fades. */
  faded: Set<string>
  media: Map<string, ProjectMedia>
  /** The pictures under each link, in track order. */
  pictures: Map<string, Clip[]>
}

/**
 * Kept per timeline, which is never changed in place: asking for every sound
 * clip used to sort its whole track each time, and a long edit spent tens of
 * milliseconds a pass on it (audit 2026-10-01).
 */
const pictureIndexes = new WeakMap<Timeline, PictureIndex>()

function pictureIndex(p: Timeline): PictureIndex {
  const known = pictureIndexes.get(p)
  if (known) return known
  const trackOf = new Map<string, AudioTrack>()
  const faded = new Set<string>()
  for (const r of p.audioTracks) {
    for (const c of r.clips) trackOf.set(c.id, r)
    for (const w of transitionWindows(r.clips, 'sound')) {
      if (w.fromClipId !== null) faded.add(w.fromClipId)
      if (w.toClipId !== null) faded.add(w.toClipId)
    }
  }
  const pictures = new Map<string, Clip[]>()
  for (const r of p.videoTracks) {
    for (const c of r.clips) if (c.link !== undefined) pictures.set(c.link, [...(pictures.get(c.link) ?? []), c])
  }
  const index = { trackOf, faded, media: new Map(p.media.map((m) => [m.id, m])), pictures }
  pictureIndexes.set(p, index)
  return index
}

/**
 * The recordings whose first track a sound clip plays from its own player,
 * rather than its picture's, and that have no sound-only copy of it for the
 * preview. A sound file is already sound only.
 */
export function wantingSoundCopy(p: Project): ProjectMedia[] {
  const used = new Set<string>()
  for (const s of p.sequences) {
    const t = timelineOf(p, s.id)
    for (const track of t.audioTracks) {
      for (const c of track.clips) if (c.track === 0 && !c.muted && !playedByPicture(t, c)) used.add(c.mediaId)
    }
  }
  return p.media.filter((m) => used.has(m.id) && hasPicture(m) && m.hasAudio && !m.soundCopy)
}

/** A file's name without its folder. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Whether a sound clip plays a voice over take. */
function isVoiceOver(p: Timeline, c: SoundClip): boolean {
  const m = p.media.find((x) => x.id === c.mediaId)
  return m !== undefined && !hasPicture(m) && isTakeName(fileName(m.originalPath))
}

/**
 * The audio tracks Make captions listens to: those it listened to last time
 * that are still there, or else every track holding the talking head's own
 * sound, a clip linked to a picture on V1, and every track holding a voice
 * over take. Music makes the words worse, so the others are left out.
 */
export function listenTracks(p: Timeline): string[] {
  const kept = p.captions.listenTo.filter((id) => p.audioTracks.some((r) => r.id === id))
  if (kept.length > 0) return kept
  const links = new Set(v1Clips(p).flatMap((c) => (c.link !== undefined ? [c.link] : [])))
  return p.audioTracks
    .filter((r) => r.clips.some((c) => (c.link !== undefined && links.has(c.link)) || isVoiceOver(p, c)))
    .map((r) => r.id)
}
