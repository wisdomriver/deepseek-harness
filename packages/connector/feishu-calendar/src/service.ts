/**
 * Calendar reads and writes over the shared Feishu bridge: month instances, event details,
 * and the three event mutations, with normalization into the panel's own types.
 * @module @deepseek-ai/dsh-feishu-calendar/service
 */

import { randomUUID } from 'node:crypto'
import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { CacheStore, CliRequest, FeishuBridge } from '@deepseek-ai/dsh-feishu-bridge'
import type {
  CalendarEvent,
  CalendarEventDetail,
  CalendarEventsData,
  CalendarStatus,
  CreateEventInput,
  DeleteEventInput,
  RecurrenceScope,
  UpdateEventInput,
} from './types.ts'

/** The program name every diagnostic uses. */
const PROGRAM = 'lark-cli'

/** Scopes the panel needs; a token lacking any of them cannot answer its own reads. */
export const REQUIRED_SCOPES = ['calendar:calendar.event:read', 'calendar:calendar:read'] as const

/** Cache lifetime per read kind. */
export const CACHE_TTL_MS = { events: 60_000, event: 300_000 } as const

/** Seconds between the epoch and the CLI's `timestamp` field. */
const TIMESTAMP_SCALE = 1000

/** Date-only form the CLI accepts for all-day events. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Calendar service dependencies. */
export interface CalendarServiceOptions {
  /** The shared bridge: one process gate, one cache, one set of failure codes. */
  readonly bridge: FeishuBridge
  /** Week start reported to the browser. */
  readonly weekStart: 'monday' | 'sunday'
}

/** Reads primary-calendar events, their details, the account status, and the event mutations. */
export class CalendarService {
  /**
   * @param options - shared bridge and the reported week start.
   */
  constructor(private readonly options: CalendarServiceOptions) {}

  /** The shared cache, namespaced with the `calendar:` prefix. */
  private get cache(): CacheStore {
    return this.options.bridge.cache
  }

  /**
   * Read the account's CLI, application, and sign-in facts.
   * @returns the status the panel needs to choose its state, including the reported week start.
   * @throws FeishuError when the CLI is missing, unconfigured, or signed out.
   */
  async status(): Promise<CalendarStatus> {
    const facts = await this.options.bridge.status()
    const granted = new Set(facts.scopes)
    const missingScopes = REQUIRED_SCOPES.filter(required => !granted.has(required))
    return {
      cli: facts.cli,
      configured: facts.configured,
      connected: facts.connected,
      ...(facts.userName === undefined ? {} : { userName: facts.userName }),
      missingScopes,
      weekStart: this.options.weekStart,
    } satisfies CalendarStatus
  }

  /**
   * Read every instance in `[start, end)`.
   * @param start - ISO 8601 instant or `YYYY-MM-DD`; the CLI accepts both.
   * @param end - ISO 8601 instant or `YYYY-MM-DD`, exclusive enough to cover the grid's last day.
   * @returns the normalized instances and the instant they were read.
   * @throws FeishuError for invalid input, a missing sign-in, or CLI failures.
   */
  async events(start: string, end: string): Promise<CalendarEventsData> {
    assertRange(start, end)
    return this.cache.memo(`calendar:events:${start}:${end}`, CACHE_TTL_MS.events, async () => {
      const data = await this.read(['calendar', '+agenda', '--start', start, '--end', end])
      const items = Array.isArray(data) ? data : []
      const events = items.map(item => toEvent(requireRecord(item, 'agenda item'))).sort(byStart)
      return { events, fetchedAt: new Date().toISOString() } satisfies CalendarEventsData
    })
  }

  /**
   * Read one event, following a recurring instance to its master for the rule.
   * @param eventId - id from the month list, which may be a recurring instance.
   * @returns the detail the drawer renders.
   * @throws FeishuError for a missing sign-in, an unknown event, or CLI failures.
   */
  async event(eventId: string): Promise<CalendarEventDetail> {
    const id = trimRequired(eventId, 'eventId')
    return this.cache.memo(`calendar:event:${id}`, CACHE_TTL_MS.event, async () => {
      const detail = await this.readEvent(id)
      const masterId = asString(detail.recurring_event_id)
      const recurrence = masterId === undefined || masterId === '' || masterId === id
        ? undefined
        : asString((await this.readEvent(masterId)).recurrence)
      return toDetail(detail, recurrence)
    })
  }

  /**
   * Create one event on the primary calendar.
   * @param input - title, all-day flag, both bounds, the browser timezone, and an optional description.
   * @returns the new event's id.
   * @throws FeishuError with `invalid-input` before any process starts, `unknown-outcome`
   * when the CLI accepted the request without returning an id, or the mapped CLI failure.
   */
  async create(input: CreateEventInput): Promise<{ eventId: string }> {
    const summary = trimRequired(input.summary, 'summary')
    if (summary.length > 100) throw new FeishuError('invalid-input', 'summary must be at most 100 characters')
    if (input.description !== undefined && input.description.length > 5000) {
      throw new FeishuError('invalid-input', 'description must be at most 5000 characters')
    }
    const timezone = trimRequired(input.timezone, 'timezone')
    const body: Record<string, unknown> = {
      summary,
      start_time: timePoint(input.start, input.allDay, timezone, 'start'),
      end_time: timePoint(input.end, input.allDay, timezone, 'end'),
    }
    if (input.description !== undefined && input.description !== '') body.description = input.description
    const data = await this.write([
      'calendar', 'events', 'create', '--calendar-id', 'primary',
      '--data', '-', '--idempotency-key', randomUUID(),
    ], JSON.stringify(body))
    const eventId = asString(asRecord(asRecord(data)?.event)?.event_id)
    if (eventId === undefined || eventId === '') {
      throw new FeishuError('unknown-outcome', `${PROGRAM} accepted the create request without an event id`)
    }
    this.invalidate()
    return { eventId }
  }

  /**
   * Update one event. All-day events go through the raw patch API because the
   * `+update` shortcut turns date bounds into a timed event.
   * @param input - event id, title, bounds, optional description, and recurring scope.
   * @returns the updated event id.
   * @throws FeishuError with `invalid-input` before any process starts, or the mapped CLI failure.
   */
  async updateEvent(input: UpdateEventInput): Promise<{ eventId: string }> {
    const eventId = trimRequired(input.eventId, 'eventId')
    const summary = trimRequired(input.summary, 'summary')
    if (summary.length > 100) throw new FeishuError('invalid-input', 'summary must be at most 100 characters')
    if (input.description !== undefined && input.description.length > 5000) {
      throw new FeishuError('invalid-input', 'description must be at most 5000 characters')
    }
    const timezone = trimRequired(input.timezone, 'timezone')
    const scope = recurrenceScopeOf(input.applyTo)
    if (input.allDay) {
      const start = requireDate(input.start, 'start')
      const end = requireDate(input.end, 'end')
      if (end < start) throw new FeishuError('invalid-input', 'end must not be earlier than start')
      if (scope !== undefined && scope !== 'all') {
        throw new FeishuError('invalid-input', 'all-day events support whole-series edits only')
      }
      const body: Record<string, unknown> = {
        summary,
        start_time: { date: start, timezone },
        end_time: { date: end, timezone },
      }
      if (input.description !== undefined) body.description = input.description
      await this.write(
        ['calendar', 'events', 'patch', '--calendar-id', 'primary', '--event-id', eventId, '--data', '-'],
        JSON.stringify(body),
      )
    } else {
      const start = requireInstant(input.start, 'start')
      const end = requireInstant(input.end, 'end')
      if (Date.parse(end) <= Date.parse(start)) throw new FeishuError('invalid-input', 'end must be later than start')
      const args = ['calendar', '+update', '--event-id', eventId, '--summary', summary, '--start', start, '--end', end]
      if (input.description !== undefined) args.push('--description', input.description)
      if (scope !== undefined) args.push('--apply-to', scope)
      await this.write(args)
    }
    this.invalidate()
    return { eventId }
  }

  /**
   * Delete one event.
   * @param input - event id and the recurring scope the CLI requires for a series.
   * @returns the deleted event id.
   * @throws FeishuError with `invalid-input` for a bad scope, or the mapped CLI failure.
   */
  async deleteEvent(input: DeleteEventInput): Promise<{ eventId: string }> {
    const eventId = trimRequired(input.eventId, 'eventId')
    const scope = recurrenceScopeOf(input.applyTo)
    const args = ['calendar', '+delete', '--event-id', eventId, '--yes']
    if (scope !== undefined) args.push('--apply-to', scope)
    await this.write(args)
    this.invalidate()
    return { eventId }
  }

  /**
   * Read one event through the `+get` shortcut, which needs no calendar id.
   * @param eventId - event or instance id.
   * @returns the raw `data` object.
   * @throws FeishuError when the answer carries no event.
   */
  private async readEvent(eventId: string): Promise<Record<string, unknown>> {
    return requireRecord(await this.read(['calendar', '+get', '--event-id', eventId]), `event ${eventId}`)
  }

  /**
   * Run one read through the shared bridge.
   * @param command - subcommand and arguments.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge.
   */
  private async read(command: readonly string[]): Promise<unknown> {
    const request: CliRequest = { command, mode: 'read', retry: 'transient' }
    return (await this.options.bridge.run(request)).data
  }

  /**
   * Run one write through the shared bridge.
   * @param command - subcommand and arguments.
   * @param stdin - optional payload for `--data -`.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge; writes never retry.
   */
  private async write(command: readonly string[], stdin?: string): Promise<unknown> {
    const request: CliRequest = { command, mode: 'write', ...(stdin === undefined ? {} : { stdin }) }
    return (await this.options.bridge.run(request)).data
  }

  /** Drop every cached calendar read after a successful write. */
  private invalidate(): void {
    this.cache.invalidate('calendar:')
  }
}

/**
 * Narrow one value to a non-array object.
 * @param value - value from the CLI envelope.
 * @returns the object, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Require one value to be a non-array object.
 * @param value - value from the CLI envelope.
 * @param subject - what the value should be, for the diagnostic.
 * @returns the object.
 * @throws FeishuError with `upstream` when the value is not an object.
 */
function requireRecord(value: unknown, subject: string): Record<string, unknown> {
  const record = asRecord(value)
  if (record === undefined) throw new FeishuError('upstream', `${PROGRAM} returned no ${subject}`)
  return record
}

/**
 * Read one optional string field.
 * @param value - field value.
 * @returns the string, or undefined for absent and non-string values.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Validate one bounded range before any process starts.
 * @param start - range start in ISO 8601 or `YYYY-MM-DD`.
 * @param end - range end in ISO 8601 or `YYYY-MM-DD`.
 * @throws FeishuError with `invalid-input` for a malformed or inverted range.
 */
function assertRange(start: string, end: string): void {
  if (!isDateOrDateTime(start) || !isDateOrDateTime(end)) {
    throw new FeishuError('invalid-input', 'start and end must be ISO 8601 instants or YYYY-MM-DD dates')
  }
  if (Date.parse(start) >= Date.parse(end)) {
    throw new FeishuError('invalid-input', 'start must be earlier than end')
  }
}

/**
 * Test the two accepted range spellings.
 * @param value - candidate range bound.
 * @returns true for `YYYY-MM-DD` and for a parseable ISO 8601 instant.
 */
function isDateOrDateTime(value: string): boolean {
  if (DATE_ONLY.test(value)) return !Number.isNaN(Date.parse(value))
  return !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value)
}

/**
 * Build one `start_time` or `end_time` body value.
 * @param bound - the bound as the browser sent it.
 * @param allDay - whether the event is date-only.
 * @param timezone - IANA timezone the browser used.
 * @param field - field name, for the diagnostic.
 * @returns the CLI body value: a date for all-day, otherwise an epoch-second timestamp.
 * @throws FeishuError with `invalid-input` for a malformed bound.
 */
function timePoint(bound: string, allDay: boolean, timezone: string, field: 'start' | 'end'): Record<string, string> {
  if (allDay) {
    if (!DATE_ONLY.test(bound)) throw new FeishuError('invalid-input', `${field} must be YYYY-MM-DD for an all-day event`)
    return { date: bound, timezone }
  }
  const millis = Date.parse(bound)
  if (Number.isNaN(millis)) throw new FeishuError('invalid-input', `${field} must be an ISO 8601 instant`)
  return { timestamp: String(Math.floor(millis / TIMESTAMP_SCALE)), timezone }
}

/**
 * Normalize one agenda item.
 * @param raw - one element of the agenda `data` array.
 * @returns the event the panel renders.
 * @throws FeishuError with `upstream` when the item has no id or time bounds.
 */
function toEvent(raw: Record<string, unknown>): CalendarEvent {
  const start = asRecord(raw.start_time)
  const end = asRecord(raw.end_time)
  const allDay = typeof start?.date === 'string'
  const startValue = allDay ? asString(start?.date) : asString(start?.datetime)
  const endValue = allDay ? asString(end?.date) : asString(end?.datetime)
  const eventId = asString(raw.event_id)
  if (eventId === undefined || startValue === undefined || endValue === undefined) {
    throw new FeishuError('upstream', `${PROGRAM} returned an event without id or time bounds`)
  }
  return {
    eventId,
    summary: asString(raw.summary) ?? '',
    allDay,
    start: startValue,
    end: endValue,
    sourceTimezone: asString(start?.timezone) ?? '',
    status: asString(raw.status) ?? 'confirmed',
    isException: raw.is_exception === true,
    ...optional('appLink', asString(raw.app_link)),
    ...(typeof raw.color === 'number' ? { colorIndex: raw.color } : {}),
  }
}

/**
 * Normalize one `+get` payload, adding the master's rule when known.
 * @param raw - the `+get` `data` object.
 * @param recurrence - rule read from the recurring master, when the event is an instance.
 * @returns the drawer's detail.
 * @throws FeishuError with `upstream` when required fields are missing.
 */
function toDetail(raw: Record<string, unknown>, recurrence: string | undefined): CalendarEventDetail {
  const base = toEvent(raw)
  const organizer = asString(asRecord(raw.event_organizer)?.display_name)
  return {
    ...base,
    ...optional('organizer', organizer),
    ...optional('description', asString(raw.description)),
    ...optional('recurrence', recurrence),
    ...optional('selfRsvpStatus', asString(raw.self_rsvp_status)),
    ...optional('recurringEventId', asString(raw.recurring_event_id)),
  }
}

/**
 * Spread one optional property only when it is present.
 * @param key - property name.
 * @param value - value, if any.
 * @returns an object holding the property at most once.
 */
function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value }
}

/**
 * Compare two events for the month grid: all-day first, then by start.
 * @param left - first event.
 * @param right - second event.
 * @returns the comparator result.
 */
function byStart(left: CalendarEvent, right: CalendarEvent): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  return left.start.localeCompare(right.start)
}

/**
 * Require a non-empty trimmed string.
 * @param value - candidate value.
 * @param field - field name, for the diagnostic.
 * @returns the trimmed value.
 * @throws FeishuError with `invalid-input` when the value is empty.
 */
function trimRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new FeishuError('invalid-input', `${field} must not be empty`)
  return trimmed
}

/**
 * Validate one recurring scope from the wire.
 * @param value - scope the browser sent.
 * @returns the scope, or undefined when absent.
 * @throws FeishuError with `invalid-input` for an unknown scope.
 */
function recurrenceScopeOf(value: RecurrenceScope | undefined): RecurrenceScope | undefined {
  if (value === undefined) return undefined
  if (value === 'single' || value === 'all' || value === 'this-and-following') return value
  throw new FeishuError('invalid-input', 'applyTo must be single, all, or this-and-following')
}

/**
 * Require one `YYYY-MM-DD` bound.
 * @param value - bound from the wire.
 * @param field - field name, for the diagnostic.
 * @returns the date.
 * @throws FeishuError with `invalid-input` when the value is not a day.
 */
function requireDate(value: string, field: string): string {
  if (!DATE_ONLY.test(value) || Number.isNaN(Date.parse(value))) {
    throw new FeishuError('invalid-input', `${field} must be YYYY-MM-DD for an all-day event`)
  }
  return value
}

/**
 * Require one ISO 8601 instant bound.
 * @param value - bound from the wire.
 * @param field - field name, for the diagnostic.
 * @returns the instant.
 * @throws FeishuError with `invalid-input` when the value is not an instant.
 */
function requireInstant(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value)) || !/\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new FeishuError('invalid-input', `${field} must be an ISO 8601 instant`)
  }
  return value
}
