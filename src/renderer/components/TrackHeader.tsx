import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import { MAX_TRACK_NAME } from '../../shared/tracks'
import { surface, ink, accent, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { DropMenu, MenuItem } from './DropMenu'

/** How wide a track's header is. Wide enough for its name, what it carries, and its controls. */
export const HEADER_WIDTH = 132

/**
 * What a track says about itself, down the left of the timeline: its colour,
 * its name, what it carries, and a menu of what can be done to it.
 *
 * Remove track used to be a bare 12 pixel cross under the name, which is where
 * you click to select the track. It is in the menu now, where a thing that
 * takes work away belongs.
 */
export function TrackHeader(props: {
  /** V1, A2, Captions. */
  name: string
  /** The recording its clips come from, or what kind of track it is. */
  carries: string
  /** The track's own colour, as its clips take it. */
  colour: string
  height: number
  /** Taking the track away, when it can be: absent for one that cannot. */
  onRemove?: (() => void) | undefined
  /** Why it cannot be taken away, shown in the menu in its place. */
  whyNotRemove?: string | undefined
  /** The track's id, for a test to tell one header from another. */
  trackId?: string | undefined
  /**
   * Dragged taller or shorter by its bottom edge, told the height in pixels.
   * Absent for a track that does not resize, as the captions do not.
   */
  onHeight?: ((px: number) => void) | undefined
  /** Not heard, in the preview and in the export alike. Absent for a video track. */
  muted?: boolean | undefined
  onMuted?: ((muted: boolean) => void) | undefined
  /** Heard alone, in the preview only: never saved, never exported. */
  solo?: boolean | undefined
  onSolo?: ((solo: boolean) => void) | undefined
  /** Comes down under everything heard on the other tracks, in the preview and the export. Absent for a video track. */
  duck?: boolean | undefined
  onDuck?: ((duck: boolean) => void) | undefined
  /** Nothing on it can be changed, and nothing can be dropped on it. */
  locked?: boolean | undefined
  onLocked?: ((locked: boolean) => void) | undefined
  /** Not drawn, in the preview and in the export alike. Absent for an audio track. */
  hidden?: boolean | undefined
  onHidden?: ((hidden: boolean) => void) | undefined
  /** Calling it something. Empty gives it its number back. Absent for a track that cannot be named. */
  onName?: ((name: string) => void) | undefined
  /** What it is called now, empty when it has only its number. */
  nameGiven?: string | undefined
  /** Anything else the header carries, such as the captions style button. */
  children?: ReactNode | undefined
}): JSX.Element {
  const [menu, setMenu] = useState(false)
  const close = useCallback(() => setMenu(false), [])
  /** The name being typed, or null when the header is showing its name rather than taking one. */
  const [typing, setTyping] = useState<string | null>(null)

  const keep = (): void => {
    if (typing !== null) props.onName?.(typing)
    setTyping(null)
  }

  /** A drag on the bottom edge: where it began, and how tall the track was then. */
  const [sizing, setSizing] = useState<{ y: number; from: number } | null>(null)
  const { onHeight } = props
  useEffect(() => {
    if (!sizing || !onHeight) return
    const move = (e: globalThis.PointerEvent): void => onHeight(sizing.from + (e.clientY - sizing.y))
    const up = (): void => setSizing(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [sizing, onHeight])

  return (
    <div
      data-testid="track-header"
      data-track-id={props.trackId}
      data-track={props.name}
      style={{
        height: props.height,
        boxSizing: 'border-box',
        borderTop: `1px solid ${surface.line}`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: space.xs,
        padding: `0 ${space.sm}px`,
        background: surface.panel,
        position: 'relative'
      }}
    >
      {props.onHeight && (
        <div
          data-testid="track-resize"
          title="Drag to make this track taller or shorter"
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSizing({ y: e.clientY, from: props.height })
          }}
          onDoubleClick={(e) => {
            // Back to whatever the size control says, as a double click on a
            // column divider puts a column back.
            e.stopPropagation()
            props.onHeight?.(0)
          }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -2,
            height: 5,
            cursor: 'ns-resize',
            zIndex: 2
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{ width: 3, height: 14, borderRadius: radius.handle, background: props.colour, flexShrink: 0 }}
        />
        {typing === null ? (
          <>
            <span
              data-testid="track-name"
              title={props.name}
              style={{
                font: type.meta,
                fontWeight: 600,
                color: ink.primary,
                flexShrink: 0,
                maxWidth: 84,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {props.name}
            </span>
            <span
              data-testid="track-carries"
              title={props.carries}
              style={{ font: type.meta, color: ink.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {props.carries}
            </span>
          </>
        ) : (
          /*
            Enter keeps it, Escape drops it, and losing the field keeps it too:
            clicking away from a name you have typed and finding it gone is the
            surprising answer. Every key is stopped here so the timeline's own
            shortcuts do not see the letters.
          */
          <input
            type="text"
            data-testid="track-rename"
            aria-label={`What ${props.name} is called`}
            value={typing}
            maxLength={MAX_TRACK_NAME}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setTyping(e.target.value)}
            onBlur={keep}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') keep()
              if (e.key === 'Escape') setTyping(null)
            }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              font: type.meta,
              color: ink.primary,
              background: surface.sunken,
              border: `1px solid ${accent.base}`,
              borderRadius: radius.chip,
              padding: '1px 4px'
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
        {props.onMuted && (
          <Button
            testid="track-mute"
            size="small"
            variant="ghost"
            pressed={props.muted === true}
            onClick={() => props.onMuted?.(props.muted !== true)}
            title={props.muted === true ? `${props.name} is not heard, here or in the export` : `Do not hear ${props.name}`}
            style={{ width: 20, height: 20, padding: 0 }}
          >
            M
          </Button>
        )}
        {props.onSolo && (
          <Button
            testid="track-solo"
            size="small"
            variant="ghost"
            pressed={props.solo === true}
            onClick={() => props.onSolo?.(props.solo !== true)}
            title={
              props.solo === true
                ? `Hearing ${props.name} alone. Solo is never saved and never exported.`
                : `Hear ${props.name} alone. Solo is never saved and never exported.`
            }
            style={{ width: 20, height: 20, padding: 0 }}
          >
            S
          </Button>
        )}
        {props.onDuck && (
          <Button
            testid="track-duck"
            size="small"
            variant="ghost"
            pressed={props.duck === true}
            onClick={() => props.onDuck?.(props.duck !== true)}
            title={
              props.duck === true
                ? `${props.name} comes down under the other tracks wherever they are heard, here and in the export`
                : `Bring ${props.name} down under the other tracks wherever they are heard, as music under a voice`
            }
            style={{ width: 20, height: 20, padding: 0 }}
          >
            D
          </Button>
        )}
        {props.onHidden && (
          <IconButton
            icon={props.hidden === true ? 'hidden' : 'shown'}
            label={props.hidden === true ? `Show ${props.name} again` : `Do not draw ${props.name}, here or in the export`}
            testid="track-hide"
            size="small"
            variant="ghost"
            pressed={props.hidden === true}
            onClick={() => props.onHidden?.(props.hidden !== true)}
            style={{ width: 20, height: 20 }}
          />
        )}
        {props.onLocked && (
          <IconButton
            icon={props.locked === true ? 'locked' : 'unlocked'}
            label={props.locked === true ? `Unlock ${props.name}` : `Lock ${props.name} against every edit`}
            testid="track-lock"
            size="small"
            variant="ghost"
            pressed={props.locked === true}
            onClick={() => props.onLocked?.(props.locked !== true)}
            style={{ width: 20, height: 20 }}
          />
        )}
        {props.children}
        <span style={{ flexGrow: 1 }} />
        <DropMenu
          open={menu}
          onClose={close}
          /*
            Opened rightwards, over the tracks, not back over the header. A
            menu is wider than the 132 pixel header, and the timeline's rows
            scroll, so a right aligned one hung off the left edge and was cut
            off there: an empty box with every word of it outside the window.
          */
          align="left"
          testid="track-menu"
          anchor={
            <IconButton
              icon="more"
              label={`What can be done to ${props.name}`}
              testid="track-menu-open"
              size="small"
              variant="ghost"
              pressed={menu}
              onClick={() => setMenu((o) => !o)}
              style={{ width: 20, height: 20 }}
            />
          }
        >
          {props.onName && (
            <MenuItem
              testid="track-rename-open"
              label="Rename track"
              onClick={() => {
                setMenu(false)
                setTyping(props.nameGiven ?? '')
              }}
            />
          )}
          <MenuItem
            testid="track-remove"
            label="Remove track"
            danger
            disabled={props.onRemove === undefined}
            {...(props.onRemove === undefined ? { title: props.whyNotRemove ?? 'This track cannot be taken away' } : {})}
            onClick={() => {
              setMenu(false)
              props.onRemove?.()
            }}
          />
        </DropMenu>
      </div>
    </div>
  )
}
