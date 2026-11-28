/** The tasks panel: header, view switch, search, grouped rows, the drawer, and the create dialog. */

import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TaskSummary, TaskView } from '../types.ts'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import type { TaskActions, TaskMark, TaskViewState } from './controller.ts'
import { GROUP_LABELS, dueBucket } from './groups.ts'
import { errorText, formatDue, formatTimestamp, type Translate } from './format.ts'
import css from './TaskPanel.module.css'

/** Registration-side face the panel's slot entry injects. */
export interface TaskFace {
  /** Panel snapshot bound as `useTask`, and whether Plugins navigation is available as `usePluginNavigation`. */
  readonly hooks: {
    /** Panel snapshot. */
    readonly task: SnapshotStore<TaskViewState>
    /** True while the Plugins page can be opened from this panel. */
    readonly pluginNavigation: HostObservable<boolean>
  }
  /** List, detail, completion, and create actions. */
  readonly actions: TaskActions
  /** Navigation this panel offers while the Plugins page is loaded. */
  readonly navigation: TaskNavigation
}

/** Cross-panel navigation the panel's connect prompt uses. */
export interface TaskNavigation {
  /** Open the Feishu bundle's page on the Plugins page, where the account is connected. */
  readonly connectFeishu: () => void
}

/** Full props the main slot renderer assembles. */
export type TaskPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'feishuTask'>
  & InjectFace<TaskFace>

/**
 * Render the tasks panel for the shown view.
 * @param props - framework shares, localized copy, and the injected task face.
 * @returns the panel.
 */
export function TaskPanel(props: TaskPanelProps): ReactNode {
  const state = props.useTask(snapshot => snapshot)
  const canNavigate = props.usePluginNavigation(value => value)
  return (
    <TaskPanelView
      state={state}
      canNavigate={canNavigate}
      t={props.t}
      actions={props.actions}
      navigation={props.navigation}
    />
  )
}

/** Presentation props of the panel body, so tests render it without framework seats. */
export interface TaskPanelViewProps {
  /** Panel snapshot. */
  readonly state: TaskViewState
  /** True while the Plugins page can be opened from this panel. */
  readonly canNavigate: boolean
  /** Localized copy. */
  readonly t: Translate
  /** List, detail, completion, and create actions. */
  readonly actions: TaskActions
  /** Navigation this panel offers while the Plugins page is loaded. */
  readonly navigation: TaskNavigation
}

/**
 * Render the panel body for one snapshot.
 * @param props - snapshot, navigation availability, localized copy, and the face's actions.
 * @returns the panel body.
 */
export function TaskPanelView({ state, canNavigate, t, actions, navigation }: TaskPanelViewProps): ReactNode {
  return (
    <section className={css.panel} aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        {state.phase === 'ready' ? <span className={css.count}>{t('taskCount', { count: state.tasks.length })}</span> : null}
        <div className={css.controls}>
          <button type="button" onClick={actions.refresh}>{t('refresh')}</button>
          <button type="button" className={css.newTask} onClick={actions.openCreate}>{t('newTask')}</button>
        </div>
      </header>
      <div className={css.views} role="group" aria-label={t('viewsLabel')}>
        <ViewButton view="pending" current={state.view} label={t('viewPending')} onSelect={actions.setView} />
        <ViewButton view="assigned" current={state.view} label={t('viewAssigned')} onSelect={actions.setView} />
        <ViewButton view="done" current={state.view} label={t('viewDone')} onSelect={actions.setView} />
      </div>
      <label className={css.search}>
        <span className={css.searchLabel}>{t('searchLabel')}</span>
        <input
          className={css.searchInput}
          type="search"
          value={state.query}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => { actions.search(event.target.value) }}
        />
      </label>
      {state.phase === 'loading' ? <p className={css.notice} role="status">{t('loading')}</p> : null}
      {state.phase === 'no-cli' || state.phase === 'disconnected' || state.phase === 'permission' || state.phase === 'error'
        ? (
          <div className={css.noticeCard} role={state.phase === 'error' ? 'alert' : 'status'}>
            <p className={css.noticeText}>{phaseText(state, t)}</p>
            {state.phase === 'permission' && state.missingScopes.length > 0
              ? <p className={css.scopes}>{t('missingScopes', { scopes: state.missingScopes.join(', ') })}</p>
              : null}
            {state.phase === 'disconnected' || state.phase === 'permission'
              ? (canNavigate
                ? <button type="button" className={css.connect} onClick={navigation.connectFeishu}>{t('connectFeishu')}</button>
                : <p className={css.hint}>{t('connectHint')}</p>)
              : null}
            <button type="button" className={css.retry} onClick={actions.refresh}>{t('retry')}</button>
          </div>
        )
        : null}
      {state.actionErrorCode === undefined
        ? null
        : <p className={css.actionError} role="alert">{t('actionFailed')}</p>}
      {state.phase === 'ready' ? (
        state.tasks.length === 0
          ? <p className={css.empty} role="status">{emptyText(state, t)}</p>
          : (
            <div className={css.groups}>
              {state.groups.map(group => (
                <section key={group.key} className={css.group}>
                  <h3 className={css.groupTitle}>
                    <span className={group.key === 'overdue' ? css.overdue : undefined}>{t(GROUP_LABELS[group.key])}</span>
                    <span className={css.groupCount}>{group.tasks.length}</span>
                  </h3>
                  <ul className={css.rows}>
                    {group.tasks.map(task => (
                      <TaskRow
                        key={task.taskId}
                        task={task}
                        mark={state.marks[task.taskId]}
                        highlighted={state.highlightTaskId === task.taskId}
                        t={t}
                        onOpen={actions.openTask}
                        onComplete={actions.complete}
                        onReopen={actions.reopen}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
      ) : null}
      {state.selection === undefined
        ? null
        : (
          <TaskDetail
            selection={state.selection}
            mark={state.marks[state.selection.taskId]}
            t={t}
            onClose={actions.closeTask}
            onRetry={actions.retryDetail}
            onComplete={actions.complete}
            onReopen={actions.reopen}
          />
        )}
      {state.composer === undefined
        ? null
        : (
          <CreateTaskDialog
            composer={state.composer}
            t={t}
            onCancel={actions.closeCreate}
            onSubmit={actions.submitCreate}
          />
        )}
    </section>
  )
}

/** One view-switch button. */
function ViewButton({ view, current, label, onSelect }: {
  readonly view: TaskView
  readonly current: TaskView
  readonly label: string
  readonly onSelect: (view: TaskView) => void
}): ReactNode {
  return (
    <button
      type="button"
      className={view === current ? css.viewActive : css.view}
      aria-pressed={view === current}
      onClick={() => { onSelect(view) }}
    >
      {label}
    </button>
  )
}

/** One task row. */
function TaskRow({ task, mark, highlighted, t, onOpen, onComplete, onReopen }: {
  readonly task: TaskSummary
  readonly mark: TaskMark | undefined
  readonly highlighted: boolean
  readonly t: Translate
  readonly onOpen: (taskId: string) => void
  readonly onComplete: (taskId: string) => void
  readonly onReopen: (taskId: string) => void
}): ReactNode {
  const status = mark?.status ?? task.status
  const done = status === 'done'
  const pending = mark?.pending === true
  const summary = task.summary === '' ? t('untitled') : task.summary
  const due = task.dueAt === undefined ? undefined : formatDue(task.dueAt, false)
  const bucket = dueBucket(task.dueAt)
  return (
    <li className={highlighted ? css.rowHighlighted : css.row}>
      <button
        type="button"
        className={done ? css.circleDone : css.circle}
        aria-label={done ? t('reopenAria', { summary }) : t('completeAria', { summary })}
        aria-pressed={done}
        disabled={pending}
        onClick={() => {
          if (done) onReopen(task.taskId)
          else onComplete(task.taskId)
        }}
      />
      <button type="button" className={css.rowTitle} onClick={() => { onOpen(task.taskId) }}>
        <span className={done ? css.summaryDone : css.summary}>{summary}</span>
        {due === undefined
          ? null
          : <span className={bucket === 'overdue' ? css.dueOverdue : bucket === 'today' ? css.dueToday : css.due}>{due}</span>}
        {task.updatedAt === undefined ? null : <span className={css.updated}>{formatTimestamp(task.updatedAt)}</span>}
      </button>
    </li>
  )
}

/**
 * Localized copy for a panel that cannot show a list.
 * @param state - the panel's snapshot.
 * @param t - localized copy.
 * @returns the message to show.
 */
function phaseText(state: TaskViewState, t: Translate): string {
  if (state.phase === 'no-cli') return t('noCli')
  if (state.phase === 'disconnected') return state.errorCode === 'not-configured' ? t('notConfigured') : t('disconnected')
  if (state.phase === 'permission') return t('permissionDenied')
  return errorText(state.errorCode, t)
}

/**
 * Localized copy for an empty ready list.
 * @param state - the panel's snapshot.
 * @param t - localized copy.
 * @returns the message to show.
 */
function emptyText(state: TaskViewState, t: Translate): string {
  if (state.query.trim() !== '') return t('emptySearch')
  if (state.view === 'assigned') return t('emptyAssigned')
  if (state.view === 'done') return t('emptyDone')
  return t('empty')
}
