import { describe, it, expect } from 'vitest'
import {
  associationEntries,
  regAddArgs,
  defaultValueFrom,
  shouldRegisterFileType,
  CLASSES_ROOT,
  PROG_ID
} from '../../src/main/settings/file-association'

const EXE = 'G:\\Side Projects\\release\\win-unpacked\\Editbay.exe'

describe('what the association writes', () => {
  const entries = associationEntries(EXE)

  it('points the extension at the same class the installer uses', () => {
    expect(entries[0]).toEqual({ key: `${CLASSES_ROOT}\\.editbay`, name: null, type: 'REG_SZ', data: PROG_ID })
    expect(PROG_ID).toBe('Editbay project')
  })

  it('opens a file by passing its path, quoted, to the running program', () => {
    const command = entries.find((e) => e.key.endsWith('\\shell\\open\\command'))
    expect(command?.data).toBe(`"${EXE}" "%1"`)
  })

  it('gives the files the program icon', () => {
    expect(entries.find((e) => e.key.endsWith('\\DefaultIcon'))?.data).toBe(`"${EXE}",0`)
  })

  it('lists Editbay under Open with', () => {
    expect(entries).toContainEqual({
      key: `${CLASSES_ROOT}\\.editbay\\OpenWithProgids`,
      name: PROG_ID,
      type: 'REG_NONE',
      data: ''
    })
  })

  it('claims nothing but the project extension', () => {
    const claimed = entries.filter((e) => e.key.includes(`${CLASSES_ROOT}\\.`)).map((e) => e.key)
    expect(claimed.every((k) => k.includes('\\.editbay'))).toBe(true)
  })

  it('describes the type once, however many extensions point at it', () => {
    expect(entries.filter((e) => e.key.endsWith('\\shell\\open\\command'))).toHaveLength(1)
    expect(entries.filter((e) => e.key.endsWith('\\DefaultIcon'))).toHaveLength(1)
  })

  it('stays inside the current user, which needs no administrator rights', () => {
    for (const e of entries) expect(e.key.startsWith('HKCU\\')).toBe(true)
  })

  it('can be pointed somewhere else, for testing', () => {
    for (const e of associationEntries(EXE, 'HKCU\\Software\\Test')) expect(e.key.startsWith('HKCU\\Software\\Test\\')).toBe(true)
  })
})

describe('the arguments reg is given', () => {
  it('write a default value', () => {
    expect(regAddArgs({ key: 'HKCU\\X', name: null, type: 'REG_SZ', data: '"a b" "%1"' })).toEqual([
      'add', 'HKCU\\X', '/ve', '/t', 'REG_SZ', '/d', '"a b" "%1"', '/f'
    ])
  })

  it('write a named value', () => {
    expect(regAddArgs({ key: 'HKCU\\X', name: 'Editbay project', type: 'REG_NONE', data: '' })).toEqual([
      'add', 'HKCU\\X', '/v', 'Editbay project', '/t', 'REG_NONE', '/d', '', '/f'
    ])
  })
})

describe('reading a default value back', () => {
  it('finds it in what reg query prints', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Software\\Classes\\Editbay project\\shell\\open\\command',
      '    (Default)    REG_SZ    "G:\\a b\\Editbay.exe" "%1"',
      ''
    ].join('\r\n')
    expect(defaultValueFrom(out)).toBe('"G:\\a b\\Editbay.exe" "%1"')
  })

  it('does not depend on the English label for the default value', () => {
    expect(defaultValueFrom('HKEY_CURRENT_USER\\X\r\n    (Standard)    REG_SZ    Editbay project\r\n')).toBe('Editbay project')
  })

  it('is nothing when the key has no default value', () => {
    expect(defaultValueFrom('HKEY_CURRENT_USER\\X\r\n    (Default)    REG_SZ    \r\n')).toBe('')
    expect(defaultValueFrom('HKEY_CURRENT_USER\\X\r\n')).toBeNull()
  })
})

describe('which launches claim .editbay files', () => {
  it('the real app, started from its shortcut or a double-click', () => {
    expect(shouldRegisterFileType(true, ['C:\\Editbay.exe'])).toBe(true)
    expect(shouldRegisterFileType(true, ['C:\\Editbay.exe', 'D:\\holiday.editbay'])).toBe(true)
  })

  it('not a development run, which is Electron itself', () => {
    expect(shouldRegisterFileType(false, ['electron.exe', '.'])).toBe(false)
  })

  it('not a test run, which always brings a settings folder of its own', () => {
    expect(shouldRegisterFileType(true, ['C:\\Editbay.exe', '--user-data-dir=C:\\tmp\\x'])).toBe(false)
    expect(shouldRegisterFileType(true, ['C:\\Editbay.exe', '--user-data-dir', 'C:\\tmp\\x'])).toBe(false)
  })
})
