// @vitest-environment jsdom
// Create dialog: validation, the due-date modes, the description, the running state, the
// failure copy, and Escape.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateTaskDialog } from '../src/client/CreateTaskDialog.tsx'
import { dueInstant } from '../src/client/format.ts'
import { en, type TaskLocaleKey } from '../src/client/locales.ts'
import type { TaskComposer } from '../src/client/controller.ts'

afterEach(cleanup)

/** Localized copy resolved from the English dictionary. */
const t = (key: TaskLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

/**
 * Render the dialog.
 * @param composer - the dialog state, open and idle by default.
 * @returns the submit and cancel callbacks.
 */
function renderDialog(composer: TaskComposer = { open: true, pending: false }) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(<CreateTaskDialog composer={composer} t={t} onCancel={onCancel} onSubmit={onSubmit} />)
  return { onSubmit, onCancel }
}

/**
 * Type a title into the form.
 * @param value - title text.
 */
function typeTitle(value: string): void {
  fireEvent.change(screen.getByLabelText(en.createSummary), { target: { value } })
}

describe('CreateTaskDialog', () => {
  it('requires a title', () => {
    const { onSubmit } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(screen.getByRole('alert').textContent).toBe(en.titleRequired)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('limits the title to 200 characters', () => {
    const { onSubmit } = renderDialog()
    typeTitle('x'.repeat(201))
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(screen.getByRole('alert').textContent).toBe(en.titleTooLong)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('limits the description to 5000 characters', () => {
    const { onSubmit } = renderDialog()
    typeTitle('Ship it')
    fireEvent.change(screen.getByLabelText(en.createDescription), { target: { value: 'x'.repeat(5001) } })
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(screen.getByRole('alert').textContent).toBe(en.descriptionTooLong)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a title alone', () => {
    const { onSubmit } = renderDialog()
    typeTitle('  Buy milk  ')
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(onSubmit).toHaveBeenCalledWith({ summary: 'Buy milk' })
  })

  it('submits an all-day due as the chosen date', () => {
    const { onSubmit } = renderDialog()
    typeTitle('Buy milk')
    fireEvent.change(screen.getByLabelText(en.createDue), { target: { value: '2026-12-02' } })
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(onSubmit).toHaveBeenCalledWith({ summary: 'Buy milk', due: '2026-12-02', allDay: true })
  })

  it('submits a timed due as an instant at the end of the local day', () => {
    const { onSubmit } = renderDialog()
    typeTitle('Buy milk')
    fireEvent.change(screen.getByLabelText(en.createDue), { target: { value: '2026-12-02' } })
    fireEvent.click(screen.getByLabelText(en.createAllDay))
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(onSubmit).toHaveBeenCalledWith({
      summary: 'Buy milk',
      due: dueInstant('2026-12-02'),
      allDay: false,
    })
  })

  it('disables the all-day switch until a due date is chosen', () => {
    renderDialog()
    const allDay = screen.getByLabelText(en.createAllDay)
    expect(allDay.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText(en.createDue), { target: { value: '2026-12-02' } })
    expect(allDay.hasAttribute('disabled')).toBe(false)
  })

  it('reports a failed create and cancels on Escape', () => {
    const { onCancel } = renderDialog({ open: true, pending: false, errorCode: 'unknown-outcome' })
    expect(screen.getByText(en.createFailed)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('sends the description with the title', () => {
    const { onSubmit } = renderDialog()
    typeTitle('Buy milk')
    fireEvent.change(screen.getByLabelText(en.createDescription), { target: { value: '2L, oat' } })
    fireEvent.click(screen.getByRole('button', { name: en.createSubmit }))
    expect(onSubmit).toHaveBeenCalledWith({ summary: 'Buy milk', description: '2L, oat' })
  })

  it('reports progress and holds the form while a create runs', () => {
    const { onSubmit } = renderDialog({ open: true, pending: true })
    expect(screen.getByRole('button', { name: en.createSaving }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.createCancel }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.createSaving }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
