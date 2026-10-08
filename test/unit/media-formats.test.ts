import { describe, it, expect } from 'vitest'
import { MEDIA_FORMATS, withMediaFormats } from '../../src/main/ffmpeg/run'

/** Audit 2026-10-01: every file you brought in is read only as video, sound or a picture. */

describe('the kinds of file an input may be read as', () => {
  it('are named before every input of yours, and not before one the app makes itself', () => {
    const args = withMediaFormats(['-ss', '1', '-i', 'a.mp4', '-f', 'lavfi', '-i', 'anullsrc', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'b.wav', '-f', 'null', '-'])
    const before = (path: string): string | undefined => args[args.indexOf(path) - 3]
    expect(before('a.mp4')).toBe('-format_whitelist')
    expect(before('b.wav')).toBe('-format_whitelist')
    expect(args.filter((a) => a === '-format_whitelist')).toHaveLength(2)
    // The output's own -f is not taken for an input's.
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })

  it('leave out playlists, which are what reached another computer', () => {
    const list = MEDIA_FORMATS.split(',')
    expect(list).toContain('mov')
    expect(list).not.toContain('hls')
    expect(list).not.toContain('concat')
  })
})
