/** Panel data plumbing: month reads, event details, creates, and the snapshot store components read. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EVENT_ROUTE, EVENTS_ROUTE, STATUS_ROUTE } from '../paths.ts'
import type {
  CalendarEvent,
  CalendarEventDetail,
  CalendarEventsData,
  CalendarResponse,
  CalendarStatus,
  CreateEventInput,
  DeleteEventInput,
  RecurrenceScope,
  UpdateEventInput,
} from '../types.ts'
import { monthKey, monthRange, shiftMonth } from './month.ts'

/** What the panel is showing. */
export type CalendarPhase = 'loading' | 'ready' | 'unavailable' | 'error'

/** One open event detail. */
export interface EventSelection {
  /** Event the drawer addresses. */
  readonly eventId: string
  /** Loading, ready, or failed. */
  readonly phase: 'loading' | 'ready' | 'error'
  /** Detail once loaded. */
  readonly detail?: CalendarEventDetail
  /** Stable failure code when the read failed. */
  readonly errorCode?: string
  /** Feishu link known from the month list, used when the detail answer omits it. */
  readonly appLink?: string
}

/** The create dialog. */
export interface ComposerState {
  /** create writes a new event; edit updates the target. */
  readonly mode: 'create' | 'edit'
  /** Event being edited; absent in create mode. */
  readonly target?: CalendarEventDetail
  /** Whether the dialog shows. */
  readonly open: boolean
  /** Day the dialog prefills, when the user started from a cell. */
  readonly prefillDate?: string
  /** True while the create request runs. */
  readonly pending: boolean
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
}

/** One pending or failed delete. */
export interface DeleteState {
  /** Event addressed by the confirmation. */
  readonly eventId: string
  /** True while the delete request runs. */
  readonly pending: boolean
  /** Scope chosen for a recurring series. */
  readonly applyTo?: RecurrenceScope
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
}

/** Snapshot the panel renders; the store replaces it wholesale on each transition. */
export interface CalendarViewState {
  /** Loading, ready, unavailable (no sign-in or no permission), or failed. */
  phase: CalendarPhase
  /** Month key in `YYYY-MM`. */
  month: string
  /** Week start reported by the Host. */
  weekStart: 'monday' | 'sunday'
  /** Events covering the month grid's 42 cells. */
  events: readonly CalendarEvent[]
  /** Signed-in user's display name, when known. */
  userName?: string
  /** Stable failure code from the routes, when the phase is unavailable or error. */
  errorCode?: string
  /** The open detail drawer, if any. */
  selection?: EventSelection
  /** The open create dialog, if any. */
  composer?: ComposerState
  /** Event the grid highlights after a successful create. */
  highlightEventId?: string
  /** The pending delete confirmation, if any. */
  deleting?: DeleteState
}

/** Panel interactions components call. */
export interface CalendarActions {
  /** Show the previous month. */
  readonly previousMonth: () => void
  /** Show the next month. */
  readonly nextMonth: () => void
  /** Return to the current month. */
  readonly goToToday: () => void
  /** Re-read the shown month. */
  readonly refresh: () => void
  /** Open one event's detail. */
  readonly openEvent: (eventId: string) => void
  /** Close the detail drawer. */
  readonly closeEvent: () => void
  /** Retry the drawer's detail read. */
  readonly retryDetail: () => void
  /** Open the create dialog, optionally prefilled with a day. */
  readonly openCreate: (date?: string) => void
  /** Open the editor for one loaded detail. */
  readonly openEdit: (detail: CalendarEventDetail) => void
  /** Close the create dialog. */
  readonly closeCreate: () => void
  /** Submit one event to Feishu, creating or updating according to the dialog mode. */
  readonly submitCreate: (input: CreateEventInput, applyTo?: RecurrenceScope) => void
  /** Delete the open event, applying the chosen scope to a recurring series. */
  readonly deleteEvent: (applyTo?: RecurrenceScope) => void
}

/** A route answer that reported a stable failure code. */
export class CalendarClientError extends Error {
  /**
   * @param code - stable code the Host sent.
   * @param message - Host diagnostic, kept for logs only.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CalendarClientError'
  }
}

/** Loads the shown month and the open detail, and submits creates. */
export class CalendarController {
  /** Snapshot store the renderer binds as `useCalendar`. */
  readonly store: SnapshotStore<CalendarViewState>

  /** Components' actions. */
  readonly actions: CalendarActions

  /** Route fetcher; tests replace it. */
  private readonly fetcher: typeof fetch

  /** Month read in flight, cancelled when another month is shown. */
  private abort: AbortController | undefined

  /** Detail read in flight, cancelled when the drawer closes. */
  private detailAbort: AbortController | undefined

  /**
   * @param fetcher - same-origin fetch used for the relative routes.
   */
  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetcher = fetcher
    this.store = createSnapshotStore<CalendarViewState>({
      phase: 'loading',
      month: monthKey(new Date()),
      weekStart: 'monday',
      events: [],
    })
    this.actions = {
      previousMonth: () => { this.showMonth(shiftMonth(this.current().month, -1)) },
      nextMonth: () => { this.showMonth(shiftMonth(this.current().month, 1)) },
      goToToday: () => { this.showMonth(monthKey(new Date())) },
      refresh: () => { this.load() },
      openEvent: (eventId) => { this.openEvent(eventId) },
      closeEvent: () => {
        this.detailAbort?.abort()
        const { selection: _dropped, ...rest } = this.current()
        this.store.set(rest)
      },
      retryDetail: () => {
        const selection = this.current().selection
        if (selection !== undefined) this.openEvent(selection.eventId)
      },
      openCreate: (date) => { this.openCreate(date) },
      openEdit: (detail) => {
        this.store.set({
          ...this.current(),
          composer: { open: true, mode: 'edit', target: detail, pending: false },
        })
      },
      closeCreate: () => {
        const { composer: _dropped, ...rest } = this.current()
        this.store.set(rest)
      },
      submitCreate: (input, applyTo) => { void this.submitCreate(input, applyTo) },
      deleteEvent: (applyTo) => { void this.deleteEvent(applyTo) },
    }
  }

  /** Start reading the shown month. */
  load(): void {
    void this.read()
  }

  /** Cancel reads in flight; the panel is going away. */
  dispose(): void {
    this.abort?.abort()
    this.detailAbort?.abort()
  }

  /** The current snapshot. */
  private current(): CalendarViewState {
    return this.store.getSnapshot()
  }

  /**
   * Show another month and read it.
   * @param month - month key in `YYYY-MM`.
   */
  private showMonth(month: string): void {
    this.store.set({ ...this.current(), month })
    this.load()
  }

  /** Read status, then the month's events, into the snapshot. */
  private async read(): Promise<void> {
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    const shown = this.current()
    this.store.set({ ...shown, phase: 'loading' })
    const range = monthRange(shown.month, shown.weekStart)
    try {
      const status = await this.request<CalendarStatus>(STATUS_ROUTE, signal)
      if (signal.aborted) return
      const named = status.userName === undefined
        ? { ...shown, weekStart: status.weekStart }
        : { ...shown, weekStart: status.weekStart, userName: status.userName }
      if (!status.connected) {
        this.store.set({ ...named, phase: 'unavailable', errorCode: status.missingScopes.length > 0 ? 'permission-denied' : 'not-connected' })
        return
      }
      const data = await this.request<CalendarEventsData>(`${EVENTS_ROUTE}?start=${range.start}&end=${range.end}`, signal)
      if (signal.aborted) return
      this.store.set({ ...named, phase: 'ready', events: data.events })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.store.set({ ...shown, phase: 'error', errorCode: codeOf(error) })
    }
  }

  /**
   * Read one event's detail into the drawer.
   * @param eventId - the event the user opened.
   */
  private openEvent(eventId: string): void {
    this.detailAbort?.abort()
    const abort = new AbortController()
    this.detailAbort = abort
    const listed = this.current().events.find(event => event.eventId === eventId)?.appLink
    this.store.set({
      ...this.current(),
      selection: { eventId, phase: 'loading', ...(listed === undefined ? {} : { appLink: listed }) },
    })
    void this.readDetail(eventId, abort.signal)
  }

  /**
   * Fill the open drawer with the detail answer.
   * @param eventId - event addressed by the drawer.
   * @param signal - read cancellation.
   */
  private async readDetail(eventId: string, signal: AbortSignal): Promise<void> {
    try {
      const data = await this.request<CalendarEventDetail>(`${EVENT_ROUTE}?eventId=${encodeURIComponent(eventId)}`, signal)
      if (signal.aborted) return
      this.store.set({ ...this.current(), selection: { eventId, phase: 'ready', detail: data } })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.store.set({ ...this.current(), selection: { eventId, phase: 'error', errorCode: codeOf(error) } })
    }
  }

  /**
   * Open the create dialog.
   * @param date - day to prefill, when the user started from a cell.
   */
  private openCreate(date: string | undefined): void {
    this.store.set({
      ...this.current(),
      composer: { open: true, mode: 'create', pending: false, ...(date === undefined ? {} : { prefillDate: date }) },
    })
  }

  /**
   * Create or update one event and fold the result back into the grid.
   * @param input - validated form values.
   * @param applyTo - recurring scope for an update; defaults to the whole series.
   */
  private async submitCreate(input: CreateEventInput, applyTo?: RecurrenceScope): Promise<void> {
    const composer = this.current().composer
    if (composer === undefined || composer.pending) return
    this.store.set({ ...this.current(), composer: { ...composer, pending: true } })
    try {
      if (composer.mode === 'edit' && composer.target !== undefined) {
        const update: UpdateEventInput = {
          eventId: composer.target.eventId,
          summary: input.summary,
          allDay: input.allDay,
          start: input.start,
          end: input.end,
          timezone: input.timezone,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(composer.target.recurringEventId === undefined ? {} : { applyTo: applyTo ?? 'all' }),
        }
        await this.request<{ eventId: string }>(EVENT_ROUTE, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'update', ...update }),
        })
        const { composer: _closed, selection: _detail, ...rest } = this.current()
        this.store.set(rest)
      } else {
        const data = await this.request<{ eventId: string }>(EVENTS_ROUTE, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        const { composer: _closed, ...rest } = this.current()
        this.store.set({ ...rest, highlightEventId: data.eventId })
      }
      this.load()
    } catch (error: unknown) {
      this.store.set({
        ...this.current(),
        composer: { ...composer, pending: false, errorCode: codeOf(error) },
      })
    }
  }

  /**
   * Delete the open event, closing the drawer on success.
   * @param applyTo - recurring scope; defaults to the whole series.
   */
  private async deleteEvent(applyTo: RecurrenceScope | undefined): Promise<void> {
    const selection = this.current().selection
    if (selection === undefined) return
    const scope = applyTo ?? (selection.detail?.recurringEventId === undefined ? undefined : 'all')
    const deleting: DeleteState = { eventId: selection.eventId, pending: true, ...(scope === undefined ? {} : { applyTo: scope }) }
    this.store.set({ ...this.current(), deleting })
    try {
      const body: DeleteEventInput = { eventId: selection.eventId, ...(scope === undefined ? {} : { applyTo: scope }) }
      await this.request<{ eventId: string }>(EVENT_ROUTE, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ...body }),
      })
      const { selection: _closed, deleting: _settled, ...rest } = this.current()
      this.store.set(rest)
      this.load()
    } catch (error: unknown) {
      this.store.set({
        ...this.current(),
        deleting: {
          eventId: selection.eventId,
          pending: false,
          errorCode: codeOf(error),
          ...(scope === undefined ? {} : { applyTo: scope }),
        },
      })
    }
  }

  /**
   * Read one route.
   * @param route - browser-relative route, including its query string.
   * @param signal - read cancellation.
   * @param init - extra fetch options, such as method and body.
   * @returns the successful payload.
   * @throws CalendarClientError for a failure envelope or an unreadable answer.
   */
  private async request<T>(route: string, signal: AbortSignal | undefined, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(route, {
      ...init,
      ...(signal === undefined ? {} : { signal }),
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    })
    const body: unknown = await response.json()
    if (!isResponse(body)) throw new CalendarClientError('upstream', 'feishu-calendar route answered malformed JSON')
    if (body.ok === false) throw new CalendarClientError(body.error.code, body.error.message)
    return body.data as T
  }
}

/**
 * Read the stable code off a thrown value.
 * @param error - value caught from a route call.
 * @returns the code, or `upstream` for anything unclassified.
 */
function codeOf(error: unknown): string {
  return error instanceof CalendarClientError ? error.code : 'upstream'
}

/**
 * Test one route answer's envelope.
 * @param value - parsed JSON.
 * @returns true when the value carries an `ok` discriminant.
 */
function isResponse(value: unknown): value is CalendarResponse<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return ok === true || ok === false
}
