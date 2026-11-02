/**
 * Task 116: while a tool from the command search waits for its target, the
 * pointer is a picker. A clip or an asset it can act on lights up, one it
 * cannot shows not-allowed with the reason in the hint, and a click on one it
 * can does it. Enter does it to the selected clip; Escape or a right click
 * leaves it. Nothing else under the pointer hears the clicks meanwhile, so
 * picking a clip neither selects it nor starts a drag.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { startPicking, usePicking } from '../state/picking'
import { accent, ink, radius, space, surface, type, elevation } from '../theme'
import { pickTools, type PickTool } from './pick-tools'
import type { AppState } from './app-state'

/** A ring with a dot in it, unlike any pointer the editor shows otherwise. */
const CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g fill="none" stroke-width="2"><circle cx="12" cy="12" r="8" stroke="${ink.onAccent}" stroke-width="4"/><circle cx="12" cy="12" r="8" stroke="${accent.bright}"/></g><circle cx="12" cy="12" r="2.5" fill="${accent.bright}" stroke="${ink.onAccent}"/></svg>`
  )}") 12 12, crosshair`

const STYLE = `
body[data-picking], body[data-picking] * { cursor: ${CURSOR} !important; }
body[data-picking] [data-pick="no"], body[data-picking] [data-pick="no"] * { cursor: not-allowed !important; }
body[data-picking] [data-pick="yes"] { outline: 2px solid ${accent.bright} !important; outline-offset: 1px; }
`

type Target = { kind: 'clip'; id: string; el: Element } | { kind: 'asset'; path: string; el: Element }

function targetAt(at: EventTarget | null): Target | null {
  if (!(at instanceof Element)) return null
  const clip = at.closest('[data-testid="clip"][data-clip-id], [data-testid="sound-clip"][data-clip-id]')
  if (clip) return { kind: 'clip', id: clip.getAttribute('data-clip-id')!, el: clip }
  const file = at.closest('[data-testid="folder-file"][data-effect="yes"][data-path]')
  if (file) return { kind: 'asset', path: file.getAttribute('data-path')!, el: file }
  return null
}

function canDo(tool: PickTool, t: Target): true | string {
  if (t.kind === 'clip') return tool.clip(t.id)
  return tool.asset ? tool.asset.can(t.path) : 'Click a clip on the timeline'
}

function act(tool: PickTool, t: Target): void {
  if (t.kind === 'clip') tool.onClip(t.id)
  else tool.asset?.on(t.path)
}

export function TargetPicker({ app }: { app: AppState }): JSX.Element | null {
  const toolId = usePicking()
  const tool = toolId === null ? null : (pickTools(app).find((t) => t.id === toolId) ?? null)
  // Read by the listeners, which are set once per pick rather than on every render.
  const now = useRef({ tool, selected: app.selected })
  now.current = { tool, selected: app.selected }
  const [refusal, setRefusal] = useState<string | null>(null)
  const active = tool !== null

  useEffect(() => {
    if (!active) return
    document.body.dataset['picking'] = toolId!
    let lit: Element | null = null
    const light = (t: Target | null): void => {
      if (lit && lit !== t?.el) lit.removeAttribute('data-pick')
      lit = t?.el ?? null
      const can = t && now.current.tool ? canDo(now.current.tool, t) : null
      if (t) t.el.setAttribute('data-pick', can === true ? 'yes' : 'no')
      setRefusal(typeof can === 'string' ? can : null)
    }
    const end = (): void => startPicking(null)
    const swallow = (e: Event): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const move = (e: PointerEvent): void => light(targetAt(e.target))
    // On the menu's own event, the last a right click makes, so none is left to reach the clip.
    const menu = (e: MouseEvent): void => {
      swallow(e)
      end()
    }
    const click = (e: MouseEvent): void => {
      swallow(e)
      const t = targetAt(e.target)
      const picked = now.current.tool
      if (e.button !== 0 || !t || !picked || canDo(picked, t) !== true) return
      end()
      act(picked, t)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        swallow(e)
        end()
      } else if (e.key === 'Enter') {
        swallow(e)
        const { tool: picked, selected } = now.current
        if (!picked || selected === null) return setRefusal('Select a clip first, or click one')
        const can = picked.clip(selected)
        if (can !== true) return setRefusal(can)
        end()
        picked.onClip(selected)
      }
    }
    const swallowed = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'dragstart'] as const
    window.addEventListener('pointermove', move, true)
    window.addEventListener('contextmenu', menu, true)
    window.addEventListener('click', click, true)
    window.addEventListener('keydown', key, true)
    for (const k of swallowed) window.addEventListener(k, swallow, true)
    return () => {
      delete document.body.dataset['picking']
      lit?.removeAttribute('data-pick')
      setRefusal(null)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('contextmenu', menu, true)
      window.removeEventListener('click', click, true)
      window.removeEventListener('keydown', key, true)
      for (const k of swallowed) window.removeEventListener(k, swallow, true)
    }
  }, [active, toolId])

  if (!tool) return null
  return (
    <>
      <style>{STYLE}</style>
      <div
        data-testid="pick-hint"
        data-tool={tool.id}
        style={{
          position: 'fixed',
          top: 64,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 80,
          pointerEvents: 'none',
          maxWidth: 'min(480px, calc(100vw - 32px))',
          padding: `${space.sm}px ${space.md}px`,
          borderRadius: radius.control,
          background: surface.raised,
          border: `1px solid ${accent.washLine}`,
          boxShadow: elevation.over,
          font: type.body,
          color: ink.primary,
          textAlign: 'center'
        }}
      >
        <b>{tool.label}</b>: {tool.asks}.
        <div data-testid="pick-refusal" style={{ font: type.meta, color: refusal ? ink.primary : ink.muted }}>
          {refusal ?? 'Enter for the selected clip. Esc or right-click to cancel.'}
        </div>
      </div>
    </>
  )
}
