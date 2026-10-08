import { describe, it, expect } from 'vitest'
import { trackCopyArgs } from '../../src/main/media/tracks'
import { trackPaths } from '../../src/main/media/cache'

describe('copying a recording\'s other audio tracks', () => {
  const args = trackCopyArgs('D:\\OBS\\session.mkv', [
    { index: 1, path: 'C:\\cache\\k\\track-2.m4a' },
    { index: 2, path: 'C:\\cache\\k\\track-3.m4a' }
  ])

  it('reads the recording once for the copies it is given, each to its own file', () => {
    expect(args.filter((a) => a === '-i')).toHaveLength(1)
    expect(args[args.indexOf('-i') + 1]).toBe('D:\\OBS\\session.mkv')
    expect(args.filter((_, i) => args[i - 1] === '-y')).toEqual(['C:\\cache\\k\\track-2.m4a', 'C:\\cache\\k\\track-3.m4a'])
  })

  it('takes each copy from its own track, by number, not by ffmpeg\'s choice', () => {
    expect(args.filter((_, i) => args[i - 1] === '-map')).toEqual(['0:a:1', '0:a:2'])
  })

  it('pads each copy with silence so it begins at the recording\'s start', () => {
    const filters = args.filter((_, i) => args[i - 1] === '-af')
    // One channel to both sides at its own level, as a player plays it (audit 2026-10-01).
    expect(filters).toEqual(['aresample=48000:async=1:first_pts=0,pan=stereo|FL=FL+FC|FR=FR+FC', 'aresample=48000:async=1:first_pts=0,pan=stereo|FL=FL+FC|FR=FR+FC'])
  })

  it('mixes a track of more than two channels down as ffmpeg does', () => {
    const [af] = trackCopyArgs('in.mkv', [{ index: 1, path: 'b.m4a', channels: 6 }]).filter((_, i, all) => all[i - 1] === '-af')
    expect(af).toBe('aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo')
  })

  it('encodes as a conformed file\'s sound is, AAC at 192 kb/s in stereo', () => {
    const first = args.slice(0, args.indexOf('C:\\cache\\k\\track-2.m4a'))
    expect(first[first.indexOf('-c:a') + 1]).toBe('aac')
    expect(first[first.indexOf('-b:a') + 1]).toBe('192k')
    expect(first[first.indexOf('-ac') + 1]).toBe('2')
  })

  it('names each copy by its track number, so the second track is track-2', () => {
    expect(trackPaths('C:\\cache\\k', 1)).toEqual({
      path: 'C:\\cache\\k\\track-2.m4a',
      peaksPath: 'C:\\cache\\k\\peaks-2.bin'
    })
  })
})
