// @vitest-environment jsdom
// Month grid presentation: fixed cells, weekday header, three-event fold, and chip selection.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthGrid } from '../src/client/MonthGrid.tsx'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import { monthKey, shiftMonth } from '../src/client/month.ts'
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
describe('MonthGrid accents', () => {
  it('paints a colored chip differently from a default one', () => {
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[
          event({ eventId: 'plain', summary: 'Plain', allDay: true, start: '2026-11-10', end: '2026-11-10' }),
          event({ eventId: 'colored', summary: 'Colored', allDay: true, start: '2026-11-10', end: '2026-11-10', colorIndex: (0xFF3F80FF | 0) }),
        ]}
        t={t}
        onOpenEvent={() => {}}
      />,
    )
    const plain = screen.getByRole('button', { name: /Plain/ }).className
    const colored = screen.getByRole('button', { name: /Colored/ }).className
    expect(colored).not.toBe(plain)
  })
})

describe('MonthGrid week start', () => {
  it('starts the header on the configured first column', () => {
    const { unmount } = render(<MonthGrid month="2026-11" weekStart="sunday" events={[]} t={t} onOpenEvent={() => {}} />)
    const format = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
    const sunday = format.format(new Date(Date.UTC(2024, 0, 1) - 86_400_000))
    expect(screen.getAllByRole('columnheader')[0]?.textContent).toBe(sunday)
    unmount()
    render(<MonthGrid month="2026-11" weekStart="monday" events={[]} t={t} onOpenEvent={() => {}} />)
    const monday = format.format(new Date(Date.UTC(2024, 0, 1)))
    expect(screen.getAllByRole('columnheader')[0]?.textContent).toBe(monday)
  })
})

describe('MonthGrid keyboard', () => {
  /** Render the November grid and return its cells; the first cell is 2026-10-26. */
  function grid(handlers: { onCreate?: (date: string) => void } = {}) {
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[]}
        t={t}
        onOpenEvent={() => {}}
        {...(handlers.onCreate === undefined ? {} : { onCreate: handlers.onCreate })}
      />,
    )
    return screen.getAllByRole('gridcell')
  }

  it('moves the roving focus with the four arrow keys and stops at the edges', () => {
    const cells = grid()
    fireEvent.keyDown(cells[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[1])
    fireEvent.keyDown(cells[1]!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cells[0])
    fireEvent.keyDown(cells[0]!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cells[0])
    fireEvent.keyDown(cells[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cells[7])
    fireEvent.keyDown(cells[7]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cells[0])
    fireEvent.keyDown(cells[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cells[0])
  })

  it('jumps to the ends of the row with Home and End', () => {
    const cells = grid()
    fireEvent.keyDown(cells[9]!, { key: 'Home' })
    expect(document.activeElement).toBe(cells[7])
    fireEvent.keyDown(cells[9]!, { key: 'End' })
    expect(document.activeElement).toBe(cells[13])
  })

  it('opens the create dialog for the focused day on Enter', () => {
    const onCreate = vi.fn()
    const cells = grid({ onCreate })
    fireEvent.keyDown(cells[9]!, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('2026-11-04')
  })

  it('opens the create dialog for a clicked cell but not for a click on its chips', () => {
    const onCreate = vi.fn()
    const cells = grid({ onCreate })
    fireEvent.click(cells[0]!)
    expect(onCreate).toHaveBeenCalledWith('2026-10-26')
    onCreate.mockClear()
    const chips = cells[0]!.querySelector('ul')
    fireEvent.click(chips as HTMLElement)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('ignores a key it does not handle', () => {
    const onCreate = vi.fn()
    const cells = grid({ onCreate })
    fireEvent.keyDown(cells[0]!, { key: 'Escape' })
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('MonthGrid roving focus', () => {
  it('starts on the first cell when the shown month holds no today', () => {
    render(<MonthGrid month={shiftMonth(monthKey(new Date()), 60)} weekStart="monday" events={[]} t={t} onOpenEvent={() => {}} />)
    const cells = screen.getAllByRole('gridcell')
    expect(cells[0]?.getAttribute('tabindex')).toBe('0')
    expect(cells[1]?.getAttribute('tabindex')).toBe('-1')
  })
})

describe('MonthGrid chips', () => {
  it('stands in a dash for an untitled event', () => {
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[event({ eventId: 'untitled', summary: '', allDay: true, start: '2026-11-10', end: '2026-11-10' })]}
        t={t}
        onOpenEvent={() => {}}
      />,
    )
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('offers no fold control when a day fits', () => {
    render(
      <MonthGrid
        month="2026-11"
        weekStart="monday"
        events={[event({ eventId: 'one', allDay: true, start: '2026-11-10', end: '2026-11-10' })]}
        t={t}
        onOpenEvent={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
  })
})
