/**
 * The Inspector's column, or its rail when folded away, with the divider
 * beside it. Its heading carries the picker of which sections it shows, and a
 * section dragged over it is taken away from beside the timeline (plan 92).
 */

import { useCallback, useState, type JSX } from 'react'
import { placeSection } from '../../shared/section-layout'
import { Inspector } from '../components/Inspector'
import { Divider } from '../components/Divider'
import { SECTION_TYPE, Sections } from '../components/section-host'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Panel } from '../ui/Panel'
import { SectionLabel } from '../ui/SectionLabel'
import { accent, ink, type } from '../theme'
import { held, panel } from './styles'
import { SectionPicker } from './SectionPicker'
import { endSectionDrag } from './sectionDrag'
import { TuckBar, rightTucked } from './SectionDock'
import { useInspectorProps, useSectionHost } from './useInspectorProps'
import type { AppState } from './app-state'

export function InspectorColumn({ app }: { app: AppState }): JSX.Element {
  const { inspectorFolded, fold, inspectorColumn, windowSettings, setWindowSettings, recording } = app
  const inspectorProps = useInspectorProps(app)
  const layout = windowSettings.sections
  /** How many of each section's groups the selection draws here (task 52), shown or hidden. */
  const [applying, setApplying] = useState<Record<string, number>>({})
  const onApplies = useCallback((name: string) => {
    const by = (n: number) => setApplying((was) => ({ ...was, [name]: (was[name] ?? 0) + n }))
    by(1)
    return () => by(-1)
  }, [])
  const host = useSectionHost(null, layout, setWindowSettings, onApplies)
  /** A section held over the column, to be taken away from beside the timeline. */
  const [over, setOver] = useState(false)
  return (
    <>
      {inspectorFolded ? (
        <span />
      ) : (
        <Divider
          testid="inspector-divider"
          side="right"
          column={inspectorColumn}
          size={windowSettings.inspectorWidth}
          onSize={(inspectorWidth) => setWindowSettings({ inspectorWidth })}
        />
      )}

      {inspectorFolded ? (
        <Panel name="Inspector" side="right" icon="more" folded testid="inspector-column" onFold={fold('inspectorFolded')}>
          {null}
        </Panel>
      ) : (
      <Tucked app={app}>
      <div
        ref={inspectorColumn}
        data-testid="inspector-column"
        data-folded="no"
        data-section-over={over ? 'yes' : 'no'}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(SECTION_TYPE)) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={(e) => {
          const name = e.dataTransfer.getData(SECTION_TYPE)
          setOver(false)
          endSectionDrag()
          if (!name) return
          e.preventDefault()
          e.stopPropagation()
          setWindowSettings({ sections: placeSection(layout, name, 'inspector') })
        }}
        style={{
          ...panel,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: 1,
          ...(over ? { outline: `2px dashed ${accent.bright}`, outlineOffset: -4 } : {}),
          ...(recording ? held : {})
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <SectionLabel style={{ flex: 1 }}>Inspector</SectionLabel>
          <SectionPicker
            layout={layout}
            onLayout={host.onLayout}
            applies={inspectorProps ? (name) => (applying[name] ?? 0) > 0 : undefined}
          />
          <IconButton
            icon="right"
            label="Fold the Inspector away"
            testid="inspector-fold"
            size="small"
            variant="ghost"
            onClick={() => fold('inspectorFolded')(true)}
          />
        </div>
        {layout.hidden.length > 0 && (
          <div data-testid="inspector-hidden-note" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ flex: 1, font: type.meta, color: ink.secondary }} title={layout.hidden.join(', ')}>
              {layout.hidden.length === 1 ? `${layout.hidden[0]} is hidden here` : `${layout.hidden.length} sections hidden here`}
            </span>
            <Button testid="inspector-show-all" size="small" onClick={() => setWindowSettings({ sections: { ...layout, hidden: [] } })}>
              Show all
            </Button>
          </div>
        )}
        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
          {inspectorProps && (
            <Sections.Provider value={host}>
              <Inspector {...inspectorProps} />
            </Sections.Provider>
          )}
        </div>
      </div>
      </Tucked>
      )}
    </>
  )
}

/**
 * With the sections right of the timeline folded down (task 1137), the
 * Inspector runs the window's full height, their bar under it.
 */
function Tucked({ app, children }: { app: AppState; children: JSX.Element }): JSX.Element {
  if (!rightTucked(app)) return children
  return (
    <div data-testid="inspector-tall" style={{ gridColumn: 5, gridRow: '1 / -1', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {children}
      <TuckBar app={app} />
    </div>
  )
}
