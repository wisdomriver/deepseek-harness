/** Locale-aware formatting shared by the panel's task surfaces. */

import type { TaskLocaleKey } from './locales.ts'

/** Translator signature the components receive from the renderer. */
export type Translate = (key: TaskLocaleKey, params?: Record<string, unknown>) => string

/** Longest member id shown without an ellipsis. */
const ID_BUDGET = 10

/** Characters one member id keeps before its ellipsis. */
const ID_PREFIX = 7

/** Stable failure code to copy key. */
const ERROR_KEYS: Readonly<Record<string, TaskLocaleKey>> = {
  'invalid-input': 'invalidInput',
  'not-found': 'notFound',
  'not-configured': 'notConfigured',
  'not-connected': 'notConnected',
  'permission-denied': 'permissionDenied',
  'cli-missing': 'noCli',
  timeout: 'timeoutError',
  busy: 'busy',
  upstream: 'upstreamError',
  'unknown-outcome': 'unknownOutcome',
  conflict: 'conflict',
  internal: 'internalError',
}

/**
 * Name one stable failure code for the reader.
 * @param code - code the Host reported, if any.
 * @param t - localized copy.
 * @returns the message to show.
 */
export function errorText(code: string | undefined, t: Translate): string {
  return t(code === undefined ? 'error' : ERROR_KEYS[code] ?? 'error')
}

/**
 * Format one due instant; a malformed value is shown as sent.
 * @param dueAt - ISO 8601 due instant.
 * @param allDay - true to show a date without a clock time.
 * @returns the localized due value.
 */
export function formatDue(dueAt: string, allDay: boolean): string {
  const parsed = new Date(dueAt)
  if (Number.isNaN(parsed.getTime())) return dueAt
  return new Intl.DateTimeFormat(undefined, allDay
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed)
}

/**
 * Format one instant as a localized date and clock time.
 * @param instant - ISO 8601 instant.
 * @returns the localized value, or the input itself when it is malformed.
 */
export function formatTimestamp(instant: string): string {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return instant
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(parsed)
}

/**
 * Shorten one opaque member id for display.
 * @param id - Feishu member id.
 * @returns the id itself when short, otherwise its prefix and an ellipsis.
 */
export function abbreviateId(id: string): string {
  return id.length <= ID_BUDGET ? id : `${id.slice(0, ID_PREFIX)}…`
}

/**
 * Build the instant a date-only picker means for a timed due.
 *
 * The form collects one local day, so the instant is the end of that day in the browser's
 * timezone; an all-day due sends the date itself and Feishu stores it as UTC midnight.
 * @param day - `YYYY-MM-DD`.
 * @returns the ISO 8601 instant, or an empty string when the day is malformed.
 */
export function dueInstant(day: string): string {
  const parsed = new Date(`${day}T23:59:00`)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}
