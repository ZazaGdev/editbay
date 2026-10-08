import { describe, it, expect, afterAll } from 'vitest'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import {
  registerFileType,
  isRegistered,
  defaultValueFrom,
  PROG_ID
} from '../../src/main/settings/file-association'

/**
 * The association written through the real reg.exe, under a key of its own
 * rather than the real file types, so running the tests never changes what
 * double-clicking a project does.
 */

const ROOT = 'HKCU\\Software\\Editbay Test Classes'
const EXE = 'G:\\Some Folder\\with & odd (chars)\\Editbay.exe'

afterAll(async () => {
  await capture('reg', ['delete', ROOT, '/f']).catch(() => undefined)
})

describe.skipIf(process.platform !== 'win32')('registering .editbay files', () => {
  it('writes the association, with the quotes and the file placeholder intact', async () => {
    expect(await isRegistered(EXE, ROOT)).toBe(false)
    expect(await registerFileType(EXE, ROOT)).toBe(true)

    const command = await captureText('reg', ['query', `${ROOT}\\${PROG_ID}\\shell\\open\\command`, '/ve'])
    expect(defaultValueFrom(command)).toBe(`"${EXE}" "%1"`)
    const ext = await captureText('reg', ['query', `${ROOT}\\.editbay`, '/ve'])
    expect(defaultValueFrom(ext)).toBe(PROG_ID)
  })

  it('does not write again when nothing has changed', async () => {
    expect(await isRegistered(EXE, ROOT)).toBe(true)
    expect(await registerFileType(EXE, ROOT)).toBe(false)
  })

  it('follows the program when it has moved', async () => {
    const moved = 'D:\\Elsewhere\\Editbay.exe'
    expect(await isRegistered(moved, ROOT)).toBe(false)
    expect(await registerFileType(moved, ROOT)).toBe(true)
    expect(await isRegistered(moved, ROOT)).toBe(true)
    expect(await isRegistered(EXE, ROOT)).toBe(false)
  })
})
