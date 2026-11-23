/** Today's agenda above the grid: time, title, running state, and a five-row fold. */

import { useState, type ReactNode } from 'react'
import type { CalendarEvent } from '../types.ts'
import { formatClock, isRunning, localDay, type Translate } from './format.ts'
import { coversDay } from './month.ts'
import css from './AgendaStrip.module.css'

/** Rows shown before the fold control appears. */
const ROWS = 5

/** Props the panel hands the strip. */
export interface AgendaStripProps {
  /** Events covering the month grid. */
  readonly events: readonly CalendarEvent[]
  /** Localized copy. */
  readonly t: Translate
  /** Open one event's detail. */
  readonly onOpen: (eventId: string) => void
}

/**
 * Render today's agenda.
 * @param props - month events, localized copy, and the open callback.
 * @returns the strip.
 */
export function AgendaStrip({ events, t, onOpen }: AgendaStripProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const today = localDay(new Date())
  const agenda = events.filter(event => coversDay(event, today)).sort(compare)
  const shown = expanded ? agenda : agenda.slice(0, ROWS)
  return (
    <section className={css.strip} aria-label={t('agendaTitle')}>
      <div className={css.head}>
        <h3 className={css.title}>{t('agendaTitle')}</h3>
        {!expanded && agenda.length > ROWS
          ? <button type="button" className={css.link} onClick={() => { setExpanded(true) }}>{t('agendaAll')}</button>
          : null}
      </div>
      {agenda.length === 0
        ? <p className={css.empty}>{t('agendaEmpty')}</p>
        : (
          <ul className={css.rows}>
            {shown.map(event => (
              <li key={event.eventId}>
                <button type="button" className={css.row} onClick={() => { onOpen(event.eventId) }}>
                  <span className={css.when}>{event.allDay ? t('allDay') : formatClock(event.start)}</span>
                  <span className={css.summary}>{event.summary === '' ? '—' : event.summary}</span>
                  {isRunning(event) ? <span className={css.running}>{t('inProgress')}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/**
 * Order agenda rows: all-day first, then by start.
 * @param left - first event.
 * @param right - second event.
 * @returns the comparator result.
 */
function compare(left: CalendarEvent, right: CalendarEvent): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  return left.start.localeCompare(right.start)
}
