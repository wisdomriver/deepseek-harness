// @vitest-environment jsdom
// Today's agenda strip: empty state, fold control, running badge, and open callback.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgendaStrip } from '../src/client/AgendaStrip.tsx'
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

describe('AgendaStrip', () => {
  it('reports an empty day', () => {
    render(<AgendaStrip events={[]} t={t} onOpen={() => {}} />)
    expect(screen.getByText('Nothing scheduled today')).toBeTruthy()
  })

  it('lists today rows, marks a running event, and opens it', () => {
    const onOpen = vi.fn()
    const now = Date.now()
    const running = new Date(now - 5 * 60_000).toISOString()
    const runningEnd = new Date(now + 5 * 60_000).toISOString()
    render(
      <AgendaStrip
        events={[
          event({ eventId: 'a', summary: 'Holiday', allDay: true, start: today, end: today }),
          event({ eventId: 'b', summary: 'Standup', start: running, end: runningEnd }),
        ]}
        t={t}
        onOpen={onOpen}
      />,
    )
    expect(screen.getByText('In progress')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Standup/ }))
    expect(onOpen).toHaveBeenCalledWith('b')
  })

  it('folds after five rows', () => {
    const events = Array.from({ length: 7 }, (_, index) => event({
      eventId: `e${index}`,
      summary: `Row ${index}`,
      allDay: true,
      start: today,
      end: today,
    }))
    render(<AgendaStrip events={events} t={t} onOpen={() => {}} />)
    expect(screen.queryByText('Row 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByText('Row 6')).toBeTruthy()
  })
})
