// Host plugin wiring: the three routes reach Connection's registry inside its authentication fence,
// the reported week start is configuration, and disconnecting withdraws every route.

import { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/cordis'
import { FeishuBridgeService } from '@deepseek-ai/dsh-feishu-bridge/src/service.ts'
import type { BridgeRoute, CommandOutcome, CommandRequest } from '@deepseek-ai/dsh-feishu-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Calendar from '../src/index.ts'
import { EVENT_PATH, EVENTS_PATH, STATUS_PATH } from '../src/paths.ts'
import { authStatus, fail, succeed } from './harness.ts'

/** Contexts started by one test, disposed afterwards. */
const started: Context[] = []

afterEach(async () => {
  for (const ctx of started.splice(0)) await ctx.fiber.dispose()
})

/** What one mounted plugin registered. */
interface Harness {
  readonly ctx: Context
  readonly routes: BridgeRoute[]
  readonly withdrawn: string[]
  readonly logs: Message[]
}

/**
 * Build the context the plugin needs beside a recorded bridge and a stand-in Connection registry.
 * @param answer - the canned CLI answer.
 * @returns the context and its registrations.
 */
function contextWith(
  answer: (request: CommandRequest) => CommandOutcome = () => authStatus('calendar:calendar.event:read calendar:calendar:read'),
): Harness {
  const ctx = new Context()
  started.push(ctx)
  const routes: BridgeRoute[] = []
  const withdrawn: string[] = []
  const logs: Message[] = []
  ctx.logger.exporter({ export: (message) => { logs.push(message) } })
  ctx.provide('connection', {
    fetch: {
      register: (route: BridgeRoute) => {
        routes.push(route)
        return () => { withdrawn.push(route.path) }
      },
    },
  })
  ctx.provide('feishuBridge', new FeishuBridgeService({
    run: async request => answer(request),
    readTimeoutMs: 15_000,
    writeTimeoutMs: 30_000,
    maxConcurrency: 2,
    queueLimit: 8,
  }))
  return { ctx, routes, withdrawn, logs }
}

/**
 * Mount the plugin as the Loader does.
 * @param answer - the canned CLI answer.
 * @param config - the deployment config to mount with.
 * @returns the mounted context and its registrations.
 */
async function mount(
  answer?: (request: CommandRequest) => CommandOutcome,
  config?: Calendar.Config,
): Promise<Harness> {
  const harness = contextWith(answer)
  await harness.ctx.plugin(Calendar, config)
  return harness
}

/** Send one request through the registered route with that path. */
function answerRoute(harness: Harness, path: string, request = new Request(`http://localhost${path}`)) {
  const route = harness.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  return route.fetch(request)
}

/** Treat a wire string as the closed week-start union, the way the config loader's input arrives. */
function wireWeekStart(value: string): NonNullable<Calendar.Config['weekStart']> {
  return value as NonNullable<Calendar.Config['weekStart']>
}

describe('Config', () => {
  it('reports the Monday week start unless the deployment chooses Sunday', () => {
    expect(Calendar.Config({})).toEqual({ weekStart: 'monday' })
    expect(Calendar.Config({ weekStart: 'sunday' })).toEqual({ weekStart: 'sunday' })
    expect(() => Calendar.Config({ weekStart: wireWeekStart('friday') })).toThrow()
  })
})

describe('calendar plugin', () => {
  it('registers the status, events, and event routes with the bridge envelope', async () => {
    const harness = await mount()
    expect(harness.routes.map(route => [route.path, route.methods])).toEqual([
      [STATUS_PATH, ['GET']],
      [EVENTS_PATH, ['GET', 'POST']],
      [EVENT_PATH, ['GET', 'POST']],
    ])
    const status = await answerRoute(harness, STATUS_PATH)
    expect(status.status).toBe(200)
    await expect(status.json()).resolves.toMatchObject({ ok: true, data: { weekStart: 'monday' } })
  })

  it('reports the configured week start to the panel', async () => {
    const harness = await mount(undefined, { weekStart: 'sunday' })
    await expect((await answerRoute(harness, STATUS_PATH)).json()).resolves.toMatchObject({
      data: { weekStart: 'sunday' },
    })
  })

  it('defaults the week start for a caller that mounts the function directly', async () => {
    // The Loader validates Config, so this fallback serves a direct `apply(ctx)` call.
    const harness = contextWith()
    Calendar.apply(harness.ctx)
    await vi.waitFor(() => { expect(harness.routes).toHaveLength(3) })
    await expect((await answerRoute(harness, STATUS_PATH)).json()).resolves.toMatchObject({
      data: { weekStart: 'monday' },
    })
  })

  it('logs a failed route through the plugin logger without the event content', async () => {
    const harness = await mount(() => fail({ type: 'api', code: 99991672, message: 'title: private sync' }))
    const answer = await answerRoute(harness, STATUS_PATH)
    expect(answer.status).toBe(502)
    expect(harness.logs).toHaveLength(1)
    expect(harness.logs[0]).toMatchObject({ name: 'feishu-calendar', type: 'warn' })
    const text = harness.logs[0]!.args.map(String).join(' ')
    expect(text).toContain(`GET ${STATUS_PATH} failed with permission-denied`)
    expect(text).not.toContain('private sync')
  })

  it('withdraws every route when the plugin unloads', async () => {
    const harness = await mount()
    expect(harness.routes).toHaveLength(3)
    await harness.ctx.fiber.dispose()
    expect([...harness.withdrawn].sort()).toEqual([EVENT_PATH, EVENTS_PATH, STATUS_PATH].sort())
  })

  it('answers a month read over the registered events route', async () => {
    const harness = await mount(request => request.args[1] === '+agenda'
      ? succeed([])
      : authStatus('calendar:calendar.event:read calendar:calendar:read'))
    const answer = await answerRoute(
      harness,
      EVENTS_PATH,
      new Request(`http://localhost${EVENTS_PATH}?start=2026-12-01&end=2027-01-01`),
    )
    expect(answer.status).toBe(200)
    await expect(answer.json()).resolves.toMatchObject({ ok: true, data: { events: [] } })
  })
})
