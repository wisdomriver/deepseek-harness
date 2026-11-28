// Block XML scanning: ids, plain text, editability, resource detection, and escaping.

import { describe, expect, it } from 'vitest'
import { escapeXmlText, isEditableTag, parseDocumentXml, renderBlockXml } from '../src/blocks.ts'

describe('parseDocumentXml', () => {
  it('reads the title and text blocks with decoded plain text', () => {
    const parsed = parseDocumentXml(
      '<title id="t1">Doc</title><h2 id="h1">A &amp; B</h2><p id="p1">Hello <b>world</b><br/>next</p>',
    )
    expect(parsed.title).toBe('Doc')
    expect(parsed.blocks).toEqual([
      { blockId: 'h1', tag: 'h2', text: 'A & B', editable: true },
      { blockId: 'p1', tag: 'p', text: 'Hello world\nnext', editable: true },
    ])
  })

  it('marks a text block holding a resource as not editable and lists the resource', () => {
    const parsed = parseDocumentXml('<p id="p1">text<img id="i1" src="x"/></p>')
    expect(parsed.blocks).toEqual([
      { blockId: 'i1', tag: 'img', text: '', editable: false },
      { blockId: 'p1', tag: 'p', text: 'text', editable: false },
    ])
  })

  it('keeps list items editable and skips the list container', () => {
    const parsed = parseDocumentXml('<ul><li id="l1">one</li><li id="l2"><code>x</code></li></ul>')
    expect(parsed.blocks).toEqual([
      { blockId: 'l1', tag: 'li', text: 'one', editable: true },
      { blockId: 'l2', tag: 'li', text: 'x', editable: true },
    ])
  })

  it('treats a nested paragraph in a quote as an editable block', () => {
    const parsed = parseDocumentXml('<blockquote id="q1"><p id="p2">quoted</p></blockquote>')
    expect(parsed.blocks).toEqual([{ blockId: 'p2', tag: 'p', text: 'quoted', editable: true }])
  })

  it('lists a table once, read-only, without its cell paragraphs', () => {
    const parsed = parseDocumentXml(
      '<table id="t1"><tbody><tr><td><p id="c1">cell</p></td></tr></tbody></table>',
    )
    expect(parsed.blocks).toEqual([{ blockId: 't1', tag: 'table', text: 'cell', editable: false }])
  })

  it('keeps unknown entities literal and reports a resource-only block', () => {
    const parsed = parseDocumentXml('<p id="p1">keep &nbsp; here</p><sheet id="s1" token="x"></sheet>')
    expect(parsed.blocks).toEqual([
      { blockId: 'p1', tag: 'p', text: 'keep &nbsp; here', editable: true },
      { blockId: 's1', tag: 'sheet', text: '', editable: false },
    ])
  })

  it('omits the title when the XML carries none', () => {
    expect(parseDocumentXml('<p id="p1">x</p>').title).toBeUndefined()
  })

  it('recognizes only the documented editable tags', () => {
    for (const tag of ['h1', 'h6', 'p', 'li', 'code', 'quote']) expect(isEditableTag(tag)).toBe(true)
    for (const tag of ['img', 'sheet', 'table', 'blockquote', 'title']) expect(isEditableTag(tag)).toBe(false)
  })
})

describe('block escaping', () => {
  it('escapes the five entities when writing a block back', () => {
    expect(escapeXmlText('a < b & "c" \'d\' > e')).toBe('a &lt; b &amp; &quot;c&quot; &#39;d&#39; &gt; e')
    expect(renderBlockXml('p', '<tag>')).toBe('<p>&lt;tag&gt;</p>')
  })

  it('refuses to render a tag outside the whitelist', () => {
    expect(() => renderBlockXml('sheet', 'x')).toThrow(/not an editable block tag/)
  })
})
