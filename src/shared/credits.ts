/**
 * Task 47: credits a video's description must carry, for the files in it that
 * ask for one. A pack's folder holds them in a credit.txt, and any one file
 * can be marked by hand.
 */

import type { Timeline } from './project'
import { spanEnd, type Span } from './tracks'

/** The file in a pack's folder that holds the credit its files need. */
export const CREDIT_FILE = 'credit.txt'

/** The longest credit line kept. */
export const MAX_CREDIT = 300

/** The credit in a credit.txt, or typed by hand: its first line with words in it, or null for none. */
export function creditLine(text: string): string | null {
  const line = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '')
  return line ? line.slice(0, MAX_CREDIT) : null
}

/** How a file's path is kept among those marked by hand: the same file however its letters are cased. */
export function creditKey(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase()
}

/** The files marked by hand as kept in the settings, from something that may not be whole. */
export function cleanCredits(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [path, value] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
    const line = typeof value === 'string' ? creditLine(value) : null
    if (path !== '' && line) out[creditKey(path)] = line
  }
  return out
}

/** The files the clips of a timeline play, within `range` when given, each once, in the order first used. */
export function mediaPathsIn(t: Timeline, range: { from: number; to: number } | null): string[] {
  const clips: (Span & { mediaId: string })[] = [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)]
  const used = clips.filter((c) => !range || (c.timelineStart < range.to && spanEnd(c) > range.from)).sort((a, b) => a.timelineStart - b.timelineStart)
  const out: string[] = []
  for (const c of used) {
    const path = t.media.find((m) => m.id === c.mediaId)?.originalPath
    if (path && !out.includes(path)) out.push(path)
  }
  return out
}

/** The words written beside a video for its description's credits. */
export function creditsText(lines: readonly string[]): string {
  return `Credits for the description:\n\n${lines.join('\n')}\n`
}
