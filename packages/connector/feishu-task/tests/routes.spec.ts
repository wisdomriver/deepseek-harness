// Route envelopes: status and detail answers stay flat, the list route's view and search
// defaults, a reopening, and one 400 per malformed create or mutation body.

import { describe, expect, it } from 'vitest'
import type { CommandOutcome, CommandRequest } from '@deepseek-ai/dsh-feishu-bridge'
import { STATUS_PATH, TASK_PATH, TASKS_PATH } from '../src/paths.ts'
import { authStatus, authThen, serviceOver, succeed } from './harness.ts'

/** Build a route set over one canned command runner. */
function routesOver(answer: (request: CommandRequest) => CommandOutcome, log?: (message: string) => void) {
  return serviceOver(answer, log === undefined ? {} : { log }).routes
}

/**
 * Post one body to one task route.
 * @param body - raw request body.
 * @param path - route to post to.
 * @returns the route's answer.
 */
async function post(body: string, path: string = TASKS_PATH): Promise<Response | undefined> {
  const routes = routesOver(authThen(succeed({ guid: 'new_1' })))
  return routes.find(candidate => candidate.path === path)
    ?.fetch(new Request(`http://localhost${path}`, { method: 'POST', body }))
}

/**
 * Read one failure code from one answer.
 * @param answer - the route answer.
 * @returns the stable failure code.
 */
async function failureCode(answer: Response | undefined): Promise<string> {
  const body = await answer?.json() as { readonly error?: { readonly code: string } }
  return body.error?.code ?? ''
}

describe('task routes', () => {
  it('answers status with the status payload itself', async () => {
    const routes = routesOver(() => authStatus())
    const status = routes.find(route => route.path === STATUS_PATH)
    const answer = await status?.fetch(new Request(`http://localhost${STATUS_PATH}`))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toEqual({
      ok: true,
      data: { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] },
    })
  })

  it('reads a list for the requested view and search text', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return request.args[0] === 'auth' ? authStatus() : succeed({ items: [] })
    })
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}?view=done&query=dsh`))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toMatchObject({ ok: true, data: { view: 'done', tasks: [] } })
    expect(calls[1]?.args).toEqual(['task', '+search', '--completed=true', '--query', 'dsh'])
  })

  it('rejects an unknown view with 400', async () => {
    const routes = routesOver(authThen(succeed({ items: [] })))
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}?view=everything`))
    expect(answer?.status).toBe(400)
    await expect(answer?.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })

  it('answers one task detail as the task object', async () => {
    const routes = routesOver(authThen(succeed({ task: { guid: 't1', summary: 'Ship it', status: 'todo' } })))
    const task = routes.find(route => route.path === TASK_PATH)
    const answer = await task?.fetch(new Request(`http://localhost${TASK_PATH}?taskId=t1`))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toMatchObject({ ok: true, data: { taskId: 't1', summary: 'Ship it' } })
  })

  it('rejects a detail read without a task id', async () => {
    const routes = routesOver(authThen(succeed({ task: { guid: 't1' } })))
    const task = routes.find(route => route.path === TASK_PATH)
    const answer = await task?.fetch(new Request(`http://localhost${TASK_PATH}`))
    expect(answer?.status).toBe(400)
  })

  it('dispatches a completion through the task route', async () => {
    const routes = routesOver(authThen(succeed({ guid: 't1', status: 'done' })))
    const task = routes.find(route => route.path === TASK_PATH)
    const answer = await task?.fetch(new Request(`http://localhost${TASK_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'complete', taskId: 't1' }),
    }))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toEqual({ ok: true, data: { taskId: 't1', status: 'done' } })
  })

  it('rejects an unknown mutation action with 400', async () => {
    const routes = routesOver(authThen(succeed({ guid: 't1' })))
    const task = routes.find(route => route.path === TASK_PATH)
    const answer = await task?.fetch(new Request(`http://localhost${TASK_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', taskId: 't1' }),
    }))
    expect(answer?.status).toBe(400)
  })

  it('creates one task through the list route', async () => {
    const routes = routesOver(authThen(succeed({ guid: 'new_1' })))
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ summary: 'Buy milk', due: '2026-12-02', allDay: true }),
    }))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toEqual({ ok: true, data: { taskId: 'new_1' } })
  })

  it('rejects a create body that is not JSON with 400 and logs the code', async () => {
    const logged: string[] = []
    const routes = routesOver(authThen(succeed({ guid: 'new_1' })), message => logged.push(message))
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}`, { method: 'POST', body: 'not json' }))
    expect(answer?.status).toBe(400)
    const body = await answer?.json() as { ok: boolean; error: { code: string; requestId: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('invalid-input')
    expect(body.error.requestId).not.toBe('')
    expect(logged[0]).toContain('invalid-input')
  })

  it('rejects a non-boolean all-day flag with 400', async () => {
    const routes = routesOver(authThen(succeed({ guid: 'new_1' })))
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ summary: 'Buy milk', allDay: 'yes' }),
    }))
    expect(answer?.status).toBe(400)
  })

  it('reads the pending view with no search when the panel names neither', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return request.args[0] === 'auth' ? authStatus() : succeed({ items: [] })
    })
    const tasks = routes.find(route => route.path === TASKS_PATH)
    const answer = await tasks?.fetch(new Request(`http://localhost${TASKS_PATH}`))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toMatchObject({ ok: true, data: { view: 'pending', tasks: [] } })
    expect(calls[1]?.args).toEqual(['task', '+search', '--completed=false'])
  })

  it('dispatches a reopening through the task route', async () => {
    const routes = routesOver(authThen(succeed({ guid: 't1', status: 'todo' })))
    const task = routes.find(route => route.path === TASK_PATH)
    const answer = await task?.fetch(new Request(`http://localhost${TASK_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reopen', taskId: 't1' }),
    }))
    await expect(answer?.json()).resolves.toEqual({ ok: true, data: { taskId: 't1', status: 'todo' } })
  })

  it('creates a task from a title alone and from a title with a description', async () => {
    const bare = routesOver(authThen(succeed({ guid: 'new_1' })))
    const create = await bare.find(route => route.path === TASKS_PATH)
      ?.fetch(new Request(`http://localhost${TASKS_PATH}`, { method: 'POST', body: JSON.stringify({ summary: 'Buy milk' }) }))
    await expect(create?.json()).resolves.toEqual({ ok: true, data: { taskId: 'new_1' } })

    const calls: CommandRequest[] = []
    const described = routesOver((request) => {
      calls.push(request)
      return request.args[0] === 'auth' ? authStatus() : succeed({ guid: 'new_2' })
    })
    const answer = await described.find(route => route.path === TASKS_PATH)?.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ summary: 'Buy milk', description: '2L, oat' }),
    }))
    await expect(answer?.json()).resolves.toEqual({ ok: true, data: { taskId: 'new_2' } })
    expect(calls[0]?.args).toContain('2L, oat')
  })

  it('rejects a create body without a title, with a non-string due, or with a non-string description', async () => {
    expect(await failureCode(await post(JSON.stringify({})))).toBe('invalid-input')
    expect(await failureCode(await post(JSON.stringify({ summary: '   ' })))).toBe('invalid-input')
    expect(await failureCode(await post(JSON.stringify({ summary: 'ok', due: 5 })))).toBe('invalid-input')
    expect(await failureCode(await post(JSON.stringify({ summary: 'ok', description: 5 })))).toBe('invalid-input')
  })

  it('rejects a mutation body without a textual task id or a known action', async () => {
    expect(await failureCode(await post(JSON.stringify({ action: 'complete', taskId: 7 }), TASK_PATH))).toBe('invalid-input')
    expect(await failureCode(await post(JSON.stringify({ action: 'complete', taskId: '   ' }), TASK_PATH))).toBe('invalid-input')
  })

  it('rejects a body that is not a JSON object', async () => {
    for (const body of ['[]', 'null', '"a title"']) {
      expect(await failureCode(await post(body))).toBe('invalid-input')
    }
  })
})
