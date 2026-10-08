import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CrashScreen } from './CrashScreen'
import { loadCaptionFont } from './preview/captionFont'
import { applyTheme } from './theme'
import './ui.css'

// Before the first render, so no frame is ever painted with a token missing.
applyTheme()
loadCaptionFont()

/** Where text may be selected: what the stylesheet leaves selectable. */
const SELECTABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"]), pre, .ui-selectable'

// The browser's own drag of text, a link or a picture never starts: a stray
// one dragged a copy of a panel instead of moving the control under it. Only
// what the app itself drags, a source from the bin, marks itself draggable.
window.addEventListener(
  'dragstart',
  (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (!target?.closest('[draggable="true"]')) e.preventDefault()
  },
  true
)

// Any text left selected is let go of when a control is pressed, so a press
// on it is always the control's.
window.addEventListener(
  'pointerdown',
  (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest(SELECTABLE)) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  },
  true
)

const el = document.getElementById('root')
if (!el) throw new Error('root element missing')
createRoot(el).render(
  <CrashScreen>
    <App />
  </CrashScreen>
)
