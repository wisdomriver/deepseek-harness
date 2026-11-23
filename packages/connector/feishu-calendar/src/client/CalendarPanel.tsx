/** The calendar panel: month navigation, state cards, and the month's event list. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CalendarEvent } from '../types.ts'
import type { CalendarActions, CalendarViewState } from './controller.ts'
import css from './CalendarPanel.module.css'

/** Registration-side face the panel's slot entry injects. */
export interface CalendarFace {
  /** Panel snapshot, bound by the renderer as `useCalendar`. */
  readonly hooks: { readonly calendar: SnapshotStore<CalendarViewState> }
  /** Month navigation and refresh. */
  readonly actions: CalendarActions
}

/** Full props the main slot renderer assembles. */
export type CalendarPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'feishuCalendar'>
  & InjectFace<CalendarFace>

/**
 * Render the calendar panel for the shown month.
 * @param props - framework shares, localized copy, and the injected calendar face.
 * @returns the panel.
 */
export function CalendarPanel(props: CalendarPanelProps): ReactNode {
  const state = props.useCalendar(snapshot => snapshot)
  const monthLabel = formatMonth(state.month)
  return (
    <section className={css.panel} aria-label={props.t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{props.t('title')}</h2>
        <span className={css.month}>{monthLabel}</span>
        <div className={css.controls}>
          <button type="button" aria-label={props.t('previousMonth')} onClick={props.actions.previousMonth}>‹</button>
          <button type="button" onClick={props.actions.goToToday}>{props.t('today')}</button>
          <button type="button" aria-label={props.t('nextMonth')} onClick={props.actions.nextMonth}>›</button>
          <button type="button" onClick={props.actions.refresh}>{props.t('refresh')}</button>
        </div>
      </header>
      {state.phase === 'loading' ? <p className={css.notice} role="status">{props.t('loading')}</p> : null}
      {state.phase === 'unavailable' ? <p className={css.notice} role="status">{unavailableText(props, state.errorCode)}</p> : null}
      {state.phase === 'error' ? (
        <p className={css.notice} role="alert">
          {state.errorCode === 'cli-missing' ? props.t('cliMissing') : props.t('error')}
          <button type="button" className={css.retry} onClick={props.actions.refresh}>{props.t('retry')}</button>
        </p>
      ) : null}
      {state.phase === 'ready' ? (
        state.events.length === 0
          ? <p className={css.notice} role="status">{props.t('empty')}</p>
          : <ol className={css.events} aria-label={props.t('eventCount', { count: state.events.length })}>
            {state.events.map(event => (
              <li key={event.eventId} className={css.event}>
                <span className={css.when}>{event.allDay ? props.t('allDay') : formatTime(event)}</span>
                <span className={css.summary}>{event.summary === '' ? '—' : event.summary}</span>
              </li>
            ))}
          </ol>
      ) : null}
    </section>
  )
}

/**
 * Localized copy for an unavailable panel.
 * @param props - the panel's props.
 * @param code - stable code the Host sent.
 * @returns the message to show.
 */
function unavailableText(props: CalendarPanelProps, code: string | undefined): string {
  if (code === 'permission-denied') return props.t('permissionDenied')
  if (code === 'not-configured') return props.t('notConfigured')
  return props.t('notConnected')
}

/**
 * Format a month key for the header.
 * @param month - `YYYY-MM`.
 * @returns the localized month and year.
 */
function formatMonth(month: string): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T00:00:00`))
}

/**
 * Format one timed event's local start.
 * @param event - the event, whose `start` is ISO 8601 with an offset.
 * @returns the browser-local clock time.
 */
function formatTime(event: CalendarEvent): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(event.start))
}
