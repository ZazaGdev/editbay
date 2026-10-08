import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadOverrides, saveOverrides, keymapPath } from '../../src/main/settings/keymap-store'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-keymap-'))
  dirs.push(dir)
  return dir
}

describe('the keymap store', () => {
  it('reads back what it saved', async () => {
    const path = keymapPath(await workDir())
    await saveOverrides(path, { split: ['KeyX'], undo: ['Ctrl+KeyU'] })
    expect(await loadOverrides(path)).toEqual({ split: ['KeyX'], undo: ['Ctrl+KeyU'] })
  })

  it('reads nothing when you have not changed any shortcuts', async () => {
    expect(await loadOverrides(keymapPath(await workDir()))).toEqual({})
  })

  it('starts on the defaults rather than failing when the file is corrupt', async () => {
    const path = keymapPath(await workDir())
    await writeFile(path, '{ this is not json')
    expect(await loadOverrides(path)).toEqual({})
  })

  it('keeps a corrupt file aside, so saving the defaults does not throw your shortcuts away', async () => {
    const path = keymapPath(await workDir())
    await writeFile(path, '{ "split": ["KeyX"], oops')
    expect(await loadOverrides(path)).toEqual({})
    await saveOverrides(path, {})
    const dir = dirname(path)
    const kept = (await readdir(dir)).filter((n) => n.endsWith('.bad'))
    expect(kept).toHaveLength(1)
    expect((await readFile(join(dir, kept[0]!))).toString()).toBe('{ "split": ["KeyX"], oops')
  })

  it('keeps a second corrupt file beside the first, not over it', async () => {
    const path = keymapPath(await workDir())
    await writeFile(path, 'first }')
    await loadOverrides(path)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeFile(path, 'second }')
    await loadOverrides(path)
    expect((await readdir(dirname(path))).filter((n) => n.endsWith('.bad'))).toHaveLength(2)
  })

  it('sets nothing aside when there is no file at all', async () => {
    const dir = await workDir()
    await loadOverrides(keymapPath(dir))
    expect(await readdir(dir)).toEqual([])
  })

  it('cleans a file that was edited by hand', async () => {
    const path = keymapPath(await workDir())
    await writeFile(path, JSON.stringify({ split: ['KeyX', 'Ctrl'], teleport: ['KeyT'], undo: 'Ctrl+KeyU' }))
    expect(await loadOverrides(path)).toEqual({ split: ['KeyX'] })
  })

  it('refuses to save rubbish, rather than writing it for next time', async () => {
    const path = keymapPath(await workDir())
    const saved = await saveOverrides(path, { split: ['KeyX', 'not a key'] } as never)
    expect(saved).toEqual({ split: ['KeyX'] })
    expect(JSON.parse((await readFile(path)).toString())).toEqual({ split: ['KeyX'] })
  })

  it('writes readable json, so it can be edited or copied by hand', async () => {
    const path = keymapPath(await workDir())
    await saveOverrides(path, { split: ['KeyX'] })
    expect((await readFile(path)).toString()).toContain('\n  ')
  })

  it('keeps an action you deliberately left with no key', async () => {
    const path = keymapPath(await workDir())
    await saveOverrides(path, { split: [] })
    expect(await loadOverrides(path)).toEqual({ split: [] })
  })
})
