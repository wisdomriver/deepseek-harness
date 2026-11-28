// @vitest-environment jsdom
// Panel rendering: the five states, grouped rows, the view switch, search, row completion,
// the injected-face frame, the open drawer, and the open create dialog.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TaskPanel, TaskPanelView, type TaskPanelProps, type TaskPanelViewProps } from '../src/client/TaskPanel.tsx'
import type { TaskActions, TaskViewState } from '../src/client/controller.ts'
import { formatDue, formatTimestamp } from '../src/client/format.ts'
import { groupTasks } from '../src/client/groups.ts'
import { en } from '../src/client/locales.ts'
import type { TaskSummary } from '../src/types.ts'
import css from '../src/client/TaskPanel.module.css'
import { fixedHook, standardSeats } from './panel-seats.client.ts'

afterEach(cleanup)

/** English copy addressed by every dictionary key a panel entry may ask for. */
const COPY: Readonly<Record<string, string>> = en

/**
 * Localized copy resolved from the English dictionary.
 * @param key - dictionary key the panel asks for; shared-vocabulary keys fall back to the key.
 * @param params - template parameters.
 * @returns the resolved copy.
 */
function t(key: string, params?: Record<string, unknown>): string {
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    COPY[key] ?? key,
  )
}

/** Actions every render receives; each test asserts the ones it uses. */
function actions(): TaskActions {
  return {
    refresh: vi.fn(),
    setView: vi.fn(),
    search: vi.fn(),
    openTask: vi.fn(),
    closeTask: vi.fn(),
    retryDetail: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    openCreate: vi.fn(),
    closeCreate: vi.fn(),
    submitCreate: vi.fn(),
  }
}

/** One row due at a fixed local day. */
function task(taskId: string, summary: string, dueAt?: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    taskId,
    summary,
    status: 'todo',
    assignees: ['ou_a'],
    followers: [],
    ...(dueAt === undefined ? {} : { dueAt }),
    ...overrides,
  }
}

/**
 * Render the panel over one snapshot.
 * @param state - snapshot fields this test sets.
 * @param options - whether Plugins navigation is available, and the actions to assert.
 * @returns the render result and the navigation callback.
 */
function renderPanel(
  state: Partial<TaskViewState>,
  options: { readonly navigation?: boolean; readonly actions?: TaskActions } = {},
) {
  const store = createSnapshotStore<TaskViewState>({
    phase: 'ready',
    view: 'pending',
    query: '',
    tasks: [],
    missingScopes: [],
    marks: {},
    ...state,
    groups: state.groups ?? groupTasks(state.tasks ?? []),
  })
  const connectFeishu = vi.fn()
  const taskActions = options.actions ?? actions()
  const props = {
    state: store.getSnapshot(),
    canNavigate: options.navigation ?? false,
    t,
    actions: taskActions,
    navigation: { connectFeishu },
  } satisfies TaskPanelViewProps
  const result = render(<TaskPanelView {...props} />)
  return { ...result, actions: taskActions, connectFeishu }
}

describe('TaskPanel states', () => {
  it('shows the loading notice', () => {
    renderPanel({ phase: 'loading' })
    expect(screen.getByRole('status').textContent).toBe(en.loading)
  })

  it('shows the missing-CLI notice and retries', () => {
    const rendered = renderPanel({ phase: 'no-cli', errorCode: 'cli-missing' })
    expect(screen.getByRole('status').textContent).toContain(en.noCli)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(rendered.actions.refresh).toHaveBeenCalledTimes(1)
  })

  it('explains a signed-out account and offers no navigation without the Plugins page', () => {
    renderPanel({ phase: 'disconnected', errorCode: 'not-connected' })
    expect(screen.getByText(en.disconnected)).toBeTruthy()
    expect(screen.getByText(en.connectHint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.connectFeishu })).toBeNull()
  })

  it('opens the Feishu bundle page when Plugins navigation is available', () => {
    const rendered = renderPanel({ phase: 'disconnected', errorCode: 'not-connected' }, { navigation: true })
    fireEvent.click(screen.getByRole('button', { name: en.connectFeishu }))
    expect(rendered.connectFeishu).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(en.connectHint)).toBeNull()
  })

  it('names the missing scopes on the permission state', () => {
    renderPanel({ phase: 'permission', errorCode: 'permission-denied', missingScopes: ['task:task:read'] }, { navigation: true })
    expect(screen.getByText(en.permissionDenied)).toBeTruthy()
    expect(screen.getByText(en.missingScopes.replace('{scopes}', 'task:task:read'))).toBeTruthy()
    expect(screen.getByRole('button', { name: en.connectFeishu })).toBeTruthy()
  })

  it('shows the failure notice for a failed read', () => {
    renderPanel({ phase: 'error', errorCode: 'timeout' })
    expect(screen.getByRole('alert').textContent).toContain(en.timeoutError)
  })
})

describe('TaskPanel list', () => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).toISOString()
  const overdue = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 0, 0).toISOString()

  it('renders the groups, their rows, and their counts', () => {
    const tasks = [
      task('a', 'Late report', overdue),
      task('b', 'Ship it', today),
      task('c', 'Plan', today),
    ]
    renderPanel({ tasks, groups: groupTasks(tasks) })
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map(heading => heading.textContent)).toEqual([`${en.groupOverdue}1`, `${en.groupToday}2`])
    expect(screen.getByText('Late report')).toBeTruthy()
    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.getByText('3 tasks')).toBeTruthy()
  })

  it('reports the empty copy for the shown view and search', () => {
    renderPanel({})
    expect(screen.getByRole('status').textContent).toBe(en.empty)
    cleanup()
    renderPanel({ view: 'done' })
    expect(screen.getByRole('status').textContent).toBe(en.emptyDone)
    cleanup()
    renderPanel({ view: 'assigned' })
    expect(screen.getByRole('status').textContent).toBe(en.emptyAssigned)
    cleanup()
    renderPanel({ query: 'dsh', view: 'pending' })
    expect(screen.getByRole('status').textContent).toBe(en.emptySearch)
  })

  it('forwards typed search text to the controller', () => {
    const rendered = renderPanel({})
    fireEvent.change(screen.getByLabelText(en.searchLabel), { target: { value: 'dsh' } })
    expect(rendered.actions.search).toHaveBeenCalledWith('dsh')
  })

  it('switches the view and marks the active one', () => {
    const rendered = renderPanel({})
    expect(screen.getByRole('button', { name: en.viewPending }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en.viewDone }))
    expect(rendered.actions.setView).toHaveBeenCalledWith('done')
  })

  it('completes an open row and reopens a completed one', () => {
    const rendered = renderPanel({
      tasks: [task('open', 'Ship it'), task('closed', 'Done thing', undefined, { status: 'done' })],
    })
    fireEvent.click(screen.getByRole('button', { name: en.completeAria.replace('{summary}', 'Ship it') }))
    expect(rendered.actions.complete).toHaveBeenCalledWith('open')
    fireEvent.click(screen.getByRole('button', { name: en.reopenAria.replace('{summary}', 'Done thing') }))
    expect(rendered.actions.reopen).toHaveBeenCalledWith('closed')
  })

  it('opens a task row and the new-task dialog', () => {
    const rendered = renderPanel({ tasks: [task('a', 'Ship it')] })
    fireEvent.click(screen.getByRole('button', { name: 'Ship it' }))
    expect(rendered.actions.openTask).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: en.newTask }))
    expect(rendered.actions.openCreate).toHaveBeenCalledTimes(1)
  })

  it('names an unconfigured Feishu app apart from a signed-out account', () => {
    renderPanel({ phase: 'disconnected', errorCode: 'not-configured' })
    expect(screen.getByText(en.notConfigured)).toBeTruthy()
    expect(screen.queryByText(en.disconnected)).toBeNull()
  })

  it('reports a failed write above the list and keeps the rows', () => {
    renderPanel({ tasks: [task('a', 'Ship it')], actionErrorCode: 'timeout' })
    expect(screen.getByRole('alert').textContent).toBe(en.actionFailed)
    expect(screen.getByText('Ship it')).toBeTruthy()
  })

  it('emphasizes overdue, today, and later due dates', () => {
    const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 9, 0, 0).toISOString()
    renderPanel({
      tasks: [
        task('late', 'Late report', overdue),
        task('today', 'Ship it', today),
        task('week', 'Plan', week),
      ],
    })
    expect(screen.getByText(formatDue(overdue, false)).className).toBe(css.dueOverdue)
    expect(screen.getByText(formatDue(today, false)).className).toBe(css.dueToday)
    expect(screen.getByText(formatDue(week, false)).className).toBe(css.due)
  })

  it('shows the optimistic completion and marks the just-created row', () => {
    const updatedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 30, 0).toISOString()
    renderPanel({
      tasks: [task('a', 'Ship it', undefined, { updatedAt })],
      marks: { a: { taskId: 'a', status: 'done', pending: true } },
      highlightTaskId: 'a',
    })
    const reopen = screen.getByRole('button', { name: en.reopenAria.replace('{summary}', 'Ship it') })
    expect(reopen.getAttribute('aria-pressed')).toBe('true')
    expect(reopen.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(formatTimestamp(updatedAt))).toBeTruthy()
    expect(screen.getByRole('listitem').className).toBe(css.rowHighlighted)
  })

  it('names a task Feishu returned without a title', () => {
    renderPanel({ tasks: [task('a', '')] })
    expect(screen.getByText(en.untitled)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.completeAria.replace('{summary}', en.untitled) })).toBeTruthy()
  })

  it('opens the detail drawer and the create dialog from the snapshot', () => {
    renderPanel({
      tasks: [task('a', 'Ship it')],
      selection: { taskId: 'a', phase: 'loading' },
      composer: { open: true, pending: false },
    })
    expect(screen.getByRole('dialog', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: en.createTitle })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(en.loading)
  })
})

describe('TaskPanel frame', () => {
  /**
   * Render the registered panel component over one snapshot.
   * @param state - snapshot fields this test sets.
   * @param canNavigate - whether the Plugins page can be opened from the panel.
   * @returns the render result.
   */
  function renderFrame(state: Partial<TaskViewState>, canNavigate = false) {
    const store = createSnapshotStore<TaskViewState>({
      phase: 'ready',
      view: 'pending',
      query: '',
      tasks: [],
      missingScopes: [],
      marks: {},
      ...state,
      groups: state.groups ?? groupTasks(state.tasks ?? []),
    })
    const connectFeishu = vi.fn()
    const props: TaskPanelProps = {
      ...standardSeats,
      useTask: fixedHook(store.getSnapshot()),
      usePluginNavigation: fixedHook(canNavigate),
      t,
      actions: actions(),
      navigation: { connectFeishu },
    }
    return { ...render(<TaskPanel {...props} />), connectFeishu }
  }

  it('binds the injected snapshot to the panel body', () => {
    renderFrame({ tasks: [task('a', 'Ship it')] })
    expect(screen.getByRole('region', { name: en.title })).toBeTruthy()
    expect(screen.getByText('1 tasks')).toBeTruthy()
    expect(screen.getByText('Ship it')).toBeTruthy()
  })

  it('offers the connect button only while the injected hook reports Plugins navigation', () => {
    const rendered = renderFrame({ phase: 'disconnected', errorCode: 'not-connected' }, true)
    fireEvent.click(screen.getByRole('button', { name: en.connectFeishu }))
    expect(rendered.connectFeishu).toHaveBeenCalledTimes(1)
  })
})
