import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProjectMedia } from '../../shared/project'
import { isAnimated, isStill } from '../../shared/project'
import { runFfmpeg } from '../ffmpeg/run'
import { cacheKey, commitScratch, derivedPaths, exists, proxyPath, scratchPath } from './cache'

/**
 * Plan 67: a recording's lighter copy, which the preview plays in its place
 * while "Play lighter copies" is on. The export never reads it.
 */

/** How tall the copy is on its shorter side, at most: half of 1080. */
export const PROXY_SHORT_SIDE = 540

/** The copy's size, even on both sides, or null for a recording no bigger than it would be. */
export function proxySize(width: number, height: number): { w: number; h: number } | null {
  const short = Math.min(width, height)
  if (!(short > PROXY_SHORT_SIDE)) return null
  const k = PROXY_SHORT_SIDE / short
  const even = (n: number): number => Math.max(2, Math.round((n * k) / 2) * 2)
  return { w: even(width), h: even(height) }
}

/**
 * Making the copy: the picture scaled down, quick to decode and with a
 * keyframe every half second or so, so a seek lands fast. The recording's own
 * timestamps are kept and its sound copied as it is, so the preview finds the
 * same moment at the same time in either file and the sound stays in sync.
 */
export function proxyArgs(input: string, output: string, size: { w: number; h: number }): string[] {
  return [
    '-copyts',
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', `scale=${size.w}:${size.h}:flags=bilinear,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'fastdecode',
    '-crf', '26',
    '-g', '15',
    '-c:a', 'copy',
    ...(/\.mp4$/i.test(output) ? ['-movflags', '+faststart'] : []),
    '-y', output
  ]
}

/** Whether a source is a recording with a picture, the only kind that gets a copy. */
export function wantsProxy(m: ProjectMedia): boolean {
  return m.hasVideo !== false && !isStill(m) && !isAnimated(m) && m.text === undefined && m.shape === undefined && m.colour === undefined && proxySize(m.width, m.height) !== null
}

/** Copies being made or made, by the file they are made from, so one asked for twice is made once. */
const making = new Map<string, Promise<string | null>>()
/** One copy made at a time: each one uses the whole processor. */
let queue: Promise<unknown> = Promise.resolve()
/** Stops every copy being made or waiting, when they are no longer wanted. */
let stopping = new AbortController()

/**
 * Stop making lighter copies: the one encoding and those waiting. For when
 * the setting is turned off or another project is opened, which used to
 * leave a copy using the whole processor for nothing (audit 2026-10-01).
 * Asked for again, each is made afresh.
 */
export function stopLighterCopies(): void {
  stopping.abort()
  stopping = new AbortController()
}

/**
 * A recording's lighter copy, made if it is not there yet, in the recording's
 * cache folder beside its other copies. Null for a source that gets none, or
 * when making it failed: the preview then plays the recording itself.
 */
export function makeProxy(m: ProjectMedia): Promise<string | null> {
  if (!wantsProxy(m)) return Promise.resolve(null)
  const had = making.get(m.playablePath)
  if (had) return had
  const signal = stopping.signal
  const run = queue.then(async () => {
    if (signal.aborted) throw new Error('stopped')
    const info = await stat(m.playablePath)
    const path = proxyPath(derivedPaths(cacheKey({ path: m.playablePath, size: info.size, mtimeMs: info.mtimeMs })).dir, m.playablePath)
    if (await exists(path)) return path
    await mkdir(dirname(path), { recursive: true })
    const scratch = scratchPath(path)
    try {
      await runFfmpeg(proxyArgs(m.playablePath, scratch, proxySize(m.width, m.height)!), { signal })
      await commitScratch(scratch, path)
    } catch (err) {
      await rm(scratch, { force: true })
      throw err
    }
    return path
  })
  const answer = run.catch(() => {
    // Asked again later, it is tried again.
    making.delete(m.playablePath)
    return null
  })
  queue = answer
  making.set(m.playablePath, answer)
  return answer
}
