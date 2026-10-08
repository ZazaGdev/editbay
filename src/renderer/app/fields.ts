/**
 * Whether a key or a press belongs to a field or a control rather than to
 * the editor.
 */

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel'])

/**
 * Whether a key belongs to whatever is focused rather than to the editor.
 *
 * Only genuine text entry counts. Treating every input as typing means that
 * after clicking a checkbox, every shortcut silently stops working until you
 * click somewhere else, which is maddening in an editor driven by the keyboard.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type)
  return false
}

/**
 * A press anywhere that is not a field takes the focus from the field that
 * has it, as it would in any app. The timeline and the monitor cancel the
 * browser's own handling of a press, to stop text being selected while they
 * drag, and that also stops the browser moving focus: the field kept its
 * caret, and the next Delete or Space went into it rather than to the
 * editor. Leaving the field applies what was typed, as Tab away does.
 */
export function blurFieldOnPress(e: PointerEvent): void {
  const focused = document.activeElement
  if (!(focused instanceof HTMLElement) || !(isTypingTarget(focused) || focused instanceof HTMLSelectElement)) return
  // A menu lets go of its own boxes as it closes, and must see the press itself to close.
  if (focused.closest('.ui-menu')) return
  const target = e.target
  if (target instanceof Node && focused.contains(target)) return
  // Another field, or a label for one, takes the focus itself.
  if (target instanceof Element && target.closest('input, textarea, select, label, [contenteditable="true"]')) return
  focused.blur()
}

const CONTROL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/**
 * Whether a key moves the focused control rather than the editor: the bare
 * arrow keys on a slider, a dropdown or a set of radio buttons. Every other
 * key, Alt with an arrow among them, still reaches the editor.
 */
export function isControlKey(e: KeyboardEvent): boolean {
  if (!CONTROL_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return false
  return e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && (e.target.type === 'range' || e.target.type === 'radio'))
}
