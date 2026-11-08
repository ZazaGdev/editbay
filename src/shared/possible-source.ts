import type { ProjectMedia } from './project'

/** The most audio tracks a source may have: OBS records six. */
const MOST_TRACKS = 64

/** The most frames an animation may have: an import unpacks at most 600. */
const MOST_ANIMATION_FRAMES = 10_000

/** The longest a source may run: thirty days, far past any recording. */
const MOST_SECONDS = 30 * 24 * 60 * 60

/**
 * Whether a source's numbers are ones an import could have written. The
 * window counts up to some of them before it draws, a waveform for each track
 * and a picture for each frame of an animation, so a project file claiming a
 * trillion tracks froze it as it opened (audit 2026-11-07). One a file left
 * out, or saved as null, is let through as before.
 */
export function possibleSource(m: ProjectMedia): boolean {
  const within = (n: unknown, most = Infinity): boolean =>
    n === undefined || n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= most)
  return (
    within(m.durationSec, MOST_SECONDS) &&
    within(m.width) &&
    within(m.height) &&
    within(m.fps) &&
    within(m.audioTracks, MOST_TRACKS) &&
    within(m.frames, MOST_ANIMATION_FRAMES) &&
    within(m.frameRate)
  )
}
