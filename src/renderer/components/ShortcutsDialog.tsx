import { useEffect, useState, type JSX } from 'react'
import {
  ACTIONS,
  GROUPS,
  actionLabel,
  assignCombo,
  comboFromEvent,
  comboFromMouse,
  findConflict,
  formatCombo,
  isCustomised,
  removeCombo,
  resetAction,
  type ActionId,
  type Keymap,
  type Overrides
} from '../../shared/keymap'
import { surface, ink, accent, meaning, wash, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { SectionLabel } from '../ui/SectionLabel'
import { HelpTip } from '../ui/HelpTip'

/** A key pressed while recording that something else already has. */
interface Clash {
  combo: string
  owner: ActionId
}

const chip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: space.xs,
  font: type.monoSmall,
  color: ink.secondary,
  background: surface.control,
  border: `1px solid ${surface.lineStrong}`,
  borderRadius: radius.chip,
  padding: '1px 2px 1px 6px'
} as const

/**
 * Where you change your shortcuts.
 *
 * Adding a key listens for the next keypress. While it listens, it takes the
 * key before the editor can, or pressing Space to bind it would also start
 * playback. A key already in use asks before moving, because moving it takes
 * it off the other action.
 *
 * That question is asked on the row being recorded, and the row goes on
 * listening while it is up: press another key and that one is tried instead,
 * Enter takes the key off the other action, Escape gives up. It used to be a
 * bar at the top of the window that stopped every key until it was answered,
 * which from the row you were looking at was indistinguishable from the key
 * being refused. Shift+I is already Mark In, and that is what the owner hit.
 */
export function ShortcutsDialog(props: {
  overrides: Overrides
  keymap: Keymap
  onChange: (next: Overrides) => void
  onClose: () => void
}): JSX.Element {
  const [recording, setRecording] = useState<ActionId | null>(null)
  const [clash, setClash] = useState<Clash | null>(null)

  /** Give the action being recorded a key, and stop listening. */
  const take = (actionId: ActionId, combo: string): void => {
    props.onChange(assignCombo(props.overrides, actionId, combo))
    setClash(null)
    setRecording(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!recording) {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          props.onClose()
        }
        return
      }

      // Recording: this keypress is the new shortcut, not a command.
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setClash(null)
        return
      }

      // A clash is showing and a bare Enter answers it. Enter with a modifier
      // is a shortcut like any other, and Enter on its own is bindable again
      // as soon as the clash has gone.
      if (clash && e.code === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        take(recording, clash.combo)
        return
      }

      const combo = comboFromEvent(e)
      if (!combo) return

      const owner = findConflict(props.keymap, combo, recording)
      if (owner) {
        // Still listening. Another key is tried instead of this one, which is
        // what a hand reaching for a free combination does next.
        setClash({ combo, owner })
        return
      }
      take(recording, combo)
    }

    // Capture, so the editor's own handler never sees a key meant for here.
    window.addEventListener('keydown', onKey, true)
    // A mouse's middle or side button is a shortcut like a key, taken the same
    // way while recording. The left and right buttons still click.
    const onButton = (e: PointerEvent): void => {
      if (!recording) return
      const combo = comboFromMouse(e)
      if (!combo) return
      e.preventDefault()
      e.stopPropagation()
      const owner = findConflict(props.keymap, combo, recording)
      if (owner) {
        setClash({ combo, owner })
        return
      }
      take(recording, combo)
    }
    const quiet = (e: MouseEvent): void => {
      if (recording && comboFromMouse(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('pointerdown', onButton, true)
    window.addEventListener('mousedown', quiet, true)
    window.addEventListener('mouseup', quiet, true)
    window.addEventListener('auxclick', quiet, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onButton, true)
      window.removeEventListener('mousedown', quiet, true)
      window.removeEventListener('mouseup', quiet, true)
      window.removeEventListener('auxclick', quiet, true)
    }
  }, [recording, clash, props])

  const customisedCount = ACTIONS.filter((a) => isCustomised(props.overrides, a.id)).length

  return (
    <div
      data-testid="shortcuts-dialog"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
      className="ui-scrim"
      style={{
        position: 'fixed',
        inset: 0,
        background: surface.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50
      }}
    >
      <div
        className="ui-dialog"
        style={{ width: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.md,
            padding: `14px ${space.lg}px`,
            borderBottom: `1px solid ${surface.line}`
          }}
        >
          <h2 style={{ font: type.title, color: ink.primary, margin: 0 }}>Keyboard shortcuts</h2>
          <span style={{ font: type.meta, color: ink.muted }}>
            {customisedCount === 0 ? 'All on defaults' : `${customisedCount} changed`}
          </span>
          <IconButton
            icon="close"
            label="Close"
            testid="shortcuts-close"
            size="small"
            variant="ghost"
            onClick={props.onClose}
            style={{ marginLeft: 'auto' }}
          />
        </header>

        <div style={{ overflowY: 'auto', padding: `${space.xs}px ${space.lg}px ${space.md}px` }}>
          {GROUPS.map((group) => (
            <section key={group} style={{ marginTop: space.md }}>
              <SectionLabel style={{ display: 'block', marginBottom: space.xs }}>{group}</SectionLabel>

              {ACTIONS.filter((a) => a.group === group).map((action) => {
                const combos = props.keymap[action.id]
                const isRecording = recording === action.id
                return (
                  <div
                    key={action.id}
                    data-testid={`shortcut-${action.id}`}
                    data-combos={combos.join(' ')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: space.sm,
                      padding: '5px 0',
                      borderBottom: `1px solid ${surface.line}`
                    }}
                  >
                    <span style={{ font: type.meta, color: ink.primary, flex: '0 0 190px' }}>
                      {action.label}
                      {isCustomised(props.overrides, action.id) && (
                        <span title="Changed from the default" style={{ color: accent.bright, marginLeft: space.xs }}>
                          •
                        </span>
                      )}
                    </span>

                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                      {combos.length === 0 && !isRecording && (
                        <span style={{ font: type.meta, color: ink.disabled }}>no key</span>
                      )}
                      {combos.map((combo) => (
                        <span key={combo} style={chip}>
                          {formatCombo(combo)}
                          <IconButton
                            icon="close"
                            label="Remove this key"
                            testid={`shortcut-remove-${action.id}-${combo}`}
                            variant="ghost"
                            onClick={() => props.onChange(removeCombo(props.overrides, action.id, combo))}
                            style={{ width: 16, height: 16 }}
                          />
                        </span>
                      ))}
                      {/* Shown for the whole of a recording, clash or no clash:
                          it is the one thing that says the row is still taking
                          keys, which is what the old bar at the top took away. */}
                      {isRecording && (
                        <span
                          data-testid="shortcut-recording"
                          style={{ ...chip, borderColor: accent.base, color: accent.bright, padding: '1px 6px' }}
                        >
                          press a key or a mouse button, Esc to cancel
                        </span>
                      )}
                      {isRecording && clash !== null && (
                        <span
                          data-testid="shortcuts-conflict"
                          data-combo={clash.combo}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: space.xs,
                            font: type.meta,
                            color: meaning.attention,
                            background: wash.attention,
                            border: `1px solid ${wash.attentionLine}`,
                            borderRadius: radius.chip,
                            padding: '1px 2px 1px 6px'
                          }}
                        >
                          <span>
                            <strong>{formatCombo(clash.combo)}</strong> is {actionLabel(clash.owner)}
                          </span>
                          <Button
                            testid="shortcuts-conflict-move"
                            size="small"
                            variant="ghost"
                            title={`Enter does this too. Takes ${formatCombo(clash.combo)} off ${actionLabel(clash.owner)}.`}
                            onClick={() => take(action.id, clash.combo)}
                            style={{ height: 18, padding: '0 6px' }}
                          >
                            Enter moves it
                          </Button>
                        </span>
                      )}
                    </span>

                    <Button
                      testid={`shortcut-add-${action.id}`}
                      size="small"
                      pressed={isRecording}
                      onClick={() => {
                        setClash(null)
                        setRecording(isRecording ? null : action.id)
                      }}
                    >
                      {isRecording ? 'Cancel' : 'Add key'}
                    </Button>
                    <Button
                      testid={`shortcut-reset-${action.id}`}
                      size="small"
                      onClick={() => props.onChange(resetAction(props.overrides, action.id))}
                      disabled={!isCustomised(props.overrides, action.id)}
                      whyDisabled="This one is already on its default"
                      title="Back to the default"
                    >
                      Reset
                    </Button>
                  </div>
                )
              })}
            </section>
          ))}
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: `10px ${space.lg}px`,
            borderTop: `1px solid ${surface.line}`
          }}
        >
          <HelpTip text="Keys are physical, so they work in any keyboard layout." tutorial="050-the-keys-worth-learning" />
          <Button
            testid="shortcuts-reset-all"
            size="small"
            onClick={() => props.onChange({})}
            disabled={customisedCount === 0}
            whyDisabled="Every key is already on its default"
            style={{ marginLeft: 'auto' }}
          >
            Reset all
          </Button>
        </footer>
      </div>
    </div>
  )
}
