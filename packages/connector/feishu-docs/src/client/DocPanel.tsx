/** The docs panel: title row, view segments, list, state cards, drawer, and create form. */

import { useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocDays, DocSort, DocView } from '../types.ts'
import type { DocsActions, DocsViewState, FileOrder } from './controller.ts'
import { DocCreateDialog } from './DocCreateDialog.tsx'
import { DocDetail } from './DocDetail.tsx'
import { DocList } from './DocList.tsx'
import { editableItem, queryLength, type Translate } from './format.ts'
import css from './DocPanel.module.css'

/** Registration-side face the panel's slot entry injects. */
export interface DocsFace {
  /** Panel snapshot, bound by the renderer as `useDocs`. */
  readonly hooks: { readonly docs: SnapshotStore<DocsViewState> }
  /** List, drawer, and write actions. */
  readonly actions: DocsActions
}

/** Full props the main slot renderer assembles. */
export type DocPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'feishuDocs'>
  & InjectFace<DocsFace>

/** View segments in display order. */
const VIEWS: readonly DocView[] = ['recent', 'search', 'files']

/**
 * Render the docs panel for the current view.
 * @param props - framework shares, localized copy, and the injected docs face.
 * @returns the panel.
 */
export function DocPanel(props: DocPanelProps): ReactNode {
  const state = props.useDocs(snapshot => snapshot)
  return <DocPanelView state={state} t={props.t} actions={props.actions} />
}

/** Props the presentational panel takes. */
export interface DocPanelViewProps {
  /** Panel snapshot. */
  readonly state: DocsViewState
  /** Localized copy. */
  readonly t: Translate
  /** List, drawer, and write actions. */
  readonly actions: DocsActions
}

/**
 * Render the panel from a plain snapshot.
 * @param props - snapshot, localized copy, and actions.
 * @returns the panel.
 */
export function DocPanelView({ state, t, actions }: DocPanelViewProps): ReactNode {
  const [searchText, setSearchText] = useState(state.query)
  const editing = state.selection?.editing === true
  const unavailable = state.phase === 'no-cli'
    || state.phase === 'disconnected'
    || state.phase === 'permission'
    || state.phase === 'error'
  return (
    <section className={css.panel} aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <button
          type="button"
          className={css.button}
          disabled={editing || state.phase === 'loading'}
          onClick={actions.refresh}
        >
          {t('refresh')}
        </button>
        <button type="button" className={css.primary} disabled={editing} onClick={actions.openCreate}>
          {t('newDocument')}
        </button>
      </header>
      <form
        className={css.search}
        onSubmit={(event) => {
          event.preventDefault()
          actions.search(searchText)
        }}
      >
        <input
          className={css.searchInput}
          type="search"
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={searchText}
          disabled={editing}
          onChange={(event) => { setSearchText(event.target.value) }}
        />
        <button type="submit" className={css.button} disabled={editing}>{t('search')}</button>
      </form>
      <nav className={css.segmented} aria-label={t('title')}>
        {VIEWS.map(view => (
          <button
            key={view}
            type="button"
            className={state.view === view ? css.segmentActive : css.segment}
            aria-pressed={state.view === view}
            disabled={editing}
            onClick={() => { actions.setView(view) }}
          >
            {t(view === 'recent' ? 'viewRecent' : view === 'search' ? 'viewSearch' : 'viewFiles')}
          </button>
        ))}
      </nav>
      {state.view === 'recent' ? (
        <div className={css.controls}>
          <label className={css.control}>
            <span className={css.controlLabel}>{t('daysLabel')}</span>
            <select
              value={state.days}
              disabled={editing}
              onChange={(event) => { actions.setDays(Number(event.target.value) as DocDays) }}
            >
              <option value={7}>{t('days7')}</option>
              <option value={30}>{t('days30')}</option>
              <option value={90}>{t('days90')}</option>
            </select>
          </label>
          <label className={css.control}>
            <span className={css.controlLabel}>{t('sortLabel')}</span>
            <select
              value={state.sort}
              disabled={editing}
              onChange={(event) => { actions.setSort(event.target.value as DocSort) }}
            >
              <option value="open">{t('sortOpen')}</option>
              <option value="edit">{t('sortEdit')}</option>
            </select>
          </label>
        </div>
      ) : null}
      {state.view === 'files' ? (
        <div className={css.controls}>
          <nav className={css.crumbs} aria-label={t('viewFiles')}>
            <button type="button" className={css.crumb} onClick={actions.goRoot} disabled={editing}>{t('root')}</button>
            {state.crumbs.map(crumb => (
              <span key={crumb.token} className={css.crumbText}> / {crumb.name}</span>
            ))}
          </nav>
          {state.crumbs.length === 0
            ? null
            : <button type="button" className={css.button} disabled={editing} onClick={actions.goBack}>{t('back')}</button>}
          <label className={css.control}>
            <span className={css.controlLabel}>{t('orderLabel')}</span>
            <select
              value={state.orderBy}
              disabled={editing}
              onChange={(event) => { actions.setOrderBy(event.target.value as FileOrder) }}
            >
              <option value="EditedTime">{t('sortEdit')}</option>
              <option value="CreatedTime">{t('createdTime')}</option>
            </select>
          </label>
        </div>
      ) : null}
      {state.view === 'search' ? (
        <label className={css.mine}>
          <input
            type="checkbox"
            checked={state.mine}
            disabled={editing}
            onChange={(event) => { actions.setMine(event.target.checked) }}
          />
          {t('filterMine')}
        </label>
      ) : null}
      {state.phase === 'loading' ? <p className={css.notice} role="status">{t('loading')}</p> : null}
      {state.phase === 'no-cli' ? (
        <StateCard title={t('noCli')} actionLabel={t('retry')} onAction={actions.refresh} />
      ) : null}
      {state.phase === 'disconnected' ? (
        <StateCard
          title={state.errorCode === 'not-configured' ? t('notConfigured') : t('notConnected')}
          actionLabel={t('retry')}
          onAction={actions.refresh}
        />
      ) : null}
      {state.phase === 'permission' ? (
        <StateCard
          title={t('permissionDenied')}
          {...(state.missingScopes.length === 0
            ? {}
            : { description: t('missingScopes', { scopes: state.missingScopes.join(', ') }) })}
          actionLabel={t('retry')}
          onAction={actions.refresh}
        />
      ) : null}
      {state.phase === 'error' ? (
        <StateCard title={t('error')} actionLabel={t('retry')} onAction={actions.refresh} />
      ) : null}
      {state.phase === 'empty' ? <p className={css.notice} role="status">{emptyText(state, t)}</p> : null}
      {state.phase === 'ready' ? <DocList items={state.items} t={t} onActivate={actions.openDoc} /> : null}
      {state.phase === 'ready' && state.hasMore ? (
        <button
          type="button"
          className={css.more}
          disabled={state.loadingMore}
          onClick={actions.loadMore}
        >
          {state.loadingMore ? t('loading') : t('loadMore')}
        </button>
      ) : null}
      {state.selection === undefined
        ? null
        : (
          <DocDetail
            selection={state.selection}
            t={t}
            actions={actions}
            editable={editableItem(state.selection.item)}
          />
        )}
      {state.composer === undefined
        ? null
        : (
          <DocCreateDialog
            composer={state.composer}
            t={t}
            {...(state.crumbs.length === 0 ? {} : { parentName: state.crumbs[state.crumbs.length - 1]?.name ?? '' })}
            onCancel={actions.closeCreate}
            onSubmit={actions.submitCreate}
          />
        )}
      {unavailable && state.missingScopes.length > 0 && state.phase !== 'permission'
        ? <p className={css.notice}>{t('missingScopes', { scopes: state.missingScopes.join(', ') })}</p>
        : null}
    </section>
  )
}

/** One state card with an optional description and action. */
function StateCard({ title, description, actionLabel, onAction }: {
  readonly title: string
  readonly description?: string
  readonly actionLabel: string
  readonly onAction: () => void
}): ReactNode {
  return (
    <div className={css.state} role="status">
      <p className={css.stateTitle}>{title}</p>
      {description === undefined ? null : <p className={css.stateText}>{description}</p>}
      <button type="button" className={css.button} onClick={onAction}>{actionLabel}</button>
    </div>
  )
}

/**
 * Pick the empty-state copy for the shown view.
 * @param state - panel snapshot.
 * @param t - localized copy.
 * @returns the message.
 */
function emptyText(state: DocsViewState, t: Translate): string {
  if (state.view === 'search') {
    if (state.query === '') return t('searchEmpty')
    if (queryLength(state.query) > 30) return t('searchTooLong')
    return `${t('emptySearch')} · ${t('emptySearchHint')}`
  }
  if (state.view === 'files') return t('emptyFiles')
  return t('emptyRecent')
}
