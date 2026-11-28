// @vitest-environment jsdom
// Drawer presentation: metadata, outline, body preview, links, rename, block editing,
// conflict and partial banners, read-only resources, and the dirty-draft confirmation.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  })
})
