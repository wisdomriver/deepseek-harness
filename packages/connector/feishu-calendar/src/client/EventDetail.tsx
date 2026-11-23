/** The event detail drawer: fields, Feishu link, edit and delete actions, focus lock, Escape to close. */

import { useRef, useState, type ReactNode } from 'react'
import type { CalendarEventDetail, RecurrenceScope } from '../types.ts'
import type { DeleteState, EventSelection } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { eventWhen, recurrenceLabel, rsvpLabel, statusLabel, type Translate } from './format.ts'
import css from './EventDetail.module.css'

/** Props the panel hands the drawer. */
export interface EventDetailProps {
  /** The open drawer's state. */
  readonly selection: EventSelection
  /** Localized copy. */
  readonly t: Translate
  /** Close the drawer. */
  readonly onClose: () => void
  /** Retry a failed detail read. */
  readonly onRetry: () => void
  /** Open the editor for this detail. */
  readonly onEdit: (detail: CalendarEventDetail) => void
  /** Delete the event, applying the chosen scope to a recurring series. */
  readonly onDelete: (applyTo?: RecurrenceScope) => void
  /** Pending or failed delete, when one was attempted. */
  readonly deleting?: DeleteState | undefined
}

/**
 * Render one event's detail.
 * @param props - selection, localized copy, and close, retry, edit, and delete callbacks.
 * @returns the drawer.
 */
export function EventDetail({ selection, t, onClose, onRetry, onEdit, onDelete, deleting }: EventDetailProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [scope, setScope] = useState<RecurrenceScope>('all')
  useDialogFocus(panel, onClose)

  const detail = selection.detail
  const appLink = detail?.appLink ?? selection.appLink
  const recurring = detail?.recurringEventId !== undefined
  const busy = deleting?.pending === true
  return (
    <div className={css.backdrop} onClick={onClose}>
      <div
        ref={panel}
        className={css.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={detail?.summary ?? t('title')}
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className={css.header}>
          <h3 className={css.title}>{detail?.summary === undefined || detail.summary === '' ? '—' : detail.summary}</h3>
          <button type="button" className={css.close} onClick={onClose} aria-label={t('createCancel')}>×</button>
        </header>
        {selection.phase === 'loading' ? <p className={css.notice} role="status">{t('loading')}</p> : null}
        {selection.phase === 'error' ? (
          <p className={css.notice} role="alert">
            {t('error')}
            <button type="button" className={css.retry} onClick={onRetry}>{t('retry')}</button>
          </p>
        ) : null}
        {detail !== undefined && selection.phase === 'ready' ? (
          <>
            <p className={css.when}>
              {detail.allDay ? <span className={css.tag}>{t('allDay')}</span> : null}
              {eventWhen(detail)}
            </p>
            <dl className={css.fields}>
              <Field label={t('detailTimezone')} value={detail.sourceTimezone} />
              <Field label={t('detailOrganizer')} value={detail.organizer} />
              <Field label={t('detailRsvp')} value={rsvpLabel(detail.selfRsvpStatus, t)} />
              <Field label={t('detailStatus')} value={statusLabel(detail.status, t)} />
              <Field label={t('detailRecurrence')} value={recurrenceLabel(detail.recurrence, t)} />
            </dl>
            {detail.description === undefined || detail.description === ''
              ? null
              : <p className={css.description}>{detail.description}</p>}
            {confirming && recurring ? (
              <label className={css.scope}>
                <span className={css.label}>{t('scopeLabel')}</span>
                <select value={scope} onChange={(event) => { setScope(event.target.value as RecurrenceScope) }}>
                  <option value="single">{t('scopeSingle')}</option>
                  <option value="all">{t('scopeAll')}</option>
                  <option value="this-and-following">{t('scopeFollowing')}</option>
                </select>
              </label>
            ) : null}
            {deleting?.errorCode === undefined ? null : <p className={css.error} role="alert">{t('deleteFailed')}</p>}
            <footer className={css.footer}>
              {appLink === undefined
                ? (
                  <button
                    type="button"
                    className={css.action}
                    onClick={() => {
                      void copyText(`${detail.summary} ${eventWhen(detail)}`).then(() => { setCopied(true) })
                    }}
                  >
                    {copied ? t('copied') : t('copyInfo')}
                  </button>
                )
                : <a className={css.action} href={appLink} target="_blank" rel="noreferrer">{t('openInFeishu')}</a>}
              <span className={css.spacer} />
              <button type="button" className={css.action} onClick={() => { onEdit(detail) }}>{t('edit')}</button>
              <button
                type="button"
                className={confirming ? css.danger : css.action}
                disabled={busy}
                onClick={() => {
                  if (!confirming) { setConfirming(true); return }
                  onDelete(recurring ? scope : undefined)
                }}
              >
                {confirming ? t('confirmDelete') : t('delete')}
              </button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** One labelled detail field. */
function Field({ label, value }: { readonly label: string; readonly value: string | undefined }): ReactNode {
  if (value === undefined || value === '') return null
  return (
    <>
      <dt className={css.label}>{label}</dt>
      <dd className={css.value}>{value}</dd>
    </>
  )
}

/**
 * Write text to the clipboard.
 * @param text - text to copy.
 * @returns completion of the write.
 */
async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
