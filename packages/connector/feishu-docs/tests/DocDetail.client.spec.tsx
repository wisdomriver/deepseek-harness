// @vitest-environment jsdom
// Drawer presentation: metadata, outline, body preview, links, rename, block editing,
// conflict and partial banners, read-only resources, and the dirty-draft confirmation.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSelectionState } from '../src/client/controller.ts'
import { DocDetail } from '../src/client/DocDetail.tsx'
import type { DocItem } from '../src/types.ts'
import { actionsStub, t } from './ui.client.ts'

afterEach(cleanup)

/** The document the drawer addresses. */
const ITEM: DocItem = {
  token: 'd1',
  title: [{ text: 'Doc', highlighted: false }],
  type: 'docx',
  entityType: 'DOC',
  isFolder: false,
  url: 'https://example.test/docx/d1',
  ownerName: 'Ada',
  editorName: 'Bo',
  updatedAt: '2026-11-25T23:12:18+08:00',
}

/**
 * The drawer row without its update time.
 * @returns the row.
 */
function withoutUpdated(): DocItem {
  const { updatedAt: _updated, ...bare } = ITEM
  return bare
}

/** Build one drawer state. */
function selectionOf(overrides: Partial<DocSelectionState> = {}): DocSelectionState {
  return {
    item: ITEM,
    phase: 'ready',
    outline: '## Alpha\n### Beta',
    revisionId: 2,
    editing: false,
    ...overrides,
  }
}

describe('DocDetail preview', () => {
  it('shows metadata, the outline, and the Feishu link', () => {
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Bo')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open in Feishu' })
    expect(link.getAttribute('href')).toBe('https://example.test/docx/d1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('copies the link and confirms for two seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByText('Copied')
    expect(writeText).toHaveBeenCalledWith('https://example.test/docx/d1')
  })

  it('falls back to a selectable link when the clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByDisplayValue('https://example.test/docx/d1')
  })

  it('reads the full body on demand and marks truncation', () => {
    const viewFull = vi.fn()
    const collapsed = render(
      <DocDetail selection={selectionOf()} t={t} actions={actionsStub({ viewFull })} editable />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View body' }))
    expect(viewFull).toHaveBeenCalled()
    collapsed.unmount()
    render(
      <DocDetail
        selection={selectionOf({ full: '# Body\n\n- item', fullPhase: 'ready', truncated: true })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('Body')).toBeTruthy()
    expect(screen.getByText('item')).toBeTruthy()
    expect(screen.getByText(/truncated to the first 4000/)).toBeTruthy()
  })

  it('shows the empty body copy instead of a blank area', () => {
    render(<DocDetail selection={selectionOf({ full: '' })} t={t} actions={actionsStub()} editable />)
    expect(screen.getByText('This document has no body yet')).toBeTruthy()
  })
})

describe('DocDetail editing', () => {
  it('opens the editor from the preview', () => {
    const startEdit = vi.fn()
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub({ startEdit })} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit content' }))
    expect(startEdit).toHaveBeenCalled()
  })

  it('lists editable blocks and gives resource blocks no edit entry', () => {
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [
            { blockId: 'p1', tag: 'p', text: 'text', editable: true },
            { blockId: 'i1', tag: 'img', text: '', editable: false },
          ],
        })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
    expect(screen.getByText(/Contains a Feishu resource/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Append a paragraph' })).toBeTruthy()
  })

  it('keeps the draft and shows both conflict banners', () => {
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
          editor: { mode: 'block', blockId: 'p1', tag: 'p', text: 'draft', saving: false, errorCode: 'conflict' },
          banner: { kind: 'conflict', warnings: [] },
        })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByDisplayValue('draft')).toBeTruthy()
    expect(screen.getAllByText(/Someone else edited this document/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows partial-success warnings', () => {
    render(
      <DocDetail
        selection={selectionOf({ banner: { kind: 'partial', warnings: ['one skipped'] } })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText(/one skipped/)).toBeTruthy()
  })

  it('saves the draft through the action', () => {
    const saveDraft = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
          editor: { mode: 'block', blockId: 'p1', tag: 'p', text: 'changed', saving: false },
        })}
        t={t}
        actions={actionsStub({ saveDraft })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(saveDraft).toHaveBeenCalled()
  })

  it('confirms before discarding a dirty draft or closing the drawer', () => {
    const closeDoc = vi.fn()
    const cancelDraft = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
          editor: { mode: 'block', blockId: 'p1', tag: 'p', text: 'changed', saving: false },
        })}
        t={t}
        actions={actionsStub({ closeDoc, cancelDraft })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Discard the unsaved changes?')).toBeTruthy()
    expect(cancelDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(cancelDraft).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeDoc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(closeDoc).toHaveBeenCalled()
  })

  it('renames the document and closes the form on success', async () => {
    const rename = vi.fn().mockResolvedValue(true)
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub({ rename })} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New title' }), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    await waitFor(() => { expect(rename).toHaveBeenCalledWith('New') })
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'New title' })).toBeNull() })
  })

  it('tells the user to edit unsupported types in Feishu', () => {
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable={false} />)
    expect(screen.getByText('Edit this type in Feishu')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit content' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  })
})

describe('DocDetail focus and closing', () => {
  it('closes on Escape when the drawer is clean', () => {
    const closeDoc = vi.fn()
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub({ closeDoc })} editable />)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeDoc).toHaveBeenCalledOnce()
  })

  it('stays open while a draft is saving', () => {
    const closeDoc = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
          editor: { mode: 'block', blockId: 'p1', tag: 'p', text: 'draft', saving: true },
        })}
        t={t}
        actions={actionsStub({ closeDoc })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeDoc).not.toHaveBeenCalled()
    expect(screen.queryByText('Discard the unsaved changes?')).toBeNull()
  })

  it('asks before closing a drawer holding an appended draft', () => {
    const closeDoc = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          editor: { mode: 'append', text: 'new paragraph', saving: false },
        })}
        t={t}
        actions={actionsStub({ closeDoc })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeDoc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(closeDoc).toHaveBeenCalled()
  })
})

describe('DocDetail link actions', () => {
  it('offers the link inline when the clipboard rejects the write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByDisplayValue('https://example.test/docx/d1')
  })

  it('returns the copy button to its idle label after two seconds', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    try {
      render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(2000) })
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('titles the drawer by its token when the row carries no title text', () => {
    render(
      <DocDetail selection={selectionOf({ item: { ...ITEM, title: [] } })} t={t} actions={actionsStub()} editable />,
    )
    expect(screen.getByRole('heading', { name: 'd1' })).toBeTruthy()
  })

  it('offers no link actions for a row without a URL', () => {
    const { url: _url, ...bare } = ITEM
    render(<DocDetail selection={selectionOf({ item: bare })} t={t} actions={actionsStub()} editable />)
    expect(screen.queryByRole('link', { name: 'Open in Feishu' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })
})

describe('DocDetail banners and fields', () => {
  it('shows the bare partial warning when the service sent none', () => {
    render(
      <DocDetail
        selection={selectionOf({ banner: { kind: 'partial', warnings: [] } })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('Some content was not written')).toBeTruthy()
  })

  it('reports a failed write in the drawer body', () => {
    render(<DocDetail selection={selectionOf({ errorCode: 'upstream' })} t={t} actions={actionsStub()} editable />)
    expect(screen.getByRole('alert').textContent).toContain('Could not read the document')
  })

  it('shows the last open time when the row has no update time', () => {
    render(
      <DocDetail
        selection={selectionOf({ item: { ...withoutUpdated(), lastOpenedAt: '2026-11-26T08:13:11+08:00' } })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('Opened')).toBeTruthy()
    expect(screen.queryByText('Updated')).toBeNull()
  })

  it('omits the metadata fields the row does not carry', () => {
    const { ownerName: _owner, editorName: _editor, updatedAt: _updated, ...bare } = ITEM
    render(<DocDetail selection={selectionOf({ item: bare })} t={t} actions={actionsStub()} editable />)
    expect(screen.queryByText('Owner')).toBeNull()
    expect(screen.queryByText('Last edited by')).toBeNull()
  })
})

describe('DocDetail read states', () => {
  it('shows the outline loading copy', () => {
    render(<DocDetail selection={selectionOf({ phase: 'loading' })} t={t} actions={actionsStub()} editable />)
    expect(screen.getByText('Loading document…')).toBeTruthy()
  })

  it('reports a failed outline read and retries it', () => {
    const retryDetail = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({ phase: 'error' })}
        t={t}
        actions={actionsStub({ retryDetail })}
        editable
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Could not read the document')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retryDetail).toHaveBeenCalled()
  })

  it('shows an empty outline notice for a document with no headings', () => {
    render(<DocDetail selection={selectionOf({ outline: '' })} t={t} actions={actionsStub()} editable />)
    expect(screen.getByText('This document has no outline')).toBeTruthy()
  })

  it('shows the body loading copy while the full read runs', () => {
    render(<DocDetail selection={selectionOf({ fullPhase: 'loading' })} t={t} actions={actionsStub()} editable />)
    expect(screen.getAllByText('Loading document…').length).toBeGreaterThanOrEqual(1)
  })

  it('reports a failed body read and retries it', () => {
    const viewFull = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({ fullPhase: 'error' })}
        t={t}
        actions={actionsStub({ viewFull })}
        editable
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Could not read the body')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(viewFull).toHaveBeenCalled()
  })
})

describe('DocDetail block editor states', () => {
  it('shows the block loading copy', () => {
    render(
      <DocDetail
        selection={selectionOf({ editing: true, blocksPhase: 'loading' })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('Loading blocks…')).toBeTruthy()
  })

  it('reports a failed block read and retries it', () => {
    const startEdit = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({ editing: true, blocksPhase: 'error' })}
        t={t}
        actions={actionsStub({ startEdit })}
        editable
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Could not read the blocks')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(startEdit).toHaveBeenCalled()
  })

  it('shows the empty block notice and the append entry', () => {
    render(
      <DocDetail
        selection={selectionOf({ editing: true, blocksPhase: 'ready', blocks: [] })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('This document has no editable blocks')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Append a paragraph' })).toBeTruthy()
  })

  it('marks an empty editable block', () => {
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: '', editable: true }],
        })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByText('(empty block)')).toBeTruthy()
  })

  it('hides the block editor for a read-only type', () => {
    render(
      <DocDetail
        selection={selectionOf({ editing: true, blocksPhase: 'ready' })}
        t={t}
        actions={actionsStub()}
        editable={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Append a paragraph' })).toBeNull()
  })
})

describe('DocDetail block actions', () => {
  it('opens one block draft', () => {
    const editBlock = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
        })}
        t={t}
        actions={actionsStub({ editBlock })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(editBlock).toHaveBeenCalledWith('p1')
  })

  it('confirms before deleting a block', () => {
    const deleteBlock = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
        })}
        t={t}
        actions={actionsStub({ deleteBlock })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteBlock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(deleteBlock).toHaveBeenCalledWith('p1')
  })

  it('closes the editor from the actions row', () => {
    const closeEdit = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({ editing: true, blocksPhase: 'ready', blocks: [] })}
        t={t}
        actions={actionsStub({ closeEdit })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(closeEdit).toHaveBeenCalled()
  })
})

describe('DocDetail editor', () => {
  it('saves an appended paragraph with its draft text', () => {
    const saveDraft = vi.fn()
    const updateDraft = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          editor: { mode: 'append', text: '', saving: false },
        })}
        t={t}
        actions={actionsStub({ saveDraft, updateDraft })}
        editable
      />,
    )
    expect(screen.getByPlaceholderText('Write Markdown')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Append a paragraph' }), { target: { value: '# new' } })
    expect(updateDraft).toHaveBeenCalledWith('# new')
    fireEvent.click(screen.getByRole('button', { name: 'Append' }))
    expect(saveDraft).toHaveBeenCalled()
  })

  it('shows the saving label and disables both editor actions while a draft saves', () => {
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          editor: { mode: 'append', text: 'draft', saving: true },
        })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('textbox', { name: 'Append a paragraph' })).toHaveProperty('disabled', true)
  })

  it('explains a conflict and the two other draft failures', () => {
    const cases: Array<[string, RegExp]> = [
      ['conflict', /Someone else edited this document/],
      ['invalid-input', /^The content is limited to 20000 characters$/],
      ['upstream', /^Could not save; try again$/],
    ]
    for (const [errorCode, copy] of cases) {
      const view = render(
        <DocDetail
          selection={selectionOf({
            editing: true,
            blocksPhase: 'ready',
            editor: { mode: 'append', text: 'draft', saving: false, errorCode },
          })}
          t={t}
          actions={actionsStub()}
          editable
        />,
      )
      expect(screen.getByText(copy)).toBeTruthy()
      view.unmount()
    }
  })

  it('cancels a clean draft immediately', () => {
    const cancelDraft = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          editor: { mode: 'append', text: '', saving: false },
        })}
        t={t}
        actions={actionsStub({ cancelDraft })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelDraft).toHaveBeenCalled()
    expect(screen.queryByText('Discard the unsaved changes?')).toBeNull()
  })

  it('keeps a changed draft when the user declines to discard it', () => {
    const cancelDraft = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          editor: { mode: 'append', text: 'draft', saving: false },
        })}
        t={t}
        actions={actionsStub({ cancelDraft })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Discard the unsaved changes?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(cancelDraft).not.toHaveBeenCalled()
    expect(screen.queryByText('Discard the unsaved changes?')).toBeNull()
  })
})

describe('DocDetail rename form', () => {
  it('keeps the form open when the rename fails', async () => {
    const rename = vi.fn().mockResolvedValue(false)
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub({ rename })} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New title' }), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    await waitFor(() => { expect(rename).toHaveBeenCalledWith('New') })
    expect(screen.getByRole('textbox', { name: 'New title' })).toBeTruthy()
  })

  it('closes the form when the user cancels the rename', () => {
    render(<DocDetail selection={selectionOf()} t={t} actions={actionsStub()} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'New title' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'New title' })).toBeNull()
  })

  it('explains an empty title and a failed rename', () => {
    const empty = render(
      <DocDetail
        selection={selectionOf({ renameState: { pending: false, errorCode: 'invalid-input' } })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('alert').textContent).toContain('A title is required')
    empty.unmount()
    render(
      <DocDetail
        selection={selectionOf({ renameState: { pending: false, errorCode: 'upstream' } })}
        t={t}
        actions={actionsStub()}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('alert').textContent).toContain('Could not rename the document')
  })

  it('asks before closing a drawer whose block draft no longer matches the loaded block', () => {
    const closeDoc = vi.fn()
    render(
      <DocDetail
        selection={selectionOf({
          editing: true,
          blocksPhase: 'ready',
          blocks: [{ blockId: 'p2', tag: 'p', text: 'other', editable: true }],
          editor: { mode: 'block', blockId: 'p1', tag: 'p', text: 'draft', saving: false },
        })}
        t={t}
        actions={actionsStub({ closeDoc })}
        editable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeDoc).not.toHaveBeenCalled()
    expect(screen.getByText('Discard the unsaved changes?')).toBeTruthy()
  })
})
