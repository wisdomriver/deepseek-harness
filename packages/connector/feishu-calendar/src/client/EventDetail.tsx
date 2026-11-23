/** The event detail drawer: fields, Feishu link, focus lock, and Escape to close. */

import { useRef, useState, type ReactNode } from 'react'
import type { EventSelection } from './controller.ts'
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
}

/**
 * Render one event's detail.
 * @param props - selection, localized copy, and close and retry callbacks.
 * @returns the drawer.
 */
export function EventDetail({ selection, t, onClose, onRetry }: EventDetailProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useDialogFocus(panel, onClose)

  const detail = selection.detail
  const appLink = detail?.appLink ?? selection.appLink
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
        {selection.phase === 'error'
          ? (
            <p className={css.notice} role="alert">
              {t('error')}
              <button type="button" className={css.retry} onClick={onRetry}>{t('retry')}</button>
            </p>
          )
          : null}
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
