// Locale-aware formatting: the event time line, running state, recurrence copy, and RSVP labels.

import { describe, expect, it } from 'vitest'
import {
  eventWhen,
  formatClock,
  formatDate,
  isRunning,
  localDay,
  recurrenceLabel,
  rsvpLabel,
  statusLabel,
} from '../src/client/format.ts'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import type { CalendarEvent } from '../src/types.ts'

const t = (key: CalendarLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

/** One event with the given bounds. */
function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'start' | 'end'>): CalendarEvent {
  return {
    eventId: 'e1',
    summary: 'Sync',
    allDay: false,
    sourceTimezone: 'Asia/Shanghai',
    status: 'confirmed',
    isException: false,
    ...overrides,
  }
}

describe('formatDate', () => {
  it('formats a calendar day and echoes a malformed one', () => {
    expect(formatDate('2026-11-25')).toMatch(/25/)
    expect(formatDate('not-a-day')).toBe('not-a-day')
  })
})

describe('formatClock', () => {
  it('formats an instant and echoes a malformed one', () => {
    expect(formatClock('2026-11-25T10:30:00+08:00')).toMatch(/\d{1,2}:\d{2}/)
    expect(formatClock('later')).toBe('later')
  })
})

describe('localDay', () => {
  it('names the local day and rejects an invalid instant', () => {
    const day = new Date(2026, 10, 25, 10, 0)
    expect(localDay(day)).toBe('2026-11-25')
    expect(localDay(new Date('nope'))).toBe('')
  })
})

describe('eventWhen', () => {
  it('describes a single all-day event', () => {
    expect(eventWhen(event({ allDay: true, start: '2026-11-25', end: '2026-11-25' }))).toMatch(/25/)
  })

  it('describes an all-day span', () => {
    const text = eventWhen(event({ allDay: true, start: '2026-11-25', end: '2026-11-27' }))
    expect(text).toContain('–')
    expect(text).toMatch(/25/)
    expect(text).toMatch(/27/)
  })

  it('describes a timed event on one day with both clock times', () => {
    const start = new Date(2026, 10, 25, 10, 0).toISOString()
    const end = new Date(2026, 10, 25, 11, 30).toISOString()
    const text = eventWhen(event({ start, end }))
    expect(text).toContain('10:00')
    expect(text).toContain('11:30')
    // One day, so the date is named once rather than on both sides of the range.
    expect(text.match(/25/g)).toHaveLength(1)
  })

  it('describes a timed event spanning two days', () => {
    const start = new Date(2026, 10, 25, 23, 0).toISOString()
    const end = new Date(2026, 10, 26, 1, 0).toISOString()
    const text = eventWhen(event({ start, end }))
    expect(text).toContain('–')
    expect(text).toMatch(/25/)
    expect(text).toMatch(/26/)
  })

  it('shows a malformed bound as sent', () => {
    expect(eventWhen(event({ start: 'soon', end: 'later' }))).toBe('soon – later')
    expect(eventWhen(event({ start: 'soon', end: 'soon' }))).toBe('soon')
    // A valid start with a malformed end also falls back to the raw values.
    expect(eventWhen(event({ start: new Date(2026, 10, 25, 10, 0).toISOString(), end: 'later' }))).toContain('later')
  })
})

describe('isRunning', () => {
  const now = new Date(2026, 10, 25, 10, 30)

  it('is true only between the bounds, and never for an all-day event', () => {
    const running = event({ start: new Date(2026, 10, 25, 10, 0).toISOString(), end: new Date(2026, 10, 25, 11, 0).toISOString() })
    expect(isRunning(running, now)).toBe(true)
    expect(isRunning(running, new Date(2026, 10, 25, 9, 0))).toBe(false)
    expect(isRunning(running, new Date(2026, 10, 25, 11, 0))).toBe(false)
    expect(isRunning(event({ allDay: true, start: '2026-11-25', end: '2026-11-25' }), now)).toBe(false)
  })
})

describe('recurrenceLabel', () => {
  it('omits the label for an absent or empty rule', () => {
    expect(recurrenceLabel(undefined, t)).toBeUndefined()
    expect(recurrenceLabel('', t)).toBeUndefined()
  })

  it('names the weekday set a BYDAY rule repeats on', () => {
    const label = recurrenceLabel('FREQ=WEEKLY;BYDAY=MO,WE', t)
    // The names follow the browser locale, so the rule is that both days appear after the prefix.
    expect(label?.startsWith('Every ')).toBe(true)
    expect(label?.trim().split(/\s+/)).toHaveLength(3)
    // A code outside the RFC 5545 set contributes no day name.
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=XX', t)?.trim()).toBe('Every')
  })

  it('names the frequency when the rule has no weekday set', () => {
    expect(recurrenceLabel('FREQ=DAILY', t)).toBe('Daily')
    expect(recurrenceLabel('FREQ=MONTHLY', t)).toBe('Monthly')
    expect(recurrenceLabel('FREQ=YEARLY', t)).toBe('Yearly')
    expect(recurrenceLabel('FREQ=WEEKLY', t)).toBe('Weekly')
  })

  it('adds the occurrence count when the rule bounds it', () => {
    expect(recurrenceLabel('FREQ=WEEKLY;COUNT=3', t)).toBe('Weekly · 3 times')
    expect(recurrenceLabel('FREQ=WEEKLY;COUNT=0', t)).toBe('Weekly')
    expect(recurrenceLabel('FREQ=WEEKLY;COUNT=x', t)).toBe('Weekly')
  })

  it('omits the label for a rule it cannot read', () => {
    expect(recurrenceLabel('EVERY=OTHER', t)).toBeUndefined()
    expect(recurrenceLabel('FREQ=FORTNIGHTLY', t)).toBeUndefined()
    // A token without a value contributes nothing.
    expect(recurrenceLabel('UNTIL', t)).toBeUndefined()
  })
})

describe('rsvpLabel', () => {
  it('names each known response and echoes an unknown one', () => {
    expect(rsvpLabel(undefined, t)).toBeUndefined()
    expect(rsvpLabel('accept', t)).toBe('Accepted')
    expect(rsvpLabel('decline', t)).toBe('Declined')
    expect(rsvpLabel('tentative', t)).toBe('Tentative')
    expect(rsvpLabel('needs_action', t)).toBe('Not answered')
    expect(rsvpLabel('maybe', t)).toBe('maybe')
  })
})

describe('statusLabel', () => {
  it('names each known status and echoes an unknown one', () => {
    expect(statusLabel('confirmed', t)).toBe('Confirmed')
    expect(statusLabel('cancelled', t)).toBe('Cancelled')
    expect(statusLabel('tentative', t)).toBe('Tentative')
    expect(statusLabel('archived', t)).toBe('archived')
  })
})
