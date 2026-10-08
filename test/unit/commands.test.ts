import { describe, it, expect } from 'vitest'
import { findCommands } from '../../src/shared/commands'

// In an order the ranking has to change: a command that has the word later in
// its name comes before one whose name starts with it.
const commands = [
  { label: 'Split at playhead' },
  { label: 'Play or pause' },
  { label: 'Show safe zones for TikTok', keywords: ['guides'] },
  { label: 'Show safe zones for Reels', keywords: ['guides'] },
  { label: 'Choose what to export' },
  { label: 'Export all sequences' },
  { label: 'Export' },
  { label: 'Change the shape to Vertical', keywords: ['portrait', '9:16'] }
]

const labels = (typed: string): string[] => findCommands(commands, typed).map((c) => c.label)

describe('findCommands', () => {
  it('lists everything when nothing is typed', () => {
    expect(labels('')).toHaveLength(commands.length)
    expect(labels('   ')).toHaveLength(commands.length)
  })

  it('finds a command by the start of any of its words', () => {
    expect(labels('split')).toEqual(['Split at playhead'])
    expect(labels('play')).toEqual(['Play or pause', 'Split at playhead'])
  })

  it('needs every word typed, in any order', () => {
    expect(labels('sh tik')).toEqual(['Show safe zones for TikTok'])
    expect(labels('tik sh')).toEqual(['Show safe zones for TikTok'])
    expect(labels('zones reels')).toEqual(['Show safe zones for Reels'])
  })

  it('finds a command by its other words', () => {
    expect(labels('portrait')).toEqual(['Change the shape to Vertical'])
    expect(labels('guides')).toEqual(['Show safe zones for TikTok', 'Show safe zones for Reels'])
  })

  it('puts first the commands whose name starts with what was typed', () => {
    expect(labels('ex')).toEqual(['Export all sequences', 'Export', 'Choose what to export'])
    expect(labels('seq')).toEqual(['Export all sequences'])
  })

  it('puts the shorter of those found further in first, so a name typed whole finds that one (task 54)', () => {
    const more = [
      { label: 'Move the picture in picture out of the way, to a free corner and back' },
      { label: 'Open Picture in picture in the Inspector' },
      { label: 'Lay out the clip as Picture in picture' }
    ]
    expect(findCommands(more, 'picture in picture').map((c) => c.label)[0]).toBe('Lay out the clip as Picture in picture')
  })

  it('finds nothing for letters of another alphabet, as with a Georgian layout on', () => {
    expect(labels('სპლიტ')).toEqual([])
  })

  it('ignores case and punctuation', () => {
    expect(labels('TIKTOK')).toEqual(['Show safe zones for TikTok'])
    expect(labels('split, at')).toEqual(['Split at playhead'])
  })

  it('finds nothing for words no command has', () => {
    expect(labels('zzz')).toEqual([])
  })
})
