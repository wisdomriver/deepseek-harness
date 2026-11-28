/** The new-document form: title, initial Markdown, and the target location. */

import { useRef, useState, type ReactNode } from 'react'
import type { CreateDocInput } from '../types.ts'
import type { DocComposerState } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { MultilineField } from './MultilineField.tsx'
import type { Translate } from './format.ts'
import css from './DocCreateDialog.module.css'

/** Props the panel hands the create dialog. */
export interface DocCreateDialogProps {
  /** Dialog state. */
  readonly composer: DocComposerState
  /** Localized copy. */
  readonly t: Translate
  /** Folder the new document lands in, when browsing one. */
  readonly parentName?: string
  /** Close the dialog. */
  readonly onCancel: () => void
  /** Submit one document. */
  readonly onSubmit: (input: CreateDocInput) => void
}

/**
 * Render the create form.
 * @param props - composer state, localized copy, location, and callbacks.
 * @returns the dialog.
 */
export function DocCreateDialog({ composer, t, parentName, onCancel, onSubmit }: DocCreateDialogProps): ReactNode {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const dialog = useRef<HTMLFormElement>(null)
  useDialogFocus(dialog, onCancel)
  const pending = composer.pending
  return (
    <div className={css.backdrop}>
      <form
        ref={dialog}
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('createTitle')}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({ title, ...(content === '' ? {} : { content }) })
        }}
      >
        <h3 className={css.title}>{t('createTitle')}</h3>
        <label className={css.field}>
          <span className={css.label}>{t('createName')}</span>
          <input
            className={css.input}
            value={title}
            aria-label={t('createName')}
            disabled={pending}
            onChange={(event) => { setTitle(event.target.value) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t('createContent')}</span>
          <MultilineField
            value={content}
            onChange={setContent}
            label={t('createContent')}
            disabled={pending}
            rows={6}
          />
        </label>
        <p className={css.location}>
          {t('createLocationLine', { name: parentName ?? t('createRoot') })}
        </p>
        {composer.errorCode === undefined
          ? null
          : (
            <p className={css.error} role="alert">
              {composer.errorCode === 'invalid-input' ? t('createTitleRequired') : t('createFailed')}
            </p>
          )}
        <div className={css.actions}>
          <button type="submit" className={css.primary} disabled={pending}>
            {pending ? t('creating') : t('createSubmit')}
          </button>
          <button type="button" className={css.button} disabled={pending} onClick={onCancel}>
            {t('createCancel')}
          </button>
        </div>
      </form>
    </div>
  )
}
