/**
 * The menu of a transition on the timeline, right clicked: its kind, where
 * it sits on the cut, and taking it off.
 */

import type { JSX, ReactNode } from 'react'
import { findClip, mediaDurationFrames, type Timeline as TimelineData } from '../../shared/project'
import {
  ALIGNMENTS,
  alignmentOf,
  beforeFor,
  heldInWindow,
  kindName,
  kindsOf,
  transitionFamilies,
  DIRECTION_NAMES,
  transitionWindows,
  type KindSet,
  type Transitioned
} from '../../shared/transitions'
import { ContextMenu, MenuHeading, MenuSeparator, SubMenu } from '../components/ContextMenu'
import { MenuItem } from '../components/DropMenu'
import { TransitionThumb } from '../components/TransitionThumb'
import { space } from '../theme'
import type { AppState } from './app-state'

export function TransitionMenu({ app, transitionMenu, timeline }: { app: AppState; transitionMenu: NonNullable<AppState['transitionMenu']>; timeline: TimelineData }): JSX.Element {
  const { setTransitionMenu, editClip, rememberTransition, setSelectedTransition } = app
  return (
    <ContextMenu at={transitionMenu.at} onClose={() => setTransitionMenu(null)} testid="transition-menu">
      {(() => {
        const found = findClip(timeline, transitionMenu.clipId)!
        const kinds: KindSet = found.kind === 'video' ? 'picture' : 'sound'
        const side = transitionMenu.side
        const stored = side === 'in' ? found.clip.transitionIn : found.clip.transitionOut
        if (!stored) return null
        // The window as it is actually drawn, which the clamps may have
        // shortened: the menu has to agree with the rectangle on screen.
        const drawn = transitionWindows(found.track.clips as Transitioned[], kinds).find(
          (w) => w.clipId === transitionMenu.clipId && w.side === side
        )
        const shown = drawn ? { length: drawn.to - drawn.from, before: drawn.cut - drawn.from, kind: drawn.kind } : stored
        // How much of it has no footage behind it and holds one frame,
        // which the rectangle hatches and this says in words.
        const held = drawn
          ? heldInWindow(found.track.clips as Transitioned[], kinds, drawn, (clip) => {
              const m = timeline.media.find((x) => x.id === clip.mediaId)
              return m ? mediaDurationFrames(m, timeline.fps) : 0
            })
          : { head: 0, tail: 0 }
        const close = (): void => setTransitionMenu(null)
        return (
          <>
            <MenuHeading>
              {kindName(shown.kind, kinds)}, {shown.length} frames
            </MenuHeading>
            {drawn && drawn.kind !== stored.kind && (
              <MenuHeading>Nothing on the other side of this cut, so it is drawn as a dip</MenuHeading>
            )}
            {held.head + held.tail > 0 && (
              <MenuHeading>
                {held.head + held.tail} of those frames{' '}
                {kinds === 'picture' ? 'hold one frame: the recording does not go that far' : 'are silence: the recording does not go that far'}
                . Shorten it, or trim the clip back, to use real footage.
              </MenuHeading>
            )}
            <MenuSeparator />
            <MenuHeading>Kind</MenuHeading>
{(() => {
              const pick = (id: string, label: ReactNode): JSX.Element => (
                <MenuItem
                  key={id}
                  testid={`transition-kind-${id}`}
                  label={label}
                  current={id === stored.kind}
                  onClick={() => {
                    close()
                    editClip({ kind: 'setTransitionKind', clipId: transitionMenu.clipId, side, transitionKind: id })
                    rememberTransition(kinds === 'picture' ? { picture: id } : { sound: id })
                  }}
                />
              )
              if (kinds === 'sound') return kindsOf(kinds).map((k) => pick(k.id, k.name))
              // A kind of its own, or a family with its directions beside it; each playing, small.
              const shownWith = (id: string, name: string): JSX.Element => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
                  <TransitionThumb kind={id} />
                  {name}
                </span>
              )
              return transitionFamilies().map((f) =>
                'kind' in f ? (
                  pick(f.kind.id, shownWith(f.kind.id, f.kind.name))
                ) : (
                  <SubMenu
                    key={f.family}
                    testid={`transition-family-${f.family.toLowerCase()}`}
                    label={shownWith(f.kinds.find((k) => k.id === stored.kind)?.id ?? f.kinds[0]!.id, f.family)}
                    current={f.kinds.some((k) => k.id === stored.kind)}
                  >
                    {f.kinds.map((k) => pick(k.id, shownWith(k.id, DIRECTION_NAMES[k.direction!])))}
                  </SubMenu>
                )
              )
            })()}
            <MenuSeparator />
            <MenuHeading>Where it sits</MenuHeading>
            {ALIGNMENTS.map((a) => (
              <MenuItem
                key={a.id}
                testid={`transition-align-${a.id}`}
                label={a.name}
                current={alignmentOf(stored) === a.id}
                onClick={() => {
                  close()
                  editClip({
                    kind: 'setTransition',
                    clipId: transitionMenu.clipId,
                    side,
                    length: stored.length,
                    before: beforeFor(a.id, stored.length)
                  })
                }}
              />
            ))}
            <MenuSeparator />
            <MenuItem
              testid="transition-remove"
              danger
              label="Remove the transition"
              onClick={() => {
                close()
                setSelectedTransition(null)
                editClip({ kind: 'removeTransition', clipId: transitionMenu.clipId, side })
              }}
            />
          </>
        )
      })()}
    </ContextMenu>
  )
}
