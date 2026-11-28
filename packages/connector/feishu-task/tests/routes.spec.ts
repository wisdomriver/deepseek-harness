// Route envelopes: status and detail answers stay flat, and a bad body answers 400.

import { describe, expect, it } from 'vitest'
import type { CommandOutcome, CommandRequest } from '@deepseek-ai/dsh-feishu-bridge'
import { STATUS_PATH, TASK_PATH, TASKS_PATH } from '../src/paths.ts'
import { authStatus, authThen, serviceOver, succeed } from './harness.ts'

/** Build a route set over one canned command runner. */
function routesOver(answer: (request: CommandRequest) => CommandOutcome, log?: (message: string) => void) {
  return serviceOver(answer, log === undefined ? {} : { log }).routes
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
})
