// Month grid arithmetic and day layout: fixed 42 cells, week start, and per-day event placement.

import { describe, expect, it } from 'vitest'
import { localDay } from '../src/client/format.ts'
import type { CalendarEvent } from '../src/types.ts'
import { eventsByDay, gridCells, monthKey, monthRange, shiftMonth } from '../src/client/month.ts'

/** Build one normalized event for layout tests. */
function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'eventId' | 'start' | 'end'>): CalendarEvent {
  return {
    summary: partial.eventId,
    allDay: false,
    sourceTimezone: 'Asia/Shanghai',
    status: 'confirmed',
    isException: false,
    ...partial,
  }
}

describe('gridCells', () => {
  it('always covers six Monday-aligned weeks', () => {
    const cells = gridCells('2026-11', 'monday', new Date('2026-11-23T10:00:00+08:00'))
    expect(cells).toHaveLength(42)
    expect(cells[0]?.date).toBe('2026-10-26')
    expect(cells[41]?.date).toBe('2026-12-06')
    expect(cells.filter(cell => cell.inMonth)).toHaveLength(30)
    expect(cells.find(cell => cell.isToday)?.date).toBe('2026-11-23')
    expect(cells.find(cell => cell.date === '2026-11-01')?.inMonth).toBe(true)
  })

  it('aligns to Sunday when configured', () => {
    const cells = gridCells('2026-11', 'sunday', new Date('2026-11-23T10:00:00+08:00'))
    expect(cells[0]?.date).toBe('2026-11-01')
    expect(cells[41]?.date).toBe('2026-12-12')
  })
})

describe('monthRange', () => {
  it('reads the grid, not just the calendar month', () => {
    expect(monthRange('2026-11', 'monday')).toEqual({ start: '2026-10-26', end: '2026-12-07' })
  })
})

describe('shiftMonth', () => {
  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthKey(new Date(2026, 10, 23))).toBe('2026-11')
  })
})

describe('eventsByDay', () => {
  const cells = gridCells('2026-11', 'monday', new Date('2026-11-23T10:00:00+08:00'))

  it('places an all-day event on every day it covers', () => {
    const byDay = eventsByDay([event({ eventId: 'a', allDay: true, start: '2026-11-09', end: '2026-11-11' })], cells)
    expect(byDay.get('2026-11-08')).toBeUndefined()
    expect(byDay.get('2026-11-09')?.map(item => item.eventId)).toEqual(['a'])
    expect(byDay.get('2026-11-10')?.map(item => item.eventId)).toEqual(['a'])
    expect(byDay.get('2026-11-11')?.map(item => item.eventId)).toEqual(['a'])
    expect(byDay.get('2026-11-12')).toBeUndefined()
  })

  it('places a timed event on its local day and orders all-day first', () => {
    const timed = event({ eventId: 'timed', start: '2026-11-25T14:00:00+08:00', end: '2026-11-25T15:00:00+08:00' })
    const allDay = event({ eventId: 'allday', allDay: true, start: '2026-11-25', end: '2026-11-25' })
    const day = new Date(timed.start)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const byDay = eventsByDay([timed, allDay], cells)
    expect(byDay.get(key)?.map(item => item.eventId)).toEqual(['allday', 'timed'])
  })

  it('orders two events of one day by start and then by id', () => {
    const sameStart = '2026-11-25T14:00:00+08:00'
    const sameEnd = '2026-11-25T15:00:00+08:00'
    const byDay = eventsByDay([
      event({ eventId: 'z', start: sameStart, end: sameEnd }),
      event({ eventId: 'b', start: sameStart, end: sameEnd }),
      event({ eventId: 'late', start: '2026-11-25T16:00:00+08:00', end: '2026-11-25T17:00:00+08:00' }),
    ], cells)
    expect(byDay.get(localDay(new Date(sameStart)))?.map(item => item.eventId)).toEqual(['b', 'z', 'late'])
  })

  it('ignores days outside the grid', () => {
    const byDay = eventsByDay([event({ eventId: 'far', allDay: true, start: '2027-03-01', end: '2027-03-02' })], cells)
    expect(byDay.size).toBe(0)
  })
})

describe('invalid month keys', () => {
  it('rejects a key that is not a calendar month', () => {
    expect(() => shiftMonth('2026-13', 1)).toThrowError('feishu-calendar: invalid month key "2026-13"')
    expect(() => gridCells('not-a-month', 'monday')).toThrowError(/invalid month key/)
    expect(() => monthRange('2026-00', 'monday')).toThrowError(/invalid month key/)
  })
})
