/**
 * A very small Markdown reader, for the tutorials and nothing else.
 *
 * It handles paragraphs, bullet and numbered lists, tables, bold, italic,
 * inline code and `[Label]` chips, which is everything `docs/tutorials`
 * actually uses. Anything more exotic is left as plain text rather than
 * half-rendered.
 *
 * There is no dependency here on purpose. The app has two, and a markdown
 * library to read a fixed set of in-repo files would be a third. It also means
 * nothing ever turns text into markup: this produces a token tree, and the
 * renderer walks it into React elements, so no HTML string goes near the
 * window.
 *
 * Pure, and tested in `test/unit/markdown.test.ts`.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  /** Inline code. In the tutorials this is always a key, and is drawn as one. */
  | { kind: 'key'; text: string }
  /** `[Label]`: a control as the window names it, drawn as a chip. */
  | { kind: 'chip'; text: string }

export type Block =
  | { kind: 'para'; text: Inline[] }
  | { kind: 'bullets'; items: Inline[][] }
  | { kind: 'numbers'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }

const MARKERS = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\[\]`]+)\]/g

/**
 * The inline parts of one line.
 *
 * One pass, left to right, so a run of bold inside a sentence keeps the text
 * either side of it. The markers do not nest, which the tutorials never ask
 * them to.
 */
export function inlines(text: string): Inline[] {
  const out: Inline[] = []
  let at = 0
  for (const m of text.matchAll(MARKERS)) {
    const start = m.index ?? 0
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) })
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] })
    else if (m[2] !== undefined) out.push({ kind: 'italic', text: m[2] })
    else if (m[3] !== undefined) out.push({ kind: 'key', text: m[3] })
    else if (m[4] !== undefined) out.push({ kind: 'chip', text: m[4] })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out.length > 0 ? out : [{ kind: 'text', text: '' }]
}

/** A table row split on its pipes, with the empty cells the outer pipes leave dropped. */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** Whether a line is a table's dashed separator rather than a row of content. */
function isRule(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

/** The blocks of a whole entry, in order. */
export function blocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []

  const flush = (): void => {
    if (para.length > 0) out.push({ kind: 'para', text: inlines(para.join(' ')) })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed === '') {
      flush()
      continue
    }

    // A table: a row of pipes, then a dashed rule, then its rows.
    if (trimmed.startsWith('|') && isRule(lines[i + 1]?.trim() ?? '')) {
      flush()
      const head = cells(trimmed).map(inlines)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!.trim()).map(inlines))
        i++
      }
      i--
      out.push({ kind: 'table', head, rows })
      continue
    }

    // A list. An item may wrap onto the indented lines below it.
    const bullet = trimmed.match(/^[-*]\s+(.*)$/)
    const number = trimmed.match(/^\d+\.\s+(.*)$/)
    if (bullet || number) {
      flush()
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]!
        const t = l.trim()
        const b = t.match(/^[-*]\s+(.*)$/)
        const n = t.match(/^\d+\.\s+(.*)$/)
        if (b && bullet) items.push(b[1]!)
        else if (n && number) items.push(n[1]!)
        else if (t !== '' && /^\s+/.test(l) && items.length > 0) items[items.length - 1] += ' ' + t
        else break
        i++
      }
      i--
      out.push(
        bullet ? { kind: 'bullets', items: items.map(inlines) } : { kind: 'numbers', items: items.map(inlines) }
      )
      continue
    }

    para.push(trimmed)
  }

  flush()
  return out
}
