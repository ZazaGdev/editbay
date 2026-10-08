/**
 * What can be done to a clip, where the pointer is. Right clicking one
 * did nothing at all before, and in every other editor it is the main way
 * people find what a clip can do.
 */

import { Fragment, type JSX } from 'react'
import { cropOf, findClip, joinNeighbour, joinRefusal, linkedIds, newId, pipOf, removedBetween, type Timeline as TimelineData } from '../../shared/project'
import { keyLabel } from '../../shared/keymap'
import type { KindSet } from '../../shared/transitions'
import { groupRefusal } from '../../shared/groups'
import { clipLabel } from '../../shared/clip-name'
import { toolsFor } from '../../shared/clip-tools'
import { makeToolChoice } from '../components/tool-choice'
import { saveAsAsset } from './save-asset'
import { ContextMenu, MenuHeading, MenuSeparator, SubMenu } from '../components/ContextMenu'
import { MenuItem } from '../components/DropMenu'
import { MarkPicker } from '../components/MarkPicker'
import { Level } from '../components/Inspector'
import { space } from '../theme'
import { splitsHere } from './clip-checks'
import { secondsOf } from './edit-words'
import type { AppState } from './app-state'

export function ClipMenu({ app, clipMenu, timeline }: { app: AppState; clipMenu: NonNullable<AppState['clipMenu']>; timeline: TimelineData }): JSX.Element {
  const { setClipMenu, keys, playhead, run, editClip, transitionDefaults, setSelectedTransition, selectedIds, selectedClips, clipboard, pasteAt,
    selected, setJoinAsk, select, canLink, copiedFraming, copiedCrop, savedLayouts, layoutAction, setCaptionsScope, setCaptionsOpen, show } = app
  return (
    <ContextMenu at={clipMenu.at} onClose={() => setClipMenu(null)} testid="clip-menu">
      <MenuHeading>{clipLabel(timeline, clipMenu.clipId)}</MenuHeading>
      {(() => {
        const id = clipMenu.clipId
        const found = findClip(timeline, id)!
        const picture = found.kind === 'video'
        const kinds: KindSet = picture ? 'picture' : 'sound'
        const close = (then: () => void) => (): void => {
          setClipMenu(null)
          then()
        }
        // Bugs and notes 2, note 21: what is rarely possible is left out
        // until it is, rather than greyed; what is often possible keeps its place.
        const joins = (['previous', 'next'] as const).flatMap((side) => {
          const other = joinNeighbour(timeline, id, side)
          const pair: [string, string] | null = other === null ? null : side === 'previous' ? [other, id] : [id, other]
          return pair && joinRefusal(timeline, pair[0], pair[1], false, true) === null ? [{ side, pair, back: removedBetween(timeline, pair[0], pair[1]) }] : []
        })
        const hasCrop = cropOf(timeline, id) !== null
        const linked = linkedIds(timeline, id).length > 1
        // Group: the selection when this clip is in it, and it is two or more side by side.
        const grouping = selectedIds.has(id) ? selectedClips : [id]
        const groupable = groupRefusal(timeline, grouping) === null
        const grouped = findClip(timeline, id)?.clip.group !== undefined
        return (
          <>
            <MenuItem
              testid="clip-menu-split"
              label="Split here"
              hint={keyLabel(keys.keymap, 'split')}
              disabled={!splitsHere(timeline, id, playhead)}
              {...(splitsHere(timeline, id, playhead) ? {} : { title: 'Put the playhead inside this clip first' })}
              onClick={close(() => run('split'))}
            />
            <SubMenu testid="clip-menu-transition" label="Add a transition" title="At this clip's start or its end">
              {(['in', 'out'] as const).map((side) => {
                const already = (side === 'in' ? found.clip.transitionIn : found.clip.transitionOut) !== undefined
                return (
                  <MenuItem
                    key={side}
                    testid={`clip-menu-transition-${side}`}
                    label={side === 'in' ? 'At its start' : 'At its end'}
                    {...(side === 'in'
                      ? { hint: keyLabel(keys.keymap, kinds === 'picture' ? 'addPictureTransition' : 'addSoundTransition') }
                      : {})}
                    disabled={already}
                    {...(already ? { title: 'This edge already has one' } : {})}
                    onClick={close(() => {
                      editClip({
                        kind: 'addTransition',
                        clipId: id,
                        side,
                        transitionKind: kinds === 'picture' ? transitionDefaults.picture : transitionDefaults.sound,
                        length: Math.max(1, Math.round(transitionDefaults.seconds * timeline.fps)),
                        ...(kinds === 'sound' ? { alone: true } : {})
                      })
                      setSelectedTransition({ clipId: id, side })
                    })}
                  />
                )
              })}
            </SubMenu>
            {/* What changes the picture itself, background removal first (plan 90). */}
            {picture && toolsFor(timeline.media.find((m) => m.id === found.clip.mediaId)).length > 0 && (
              <SubMenu testid="clip-menu-tools" label="Tools" title="Change what this clip's picture shows">
                {toolsFor(timeline.media.find((m) => m.id === found.clip.mediaId)).map((tool) => (
                  <Fragment key={tool.id}>
                    <MenuHeading>{tool.name}</MenuHeading>
                    {tool.choices(found.clip).map((c) => (
                      <MenuItem
                        key={c.id}
                        testid={`clip-menu-tool-${tool.id}-${c.id}`}
                        label={c.label}
                        current={c.current}
                        onClick={close(() => void makeToolChoice(c, found.clip, timeline.fps, editClip))}
                      />
                    ))}
                  </Fragment>
                ))}
              </SubMenu>
            )}
            <MenuSeparator />
            <MenuItem
              testid="clip-menu-save-asset"
              label="Save as asset"
              title="Save it as it plays, with its edits, into your assets folder: with its sound when that is selected too"
              onClick={close(() => void saveAsAsset(app.sequenceId, selectedIds.has(id) ? selectedClips : [id]))}
            />
            <MenuItem testid="clip-menu-copy" label="Copy" hint={keyLabel(keys.keymap, 'copyClips')} onClick={close(() => run('copyClips'))} />
            <MenuItem testid="clip-menu-cut" label="Cut, leaving a gap" hint={keyLabel(keys.keymap, 'cutClips')} onClick={close(() => run('cutClips'))} />
            {clipboard !== null && (
              <MenuItem
                testid="clip-menu-paste"
                label="Paste at the playhead"
                hint={keyLabel(keys.keymap, 'pasteClips')}
                onClick={close(() => void pasteAt(playhead))}
              />
            )}
            <MenuSeparator />
            <MenuItem
              testid="clip-menu-delete"
              label="Delete, leaving a gap"
              hint={keyLabel(keys.keymap, 'deleteClip')}
              danger
              onClick={close(() => run('deleteClip'))}
            />
            <MenuItem
              testid="clip-menu-close-up"
              label="Remove and close up"
              hint={keyLabel(keys.keymap, 'closeUp')}
              danger
              onClick={close(() => run('closeUp'))}
            />
            {(joins.length > 0 || groupable || grouped || canLink(id) || linked || picture) && <MenuSeparator />}
            {(joins.length > 0 || groupable || grouped) && (
              <SubMenu testid="clip-menu-join" label="Join">
                {joins.map(({ side, pair, back }) => (
                  <MenuItem
                    key={side}
                    testid={`clip-menu-join-${side}`}
                    label={`${side === 'previous' ? 'With the previous clip' : 'With the next clip'}${back > 0 ? `, bringing back ${secondsOf(back, timeline.fps)}` : ''}`}
                    hint={keyLabel(keys.keymap, 'joinClips')}
                    onClick={close(() => {
                      // The joined clip keeps the first piece's id.
                      const then = selected === pair[1] ? pair[0] : null
                      if (back > 0) {
                        setJoinAsk({ clipIds: pair, frames: back, alone: false, select: then })
                        return
                      }
                      void editClip({ kind: 'joinClips', clipIds: pair })
                      if (then) select(then)
                    })}
                  />
                ))}
                {groupable && (
                  <MenuItem
                    testid="clip-menu-group"
                    label="Group into one clip, keeping the cuts"
                    hint={keyLabel(keys.keymap, 'groupClips')}
                    onClick={close(() => void editClip({ kind: 'groupClips', clipIds: grouping, groupId: newId() }))}
                  />
                )}
                {grouped && (
                  <MenuItem
                    testid="clip-menu-ungroup"
                    label="Ungroup into its pieces"
                    hint={keyLabel(keys.keymap, 'ungroupClips')}
                    onClick={close(() => void editClip({ kind: 'ungroupClips', clipIds: [id] }))}
                  />
                )}
              </SubMenu>
            )}
            {picture && (
              <SubMenu testid="clip-menu-framing" label="Framing" title="Copy and paste the framing or the crop, or give it a saved layout">
                <MenuItem
                  testid="clip-menu-copy-framing"
                  label="Copy the framing"
                  hint={keyLabel(keys.keymap, 'copyFraming')}
                  onClick={close(() => run('copyFraming'))}
                />
                {copiedFraming.current !== null && (
                  <MenuItem
                    testid="clip-menu-paste-framing"
                    label="Paste the framing"
                    hint={keyLabel(keys.keymap, 'pasteFraming')}
                    onClick={close(() => run('pasteFraming'))}
                  />
                )}
                {hasCrop && (
                  <MenuItem testid="clip-menu-copy-crop" label="Copy the crop" hint={keyLabel(keys.keymap, 'copyCrop')} onClick={close(() => run('copyCrop'))} />
                )}
                {hasCrop && copiedCrop !== null && (
                  <MenuItem
                    testid="clip-menu-paste-crop"
                    label="Paste the crop"
                    hint={keyLabel(keys.keymap, 'pasteCrop')}
                    onClick={close(() => run('pasteCrop'))}
                  />
                )}
                {/* Plan 97: the small box out of the way and back, over In to Out or a second and a half from the playhead. */}
                {pipOf(timeline, id) !== null && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      testid="clip-menu-out-of-the-way"
                      label="Move the box out of the way"
                      hint={keyLabel(keys.keymap, 'moveOutOfTheWay')}
                      onClick={close(() => run('moveOutOfTheWay'))}
                    />
                    <MenuItem
                      testid="clip-menu-fade-out-of-the-way"
                      label="Fade the box out of the way"
                      hint={keyLabel(keys.keymap, 'fadeOutOfTheWay')}
                      onClick={close(() => run('fadeOutOfTheWay'))}
                    />
                  </>
                )}
                {savedLayouts.length > 0 && (
                  <>
                    <MenuSeparator />
                    <MenuHeading>Saved layouts</MenuHeading>
                    {savedLayouts.map((l) => (
                      <MenuItem
                        key={l.id}
                        testid="clip-menu-saved-layout"
                        label={l.name}
                        onClick={close(() => layoutAction.current.apply(l))}
                      />
                    ))}
                  </>
                )}
              </SubMenu>
            )}
            {/* Whichever applies, as one item: never both, and never one that cannot be done. */}
            {canLink(id) ? (
              <MenuItem
                testid="clip-menu-link"
                label="Link"
                title="Make the selected clips one group, which moves, trims and cuts together"
                onClick={close(() => editClip({ kind: 'link', clipIds: selectedClips }))}
              />
            ) : linked ? (
              <MenuItem
                testid="clip-menu-unlink"
                label="Unlink"
                title="Make these separate clips, which move, trim and cut on their own"
                onClick={close(() => editClip({ kind: 'unlink', clipId: id }))}
              />
            ) : null}
            <MenuSeparator />
            <MenuHeading>Mark</MenuHeading>
            <MarkPicker
              value={found.clip.mark}
              onPick={(mark) => {
                setClipMenu(null)
                editClip({ kind: 'setClipMark', clipId: id, mark })
              }}
            />
            {found.kind === 'audio' && (
              <>
                <MenuSeparator />
                <MenuHeading>Volume</MenuHeading>
                <div style={{ padding: `2px ${space.sm}px` }}>
                  <Level
                    testid="clip-menu-volume"
                    title="How loud this clip plays"
                    gain={found.clip.gain}
                    onChange={(gain, continuing) =>
                      void editClip({ kind: 'setClipAudio', clipId: found.clip.id, gain, muted: found.clip.muted }, continuing)
                    }
                  />
                </div>
              </>
            )}
            <MenuSeparator />
            {/* Plan 78: this clip only, which is selected by the right click that opened the menu. */}
            <MenuItem
              testid="clip-menu-captions"
              label="Make captions for this clip"
              onClick={close(() => {
                setCaptionsScope('selected')
                setCaptionsOpen(true)
              })}
            />
            <MenuItem
              testid="clip-menu-show"
              label="Show where it came from"
              onClick={close(() => show(found.clip.mediaId))}
            />
          </>
        )
      })()}
    </ContextMenu>
  )
}
