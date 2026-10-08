import { describe, it, expect } from 'vitest'
import { blocks, inlines } from '../../src/shared/markdown'

describe('the inline parts of a line', () => {
  it('keeps the text either side of a run of bold', () => {
    expect(inlines('press **S** to split')).toEqual([
      { kind: 'text', text: 'press ' },
      { kind: 'bold', text: 'S' },
      { kind: 'text', text: ' to split' }
    ])
  })

  it('reads a key out of backticks', () => {
    expect(inlines('press `Ctrl+E`')).toEqual([
      { kind: 'text', text: 'press ' },
      { kind: 'key', text: 'Ctrl+E' }
    ])
  })

  it('does not mistake bold for italic, which single stars would', () => {
    expect(inlines('**both**')).toEqual([{ kind: 'bold', text: 'both' }])
    expect(inlines('*one*')).toEqual([{ kind: 'italic', text: 'one' }])
  })

  it('takes several runs on one line', () => {
    expect(inlines('**a** and `B` and *c*').filter((p) => p.kind !== 'text')).toEqual([
      { kind: 'bold', text: 'a' },
      { kind: 'key', text: 'B' },
      { kind: 'italic', text: 'c' }
    ])
  })

  it('leaves a line with no markers as one piece of text', () => {
    expect(inlines('plain words')).toEqual([{ kind: 'text', text: 'plain words' }])
  })

  it('gives an empty line something to draw rather than nothing', () => {
    expect(inlines('')).toEqual([{ kind: 'text', text: '' }])
  })
})

describe('the blocks of an entry', () => {
  it('joins the lines of a wrapped paragraph into one', () => {
    const out = blocks('one two\nthree four')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ kind: 'para', text: [{ kind: 'text', text: 'one two three four' }] })
  })

  it('separates paragraphs on a blank line', () => {
    expect(blocks('one\n\ntwo').map((b) => b.kind)).toEqual(['para', 'para'])
  })

  it('reads a bullet list', () => {
    const out = blocks('- one\n- two')
    expect(out[0]).toEqual({
      kind: 'bullets',
      items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]]
    })
  })

  it('reads a numbered list, and does not call it bullets', () => {
    const out = blocks('1. one\n2. two')
    expect(out[0]!.kind).toBe('numbers')
  })

  it('joins an item that wraps onto an indented line', () => {
    const out = blocks('- one two\n  three')
    expect(out[0]).toEqual({ kind: 'bullets', items: [[{ kind: 'text', text: 'one two three' }]] })
  })

  it('ends a list at the paragraph after it', () => {
    expect(blocks('- one\n\nafter').map((b) => b.kind)).toEqual(['bullets', 'para'])
  })

  it('reads a table, and drops the dashed rule rather than making it a row', () => {
    const out = blocks('| Key | What |\n|---|---|\n| `S` | Split |\n| `O` | Trim |')
    expect(out).toHaveLength(1)
    const t = out[0]!
    expect(t.kind).toBe('table')
    if (t.kind !== 'table') return
    expect(t.head).toEqual([[{ kind: 'text', text: 'Key' }], [{ kind: 'text', text: 'What' }]])
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0]![0]).toEqual([{ kind: 'key', text: 'S' }])
  })

  it('takes a paragraph before and after a table', () => {
    expect(blocks('before\n\n| A |\n|---|\n| 1 |\n\nafter').map((b) => b.kind)).toEqual(['para', 'table', 'para'])
  })

  it('treats a lone line of pipes as text, since a table needs its rule', () => {
    expect(blocks('| not | a table |').map((b) => b.kind)).toEqual(['para'])
  })

  it('reads a real entry end to end', () => {
    const body = [
      'A paragraph with **bold** in it.',
      '',
      '- a bullet with `Ctrl+S`',
      '- another',
      '',
      '| Key | What |',
      '|---|---|',
      '| `S` | Split |',
      '',
      'A closing paragraph.'
    ].join('\n')
    expect(blocks(body).map((b) => b.kind)).toEqual(['para', 'bullets', 'table', 'para'])
  })
})

describe('chips', () => {
  it('reads [Label] as a chip, a control as the window names it', () => {
    expect(inlines('Choose [Save as asset].')).toEqual([
      { kind: 'text', text: 'Choose ' },
      { kind: 'chip', text: 'Save as asset' },
      { kind: 'text', text: '.' }
    ])
  })

  it('leaves a bracket inside a key alone, so `Alt+[` stays a key', () => {
    expect(inlines('`Alt+[` and `Alt+]`')).toEqual([
      { kind: 'key', text: 'Alt+[' },
      { kind: 'text', text: ' and ' },
      { kind: 'key', text: 'Alt+]' }
    ])
  })
})
