/**
 * The menu of a marker on the ruler, right clicked.
 */

import type { JSX } from 'react'
import type { Timeline as TimelineData } from '../../shared/project'
import { formatTimecode } from '../../shared/time'
import { ContextMenu, MenuHeading, MenuSeparator } from '../components/ContextMenu'
import { MenuItem } from '../components/DropMenu'
import { MarkPicker } from '../components/MarkPicker'
import type { AppState } from './app-state'

export function MarkerMenu({ app, markerMenu, timeline }: { app: AppState; markerMenu: NonNullable<AppState['markerMenu']>; timeline: TimelineData }): JSX.Element {
  const { setMarkerMenu, setRenamingMarker, seek, editClip } = app
  return (
    <ContextMenu at={markerMenu.at} onClose={() => setMarkerMenu(null)} testid="marker-menu">
      <MenuHeading>
        {(() => {
          const m = timeline.markers.find((x) => x.id === markerMenu.markerId)!
          return m.name === '' ? `Marker at ${formatTimecode(m.frame, timeline.fps)}` : m.name
        })()}
      </MenuHeading>
      <MenuItem
        testid="marker-menu-rename"
        label="Rename"
        onClick={() => {
          const id = markerMenu.markerId
          setMarkerMenu(null)
          setRenamingMarker(id)
        }}
      />
      <MenuItem
        testid="marker-menu-go"
        label="Go to it"
        onClick={() => {
          const m = timeline.markers.find((x) => x.id === markerMenu.markerId)
          setMarkerMenu(null)
          if (m) seek(m.frame)
        }}
      />
      <MenuSeparator />
      <MenuHeading>Colour</MenuHeading>
      <MarkPicker
        value={timeline.markers.find((m) => m.id === markerMenu.markerId)?.colour}
        onPick={(colour) => {
          const id = markerMenu.markerId
          setMarkerMenu(null)
          editClip({ kind: 'colourMarker', markerId: id, colour })
        }}
      />
      <MenuSeparator />
      <MenuItem
        testid="marker-menu-remove"
        danger
        label="Remove the marker"
        onClick={() => {
          const id = markerMenu.markerId
          setMarkerMenu(null)
          editClip({ kind: 'removeMarker', markerId: id })
        }}
      />
    </ContextMenu>
  )
}
