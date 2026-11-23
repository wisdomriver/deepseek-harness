// @vitest-environment jsdom
// Month grid presentation: fixed cells, weekday header, three-event fold, and chip selection.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthGrid } from '../src/client/MonthGrid.tsx'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import type { CalendarEvent } from '../src/types.ts'

afterEach(cleanup)

const t = (key: CalendarLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

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

describe('MonthGrid', () => {
  it('renders the 42-cell grid with the Monday-first header', () => {
    render(<MonthGrid month="2026-11" weekStart="monday" events={[]} t={t} onOpenEvent={() => {}} />)
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
    const headers = screen.getAllByRole('columnheader').map(node => node.textContent)
    expect(headers).toHaveLength(7)
    expect(new Set(headers).size).toBe(7)
  })

  it('folds a busy day at three chips and opens the rest on demand', () => {
    const busy = Array.from({ length: 5 }, (_, index) => event({
      eventId: `e${index}`,
      summary: `Event ${index}`,
      allDay: true,
      start: '2026-11-10',
      end: '2026-11-10',
    }))
    render(<MonthGrid month="2026-11" weekStart="monday" events={busy} t={t} onOpenEvent={() => {}} />)
    expect(screen.getByText('Event 2')).toBeTruthy()
    expect(screen.queryByText('Event 3')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2 more' }))
    expect(screen.getByText('Event 4')).toBeTruthy()
  })

  it('opens the pressed event', () => {
    const onOpenEvent = vi.fn()
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[event({ eventId: 'e1', summary: 'Sync', start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T11:00:00+08:00' })]}
        t={t}
        onOpenEvent={onOpenEvent}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }))
    expect(onOpenEvent).toHaveBeenCalledWith('e1')
  })

  it('shows all-day events with the all-day tag and timed ones with their clock', () => {
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[
          event({ eventId: 'all', summary: 'Holiday', allDay: true, start: '2026-11-10', end: '2026-11-10' }),
          event({ eventId: 'timed', summary: 'Standup', start: '2026-11-10T09:00:00+08:00', end: '2026-11-10T09:30:00+08:00' }),
        ]}
        t={t}
        onOpenEvent={() => {}}
      />,
    )
    expect(screen.getAllByText('All day')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Standup/ })).toBeTruthy()
  })
})
