// @vitest-environment jsdom
// Panel presentation: list rows, highlighted titles, five states, breadcrumbs, and the edit lock.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocPanelView } from '../src/client/DocPanel.tsx'
import type { DocItem } from '../src/types.ts'
import { actionsStub, stateOf, t } from './ui.client.ts'

afterEach(cleanup)

/** One listed document with highlighted title segments. */
const ITEM: DocItem = {
  token: 'd1',
  title: [
    { text: 'DSH', highlighted: true },
    { text: ' workflow', highlighted: false },
  ],
  type: 'docx',
  entityType: 'DOC',
  isFolder: false,
  url: 'https://example.test/docx/d1',
  ownerName: 'Ada',
  updatedAt: '2026-11-25T23:12:18+08:00',
}

describe('DocPanelView list', () => {
  it('renders the highlighted title, owner, time, and type', () => {
    render(<DocPanelView state={stateOf({ items: [ITEM] })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('DSH').tagName).toBe('MARK')
    expect(screen.getByText(/workflow/)).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Document')).toBeTruthy()
  })

  it('opens the row the user activates', () => {
    const openDoc = vi.fn()
    render(<DocPanelView state={stateOf({ items: [ITEM] })} t={t} actions={actionsStub({ openDoc })} />)
    fireEvent.click(screen.getByRole('button', { name: /DSH/ }))
    expect(openDoc).toHaveBeenCalledWith(ITEM)
  })

  it('shows the search empty state with its hint', () => {
    render(<DocPanelView state={stateOf({ view: 'search', query: 'nothing', phase: 'empty' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText(/No documents match/)).toBeTruthy()
    expect(screen.getByText(/Try removing/)).toBeTruthy()
  })

  it('asks for a keyword before searching', () => {
    render(<DocPanelView state={stateOf({ view: 'search', phase: 'empty' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('Type a keyword to search')).toBeTruthy()
  })

  it('warns instead of searching past 30 characters', () => {
    render(<DocPanelView state={stateOf({ view: 'search', query: 'a'.repeat(31), phase: 'empty' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('The search is limited to 30 characters')).toBeTruthy()
  })
})

describe('DocPanelView states', () => {
  it('shows the missing-CLI card and retries', () => {
    const refresh = vi.fn()
    render(<DocPanelView state={stateOf({ phase: 'no-cli' })} t={t} actions={actionsStub({ refresh })} />)
    expect(screen.getByText(/lark-cli is missing/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('lists the scopes the token lacks', () => {
    render(
      <DocPanelView
        state={stateOf({ phase: 'permission', missingScopes: ['docs:document.content:read'] })}
        t={t}
        actions={actionsStub()}
      />,
    )
    expect(screen.getByText(/missing document permissions/i)).toBeTruthy()
    expect(screen.getByText(/docs:document.content:read/)).toBeTruthy()
  })

  it('shows the disconnected copy', () => {
    render(<DocPanelView state={stateOf({ phase: 'disconnected' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('Connect Feishu to see your docs')).toBeTruthy()
  })

  it('shows the error copy with a retry', () => {
    render(<DocPanelView state={stateOf({ phase: 'error' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('Could not read your docs')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('DocPanelView folders and edit lock', () => {
  it('shows the breadcrumb and walks back through it', () => {
    const goBack = vi.fn()
    const goRoot = vi.fn()
    render(
      <DocPanelView
        state={stateOf({ view: 'files', crumbs: [{ token: 'f1', name: 'Folder' }], phase: 'empty' })}
        t={t}
        actions={actionsStub({ goBack, goRoot })}
      />,
    )
    expect(screen.getByText(/\/ Folder/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(goBack).toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'My space' }).at(-1) as HTMLElement)
    expect(goRoot).toHaveBeenCalled()
  })

  it('disables refresh and view changes while the editor is open', () => {
    const setView = vi.fn()
    render(
      <DocPanelView
        state={stateOf({
          selection: { item: ITEM, phase: 'ready', editing: true },
        })}
        t={t}
        actions={actionsStub({ setView })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true)
    const files = screen.getByRole('button', { name: 'My space' })
    expect(files).toHaveProperty('disabled', true)
    fireEvent.click(files)
    expect(setView).not.toHaveBeenCalled()
  })
})
