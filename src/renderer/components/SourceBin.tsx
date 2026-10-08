import { memo, useCallback, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { MediaAsset, ImportProgress } from '../../shared/types'
import type { BackgroundColour } from '../../shared/looks'
import { fileUrl } from '../../shared/file-url'
import { filmstripLayout, tileHeight, tileIndexForTime, tileRect } from '../../shared/filmstrip'
import { conformWords, importErrorWords, importStatusWords } from '../../shared/conform-words'
import { estimateRemaining, formatRemaining } from '../../shared/progress'
import { SOURCE_TYPE } from './Timeline'
import { ContextMenu, type MenuAt } from './ContextMenu'
import { MenuItem } from './DropMenu'
import { SourceFolders } from './SourceFolders'
import { surface, ink, danger, track as trackColour, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { SectionLabel } from '../ui/SectionLabel'
import { Segmented } from '../ui/Segmented'
import { Icon } from '../ui/Icon'
import { binGroups, nameOf, type BinGroupId, type BinKind, type BinSort } from '../../shared/bin'
import type { BinView } from '../state/useSettings'

/** Search and sort appear once the bin holds more than this many sources. */
const MANY = 5
const CARD_THUMB_W = 88
const CARD_THUMB_H = 49.5
/** The list's picture: enough to tell recordings apart at a glance. */
const LIST_THUMB_W = 40
const LIST_THUMB_H = 22.5
/** The grid's pictures, two or three across a panel of the usual width. */
const GRID_THUMB_W = 116
const GRID_THUMB_H = 65


function length(sec: number): string {
  const mins = Math.floor(sec / 60)
  const secs = Math.floor(sec % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/** A ready source in a line: how long, how big, how fast, what codec, how many audio tracks. */
function describe(asset: MediaAsset): string {
  if (asset.hasVideo === false) return `${length(asset.durationSec)}  sound  ${asset.codec}`
  if (asset.still === true && asset.frames !== undefined && asset.frameRate !== undefined) {
    return `animation  ${asset.width}x${asset.height}  ${asset.frameRate}fps  ${asset.frames} frames`
  }
  if (asset.still === true) return `image  ${asset.width}x${asset.height}  ${asset.codec}`
  const rate = asset.fps % 1 === 0 ? asset.fps.toFixed(0) : asset.fps.toFixed(2)
  // Unknown for a source imported before this was counted: shown as nothing, not a guess.
  const tracks =
    asset.audioTracks === undefined ? '' : `  ${asset.audioTracks} audio ${asset.audioTracks === 1 ? 'track' : 'tracks'}`
  return `${length(asset.durationSec)}  ${asset.width}x${asset.height}  ${rate}fps  ${asset.codec}${tracks}`
}

function usedIn(n: number): string {
  if (n === 0) return 'not on the timeline'
  return n === 1 ? 'in 1 clip' : `in ${n} clips`
}

/**
 * The picture on a card: one tile of the source's filmstrip, the first, or
 * the one under the pointer as it moves across, so a recording can be looked
 * through without opening it.
 */
function Thumbnail(props: { asset: MediaAsset; revision: number; width?: number; height?: number }): JSX.Element {
  const { asset } = props
  const THUMB_W = props.width ?? CARD_THUMB_W
  const THUMB_H = props.height ?? CARD_THUMB_H
  const [at, setAt] = useState<number | null>(null)
  const layout = filmstripLayout(asset.durationSec)
  const h = tileHeight(layout.tileWidth, asset.width, asset.height)
  const tile = tileRect(layout, at === null ? 0 : tileIndexForTime(layout, at * asset.durationSec, asset.durationSec), h)
  // Fitted to the card's width, and to its height for a tile that is taller than the card.
  const scale = Math.min(THUMB_W / layout.tileWidth, THUMB_H / h)
  const src = fileUrl(asset.filmstripPath) + (props.revision > 0 ? `?v=${props.revision}` : '')
  const onMove = (e: MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  return (
    <div
      data-testid="asset-thumb"
      data-tile={at === null ? 0 : tileIndexForTime(layout, at * asset.durationSec, asset.durationSec)}
      onMouseMove={asset.filmstripPath !== '' ? onMove : undefined}
      onMouseLeave={() => setAt(null)}
      style={{
        position: 'relative',
        width: THUMB_W,
        height: THUMB_H,
        background: surface.canvas,
        borderRadius: radius.chip,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: type.meta,
        // A sound source has no picture, so it says so in the sound track's colour.
        color: trackColour.sound
      }}
    >
      {asset.hasVideo === false && 'sound'}
      {asset.filmstripPath !== '' && (
        <div
          style={{
            width: tile.w * scale,
            height: tile.h * scale,
            backgroundImage: `url("${src}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${layout.cols * layout.tileWidth * scale}px ${layout.rows * h * scale}px`,
            backgroundPosition: `${-tile.x * scale}px ${-tile.y * scale}px`
          }}
        />
      )}
      {at !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${at * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: ink.primary,
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}

/**
 * The sources of the project. Memoised: it shows nothing that moves with the
 * playhead, and it used to be drawn again on every frame of playback.
 */
export const SourceBin = memo(function SourceBin(props: {
  assets: MediaAsset[]
  progress: Map<string, ImportProgress>
  /** When each source's conversion began, for its time left. */
  convertingSince: Map<string, number>
  /** Bumped per source when its filmstrip is rebuilt, so the picture is fetched again. */
  revisions: Map<string, number>
  /** How many times each source is on the timeline, in every sequence. */
  usage: Map<string, number>
  /** When each source came into the project, by id, for the bin's days. */
  addedAt: ReadonlyMap<string, number>
  /** Cards, a list, or a grid: a window preference, also in Settings. */
  view: BinView
  onView: (view: BinView) => void
  /** Sources the project is preparing again, which nothing may cancel or remove meanwhile. */
  rebuilding: string[]
  onPick: () => void
  /** Put a source at the end of V1, with its sound on the first free audio tracks. */
  onAdd: (assetId: string) => void
  onCancel: (assetId: string) => void
  onRetry: (assetId: string) => void
  onRemove: (assetId: string) => void
  onShow: (assetId: string) => void
  /** Import files, as dropping them would. */
  onImport: (paths: string[]) => void
  /** A file from the effects folder put over the selected clip, when one is selected (plan 90). */
  onApplyEffect?: ((path: string, background?: BackgroundColour) => void) | undefined
  canApplyEffect?: boolean
  /** Fold the panel away to a rail, so the picture takes the room. */
  onFold: () => void
  /** Look through a recording before it lands, to mark the part worth having. */
  onSkim: (assetId: string) => void
  /** Put the recording's own chapters on the timeline as markers. */
  onBringMarkers: (assetId: string) => void
}): JSX.Element {
  /**
   * The one search of the panel: the project's sources and your folders,
   * Recordings among them, all by name. The folders say how many they found,
   * or null while there is nothing to count.
   */
  const [search, setSearch] = useState('')
  const words = search.trim().toLowerCase()
  const searching = words !== ''
  const [foldersFound, setFoldersFound] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<BinSort>('added')
  const [kind, setKind] = useState<BinKind>('all')
  /** Days folded shut, which stay shut while the window is open. */
  const [folded, setFolded] = useState<Set<BinGroupId>>(new Set())
  const [menu, setMenu] = useState<{ id: string; at: MenuAt } | null>(null)
  /**
   * The three dots the menu was opened from, or null when a right-click opened
   * it. The menu is told, so pressing those dots again closes it rather than
   * closing and reopening it in one gesture.
   */
  const openedFrom = useRef<HTMLElement | null>(null)
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set())
  const closeMenu = useCallback(() => setMenu(null), [])

  const many = props.assets.length > MANY
  // A bin too short to offer sort and the filter is always in the order
  // things came in, newest first, with only the search taking any away.
  const groups = useMemo(
    () =>
      binGroups(props.assets, props.addedAt, {
        search,
        sort: many ? sortBy : 'added',
        kind: many ? kind : 'all',
        now: Date.now()
      }),
    [props.assets, props.addedAt, many, search, sortBy, kind]
  )
  const shown = groups.flatMap((g) => g.assets)
  // A heading for each day only once there is more than one: a bin of
  // today's recordings has nothing to tell apart.
  const headed = groups.length > 1

  // A recording whose import failed can be imported again from the list.
  const imported = useMemo(
    () => new Set(props.assets.filter((a) => a.status !== 'failed').map((a) => a.originalPath.toLowerCase())),
    [props.assets]
  )
  const menuAsset = menu ? props.assets.find((a) => a.id === menu.id) : undefined
  const preparing = (a: MediaAsset): boolean => props.rebuilding.includes(a.id)
  /** Being imported, and so something Cancel can stop. */
  const busy = (a: MediaAsset): boolean => a.status !== 'ready' && a.status !== 'failed' && !preparing(a)

  const statusLine = (asset: MediaAsset): string => {
    const p = props.progress.get(asset.id)
    const since = props.convertingSince.get(asset.id)
    const left =
      asset.status === 'conforming' && since !== undefined && p?.fraction !== undefined
        ? formatRemaining(estimateRemaining(p.fraction, Date.now() - since))
        : null
    return importStatusWords(asset.status, p, left) ?? describe(asset)
  }

  /** One source as a card: its picture, its name and what it is, and what can be done with it. */
  const card = (asset: MediaAsset): JSX.Element => {
    const uses = props.usage.get(asset.id) ?? 0
    const failure = asset.status === 'failed' ? importErrorWords(asset.error) : null
    const details = failure ? [failure.details, asset.errorDetails].filter(Boolean).join('\n\n') : ''
    const converted = asset.status === 'ready' && asset.conformed ? conformWords(asset.conformReasons) : null
    return (
      <article
        key={asset.id}
        data-testid="asset"
        data-asset-id={asset.id}
        data-status={asset.status}
        data-conformed={asset.conformed ? 'yes' : 'no'}
        data-audio-tracks={asset.audioTracks ?? ''}
        data-uses={uses}
        // Dragged onto a track of the timeline, it goes there.
        draggable={asset.status === 'ready'}
        onDragStart={(e) => {
          e.dataTransfer.setData(SOURCE_TYPE, asset.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          openedFrom.current = null
          setMenu({ id: asset.id, at: { x: e.clientX, y: e.clientY } })
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: `${CARD_THUMB_W}px 1fr`,
          gap: 10,
          padding: space.sm,
          borderRadius: radius.panel,
          background: asset.status === 'failed' ? danger.fill : surface.raised,
          border: `1px solid ${asset.status === 'failed' ? danger.line : 'transparent'}`,
          opacity: asset.status === 'queued' ? 0.7 : 1
        }}
      >
        <Thumbnail asset={asset} revision={props.revisions.get(asset.id) ?? 0} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.xs }}>
            <div
              title={asset.originalPath}
              style={{
                flex: 1,
                minWidth: 0,
                font: type.body,
                color: ink.primary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {nameOf(asset)}
            </div>
            {/* Everything this source can do, in one place. It was all on
                the right-click before, which nothing on the card said. */}
            <IconButton
              icon="more"
              label={`What to do with ${nameOf(asset)}`}
              testid="asset-more"
              size="small"
              variant="ghost"
              onClick={(e) => {
                const button = e.currentTarget
                const r = button.getBoundingClientRect()
                const open = menu?.id === asset.id
                openedFrom.current = open ? null : button
                setMenu(open ? null : { id: asset.id, at: { x: r.left, y: r.bottom + 4 } })
              }}
              style={{ flexShrink: 0, marginTop: -2, marginRight: -4 }}
            />
          </div>
          <div
            data-testid="asset-status"
            style={{ font: type.meta, marginTop: 2, color: failure ? danger.ink : ink.secondary }}
          >
            {failure ? failure.text : statusLine(asset)}
          </div>
          {converted && (
            <div data-testid="asset-converted" style={{ font: type.meta, color: ink.muted, marginTop: 2 }}>
              {converted}
            </div>
          )}
          {asset.status === 'ready' && (
            <div data-testid="asset-usage" style={{ font: type.meta, color: ink.muted, marginTop: 2 }}>
              {usedIn(uses)}
            </div>
          )}
          {asset.status === 'ready' && asset.copying && (
            <div
              data-testid="asset-copying"
              title="It can be cut already. Tracks 2 onwards play once they are copied, and an export waits for them."
              style={{ font: type.meta, color: ink.muted, marginTop: 2 }}
            >
              Copying {asset.copying.length === 1 ? 'its other audio track' : `its other ${asset.copying.length} audio tracks`}...
            </div>
          )}
          {openDetails.has(asset.id) && details !== '' && (
            <pre
              data-testid="asset-details"
              style={{
                font: type.monoSmall,
                color: ink.secondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 120,
                overflow: 'auto',
                margin: '6px 0 0',
                padding: 6,
                borderRadius: radius.chip,
                background: surface.canvas
              }}
            >
              {details}
            </pre>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs, marginTop: 6 }}>
            {asset.status === 'ready' && (
              <Button
                testid="add-to-timeline"
                size="small"
                icon="down"
                onClick={() => props.onAdd(asset.id)}
                title="At the end of V1, with its sound on audio tracks of its own. Or drag it onto a track."
              >
                Add to timeline
              </Button>
            )}
            {busy(asset) && (
              <Button testid="asset-cancel" size="small" onClick={() => props.onCancel(asset.id)}>
                Cancel
              </Button>
            )}
            {asset.status === 'failed' && (
              <Button testid="asset-retry" size="small" onClick={() => props.onRetry(asset.id)}>
                Retry
              </Button>
            )}
            {asset.status === 'failed' && uses === 0 && !preparing(asset) && (
              <Button testid="asset-remove" size="small" variant="danger" onClick={() => props.onRemove(asset.id)}>
                Remove
              </Button>
            )}
            {details !== '' && (
              <Button
                testid="asset-details-toggle"
                size="small"
                variant="ghost"
                onClick={() =>
                  setOpenDetails((prev) => {
                    const next = new Set(prev)
                    if (next.has(asset.id)) next.delete(asset.id)
                    else next.add(asset.id)
                    return next
                  })
                }
              >
                {openDetails.has(asset.id) ? 'Hide details' : 'Details'}
              </Button>
            )}
          </div>
        </div>
      </article>
    )
  }

  /** What a row and a tile share: a press opens the menu, and a drag goes to the timeline. */
  const common = (asset: MediaAsset) => ({
    key: asset.id,
    'data-testid': 'asset',
    'data-asset-id': asset.id,
    'data-status': asset.status,
    'data-uses': props.usage.get(asset.id) ?? 0,
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(SOURCE_TYPE, asset.id)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      openedFrom.current = null
      setMenu({ id: asset.id, at: { x: e.clientX, y: e.clientY } })
    },
    // Double click puts it at the end of V1, as Add to timeline does.
    onDoubleClick: () => props.onAdd(asset.id),
    title: `${asset.originalPath}\n${describe(asset)}\nDouble click to add it to the timeline`
  })

  /** One line: a small picture, the name, how long, and whether it is used. */
  const row = (asset: MediaAsset): JSX.Element => {
    const uses = props.usage.get(asset.id) ?? 0
    return (
      <div
        {...common(asset)}
        data-view="list"
        style={{
          display: 'grid',
          gridTemplateColumns: `${LIST_THUMB_W}px 1fr auto auto`,
          alignItems: 'center',
          gap: space.sm,
          padding: '2px 4px',
          borderRadius: radius.chip,
          background: surface.raised
        }}
      >
        <Thumbnail asset={asset} revision={props.revisions.get(asset.id) ?? 0} width={LIST_THUMB_W} height={LIST_THUMB_H} />
        <span style={{ font: type.meta, color: ink.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nameOf(asset)}
        </span>
        <span style={{ font: type.monoSmall, color: ink.muted }}>{asset.still === true ? 'image' : length(asset.durationSec)}</span>
        <span data-testid="asset-usage" data-uses={uses} title={usedIn(uses)} style={{ font: type.meta, color: uses > 0 ? ink.secondary : ink.muted, minWidth: 18, textAlign: 'right' }}>
          {uses > 0 ? `x${uses}` : '-'}
        </span>
      </div>
    )
  }

  /** A picture, the name under it, and how many clips use it in a corner. */
  const tile = (asset: MediaAsset): JSX.Element => {
    const uses = props.usage.get(asset.id) ?? 0
    return (
      <div {...common(asset)} data-view="grid" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, position: 'relative' }}>
        <Thumbnail asset={asset} revision={props.revisions.get(asset.id) ?? 0} width={GRID_THUMB_W} height={GRID_THUMB_H} />
        {uses > 0 && (
          <span
            data-testid="asset-usage"
            data-uses={uses}
            title={usedIn(uses)}
            style={{
              position: 'absolute',
              top: 3,
              right: 3,
              font: type.monoSmall,
              color: ink.onAccent,
              background: surface.overlay,
              borderRadius: radius.chip,
              padding: '0 4px'
            }}
          >
            x{uses}
          </span>
        )}
        <span style={{ font: type.meta, color: ink.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nameOf(asset)}
        </span>
      </div>
    )
  }

  /** A day's sources in the view chosen, anything not ready as a card. */
  const drawn = (assets: MediaAsset[]): JSX.Element => {
    if (props.view === 'cards') return <>{assets.map(card)}</>
    const ready = assets.filter((a) => a.status === 'ready')
    const rest = assets.filter((a) => a.status !== 'ready')
    return (
      <>
        {rest.map(card)}
        {props.view === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{ready.map(row)}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_THUMB_W}px, 1fr))`, gap: space.sm }}>
            {ready.map(tile)}
          </div>
        )}
      </>
    )
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionLabel>Source</SectionLabel>
        <span style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
          <Button size="small" icon="add" onClick={props.onPick}>
            Add files
          </Button>
          <IconButton
            icon="left"
            label="Fold the Source panel away"
            testid="bin-fold"
            size="small"
            variant="ghost"
            onClick={props.onFold}
          />
        </span>
      </header>

      <Field
        testid="sources-search"
        label="Search sources and your folders by name"
        hideLabel
        placeholder="Search sources and folders"
        value={search}
        onChange={setSearch}
        height={24}
      />

      <SourceFolders
        imported={imported}
        onImport={(path) => props.onImport([path])}
        search={words}
        onMatches={setFoldersFound}
        effects={props.onApplyEffect ? { onApply: props.onApplyEffect, canApply: props.canApplyEffect === true } : undefined}
      />

      {props.assets.length === 0 && !searching && (
        <p style={{ color: ink.muted, font: type.body }}>Drop video, sound or image files anywhere in this window.</p>
      )}

      {searching && shown.length > 0 && (
        <div data-testid="sources-project-heading" style={{ display: 'flex', gap: 6, font: type.meta, color: ink.secondary, padding: '0 2px' }}>
          In this project
          <span data-testid="sources-project-count" style={{ color: ink.muted }}>
            {shown.length}
          </span>
        </div>
      )}
      {searching && shown.length === 0 && foldersFound === 0 && (
        <p data-testid="sources-nothing-found" style={{ color: ink.muted, font: type.meta, margin: 0 }}>
          Nothing in the project or your folders is called that.
        </p>
      )}

      {many && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
          <Select
            testid="bin-sort"
            label="Sort the sources"
            value={sortBy}
            onChange={(v) => setSortBy(v as BinSort)}
            height={24}
            choices={[
              { value: 'added', label: 'Added' },
              { value: 'name', label: 'Name' },
              { value: 'length', label: 'Length' }
            ]}
          />
        </div>
      )}
      {props.assets.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          {many ? (
            <Segmented
              testid="bin-kind"
              label="Show only one kind of source"
              size="small"
              chosen={kind}
              onChoose={setKind}
              choices={[
                { id: 'all' as BinKind, label: 'All' },
                { id: 'video' as BinKind, label: 'Video', title: 'Recordings with a picture' },
                { id: 'sound' as BinKind, label: 'Sound', title: 'Sound files, with no picture' },
                { id: 'image' as BinKind, label: 'Image', title: 'Images, for overlays and memes' }
              ]}
            />
          ) : (
            <span />
          )}
          <Segmented
            testid="bin-view"
            label="How the sources are shown"
            size="small"
            chosen={props.view}
            onChoose={props.onView}
            choices={[
              { id: 'cards' as BinView, label: '', icon: 'viewCards', title: 'Cards, with everything on them' },
              { id: 'list' as BinView, label: '', icon: 'viewList', title: 'A list, one line each' },
              { id: 'grid' as BinView, label: '', icon: 'viewGrid', title: 'A grid of thumbnails' }
            ]}
          />
        </div>
      )}
      {many && shown.length === 0 && !searching && (
        <p data-testid="bin-nothing-found" style={{ color: ink.muted, font: type.meta }}>
          No source of that kind.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id} data-testid="bin-group" data-group={group.id} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {headed && (
            <button
              type="button"
              data-testid="bin-group-toggle"
              data-group={group.id}
              aria-expanded={!folded.has(group.id)}
              className="ui-menu__item"
              onClick={() =>
                setFolded((was) => {
                  const next = new Set(was)
                  if (next.has(group.id)) next.delete(group.id)
                  else next.add(group.id)
                  return next
                })
              }
              style={{ font: type.meta, color: ink.secondary, gap: 6, padding: '2px 4px' }}
            >
              <Icon name={folded.has(group.id) ? 'right' : 'down'} size={13} />
              {group.label}
              <span style={{ color: ink.muted }}>{group.assets.length}</span>
            </button>
          )}
          {!(headed && folded.has(group.id)) && drawn(group.assets)}
        </div>
      ))}

      {menu && menuAsset && (
        <ContextMenu at={menu.at} onClose={closeMenu} testid="asset-menu" ignore={openedFrom.current}>
          <MenuItem
            testid="asset-menu-skim"
            label="Skim"
            title={
              menuAsset.still === true
                ? 'An image has nothing to look through: add it to the timeline and trim it there'
                : 'Look through it and mark the part worth having before it goes on the timeline'
            }
            disabled={menuAsset.status !== 'ready' || menuAsset.still === true}
            onClick={() => {
              closeMenu()
              props.onSkim(menuAsset.id)
            }}
          />
          <MenuItem
            testid="asset-menu-add"
            label="Add to timeline"
            disabled={menuAsset.status !== 'ready'}
            onClick={() => {
              closeMenu()
              props.onAdd(menuAsset.id)
            }}
          />
          {(menuAsset.chapters?.length ?? 0) > 0 && (
            <MenuItem
              testid="asset-menu-chapters"
              label={`Bring in its ${menuAsset.chapters!.length} markers`}
              disabled={(props.usage.get(menuAsset.id) ?? 0) === 0}
              title={
                (props.usage.get(menuAsset.id) ?? 0) === 0
                  ? 'Put it on the timeline first'
                  : "Chapters this recording carries, one per press of OBS's hotkey while you recorded. They go wherever this recording is on the timeline."
              }
              onClick={() => {
                closeMenu()
                props.onBringMarkers(menuAsset.id)
              }}
            />
          )}
          <MenuItem
            testid="asset-menu-show"
            label="Show in folder"
            onClick={() => {
              closeMenu()
              props.onShow(menuAsset.id)
            }}
          />
          {menuAsset.status === 'failed' && (
            <MenuItem
              testid="asset-menu-retry"
              label="Retry"
              onClick={() => {
                closeMenu()
                props.onRetry(menuAsset.id)
              }}
            />
          )}
          {busy(menuAsset) ? (
            <MenuItem
              testid="asset-menu-cancel"
              label="Cancel import"
              onClick={() => {
                closeMenu()
                props.onCancel(menuAsset.id)
              }}
            />
          ) : (
            (() => {
              // Offered whether or not it can be done, and greyed with the
              // reason behind it when it cannot, as Remove track is: the
              // reason set as a line of its own read as a shouted heading.
              const n = props.usage.get(menuAsset.id) ?? 0
              const why = preparing(menuAsset)
                ? 'Being prepared again. It can be removed once that finishes.'
                : n > 0
                  ? `${n === 1 ? 'In 1 clip' : `In ${n} clips`}. Delete ${n === 1 ? 'that clip' : 'those clips'} first.`
                  : null
              return (
                <MenuItem
                  testid="asset-menu-remove"
                  danger
                  label="Remove from bin"
                  disabled={why !== null}
                  title={why ?? 'Out of the bin and the project. The file stays where it is, and can be imported again.'}
                  onClick={() => {
                    closeMenu()
                    props.onRemove(menuAsset.id)
                  }}
                />
              )
            })()
          )}
        </ContextMenu>
      )}
    </section>
  )
})
