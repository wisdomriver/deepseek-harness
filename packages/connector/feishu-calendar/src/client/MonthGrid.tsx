/** The month grid: weekday header, 42 cells, event chips, and a per-cell fold. */

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CalendarEvent } from '../types.ts'
import { calendarAccent } from './color.ts'
import type { CalendarLocaleKey } from './locales.ts'
import { eventsByDay, gridCells, type GridCell } from './month.ts'
import css from './MonthGrid.module.css'

/** Accent classes by {@link calendarAccent} result; index 0 is unused. */
const ACCENT_CLASSES = [css.accent1, css.accent2, css.accent3, css.accent4, css.accent5, css.accent6, css.accent7, css.accent8]

/** Chips one cell shows before it offers its fold control. */
const CHIPS_PER_CELL = 3

/** Columns in the grid. */
const COLUMNS = 7

/** Props the panel hands the grid. */
export interface MonthGridProps {
  /** Month key in `YYYY-MM`. */
  readonly month: string
  /** First column of the grid. */
  readonly weekStart: 'monday' | 'sunday'
  /** Events covering the month's 42 cells. */
  readonly events: readonly CalendarEvent[]
  /** Localized copy. */
  readonly t: (key: CalendarLocaleKey, params?: Record<string, unknown>) => string
  /** Opens one event's detail. */
  readonly onOpenEvent: (eventId: string) => void
  /** Opens the create dialog for one day; absent until the dialog exists. */
  readonly onCreate?: (date: string) => void
  /** Event to highlight after a successful create. */
  readonly highlightEventId?: string | undefined
}

/**
 * Render one month as a fixed six-row grid.
 * @param props - month, week start, events, and localized copy.
 * @returns the grid.
 */
export function MonthGrid({ month, weekStart, events, t, onOpenEvent, onCreate, highlightEventId }: MonthGridProps): ReactNode {
  const cells = useMemo(() => gridCells(month, weekStart), [month, weekStart])
  const byDay = useMemo(() => eventsByDay(events, cells), [events, cells])
  const weekdays = useMemo(() => weekdayLabels(weekStart), [weekStart])
  const [expanded, setExpanded] = useState<readonly string[]>([])
  /* v8 ignore next -- gridCells always yields 42 cells, so the empty-string default for an empty grid is unreachable. */
  const [focused, setFocused] = useState(() => cells.find(cell => cell.isToday)?.date ?? cells[0]?.date ?? '')
  const refs = useRef(new Map<string, HTMLDivElement>())

  const focusCell = (date: string): void => {
    setFocused(date)
    refs.current.get(date)?.focus()
  }

  const step = (date: string, delta: number): void => {
    const index = cells.findIndex(cell => cell.date === date)
    const next = cells[index + delta]
    if (next !== undefined) focusCell(next.date)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, cell: GridCell): void => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(cell.date, -1); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(cell.date, 1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); step(cell.date, -COLUMNS); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(cell.date, COLUMNS); return }
    if (event.key === 'Home') {
      event.preventDefault()
      const start = cells.findIndex(row => row.date === cell.date) - cells.findIndex(row => row.date === cell.date) % COLUMNS
      /* v8 ignore next -- the row start of a cell index is always inside the 42-cell grid. */
      focusCell(cells[start]?.date ?? cell.date)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      const index = cells.findIndex(row => row.date === cell.date)
      /* v8 ignore next -- the last column of a cell's row is always inside the 42-cell grid. */
      focusCell(cells[index - index % COLUMNS + COLUMNS - 1]?.date ?? cell.date)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onCreate?.(cell.date)
    }
  }

  return (
    <div className={css.grid} role="grid" aria-label={t('title')}>
      <div className={css.weekdays} role="row">
        {weekdays.map(label => <div key={label} className={css.weekday} role="columnheader">{label}</div>)}
      </div>
      {rows(cells).map((week) => {
        /* v8 ignore next -- rows() chunks the 42 cells into full seven-cell weeks, so every week has a first cell. */
        const rowKey = week[0]?.date ?? 'row'
        return (
          <div key={rowKey} className={css.week} role="row">
            {week.map((cell) => {
              const dayEvents = byDay.get(cell.date) ?? []
              const shown = expanded.includes(cell.date) ? dayEvents : dayEvents.slice(0, CHIPS_PER_CELL)
              const hidden = dayEvents.length - shown.length
              return (
                <div
                  key={cell.date}
                  ref={(node) => {
                    if (node === null) refs.current.delete(cell.date)
                    else refs.current.set(cell.date, node)
                  }}
                  role="gridcell"
                  tabIndex={cell.date === focused ? 0 : -1}
                  className={[
                    css.cell,
                    cell.inMonth ? '' : css.cellOutside,
                    cell.isToday ? css.cellToday : '',
                    cell.date === focused ? css.cellFocused : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={ariaLabel(cell, dayEvents, t)}
                  onClick={() => onCreate?.(cell.date)}
                  onKeyDown={event => onKeyDown(event, cell)}
                >
                  <span className={css.dayNumber}>{Number(cell.date.slice(8, 10))}</span>
                  <ul className={css.chips} onClick={(event) => { event.stopPropagation() }}>
                    {shown.map(event => (
                      <li key={event.eventId}>
                        <button
                          type="button"
                          className={chipClass(event, highlightEventId)}
                          title={event.summary}
                          onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpenEvent(event.eventId) }}
                        >
                          {event.allDay
                            ? <span className={css.allDay}>{t('allDay')}</span>
                            : <span className={css.time}>{formatTime(event.start)}</span>}
                          <span className={css.chipTitle}>{event.summary === '' ? '—' : event.summary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {hidden > 0
                    ? (
                      <button
                        type="button"
                        className={css.more}
                        onClick={(event) => {
                          event.stopPropagation()
                          setExpanded(previous => [...previous, cell.date])
                        }}
                      >
                        {t('moreEvents', { count: hidden })}
                      </button>
                    )
                    : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Collect the grid's cells into weeks.
 * @param cells - the 42 cells.
 * @returns seven rows of seven cells.
 */
function rows(cells: readonly GridCell[]): GridCell[][] {
  const weeks: GridCell[][] = []
  for (let index = 0; index < cells.length; index += COLUMNS) {
    weeks.push(cells.slice(index, index + COLUMNS))
  }
  return weeks
}

/**
 * Build the weekday header.
 * @param weekStart - first column of the grid.
 * @returns seven short weekday names in the browser locale.
 */
function weekdayLabels(weekStart: 'monday' | 'sunday'): string[] {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  // 2024-01-01 is a Monday; walking from it keeps the row aligned to the configured first column.
  const monday = Date.UTC(2024, 0, 1)
  const offset = weekStart === 'monday' ? 0 : -1
  return Array.from({ length: COLUMNS }, (_, index) => format.format(new Date(monday + (offset + index) * 86_400_000)))
}

/**
 * Describe one cell for assistive technology.
 * @param cell - the cell.
 * @param events - the day's events.
 * @param t - localized copy.
 * @returns the cell's accessible name.
 */
function ariaLabel(
  cell: GridCell,
  events: readonly CalendarEvent[],
  t: MonthGridProps['t'],
): string {
  const date = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${cell.date}T00:00:00`))
  return `${date} · ${t('eventCount', { count: events.length })}`
}

/**
 * Format one timed event's local start.
 * @param start - ISO 8601 instant.
 * @returns the browser-local clock time.
 */
function formatTime(start: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(start))
}

/**
 * Class list for one event chip: its calendar accent and the create highlight.
 * @param event - the event.
 * @param highlightEventId - event created by the last successful submit.
 * @returns the chip's class names.
 */
function chipClass(event: CalendarEvent, highlightEventId: string | undefined): string {
  const accent = ACCENT_CLASSES[calendarAccent(event.colorIndex) - 1]
  return [css.chip, accent, event.eventId === highlightEventId ? css.chipHighlight : ''].filter(Boolean).join(' ')
}
