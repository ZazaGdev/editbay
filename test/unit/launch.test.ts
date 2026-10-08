import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { projectPathFromArgs } from '../../src/main/project/launch'

describe('the project file the app was started with', () => {
  it('is found when Windows passes it after the program', () => {
    expect(projectPathFromArgs(['C:\\Apps\\Editbay.exe', 'D:\\trips\\holiday.editbay'], 'C:\\')).toBe(
      resolve('D:\\trips\\holiday.editbay')
    )
  })

  it('is found in a development launch, after the app folder', () => {
    const argv = ['electron.exe', '.', '--user-data-dir=C:\\tmp\\x', 'D:\\a.editbay']
    expect(projectPathFromArgs(argv, 'C:\\')).toBe(resolve('D:\\a.editbay'))
  })

  it('ignores the switches Chromium adds', () => {
    const argv = ['Editbay.exe', 'D:\\a.editbay', '--allow-file-access-from-files', '--original-process-start-time=1']
    expect(projectPathFromArgs(argv, 'C:\\')).toBe(resolve('D:\\a.editbay'))
  })

  it('does not mistake the program itself for a project', () => {
    expect(projectPathFromArgs(['D:\\odd.editbay'], 'C:\\')).toBeNull()
  })

  it('takes a relative path from the folder the launch came from', () => {
    expect(projectPathFromArgs(['Editbay.exe', 'holiday.editbay'], 'D:\\trips')).toBe(resolve('D:\\trips', 'holiday.editbay'))
  })

  it('does not care about the case of the extension', () => {
    expect(projectPathFromArgs(['Editbay.exe', 'D:\\A.EDITBAY'], 'C:\\')).toBe(resolve('D:\\A.EDITBAY'))
  })

  it('does not open the extensions the app used before it was renamed', () => {
    expect(projectPathFromArgs(['Editbay.exe', 'D:\\trips\\holiday.clipper'], 'C:\\')).toBeNull()
    expect(projectPathFromArgs(['Editbay.exe', 'D:\\trips\\holiday.cutroom'], 'C:\\')).toBeNull()
  })

  it('is nothing for a plain launch', () => {
    expect(projectPathFromArgs(['Editbay.exe'], 'C:\\')).toBeNull()
    expect(projectPathFromArgs(['electron.exe', '.', '--user-data-dir=C:\\tmp'], 'C:\\')).toBeNull()
    expect(projectPathFromArgs(['Editbay.exe', 'D:\\video.mp4'], 'C:\\')).toBeNull()
  })
})
