/** The create and edit dialog: title, all-day switch, bounds, details, scope, and the conflict hint. */

import { useRef, useState, type ReactNode } from 'react'
import type { CalendarEvent, CalendarEventDetail, CreateEventInput, RecurrenceScope } from '../types.ts'
import type { ComposerState } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { localDay, type Translate } from './format.ts'
import css from './CreateDialog.module.css'

/** Minutes one default event lasts. */
const DEFAULT_MINUTES = 30

/** Props the panel hands the dialog. */
export interface CreateDialogProps {
  /** Whether the dialog is open, whether a save is running, and the event being edited. */
  readonly composer: ComposerState
  /** Localized copy. */
  readonly t: Translate
  /** The month's events, used for the overlap hint. */
  readonly events: readonly CalendarEvent[]
  /** Close without writing. */
  readonly onCancel: () => void
  /** Submit one event, with the recurring scope an update needs. */
  readonly onSubmit: (input: CreateEventInput, applyTo?: RecurrenceScope) => void
}

/**
 * Render the create or edit form.
 * @param props - composer state, localized copy, events, and callbacks.
 * @returns the dialog.
 */
export function CreateDialog({ composer, t, events, onCancel, onSubmit }: CreateDialogProps): ReactNode {
  const panel = useRef<HTMLFormElement>(null)
  const target = composer.target
  const initial = initialValues(target, composer.prefillDate)
  const [summary, setSummary] = useState(initial.summary)
  const [allDay, setAllDay] = useState(initial.allDay)
  const [startDate, setStartDate] = useState(initial.startDate)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [description, setDescription] = useState(initial.description)
  const [scope, setScope] = useState<RecurrenceScope>('all')
  const [message, setMessage] = useState<string | undefined>(undefined)
  useDialogFocus(panel, onCancel)

  const conflict = conflictSummary({ allDay, startDate, endDate, startTime, endTime }, events, target?.eventId)
  const busy = composer.pending
  const heading = target === undefined ? t('createTitle') : t('editTitle')
  const recurring = target?.recurringEventId !== undefined

  const submit = (): void => {
    const trimmed = summary.trim()
    if (trimmed === '') { setMessage(t('titleRequired')); return }
    if (trimmed.length > 100) { setMessage(t('titleTooLong')); return }
    if (description.length > 5000) { setMessage(t('descriptionTooLong')); return }
    const applyTo = recurring && !allDay ? scope : undefined
    if (allDay) {
      if (endDate < startDate) { setMessage(t('endBeforeStart')); return }
      setMessage(undefined)
      onSubmit({ summary: trimmed, allDay: true, start: startDate, end: endDate, timezone: timezone(), ...(description === '' ? {} : { description }) }, applyTo)
      return
    }
    const start = toIso(startDate, startTime)
    const end = toIso(endDate, endTime)
    if (Date.parse(end) <= Date.parse(start)) { setMessage(t('endBeforeStart')); return }
    setMessage(undefined)
    onSubmit({ summary: trimmed, allDay: false, start, end, timezone: timezone(), ...(description === '' ? {} : { description }) }, applyTo)
  }

  return (
    <div className={css.backdrop} onClick={onCancel}>
      <form
        ref={panel}
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(event) => { event.stopPropagation() }}
        onSubmit={(event) => { event.preventDefault(); submit() }}
      >
        <h3 className={css.title}>{heading}</h3>
        <label className={css.field}>
          <span className={css.label}>{t('createSummary')}</span>
          <input className={css.input} value={summary} maxLength={120} onChange={(event) => { setSummary(event.target.value) }} />
        </label>
        <label className={css.check}>
          <input type="checkbox" checked={allDay} onChange={(event) => { setAllDay(event.target.checked) }} />
          <span>{t('createAllDay')}</span>
        </label>
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.label}>{t('createStart')}</span>
            <input className={css.input} type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value) }} />
          </label>
          {allDay ? null : (
            <label className={css.field}>
              <input className={css.input} type="time" aria-label={t('createStart')} value={startTime} onChange={(event) => { setStartTime(event.target.value) }} />
            </label>
          )}
        </div>
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.label}>{t('createEnd')}</span>
            <input className={css.input} type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value) }} />
          </label>
          {allDay ? null : (
            <label className={css.field}>
              <input className={css.input} type="time" aria-label={t('createEnd')} value={endTime} onChange={(event) => { setEndTime(event.target.value) }} />
            </label>
          )}
        </div>
        {recurring && !allDay ? (
          <label className={css.field}>
            <span className={css.label}>{t('scopeLabel')}</span>
            <select value={scope} onChange={(event) => { setScope(event.target.value as RecurrenceScope) }}>
              <option value="single">{t('scopeSingle')}</option>
              <option value="all">{t('scopeAll')}</option>
              <option value="this-and-following">{t('scopeFollowing')}</option>
            </select>
          </label>
        ) : null}
        <label className={css.field}>
          <span className={css.label}>{t('createDescription')}</span>
          <textarea className={css.textarea} value={description} rows={4} onChange={(event) => { setDescription(event.target.value) }} />
        </label>
        {conflict === undefined ? null : <p className={css.hint}>{t('conflictHint', { summary: conflict })}</p>}
        {message === undefined ? null : <p className={css.error} role="alert">{message}</p>}
        {composer.errorCode === undefined ? null : <p className={css.error} role="alert">{t('saveFailed')}</p>}
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={onCancel} disabled={busy}>{t('createCancel')}</button>
          <button type="submit" className={css.primary} disabled={busy}>{busy ? t('createSaving') : t('createSubmit')}</button>
        </div>
      </form>
    </div>
  )
}

/** The form's bounded values. */
interface Bounds {
  readonly allDay: boolean
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
}

/** Initial field values for create mode or for editing one event. */
interface InitialValues {
  readonly summary: string
  readonly allDay: boolean
  readonly startDate: string
  readonly startTime: string
  readonly endDate: string
  readonly endTime: string
  readonly description: string
}

/**
 * Derive the form's starting values.
 * @param target - event being edited, or undefined in create mode.
 * @param prefillDate - day the create dialog starts on.
 * @returns every field's initial value.
 */
function initialValues(target: CalendarEventDetail | undefined, prefillDate: string | undefined): InitialValues {
  const defaults = defaultTimes()
  const day = prefillDate ?? localDay(new Date())
  if (target === undefined) {
    return { summary: '', allDay: false, startDate: day, startTime: defaults.start, endDate: day, endTime: defaults.end, description: '' }
  }
  if (target.allDay) {
    return {
      summary: target.summary,
      allDay: true,
      startDate: target.start,
      startTime: defaults.start,
      endDate: target.end,
      endTime: defaults.end,
      description: target.description ?? '',
    }
  }
  const start = new Date(target.start)
  const end = new Date(target.end)
  return {
    summary: target.summary,
    allDay: false,
    startDate: localDay(start),
    startTime: clock(start),
    endDate: localDay(end),
    endTime: clock(end),
    description: target.description ?? '',
  }
}

/**
 * Find one existing event overlapping the form's bounds.
 * @param bounds - current form values.
 * @param events - the month's events.
 * @param ignoredId - event being edited, excluded from the hint.
 * @returns the first overlapping title, when any.
 */
function conflictSummary(bounds: Bounds, events: readonly CalendarEvent[], ignoredId: string | undefined): string | undefined {
  const candidates = events.filter(event => event.eventId !== ignoredId)
  if (bounds.allDay) {
    const hit = candidates.find(event => event.allDay && event.start <= bounds.endDate && event.end >= bounds.startDate)
    return hit?.summary
  }
  const start = Date.parse(toIso(bounds.startDate, bounds.startTime))
  const end = Date.parse(toIso(bounds.endDate, bounds.endTime))
  const hit = candidates.find(event => !event.allDay && Date.parse(event.start) < end && Date.parse(event.end) > start)
  return hit?.summary
}

/**
 * Build one ISO instant from local date and time inputs.
 * @param date - `YYYY-MM-DD`.
 * @param time - `HH:MM`.
 * @returns the ISO 8601 instant.
 */
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

/**
 * The browser's IANA timezone.
 * @returns the timezone identifier the Host stores.
 */
function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Default bounds: the next whole hour, thirty minutes long.
 * @returns local clock times.
 */
function defaultTimes(): { readonly start: string; readonly end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0)
  const end = new Date(start.getTime() + DEFAULT_MINUTES * 60_000)
  return { start: clock(start), end: clock(end) }
}

/**
 * Format one instant as an `HH:MM` input value.
 * @param date - the instant.
 * @returns the local clock time.
 */
function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
