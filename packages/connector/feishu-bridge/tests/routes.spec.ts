// Route wrapping: success envelope, mapped failure status, request id, and logging.

import { describe, expect, it } from 'vitest'
import { FeishuError } from '../src/errors.ts'
import { panelRoutes } from '../src/routes.ts'

/** One request the wrapper never reads a body from. */
function request(path = 'https://host/api/feishu-task/tasks'): Request {
  return new Request(path)
}

describe('panelRoutes', () => {
  it('answers success with the panel data', async () => {
    const routes = panelRoutes('task', [{ path: '/api/feishu-task/tasks', methods: ['GET'], requestBody: 'buffered', fetch: async () => ({ tasks: [] }) }])
    const response = await routes[0]!.fetch(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, data: { tasks: [] } })
  })

  it('maps a coded failure to its HTTP status and keeps a request id', async () => {
    const routes = panelRoutes('docs', [{
      path: '/api/feishu-docs/document',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => { throw new FeishuError('conflict', 'stale revision') },
    }])
    const response = await routes[0]!.fetch(request())
    expect(response.status).toBe(409)
    const body = await response.json() as { ok: boolean; error: { code: string; requestId: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('conflict')
    expect(body.error.message).toBe('feishu-docs: conflict')
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/)
  })

  it('never leaks the Host diagnostic into the response body', async () => {
    const routes = panelRoutes('calendar', [{
      path: '/api/feishu-calendar/events',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => { throw new FeishuError('upstream', 'secret title leaked here') },
    }])
    const response = await routes[0]!.fetch(request())
    expect(JSON.stringify(await response.json())).not.toContain('secret title')
  })

  it('turns an unclassified error into internal', async () => {
    const routes = panelRoutes('task', [{
      path: '/api/feishu-task/tasks',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => { throw new TypeError('bug') },
    }])
    const response = await routes[0]!.fetch(request())
    expect(response.status).toBe(500)
  })

  it('logs the panel, method, path, and code without content', async () => {
    const lines: string[] = []
    const routes = panelRoutes('docs', [{
      path: '/api/feishu-docs/recent',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => { throw new FeishuError('timeout', 'slow with private doc title') },
    }], { log: line => lines.push(line) })
    await routes[0]!.fetch(request())
    expect(lines[0]).toContain('feishu-docs: GET /api/feishu-docs/recent failed with timeout')
    expect(lines[0]).not.toContain('private doc title')
  })
})
