// @vitest-environment jsdom
// List presentation and type glyphs: highlighted runs, summary, metadata, and row activation.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocList } from '../src/client/DocList.tsx'
import { DocIcon, DocTypeGlyph } from '../src/client/DocIcon.tsx'
import type { DocItem } from '../src/types.ts'
import { t } from './ui.client.ts'

afterEach(cleanup)

/** One listed row. */
const ITEM: DocItem = {
  token: 'd1',
  title: [
    { text: 'DSH', highlighted: true },
    { text: ' workflow', highlighted: false },
  ],
  type: 'docx',
  entityType: 'DOC',
  isFolder: false,
}

/**
 * Build one list row over the shared item.
 * @param overrides - fields a case varies.
 * @returns the row.
 */
function rowOf(overrides: Partial<DocItem> = {}): DocItem {
  return { ...ITEM, ...overrides }
}

describe('DocList rows', () => {
  it('renders the highlighted title runs and the owner metadata', () => {
    const { container } = render(<DocList items={[rowOf({ ownerName: 'Ada' })]} t={t} onActivate={() => {}} />)
    expect(container.querySelector('mark')?.textContent).toBe('DSH')
    expect(container.textContent).toContain('DSH workflow')
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Document')).toBeTruthy()
  })

  it('renders a search summary with its highlighted runs', () => {
    render(<DocList
      items={[rowOf({
        summary: [
          { text: 'run', highlighted: true },
          { text: ' the workflow', highlighted: false },
        ],
      })]}
      t={t}
      onActivate={() => {}}
    />)
    expect(screen.getByText('run').tagName).toBe('MARK')
    expect(screen.getByText(/the workflow/)).toBeTruthy()
  })

  it('omits an empty summary and a missing owner', () => {
    render(<DocList items={[rowOf({ summary: [] })]} t={t} onActivate={() => {}} />)
    expect(screen.queryByText('Ada')).toBeNull()
    expect(screen.getByText('DSH')).toBeTruthy()
  })

  it('shows the update time and falls back to the last open time', () => {
    const { updatedAt: _updated, ...unupdated } = rowOf({ token: 'd2' })
    const { container } = render(<DocList
      items={[
        rowOf({ updatedAt: '2026-11-25T23:12:18+08:00' }),
        { ...unupdated, lastOpenedAt: '2026-11-26T08:13:11+08:00' },
      ]}
      t={t}
      onActivate={() => {}}
    />)
    const times = [...container.querySelectorAll('button > span')]
      .map(span => span.textContent ?? '')
      .filter(text => text.includes('2026'))
    expect(times).toHaveLength(2)
  })

  it('activates the row the user clicks, including a folder', () => {
    const onActivate = vi.fn()
    render(<DocList
      items={[rowOf({ token: 'f1', type: 'folder', isFolder: true, title: [{ text: 'Folder', highlighted: false }] })]}
      t={t}
      onActivate={onActivate}
    />)
    fireEvent.click(screen.getByRole('button', { name: /Folder/ }))
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ token: 'f1', isFolder: true }))
    expect(screen.getAllByText('Folder').length).toBeGreaterThanOrEqual(1)
  })
})

describe('DocTypeGlyph', () => {
  it('draws one decorative glyph for every known type', () => {
    const types = ['docx', 'sheet', 'base', 'bitable', 'slides', 'mindnote', 'wiki', 'folder', 'file']
    const glyphs = types.map((type) => {
      const { container, unmount } = render(<DocTypeGlyph type={type} size={20} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      expect(svg?.getAttribute('width')).toBe('20')
      const markup = svg?.innerHTML ?? ''
      unmount()
      return [type, markup] as const
    })
    expect(glyphs.every(([, markup]) => markup !== '')).toBe(true)
    const byType = new Map(glyphs)
    expect(byType.get('base')).toBe(byType.get('bitable'))
    expect(byType.get('folder')).not.toBe(byType.get('docx'))
    expect(new Set(glyphs.map(([, markup]) => markup)).size).toBe(7)
  })

  it('falls back to the document glyph for an unknown type', () => {
    const known = render(<DocTypeGlyph type="docx" />).container.querySelector('svg')?.innerHTML
    cleanup()
    const unknown = render(<DocTypeGlyph type="whiteboard" />).container.querySelector('svg')?.innerHTML
    expect(unknown).toBe(known)
  })
})

describe('DocIcon', () => {
  it('draws the sidebar entry glyph at the owner size', () => {
    const { container } = render(DocIcon({ size: 18 } as never))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('18')
    expect(svg?.getAttribute('height')).toBe('18')
    expect(svg?.querySelectorAll('path')).toHaveLength(2)
  })
})
