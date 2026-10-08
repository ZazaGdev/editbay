import { describe, it, expect, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { isUnderTest, quietAnswer, quietDialogs, quietShell, quitWithParent, QUIET } from '../../src/main/test-mode'
import type { Dialog } from 'electron'

describe('the test switch (task 18)', () => {
  it('is on only when the tests set it, and never in the installed app', () => {
    expect(isUnderTest({ EDITBAY_UNDER_TEST: '1' }, false)).toBe(true)
    expect(isUnderTest({ EDITBAY_UNDER_TEST: '1' }, true)).toBe(false)
    expect(isUnderTest({}, false)).toBe(false)
    expect(isUnderTest({ EDITBAY_UNDER_TEST: 'yes' }, false)).toBe(false)
  })
})

describe('a question nobody is there to answer', () => {
  it("gets Don't save when it offers it, so closing never saves a test's work", () => {
    expect(quietAnswer({ buttons: ['Save', "Don't save", 'Cancel'], cancelId: 2 })).toBe(1)
  })

  it('otherwise backs out', () => {
    expect(quietAnswer({ buttons: ['Keep working', 'Lose them'], cancelId: 0 })).toBe(0)
    expect(quietAnswer({ buttons: ['Open', 'Not now'] })).toBe(1)
    expect(quietAnswer({ buttons: ['OK'] })).toBe(0)
  })

  it('is answered on the spot for every kind of dialog, each marked as a stand-in', async () => {
    const dialog = {} as Dialog
    quietDialogs(dialog)
    expect(await dialog.showMessageBox({ message: 'Save changes?', buttons: ['Save', "Don't save", 'Cancel'], cancelId: 2 })).toEqual({ response: 1, checkboxChecked: false })
    expect(dialog.showMessageBoxSync({ message: 'Sure?', buttons: ['Yes', 'No'], cancelId: 1 })).toBe(1)
    expect((await dialog.showOpenDialog({})).canceled).toBe(true)
    expect((await dialog.showSaveDialog({})).canceled).toBe(true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dialog.showErrorBox('ffmpeg is unusable', 'missing')
    expect(error).toHaveBeenCalledWith('ffmpeg is unusable: missing')
    error.mockRestore()
    for (const name of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showSaveDialog', 'showErrorBox'] as const) {
      expect((dialog[name] as unknown as Record<symbol, unknown>)[QUIET], name).toBe(true)
    }
  })
})

describe('an app started by a test run', () => {
  it('quits once the run that started it is gone, and not before', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
    const quit = vi.fn()
    const stop = quitWithParent(child.pid!, quit, 50)
    await new Promise((r) => setTimeout(r, 200))
    expect(quit).not.toHaveBeenCalled()
    child.kill()
    await new Promise((r) => setTimeout(r, 400))
    expect(quit).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('quietShell', () => {
  it('opens nothing outside the app, and keeps what it would have opened', async () => {
    const shell = {
      openPath: async (_path: string) => 'real',
      showItemInFolder: (_path: string) => {
        throw new Error('opened Explorer')
      },
      openExternal: async (_url: string) => {
        throw new Error('opened the browser')
      }
    }
    quietShell(shell)
    expect(await shell.openPath('C:\out\a.mp4')).toBe('')
    shell.showItemInFolder('C:\out\a.mp4')
    await shell.openExternal('https://example.com/pack')
    expect((globalThis as { editbayQuietShell?: string[] }).editbayQuietShell).toEqual([
      'C:\out\a.mp4',
      'C:\out\a.mp4',
      'https://example.com/pack'
    ])
  })
})
