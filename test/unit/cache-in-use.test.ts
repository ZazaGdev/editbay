import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: (): string => 'C:\appdata' } }))

const session = await import('../../src/main/project/session')
const { cacheInUse } = await import('../../src/main/media/cache-in-use')
const { defaultWorkspace } = await import('../../src/shared/workspace')
const { createProject } = await import('../../src/shared/project')
type ProjectMedia = import('../../src/shared/project').ProjectMedia

/**
 * Freeing the cache keeps what an undo may still bring back (audit
 * 2026-10-08): a source taken out of the bin comes back with its files, and
 * a conformed one has nothing else to play from.
 */

const CACHE = join('C:\appdata', 'media-cache')

function source(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mov`,
    playablePath: join(CACHE, `key-${id}`, 'conformed.mp4'),
    conformed: true,
    conformReasons: ['variable-frame-rate'],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'hevc',
    hasAudio: true,
    peaksPath: join(CACHE, `key-${id}`, 'peaks.bin'),
    filmstripPath: join(CACHE, `key-${id}`, 'filmstrip.jpg')
  }
}

describe('what of the cache is in use', () => {
  it('is what the project uses and what a source taken out of the bin, which undo brings back, uses', () => {
    const p = { ...createProject('t', 30, { width: 1080, height: 1920 }), media: [source('a'), source('b')] }
    session.adoptDocument(p, null, defaultWorkspace(), true)
    expect(session.removeMedia('b')).toBe(true)
    expect([...cacheInUse()].sort()).toEqual(['key-a', 'key-b'])
  })
})
