import { describe, it, expect } from 'vitest'
import {
  ACTIONS,
  comboFromEvent,
  comboFromMouse,
  formatCombo,
  isValidCombo,
  resolveKeymap,
  buildLookup,
  findConflict,
  assignCombo,
  removeCombo,
  resetAction,
  isCustomised,
  sanitiseOverrides,
  keyLabel,
  withKey,
  type ActionId,
  type Overrides
} from '../../src/shared/keymap'

function key(code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) {
  return {
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false
  }
}

describe('the action list', () => {
  it('gives every action a unique id', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length)
  })

  it('ships defaults with no key doing two things', () => {
    const seen = new Map<string, string>()
    for (const a of ACTIONS) {
      for (const combo of a.defaults) {
        expect(seen.get(combo), `${combo} is on both ${seen.get(combo)} and ${a.id}`).toBeUndefined()
        seen.set(combo, a.id)
      }
    }
  })

  it('ships only well formed defaults', () => {
    for (const a of ACTIONS) for (const combo of a.defaults) expect(isValidCombo(combo)).toBe(true)
  })

  it('keeps the shortcuts that already existed', () => {
    const map = resolveKeymap({})
    expect(map.playPause).toContain('Space')
    expect(map.split).toContain('KeyS')
    expect(map.undo).toContain('Ctrl+KeyZ')
    expect(map.redo).toEqual(expect.arrayContaining(['Ctrl+KeyY', 'Ctrl+Shift+KeyZ']))
    expect(map.deleteClip).toEqual(expect.arrayContaining(['Delete', 'Backspace']))
    expect(map.save).toContain('Ctrl+KeyS')
  })
})

describe('comboFromEvent', () => {
  it('uses the physical key, so a different keyboard layout changes nothing', () => {
    // The S key reports code KeyS whatever letter the active layout puts on it.
    expect(comboFromEvent(key('KeyS'))).toBe('KeyS')
  })

  it('writes modifiers in one fixed order', () => {
    expect(comboFromEvent(key('KeyZ', { shift: true, ctrl: true }))).toBe('Ctrl+Shift+KeyZ')
    expect(comboFromEvent(key('KeyZ', { meta: true, alt: true, ctrl: true, shift: true }))).toBe(
      'Ctrl+Alt+Shift+Meta+KeyZ'
    )
  })

  it('ignores a modifier pressed on its own', () => {
    for (const code of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']) {
      expect(comboFromEvent(key(code, { shift: true }))).toBeNull()
    }
  })

  it('ignores a key the browser could not identify', () => {
    expect(comboFromEvent(key(''))).toBeNull()
    expect(comboFromEvent(key('Unidentified'))).toBeNull()
  })
})

describe('formatCombo', () => {
  it('shows letters and digits as themselves', () => {
    expect(formatCombo('KeyS')).toBe('S')
    expect(formatCombo('Digit7')).toBe('7')
  })

  it('shows modifiers in front', () => {
    expect(formatCombo('Ctrl+Shift+KeyZ')).toBe('Ctrl+Shift+Z')
  })

  it('shows arrows as arrows', () => {
    expect(formatCombo('ArrowLeft')).toBe('←')
    expect(formatCombo('Shift+ArrowRight')).toBe('Shift+→')
  })

  it('shows punctuation as the character', () => {
    expect(formatCombo('Equal')).toBe('=')
    expect(formatCombo('Minus')).toBe('-')
    expect(formatCombo('Ctrl+Slash')).toBe('Ctrl+/')
  })

  it('names the keys that have names', () => {
    expect(formatCombo('Space')).toBe('Space')
    expect(formatCombo('Delete')).toBe('Delete')
    expect(formatCombo('F5')).toBe('F5')
  })

  it('tells the number pad apart from the row above the letters', () => {
    expect(formatCombo('Numpad4')).toBe('Num 4')
    expect(formatCombo('Digit4')).toBe('4')
  })
})

describe('isValidCombo', () => {
  it('accepts what comboFromEvent produces', () => {
    expect(isValidCombo('Space')).toBe(true)
    expect(isValidCombo('Ctrl+Shift+KeyZ')).toBe(true)
  })

  it('rejects modifiers out of order, repeated, or on their own', () => {
    expect(isValidCombo('Shift+Ctrl+KeyZ')).toBe(false)
    expect(isValidCombo('Ctrl+Ctrl+KeyZ')).toBe(false)
    expect(isValidCombo('Ctrl')).toBe(false)
    expect(isValidCombo('Ctrl+ShiftLeft')).toBe(false)
  })

  it('rejects nonsense', () => {
    expect(isValidCombo('')).toBe(false)
    expect(isValidCombo('Ctrl+')).toBe(false)
    expect(isValidCombo('Hyper+KeyA')).toBe(false)
  })
})

describe('resolveKeymap', () => {
  it('fills everything you did not change from the defaults', () => {
    const map = resolveKeymap({ split: ['KeyX'] })
    expect(map.split).toEqual(['KeyX'])
    expect(map.playPause).toEqual(['Space'])
  })

  it('lets an action have no key at all', () => {
    expect(resolveKeymap({ split: [] }).split).toEqual([])
  })

  it('gives a key you chose priority over a default that used it', () => {
    // Binding Space to split must take it off play, or Space would mean both.
    const map = resolveKeymap({ split: ['Space'] })
    expect(map.split).toEqual(['Space'])
    expect(map.playPause).not.toContain('Space')
  })

  it('never lets one key mean two things, whatever the file says', () => {
    const map = resolveKeymap({ split: ['KeyQ'], undo: ['KeyQ'] })
    const owners = (Object.keys(map) as ActionId[]).filter((id) => map[id].includes('KeyQ'))
    expect(owners).toHaveLength(1)
  })

  it('gives every action an entry', () => {
    const map = resolveKeymap({})
    for (const a of ACTIONS) expect(Array.isArray(map[a.id])).toBe(true)
  })
})

describe('buildLookup', () => {
  it('finds the action for a key', () => {
    const lookup = buildLookup(resolveKeymap({}))
    expect(lookup.get('Space')).toBe('playPause')
    expect(lookup.get('Ctrl+KeyZ')).toBe('undo')
    expect(lookup.get('Ctrl+Shift+KeyZ')).toBe('redo')
  })

  it('finds nothing for a key that does nothing', () => {
    expect(buildLookup(resolveKeymap({})).get('KeyQ')).toBeUndefined()
  })

  it('follows a rebinding', () => {
    const lookup = buildLookup(resolveKeymap({ split: ['KeyX'] }))
    expect(lookup.get('KeyX')).toBe('split')
    expect(lookup.get('KeyS')).toBeUndefined()
  })
})

describe('findConflict', () => {
  const map = resolveKeymap({})

  it('names the action that already has a key', () => {
    expect(findConflict(map, 'Space', 'split')).toBe('playPause')
  })

  it('is not a conflict for the action that already has it', () => {
    expect(findConflict(map, 'Space', 'playPause')).toBeNull()
  })

  it('is not a conflict for a free key', () => {
    expect(findConflict(map, 'KeyQ', 'split')).toBeNull()
  })
})

describe('assignCombo', () => {
  it('adds a key to an action alongside the ones it has', () => {
    const map = resolveKeymap(assignCombo({}, 'split', 'KeyX'))
    expect(map.split).toEqual(expect.arrayContaining(['KeyS', 'KeyX']))
  })

  it('moves a key from whatever had it, so it still means one thing', () => {
    const overrides = assignCombo({}, 'split', 'Space')
    const map = resolveKeymap(overrides)
    expect(map.split).toContain('Space')
    expect(map.playPause).not.toContain('Space')
    expect(buildLookup(map).get('Space')).toBe('split')
  })

  it('does not add the same key twice', () => {
    const map = resolveKeymap(assignCombo(assignCombo({}, 'split', 'KeyX'), 'split', 'KeyX'))
    expect(map.split.filter((c) => c === 'KeyX')).toHaveLength(1)
  })

  it('stores nothing when the result is just the default', () => {
    expect(assignCombo({}, 'split', 'KeyS')).toEqual({})
  })

  it('refuses a malformed key rather than saving it', () => {
    expect(() => assignCombo({}, 'split', 'Ctrl')).toThrow(/not a valid shortcut/i)
  })
})

describe('removeCombo', () => {
  it('takes a key off an action', () => {
    const map = resolveKeymap(removeCombo({}, 'deleteClip', 'Backspace'))
    expect(map.deleteClip).toEqual(['Delete'])
  })

  it('can leave an action with no key', () => {
    const map = resolveKeymap(removeCombo({}, 'split', 'KeyS'))
    expect(map.split).toEqual([])
    expect(buildLookup(map).get('KeyS')).toBeUndefined()
  })
})

describe('resetAction', () => {
  it('puts the defaults back', () => {
    const changed = assignCombo(removeCombo({}, 'split', 'KeyS'), 'split', 'KeyX')
    const map = resolveKeymap(resetAction(changed, 'split'))
    expect(map.split).toEqual(['KeyS'])
  })

  it('takes its default keys back from wherever they went', () => {
    // Space moved to split, then play is reset: Space must mean play again, and
    // only play, rather than being claimed twice.
    const moved = assignCombo({}, 'split', 'Space')
    const map = resolveKeymap(resetAction(moved, 'playPause'))
    expect(map.playPause).toEqual(['Space'])
    expect(map.split).not.toContain('Space')
  })

  it('reports an action as customised until it is reset', () => {
    const changed = assignCombo({}, 'split', 'KeyX')
    expect(isCustomised(changed, 'split')).toBe(true)
    expect(isCustomised(resetAction(changed, 'split'), 'split')).toBe(false)
  })
})

describe('sanitiseOverrides', () => {
  it('keeps a well formed file as it is', () => {
    const good: Overrides = { split: ['KeyX'], undo: ['Ctrl+KeyU'] }
    expect(sanitiseOverrides(good)).toEqual(good)
  })

  it('drops actions that do not exist, which an older or newer version may have saved', () => {
    expect(sanitiseOverrides({ split: ['KeyX'], teleport: ['KeyT'] })).toEqual({ split: ['KeyX'] })
  })

  it('drops keys that are not well formed', () => {
    expect(sanitiseOverrides({ split: ['KeyX', 'Ctrl', 42, 'Shift+Ctrl+KeyA'] })).toEqual({ split: ['KeyX'] })
  })

  it('survives a file that is not a keymap at all', () => {
    expect(sanitiseOverrides(null)).toEqual({})
    expect(sanitiseOverrides('nope')).toEqual({})
    expect(sanitiseOverrides([1, 2, 3])).toEqual({})
    expect(sanitiseOverrides({ split: 'KeyX' })).toEqual({})
  })
})

describe('naming keys in tooltips', () => {
  const map = resolveKeymap({})

  it('names the first key an action is on, as a person reads it', () => {
    expect(keyLabel(map, 'save')).toBe('Ctrl+S')
    expect(keyLabel(map, 'redo')).toBe('Ctrl+Y')
  })

  it('adds the key to a tooltip, and leaves a tooltip alone for an action with none', () => {
    expect(withKey('Save', map, 'save')).toBe('Save (Ctrl+S)')
    const none = resolveKeymap({ save: [] })
    expect(withKey('Save', none, 'save')).toBe('Save')
  })

  it('follows a key you changed', () => {
    expect(withKey('Save', resolveKeymap({ save: ['Ctrl+Alt+KeyW'] }), 'save')).toBe('Save (Ctrl+Alt+W)')
  })
})

describe('clearing the selection', () => {
  it('is on Escape, which no other action uses', () => {
    const map = resolveKeymap({})
    expect(map.deselect).toEqual(['Escape'])
    expect(buildLookup(map).get('Escape')).toBe('deselect')
  })
})

describe('exporting', () => {
  it('opens the Export dialog on Ctrl+E, which no other action uses', () => {
    const map = resolveKeymap({})
    expect(map.export).toEqual(['Ctrl+KeyE'])
    expect(buildLookup(map).get('Ctrl+KeyE')).toBe('export')
  })
})

describe('recording a voice over', () => {
  it('starts and stops on R, which no other action uses', () => {
    const map = resolveKeymap({})
    expect(map.recordVoice).toEqual(['KeyR'])
    expect(buildLookup(map).get('KeyR')).toBe('recordVoice')
  })
})

describe('a shortcut on a mouse button', () => {
  const press = (button: number, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
    comboFromMouse({ button, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

  it('is made from the middle and side buttons, never the left or right', () => {
    expect(press(1)).toBe('MouseMiddle')
    expect(press(3)).toBe('MouseBack')
    expect(press(4, { ctrlKey: true })).toBe('Ctrl+MouseForward')
    expect(press(0)).toBeNull()
    expect(press(2)).toBeNull()
  })

  it('is a valid shortcut, kept when saved, and read as its button', () => {
    expect(isValidCombo('Shift+MouseBack')).toBe(true)
    expect(sanitiseOverrides({ addText: ['MouseBack'] })).toEqual({ addText: ['MouseBack'] })
    expect(formatCombo('Shift+MouseMiddle')).toBe('Shift+Middle mouse button')
    const next = assignCombo({}, 'addText', 'MouseForward')
    expect(buildLookup(resolveKeymap(next)).get('MouseForward')).toBe('addText')
  })
})
