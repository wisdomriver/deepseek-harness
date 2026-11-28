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
})
