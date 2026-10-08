import { describe, it, expect } from 'vitest'
import { conformWords, importErrorWords, importStatusWords } from '../../src/shared/conform-words'

describe('conformWords', () => {
  it('says nothing for a source used as it is', () => {
    expect(conformWords([])).toBeNull()
  })

  it('gives each reason its own words', () => {
    expect(conformWords(['variable-frame-rate'])).toBe('Converted on import because its frame timing varies.')
    expect(conformWords(['unsupported-codec'])).toBe('Converted on import because the preview cannot play its video format.')
    expect(conformWords(['high-bit-depth'])).toBe('Converted on import because it has 10-bit colour.')
    expect(conformWords(['hdr-transfer'])).toBe('Converted on import because it is HDR.')
    expect(conformWords(['rotation-metadata'])).toBe('Converted on import because it was filmed rotated.')
    expect(conformWords(['sound-format'])).toBe('Converted on import because the preview cannot play its sound format.')
  })

  it('lists several in one sentence', () => {
    expect(conformWords(['variable-frame-rate', 'high-bit-depth', 'hdr-transfer'])).toBe(
      'Converted on import because its frame timing varies, it has 10-bit colour and it is HDR.'
    )
  })

  it('still says something for a reason it does not know', () => {
    expect(conformWords(['odd-thing'])).toBe('Converted on import because odd thing.')
  })
})

describe('importErrorWords', () => {
  it('says a missing file is missing, with what to do', () => {
    // A source of an opened project, which the notice at the top can find.
    expect(importErrorWords('file not found').text).toMatch(/not where it was\. Use Find at the top.*press Retry/)
    // A file that went between the drop and its import.
    expect(importErrorWords("ENOENT: no such file or directory, stat 'D:\\a.mp4'").text).toBe(
      'The file is not there any more. It may have been moved or deleted.'
    )
  })

  it('says a file with nothing in it has nothing in it, keeping the words it came with', () => {
    const w = importErrorWords('no video or sound in D:\\notes.txt')
    expect(w.text).toBe('No video or sound in this file.')
    expect(w.details).toBe('no video or sound in D:\\notes.txt')
  })

  it('tells a file that cannot be read from one that failed to convert', () => {
    expect(importErrorWords('ffprobe exited with code 1').text).toMatch(/could not be read/)
    expect(importErrorWords('ffmpeg exited with code 69').text).toMatch(/Converting it failed/)
  })

  it('says what to do about a full disk or a file another program holds', () => {
    expect(importErrorWords('ENOSPC: no space left on device, write').text).toMatch(/disk is full/)
    expect(importErrorWords('EBUSY: resource busy or locked, open').text).toMatch(/Another program may be using it/)
  })

  it('falls back to a plain sentence, keeping the original as details', () => {
    expect(importErrorWords('something odd')).toEqual({ text: 'It could not be imported.', details: 'something odd' })
    expect(importErrorWords(undefined)).toEqual({ text: 'It could not be imported.', details: null })
  })
})

describe('importStatusWords', () => {
  it('says what each stage is doing', () => {
    expect(importStatusWords('queued', undefined, null)).toBe('waiting')
    expect(importStatusWords('probing', { stage: 'reading' }, null)).toBe('reading')
    expect(importStatusWords('analysing', { stage: 'waveform' }, null)).toBe('drawing the waveform')
    expect(importStatusWords('analysing', { stage: 'filmstrip' }, null)).toBe('making the filmstrip')
    expect(importStatusWords('analysing', { stage: 'tracks', tracks: 5 }, null)).toBe('copying 5 audio tracks')
    expect(importStatusWords('analysing', { stage: 'tracks', tracks: 1 }, null)).toBe('copying 1 audio track')
  })

  it('gives how far a conversion has got, and the time left once there is one', () => {
    expect(importStatusWords('conforming', { fraction: 0.423 }, null)).toBe('converting, 42%')
    expect(importStatusWords('conforming', { fraction: 0.423 }, 'about 3 minutes left')).toBe(
      'converting, 42%, about 3 minutes left'
    )
  })

  it('says nothing for a source that is ready or failed', () => {
    expect(importStatusWords('ready', undefined, null)).toBeNull()
    expect(importStatusWords('failed', undefined, null)).toBeNull()
  })
})
