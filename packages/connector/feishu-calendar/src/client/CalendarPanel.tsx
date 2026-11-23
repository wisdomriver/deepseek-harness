/** The calendar panel: month navigation, state cards, and the month grid. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CalendarActions, CalendarViewState } from './controller.ts'
import { MonthGrid } from './MonthGrid.tsx'
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
  return (
    <section className={css.panel} aria-label={props.t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{props.t('title')}</h2>
        <span className={css.month}>{formatMonth(state.month)}</span>
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
      {state.phase === 'ready'
        ? <MonthGrid month={state.month} weekStart={state.weekStart} events={state.events} t={props.t} />
        : null}
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
