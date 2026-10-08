import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRecent,
  forgetRecent,
  setLast,
  sanitiseRecent,
  emptyRecent,
  loadRecent,
  saveRecent,
  recentPath,
  MAX_RECENT
} from '../../src/main/settings/recent-store'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-recent-'))
  dirs.push(dir)
  return dir
}

describe('adding a project', () => {
  it('puts it at the top and makes it the last one open', () => {
    const s = addRecent(addRecent(emptyRecent(), 'D:\\a.editbay'), 'D:\\b.editbay')
    expect(s.projects).toEqual(['D:\\b.editbay', 'D:\\a.editbay'])
    expect(s.last).toBe('D:\\b.editbay')
  })

  it('moves one already on the list to the top rather than listing it twice', () => {
    let s = emptyRecent()
    for (const p of ['D:\\a.editbay', 'D:\\b.editbay', 'D:\\c.editbay']) s = addRecent(s, p)
    s = addRecent(s, 'D:\\a.editbay')
    expect(s.projects).toEqual(['D:\\a.editbay', 'D:\\c.editbay', 'D:\\b.editbay'])
  })

  it('treats two spellings of one Windows path as the same project', () => {
    const s = addRecent(addRecent(emptyRecent(), 'D:\\Trips\\Holiday.editbay'), 'd:\\trips\\holiday.editbay')
    expect(s.projects).toEqual(['d:\\trips\\holiday.editbay'])
  })

  it('keeps only the ten most recent', () => {
    let s = emptyRecent()
    for (let i = 0; i < 14; i++) s = addRecent(s, `D:\\p${i}.editbay`)
    expect(s.projects).toHaveLength(MAX_RECENT)
    expect(s.projects[0]).toBe('D:\\p13.editbay')
    expect(s.projects.at(-1)).toBe('D:\\p4.editbay')
  })
})

describe('dropping a project that has gone', () => {
  it('takes it off the list', () => {
    let s = addRecent(addRecent(emptyRecent(), 'D:\\a.editbay'), 'D:\\b.editbay')
    s = forgetRecent(s, 'D:\\A.EDITBAY')
    expect(s.projects).toEqual(['D:\\b.editbay'])
    expect(s.last).toBe('D:\\b.editbay')
  })

  it('stops the app trying to reopen it', () => {
    const s = forgetRecent(addRecent(emptyRecent(), 'D:\\a.editbay'), 'D:\\a.editbay')
    expect(s.last).toBeNull()
  })
})

describe('the last project open', () => {
  it('becomes nothing for a new project, leaving the list alone', () => {
    const s = setLast(addRecent(emptyRecent(), 'D:\\a.editbay'), null)
    expect(s.last).toBeNull()
    expect(s.projects).toEqual(['D:\\a.editbay'])
  })
})

describe('reading what was stored', () => {
  it('keeps a good list as it was', () => {
    const s = { projects: ['D:\\a.editbay', 'D:\\b.editbay'], last: 'D:\\a.editbay' }
    expect(sanitiseRecent(s)).toEqual(s)
  })

  it('makes a list the app can trust from anything at all', () => {
    for (const junk of [null, 'x', 42, [], { projects: 'no' }, { projects: [1, null, ''], last: 5 }]) {
      expect(sanitiseRecent(junk)).toEqual(emptyRecent())
    }
  })

  it('drops duplicates and anything past ten', () => {
    const many = Array.from({ length: 15 }, (_, i) => `D:\\p${i}.editbay`)
    const s = sanitiseRecent({ projects: ['D:\\p0.editbay', ...many] })
    expect(s.projects).toHaveLength(MAX_RECENT)
    expect(new Set(s.projects).size).toBe(MAX_RECENT)
  })
})

describe('on disk', () => {
  it('is an empty list when there is no file yet', async () => {
    expect(await loadRecent(recentPath(await workDir()))).toEqual(emptyRecent())
  })

  it('is an empty list when the file is damaged', async () => {
    const file = recentPath(await workDir())
    await writeFile(file, '{ not json')
    expect(await loadRecent(file)).toEqual(emptyRecent())
  })

  it('comes back as it was saved', async () => {
    const file = recentPath(await workDir())
    const s = addRecent(addRecent(emptyRecent(), 'D:\\a.editbay'), 'D:\\b.editbay')
    await saveRecent(file, s)
    expect(await loadRecent(file)).toEqual(s)
  })
})
