// Task service behavior over a recorded command runner: command assembly, normalization,
// ordering, caching, completion, reopening, and creation validation.

import { describe, expect, it } from 'vitest'
import { TASK_SCOPES, authStatus, authThen, fail, serviceOver, succeed } from './harness.ts'

/** One list row as `task +search` reports it. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guid: 't1',
    summary: 'Ship it',
    status: 'todo',
    due_at: '2026-11-10 08:00:00',
    created_at: '2026-11-01 09:00:00',
    updated_at: '2026-11-09 10:00:00',
    members: [
      { id: 'ou_assignee', role: 'assignee', type: 'user' },
      { id: 'ou_follower', role: 'follower', type: 'user' },
      { id: 'ou_other', role: 'follower', type: 'user' },
    ],
    url: 'https://applink.feishu.cn/client/todo/detail?guid=t1',
    ...overrides,
  }
}

describe('TaskService.list', () => {
  it('reads the incomplete list and normalizes one row', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [row()] })))
    const data = await service.list('pending')
    expect(calls.map(call => call.args)).toEqual([
      ['auth', 'status', '--json'],
      ['task', '+search', '--completed=false'],
    ])
    expect(data.view).toBe('pending')
    expect(data.tasks[0]).toMatchObject({
      taskId: 't1',
      summary: 'Ship it',
      status: 'todo',
      assignees: ['ou_assignee'],
      followers: ['ou_follower', 'ou_other'],
      appLink: 'https://applink.feishu.cn/client/todo/detail?guid=t1',
    })
    // `due_at` carries no zone; the Host reads it as the machine's local wall-clock time.
    expect(data.tasks[0]?.dueAt).toBe(new Date(2026, 10, 10, 8, 0, 0).toISOString())
    expect(data.tasks[0]?.updatedAt).toBe(new Date(2026, 10, 9, 10, 0, 0).toISOString())
  })

  it('forwards the search text as a query argument', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [] })))
    await service.list('pending', { query: '  dsh  ' })
    expect(calls[1]?.args).toEqual(['task', '+search', '--completed=false', '--query', 'dsh'])
  })

  it('filters the assigned view by the signed-in open id', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [] }), { openId: 'ou_me' }))
    await service.list('assigned')
    expect(calls[1]?.args).toEqual(['task', '+search', '--completed=false', '--assignee', 'ou_me'])
  })

  it('reports an account without an open id as not connected', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [] }), { openId: '' }))
    await expect(service.list('assigned')).rejects.toMatchObject({ code: 'not-connected' })
    expect(calls).toHaveLength(1)
  })

  it('reports a missing scope before running a search', async () => {
    const { service, calls } = serviceOver(() => authStatus({ scope: 'task:task:write' }))
    await expect(service.list('pending')).rejects.toMatchObject({ code: 'permission-denied' })
    expect(calls.map(call => call.args[0])).toEqual(['auth'])
  })

  it('orders completed tasks by newest completion and keeps the newest fifty', async () => {
    const items = Array.from({ length: 55 }, (_, index) => row({
      guid: `done_${index}`,
      status: 'done',
      completed_at: `2026-11-${String((index % 28) + 1).padStart(2, '0')} 09:00:00`,
      updated_at: `2026-11-${String((index % 28) + 1).padStart(2, '0')} 09:00:00`,
    }))
    const { service, calls } = serviceOver(authThen(succeed({ items })))
    const data = await service.list('done')
    expect(calls[1]?.args).toEqual(['task', '+search', '--completed=true'])
    expect(data.tasks).toHaveLength(50)
    expect(data.tasks[0]?.taskId).toBe('done_27')
    const first = data.tasks[0]?.completedAt ?? ''
    for (const task of data.tasks) expect(Date.parse(task.completedAt ?? '') <= Date.parse(first)).toBe(true)
  })

  it('serves a repeated list read from cache', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [] })))
    await service.list('pending')
    await service.list('pending')
    expect(calls.filter(call => call.args[1] === '+search')).toHaveLength(1)
  })

  it('shares one process between concurrent reads of one key', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ items: [] })))
    await Promise.all([service.list('pending'), service.list('pending')])
    expect(calls.filter(call => call.args[1] === '+search')).toHaveLength(1)
  })

  it('orders pending tasks by due date, undated last, then by latest update', async () => {
    const items = [
      row({ guid: 'undated-old', due_at: undefined, updated_at: '2026-11-01 09:00:00' }),
      row({ guid: 'later', due_at: '2026-11-20 09:00:00' }),
      row({ guid: 'undated-new', due_at: undefined, updated_at: '2026-11-02 09:00:00' }),
      row({ guid: 'tie-old', due_at: '2026-11-11 09:00:00', updated_at: '2026-11-01 09:00:00' }),
      row({ guid: 'tie-new', due_at: '2026-11-11 09:00:00', updated_at: '2026-11-05 09:00:00' }),
    ]
    const { service } = serviceOver(authThen(succeed({ items })))
    const data = await service.list('pending')
    expect(data.tasks.map(task => task.taskId)).toEqual(['tie-new', 'tie-old', 'later', 'undated-new', 'undated-old'])
  })

  it('reads a list answer without a task array as an empty list', async () => {
    const { service } = serviceOver(authThen(succeed([])))
    await expect(service.list('pending')).resolves.toMatchObject({ tasks: [] })
  })

  it('reports a list row that is not an object as an unreadable answer', async () => {
    const { service } = serviceOver(authThen(succeed({ items: [42] })))
    await expect(service.list('pending')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('keeps a row that names only task_id and one that names no title', async () => {
    const { service } = serviceOver(authThen(succeed({
      items: [row({ guid: undefined, task_id: 't9', summary: undefined })],
    })))
    const data = await service.list('pending')
    expect(data.tasks[0]).toMatchObject({ taskId: 't9', summary: '' })
  })

  it('reports a row without any id as an unreadable answer', async () => {
    const { service } = serviceOver(authThen(succeed({ items: [row({ guid: undefined })] })))
    await expect(service.list('pending')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('collects members only when they name a role and an id', async () => {
    const members = [
      { role: 'assignee', type: 'user' },
      { id: '', role: 'assignee', type: 'user' },
      { id: 'ou_a', role: 'assignee', type: 'user' },
      { id: 'ou_f', role: 'follower', type: 'user' },
    ]
    const { service } = serviceOver(authThen(succeed({ items: [row({ members })] })))
    const data = await service.list('pending')
    expect(data.tasks[0]).toMatchObject({ assignees: ['ou_a'], followers: ['ou_f'] })
  })

  it('reads a local wall-clock time without seconds and an ISO instant as absolute time', async () => {
    const { service } = serviceOver(authThen(succeed({
      items: [row({ due_at: '2026-11-10 08:00', updated_at: '2026-11-09T10:00:00Z' })],
    })))
    const data = await service.list('pending')
    expect(data.tasks[0]?.dueAt).toBe(new Date(2026, 10, 10, 8, 0, 0).toISOString())
    expect(data.tasks[0]?.updatedAt).toBe('2026-11-09T10:00:00.000Z')
  })

  it('drops a due value it cannot parse', async () => {
    const { service } = serviceOver(authThen(succeed({ items: [row({ due_at: 'not a time' })] })))
    const data = await service.list('pending')
    expect(data.tasks[0]?.dueAt).toBeUndefined()
  })
})

describe('TaskService.status', () => {
  it('reports the scopes the token lacks and the signed-in name', async () => {
    const { service } = serviceOver(() => authStatus({ scope: 'task:task:write', userName: 'Ada' }))
    await expect(service.status()).resolves.toEqual({
      cli: true,
      configured: true,
      connected: true,
      userName: 'Ada',
      missingScopes: ['task:task:read'],
    })
  })

  it('reports an unconfigured CLI as not-configured', async () => {
    const { service } = serviceOver(() => fail({ type: 'config', subtype: 'not_configured' }, 3))
    await expect(service.status()).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('keeps the name absent when the CLI names no signed-in user', async () => {
    const { service } = serviceOver(() => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        appId: 'cli_x',
        identities: { user: { status: 'ready', available: true, openId: 'ou_me', scope: TASK_SCOPES } },
      }),
    }))
    await expect(service.status()).resolves.toEqual({
      cli: true,
      configured: true,
      connected: true,
      missingScopes: [],
    })
  })
})

describe('TaskService.detail', () => {
  it('reads one task and normalizes the fields only details carry', async () => {
    const detail = {
      guid: 't1',
      summary: 'Ship it',
      status: 'todo',
      completed_at: '0',
      due: { is_all_day: true, timestamp: '1794268800000' },
      description: 'note',
      creator: { id: 'ou_creator', type: 'user' },
      parent_task_guid: '',
      subtask_count: 2,
      tasklists: [{ tasklist_guid: 'tl1' }, { tasklist_guid: '' }],
      created_at: '1794276150920',
      updated_at: '1794276150920',
      members: [{ id: 'ou_assignee', role: 'assignee', type: 'user' }],
      url: 'https://applink.feishu.cn/client/todo/detail?guid=t1',
    }
    const { service, calls } = serviceOver(authThen(succeed({ task: detail })))
    const result = await service.detail('t1')
    expect(calls[1]?.args).toEqual(['task', 'tasks', 'get', '--task-guid', 't1'])
    expect(result).toMatchObject({
      taskId: 't1',
      summary: 'Ship it',
      dueAllDay: true,
      description: 'note',
      creator: 'ou_creator',
      subtaskCount: 2,
      tasklists: ['tl1'],
      assignees: ['ou_assignee'],
    })
    expect(result.completedAt).toBeUndefined()
    expect(result.parentTaskId).toBeUndefined()
    expect(result.dueAt).toBe(new Date(1794268800000).toISOString())
    expect(result.createdAt).toBe(new Date(1794276150920).toISOString())
  })

  it('caches a detail read for its own key', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ task: { guid: 't1', summary: 'One' } })))
    await service.detail('t1')
    await service.detail('t1')
    expect(calls.filter(call => call.args[1] === 'tasks')).toHaveLength(1)
  })

  it('reports a missing task as not-found', async () => {
    const { service } = serviceOver(authThen(succeed({})))
    await expect(service.detail('t1')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects a blank id before starting a process', async () => {
    const { service, calls } = serviceOver(authThen(succeed({})))
    await expect(service.detail('  ')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it('reads a numeric due timestamp and an empty description as absent', async () => {
    const detail = {
      guid: 't1',
      summary: 'Ship it',
      due: { timestamp: 1794268800000 },
      description: '',
      members: [],
    }
    const { service } = serviceOver(authThen(succeed({ task: detail })))
    const result = await service.detail('t1')
    expect(result.dueAt).toBe(new Date(1794268800000).toISOString())
    expect(result.dueAllDay).toBeUndefined()
    expect(result.description).toBeUndefined()
  })
})

describe('TaskService completion and reopening', () => {
  it('completes one task and reports the CLI answer', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 't1', status: 'done', completed_at: '1795888945000' })))
    await expect(service.complete('t1')).resolves.toEqual({
      taskId: 't1',
      status: 'done',
      completedAt: new Date(1795888945000).toISOString(),
    })
    expect(calls[0]?.args).toEqual(['task', '+complete', '--task-id', 't1'])
    expect(calls[0]?.timeoutMs).toBe(30_000)
  })

  it('reopens one task', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 't1', status: 'todo' })))
    await expect(service.reopen('t1')).resolves.toEqual({ taskId: 't1', status: 'todo' })
    expect(calls[0]?.args).toEqual(['task', '+reopen', '--task-id', 't1'])
  })

  it('defaults the answer status to the action it ran and its id to the one it wrote', async () => {
    const { service } = serviceOver(authThen(succeed({})))
    await expect(service.complete('t1')).resolves.toEqual({ taskId: 't1', status: 'done' })
    await expect(service.reopen('t1')).resolves.toEqual({ taskId: 't1', status: 'todo' })
  })

  it('drops every cached task read after a write succeeds', async () => {
    const { service, calls } = serviceOver((request) => {
      if (request.args[0] === 'auth') return authStatus()
      if (request.args[1] === '+complete') return succeed({ guid: 't1', status: 'done' })
      if (request.args[1] === 'tasks') return succeed({ task: { guid: 't1', summary: 'Ship it' } })
      return succeed({ items: [row()] })
    })
    await service.list('pending')
    await service.detail('t1')
    await service.complete('t1')
    await service.list('pending')
    await service.detail('t1')
    expect(calls.filter(call => call.args[1] === '+search')).toHaveLength(2)
    expect(calls.filter(call => call.args[1] === 'tasks')).toHaveLength(2)
  })
})

describe('TaskService.create', () => {
  it('creates an all-day task with a title, due date, and description', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 'new_1', status: 'todo' })))
    await expect(service.create({
      summary: 'Buy milk',
      due: '2026-12-02',
      allDay: true,
      description: '2L',
    })).resolves.toEqual({ taskId: 'new_1' })
    const args = calls[0]?.args ?? []
    expect(args.slice(0, 8)).toEqual([
      'task', '+create', '--summary', 'Buy milk', '--due', '2026-12-02', '--description', '2L',
    ])
    expect(args[8]).toBe('--idempotency-key')
    expect(args[9]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(calls[0]?.timeoutMs).toBe(30_000)
  })

  it('creates a timed task from an ISO instant', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 'new_1' })))
    await service.create({ summary: 'Buy milk', due: '2026-12-02T23:59:00.000Z' })
    expect(calls[0]?.args.slice(4, 6)).toEqual(['--due', '2026-12-02T23:59:00.000Z'])
  })

  it('reports a create answer without a task id as unknown-outcome', async () => {
    const { service } = serviceOver(authThen(succeed({})))
    await expect(service.create({ summary: 'Buy milk' })).rejects.toMatchObject({ code: 'unknown-outcome' })
  })

  it('rejects invalid input before starting a process', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 'x' })))
    await expect(service.create({ summary: '   ' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.create({ summary: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.create({ summary: 'ok', description: 'x'.repeat(5001) })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.create({ summary: 'ok', allDay: true })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.create({ summary: 'ok', due: '2026-12-02', allDay: true })).resolves.toEqual({ taskId: 'x' })
    await expect(service.create({ summary: 'ok', due: '2026-12-02' })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(1)
  })

  it('rejects an all-day due that is not a calendar day', async () => {
    const { service, calls } = serviceOver(authThen(succeed({ guid: 'x' })))
    await expect(service.create({ summary: 'ok', due: '2026-12-2', allDay: true })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.create({ summary: 'ok', due: '2026-13-01', allDay: true })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })
})
