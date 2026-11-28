/** The task detail drawer: fields, description fold, completion, Feishu link, and focus lock. */

import { useRef, useState, type ReactNode } from 'react'
import type { TaskMark, TaskSelection } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { abbreviateId, formatDue, formatTimestamp, type Translate } from './format.ts'
import css from './TaskDetail.module.css'

/** Characters shown before the description folds. */
const DESCRIPTION_FOLD = 2000

/** Props the panel hands the drawer. */
export interface TaskDetailProps {
  /** The open drawer's state. */
  readonly selection: TaskSelection
  /** The optimistic mark for this task, when a write is running. */
  readonly mark: TaskMark | undefined
  /** Localized copy. */
  readonly t: Translate
  /** Close the drawer. */
  readonly onClose: () => void
  /** Retry a failed detail read. */
  readonly onRetry: () => void
  /** Mark this task complete. */
  readonly onComplete: (taskId: string) => void
  /** Reopen this task. */
  readonly onReopen: (taskId: string) => void
}

/**
 * Render one task's detail.
 * @param props - selection, mark, localized copy, and the drawer's callbacks.
 * @returns the drawer.
 */
export function TaskDetail({ selection, mark, t, onClose, onRetry, onComplete, onReopen }: TaskDetailProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  useDialogFocus(panel, onClose)

  const detail = selection.detail
  const status = mark?.status ?? detail?.status
  const done = status === 'done'
  const pending = mark?.pending === true
  const appLink = detail?.appLink ?? selection.appLink
  const description = detail?.description
  const long = (description?.length ?? 0) > DESCRIPTION_FOLD
  const title = detail === undefined || detail.summary === '' ? t('title') : detail.summary
  return (
    <div className={css.backdrop} onClick={onClose}>
      <div
        ref={panel}
        className={css.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className={css.header}>
          <h3 className={css.title}>{title}</h3>
          <button type="button" className={css.close} onClick={onClose} aria-label={t('close')}>×</button>
        </header>
        {selection.phase === 'loading' ? <p className={css.notice} role="status">{t('loading')}</p> : null}
        {selection.phase === 'error' ? (
          <p className={css.notice} role="alert">
            {t('error')}
            <button type="button" className={css.retry} onClick={onRetry}>{t('retry')}</button>
          </p>
        ) : null}
        {detail !== undefined && selection.phase === 'ready'
          ? (
            <>
              {detail.dueAt === undefined ? null : (
                <p className={css.when}>
                  {detail.dueAllDay === true ? <span className={css.tag}>{t('allDay')}</span> : null}
                  {formatDue(detail.dueAt, detail.dueAllDay === true)}
                </p>
              )}
              <dl className={css.fields}>
                <Field
                  label={t('detailStatus')}
                  value={
                    /* v8 ignore next -- detail.status is non-optional, so this arm only narrows `detail?.status`. */
                    status === undefined ? undefined : t(done ? 'statusDone' : 'statusTodo')
                  }
                />
                <Field label={t('detailCompletedAt')} value={detail.completedAt === undefined ? undefined : formatTimestamp(detail.completedAt)} />
                <Field label={t('detailCreator')} value={detail.creator === undefined ? undefined : abbreviateId(detail.creator)} />
                <Field label={t('detailAssignees')} value={members(detail.assignees)} />
                <Field label={t('detailFollowers')} value={members(detail.followers)} />
                <Field label={t('detailTasklists')} value={members(detail.tasklists)} />
                <Field label={t('detailSubtasks')} value={detail.subtaskCount === undefined ? undefined : String(detail.subtaskCount)} />
                <Field label={t('detailParent')} value={detail.parentTaskId === undefined ? undefined : abbreviateId(detail.parentTaskId)} />
                <Field label={t('detailUpdated')} value={detail.updatedAt === undefined ? undefined : formatTimestamp(detail.updatedAt)} />
              </dl>
              {description === undefined ? null : (
                <div className={css.descriptionBlock}>
                  <p className={css.label}>{t('detailDescription')}</p>
                  <p className={css.description}>{long && !expanded ? `${description.slice(0, DESCRIPTION_FOLD)}…` : description}</p>
                  {long
                    ? (
                      <button type="button" className={css.more} onClick={() => { setExpanded(!expanded) }}>
                        {expanded ? t('showLess') : t('showMore')}
                      </button>
                    )
                    : null}
                </div>
              )}
              <footer className={css.footer}>
                <button
                  type="button"
                  className={css.action}
                  disabled={pending}
                  onClick={() => {
                    if (done) onReopen(detail.taskId)
                    else onComplete(detail.taskId)
                  }}
                >
                  {done ? t('reopen') : t('complete')}
                </button>
                {appLink === undefined ? null : <a className={css.action} href={appLink} target="_blank" rel="noreferrer">{t('openInFeishu')}</a>}
                <span className={css.spacer} />
                <button type="button" className={css.action} onClick={onClose}>{t('close')}</button>
              </footer>
            </>
          )
          : null}
      </div>
    </div>
  )
}

/**
 * Render one labelled detail field.
 * @param props - the field's label and value; absent values render nothing.
 * @returns the field's two definition-list cells, or null.
 */
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
 * Join one member list for display.
 * @param ids - member ids.
 * @returns the abbreviated ids, or undefined when the list is empty.
 */
function members(ids: readonly string[]): string | undefined {
  return ids.length === 0 ? undefined : ids.map(abbreviateId).join(', ')
}
