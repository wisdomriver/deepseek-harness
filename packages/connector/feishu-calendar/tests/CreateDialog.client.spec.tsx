// @vitest-environment jsdom
// Create dialog: required title, all-day bounds, overlap hint, and the submitted input.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateDialog } from '../src/client/CreateDialog.tsx'
import { localDay } from '../src/client/format.ts'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import type { CalendarEvent, CreateEventInput, RecurrenceScope } from '../src/types.ts'

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

  it('reports the failure the controller folded back', () => {
    render(
      <CreateDialog
        composer={{ open: true, mode: 'create', pending: false, errorCode: 'upstream' }}
        t={t}
        events={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Could not save the event; try again')
  })
})

describe('CreateDialog validation', () => {
  /** Render the create form over one submit spy. */
  function form(onSubmit: (input: CreateEventInput, applyTo?: RecurrenceScope) => void) {
    return render(<CreateDialog composer={{ open: true, mode: 'create', pending: false }} t={t} events={[]} onCancel={() => {}} onSubmit={onSubmit} />)
  }

  it('refuses a title over a hundred characters', () => {
    const onSubmit = vi.fn()
    form(onSubmit)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'a'.repeat(101) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toBe('The title is limited to 100 characters')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses details over five thousand characters', () => {
    const onSubmit = vi.fn()
    form(onSubmit)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Trip' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Details' }), { target: { value: 'd'.repeat(5001) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toBe('Details are limited to 5000 characters')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses an all-day end before its start', () => {
    const onSubmit = vi.fn()
    const { container } = form(onSubmit)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Trip' } })
    fireEvent.click(screen.getByRole('checkbox'))
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLElement[]
    fireEvent.change(dates[0] as HTMLElement, { target: { value: '2026-12-20' } })
    fireEvent.change(dates[1] as HTMLElement, { target: { value: '2026-12-19' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toBe('The end must be later than the start')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses a timed end before its start', () => {
    const onSubmit = vi.fn()
    const { container } = form(onSubmit)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Standup' } })
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLElement[]
    const times = [...container.querySelectorAll('input[type="time"]')] as HTMLElement[]
    fireEvent.change(dates[0] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(times[0] as HTMLElement, { target: { value: '10:00' } })
    fireEvent.change(dates[1] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(times[1] as HTMLElement, { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toBe('The end must be later than the start')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a timed event with edited bounds and no empty description', () => {
    const onSubmit = vi.fn()
    const { container } = form(onSubmit)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Standup' } })
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLElement[]
    const times = [...container.querySelectorAll('input[type="time"]')] as HTMLElement[]
    fireEvent.change(dates[0] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(dates[1] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(times[0] as HTMLElement, { target: { value: '09:00' } })
    fireEvent.change(times[1] as HTMLElement, { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const input = onSubmit.mock.calls[0]?.[0] as CreateEventInput
    expect(input.start).toMatch(/^2026-11-20T/)
    expect(input.end).toMatch(/^2026-11-20T/)
    expect(input).not.toHaveProperty('description')
    expect(onSubmit.mock.calls[0]?.[1]).toBeUndefined()
  })
})

describe('CreateDialog edit mode', () => {
  const DETAIL = {
    eventId: 'e1',
    summary: 'Sync',
    allDay: false,
    start: '2026-11-25T10:00:00+08:00',
    end: '2026-11-25T10:30:00+08:00',
    sourceTimezone: 'Asia/Shanghai',
    status: 'confirmed',
    isException: false,
    organizer: 'Ada',
    description: 'Agenda',
    recurringEventId: 'master_0',
  }

  it('starts from the edited event and offers the series scope', () => {
    const onSubmit = vi.fn()
    render(<CreateDialog composer={{ open: true, mode: 'edit', target: DETAIL, pending: false }} t={t} events={[]} onCancel={() => {}} onSubmit={onSubmit} />)
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' }).value).toBe('Sync')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Details' }).value).toBe('Agenda')
    expect(screen.getByRole('combobox')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'this-and-following' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[1]).toBe('this-and-following')
  })

  it('starts from an all-day event and sends date bounds with the series scope', () => {
    const onSubmit = vi.fn()
    render(
      <CreateDialog
        composer={{ open: true, mode: 'edit', target: { ...DETAIL, allDay: true, start: '2026-11-25', end: '2026-11-26' }, pending: false }}
        t={t}
        events={[]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const input = onSubmit.mock.calls[0]?.[0] as { allDay: boolean; start: string; description: string }
    expect(input.allDay).toBe(true)
    expect(input.start).toBe('2026-11-25')
    expect(input.description).toBe('Agenda')
    // An all-day series edit is whole-series only, so the scope selector stays out of the dialog.
    expect(onSubmit.mock.calls[0]?.[1]).toBeUndefined()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('starts from an all-day event that carries no details', () => {
    const { description: _dropped, ...withoutDescription } = DETAIL
    const onSubmit = vi.fn()
    render(
      <CreateDialog
        composer={{ open: true, mode: 'edit', target: { ...withoutDescription, allDay: true, start: '2026-11-25', end: '2026-11-26' }, pending: false }}
        t={t}
        events={[]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Details' }).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('description')
  })

  it('starts from an edited event without a description', () => {
    const { description: _dropped, ...withoutDescription } = DETAIL
    const { container } = render(
      <CreateDialog
        composer={{ open: true, mode: 'edit', target: withoutDescription, pending: false }}
        t={t}
        events={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Details' }).value).toBe('')
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[]
    const times = [...container.querySelectorAll('input[type="time"]')] as HTMLInputElement[]
    // The timed target's own bounds seed the date and clock inputs.
    expect(dates[0]?.value).toBe(localDay(new Date(withoutDescription.start)))
    expect(times[0]?.value).toMatch(/^\d{2}:\d{2}$/)
    expect(dates[1]?.value).toBe(localDay(new Date(withoutDescription.end)))
  })
})

describe('CreateDialog overlap hint', () => {
  it('names a timed event the new bounds would overlap', () => {
    const timed = event({ eventId: 'other', summary: 'Review', start: '2026-11-20T09:30:00+08:00', end: '2026-11-20T10:30:00+08:00' })
    const { container } = render(
      <CreateDialog composer={{ open: true, mode: 'create', prefillDate: '2026-11-20', pending: false }} t={t} events={[timed]} onCancel={() => {}} onSubmit={() => {}} />,
    )
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLElement[]
    const times = [...container.querySelectorAll('input[type="time"]')] as HTMLElement[]
    fireEvent.change(dates[0] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(dates[1] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(times[0] as HTMLElement, { target: { value: '10:00' } })
    fireEvent.change(times[1] as HTMLElement, { target: { value: '11:00' } })
    expect(screen.getByText(/Review/)).toBeTruthy()
  })

  it('reports no overlap for an event that ends before the new one starts or starts after it ends', () => {
    const before = event({ eventId: 'before', summary: 'Early', start: '2026-11-20T08:00:00+08:00', end: '2026-11-20T09:00:00+08:00' })
    const after = event({ eventId: 'after', summary: 'Late', start: '2026-11-20T12:00:00+08:00', end: '2026-11-20T13:00:00+08:00' })
    const { container } = render(
      <CreateDialog composer={{ open: true, mode: 'create', prefillDate: '2026-11-20', pending: false }} t={t} events={[before, after]} onCancel={() => {}} onSubmit={() => {}} />,
    )
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLElement[]
    const times = [...container.querySelectorAll('input[type="time"]')] as HTMLElement[]
    fireEvent.change(dates[0] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(dates[1] as HTMLElement, { target: { value: '2026-11-20' } })
    fireEvent.change(times[0] as HTMLElement, { target: { value: '10:00' } })
    fireEvent.change(times[1] as HTMLElement, { target: { value: '11:00' } })
    expect(screen.queryByText(/This time already holds/)).toBeNull()
  })
})
