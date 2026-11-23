/** Panel data plumbing: one route read per month, held in a snapshot store the components subscribe to. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EVENTS_ROUTE, STATUS_ROUTE } from '../paths.ts'
import type { CalendarEvent, CalendarEventsData, CalendarResponse, CalendarStatus } from '../types.ts'
import { monthKey, monthRange, shiftMonth } from './month.ts'

/** What the panel is showing. */
export type CalendarPhase = 'loading' | 'ready' | 'unavailable' | 'error'

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
}

/** Month navigation and refresh the panel's buttons call. */
export interface CalendarActions {
  /** Show the previous month. */
  readonly previousMonth: () => void
  /** Show the next month. */
  readonly nextMonth: () => void
  /** Return to the current month. */
  readonly goToToday: () => void
  /** Re-read the shown month. */
  readonly refresh: () => void
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

/** Loads the shown month and keeps the panel's snapshot current. */
export class CalendarController {
  /** Snapshot store the renderer binds as `useCalendar`. */
  readonly store: SnapshotStore<CalendarViewState>

  /** Buttons' actions. */
  readonly actions: CalendarActions

  /** Route fetcher; tests replace it. */
  private readonly fetcher: typeof fetch

  /** Read in flight, cancelled when another month is shown. */
  private abort: AbortController | undefined

  /**
   * @param fetcher - same-origin fetch used for the relative routes.
   */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
    this.store = createSnapshotStore<CalendarViewState>({
      phase: 'loading',
      month: monthKey(new Date()),
      weekStart: 'monday',
      events: [],
    })
    this.actions = {
      previousMonth: () => { this.showMonth(shiftMonth(this.store.getSnapshot().month, -1)) },
      nextMonth: () => { this.showMonth(shiftMonth(this.store.getSnapshot().month, 1)) },
      goToToday: () => { this.showMonth(monthKey(new Date())) },
      refresh: () => { this.load() },
    }
  }

  /** Start reading the shown month. */
  load(): void {
    void this.read()
  }

  /** Cancel the read in flight; the panel is going away. */
  dispose(): void {
    this.abort?.abort()
  }

  /**
   * Show another month and read it.
   * @param month - month key in `YYYY-MM`.
   */
  private showMonth(month: string): void {
    this.store.set({ ...this.store.getSnapshot(), month })
    this.load()
  }

  /** Read status, then the month's events, into the snapshot. */
  private async read(): Promise<void> {
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    const shown = this.store.getSnapshot()
    this.store.set({ ...shown, phase: 'loading' })
    const range = monthRange(shown.month, shown.weekStart)
    try {
      const status = await this.request<CalendarStatus>(STATUS_ROUTE, signal)
      if (signal.aborted) return
      const named = status.userName === undefined
        ? { phase: shown.phase, month: shown.month, weekStart: status.weekStart, events: shown.events }
        : { phase: shown.phase, month: shown.month, weekStart: status.weekStart, events: shown.events, userName: status.userName }
      if (!status.connected) {
        this.store.set({
          ...named,
          phase: 'unavailable',
          errorCode: status.missingScopes.length > 0 ? 'permission-denied' : 'not-connected',
        })
        return
      }
      const data = await this.request<CalendarEventsData>(`${EVENTS_ROUTE}?start=${range.start}&end=${range.end}`, signal)
      if (signal.aborted) return
      this.store.set({ ...named, phase: 'ready', events: data.events })
    } catch (error: unknown) {
      if (signal.aborted) return
      const code = error instanceof CalendarClientError ? error.code : 'upstream'
      this.store.set({ ...shown, phase: 'error', errorCode: code })
    }
  }

  /**
   * Read one route.
   * @param route - browser-relative route, including its query string.
   * @param signal - read cancellation.
   * @returns the successful payload.
   * @throws CalendarClientError for a failure envelope or an unreadable answer.
   */
  private async request<T>(route: string, signal: AbortSignal): Promise<T> {
    const response = await this.fetcher(route, { signal, headers: { accept: 'application/json' } })
    const body: unknown = await response.json()
    if (!isResponse(body)) throw new CalendarClientError('upstream', 'feishu-calendar route answered malformed JSON')
    if (body.ok === false) throw new CalendarClientError(body.error.code, body.error.message)
    return body.data as T
  }
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
