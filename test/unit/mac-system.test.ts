import { describe, it, expect } from 'vitest'
import { commandKey, zoomKey } from '../../src/shared/system'
import { joinIn, mayLoad, mayUse, pathKind, withUsablePaths } from '../../src/shared/source-paths'
import { comboFromEvent, comboFromMouse, formatCombo } from '../../src/shared/keymap'
import { forSystem } from '../../src/shared/tutorials'
import { fontFolders } from '../../src/main/fonts/system-fonts'
import type { ProjectMedia } from '../../src/shared/project'

// Plan 104: the rules that differ on a Mac, each tested with the system pinned, on any machine.

function key(code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) {
  return { code, ctrlKey: mods.ctrl ?? false, altKey: mods.alt ?? false, shiftKey: mods.shift ?? false, metaKey: mods.meta ?? false }
}

describe('paths on a Mac', () => {
  it('counts a path from the root as on this computer, on a Mac only', () => {
    expect(pathKind('/Users/me/Movies/a.mp4', 'mac')).toBe('local')
    expect(pathKind('/Users/me/Movies/a.mp4', 'windows')).toBe('other')
    expect(mayUse('/Volumes/Footage/a.mov', new Set(), 'mac')).toBe(true)
  })

  it('still treats two slashes as a share, and a drive path as local', () => {
    expect(pathKind('//host/share/a.mp4', 'mac')).toBe('share')
    expect(mayUse('//host/share/a.mp4', new Set(), 'mac')).toBe(false)
    expect(pathKind('C:\\a.mp4', 'mac')).toBe('local')
    expect(pathKind('/a\0b', 'mac')).toBe('other')
  })

  it('lets the window load the app and media from the Mac disk', () => {
    // The default system is the one running; on a Mac these load, on Windows they never did.
    expect(mayLoad('file:///Applications/Editbay.app/Contents/Resources/app.asar/out/renderer/index.html', new Set())).toBe(
      pathKind('/Applications', undefined) === 'local'
    )
  })

  it('joins a Mac folder with a forward slash and a Windows one with a backslash', () => {
    expect(joinIn('/Users/me/out', 'a.mp4')).toBe('/Users/me/out/a.mp4')
    expect(joinIn('/Users/me/out/', 'a.mp4')).toBe('/Users/me/out/a.mp4')
    expect(joinIn('C:\\out', 'a.mp4')).toBe('C:\\out\\a.mp4')
  })

  it('keeps a missing source in a Mac offline folder with a Mac path', () => {
    const m = { id: 'a', originalPath: '\\\\host\\share\\a.mp4', playablePath: '\\\\host\\share\\a.mp4', peaksPath: '', filmstripPath: '' } as ProjectMedia
    const out = withUsablePaths(m, { allowed: new Set(), offlineDir: '/Users/me/Library/Application Support/editbay/offline', cacheDir: '/Users/me/cache' })
    expect(out.originalPath).toBe('/Users/me/Library/Application Support/editbay/offline/a.mp4')
  })
})

describe('keys on a Mac', () => {
  it('reads Cmd as the Ctrl of a shortcut and Control as Meta', () => {
    expect(comboFromEvent(key('KeyS', { meta: true }), 'mac')).toBe('Ctrl+KeyS')
    expect(comboFromEvent(key('KeyS', { ctrl: true }), 'mac')).toBe('Meta+KeyS')
    expect(comboFromEvent(key('KeyZ', { meta: true, shift: true }), 'mac')).toBe('Ctrl+Shift+KeyZ')
    expect(comboFromEvent(key('KeyS', { ctrl: true }), 'windows')).toBe('Ctrl+KeyS')
  })

  it('reads the mouse buttons the same way', () => {
    expect(comboFromMouse({ button: 1, ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }, 'mac')).toBe('Ctrl+MouseMiddle')
  })

  it("shows a shortcut with the Mac's signs", () => {
    expect(formatCombo('Ctrl+KeyS', 'mac')).toBe('⌘S')
    expect(formatCombo('Ctrl+Shift+KeyZ', 'mac')).toBe('⇧⌘Z')
    expect(formatCombo('Ctrl+Alt+Shift+KeyC', 'mac')).toBe('⌥⇧⌘C')
    expect(formatCombo('Meta+KeyS', 'mac')).toBe('⌃S')
    expect(formatCombo('KeyS', 'mac')).toBe('S')
    expect(formatCombo('Shift+Space', 'mac')).toBe('⇧ Space')
    expect(formatCombo('Ctrl+KeyS', 'windows')).toBe('Ctrl+S')
  })

  it('takes Cmd for a click or drag with Ctrl, and Cmd or a pinch for zoom', () => {
    expect(commandKey({ ctrlKey: true, metaKey: false }, 'mac')).toBe(false)
    expect(commandKey({ ctrlKey: false, metaKey: true }, 'mac')).toBe(true)
    expect(commandKey({ ctrlKey: true, metaKey: false }, 'windows')).toBe(true)
    expect(zoomKey({ ctrlKey: true, metaKey: false }, 'mac')).toBe(true)
    expect(zoomKey({ ctrlKey: false, metaKey: true }, 'mac')).toBe(true)
    expect(zoomKey({ ctrlKey: false, metaKey: true }, 'windows')).toBe(false)
  })
})

describe('tutorials on a Mac', () => {
  it('name the Mac keys', () => {
    expect(forSystem('Press `Ctrl+K`, or `Alt+K` on a clip.', 'mac')).toBe('Press `Cmd+K`, or `Option+K` on a clip.')
    expect(forSystem('| `Home` `End` | Start and end |', 'mac')).toBe('| `Home` `End` (`Cmd+←` `Cmd+→`) | Start and end |')
    expect(forSystem('Press `Ctrl+K`.', 'windows')).toBe('Press `Ctrl+K`.')
  })
})

describe('fonts on a Mac', () => {
  it("reads the system's, every user's and this user's folders", () => {
    expect(fontFolders({ HOME: '/Users/me' }, 'darwin')).toEqual([
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      expect.stringMatching(/Users.me.Library.Fonts$/)
    ])
  })
})
