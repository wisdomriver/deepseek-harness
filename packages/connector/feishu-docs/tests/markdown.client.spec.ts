// Markdown grouping: outline headings, block kinds, and safe inline links.

import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, parseOutline } from '../src/client/markdown.ts'

describe('parseOutline', () => {
  it('lists headings with their levels', () => {
    expect(parseOutline('## A\n\ntext\n### B')).toEqual([
      { level: 2, text: 'A' },
      { level: 3, text: 'B' },
    ])
  })

  it('ignores non-heading lines', () => {
    expect(parseOutline('#not a heading\nplain')).toEqual([])
  })

  it('reads the sixth level and folds Windows newlines', () => {
    expect(parseOutline('###### Deep\r\n#Top')).toEqual([{ level: 6, text: 'Deep' }])
  })
})

describe('parseMarkdown', () => {
  it('groups headings, paragraphs, lists, quotes, and fenced code', () => {
    const nodes = parseMarkdown([
      '# Title',
      'First line',
      'second line',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '```',
      'const x = 1',
      '```',
    ].join('\n'))
    expect(nodes).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'First line\nsecond line' },
      { kind: 'list', ordered: false, items: ['one', 'two'] },
      { kind: 'quote', text: 'quoted' },
      { kind: 'code', text: 'const x = 1' },
    ])
  })

  it('keeps an ordered list ordered', () => {
    expect(parseMarkdown('1. a\n2. b')).toEqual([{ kind: 'list', ordered: true, items: ['a', 'b'] }])
  })

  it('joins the lines of one block quote', () => {
    expect(parseMarkdown('> first\n> second')).toEqual([{ kind: 'quote', text: 'first\nsecond' }])
  })

  it('reads an unclosed fence to the end of the body', () => {
    expect(parseMarkdown('```\nstill code')).toEqual([{ kind: 'code', text: 'still code' }])
  })

  it('returns no block for a blank or whitespace-only body', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n  \n')).toEqual([])
  })
})

describe('parseInline', () => {
  it('links only absolute http(s) targets', () => {
    expect(parseInline('see [docs](https://example.test/a) now')).toEqual([
      { text: 'see ' },
      { text: 'docs', href: 'https://example.test/a' },
      { text: ' now' },
    ])
    expect(parseInline('[x](/relative)')).toEqual([{ text: '[x](/relative)' }])
  })

  it('marks bold spans and inline code', () => {
    expect(parseInline('**定位**：用 `process_*` 推进')).toEqual([
      { text: '定位', emphasis: 'bold' },
      { text: '：用 ' },
      { text: 'process_*', emphasis: 'code' },
      { text: ' 推进' },
    ])
  })

  it('drops the trailing run when the text ends at a match', () => {
    expect(parseInline('**bold**')).toEqual([{ text: 'bold', emphasis: 'bold' }])
    expect(parseInline('`code`')).toEqual([{ text: 'code', emphasis: 'code' }])
  })

  it('keeps an unterminated marker literal', () => {
    expect(parseInline('**unfinished')).toEqual([{ text: '**unfinished' }])
  })
})

describe('parseMarkdown tables', () => {
  it('reads a pipe table without its separator row', () => {
    const nodes = parseMarkdown([
      '| 诉求 | 推荐 |',
      '|------|------|',
      '| 阶段化体验 | dsh-process |',
    ].join('\n'))
    expect(nodes).toEqual([
      { kind: 'table', rows: [['诉求', '推荐'], ['阶段化体验', 'dsh-process']] },
    ])
  })

  it('keeps a pipe line inside a paragraph when no separator follows', () => {
    const nodes = parseMarkdown('| not | a table |')
    expect(nodes).toEqual([{ kind: 'paragraph', text: '| not | a table |' }])
  })

  it('requires a dash in the separator row', () => {
    expect(parseMarkdown('| a | b |\n| : | : |')).toEqual([
      { kind: 'paragraph', text: '| a | b |\n| : | : |' },
    ])
  })

  it('keeps a table directly below a paragraph inside that paragraph', () => {
    expect(parseMarkdown('text\n| a |\n|---|')).toEqual([
      { kind: 'paragraph', text: 'text\n| a |\n|---|' },
    ])
  })

  it('reads a single-row table without a header row', () => {
    expect(parseMarkdown('| only |\n|---|')).toEqual([{ kind: 'table', rows: [['only']] }])
  })
})
