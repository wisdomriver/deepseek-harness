/** The create dialog: title, optional due date, all-day switch, and description. */

import { useRef, useState, type ReactNode } from 'react'
import type { CreateTaskInput } from '../types.ts'
import type { TaskComposer } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { dueInstant, type Translate } from './format.ts'
import css from './CreateTaskDialog.module.css'

/** Longest title the Host accepts. */
const SUMMARY_LIMIT = 200

/** Longest description the Host accepts. */
const DESCRIPTION_LIMIT = 5000

/** Props the panel hands the dialog. */
export interface CreateTaskDialogProps {
  /** Whether a create is running and the last failure code. */
  readonly composer: TaskComposer
  /** Localized copy. */
  readonly t: Translate
  /** Close without writing. */
  readonly onCancel: () => void
  /** Submit one task. */
  readonly onSubmit: (input: CreateTaskInput) => void
}

/**
 * Render the create form.
 * @param props - composer state, localized copy, and callbacks.
 * @returns the dialog.
 */
export function CreateTaskDialog({ composer, t, onCancel, onSubmit }: CreateTaskDialogProps): ReactNode {
  const panel = useRef<HTMLFormElement>(null)
  const [summary, setSummary] = useState('')
  const [due, setDue] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState<string | undefined>(undefined)
  useDialogFocus(panel, onCancel)
  const busy = composer.pending

  const submit = (): void => {
    const title = summary.trim()
    if (title === '') { setMessage(t('titleRequired')); return }
    if (title.length > SUMMARY_LIMIT) { setMessage(t('titleTooLong')); return }
    if (description.length > DESCRIPTION_LIMIT) { setMessage(t('descriptionTooLong')); return }
    setMessage(undefined)
    const body: CreateTaskInput = {
      summary: title,
      ...(description === '' ? {} : { description }),
      ...(due === '' ? {} : { due: allDay ? due : dueInstant(due), allDay }),
    }
    onSubmit(body)
  }

  return (
    <div className={css.backdrop} onClick={onCancel}>
      <form
        ref={panel}
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('createTitle')}
        onClick={(event) => { event.stopPropagation() }}
        onSubmit={(event) => { event.preventDefault(); submit() }}
      >
        <h3 className={css.title}>{t('createTitle')}</h3>
        <label className={css.field}>
          <span className={css.label}>{t('createSummary')}</span>
          <input
            className={css.input}
            value={summary}
            maxLength={SUMMARY_LIMIT}
            onChange={(event) => { setSummary(event.target.value) }}
          />
        </label>
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.label}>{t('createDue')}</span>
            <input className={css.input} type="date" value={due} onChange={(event) => { setDue(event.target.value) }} />
          </label>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={allDay}
              disabled={due === ''}
              onChange={(event) => { setAllDay(event.target.checked) }}
            />
            <span>{t('createAllDay')}</span>
          </label>
        </div>
        <label className={css.field}>
          <span className={css.label}>{t('createDescription')}</span>
          <textarea
            className={css.textarea}
            value={description}
            rows={4}
            maxLength={DESCRIPTION_LIMIT}
            onChange={(event) => { setDescription(event.target.value) }}
          />
        </label>
        {message === undefined ? null : <p className={css.error} role="alert">{message}</p>}
        {composer.errorCode === undefined ? null : <p className={css.error} role="alert">{t('createFailed')}</p>}
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={onCancel} disabled={busy}>{t('createCancel')}</button>
          <button type="submit" className={css.primary} disabled={busy}>{busy ? t('createSaving') : t('createSubmit')}</button>
        </div>
      </form>
    </div>
  )
}
