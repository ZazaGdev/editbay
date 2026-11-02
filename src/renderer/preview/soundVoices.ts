import type { Timeline } from '../../shared/project'
import { sourceAt, spanEnd } from '../../shared/tracks'
import { soundHeard } from '../../shared/speed'
import { previewScale, previewSoundFile, previewVolume } from '../../shared/sound'
import { duckGainAt } from '../../shared/ducking'
import type { Stretch } from '../../shared/silences'
import { fadeGainAt, shownSpans, transitionWindows } from '../../shared/transitions'
import type { SoundVoice } from '../../shared/sound-chunks'

/**
 * Plan 106: every clip the sound engine plays, which is every clip heard on
 * an audio track at its own speed, including those whose sound the picture's
 * own player used to play. A clip with a speed of its own stays on its
 * player, which keeps its pitch.
 *
 * The same spans, volumes, fades and ducking the players are given, so what
 * is heard is the same and only when.
 */
export function soundVoices(t: Timeline, audible: (trackId: string) => boolean, monitor: number, voiceAt: readonly Stretch[]): SoundVoice[] {
  const fps = t.fps
  const scale = previewScale(t)
  return t.audioTracks.flatMap((track) => {
    if (!audible(track.id)) return []
    const shown = shownSpans(track.clips, 'sound')
    const windows = transitionWindows(track.clips, 'sound')
    const ducked = track.duck === true && voiceAt.length > 0
    return track.clips.flatMap((c): SoundVoice[] => {
      if (c.muted || !soundHeard(c) || (c.speed !== undefined && c.speed !== 1)) return []
      const media = t.media.find((m) => m.id === c.mediaId)
      if (!media || !previewSoundFile(media, c.track, c.denoise === true, c.voice)) return []
      const faded = windows.some((w) => w.fromClipId === c.id || w.toClipId === c.id)
      const from = shown.get(c.id)?.from ?? c.timelineStart
      return [
        {
          id: c.id,
          mediaId: media.id,
          track: c.track,
          denoise: c.denoise === true,
          ...(c.voice ? { voice: c.voice } : {}),
          ...(c.channel ? { side: c.channel } : {}),
          startSec: from / fps,
          endSec: (shown.get(c.id)?.to ?? spanEnd(c)) / fps,
          // As ffmpeg counts, from the file's own start.
          fileAtStart: sourceAt(c, from) / fps,
          gain: previewVolume(c.gain, scale, monitor),
          ...(faded || ducked
            ? {
                fadeAt: (sec: number): number =>
                  (faded ? fadeGainAt(windows, c.id, Math.floor(sec * fps + 1e-6)) : 1) * (ducked ? duckGainAt(voiceAt, fps, sec) : 1)
              }
            : {})
        }
      ]
    })
  })
}
