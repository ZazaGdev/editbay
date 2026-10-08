/**
 * The menu of an empty stretch of a track, right clicked.
 */

import type { JSX } from 'react'
import type { Timeline as TimelineData } from '../../shared/project'
import { keyLabel } from '../../shared/keymap'
import { formatTimecode } from '../../shared/time'
import { ContextMenu, MenuHeading } from '../components/ContextMenu'
import { MenuItem } from '../components/DropMenu'
import type { AppState } from './app-state'

export function GapMenu({ app, gapMenu, timeline }: { app: AppState; gapMenu: NonNullable<AppState['gapMenu']>; timeline: TimelineData }): JSX.Element {
  const { setGapMenu, keys, closeGap, addBlackScreen, clipboard, pasteAt } = app
  return (
    <ContextMenu at={gapMenu.at} onClose={() => setGapMenu(null)} testid="gap-menu">
      <MenuHeading>Gap of {formatTimecode(gapMenu.gap.to - gapMenu.gap.from, timeline.fps)}</MenuHeading>
      <MenuItem
        testid="gap-menu-remove"
        label="Remove this gap"
        hint={keyLabel(keys.keymap, 'closeUp')}
        onClick={() => {
          const g = gapMenu.gap
          setGapMenu(null)
          closeGap(g)
        }}
      />
      <MenuItem
        testid="gap-menu-black"
        label="Fill with a black screen"
        hint={keyLabel(keys.keymap, 'addBlackScreen')}
        onClick={() => {
          const g = gapMenu.gap
          setGapMenu(null)
          void addBlackScreen(g)
        }}
      />
      <MenuItem
        testid="gap-menu-paste"
        label="Paste here"
        hint={keyLabel(keys.keymap, 'pasteClips')}
        disabled={clipboard === null}
        {...(clipboard === null ? { title: 'Copy or cut a clip first' } : {})}
        onClick={() => {
          const g = gapMenu.gap
          setGapMenu(null)
          void pasteAt(g.from)
        }}
      />
    </ContextMenu>
  )
}
