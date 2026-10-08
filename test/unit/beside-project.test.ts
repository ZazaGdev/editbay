import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepBeside } from '../../src/main/media/cache'
import { unfinishedTakes } from '../../src/main/voiceover/takes'

/** Audit 2026-10-01: what a crash left beside a project, looked at when it opens. */

const root = await mkdtemp(join(tmpdir(), 'editbay-beside-'))
afterAll(() => rm(root, { recursive: true, force: true }))

const DAY = 24 * 3600 * 1000

describe('beside a project', () => {
  it('removes a save\'s scratch file once a day old, and nothing else', async () => {
    const dir = join(root, 'project')
    await import('node:fs/promises').then((f) => f.mkdir(dir, { recursive: true }))
    const old = '.0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6.tmp'
    const young = '.1b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6.tmp'
    for (const name of [old, young, 'holiday.editbay', 'notes.tmp']) await writeFile(join(dir, name), 'x')
    const then = new Date(Date.now() - 2 * DAY)
    await utimes(join(dir, old), then, then)
    await utimes(join(dir, 'notes.tmp'), then, then)
    await sweepBeside(dir)
    expect((await readdir(dir)).sort()).toEqual([young, 'holiday.editbay', 'notes.tmp'].sort())
  })

  it('names a voice-over take left recording, and keeps it', async () => {
    const takes = join(root, 'Voice overs')
    await import('node:fs/promises').then((f) => f.mkdir(takes, { recursive: true }))
    await writeFile(join(takes, 'Voice over 2026-10-01 10-00 (recording).wav'), 'x')
    await writeFile(join(takes, 'Voice over 2026-10-01 09-00.wav'), 'x')
    expect(await unfinishedTakes(takes)).toEqual(['Voice over 2026-10-01 10-00 (recording).wav'])
    expect(await unfinishedTakes(join(root, 'none'))).toEqual([])
  })
})
