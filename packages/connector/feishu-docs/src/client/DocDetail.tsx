/** The document drawer: metadata, outline, body preview, links, rename, and block editing. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DocsActions, DocSelectionState } from './controller.ts'
import { useDialogFocus } from './dialog.ts'
import { BODY_PREVIEW_LIMIT, formatInstant, titleText, typeLabel, type Translate } from './format.ts'
import { MarkdownBody } from './MarkdownBody.tsx'
import { MultilineField } from './MultilineField.tsx'
import { parseOutline } from './markdown.ts'
import css from './DocDetail.module.css'

/** Props the panel hands the drawer. */
export interface DocDetailProps {
  /** The open drawer's state. */
  readonly selection: DocSelectionState
  /** Localized copy. */
  readonly t: Translate
  /** Drawer and write actions. */
  readonly actions: DocsActions
  /** True when the type supports block editing. */
  readonly editable: boolean
}

/**
 * Render one document's drawer.
 * @param props - selection, localized copy, actions, and the type's editability.
 * @returns the drawer.
 */
export function DocDetail({ selection, t, actions, editable }: DocDetailProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined)
  const dirty = isDirty(selection)
  const saving = selection.editor?.saving === true

  /* v8 ignore next -- the render below assigns the real handler before any event can reach the ref. */
  const closeRef = useRef<() => void>(() => {})
  closeRef.current = () => {
    if (saving) return
    if (dirty) {
      setConfirmClose(true)
      return
    }
    actions.closeDoc()
  }
  const requestClose = useCallback(() => { closeRef.current() }, [])
  useDialogFocus(panel, requestClose)
  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => { setCopied('idle') }, 2000)
    return () => { clearTimeout(timer) }
  }, [copied])

  const item = selection.item
  const url = item.url
  const headings = parseOutline(selection.outline ?? '')
  const copy = (): void => {
    /* v8 ignore next -- the copy button renders only for a row that carries a URL. */
    if (url === undefined) return
    if (navigator.clipboard === undefined) {
      setCopied('failed')
      return
    }
    void navigator.clipboard.writeText(url).then(
      () => { setCopied('copied') },
      () => { setCopied('failed') },
    )
  }
  const runRename = (title: string): void => {
    void actions.rename(title).then((renamed) => {
      if (renamed) setRenaming(false)
    })
  }
  return (
    <div className={css.backdrop} onClick={requestClose}>
      <div
        ref={panel}
        className={css.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={titleText(item.title)}
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className={css.header}>
          <h3 className={css.title}>{titleText(item.title) === '' ? item.token : titleText(item.title)}</h3>
          <button type="button" className={css.close} onClick={requestClose} aria-label={t('close')}>×</button>
        </header>
        <dl className={css.fields}>
          <Field label={t('type')} value={typeLabel(item.type, t)} />
          <Field label={t('owner')} value={item.ownerName} />
          <Field label={t('editor')} value={item.editorName} />
          <Field label={t('updatedAt')} value={formatInstant(item.updatedAt)} />
          <Field label={t('openedAt')} value={formatInstant(item.lastOpenedAt)} />
        </dl>
        <div className={css.actions}>
          {url === undefined
            ? null
            : <a className={css.action} href={url} target="_blank" rel="noreferrer">{t('openInFeishu')}</a>}
          {url === undefined
            ? null
            : (
              <button type="button" className={css.action} onClick={copy}>
                {copied === 'copied' ? t('copied') : t('copyLink')}
              </button>
            )}
          {editable
            ? (
              <button
                type="button"
                className={css.action}
                disabled={saving}
                onClick={() => { if (selection.editing) actions.closeEdit(); else actions.startEdit() }}
              >
                {selection.editing ? t('finishEdit') : t('editContent')}
              </button>
            )
            : <span className={css.note}>{t('readOnlyType')}</span>}
          {editable
            ? (
              <button
                type="button"
                className={css.action}
                disabled={saving}
                onClick={() => {
                  setRenameValue(titleText(item.title))
                  setRenaming(true)
                }}
              >
                {t('rename')}
              </button>
            )
            : null}
        </div>
        {copied === 'failed' && url !== undefined
          ? <input className={css.linkFallback} readOnly value={url} aria-label={t('copyLink')} />
          : null}
        {selection.banner === undefined ? null : (
          <p className={selection.banner.kind === 'conflict' ? css.conflict : css.partial} role="status">
            {selection.banner.kind === 'conflict'
              ? t('conflict')
              : selection.banner.warnings.length === 0
                ? t('partialWarningBare')
                : t('partialWarning', { warnings: selection.banner.warnings.join('; ') })}
          </p>
        )}
        {selection.errorCode === undefined || selection.phase === 'error'
          ? null
          : <p className={css.error} role="alert">{t('detailFailed')}</p>}
        {renaming
          ? (
            <form
              className={css.rename}
              onSubmit={(event) => {
                event.preventDefault()
                runRename(renameValue)
              }}
            >
              <label className={css.renameLabel}>
                <span>{t('renameLabel')}</span>
                <input
                  className={css.renameInput}
                  value={renameValue}
                  aria-label={t('renameLabel')}
                  disabled={selection.renameState?.pending === true}
                  onChange={(event) => { setRenameValue(event.target.value) }}
                />
              </label>
              <div className={css.formActions}>
                <button type="submit" className={css.action} disabled={selection.renameState?.pending === true}>
                  {t('renameSubmit')}
                </button>
                <button type="button" className={css.action} onClick={() => { setRenaming(false) }}>
                  {t('cancel')}
                </button>
              </div>
              {selection.renameState?.errorCode === undefined
                ? null
                : (
                  <p className={css.error} role="alert">
                    {selection.renameState.errorCode === 'invalid-input' ? t('renameEmpty') : t('renameFailed')}
                  </p>
                )}
            </form>
          )
          : null}
        {selection.phase === 'loading' ? <p className={css.notice} role="status">{t('detailLoading')}</p> : null}
        {selection.phase === 'error' ? (
          <p className={css.error} role="alert">
            {t('detailFailed')}
            <button type="button" className={css.inlineAction} onClick={actions.retryDetail}>{t('retry')}</button>
          </p>
        ) : null}
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('detailOutline')}</h4>
          {selection.phase === 'ready' && headings.length === 0
            ? <p className={css.notice}>{t('outlineEmpty')}</p>
            : (
              <ol className={css.outline}>
                {headings.map((heading, index) => (
                  <li key={index} className={css[`outline${heading.level}`]}>{heading.text}</li>
                ))}
              </ol>
            )}
        </section>
        {selection.phase === 'ready'
          ? (
            <section className={css.section}>
              <div className={css.sectionHeader}>
                <h4 className={css.sectionTitle}>{t('viewBody')}</h4>
                <button
                  type="button"
                  className={css.inlineAction}
                  onClick={selection.full === undefined ? actions.viewFull : actions.hideFull}
                >
                  {selection.full === undefined ? t('viewBody') : t('hideBody')}
                </button>
              </div>
              {selection.fullPhase === 'loading' ? <p className={css.notice} role="status">{t('detailLoading')}</p> : null}
              {selection.fullPhase === 'error' ? (
                <p className={css.error} role="alert">
                  {t('bodyFailed')}
                  <button type="button" className={css.inlineAction} onClick={actions.viewFull}>{t('retry')}</button>
                </p>
              ) : null}
              {selection.full === undefined
                ? null
                : <MarkdownBody text={selection.full} emptyLabel={t('bodyEmpty')} />}
              {selection.truncated === true
                ? <p className={css.notice}>{t('truncated', { count: BODY_PREVIEW_LIMIT })}</p>
                : null}
            </section>
          )
          : null}
        {selection.editing && editable ? (
          <section className={css.section}>
            <h4 className={css.sectionTitle}>{t('editContent')}</h4>
            {selection.blocksPhase === 'loading' ? <p className={css.notice} role="status">{t('editingLoading')}</p> : null}
            {selection.blocksPhase === 'error' ? (
              <p className={css.error} role="alert">
                {t('editingFailed')}
                <button type="button" className={css.inlineAction} onClick={actions.startEdit}>{t('retry')}</button>
              </p>
            ) : null}
            {selection.blocks !== undefined && selection.blocks.length === 0
              ? <p className={css.notice}>{t('blockEmpty')}</p>
              : null}
            {selection.blocks === undefined || selection.blocks.length === 0
              ? null
              : (
                <ul className={css.blocks}>
                  {selection.blocks.map(block => (
                    <li key={block.blockId} className={css.block}>
                      <span className={css.blockTag}>{block.tag}</span>
                      <span className={css.blockText}>{block.text === '' ? t('emptyBlock') : block.text}</span>
                      {block.editable
                        ? (
                          <span className={css.blockActions}>
                            <button
                              type="button"
                              className={css.inlineAction}
                              disabled={saving}
                              onClick={() => { actions.editBlock(block.blockId) }}
                            >
                              {t('editBlock')}
                            </button>
                            <button
                              type="button"
                              className={confirmDelete === block.blockId ? css.danger : css.inlineAction}
                              disabled={saving}
                              onClick={() => {
                                if (confirmDelete === block.blockId) {
                                  setConfirmDelete(undefined)
                                  actions.deleteBlock(block.blockId)
                                  return
                                }
                                setConfirmDelete(block.blockId)
                              }}
                            >
                              {confirmDelete === block.blockId ? t('confirmDeleteBlock') : t('deleteBlock')}
                            </button>
                          </span>
                        )
                        : <span className={css.note}>{t('resourceBlock')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            {selection.blocksPhase === 'ready' && selection.editor === undefined
              ? (
                <button type="button" className={css.action} onClick={actions.startAppend}>
                  {t('appendTitle')}
                </button>
              )
              : null}
            {selection.editor === undefined
              ? null
              : (
                <div className={css.editor}>
                  <MultilineField
                    value={selection.editor.text}
                    onChange={actions.updateDraft}
                    label={selection.editor.mode === 'append' ? t('appendTitle') : t('editBlock')}
                    {...(selection.editor.mode === 'append' ? { placeholder: t('appendPlaceholder') } : {})}
                    disabled={selection.editor.saving}
                  />
                  {selection.editor.errorCode === undefined
                    ? null
                    : (
                      <p className={css.error} role="alert">
                        {selection.editor.errorCode === 'conflict'
                          ? t('conflict')
                          : selection.editor.errorCode === 'invalid-input'
                            ? t('contentTooLong')
                            : t('saveFailed')}
                      </p>
                    )}
                  <div className={css.formActions}>
                    <button
                      type="button"
                      className={css.action}
                      disabled={selection.editor.saving}
                      onClick={actions.saveDraft}
                    >
                      {selection.editor.saving
                        ? t('saving')
                        : selection.editor.mode === 'append' ? t('appendSubmit') : t('save')}
                    </button>
                    <button
                      type="button"
                      className={css.action}
                      disabled={selection.editor.saving}
                      onClick={() => {
                        if (dirty) {
                          setConfirmDiscard(true)
                          return
                        }
                        actions.cancelDraft()
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              )}
          </section>
        ) : null}
        {confirmClose || confirmDiscard ? (
          <div className={css.confirm} role="alertdialog" aria-label={t('discardTitle')}>
            <p className={css.confirmText}>{t('discardTitle')}</p>
            <div className={css.formActions}>
              <button
                type="button"
                className={css.danger}
                onClick={() => {
                  setConfirmClose(false)
                  setConfirmDiscard(false)
                  if (confirmClose) actions.closeDoc()
                  else actions.cancelDraft()
                }}
              >
                {t('discardConfirm')}
              </button>
              <button
                type="button"
                className={css.action}
                onClick={() => {
                  setConfirmClose(false)
                  setConfirmDiscard(false)
                }}
              >
                {t('discardCancel')}
              </button>
            </div>
          </div>
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
 * Test whether the draft differs from what was loaded.
 * @param selection - the open drawer.
 * @returns true when leaving now would lose an edit.
 */
function isDirty(selection: DocSelectionState): boolean {
  const editor = selection.editor
  if (editor === undefined) return false
  if (editor.mode === 'append') return editor.text.trim() !== ''
  const block = selection.blocks?.find(candidate => candidate.blockId === editor.blockId)
  return block === undefined ? editor.text.trim() !== '' : block.text !== editor.text
}
