/**
 * The window's panels laid out as one grid: the bin, the monitor and the
 * Inspector side by side, the divider that sets the timeline's height, and
 * the timeline's row under them all.
 */

import type { JSX } from 'react'
import { Divider } from '../components/Divider'
import { COLUMN_MIN, MONITOR_MIN, RAIL_WIDTH } from '../state/useSettings'
import { surface } from '../theme'
import { panel } from './styles'
import { BinColumn } from './BinColumn'
import { MonitorArea } from './MonitorArea'
import { InspectorColumn } from './InspectorColumn'
import { TimelineRow } from './TimelineRow'
import type { AppState } from './app-state'

export function PanelGrid({ app }: { app: AppState }): JSX.Element {
  const { binFolded, inspectorFolded, windowSettings, setWindowSettings, timeline, timelineTracks, measureTimelineRoom, clampTracks } = app
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        // The monitor's smallest is above a panel's, so a window with no room
        // to spare takes it from the panels and leaves the picture alone. A
        // folded panel is a rail, and the divider beside it goes with it.
        gridTemplateColumns: [
          binFolded ? `${RAIL_WIDTH}px` : `minmax(${COLUMN_MIN}px, ${windowSettings.binWidth}px)`,
          binFolded ? '0px' : '10px',
          `minmax(${MONITOR_MIN}px, 1fr)`,
          inspectorFolded ? '0px' : '10px',
          inspectorFolded ? `${RAIL_WIDTH}px` : `minmax(${COLUMN_MIN}px, ${windowSettings.inspectorWidth}px)`
        ].join(' '),
        // The strip between the monitor and the timeline is a divider too, so
        // the timeline can be dragged taller the way the columns drag wider.
        gridTemplateRows: 'minmax(0, 1fr) 10px auto',
        padding: 10,
        boxSizing: 'border-box'
      }}
    >
      <BinColumn app={app} />

      <div
        style={{
          ...panel,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: surface.canvas,
          overflow: 'hidden'
        }}
      >
        {timeline && <MonitorArea app={app} timeline={timeline} />}
      </div>

      <InspectorColumn app={app} />

      <div style={{ gridColumn: '1 / -1', display: 'grid' }}>
      <Divider
        testid="timeline-divider"
        side="below"
        column={timelineTracks}
        size={windowSettings.timelineHeight ?? 0}
        onStart={measureTimelineRoom}
        // Drawn straight onto the tracks while dragging, so the rest of the
        // window is not drawn again on every movement; kept when it lets go.
        onLive={(h) => {
          const el = timelineTracks.current
          if (!el) return
          el.style.maxHeight = 'none'
          el.style.height = `${clampTracks(h)}px`
        }}
        onSize={(h) => setWindowSettings({ timelineHeight: clampTracks(h) })}
        onReset={() => setWindowSettings({ timelineHeight: null })}
      />
      </div>

      <TimelineRow app={app} />
    </div>
  )
}
