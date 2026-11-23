/** Month arithmetic and day layout for the grid: 42 UTC days, and which events each day shows. */

import type { CalendarEvent } from '../types.ts'

/** Days a fixed six-row grid covers. */
const GRID_DAYS = 42

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** One grid cell. */
export interface GridCell {
  /** Calendar date in `YYYY-MM-DD`. */
  readonly date: string
  /** False for the leading and trailing days borrowed from the neighbouring months. */
  readonly inMonth: boolean
  /** True for the browser's today. */
  readonly isToday: boolean
}

/**
 * Shift a `YYYY-MM` month key by whole months.
 * @param month - current month key.
 * @param delta - months to move; negative moves backwards.
 * @returns the shifted month key.
 */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month)
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Day the month grid starts on, in UTC.
 * @param month - month key.
 * @param weekStart - first column of the grid.
 * @returns the ISO `YYYY-MM-DD` date of the grid's first cell.
 */
export function gridStart(month: string, weekStart: 'monday' | 'sunday'): string {
  const { year, monthIndex } = parseMonth(month)
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const weekday = first.getUTCDay()
  const offset = weekStart === 'monday' ? (weekday + 6) % 7 : weekday
  return isoDate(new Date(first.getTime() - offset * DAY_MS))
}

/**
 * Half-open range one month view reads.
 * @param month - month key.
 * @param weekStart - first column of the grid.
 * @returns ISO `YYYY-MM-DD` bounds; `end` is the day after the grid's last cell.
 */
export function monthRange(month: string, weekStart: 'monday' | 'sunday'): { readonly start: string; readonly end: string } {
  const start = new Date(`${gridStart(month, weekStart)}T00:00:00Z`)
  return { start: isoDate(start), end: isoDate(new Date(start.getTime() + GRID_DAYS * DAY_MS)) }
}

/**
 * Month key of one instant in local time.
 * @param date - instant to name.
 * @returns the `YYYY-MM` key.
 */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Build the grid's fixed 42 cells.
 * @param month - month key the grid shows.
 * @param weekStart - first column of the grid.
 * @param today - instant naming the highlighted day; defaults to now.
 * @returns 42 cells in reading order.
 */
export function gridCells(month: string, weekStart: 'monday' | 'sunday', today: Date = new Date()): GridCell[] {
  const start = new Date(`${gridStart(month, weekStart)}T00:00:00Z`)
  const todayKey = localDate(today)
  const cells: GridCell[] = []
  for (let index = 0; index < GRID_DAYS; index += 1) {
    const date = isoDate(new Date(start.getTime() + index * DAY_MS))
    cells.push({ date, inMonth: date.slice(0, 7) === month, isToday: date === todayKey })
  }
  return cells
}

/**
 * Place each event on every calendar day it covers.
 * @param events - the month's events.
 * @param cells - the grid cells; only their dates matter.
 * @returns events per cell date, all-day events first and then by start.
 */
export function eventsByDay(events: readonly CalendarEvent[], cells: readonly GridCell[]): ReadonlyMap<string, readonly CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>()
  const dates = new Set(cells.map(cell => cell.date))
  for (const event of events) {
    for (const date of coveredDates(event)) {
      if (!dates.has(date)) continue
      const bucket = byDay.get(date)
      if (bucket === undefined) byDay.set(date, [event])
      else bucket.push(event)
    }
  }
  for (const bucket of byDay.values()) bucket.sort(compareEvents)
  return byDay
}

/**
 * The calendar days one event occupies, ending day included.
 * @param event - one event.
 * @returns its dates in `YYYY-MM-DD`, one day when it is a single-day event.
 */
function coveredDates(event: CalendarEvent): string[] {
  const start = event.allDay ? event.start : localDate(new Date(event.start))
  const end = event.allDay ? event.end : localDate(new Date(event.end))
  const dates: string[] = []
  const last = Date.parse(`${end}T00:00:00Z`)
  for (let cursor = Date.parse(`${start}T00:00:00Z`); cursor <= last; cursor += DAY_MS) {
    dates.push(isoDate(new Date(cursor)))
  }
  return dates
}

/**
 * Order two events within one day: all-day first, then by start, then by id.
 * @param left - first event.
 * @param right - second event.
 * @returns the comparator result.
 */
function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  const byStart = left.start.localeCompare(right.start)
  return byStart !== 0 ? byStart : left.eventId.localeCompare(right.eventId)
}

/**
 * Split one month key into its UTC-arithmetic parts.
 * @param month - month key in `YYYY-MM`.
 * @returns the year and the zero-based month index.
 * @throws when the key is not two dash-separated numbers.
 */
function parseMonth(month: string): { readonly year: number; readonly monthIndex: number } {
  const [yearText = '', monthText = ''] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error(`feishu-calendar: invalid month key "${month}"`)
  }
  return { year, monthIndex: monthNumber - 1 }
}

/**
 * Format one UTC day as `YYYY-MM-DD`.
 * @param date - the day.
 * @returns the ISO date.
 */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Format one instant's day in the browser's timezone.
 * @param date - the instant.
 * @returns the local `YYYY-MM-DD`.
 */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
