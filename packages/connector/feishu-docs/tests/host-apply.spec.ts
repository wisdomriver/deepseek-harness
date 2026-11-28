// Host plugin body: the docs routes registered inside Connection's fetch service, the
// diagnostic sink, and the withdrawal of every route with the plugin fiber.

import { Context } from '@deepseek-ai/cordis'
import type { BridgeRoute, CommandRunner } from '@deepseek-ai/dsh-feishu-bridge'
import { FeishuBridgeService } from '@deepseek-ai/dsh-feishu-bridge/src/service.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/index.ts'
import {
  DOCUMENTS_PATH,
  DOCUMENT_PATH,
  FILES_PATH,
  RECENT_PATH,
  SEARCH_PATH,
  STATUS_PATH,
} from '../src/paths.ts'
import { authStatus, fail, succeed } from './harness.ts'

afterEach(() => { vi.useRealTimers() })

/** Every path the plugin registers. */
const PATHS = [STATUS_PATH, RECENT_PATH, SEARCH_PATH, FILES_PATH, DOCUMENT_PATH, DOCUMENTS_PATH]

/**
 * Mount the plugin over a recorded command runner.
 * @param run - runner answering every CLI command.
 * @returns the context, the registered routes, the removed paths, and the plugin fiber.
 */
async function bench(run: CommandRunner) {
  const ctx = new Context()
  const registered: BridgeRoute[] = []
  const released: string[] = []
  ctx.provide('connection', {
    fetch: {
      register: (route: BridgeRoute) => {
        registered.push(route)
        return () => { released.push(route.path) }
      },
    },
  } as never)
  ctx.provide('feishuBridge', new FeishuBridgeService({
    run,
    readTimeoutMs: 1000,
    writeTimeoutMs: 1000,
    maxConcurrency: 1,
    queueLimit: 2,
  }) as never)
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  return { ctx, registered, released, fiber }
}

/**
 * Send one request to a registered route.
 * @param routes - routes the plugin registered.
 * @param path - absolute path to call.
 * @returns the response.
 */
async function call(routes: readonly BridgeRoute[], path: string): Promise<Response> {
  const route = routes.find(candidate => candidate.path === path.split('?')[0])
  if (route === undefined) throw new Error(`missing route ${path}`)
  return route.fetch(new Request(`http://localhost${path}`))
}

describe('feishu-docs host plugin', () => {
  it('names the plugin and registers every docs route', async () => {
    const b = await bench(async () => authStatus())
    expect(name).toBe('feishu-docs')
    expect(b.registered.map(route => route.path)).toEqual(PATHS)
    const status = await call(b.registered, STATUS_PATH)
    expect(status.status).toBe(200)
    expect(await status.json() as Record<string, unknown>).toMatchObject({
      ok: true,
      data: { cli: true, connected: true, missingScopes: [] },
    })
  })

  it('serves document reads and writes through the same registered routes', async () => {
    const b = await bench(async ({ args }) => (args[0] === 'docs' && args[1] === '+fetch'
      ? succeed({ document: { content: '# A', document_id: 'd1', revision_id: 1 } })
      : succeed({ document: { revision_id: 2 }, result: 'success', warnings: [] })))
    const read = await call(b.registered, `${DOCUMENT_PATH}?token=d1&mode=full`)
    expect(await read.json() as Record<string, unknown>).toMatchObject({ ok: true, data: { mode: 'full', content: '# A' } })
    const write = b.registered.find(route => route.path === DOCUMENT_PATH)
    const response = await write?.fetch(new Request(`http://localhost${DOCUMENT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'append', token: 'd1', revisionId: 1, content: '# hi' }),
    }))
    expect(response?.status).toBe(200)
  })

  it('reports a failed route through the Host logger without document content', async () => {
    const b = await bench(async () => fail({ type: 'api', code: 1, message: 'boom' }))
    const status = await call(b.registered, STATUS_PATH)
    expect(status.status).toBeGreaterThanOrEqual(400)
    const failureBody = await status.json() as { ok: false; error: { code: string } }
    expect(failureBody.ok).toBe(false)
    expect(failureBody.error.code).toBeTruthy()
    const logged = b.ctx.logger.buffer.filter(message => message.name === 'feishu-docs')
    expect(logged.length).toBeGreaterThanOrEqual(1)
    expect(logged.at(-1)?.args.join(' ')).toContain(`GET ${STATUS_PATH} failed with`)
    expect(JSON.stringify(logged)).not.toContain('boom')
  })

  it('withdraws every route when the plugin fiber goes down', async () => {
    const b = await bench(async () => authStatus())
    await b.fiber.dispose()
    expect([...b.released].sort()).toEqual([...PATHS].sort())
  })
})
