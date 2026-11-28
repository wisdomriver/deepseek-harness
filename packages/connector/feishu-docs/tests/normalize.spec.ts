// Pure normalization: search highlighting, type mapping, and code-point bounds.

import { describe, expect, it } from 'vitest'
import {
  codePointLength,
  docTypeOf,
  isSearchType,
  parseHighlighted,
  textOf,
  truncateAt,
} from '../src/normalize.ts'

describe('parseHighlighted', () => {
  it('keeps unhighlighted text as one segment', () => {
    expect(parseHighlighted('Plain title')).toEqual([{ text: 'Plain title', highlighted: false }])
  })

  it('splits highlighted runs from the surrounding text', () => {
    expect(parseHighlighted('<h>DSH</h> 工作流 <h>插件</h>')).toEqual([
      { text: 'DSH', highlighted: true },
      { text: ' 工作流 ', highlighted: false },
      { text: '插件', highlighted: true },
    ])
  })

  it('decodes the five entities and drops empty runs', () => {
    expect(parseHighlighted('&lt;h&gt; &amp; <h></h>x')).toEqual([
      { text: '<h> & ', highlighted: false },
      { text: 'x', highlighted: false },
    ])
  })

  it('decodes the quoted entity and the apostrophe numeric form', () => {
    expect(parseHighlighted('&quot;a&quot; &#39;b&#39;')).toEqual([
      { text: '"a" \'b\'', highlighted: false },
    ])
  })
})

describe('textOf', () => {
  it('joins decoded segments back into plain title text', () => {
    expect(textOf([
      { text: 'DSH', highlighted: true },
      { text: ' 工作流', highlighted: false },
    ])).toBe('DSH 工作流')
  })
})

describe('docTypeOf', () => {
  it('maps entity and doc types onto the panel names', () => {
    expect(docTypeOf('WIKI', 'DOCX', undefined)).toBe('wiki')
    expect(docTypeOf('DOC', 'DOCX', undefined)).toBe('docx')
    expect(docTypeOf('', undefined, 'SHEET')).toBe('sheet')
    expect(docTypeOf('', undefined, 'Folder')).toBe('folder')
    expect(docTypeOf('', '', undefined)).toBe('file')
  })

  it('falls back to file when neither field names a type', () => {
    expect(docTypeOf(undefined, undefined, undefined)).toBe('file')
  })

  it('reads the first type of a comma-separated list and ignores blank entries', () => {
    expect(docTypeOf('', 'DOCX, SHEET', undefined)).toBe('docx')
    expect(docTypeOf('', ',', undefined)).toBe('file')
  })

  it('validates search types', () => {
    expect(isSearchType('docx')).toBe(true)
    expect(isSearchType('unknown')).toBe(false)
  })
})

describe('truncateAt', () => {
  it('leaves short text unchanged', () => {
    expect(truncateAt('abc', 3)).toEqual({ text: 'abc', truncated: false })
  })

  it('cuts at a code-point bound without splitting a surrogate pair', () => {
    const text = '😀😀😀😀'
    expect(truncateAt(text, 3)).toEqual({ text: '😀😀😀', truncated: true })
    expect(codePointLength(text)).toBe(4)
  })
})
