import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { cleanTextStyle, type TextStyle } from '../../shared/text'
import { fontOf, layoutText } from '../text/draw'
import { accent, radius, surface } from '../theme'

/**
 * A text's words typed where they sit on the Output view: a box laid over
 * its picture, in its font, colour and alignment at the size it is shown,
 * with every word selected so typing replaces them. Enter is a new line;
 * Ctrl+Enter or a press anywhere else finishes, Escape puts the words back.
 * The picture itself is drawn again once, when it finishes.
 */
export function TextEditBox(props: {
  style: TextStyle
  /** The words it starts with. */
  words: string
  /** Where the text's picture is shown, in the Output view's own pixels. */
  box: { left: number; top: number; width: number; height: number }
  onWords: (words: string) => void
  /** Finished: the words to keep, or null to put the old ones back. */
  onEnd: (words: string | null) => void
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Its own, so a key typed is shown at once however long the window takes to draw after it.
  const [words, setWords] = useState(props.words)
  const ended = useRef(false)
  const end = (keep: boolean): void => {
    if (ended.current) return
    ended.current = true
    props.onEnd(keep ? (ref.current?.value ?? words) : null)
  }
  const latestEnd = useRef(end)
  latestEnd.current = end

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  // A press anywhere else finishes it, even where the press is kept from
  // moving focus, as the timeline's are.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      latestEnd.current(true)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])

  // Laid out as the picture is, so the words sit where it draws them: the
  // picture is as wide as the text's layout, and is shown `scale` times that.
  // The scale is the picture's as it was when typing began, taken once: worked
  // out from the words as typed, one letter was drawn as wide as the whole old
  // picture, and every key made the letters grow or shrink. Only the box
  // follows the words; the letters stay the text's size.
  const style = cleanTextStyle({ ...props.style, text: words })
  const measure = document.createElement('canvas').getContext('2d')
  const layout = measure ? layoutText(measure, style) : null
  const [scale] = useState(() => {
    const first = measure ? layoutText(measure, cleanTextStyle({ ...props.style, text: props.words })) : null
    return first && first.width > 0 ? props.box.width / first.width : 1
  })
  const inset = layout ? { x: (layout.box.x + (style.box ? style.boxPadding : 0)) * scale, y: (layout.box.y + (style.box ? style.boxPadding : 0)) * scale } : { x: 0, y: 0 }
  const size = style.size * scale

  return (
    <textarea
      ref={ref}
      data-testid="text-edit-box"
      aria-label="The text's words"
      value={words}
      spellCheck={false}
      onChange={(e) => {
        setWords(e.target.value)
        props.onWords(e.target.value)
      }}
      onBlur={() => end(true)}
      onKeyDown={(e) => {
        // Every key is for the words while they are typed, none for the editor.
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          end(false)
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          end(true)
        }
      }}
      style={{
        position: 'absolute',
        zIndex: 4,
        left: props.box.left,
        top: props.box.top,
        minWidth: props.box.width,
        minHeight: props.box.height,
        // As wide and tall as the words, growing as they are typed.
        fieldSizing: 'content',
        boxSizing: 'border-box',
        padding: `${inset.y}px ${inset.x}px`,
        margin: 0,
        font: fontOf({ ...style, size }),
        lineHeight: `${style.lineSpacing * size}px`,
        textAlign: style.align,
        color: style.colour,
        WebkitTextStroke: style.outlineWidth > 0 ? `${Math.max(0.5, style.outlineWidth * scale * 0.5)}px ${style.outlineColour}` : undefined,
        paintOrder: 'stroke fill',
        // Dark enough to hide the words drawn before, which stay under it until it finishes.
        background: surface.overlayDense,
        border: `1px dashed ${accent.bright}`,
        borderRadius: radius.handle,
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre'
      } as CSSProperties}
    />
  )
}
