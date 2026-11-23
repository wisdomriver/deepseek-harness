// Route envelopes: status and detail answers stay flat, and a bad body answers 400.

import { describe, expect, it } from 'vitest'
import type { CommandOutcome, CommandRequest } from '../src/cli.ts'
import { CalendarService } from '../src/service.ts'
import { calendarRoutes } from '../src/routes.ts'
import { EVENT_PATH, STATUS_PATH } from '../src/paths.ts'

/** Build a route set over one canned command runner. */
function routesOver(answer: (request: CommandRequest) => CommandOutcome, log?: (message: string) => void) {
  const service = new CalendarService({
    run: async request => answer(request),
    readTimeoutMs: 15_000,
    writeTimeoutMs: 30_000,
    maxConcurrency: 2,
    queueLimit: 8,
    weekStart: 'monday',
  })
  return calendarRoutes({ service, ...(log === undefined ? {} : { log }) })
}

/** One successful envelope. */
function succeed(data: unknown): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' }
}

describe('calendar routes', () => {
  it('answers status with the status payload itself', async () => {
    const routes = routesOver(() => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        appId: 'cli_x',
        identities: { user: { status: 'ready', available: true, userName: 'Ada', scope: 'calendar:calendar.event:read calendar:calendar:read' } },
      }),
    }))
    const status = routes.find(route => route.path === STATUS_PATH)
    const answer = await status?.fetch(new Request(`http://localhost${STATUS_PATH}`))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toEqual({
      ok: true,
      data: { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [], weekStart: 'monday' },
    })
  })

  it('answers an event detail as the flat event object', async () => {
    const routes = routesOver(() => succeed({
      event_id: 'e1',
      summary: 'Sync',
      status: 'confirmed',
      start_time: { datetime: '2026-11-25T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-11-25T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    const event = routes.find(route => route.path === EVENT_PATH)
    const answer = await event?.fetch(new Request(`http://localhost${EVENT_PATH}?eventId=e1`))
    expect(answer?.status).toBe(200)
    const body = await answer?.json() as { ok: boolean; data: { summary: string; status: string } }
    expect(body.ok).toBe(true)
    expect(body.data.summary).toBe('Sync')
    expect(body.data.status).toBe('confirmed')
  })

  it('rejects a create body that is not JSON with 400', async () => {
    const logged: string[] = []
    const routes = routesOver(() => succeed({ event: { event_id: 'x' } }), message => logged.push(message))
    const events = routes.find(route => route.path === '/api/feishu-calendar/events')
    const answer = await events?.fetch(new Request('http://localhost/api/feishu-calendar/events', { method: 'POST', body: 'not json' }))
    expect(answer?.status).toBe(400)
    const body = await answer?.json() as { ok: boolean; error: { code: string; requestId: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('invalid-input')
    expect(body.error.requestId).not.toBe('')
    expect(logged[0]).toContain('invalid-input')
  })
})
describe('calendar event mutations', () => {
  it('updates through the event route and answers the event id', async () => {
    const routes = routesOver(() => succeed({}))
    const event = routes.find(route => route.path === EVENT_PATH)
    const answer = await event?.fetch(new Request('http://localhost/api/feishu-calendar/event', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', eventId: 'e1', summary: 'Sync', allDay: false, start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00', timezone: 'Asia/Shanghai' }),
    }))
    expect(answer?.status).toBe(200)
    await expect(answer?.json()).resolves.toEqual({ ok: true, data: { eventId: 'e1' } })
  })

  it('deletes through the event route and rejects an unknown action', async () => {
    const routes = routesOver(() => succeed({}))
    const event = routes.find(route => route.path === EVENT_PATH)
    const deleted = await event?.fetch(new Request('http://localhost/api/feishu-calendar/event', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', eventId: 'e1' }),
    }))
    expect(deleted?.status).toBe(200)
    await expect(deleted?.json()).resolves.toEqual({ ok: true, data: { eventId: 'e1' } })
    const bad = await event?.fetch(new Request('http://localhost/api/feishu-calendar/event', {
      method: 'POST',
      body: JSON.stringify({ action: 'rename', eventId: 'e1' }),
    }))
    expect(bad?.status).toBe(400)
  })
})
