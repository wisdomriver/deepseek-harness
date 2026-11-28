// Pure normalization: search highlighting, type mapping, and code-point bounds.

import { describe, expect, it } from 'vitest'
import { codePointLength, docTypeOf, isSearchType, parseHighlighted, truncateAt } from '../src/normalize.ts'

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
})

describe('docTypeOf', () => {
  it('maps entity and doc types onto the panel names', () => {
    expect(docTypeOf('WIKI', 'DOCX', undefined)).toBe('wiki')
    expect(docTypeOf('DOC', 'DOCX', undefined)).toBe('docx')
    expect(docTypeOf('', undefined, 'SHEET')).toBe('sheet')
    expect(docTypeOf('', undefined, 'Folder')).toBe('folder')
    expect(docTypeOf('', '', undefined)).toBe('file')
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
