import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chooseRecovery,
  recoveryFileName,
  writeRecovery,
  listRecovery,
  readRecoveryDocument,
  removeRecovery,
  setAside,
  type RecoveryCopy
} from '../../src/main/project/recovery'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { createProject } from '../../src/shared/project'
import { defaultWorkspace } from '../../src/shared/workspace'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-recovery-'))
  dirs.push(dir)
  return dir
}

function copy(recoveryOf: string | null, writtenAt: number, name = 'p', held = false): RecoveryCopy {
  return { file: `R:\\${recoveryFileName(recoveryOf)}`, recoveryOf, name, writtenAt, held }
}

/** Which copies their project file already holds exactly, by copy. */
function holding(...held: RecoveryCopy[]): (c: RecoveryCopy) => boolean {
  return (c) => held.includes(c)
}

describe('which copy to offer at launch', () => {
  it('offers nothing when there are no copies', () => {
    expect(chooseRecovery([], holding())).toEqual({ offer: null, stale: [] })
  })

  it('offers a copy whose work its project file does not hold', () => {
    const c = copy('D:\\holiday.editbay', 2000)
    expect(chooseRecovery([c], holding()).offer).toBe(c)
  })

  it('does not offer a copy whose work was saved, and calls it stale', () => {
    const c = copy('D:\\holiday.editbay', 1000)
    const choice = chooseRecovery([c], holding(c))
    expect(choice.offer).toBeNull()
    expect(choice.stale).toEqual([c])
  })

  it('goes by what the two hold, not by the clock: a copy written after the file is stale if the file holds its work', () => {
    // A NAS whose clock runs slow: the file looks older than the copy, but holds its work.
    const c = copy('D:\\holiday.editbay', 9_000_000)
    expect(chooseRecovery([c], holding(c)).stale).toEqual([c])
  })

  it('offers a copy of a project that was never saved', () => {
    const c = copy(null, 500)
    expect(chooseRecovery([c], holding()).offer).toBe(c)
  })

  it('offers the newest when several are worth offering', () => {
    const older = copy(null, 1000)
    const newer = copy('D:\\holiday.editbay', 3000)
    const choice = chooseRecovery([older, newer], holding())
    expect(choice.offer).toBe(newer)
    // The other is not stale: it is still work that was never saved.
    expect(choice.stale).toEqual([])
  })

  it('keeps offering a copy set aside earlier, even when its work was saved since', () => {
    // Offered at the last launch, not answered: only you can decide the copy is no longer wanted.
    const held = copy('D:\\holiday.editbay', 1000, 'holiday', true)
    const choice = chooseRecovery([held], holding(held))
    expect(choice.offer).toBe(held)
    expect(choice.stale).toEqual([])
  })

  it('never offers a stale copy against a different project', () => {
    const stale = copy('D:\\a.editbay', 1000)
    const live = copy('D:\\b.editbay', 1500)
    const choice = chooseRecovery([stale, live], holding(stale))
    expect(choice.offer).toBe(live)
    expect(choice.stale).toEqual([stale])
  })
})

describe('where copies are written', () => {
  it('gives one project the same file every time, whatever the case of its path', () => {
    expect(recoveryFileName('D:\\Trips\\Holiday.editbay')).toBe(recoveryFileName('d:\\trips\\holiday.editbay'))
  })

  it('gives different projects different files', () => {
    expect(recoveryFileName('D:\\a.editbay')).not.toBe(recoveryFileName('D:\\b.editbay'))
    expect(recoveryFileName('D:\\a.editbay')).not.toBe(recoveryFileName(null))
  })

  it('never uses the project file itself', () => {
    expect(recoveryFileName('D:\\a.editbay')).not.toMatch(/\.editbay$/)
  })
})

describe('writing and reading copies', () => {
  it('reads back the project, the workspace and who it belongs to', async () => {
    const dir = await workDir()
    const project = createProject('holiday', 30, { width: 1080, height: 1920 })
    const ws = { ...defaultWorkspace(), aspectLocked: false }
    const file = await writeRecovery(
      dir,
      { recoveryOf: 'D:\\holiday.editbay', name: 'holiday', writtenAt: 1234 },
      joinProjectFile(project, ws)
    )

    const listed = await listRecovery(dir)
    expect(listed).toEqual([{ file, recoveryOf: 'D:\\holiday.editbay', name: 'holiday', writtenAt: 1234, held: false }])

    const back = splitProjectFile(await readRecoveryDocument(file))
    expect(back.project).toEqual(project)
    expect(back.workspace).toEqual(ws)
  })

  it('replaces the previous copy of the same project rather than adding another', async () => {
    const dir = await workDir()
    const text = joinProjectFile(createProject('x', 30, { width: 1080, height: 1920 }), defaultWorkspace())
    await writeRecovery(dir, { recoveryOf: null, name: 'x', writtenAt: 1 }, text)
    await writeRecovery(dir, { recoveryOf: null, name: 'x', writtenAt: 2 }, text)
    const listed = await listRecovery(dir)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.writtenAt).toBe(2)
  })

  it('skips a file it cannot read instead of failing', async () => {
    const dir = await workDir()
    await writeFile(join(dir, 'broken.editbay-recovery'), '{ half written')
    await writeFile(join(dir, 'unrelated.txt'), 'hello')
    expect(await listRecovery(dir)).toEqual([])
  })

  it('finds nothing in a folder that does not exist yet', async () => {
    expect(await listRecovery(join(await workDir(), 'never-made'))).toEqual([])
  })

  it('removes a copy, and removing it twice is fine', async () => {
    const dir = await workDir()
    const text = joinProjectFile(createProject('x', 30, { width: 1080, height: 1920 }), defaultWorkspace())
    const file = await writeRecovery(dir, { recoveryOf: null, name: 'x', writtenAt: 1 }, text)
    await removeRecovery(file)
    await removeRecovery(file)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('setting an offered copy aside', () => {
  it('moves it out of the autosave slot, where a new copy of the same project can go', async () => {
    const dir = await workDir()
    const text = joinProjectFile(createProject('x', 30, { width: 1080, height: 1920 }), defaultWorkspace())
    const first = await writeRecovery(dir, { recoveryOf: 'D:\\x.editbay', name: 'x', writtenAt: 100 }, text)
    const [listed] = await listRecovery(dir)
    const held = await setAside(listed!)
    expect(held.held).toBe(true)
    expect(held.file).not.toBe(first)

    // Autosave writes the same project again: the offered copy is untouched.
    await writeRecovery(dir, { recoveryOf: 'D:\\x.editbay', name: 'x', writtenAt: 200 }, text)
    const after = await listRecovery(dir)
    expect(after.map((c) => [c.writtenAt, c.held]).sort()).toEqual([
      [100, true],
      [200, false]
    ])
  })

  it('leaves a copy already set aside where it is', async () => {
    const held = copy(null, 5, 'x', true)
    expect(await setAside(held)).toBe(held)
  })
})
