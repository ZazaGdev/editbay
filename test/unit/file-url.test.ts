import { describe, it, expect } from 'vitest'
import { fileUrl } from '../../src/shared/file-url'

describe('fileUrl', () => {
  it('turns a Windows path into a file URL', () => {
    expect(fileUrl('C:\\video\\clip.mp4')).toBe('file:///C:/video/clip.mp4')
  })

  it('encodes spaces, which real footage is full of', () => {
    expect(fileUrl('C:\\Users\\X\\Videos\\Screen Recordings\\a b.mp4')).toBe(
      'file:///C:/Users/X/Videos/Screen%20Recordings/a%20b.mp4'
    )
  })

  it('encodes a hash, which would otherwise truncate the path', () => {
    expect(fileUrl('C:\\v\\take #2.mp4')).toBe('file:///C:/v/take%20%232.mp4')
  })

  it('encodes a question mark', () => {
    expect(fileUrl('C:\\v\\what?.mp4')).toBe('file:///C:/v/what%3F.mp4')
  })

  it('leaves the drive letter colon alone', () => {
    expect(fileUrl('D:\\a.mp4')).toContain('D:/')
  })

  it('handles a path that already uses forward slashes', () => {
    expect(fileUrl('C:/video/clip.mp4')).toBe('file:///C:/video/clip.mp4')
  })

  it('handles a POSIX absolute path without doubling the slash', () => {
    expect(fileUrl('/home/x/clip.mp4')).toBe('file:///home/x/clip.mp4')
  })

  it('survives non-ascii characters', () => {
    expect(fileUrl('C:\\v\\ვიდეო.mp4')).toContain('file:///C:/v/')
    expect(fileUrl('C:\\v\\ვიდეო.mp4')).not.toContain(' ')
  })
})
