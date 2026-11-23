// @vitest-environment jsdom
// Create dialog: required title, all-day bounds, overlap hint, and the submitted input.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateDialog } from '../src/client/CreateDialog.tsx'
import { localDay } from '../src/client/format.ts'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import type { CalendarEvent } from '../src/types.ts'

afterEach(cleanup)

const t = (key: CalendarLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

const today = localDay(new Date())

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'eventId' | 'start' | 'end'>): CalendarEvent {
  return {
    summary: overrides.eventId,
    allDay: false,
    sourceTimezone: 'Asia/Shanghai',
    status: 'confirmed',
    isException: false,
    ...overrides,
  }
}

describe('CreateDialog', () => {
  it('requires a title', () => {
    const onSubmit = vi.fn()
    render(<CreateDialog composer={{ open: true, mode: 'create', pending: false }} t={t} events={[]} onCancel={() => {}} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('A title is required')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a timed event with the browser timezone', () => {
    const onSubmit = vi.fn()
    render(<CreateDialog composer={{ open: true, mode: 'create', pending: false }} t={t} events={[]} onCancel={() => {}} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Standup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const input = onSubmit.mock.calls[0]?.[0]
    expect(input.summary).toBe('Standup')
    expect(input.allDay).toBe(false)
    expect(input.start).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof input.timezone).toBe('string')
  })

  it('sends date-only bounds for an all-day event and warns about the overlap', () => {
    const onSubmit = vi.fn()
    const blocking = event({ eventId: 'x', summary: 'Trip', allDay: true, start: today, end: today })
    render(
      <CreateDialog
        composer={{ open: true, mode: 'create', prefillDate: today, pending: false }}
        t={t}
        events={[blocking]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Offsite' } })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/This time already holds/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const input = onSubmit.mock.calls[0]?.[0]
    expect(input.allDay).toBe(true)
    expect(input.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(input.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('disables the actions while the create runs', () => {
    render(<CreateDialog composer={{ open: true, mode: 'create', pending: true }} t={t} events={[]} onCancel={() => {}} onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
  })
})
