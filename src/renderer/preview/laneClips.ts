import type { AudioTrack, Timeline, VideoTrack } from '../../shared/project'
import { blurRegions } from '../../shared/blur'
import { animationFrame, cleanOverlay, framePath, hasLayout, isAnimated, isOverlay, isStill, playedByPicture, targetAspect } from '../../shared/project'
import { sourceAt, spanEnd, spanLength } from '../../shared/tracks'
import { soundHeard } from '../../shared/speed'
import { FULL_PLACE } from '../../shared/layout'
import { moves } from '../../shared/crop-geometry'
import { boxMoves } from '../../shared/box-keys'
import { mainPicture } from './pictures-at'
import { previewScale, previewSoundFile, previewVolume } from '../../shared/sound'
import { duckGainAt } from '../../shared/ducking'
import type { Stretch } from '../../shared/silences'
import { fadeGainAt, shownSpans, transitionWindows } from '../../shared/transitions'
import { colourOf } from './pictureShowing'
import type { LaneClip, PictureLaneClip } from './lanes'

/**
 * Each track's clips as its players need them: the pictures and the sound
 * of a timeline, worked out from the project and the way it is listened to.
 * Moved here from `htmlVideo.ts`, which plays them.
 */

/** How the preview is being listened to, which the clips' sound depends on. */
export interface Listening {
  /** Lighter copies played in place of the recordings, by the recording's id. */
  proxies: ReadonlyMap<string, string>
  /** The listener's own volume, 0 to 1. */
  monitorVolume: number
  /** Whether an audio track is heard at all: not muted, and soloed if anything is. */
  audible: (trackId: string) => boolean
  /** Where the voice is, which a track that ducks comes down under. */
  voice: readonly Stretch[]
  /** The sound clips the sound engine plays (plan 106), which the players leave silent. */
  engine: ReadonlySet<string>
}

/**
 * A video track's clips as its players and the canvas need them. A clip
 * whose own first stream is heard, from exactly its own frames, plays it
 * from its own player, in step by construction, at that sound's volume.
 */
export function videoLaneClips(t: Timeline, track: VideoTrack, l: Listening): PictureLaneClip[] {
  const fps = t.fps
  // The spans the export cuts its segments at: a dip hands the picture over
  // in the middle of its window, and a blend shows both clips over all of it.
  const shown = shownSpans(track.clips, 'picture')
  const framed = targetAspect(t) !== null
  const scale = previewScale(t)
  const heard = new Map<string, number>()
  for (const audio of t.audioTracks) {
    // A muted track's sound is silent wherever it is played from, including
    // out of the picture's own player.
    if (!l.audible(audio.id)) continue
    for (const s of audio.clips) {
      const picture = playedByPicture(t, s)
      // Too fast or too slow to be heard, unless kept, it is silent (plan 105).
      // Unless the sound engine plays it (plan 106).
      if (picture && soundHeard(s) && !l.engine.has(s.id)) heard.set(picture.id, s.gain)
    }
  }
  return track.clips.flatMap((c) => {
    const media = t.media.find((m) => m.id === c.mediaId)
    if (!media) return []
    const gain = heard.get(c.id)
    const from = shown.get(c.id)?.from ?? c.timelineStart
    return [
      {
        id: c.id,
        path: l.proxies.get(media.id) ?? media.playablePath,
        startSec: from / fps,
        endSec: (shown.get(c.id)?.to ?? spanEnd(c)) / fps,
        // A player counts from 0; ffmpeg, whose frames the export shows, from the file's start.
        // Where the file is at `startSec`, which a transition reaching back
        // puts before the clip's own first frame: the footage the cut threw
        // away. Taken at the clip's first frame instead, the whole clip
        // played that much early, and the cut after it jumped back.
        fileAtStart: sourceAt(c, from) / fps + (media.startSec ?? 0),
        firstSec: media.startSec ?? 0,
        ...(c.speed !== undefined ? { rate: c.speed } : {}),
        volume: gain === undefined ? 0 : previewVolume(gain, scale, l.monitorVolume),
        muted: gain === undefined,
        pictures:
          framed && hasLayout(c)
            ? [mainPicture(c), ...c.layers]
            : [{ crop: c.transform.crop, place: FULL_PLACE, ...(framed && c.transform.style ? { style: c.transform.style } : {}) }],
        // A picture's own blurred bars; an image keeps its clear ones, as in the export.
        ...(framed && c.blurFill === true && !isStill(media) ? { blurFill: true } : {}),
        // Only when it goes somewhere: a clip that stays where it is put
        // keeps the pictures worked out once, as every clip used to.
        ...((c.transform.keys && moves(c.transform.keys)) ||
        c.layers.some((x) => x.keys && moves(x.keys)) ||
        (framed && hasLayout(c) && (boxMoves(c.transform.boxKeys) || c.layers.some((x) => boxMoves(x.boxKeys))))
          ? { move: { keys: c.transform.keys ?? [], sourceIn: c.sourceIn, startFrame: c.timelineStart, ...(c.speed !== undefined ? { speed: c.speed } : {}) } }
          : {}),
        ...colourOf(c),
        ...(c.blur !== undefined || c.blurBoxes ? { blurs: blurRegions(c, media.width, media.height) } : {}),
        ...(framed && isOverlay(media) ? { free: cleanOverlay(c.transform) } : {}),
        ...(framed && isOverlay(media) && (c.enter || c.exit)
          ? { appear: { start: c.timelineStart, length: spanLength(c), ...(c.enter ? { enter: c.enter } : {}), ...(c.exit ? { exit: c.exit } : {}) } }
          : {}),
        ...(isAnimated(media)
          ? {
              anim: {
                paths: Array.from({ length: media.frames! }, (_, i) => framePath(media, i)),
                // The frame of its source at this moment, and the export's own formula for which picture that is.
                frameAt: (sec: number): number => animationFrame(media, c.sourceIn + Math.floor(sec * fps + 1e-6) - c.timelineStart, fps)
              }
            }
          : {}),
        width: media.width,
        height: media.height
      }
    ]
  })
}

/** An audio track's heard clips as its players need them, leaving out those their picture's player plays. */
export function soundLaneClips(t: Timeline, track: AudioTrack, l: Listening): LaneClip[] {
  if (!l.audible(track.id)) return []
  const fps = t.fps
  const scale = previewScale(t)
  // Both sounds of a crossfade are heard at once, so their spans overlap and
  // each one's volume follows its own curve while it plays.
  const shown = shownSpans(track.clips, 'sound')
  const windows = transitionWindows(track.clips, 'sound')
  return track.clips.flatMap((c) => {
    const media = t.media.find((m) => m.id === c.mediaId)
    const file = media && !c.muted && soundHeard(c) && !playedByPicture(t, c) && !l.engine.has(c.id) ? previewSoundFile(media, c.track, c.denoise === true, c.voice) : null
    if (!file) return []
    const faded = windows.some((w) => w.fromClipId === c.id || w.toClipId === c.id)
    // A track that ducks follows the voice, on top of any fade of its own.
    const ducked = track.duck === true && l.voice.length > 0
    const voice = l.voice
    const from = shown.get(c.id)?.from ?? c.timelineStart
    return [
      {
        id: c.id,
        path: file.path,
        startSec: from / fps,
        endSec: (shown.get(c.id)?.to ?? spanEnd(c)) / fps,
        // Where the file is at `startSec`, as for a picture.
        fileAtStart: sourceAt(c, from) / fps + file.offsetSec,
        firstSec: file.offsetSec,
        ...(c.speed !== undefined ? { rate: c.speed } : {}),
        volume: previewVolume(c.gain, scale, l.monitorVolume),
        muted: false,
        ...(faded || ducked
          ? {
              fadeAt: (sec: number): number =>
                (faded ? fadeGainAt(windows, c.id, Math.floor(sec * fps + 1e-6)) : 1) * (ducked ? duckGainAt(voice, fps, sec) : 1)
            }
          : {})
      }
    ]
  })
}
