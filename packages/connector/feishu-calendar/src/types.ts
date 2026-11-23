/**
 * Wire types shared by the Feishu calendar Host routes and the browser panel.
 * @module @deepseek-ai/dsh-feishu-calendar/types
 */

/** One normalized calendar event the panel renders. */
export interface CalendarEvent {
  /** Opaque event id; recurring instances carry a `<master>_<startEpoch>` suffix. */
  readonly eventId: string
  /** Event title as stored in Feishu; empty when untitled. */
  readonly summary: string
  /** True for date-only events whose `end` date is inclusive. */
  readonly allDay: boolean
  /** Timed events: ISO 8601 with offset. All-day events: the start date. */
  readonly start: string
  /** Timed events: ISO 8601 with offset. All-day events: the inclusive end date. */
  readonly end: string
  /** Timezone the event was authored in, as Feishu reports it. */
  readonly sourceTimezone: string
  /** Feishu event status, e.g. `confirmed`. */
  readonly status: string
  /** True when this instance differs from its recurring series. */
  readonly isException: boolean
  /** Link that opens the event in Feishu, when the CLI returned one. */
  readonly appLink?: string
}

/** One event's full detail, read when the drawer opens. */
export interface CalendarEventDetail extends CalendarEvent {
  /** Organizer display name, when the CLI returned one. */
  readonly organizer?: string
  /** Markdown description as Feishu stores it. */
  readonly description?: string
  /** RFC 5545 rule without the `RRULE:` prefix; only recurring masters carry it. */
  readonly recurrence?: string
  /** The signed-in user's response: `accept`, `decline`, `tentative`, or `needs_action`. */
  readonly selfRsvpStatus?: string
}

/** CLI, account, and authorization facts the panel needs to choose between its states. */
export interface CalendarStatus {
  /** True when the `lark-cli` executable resolved. */
  readonly cli: boolean
  /** True when the CLI has an application configured. */
  readonly configured: boolean
  /** True when a user identity is signed in and usable. */
  readonly connected: boolean
  /** Signed-in user's display name. */
  readonly userName?: string
  /** Calendar scopes the deployment asks for and the token lacks. */
  readonly missingScopes: readonly string[]
  /** Week start configured on the Host; the panel renders the grid from it. */
  readonly weekStart: 'monday' | 'sunday'
}

/** Body the panel posts to create one event. */
export interface CreateEventInput {
  /** Non-empty title, at most 100 characters. */
  readonly summary: string
  /** Date-only event when true. */
  readonly allDay: boolean
  /** Timed events: ISO 8601 with offset. All-day events: the start date. */
  readonly start: string
  /** Timed events: ISO 8601 with offset. All-day events: the inclusive end date. */
  readonly end: string
  /** IANA timezone the browser used for `start` and `end`. */
  readonly timezone: string
  /** Markdown description, at most 5000 characters. */
  readonly description?: string
}

/** Successful payload of every route. */
export interface CalendarSuccess<T> {
  readonly ok: true
  readonly data: T
}

/** Failure payload of every route; `code` is stable, `message` is for humans. */
export interface CalendarFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly requestId: string
  }
}

/** One route answer. */
export type CalendarResponse<T> = CalendarSuccess<T> | CalendarFailure

/** Event list payload. */
export interface CalendarEventsData {
  readonly events: readonly CalendarEvent[]
  /** ISO instant the Host read the list. */
  readonly fetchedAt: string
}
