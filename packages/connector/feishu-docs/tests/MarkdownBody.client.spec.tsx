// @vitest-environment jsdom
// Markdown preview rendering: headings, paragraphs, quotes, lists, code, tables, and the
// inline bold, code, and link runs the body renders as text.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownBody } from '../src/client/MarkdownBody.tsx'

afterEach(cleanup)

/**
 * Render one body and return its container.
 * @param text - Markdown source.
 * @param emptyLabel - copy shown for a body with no block.
 * @returns the rendered container.
 */
function body(text: string, emptyLabel = 'No body'): HTMLElement {
  return render(<MarkdownBody text={text} emptyLabel={emptyLabel} />).container
}

describe('MarkdownBody blocks', () => {
  it('renders each heading level as its own element', () => {
    const container = body('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six')
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['H1', 'One'], ['H2', 'Two'], ['H3', 'Three'], ['H4', 'Four'], ['H5', 'Five'], ['H6', 'Six'],
    ]
    expect(expected.map(([tag]) => container.querySelector(tag)?.textContent)).toEqual(
      expected.map(([, text]) => text),
    )
  })

  it('renders a paragraph with its inline runs', () => {
    body('first line\nsecond line')
    expect(screen.getByText(/first line/).textContent).toBe('first line\nsecond line')
  })

  it('renders a block quote and both list kinds', () => {
    const container = body('> quoted\n\n- one\n- two\n\n1. first\n2. second')
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('renders a fence as preformatted code text', () => {
    const container = body('```\nconst x = 1\n```')
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 1')
  })

  it('shows the empty copy for a body without any renderable block', () => {
    body('\n   \n', 'This document has no body yet')
    expect(screen.getByText('This document has no body yet')).toBeTruthy()
  })
})

describe('MarkdownBody tables', () => {
  it('renders the first row as the header when body rows follow', () => {
    const container = body('| 诉求 | 推荐 |\n|---|---|\n| 阶段 | dsh-process |')
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody td')).toHaveLength(2)
    expect(screen.getByText('阶段').closest('td')).not.toBeNull()
    expect(screen.getByText('推荐').closest('th')).not.toBeNull()
  })

  it('renders a single-row table as one body row without a header', () => {
    const container = body('| only |\n|---|')
    expect(container.querySelector('thead')).toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelectorAll('tbody td')).toHaveLength(1)
  })

  it('renders inline runs inside table cells', () => {
    body('| **bold** | `code` |\n|---|---|\n| [docs](https://example.test/a) | plain |')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('https://example.test/a')
  })

  it('renders nothing for a malformed table made only of separator rows', () => {
    const container = body('|---|\n|---|')
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toBe('')
  })
})

describe('MarkdownBody inline safety', () => {
  it('renders an absolute link as an external anchor', () => {
    body('see [docs](https://example.test/a)')
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('href')).toBe('https://example.test/a')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('keeps a relative link as text instead of an anchor', () => {
    const container = body('[x](/relative)')
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('[x](/relative)')).toBeTruthy()
  })

  it('renders bold spans and inline code as text, never as HTML', () => {
    const container = body('**<b>定位</b>** and `<i>x</i>`')
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('i')).toBeNull()
    expect(screen.getByText('<b>定位</b>').tagName).toBe('STRONG')
    expect(screen.getByText('<i>x</i>').tagName).toBe('CODE')
  })
})
