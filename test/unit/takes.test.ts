import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendTake, beginTake, cancelTake, keepTake, recording } from '../../src/main/voiceover/takes'

/**
 * A take still open when its window went away, crashed or drawn again, is
 * kept as it was recorded, never thrown away by the next take begun (audit
 * 2026-10-08): the window that began it is gone and cannot have cancelled it.
 */

let folder = ''

afterEach(async () => {
  await cancelTake()
  if (folder) await rm(folder, { recursive: true, force: true })
})

describe('a voice-over take left open', () => {
  it('is kept as "(recording).wav" when another take begins', async () => {
    folder = await mkdtemp(join(tmpdir(), 'editbay-takes-'))
    await beginTake(folder, 'Voice over 10-00-00.wav', 48000)
    await appendTake(new Uint8Array(4800))
    await beginTake(folder, 'Voice over 10-05-00.wav', 48000)
    expect((await readdir(folder)).sort()).toEqual(['Voice over 10-00-00 (recording).wav', 'Voice over 10-05-00 (recording).wav'])
  })

  it('is kept, and no longer counted as recording, when its window goes away', async () => {
    folder = await mkdtemp(join(tmpdir(), 'editbay-takes-'))
    await beginTake(folder, 'Voice over 10-00-00.wav', 48000)
    await appendTake(new Uint8Array(4800))
    await keepTake()
    expect(recording()).toBe(false)
    expect(await readdir(folder)).toEqual(['Voice over 10-00-00 (recording).wav'])
  })
})
