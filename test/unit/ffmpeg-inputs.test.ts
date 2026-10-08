import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Every ffmpeg and ffprobe the app runs goes through the runners in
 * `src/main/ffmpeg`, which limit what kind of file an input may be read as.
 * Two detectors that called ffmpeg directly read a playlist beside a crafted
 * project, and ffmpeg reached out to the computer it named, which Windows
 * signs in to as the user (audit 2026-10-08).
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const root = process.cwd()
const RUNNERS = join(root, 'src', 'main', 'ffmpeg')

describe('the app running ffmpeg', () => {
  it('goes through the runners that limit what an input is read as', () => {
    const direct = sourceFiles(join(root, 'src', 'main'))
      .filter((path) => !path.startsWith(RUNNERS + sep))
      .filter((path) => /\b(capture|captureText)\(\s*(ffmpegPath|ffprobePath)\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).split(sep).join('/'))
    expect(direct).toEqual([])
  })
})
