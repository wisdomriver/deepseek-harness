// @vitest-environment jsdom
// Panel rendering: the five states, grouped rows, the view switch, search, and row completion.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TaskPanelView, type TaskPanelViewProps } from '../src/client/TaskPanel.tsx'
import type { TaskActions, TaskViewState } from '../src/client/controller.ts'
import type { Translate } from '../src/client/format.ts'
import { groupTasks } from '../src/client/groups.ts'
import { en, type TaskLocaleKey } from '../src/client/locales.ts'
import type { TaskSummary } from '../src/types.ts'

afterEach(cleanup)

/** Localized copy resolved from the English dictionary. */
const t: Translate = (key: TaskLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )

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
})
