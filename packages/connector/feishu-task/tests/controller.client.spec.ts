// Panel controller behavior over recorded route answers: the five states, the debounced
// search, optimistic completion, the detail read, creation, superseded reads, and the
// default transport.

import { describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, TaskController } from '../src/client/controller.ts'
import { STATUS_ROUTE, TASKS_ROUTE, TASK_ROUTE } from '../src/paths.ts'
import type { TaskDetail, TaskSummary } from '../src/types.ts'

const STATUS = { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] }

/** One normalized row due tomorrow. */
function row(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    taskId: 't1',
    summary: 'Ship it',
    status: 'todo',
    assignees: ['ou_a'],
    followers: [],
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

const DETAIL: TaskDetail = { ...row(), tasklists: [], dueAllDay: false }

/** One answer a test resolves at its own time. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

/**
 * Build a fetch stub whose first list read waits for the test's own answer while the second
 * succeeds with one row, so a superseded read can be resolved late.
 * @param superseded - answer the first list read resolves with, whenever the test chooses.
 * @returns the fetcher and a reader for the number of list reads so far.
 */
function supersedingFetcher(superseded: { readonly promise: Promise<unknown> }) {
  let lists = 0
  const fetcher: typeof fetch = async (input) => {
    if (String(input) === STATUS_ROUTE) return respond(STATUS)
    lists += 1
    return lists === 1
      ? respond(await superseded.promise)
      : respond({ tasks: [row()], view: 'pending', fetchedAt: 'now' })
  }
  return { fetcher, listsOf: () => lists }
}

/** Route answers one test supplies; a failure envelope answers with a 500 status. */
interface Answers {
  readonly status?: () => unknown
  readonly tasks?: (query: URLSearchParams) => unknown
  readonly task?: () => unknown
  readonly mutate?: () => unknown
  readonly create?: () => unknown
}

/**
 * Build a fetcher answering each route, recording every call.
 * @param answers - the answer each route returns, or a promise of it.
 * @returns the fetcher and the recorded calls.
 */
function server(answers: Answers) {
  const calls: { readonly route: string; readonly init: RequestInit | undefined }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const route = String(input)
    calls.push({ route, init })
    const url = new URL(route, 'http://localhost')
    const path = url.pathname.slice(1)
    const value: unknown = init?.method === 'POST'
      ? path === TASK_ROUTE ? answers.mutate?.() : answers.create?.()
      : path === STATUS_ROUTE
        ? answers.status?.()
        : path === TASK_ROUTE ? answers.task?.() : answers.tasks?.(url.searchParams)
    return respond(await value)
  }
  return { calls, fetcher }
}

/**
 * Build one route answer.
 * @param value - the successful payload, or a failure envelope.
 * @returns the response.
 */
function respond(value: unknown): Response {
  const failed = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
  return new Response(JSON.stringify(failed ? value : { ok: true, data: value }), { status: failed ? 500 : 200 })
}

describe('TaskController states', () => {
  it('reads status and the pending list, then reports ready', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.groups[0]?.key).toBe('tomorrow')
    expect(snapshot.userName).toBe('Ada')
    expect(calls[0]?.route).toBe(STATUS_ROUTE)
    expect(calls[1]?.route).toBe(`${TASKS_ROUTE}?view=pending`)
  })

  it('reports a missing CLI as no-cli', async () => {
    const { fetcher } = server({
      status: () => ({ ok: false, error: { code: 'cli-missing', message: 'missing', requestId: 'r' } }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('no-cli') })
    expect(controller.store.getSnapshot().errorCode).toBe('cli-missing')
  })

  it('reports a signed-out account as disconnected', async () => {
    const { calls, fetcher } = server({ status: () => ({ ...STATUS, connected: false }) })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('disconnected') })
    expect(calls.every(call => !call.route.startsWith(TASKS_ROUTE))).toBe(true)
  })

  it('reports missing scopes as permission without reading the list', async () => {
    const { calls, fetcher } = server({ status: () => ({ ...STATUS, missingScopes: ['task:task:read'] }) })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('permission') })
    expect(controller.store.getSnapshot().missingScopes).toEqual(['task:task:read'])
    expect(calls.every(call => !call.route.startsWith(TASKS_ROUTE))).toBe(true)
  })

  it('reports a failed list read as error', async () => {
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ ok: false, error: { code: 'upstream', message: 'bad', requestId: 'r' } }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('error') })
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })
})

describe('TaskController search', () => {
  it('waits for the debounce before reading typed input', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [], view: 'pending', fetchedAt: 'now' }),
    })
    const controller = new TaskController(fetcher)
    controller.actions.search('dsh')
    expect(controller.store.getSnapshot().query).toBe('dsh')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(calls).toHaveLength(0)
    await vi.waitFor(() => {
      expect(calls.some(call => call.route === `${TASKS_ROUTE}?view=pending&query=dsh`)).toBe(true)
    })
    controller.dispose()
  })
})

describe('TaskController completion', () => {
  it('marks a row done while the write runs and never writes twice', async () => {
    const gate = deferred<unknown>()
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      mutate: () => gate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.complete('t1')
    expect(controller.store.getSnapshot().marks['t1']).toMatchObject({ status: 'done', pending: true })
    controller.actions.complete('t1')
    gate.resolve({ taskId: 't1', status: 'done', completedAt: '2026-11-10T00:00:00.000Z' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().marks['t1']).toBeUndefined() })
    const posts = calls.filter(call => call.init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({ action: 'complete', taskId: 't1' })
  })

  it('rolls a failed completion back and reports its code', async () => {
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      mutate: () => ({ ok: false, error: { code: 'timeout', message: 'slow', requestId: 'r' } }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.complete('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().actionErrorCode).toBe('timeout') })
    expect(controller.store.getSnapshot().marks['t1']).toBeUndefined()
    expect(controller.store.getSnapshot().tasks[0]?.status).toBe('todo')
  })

  it('marks a reopened row to do while the write runs', async () => {
    const gate = deferred<unknown>()
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row({ status: 'done' })], view: 'done', fetchedAt: 'now' }),
      mutate: () => gate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.reopen('t1')
    expect(controller.store.getSnapshot().marks['t1']).toMatchObject({ status: 'todo', pending: true })
    gate.resolve({ taskId: 't1', status: 'todo' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().marks['t1']).toBeUndefined() })
  })
})

describe('TaskController detail', () => {
  it('fills the drawer with the task detail and closes it', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      task: () => DETAIL,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    expect(controller.store.getSnapshot().selection?.detail?.summary).toBe('Ship it')
    expect(calls.at(-1)?.route).toBe(`${TASK_ROUTE}?taskId=t1`)
    controller.actions.closeTask()
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })
})

describe('TaskController create', () => {
  it('posts the form, highlights the new task, and re-reads the list', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      create: () => ({ taskId: 'new_1' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openCreate()
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    controller.actions.submitCreate({ summary: 'Buy milk' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer).toBeUndefined() })
    expect(controller.store.getSnapshot().highlightTaskId).toBe('new_1')
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(posted?.route).toBe(TASKS_ROUTE)
    expect(JSON.parse(String(posted?.init?.body))).toEqual({ summary: 'Buy milk' })
    expect(calls.filter(call => call.route.startsWith(`${TASKS_ROUTE}?`))).toHaveLength(2)
  })

  it('keeps the dialog open and reports the failure code', async () => {
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [], view: 'pending', fetchedAt: 'now' }),
      create: () => ({ ok: false, error: { code: 'unknown-outcome', message: 'maybe', requestId: 'r' } }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openCreate()
    controller.actions.submitCreate({ summary: 'Buy milk' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer?.errorCode).toBe('unknown-outcome') })
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })
})

describe('TaskController failures', () => {
  it('maps each Host failure code onto the state that explains it', async () => {
    const cases = [
      { code: 'not-configured', phase: 'disconnected' },
      { code: 'not-connected', phase: 'disconnected' },
      { code: 'permission-denied', phase: 'permission' },
    ] as const
    for (const expected of cases) {
      const { fetcher } = server({
        status: () => ({ ok: false, error: { code: expected.code, message: 'no', requestId: 'r' } }),
      })
      const controller = new TaskController(fetcher)
      controller.load()
      await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe(expected.phase) })
      expect(controller.store.getSnapshot().errorCode).toBe(expected.code)
    }
  })

  it('reports an answer without an envelope as an upstream failure', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([{ cli: true }]), { status: 200 })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('error') })
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })

  it('reports a transport error as an upstream failure', async () => {
    const fetcher: typeof fetch = async () => { throw new TypeError('connection reset') }
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('error') })
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })

  it('names an account whose status reports no user name', async () => {
    const { fetcher } = server({
      status: () => ({ cli: true, configured: true, connected: true, missingScopes: [] }),
      tasks: () => ({ tasks: [], view: 'pending', fetchedAt: 'now' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    expect(controller.store.getSnapshot().userName).toBeUndefined()
  })
})

describe('TaskController reads in flight', () => {
  it('keeps the newest read when a second one starts', async () => {
    const first = deferred<unknown>()
    const fetcher: typeof fetch = async (input) => {
      if (String(input) === STATUS_ROUTE) return respond(await first.promise)
      return respond({ tasks: [row()], view: 'pending', fetchedAt: 'now' })
    }
    const controller = new TaskController(fetcher)
    controller.load()
    controller.load()
    first.resolve(STATUS)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    expect(controller.store.getSnapshot().tasks.map(task => task.taskId)).toEqual(['t1'])
    controller.dispose()
  })

  it('drops a list answer the newer read already replaced', async () => {
    const superseded = deferred<unknown>()
    const { fetcher, listsOf } = supersedingFetcher(superseded)
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(listsOf()).toBe(1) })
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    superseded.resolve({ tasks: [row({ taskId: 'stale' })], view: 'pending', fetchedAt: 'now' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().tasks.map(task => task.taskId)).toEqual(['t1'])
  })

  it('drops a failed read the newer read already replaced', async () => {
    const superseded = deferred<unknown>()
    const { fetcher, listsOf } = supersedingFetcher(superseded)
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(listsOf()).toBe(1) })
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    superseded.resolve({ ok: false, error: { code: 'timeout', message: 'slow', requestId: 'r' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().phase).toBe('ready')
    expect(controller.store.getSnapshot().errorCode).toBeUndefined()
  })
})

describe('TaskController actions', () => {
  it('re-reads the shown view on refresh and drops the create highlight', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      create: () => ({ taskId: 'new_1' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openCreate()
    controller.actions.submitCreate({ summary: 'Buy milk' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().highlightTaskId).toBe('new_1') })
    controller.actions.refresh()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().highlightTaskId).toBeUndefined() })
    expect(calls.filter(call => call.route.startsWith(`${TASKS_ROUTE}?`)).length).toBeGreaterThanOrEqual(2)
  })

  it('switches the view and cancels the read a pending search would add', async () => {
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [], view: 'done', fetchedAt: 'now' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.search('dsh')
    controller.actions.setView('done')
    await vi.waitFor(() => {
      expect(calls.some(call => call.route === `${TASKS_ROUTE}?view=done&query=dsh`)).toBe(true)
    })
    await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50))
    expect(controller.store.getSnapshot().view).toBe('done')
    expect(calls.filter(call => call.route.startsWith(`${TASKS_ROUTE}?`))).toHaveLength(2)
    controller.dispose()
  })

  it('closes the create dialog without writing', () => {
    const { calls, fetcher } = server({ status: () => STATUS })
    const controller = new TaskController(fetcher)
    controller.actions.openCreate()
    controller.actions.closeCreate()
    expect(controller.store.getSnapshot().composer).toBeUndefined()
    controller.actions.submitCreate({ summary: 'Buy milk' })
    expect(calls).toHaveLength(0)
  })

  it('writes once while a create is already running', async () => {
    const gate = deferred<unknown>()
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [], view: 'pending', fetchedAt: 'now' }),
      create: () => gate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.actions.openCreate()
    controller.actions.submitCreate({ summary: 'Buy milk' })
    controller.actions.submitCreate({ summary: 'Buy milk' })
    gate.resolve({ taskId: 'new_1' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer).toBeUndefined() })
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(1)
  })

  it('ignores a detail retry with no drawer open', () => {
    const { calls, fetcher } = server({ status: () => STATUS })
    const controller = new TaskController(fetcher)
    controller.actions.retryDetail()
    expect(calls).toHaveLength(0)
  })
})

describe('TaskController drawer during a write', () => {
  it('folds the answer into the open drawer and clears the old completion', async () => {
    const answers = [
      { taskId: 't1', status: 'done', completedAt: '2026-11-10T00:00:00.000Z' },
      { taskId: 't1', status: 'todo' },
    ]
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      task: () => DETAIL,
      mutate: () => answers.shift(),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })

    controller.actions.complete('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.detail?.status).toBe('done') })
    expect(controller.store.getSnapshot().selection?.detail?.completedAt).toBe('2026-11-10T00:00:00.000Z')

    controller.actions.reopen('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.detail?.status).toBe('todo') })
    expect(controller.store.getSnapshot().selection?.detail?.completedAt).toBeUndefined()
  })

  it('leaves a drawer on another task alone while a row completes', async () => {
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row(), row({ taskId: 't2', summary: 'Plan' })], view: 'pending', fetchedAt: 'now' }),
      task: () => ({ ...DETAIL, taskId: 't2', summary: 'Plan' }),
      mutate: () => ({ taskId: 't1', status: 'done' }),
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t2')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.complete('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().marks['t1']).toBeUndefined() })
    const selection = controller.store.getSnapshot().selection
    expect(selection?.taskId).toBe('t2')
    expect(selection?.detail?.status).toBe('todo')
  })
})

describe('TaskController row marks', () => {
  it('keeps another row’s optimistic mark while one write finishes', async () => {
    const gates = { t1: deferred<unknown>(), t2: deferred<unknown>() }
    const fetcher: typeof fetch = async (input, init) => {
      const route = String(input)
      if (route === STATUS_ROUTE) return respond(STATUS)
      if (init?.method === 'POST' && route === TASK_ROUTE) {
        const body = JSON.parse(String(init.body)) as { readonly taskId: string }
        return respond(await gates[body.taskId as 't1' | 't2'].promise)
      }
      return respond({ tasks: [row(), row({ taskId: 't2' })], view: 'pending', fetchedAt: 'now' })
    }
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.complete('t1')
    controller.actions.complete('t2')
    expect(Object.keys(controller.store.getSnapshot().marks).sort()).toEqual(['t1', 't2'])
    gates.t1.resolve({ taskId: 't1', status: 'done' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().marks['t1']).toBeUndefined() })
    expect(controller.store.getSnapshot().marks['t2']).toEqual({ taskId: 't2', status: 'done', pending: true })
    gates.t2.resolve({ taskId: 't2', status: 'done' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().marks['t2']).toBeUndefined() })
  })

  it('carries the list row’s Feishu link into the drawer until the detail answers', async () => {
    const detailGate = deferred<unknown>()
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({
        tasks: [row({ appLink: 'https://applink.feishu.cn/client/todo/detail?guid=t1' })],
        view: 'pending',
        fetchedAt: 'now',
      }),
      task: () => detailGate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    expect(controller.store.getSnapshot().selection?.appLink).toBe('https://applink.feishu.cn/client/todo/detail?guid=t1')
    detailGate.resolve(DETAIL)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
  })
})

describe('TaskController detail in flight', () => {
  it('drops a detail answer for a drawer the user already closed', async () => {
    const detailGate = deferred<unknown>()
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      task: () => detailGate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    controller.actions.closeTask()
    detailGate.resolve(DETAIL)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('drops a failed detail read for a drawer the user already closed', async () => {
    const detailGate = deferred<unknown>()
    const { fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      task: () => detailGate.promise,
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    controller.actions.closeTask()
    detailGate.resolve({ ok: false, error: { code: 'not-found', message: 'gone', requestId: 'r' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('reports a failed detail read and retries it', async () => {
    let reads = 0
    const { calls, fetcher } = server({
      status: () => STATUS,
      tasks: () => ({ tasks: [row()], view: 'pending', fetchedAt: 'now' }),
      task: () => {
        reads += 1
        return reads === 1 ? { ok: false, error: { code: 'not-found', message: 'gone', requestId: 'r' } } : DETAIL
      },
    })
    const controller = new TaskController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openTask('t1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('error') })
    expect(controller.store.getSnapshot().selection?.errorCode).toBe('not-found')
    controller.actions.retryDetail()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    expect(calls.filter(call => call.route.startsWith(`${TASK_ROUTE}?`))).toHaveLength(2)
  })
})

describe('TaskController default transport', () => {
  it('reads through the platform fetch when none is injected', async () => {
    const platform = vi.fn(async (_input: RequestInfo | URL) => respond(STATUS))
    vi.stubGlobal('fetch', platform)
    try {
      const controller = new TaskController()
      controller.load()
      await vi.waitFor(() => { expect(platform).toHaveBeenCalled() })
      expect(platform.mock.calls[0]?.[0]).toBe(STATUS_ROUTE)
      controller.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
