import { describe, it, expect } from 'vitest'
import { binGroups, groupOf, isKind } from '../../src/shared/bin'
import type { MediaAsset } from '../../src/shared/types'

/**
 * F6 and F9: the Source bin by day and by kind, as one list worked out in one
 * place. A day is a local day, counted back from now.
 */

function asset(id: string, more: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    originalPath: `D:\\rec\\${id}.mkv`,
    playablePath: `D:\\rec\\${id}.mkv`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    status: 'ready',
    ...more
  }
}

/** Noon on 26 September 2026, local time. */
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime()
const at = (day: number, hour = 9): number => new Date(2026, 8, day, hour, 0, 0).getTime()

describe('which day a source came in on', () => {
  it('is today from midnight, and yesterday before it', () => {
    expect(groupOf(at(26, 0), NOW)).toBe('today')
    expect(groupOf(at(25, 23), NOW)).toBe('yesterday')
  })

  it('is this week for the five days before yesterday, and earlier than that after', () => {
    expect(groupOf(at(24), NOW)).toBe('week')
    expect(groupOf(at(20), NOW)).toBe('week')
    expect(groupOf(at(19), NOW)).toBe('earlier')
  })

  it('is earlier for a source brought in before sources had a date', () => {
    expect(groupOf(undefined, NOW)).toBe('earlier')
  })
})

describe('the bin by day', () => {
  // In the order they came into the project: oldest first.
  const assets = [asset('old'), asset('monday'), asset('yesterday'), asset('first-today'), asset('last-today')]
  const added = new Map([
    ['monday', at(21)],
    ['yesterday', at(25)],
    ['first-today', at(26, 8)],
    ['last-today', at(26, 11)]
  ])
  const opts = { search: '', sort: 'added' as const, kind: 'all' as const, now: NOW }

  it('folds it into days, newest first, each newest first inside', () => {
    const groups = binGroups(assets, added, opts)
    expect(groups.map((g) => [g.id, g.label, g.assets.map((a) => a.id)])).toEqual([
      ['today', 'Today', ['last-today', 'first-today']],
      ['yesterday', 'Yesterday', ['yesterday']],
      ['week', 'This week', ['monday']],
      ['earlier', 'Earlier', ['old']]
    ])
  })

  it('keeps the days and sorts inside each when sorted by name or length', () => {
    const byName = binGroups(assets, added, { ...opts, sort: 'name' })
    expect(byName[0]!.assets.map((a) => a.id)).toEqual(['first-today', 'last-today'])
  })

  it('leaves out a day with nothing in it once searched', () => {
    const groups = binGroups(assets, added, { ...opts, search: 'today' })
    expect(groups.map((g) => g.id)).toEqual(['today'])
  })
})

describe('the bin by kind', () => {
  const video = asset('clip')
  const sound = asset('song', { hasVideo: false })
  const importing = asset('coming', { status: 'conforming', hasVideo: false })

  it('tells a recording from a sound file', () => {
    expect(isKind(video, 'video')).toBe(true)
    expect(isKind(video, 'sound')).toBe(false)
    expect(isKind(sound, 'sound')).toBe(true)
    expect(isKind(sound, 'video')).toBe(false)
  })

  it('never hides one still importing, so a card does not vanish half way', () => {
    expect(isKind(importing, 'video')).toBe(true)
  })

  it('shows only the kind asked for', () => {
    const groups = binGroups([video, sound], new Map(), { search: '', sort: 'added', kind: 'sound', now: NOW })
    expect(groups.flatMap((g) => g.assets.map((a) => a.id))).toEqual(['song'])
  })
})
