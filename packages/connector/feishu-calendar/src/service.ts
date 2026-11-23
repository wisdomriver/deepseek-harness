/**
 * Calendar reads and writes over `lark-cli`, with a bounded in-memory cache,
 * single-flight per key, and a concurrency gate over CLI processes.
 * @module @deepseek-ai/dsh-feishu-calendar/service
 */

import { randomUUID } from 'node:crypto'
import { PROGRAM, jsonObjectIn, type CommandOutcome, type CommandRunner } from './cli.ts'
import { CalendarError } from './errors.ts'
import type {
  CalendarEvent,
  CalendarEventDetail,
  CalendarEventsData,
  CalendarStatus,
  CreateEventInput,
} from './types.ts'

/** Scopes the panel needs; a token lacking any of them cannot answer its own reads. */
export const REQUIRED_SCOPES = ['calendar:calendar.event:read', 'calendar:calendar:read'] as const

/** Cache lifetime per read kind. */
export const CACHE_TTL_MS = { events: 60_000, event: 300_000, status: 30_000 } as const

/** Entries retained across every cache key. */
export const CACHE_LIMIT = 32

/** Seconds between the epoch and the CLI's `timestamp` field. */
const TIMESTAMP_SCALE = 1000

/** API codes meaning the addressed event or calendar no longer exists. */
const NOT_FOUND_CODES = new Set([190014, 191001])

/** API codes meaning the token lacks a scope. */
const PERMISSION_CODES = new Set([99991672, 99991679])

/** API codes meaning the token is absent, expired, or revoked. */
const NOT_CONNECTED_CODES = new Set([99991661, 99991663, 99991668])

/** Date-only form the CLI accepts for all-day events. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Calendar service dependencies. */
export interface CalendarServiceOptions {
  /** Runs one `lark-cli` command. */
  readonly run: CommandRunner
  /** Budget for read commands. */
  readonly readTimeoutMs: number
  /** Budget for write commands. */
  readonly writeTimeoutMs: number
  /** CLI processes allowed to run at once. */
  readonly maxConcurrency: number
  /** Requests allowed to wait for a slot before the next one fails with `busy`. */
  readonly queueLimit: number
  /** Week start reported to the browser. */
  readonly weekStart: 'monday' | 'sunday'
}

/** One cached value and when it stops being fresh. */
interface CacheEntry {
  readonly value: unknown
  readonly expiresAt: number
}

/** Reads primary-calendar events, their details, and the account status. */
export class CalendarService {
  /** Fresh values by key; insertion order is the LRU order. */
  private readonly cache = new Map<string, CacheEntry>()

  /** In-flight loads by key, so concurrent callers share one CLI process. */
  private readonly inflight = new Map<string, Promise<unknown>>()

  /** Commands currently running. */
  private active = 0

  /** Callers waiting for a slot. */
  private readonly waiting: (() => void)[] = []

  /**
   * @param options - command runner, budgets, gate sizes, and reported week start.
   */
  constructor(private readonly options: CalendarServiceOptions) {}

  /**
   * Read the account's CLI, application, and sign-in facts.
   * @returns the status the panel needs to choose its state.
   * @throws CalendarError when the CLI is missing or its answer cannot be interpreted.
   */
  status(): Promise<CalendarStatus> {
    return this.cached('status', CACHE_TTL_MS.status, async () => {
      const outcome = await this.command(['auth', 'status', '--json'], this.options.readTimeoutMs)
      const envelope = this.envelope(outcome, ['auth', 'status', '--json'])
      if (envelope.ok === false) throw envelopeFailure(envelope)
      const identities = asRecord(envelope.identities)
      const user = asRecord(identities?.user)
      const scope = asString(user?.scope) ?? ''
      const granted = new Set(scope.split(/\s+/).filter(part => part !== ''))
      const missingScopes = REQUIRED_SCOPES.filter(required => !granted.has(required))
      const status = asString(user?.status)
      const available = user?.available === true
      const userName = asString(user?.userName)
      return {
        cli: true,
        configured: true,
        connected: available && status === 'ready',
        ...(userName === undefined ? {} : { userName }),
        missingScopes,
        weekStart: this.options.weekStart,
      } satisfies CalendarStatus
    })
  }

  /**
   * Read every instance in `[start, end)`.
   * @param start - ISO 8601 instant or `YYYY-MM-DD`; the CLI accepts both.
   * @param end - ISO 8601 instant or `YYYY-MM-DD`, exclusive enough to cover the grid's last day.
   * @returns the normalized instances and the instant they were read.
   * @throws CalendarError for invalid input, a missing sign-in, or CLI failures.
   */
  async events(start: string, end: string): Promise<CalendarEventsData> {
    assertRange(start, end)
    return this.cached(`events:${start}:${end}`, CACHE_TTL_MS.events, async () => {
      const args = ['calendar', '+agenda', '--start', start, '--end', end]
      const envelope = this.envelope(await this.command(args, this.options.readTimeoutMs), args)
      if (envelope.ok !== true) throw envelopeFailure(envelope)
      const items = Array.isArray(envelope.data) ? envelope.data : []
      const events = items.map(item => toEvent(requireRecord(item, 'agenda item'))).sort(byStart)
      return { events, fetchedAt: new Date().toISOString() } satisfies CalendarEventsData
    })
  }

  /**
   * Read one event, following a recurring instance to its master for the rule.
   * @param eventId - id from the month list, which may be a recurring instance.
   * @returns the detail the drawer renders.
   * @throws CalendarError for a missing sign-in, an unknown event, or CLI failures.
   */
  async event(eventId: string): Promise<CalendarEventDetail> {
    const id = trimRequired(eventId, 'eventId')
    return this.cached(`event:${id}`, CACHE_TTL_MS.event, async () => {
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
   * @throws CalendarError with `invalid-input` before any process starts, `unknown-outcome`
   * when the CLI accepted the request without returning an id, or the mapped CLI failure.
   */
  async create(input: CreateEventInput): Promise<{ eventId: string }> {
    const summary = trimRequired(input.summary, 'summary')
    if (summary.length > 100) throw new CalendarError('invalid-input', 'summary must be at most 100 characters')
    if (input.description !== undefined && input.description.length > 5000) {
      throw new CalendarError('invalid-input', 'description must be at most 5000 characters')
    }
    const timezone = trimRequired(input.timezone, 'timezone')
    const body: Record<string, unknown> = {
      summary,
      start_time: timePoint(input.start, input.allDay, timezone, 'start'),
      end_time: timePoint(input.end, input.allDay, timezone, 'end'),
    }
    if (input.description !== undefined && input.description !== '') body.description = input.description
    const args = [
      'calendar', 'events', 'create', '--calendar-id', 'primary',
      '--data', '-', '--idempotency-key', randomUUID(),
    ]
    const outcome = await this.command(args, this.options.writeTimeoutMs, JSON.stringify(body))
    const envelope = this.envelope(outcome, args)
    if (envelope.ok !== true) throw envelopeFailure(envelope)
    const eventId = asString(asRecord(asRecord(envelope.data)?.event)?.event_id)
    if (eventId === undefined || eventId === '') {
      throw new CalendarError('unknown-outcome', `${PROGRAM} accepted the create request without an event id`)
    }
    this.invalidate()
    return { eventId }
  }

  /**
   * Read one event through the `+get` shortcut, which needs no calendar id.
   * @param eventId - event or instance id.
   * @returns the raw `data` object.
   * @throws CalendarError when the answer carries no event.
   */
  private async readEvent(eventId: string): Promise<Record<string, unknown>> {
    const args = ['calendar', '+get', '--event-id', eventId]
    const envelope = this.envelope(await this.command(args, this.options.readTimeoutMs), args)
    if (envelope.ok !== true) throw envelopeFailure(envelope)
    return requireRecord(envelope.data, `event ${eventId}`)
  }

  /**
   * Run one command inside the concurrency gate.
   * @param args - native arguments.
   * @param timeoutMs - command budget.
   * @param stdin - optional standard input for `--data -`.
   * @returns the finished command.
   * @throws CalendarError for `busy` and `timeout`.
   */
  private async command(args: readonly string[], timeoutMs: number, stdin?: string): Promise<CommandOutcome> {
    await this.acquire()
    try {
      return await this.options.run({ args, timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
    } finally {
      this.release()
    }
  }

  /**
   * Read the JSON envelope one command printed.
   * @param outcome - finished command.
   * @param args - arguments, for the diagnostic only.
   * @returns the envelope object.
   * @throws CalendarError with `upstream` when neither stream holds JSON.
   */
  private envelope(outcome: CommandOutcome, args: readonly string[]): Record<string, unknown> {
    const envelope = jsonObjectIn(outcome.stdout) ?? jsonObjectIn(outcome.stderr)
    if (envelope === undefined) {
      throw new CalendarError('upstream', `${PROGRAM} ${args.join(' ')} printed no JSON (exit ${outcome.exitCode})`)
    }
    return envelope
  }

  /**
   * Serve one key from cache, join an in-flight load, or start a new one.
   * @param key - cache key.
   * @param ttl - freshness window.
   * @param load - producer invoked only when nothing fresh exists.
   * @returns the cached or produced value.
   * @throws whatever the loader throws.
   */
  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.expiresAt > Date.now()) return Promise.resolve(hit.value as T)
    const running = this.inflight.get(key)
    if (running !== undefined) return running as Promise<T>
    const started = load().then(
      (value) => {
        this.store(key, { value, expiresAt: Date.now() + ttl })
        return value
      },
      (error: unknown) => { throw error },
    ).finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, started)
    return started
  }

  /**
   * Store one value, evicting the least recently used entry beyond the limit.
   * @param key - cache key.
   * @param entry - value and freshness deadline.
   */
  private store(key: string, entry: CacheEntry): void {
    this.cache.delete(key)
    this.cache.set(key, entry)
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) return
      this.cache.delete(oldest.value)
    }
  }

  /** Drop every cached event read after a successful write. */
  private invalidate(): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith('events:') || key.startsWith('event:')) this.cache.delete(key)
    }
  }

  /**
   * Take one concurrency slot, or wait for one to be handed over.
   * @throws CalendarError with `busy` when the wait queue is already full.
   */
  private async acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrency) {
      this.active += 1
      return
    }
    if (this.waiting.length >= this.options.queueLimit) {
      throw new CalendarError('busy', `${PROGRAM} queue is full`)
    }
    await new Promise<void>((resolve) => { this.waiting.push(resolve) })
  }

  /** Give a slot back, or hand it directly to the next waiter. */
  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) {
      this.active = Math.max(0, this.active - 1)
      return
    }
    next()
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
 * @throws CalendarError with `upstream` when the value is not an object.
 */
function requireRecord(value: unknown, subject: string): Record<string, unknown> {
  const record = asRecord(value)
  if (record === undefined) throw new CalendarError('upstream', `${PROGRAM} returned no ${subject}`)
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
 * Map the CLI's error envelope to a stable code.
 * @param envelope - parsed envelope whose `ok` is not true.
 * @returns the error to answer with.
 */
function envelopeFailure(envelope: Record<string, unknown>): CalendarError {
  const error = asRecord(envelope.error)
  const message = asString(error?.message) ?? `${PROGRAM} reported a failure`
  const type = asString(error?.type)
  const subtype = asString(error?.subtype)
  const code = typeof error?.code === 'number' ? error.code : Number.NaN
  if (type === 'config' || subtype === 'not_configured') return new CalendarError('not-configured', message)
  if (type === 'validation') return new CalendarError('invalid-input', message)
  if (NOT_FOUND_CODES.has(code)) return new CalendarError('not-found', message)
  if (PERMISSION_CODES.has(code)) return new CalendarError('permission-denied', message)
  if (NOT_CONNECTED_CODES.has(code)) return new CalendarError('not-connected', message)
  return new CalendarError('upstream', message)
}

/**
 * Validate one bounded range before any process starts.
 * @param start - range start in ISO 8601 or `YYYY-MM-DD`.
 * @param end - range end in ISO 8601 or `YYYY-MM-DD`.
 * @throws CalendarError with `invalid-input` for a malformed or inverted range.
 */
function assertRange(start: string, end: string): void {
  if (!isDateOrDateTime(start) || !isDateOrDateTime(end)) {
    throw new CalendarError('invalid-input', 'start and end must be ISO 8601 instants or YYYY-MM-DD dates')
  }
  if (Date.parse(start) >= Date.parse(end)) {
    throw new CalendarError('invalid-input', 'start must be earlier than end')
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
 * @throws CalendarError with `invalid-input` for a malformed bound.
 */
function timePoint(bound: string, allDay: boolean, timezone: string, field: 'start' | 'end'): Record<string, string> {
  if (allDay) {
    if (!DATE_ONLY.test(bound)) throw new CalendarError('invalid-input', `${field} must be YYYY-MM-DD for an all-day event`)
    return { date: bound, timezone }
  }
  const millis = Date.parse(bound)
  if (Number.isNaN(millis)) throw new CalendarError('invalid-input', `${field} must be an ISO 8601 instant`)
  return { timestamp: String(Math.floor(millis / TIMESTAMP_SCALE)), timezone }
}

/**
 * Normalize one agenda item.
 * @param raw - one element of the agenda `data` array.
 * @returns the event the panel renders.
 * @throws CalendarError with `upstream` when the item has no id or time bounds.
 */
function toEvent(raw: Record<string, unknown>): CalendarEvent {
  const start = asRecord(raw.start_time)
  const end = asRecord(raw.end_time)
  const allDay = typeof start?.date === 'string'
  const startValue = allDay ? asString(start?.date) : asString(start?.datetime)
  const endValue = allDay ? asString(end?.date) : asString(end?.datetime)
  const eventId = asString(raw.event_id)
  if (eventId === undefined || startValue === undefined || endValue === undefined) {
    throw new CalendarError('upstream', `${PROGRAM} returned an event without id or time bounds`)
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
  }
}

/**
 * Normalize one `+get` payload, adding the master's rule when known.
 * @param raw - the `+get` `data` object.
 * @param recurrence - rule read from the recurring master, when the event is an instance.
 * @returns the drawer's detail.
 * @throws CalendarError with `upstream` when required fields are missing.
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
 * @throws CalendarError with `invalid-input` when the value is empty.
 */
function trimRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new CalendarError('invalid-input', `${field} must not be empty`)
  return trimmed
}
