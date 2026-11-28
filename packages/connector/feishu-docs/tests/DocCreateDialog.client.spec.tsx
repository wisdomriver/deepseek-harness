// @vitest-environment jsdom
// New-document form: field values, submission, pending state, and failure copy.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocCreateDialog } from '../src/client/DocCreateDialog.tsx'
import { t } from './ui.client.ts'

afterEach(cleanup)

describe('DocCreateDialog', () => {
  it('submits the title and initial Markdown', () => {
    const onSubmit = vi.fn()
    render(
      <DocCreateDialog
        composer={{ open: true, pending: false }}
        t={t}
        parentName="Folder"
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Initial content (Markdown)' }), { target: { value: '# body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: 'New', content: '# body' })
    expect(screen.getByText(/Folder/)).toBeTruthy()
  })

  it('disables submission while the create runs', () => {
    render(
      <DocCreateDialog
        composer={{ open: true, pending: true }}
        t={t}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Creating…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
  })

  it('shows the create failure', () => {
    render(
      <DocCreateDialog
        composer={{ open: true, pending: false, errorCode: 'upstream' }}
        t={t}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText('Could not create the document; try again')).toBeTruthy()
  })

  it('submits a title alone when no initial content was typed', () => {
    const onSubmit = vi.fn()
    render(
      <DocCreateDialog
        composer={{ open: true, pending: false }}
        t={t}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText(/Location: My space/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: 'New' })
  })

  it('asks for a title when the create was refused for one', () => {
    render(
      <DocCreateDialog
        composer={{ open: true, pending: false, errorCode: 'invalid-input' }}
        t={t}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText('A title is required')).toBeTruthy()
  })

  it('cancels from the button and from Escape', () => {
    const onCancel = vi.fn()
    render(
      <DocCreateDialog
        composer={{ open: true, pending: false }}
        t={t}
        onCancel={onCancel}
        onSubmit={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
