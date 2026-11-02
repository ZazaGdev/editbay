import { addClip, createTimeline, type Clip, type ProjectMedia, type SoundClip, type Timeline } from '../src/shared/project'

/**
 * Shots on V1, each with its sound linked on A1, laid out frame by frame: the
 * J-cuts and L-cuts the review criteria ask every edit that moves time to be
 * tried against.
 */

export function media(id: string, durationSec = 20): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A shot: its picture at `at` from recording frame `from` to `to`, its sound from recording frame `sound[0]`, on the timeline from `sound[1]` to `sound[2]`. */
export type Shot = { id: string; at: number; from: number; to: number; sound: [number, number, number] }

/** A plain shot, its sound under its picture exactly, from recording frame 300 on. */
export function shot(id: string, at: number, length: number): Shot {
  return { id, at, from: 300, to: 300 + length, sound: [300, at, at + length] }
}

/** The shots on V1, each picture called by its shot's id and its sound by the id and `s`, linked on A1. */
export function sequence(...shots: Shot[]): Timeline {
  const base = createTimeline(30, { width: 1920, height: 1080 })
  const p = shots.reduce((t, s) => addClip({ ...t, media: [...t.media, media(s.id)] }, s.id), base)
  const shotOf = (mediaId: string): Shot => shots.find((s) => s.id === mediaId)!
  return {
    ...p,
    videoTracks: [
      {
        ...p.videoTracks[0]!,
        clips: p.videoTracks[0]!.clips.map((c) => {
          const s = shotOf(c.mediaId)
          return { ...c, id: s.id, sourceIn: s.from, sourceOut: s.to, timelineStart: s.at }
        })
      }
    ],
    audioTracks: [
      {
        ...p.audioTracks[0]!,
        clips: p.audioTracks[0]!.clips.map((c) => {
          const [from, start, end] = shotOf(c.mediaId).sound
          return { ...c, id: `${c.mediaId}s`, sourceIn: from, sourceOut: from + end - start, timelineStart: start }
        })
      }
    ]
  }
}

export const pic = (t: Timeline, id: string): Clip => t.videoTracks[0]!.clips.find((c) => c.id === id)!
export const snd = (t: Timeline, id: string): SoundClip => t.audioTracks[0]!.clips.find((c) => c.id === `${id}s`)!
