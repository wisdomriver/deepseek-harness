// The Host entry through real composition: the plugin registers its routes on Connection
// inside the authentication fence, serves them from the bridge's recorded CLI, and leaves
// nothing behind when the fiber is disposed.

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ConnectionAuthentication } from '@deepseek-ai/dsh-client-connection/src/authentication.ts'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection/src/rpc-host.ts'
import * as Task from '../src/index.ts'
import { STATUS_PATH, TASKS_PATH } from '../src/paths.ts'
import { authThen, serviceOver, succeed } from './harness.ts'

/** One list row as `task +search` reports it. */
const ROW = { guid: 't1', summary: 'Ship it', status: 'todo', members: [] }

/**
 * Mount Connection with a shared Fetch handler, before any task plugin runs.
 * @returns the Context, its connection, the owner-side request reader, and the recorded CLI answers.
 */
async function bench() {
  const ctx = new Context()
  const connectionFiber = ctx.plugin((pluginCtx: Context) => {
    new ConnectionAuthentication(pluginCtx)
    new HostConnectionService(pluginCtx, [])
  })
  await connectionFiber.await()
  const connection = ctx.get('connection') as HostConnectionService
  const shared = connection.createSharedFetchHandler('/api')
  const recorded = serviceOver(authThen(succeed({ items: [ROW] })))
  return {
    ctx,
    connection,
    calls: recorded.calls,
    /** Provide the recorded bridge, the way the bridge plugin would. */
    provideBridge: (): void => { ctx.provide('feishuBridge', recorded.bridge) },
    /**
     * Read one task route as the browser Peer.
     * @param path - route path including its query string.
     * @returns the answer.
     */
    get: (path: string): Promise<Response> =>
      shared.fetch(new Request(`http://host${path}`), connection.browserPeer),
    /**
     * Post one body to one task route as the browser Peer.
     * @param path - route path.
     * @param body - raw request body.
     * @returns the answer.
     */
    post: (path: string, body: string): Promise<Response> =>
      shared.fetch(new Request(`http://host${path}`, { method: 'POST', body }), connection.browserPeer),
  }
}

describe('feishu-task Host plugin', () => {
  it('serves status and the list through the authenticated routes', async () => {
    const b = await bench()
    b.provideBridge()
    const fiber = b.ctx.plugin(Task)
    await fiber.await()
    try {
      const status = await b.get(STATUS_PATH)
      expect(status.status).toBe(200)
      await expect(status.json()).resolves.toEqual({
        ok: true,
        data: { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] },
      })

      const list = await b.get(`${TASKS_PATH}?view=pending`)
      expect(list.status).toBe(200)
      await expect(list.json()).resolves.toMatchObject({
        ok: true,
        data: { view: 'pending', tasks: [{ taskId: 't1', summary: 'Ship it' }] },
      })
    } finally {
      await fiber.dispose()
      await b.ctx.fiber.dispose()
    }
  })

  it('withdraws every route with the plugin', async () => {
    const b = await bench()
    b.provideBridge()
    const fiber = b.ctx.plugin(Task)
    await fiber.await()
    await fiber.dispose()
    try {
      expect((await b.get(STATUS_PATH)).status).toBe(404)
      expect((await b.get(`${TASKS_PATH}?view=pending`)).status).toBe(404)
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('serves nothing while the bridge is absent, then registers once it arrives', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin(Task)
    await fiber.await()
    expect((await b.get(STATUS_PATH)).status).toBe(404)

    b.provideBridge()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await b.get(STATUS_PATH)).status).toBe(200)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('answers a rejected request and logs its code', async () => {
    const b = await bench()
    b.provideBridge()
    const fiber = b.ctx.plugin(Task)
    await fiber.await()
    try {
      const rejected = await b.post(TASKS_PATH, JSON.stringify({ due: '2026-12-02' }))
      expect(rejected.status).toBe(400)
      await expect(rejected.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(b.calls.filter(call => call.args.includes('+create'))).toHaveLength(0)
    } finally {
      await fiber.dispose()
      await b.ctx.fiber.dispose()
    }
  })
})
