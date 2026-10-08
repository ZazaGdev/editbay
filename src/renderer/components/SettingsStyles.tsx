/**
 * Settings' list of the styles you saved under a name (task 54): caption
 * styles, text styles and shapes, each renamed in place or forgotten. They
 * are kept with the app's settings, so every project has them.
 */

import { useState, type JSX } from 'react'
import { cleanStyleName, type SavedStyle } from '../../shared/saved-styles'
import { removeShape, type SavedShape } from '../../shared/shape'
import { HelpTip } from '../ui/HelpTip'
import { IconButton } from '../ui/IconButton'
import { ink, radius, space, surface, type } from '../theme'
import { useSavedStyles } from './SavedStyles'

/** One saved style: its name, typed over to rename it, and the button that forgets it. */
function StyleRow(props: { kind: string; id: string; name: string; onRename: (name: string) => void; onRemove: () => void }): JSX.Element {
  const [typing, setTyping] = useState<string | null>(null)
  const done = (): void => {
    if (typing === null) return
    const name = cleanStyleName(typing)
    setTyping(null)
    if (name !== '' && name !== props.name) props.onRename(name)
  }
  return (
    <div data-testid="saved-style" data-kind={props.kind} data-name={props.name} style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
      <span className="ui-field" style={{ flex: 1 }}>
        <span className="ui-field__box" style={{ height: 26 }}>
          <input
            data-testid="saved-style-name"
            aria-label={`Name of the saved ${props.kind} style`}
            className="ui-field__input"
            value={typing ?? props.name}
            maxLength={40}
            onChange={(e) => setTyping(e.target.value)}
            onBlur={done}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done()
              if (e.key === 'Escape' && typing !== null) {
                e.stopPropagation()
                setTyping(null)
              }
            }}
          />
        </span>
      </span>
      <IconButton icon="discard" label={`Forget ${props.name}`} testid="saved-style-remove" size="small" variant="ghost" onClick={props.onRemove} />
    </div>
  )
}

function StyleList(props: { title: string; kind: string; items: { id: string; name: string }[]; onRename: (id: string, name: string) => void; onRemove: (id: string) => void }): JSX.Element {
  return (
    <div data-testid="saved-style-list" data-kind={props.kind} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ font: type.meta, color: ink.secondary }}>{props.title}</span>
      {props.items.length === 0 ? (
        <span style={{ font: type.meta, color: ink.muted, padding: '2px 6px', borderRadius: radius.control, background: surface.well }}>None saved yet.</span>
      ) : (
        props.items.map((s) => (
          <StyleRow key={s.id} kind={props.kind} id={s.id} name={s.name} onRename={(name) => props.onRename(s.id, name)} onRemove={() => props.onRemove(s.id)} />
        ))
      )}
    </div>
  )
}

const renamed = <T extends { id: string; name: string }>(list: readonly T[], id: string, name: string): T[] => list.map((s) => (s.id === id ? { ...s, name } : s))

export function SettingsStyles(props: { shapes: SavedShape[]; onShapes: (next: SavedShape[]) => void }): JSX.Element {
  const captions = useSavedStyles<unknown>('savedCaptionStyles')
  const texts = useSavedStyles<unknown>('savedTextStyles')
  const forget = <S,>(list: SavedStyle<S>[], id: string): SavedStyle<S>[] => list.filter((s) => s.id !== id)
  return (
    <div data-setting="setting-saved-styles" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <HelpTip
        testid="setting-saved-styles"
        text="Type over a name to rename the style, or forget it with the bin. Styles are saved from the Inspector's Captions, Text and Shape sections."
        tutorial="347-keep-a-text-style"
      />
      <StyleList
        title="Caption styles"
        kind="caption"
        items={captions.list}
        onRename={(id, name) => captions.store(renamed(captions.list, id, name))}
        onRemove={(id) => captions.store(forget(captions.list, id))}
      />
      <StyleList
        title="Text styles"
        kind="text"
        items={texts.list}
        onRename={(id, name) => texts.store(renamed(texts.list, id, name))}
        onRemove={(id) => texts.store(forget(texts.list, id))}
      />
      <StyleList
        title="Shapes"
        kind="shape"
        items={props.shapes}
        onRename={(id, name) => props.onShapes(renamed(props.shapes, id, name))}
        onRemove={(id) => props.onShapes(removeShape(props.shapes, id))}
      />
    </div>
  )
}
