import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { reopenAction, matchInFolder, sameRecording, copiesOnDisk, type OnDisk } from '../../src/main/project/reopen'
import type { ProjectMedia } from '../../src/shared/project'

function media(id: string, original: string, conformed: boolean): ProjectMedia {
  const cache = `C:\\cache\\${id}`
  return {
    id,
    originalPath: original,
    playablePath: conformed ? `${cache}\\conformed.mp4` : original,
    conformed,
    conformReasons: conformed ? ['variable-frame-rate'] : [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: `${cache}\\peaks.bin`,
    filmstripPath: `${cache}\\filmstrip.jpg`
  }
}

const all: OnDisk = { playable: true, original: true, peaks: true, filmstrip: true }

describe('the copies of a recording\'s other audio tracks', () => {
  it('rebuilds a source whose copies are missing, as it does a missing waveform', () => {
    expect(reopenAction(media('a', 'D:\\a.mkv', false), { ...all, tracks: false })).toBe('rebuildDerived')
  })

  it('needs none for a source with one track, or a track count nobody knows', async () => {
    expect(await copiesOnDisk(media('a', 'D:\\a.mp4', false))).toBe(true)
    expect(await copiesOnDisk({ ...media('a', 'D:\\a.mp4', false), audioTracks: 1 })).toBe(true)
  })

  it('needs them for a source with several tracks and none recorded, as one imported before they were made', async () => {
    expect(await copiesOnDisk({ ...media('a', 'D:\\a.mkv', false), audioTracks: 6 })).toBe(false)
  })

  it('needs none for a source with no sound, whatever its count says', async () => {
    expect(await copiesOnDisk({ ...media('a', 'D:\\a.mkv', false), audioTracks: 6, hasAudio: false })).toBe(true)
  })
})

describe('what a source needs when its project opens', () => {
  it('nothing, when everything is there', () => {
    expect(reopenAction(media('a', 'D:\\a.mp4', false), all)).toBe('ready')
    expect(reopenAction(media('a', 'D:\\a.mov', true), all)).toBe('ready')
  })

  it('its waveform rebuilt, when only that is missing', () => {
    expect(reopenAction(media('a', 'D:\\a.mp4', false), { ...all, peaks: false })).toBe('rebuildDerived')
  })

  it('its filmstrip rebuilt, when only that is missing', () => {
    expect(reopenAction(media('a', 'D:\\a.mov', true), { ...all, filmstrip: false })).toBe('rebuildDerived')
  })

  it('both rebuilt from the playable file even when the original has gone', () => {
    const disk = { playable: true, original: false, peaks: false, filmstrip: false }
    expect(reopenAction(media('a', 'D:\\a.mov', true), disk)).toBe('rebuildDerived')
  })

  it('importing again, when the cache lost the conformed file but the original is in place', () => {
    const disk = { playable: false, original: true, peaks: false, filmstrip: false }
    expect(reopenAction(media('a', 'D:\\a.mov', true), disk)).toBe('reimport')
  })

  it('importing again even if its waveform survived, since the file it describes did not', () => {
    const disk = { playable: false, original: true, peaks: true, filmstrip: true }
    expect(reopenAction(media('a', 'D:\\a.mov', true), disk)).toBe('reimport')
  })

  it('relinking, when a conformed file and its original have both gone', () => {
    const disk = { playable: false, original: false, peaks: true, filmstrip: true }
    expect(reopenAction(media('a', 'D:\\a.mov', true), disk)).toBe('offline')
  })

  it('relinking, when a file that played as it was has gone', () => {
    const disk = { playable: false, original: false, peaks: true, filmstrip: true }
    expect(reopenAction(media('a', 'D:\\a.mp4', false), disk)).toBe('offline')
  })
})

describe('finding the other missing files in a folder', () => {
  const offline = [
    media('a', 'D:\\old\\intro.mp4', false),
    media('b', 'D:\\old\\Talk.MOV', true),
    media('c', 'E:\\elsewhere\\outro.mp4', false)
  ]

  it('matches by file name, wherever each one used to be', () => {
    const found = matchInFolder(offline, 'F:\\new', ['intro.mp4', 'outro.mp4', 'unrelated.mp4'])
    expect(found).toEqual([
      { id: 'a', path: join('F:\\new', 'intro.mp4') },
      { id: 'c', path: join('F:\\new', 'outro.mp4') }
    ])
  })

  it('ignores the case of names, as Windows does, and uses the name on disk', () => {
    expect(matchInFolder(offline, 'F:\\new', ['talk.mov'])).toEqual([{ id: 'b', path: join('F:\\new', 'talk.mov') }])
  })

  it('finds nothing in a folder without them', () => {
    expect(matchInFolder(offline, 'F:\\new', ['holiday.jpg'])).toEqual([])
    expect(matchInFolder(offline, 'F:\\new', [])).toEqual([])
  })

  it('does not match a name that only contains another', () => {
    expect(matchInFolder(offline, 'F:\\new', ['my intro.mp4', 'intro.mp4.bak'])).toEqual([])
  })

  it('leaves alone a name two missing files share, since either could be the one found', () => {
    const twins = [media('paris', 'D:\\Paris\\IMG_0001.MOV', false), media('rome', 'D:\\Rome\\IMG_0001.MOV', false)]
    expect(matchInFolder(twins, 'F:\\Paris', ['IMG_0001.MOV'])).toEqual([])
  })

  it('still matches the other names when one name is shared', () => {
    const mixed = [
      media('paris', 'D:\\Paris\\IMG_0001.MOV', false),
      media('rome', 'D:\\Rome\\IMG_0001.MOV', false),
      media('talk', 'D:\\Paris\\talk.mp4', false)
    ]
    expect(matchInFolder(mixed, 'F:\\new', ['IMG_0001.MOV', 'talk.mp4'])).toEqual([
      { id: 'talk', path: join('F:\\new', 'talk.mp4') }
    ])
  })
})

describe('whether a file found by name is the same recording', () => {
  const missing = { durationSec: 10, width: 1920, height: 1080, hasAudio: true, fps: 30 }

  it('is, when everything the import learned agrees', () => {
    expect(sameRecording(missing, { durationSec: 10, width: 1920, height: 1080, hasAudio: true })).toBe(true)
  })

  it('is, when the length differs by less than a frame, as a new probe can', () => {
    expect(sameRecording(missing, { durationSec: 10.02, width: 1920, height: 1080, hasAudio: true })).toBe(true)
  })

  it('is not, when the length differs by more than a frame', () => {
    expect(sameRecording(missing, { durationSec: 9.9, width: 1920, height: 1080, hasAudio: true })).toBe(false)
  })

  it('is not, when the picture is a different size', () => {
    expect(sameRecording(missing, { durationSec: 10, width: 1080, height: 1920, hasAudio: true })).toBe(false)
  })

  it('is not, when one has sound and the other has none', () => {
    expect(sameRecording(missing, { durationSec: 10, width: 1920, height: 1080, hasAudio: false })).toBe(false)
  })

  it('is not, when they have different numbers of audio tracks, and is when neither was counted', () => {
    const six = { ...missing, audioTracks: 6 }
    expect(sameRecording(six, { durationSec: 10, width: 1920, height: 1080, hasAudio: true, audioTracks: 1 })).toBe(false)
    expect(sameRecording(six, { durationSec: 10, width: 1920, height: 1080, hasAudio: true, audioTracks: 6 })).toBe(true)
    expect(sameRecording(missing, { durationSec: 10, width: 1920, height: 1080, hasAudio: true, audioTracks: 1 })).toBe(true)
  })
})
