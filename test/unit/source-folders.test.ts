import { describe, it, expect } from 'vitest'
import {
  addFolder,
  addRecordings,
  changeFolder,
  cleanSourceFolders,
  effectsFolderOf,
  setEffectsFolder,
  folderNameOf,
  moveFolder,
  removeFolder,
  renameFolder,
  restoreFolder,
  MAX_FOLDER_NAME,
  type SourceFolder
} from '../../src/shared/source-folders'

/**
 * Plan 71: your own folders in Sources, each a name and a folder on disk,
 * kept with the app's settings. The edits are pure, so an Undo is putting
 * back what was there.
 */

const recordings: SourceFolder = { id: 'recordings', name: 'Recordings', kind: 'recordings', folder: null, newestFirst: true }
const music: SourceFolder = { id: 'm', name: 'Music', kind: 'folder', folder: 'E:\\Music', newestFirst: false }
let n = 0
const ids = (): string => `id${++n}`

describe('your folders in Sources', () => {
  it('names a new one after its folder, at the end', () => {
    expect(addFolder([recordings], 'D:\\Stuff\\Sound effects\\', ids).at(-1)).toMatchObject({ name: 'Sound effects', kind: 'folder', folder: 'D:\\Stuff\\Sound effects\\' })
    expect(folderNameOf('E:\\')).toBe('E:')
  })

  it('renames one, trimmed and not too long, and ignores an empty name', () => {
    expect(renameFolder([music], 'm', '  Songs   I  like ')[0]!.name).toBe('Songs I like')
    expect(renameFolder([music], 'm', 'x'.repeat(200))[0]!.name).toHaveLength(MAX_FOLDER_NAME)
    expect(renameFolder([music], 'm', '   ')[0]!.name).toBe('Music')
  })

  it('points one at another folder', () => {
    expect(changeFolder([music], 'm', 'F:\\Tunes')[0]!.folder).toBe('F:\\Tunes')
  })

  it('takes one out and puts it back where it was', () => {
    const list = [recordings, music, { ...music, id: 'v', name: 'Video' }]
    const { list: left, removed, at } = removeFolder(list, 'm')
    expect(left.map((f) => f.id)).toEqual(['recordings', 'v'])
    expect(restoreFolder(left, removed!, at)).toEqual(list)
    // Not twice.
    expect(restoreFolder(list, removed!, at)).toEqual(list)
  })

  it('moves one to another place in the list', () => {
    const list = [recordings, music, { ...music, id: 'v' }]
    expect(moveFolder(list, 'v', 0).map((f) => f.id)).toEqual(['v', 'recordings', 'm'])
    expect(moveFolder(list, 'recordings', 5).map((f) => f.id)).toEqual(['m', 'v', 'recordings'])
  })

  it('has Recordings back at the top only when it has been taken out', () => {
    expect(addRecordings([music])[0]).toMatchObject({ kind: 'recordings', folder: null })
    expect(addRecordings([recordings, music])).toHaveLength(2)
  })

  it('keeps what is right from a settings file, and drops what is not', () => {
    expect(
      cleanSourceFolders([
        recordings,
        { ...recordings, id: 'r2' },
        music,
        { ...music },
        { id: 'x', kind: 'folder', folder: '' },
        { id: 'y', kind: 'drive', folder: 'C:\\' },
        'nonsense',
        { id: 'z', kind: 'folder', folder: 'D:\\Clips', name: '' }
      ])
    ).toEqual([recordings, music, { id: 'z', name: 'Clips', kind: 'folder', folder: 'D:\\Clips', newestFirst: false }])
    expect(cleanSourceFolders('nope')).toEqual([])
  })
})

describe('the effects folder (plan 90)', () => {
  const recordings: SourceFolder = { id: 'recordings', name: 'Recordings', kind: 'recordings', folder: null, newestFirst: true }
  const music: SourceFolder = { id: 'm', name: 'Music', kind: 'folder', folder: 'D:\Music', newestFirst: false }

  it('is set after Recordings, pointed elsewhere, and taken out, one at most', () => {
    let list = setEffectsFolder([recordings, music], 'D:\FX')
    expect(list.map((f) => f.kind)).toEqual(['recordings', 'effects', 'folder'])
    expect(effectsFolderOf(list)).toMatchObject({ name: 'Assets', folder: 'D:\FX' })
    list = setEffectsFolder(list, 'E:\Packs')
    expect(list.filter((f) => f.kind === 'effects')).toHaveLength(1)
    expect(effectsFolderOf(list)?.folder).toBe('E:\Packs')
    list = setEffectsFolder(list, null)
    expect(effectsFolderOf(list)).toBeNull()
    expect(list).toEqual([recordings, music])
  })

  it('goes first when there is no Recordings', () => {
    expect(setEffectsFolder([music], 'D:\FX').map((f) => f.kind)).toEqual(['effects', 'folder'])
  })

  it('is kept by the settings file, the first only, and never without a folder', () => {
    const kept = cleanSourceFolders([
      { id: 'a', name: '', kind: 'effects', folder: 'D:\FX', newestFirst: false },
      { id: 'b', name: 'More', kind: 'effects', folder: 'D:\More', newestFirst: false },
      { id: 'c', name: 'None', kind: 'effects', folder: null, newestFirst: false }
    ])
    expect(kept).toEqual([{ id: 'a', name: 'Assets', kind: 'effects', folder: 'D:\FX', newestFirst: false }])
  })

  // Plan 96: the effects folder is the assets folder now, where it was.
  it('carries an effects folder over as the assets folder, renamed only while it had the old name', () => {
    const kept = cleanSourceFolders([{ id: 'a', name: 'Effects', kind: 'effects', folder: 'D:\FX', newestFirst: false }])
    expect(kept).toEqual([{ id: 'a', name: 'Assets', kind: 'effects', folder: 'D:\FX', newestFirst: false }])
    expect(cleanSourceFolders([{ id: 'a', name: 'My FX', kind: 'effects', folder: 'D:\FX', newestFirst: false }])[0]!.name).toBe('My FX')
  })
})
