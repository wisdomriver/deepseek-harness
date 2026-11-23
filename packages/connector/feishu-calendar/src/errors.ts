/**
 * Stable failure codes the panel renders, and their HTTP statuses.
 * @module @deepseek-ai/dsh-feishu-calendar/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-error'

/** Machine-routable failure codes; the browser maps each to one localized message. */
export type CalendarErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'not-configured'
  | 'not-connected'
  | 'permission-denied'
  | 'cli-missing'
  | 'timeout'
  | 'busy'
  | 'upstream'
  | 'unknown-outcome'
  | 'internal'

/** HTTP status each code answers with. */
export const CALENDAR_HTTP_STATUS: Readonly<Record<CalendarErrorCode, number>> = {
  'invalid-input': 400,
  'not-found': 404,
  'not-configured': 503,
  'not-connected': 503,
  'permission-denied': 502,
  'cli-missing': 503,
  timeout: 502,
  busy: 429,
  upstream: 502,
  'unknown-outcome': 502,
  internal: 500,
}

/** Calendar failure carrying one of the stable codes; `message` never reaches the browser verbatim. */
export class CalendarError extends HarnessError {
  /** The narrowed stable code assigned by {@link CalendarError} itself. */
  declare readonly code: CalendarErrorCode

  /**
   * @param code - stable failure code, also the `HarnessError` code.
   * @param message - Host-side diagnostic; routes replace it with localized copy.
   * @param options - standard error options, usually the cause.
   */
  constructor(code: CalendarErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
  }
}

/**
 * Read the calendar code off a thrown value.
 * @param error - value caught from a route handler.
 * @returns the stable code, or `internal` for anything the Host did not classify.
 */
export function calendarCodeOf(error: unknown): CalendarErrorCode {
  return error instanceof CalendarError ? error.code : 'internal'
}
