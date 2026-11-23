/** Locale-aware formatting shared by the panel's event surfaces. */

import type { CalendarEvent } from '../types.ts'
import type { CalendarLocaleKey } from './locales.ts'

/** Translator signature the components receive from the renderer. */
export type Translate = (key: CalendarLocaleKey, params?: Record<string, unknown>) => string

/** RFC 5545 weekday codes mapped to the Monday-first calendar used for their labels. */
const WEEKDAY_DATES: Readonly<Record<string, string>> = {
  MO: '2024-01-01',
  TU: '2024-01-02',
  WE: '2024-01-03',
  TH: '2024-01-04',
  FR: '2024-01-05',
  SA: '2024-01-06',
  SU: '2024-01-07',
}

/** Frequency code to copy key. */
const FREQUENCY_KEYS: Readonly<Record<string, CalendarLocaleKey>> = {
  DAILY: 'recurrenceDaily',
  WEEKLY: 'recurrenceWeekly',
  MONTHLY: 'recurrenceMonthly',
  YEARLY: 'recurrenceYearly',
}

/** Response status to copy key. */
const RSVP_KEYS: Readonly<Record<string, CalendarLocaleKey>> = {
  accept: 'rsvpAccepted',
  decline: 'rsvpDeclined',
  tentative: 'rsvpTentative',
  needs_action: 'rsvpNeedsAction',
}

/**
 * Parse one `YYYY-MM-DD` calendar day.
 * @param date - calendar date from the Host.
 * @returns the local instant, or undefined when the value is not a day.
 */
function parseDay(date: string): Date | undefined {
  const parsed = new Date(`${date}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * Format one calendar date; a malformed value is shown as sent.
 * @param date - `YYYY-MM-DD`.
 * @returns the localized date.
 */
export function formatDate(date: string): string {
  const parsed = parseDay(date)
  return parsed === undefined
    ? date
    : new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', weekday: 'short' }).format(parsed)
}

/**
 * Format one instant's clock time; a malformed value is shown as sent.
 * @param instant - ISO 8601 instant.
 * @returns the browser-local clock time.
 */
export function formatClock(instant: string): string {
  const parsed = new Date(instant)
  return Number.isNaN(parsed.getTime())
    ? instant
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(parsed)
}

/**
 * Name one instant's calendar day in the browser's timezone.
 * @param date - the instant.
 * @returns the local `YYYY-MM-DD`, or an empty string when the instant is invalid.
 */
export function localDay(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Describe when one event happens.
 * @param event - the event.
 * @returns the date and time line.
 */
export function eventWhen(event: CalendarEvent): string {
  const startDay = event.allDay ? event.start : localDay(new Date(event.start))
  const endDay = event.allDay ? event.end : localDay(new Date(event.end))
  if (parseDay(startDay) === undefined || parseDay(endDay) === undefined) {
    return event.start === event.end ? event.start : `${event.start} – ${event.end}`
  }
  if (event.allDay) {
    return event.start === event.end ? formatDate(event.start) : `${formatDate(event.start)} – ${formatDate(event.end)}`
  }
  return startDay === endDay
    ? `${formatDate(startDay)} ${formatClock(event.start)}–${formatClock(event.end)}`
    : `${formatDate(startDay)} ${formatClock(event.start)} – ${formatDate(endDay)} ${formatClock(event.end)}`
}

/**
 * Test whether a timed event is running now.
 * @param event - the event.
 * @param now - the instant to test.
 * @returns true while `now` lies inside the event.
 */
export function isRunning(event: CalendarEvent, now: Date = new Date()): boolean {
  if (event.allDay) return false
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  return start <= now.getTime() && now.getTime() < end
}

/**
 * Turn an RFC 5545 rule into reading copy.
 * @param recurrence - rule without the `RRULE:` prefix, as Feishu stores it.
 * @param t - localized copy.
 * @returns the description, or undefined for an absent or unparsable rule.
 */
export function recurrenceLabel(recurrence: string | undefined, t: Translate): string | undefined {
  if (recurrence === undefined || recurrence === '') return undefined
  const parts = new Map<string, string>()
  for (const chunk of recurrence.split(';')) {
    const [key, value] = chunk.split('=')
    if (key !== undefined && value !== undefined) parts.set(key.trim(), value.trim())
  }
  const weekdays = parts.get('BYDAY')
  const base = weekdays === undefined ? undefined : t('recurrenceWeekdays', { days: weekdayNames(weekdays) })
  const frequency = parts.get('FREQ')
  const fallback = frequency === undefined ? undefined : FREQUENCY_KEYS[frequency]
  const text = base ?? (fallback === undefined ? undefined : t(fallback))
  if (text === undefined) return undefined
  const count = Number(parts.get('COUNT') ?? Number.NaN)
  return Number.isInteger(count) && count > 0 ? `${text} · ${t('recurrenceCount', { count })}` : text
}

/**
 * Name the response status for the detail drawer.
 * @param status - Feishu's `self_rsvp_status`.
 * @param t - localized copy.
 * @returns the label, or undefined when absent.
 */
export function rsvpLabel(status: string | undefined, t: Translate): string | undefined {
  if (status === undefined) return undefined
  const key = RSVP_KEYS[status]
  return key === undefined ? status : t(key)
}

/**
 * Name the weekdays one `BYDAY` list holds.
 * @param byDay - comma-separated RFC 5545 weekday codes.
 * @returns the localized short names.
 */
function weekdayNames(byDay: string): string {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  return byDay
    .split(',')
    .map(code => WEEKDAY_DATES[code.trim()])
    .filter((date): date is string => date !== undefined)
    .map(date => format.format(new Date(`${date}T00:00:00`)))
    .join(' ')
}

/**
 * Name one Feishu event status.
 * @param status - Feishu's `status` field.
 * @param t - localized copy.
 * @returns the label, or the raw value for an unknown status.
 */
export function statusLabel(status: string, t: Translate): string {
  if (status === 'confirmed') return t('statusConfirmed')
  if (status === 'cancelled') return t('statusCancelled')
  if (status === 'tentative') return t('statusTentative')
  return status
}
