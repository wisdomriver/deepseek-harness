// @vitest-environment jsdom
// Detail drawer: fields, Feishu link, description fold, completion, Escape, and focus handling.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/TaskDetail.tsx'
import { en, type TaskLocaleKey } from '../src/client/locales.ts'
import type { TaskDetail as TaskDetailData } from '../src/types.ts'

afterEach(cleanup)

/** Localized copy resolved from the English dictionary. */
const t = (key: TaskLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

const DETAIL: TaskDetailData = {
  taskId: 't1',
  summary: 'Ship it',
  status: 'todo',
  dueAt: new Date(2026, 10, 10, 9, 0, 0).toISOString(),
  dueAllDay: true,
  creator: 'ou_creator_long_id',
  assignees: ['ou_assignee_long_id'],
  followers: [],
  tasklists: ['tl_1'],
  subtaskCount: 2,
  description: 'Short note',
  updatedAt: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
  appLink: 'https://applink.feishu.cn/client/todo/detail?guid=t1',
}

/** Props every render receives. */
function props(selection: Parameters<typeof TaskDetail>[0]['selection'], mark?: Parameters<typeof TaskDetail>[0]['mark']) {
  return {
    selection,
    mark,
    t,
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onComplete: vi.fn(),
    onReopen: vi.fn(),
  }
}

describe('TaskDetail', () => {
  it('renders the fields, the all-day tag, and the Feishu link', () => {
    render(<TaskDetail {...props({ taskId: 't1', phase: 'ready', detail: DETAIL })} />)
    expect(screen.getByRole('heading', { name: 'Ship it' })).toBeTruthy()
    expect(screen.getByText(en.allDay)).toBeTruthy()
    expect(screen.getByText(en.statusTodo)).toBeTruthy()
    expect(screen.getByText('ou_crea…')).toBeTruthy()
    expect(screen.getByText('ou_assi…')).toBeTruthy()
    expect(screen.getByText('tl_1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.openInFeishu }).getAttribute('href')).toBe(DETAIL.appLink)
  })

  it('closes on Escape and on the close button', () => {
    const first = props({ taskId: 't1', phase: 'ready', detail: DETAIL })
    const { unmount } = render(<TaskDetail {...first} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first.onClose).toHaveBeenCalledTimes(1)
    unmount()
    const second = props({ taskId: 't1', phase: 'ready', detail: DETAIL })
    render(<TaskDetail {...second} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.close })[0]!)
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })

  it('focuses the drawer and restores the trigger on unmount', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const { unmount } = render(<TaskDetail {...props({ taskId: 't1', phase: 'ready', detail: DETAIL })} />)
    expect(document.activeElement?.getAttribute('aria-label')).toBe(en.close)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('completes an open task and reopens a completed one', () => {
    const open = props({ taskId: 't1', phase: 'ready', detail: DETAIL })
    const { unmount } = render(<TaskDetail {...open} />)
    fireEvent.click(screen.getByRole('button', { name: en.complete }))
    expect(open.onComplete).toHaveBeenCalledWith('t1')
    unmount()
    const closed = props({ taskId: 't1', phase: 'ready', detail: { ...DETAIL, status: 'done' } })
    render(<TaskDetail {...closed} />)
    fireEvent.click(screen.getByRole('button', { name: en.reopen }))
    expect(closed.onReopen).toHaveBeenCalledWith('t1')
  })

  it('shows the optimistic status while a write runs', () => {
    render(
      <TaskDetail
        {...props({ taskId: 't1', phase: 'ready', detail: DETAIL }, { taskId: 't1', status: 'done', pending: true })}
      />,
    )
    expect(screen.getByText(en.statusDone)).toBeTruthy()
    const reopen = screen.getByRole('button', { name: en.reopen })
    expect(reopen.hasAttribute('disabled')).toBe(true)
  })

  it('folds a long description and expands it', () => {
    const long = 'x'.repeat(2001)
    render(<TaskDetail {...props({ taskId: 't1', phase: 'ready', detail: { ...DETAIL, description: long } })} />)
    expect(screen.queryByText(long)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.showMore }))
    expect(screen.getByText(long)).toBeTruthy()
  })

  it('offers a retry after a failed read', () => {
    const failed = props({ taskId: 't1', phase: 'error', errorCode: 'not-found' })
    render(<TaskDetail {...failed} />)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(failed.onRetry).toHaveBeenCalledTimes(1)
  })
})
