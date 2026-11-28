// @vitest-environment jsdom
// Panel presentation: list rows, highlighted titles, five states, breadcrumbs, the edit lock,
// the search form, the view controls, the drawer, and the create form.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocPanel, DocPanelView } from '../src/client/DocPanel.tsx'
import type { DocsViewState } from '../src/client/controller.ts'
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

describe('DocPanelView entry', () => {
  it('reads the panel snapshot through the injected hook', () => {
    const useDocs = (select: (snapshot: DocsViewState) => DocsViewState): DocsViewState =>
      select(stateOf({ items: [ITEM] }))
    const element = DocPanel({ useDocs, t, actions: actionsStub() } as never)
    render(<>{element}</>)
    expect(screen.getByText('DSH').tagName).toBe('MARK')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })
})

describe('DocPanelView search and views', () => {
  it('submits the typed keyword and tracks every keystroke', () => {
    const search = vi.fn()
    render(<DocPanelView state={stateOf()} t={t} actions={actionsStub({ search })} />)
    const field = screen.getByRole('searchbox', { name: 'Search docs' })
    fireEvent.change(field, { target: { value: 'DSH' } })
    expect((field as HTMLInputElement).value).toBe('DSH')
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    expect(search).toHaveBeenCalledWith('DSH')
  })

  it('switches between the three views and marks the active one', () => {
    const setView = vi.fn()
    render(<DocPanelView state={stateOf()} t={t} actions={actionsStub({ setView })} />)
    expect(screen.getByRole('button', { name: 'Recent' }).getAttribute('aria-pressed')).toBe('true')
    for (const name of ['Search', 'My space', 'Recent']) {
      const segment = screen.getAllByRole('button', { name }).find(button => button.hasAttribute('aria-pressed'))
      fireEvent.click(segment as HTMLElement)
    }
    expect(setView.mock.calls).toEqual([['search'], ['files'], ['recent']])
  })

  it('changes the recent window and ordering', () => {
    const setDays = vi.fn()
    const setSort = vi.fn()
    render(<DocPanelView state={stateOf()} t={t} actions={actionsStub({ setDays, setSort })} />)
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'edit' } })
    expect(setDays).toHaveBeenCalledWith(7)
    expect(setSort).toHaveBeenCalledWith('edit')
  })

  it('changes the folder ordering and returns to the root', () => {
    const setOrderBy = vi.fn()
    const goRoot = vi.fn()
    render(
      <DocPanelView
        state={stateOf({ view: 'files', crumbs: [{ token: 'f1', name: 'Folder' }] })}
        t={t}
        actions={actionsStub({ setOrderBy, goRoot })}
      />,
    )
    fireEvent.change(screen.getByLabelText('Folder order'), { target: { value: 'CreatedTime' } })
    expect(setOrderBy).toHaveBeenCalledWith('CreatedTime')
    fireEvent.click(screen.getAllByRole('button', { name: 'My space' }).at(-1) as HTMLElement)
    expect(goRoot).toHaveBeenCalled()
  })

  it('offers no Back button at the cloud-space root', () => {
    render(<DocPanelView state={stateOf({ view: 'files', phase: 'empty' })} t={t} actions={actionsStub()} />)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByText('This folder is empty')).toBeTruthy()
  })

  it('sends the owned-only search filter', () => {
    const setMine = vi.fn()
    render(
      <DocPanelView state={stateOf({ view: 'search' })} t={t} actions={actionsStub({ setMine })} />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Owned by me' }))
    expect(setMine).toHaveBeenCalledWith(true)
  })
})

describe('DocPanelView loading and paging', () => {
  it('shows the loading notice', () => {
    render(<DocPanelView state={stateOf({ phase: 'loading', items: [ITEM] })} t={t} actions={actionsStub()} />)
    expect(screen.getByRole('status').textContent).toBe('Loading docs…')
  })

  it('offers the next page and marks the button while that page loads', () => {
    const loadMore = vi.fn()
    const idle = render(
      <DocPanelView
        state={stateOf({ hasMore: true, pageToken: 'p2' })}
        t={t}
        actions={actionsStub({ loadMore })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadMore).toHaveBeenCalled()
    idle.unmount()
    render(
      <DocPanelView
        state={stateOf({ hasMore: true, pageToken: 'p2', loadingMore: true })}
        t={t}
        actions={actionsStub()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Loading docs…' })).toHaveProperty('disabled', true)
  })

  it('offers no next page when the service reported none', () => {
    render(<DocPanelView state={stateOf({ hasMore: false })} t={t} actions={actionsStub()} />)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})

describe('DocPanelView states', () => {
  it('names an unconfigured app instead of a missing connection', () => {
    render(
      <DocPanelView
        state={stateOf({ phase: 'disconnected', errorCode: 'not-configured' })}
        t={t}
        actions={actionsStub()}
      />,
    )
    expect(screen.getByText('No Feishu app is configured yet')).toBeTruthy()
  })

  it('shows the permission card without a scope list when none are missing', () => {
    render(<DocPanelView state={stateOf({ phase: 'permission' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('The Feishu app is missing document permissions')).toBeTruthy()
    expect(screen.queryByText(/Missing permissions/)).toBeNull()
  })

  it('lists the missing scopes beside an unavailable panel', () => {
    render(
      <DocPanelView
        state={stateOf({ phase: 'no-cli', missingScopes: ['wiki:node:read'] })}
        t={t}
        actions={actionsStub()}
      />,
    )
    expect(screen.getByText(/wiki:node:read/)).toBeTruthy()
  })

  it('shows the empty recent copy', () => {
    render(<DocPanelView state={stateOf({ phase: 'empty' })} t={t} actions={actionsStub()} />)
    expect(screen.getByText('No documents opened recently')).toBeTruthy()
  })
})

describe('DocPanelView overlays', () => {
  it('opens the drawer for the selected document', () => {
    const closeDoc = vi.fn()
    render(
      <DocPanelView
        state={stateOf({ selection: { item: ITEM, phase: 'ready', editing: false } })}
        t={t}
        actions={actionsStub({ closeDoc })}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'DSH workflow' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeDoc).toHaveBeenCalled()
  })

  it('opens the create form under the browsed folder and wires its callbacks', () => {
    const closeCreate = vi.fn()
    const submitCreate = vi.fn()
    render(
      <DocPanelView
        state={stateOf({
          view: 'files',
          crumbs: [{ token: 'f1', name: 'Folder' }],
          composer: { open: true, pending: false, parentToken: 'f1' },
        })}
        t={t}
        actions={actionsStub({ closeCreate, submitCreate })}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'New document' })).toBeTruthy()
    expect(screen.getByText(/Location: Folder/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(submitCreate).toHaveBeenCalledWith({ title: 'New' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closeCreate).toHaveBeenCalled()
  })

  it('places a new document at the cloud-space root when no folder is open', () => {
    render(
      <DocPanelView
        state={stateOf({ composer: { open: true, pending: false } })}
        t={t}
        actions={actionsStub()}
      />,
    )
    expect(screen.getByText(/Location: My space/)).toBeTruthy()
  })
})
