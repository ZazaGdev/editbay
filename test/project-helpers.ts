import {
  FIRST_SEQUENCE_ID,
  addClip,
  editSequence,
  timelineOf,
  v1Clips,
  type Clip,
  type Project,
  type SoundClip,
  type Timeline
} from '../src/shared/project'

/**
 * For tests that build and edit whole projects. Most only ever use the one
 * sequence a project starts with, and these keep them saying so briefly.
 */

/** The sequence every project starts with. */
export const S1 = FIRST_SEQUENCE_ID

/** A project's first sequence, as a timeline. */
export function firstTimeline(p: Project): Timeline {
  return timelineOf(p, S1)
}

/** The clips on V1 of a project's first sequence. */
export function clipsOf(p: Project): Clip[] {
  return v1Clips(firstTimeline(p))
}

/** The sound clips on every audio track of a project's first sequence, A1's first. */
export function soundsOf(p: Project): SoundClip[] {
  return firstTimeline(p).audioTracks.flatMap((r) => r.clips)
}

/** Add the whole of a source to the end of V1 of a project's first sequence, with its sound, as Add to timeline does. */
export function addClipTo(p: Project, mediaId: string): Project {
  return editSequence(p, S1, (t) => addClip(t, mediaId))
}
