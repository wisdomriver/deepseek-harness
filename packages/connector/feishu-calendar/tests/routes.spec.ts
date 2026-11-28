// Route behavior: each method's answer, the request validations, and the failure envelope.

import { describe, expect, it } from 'vitest'
import type { CommandOutcome, CommandRequest } from '@deepseek-ai/dsh-feishu-bridge'
import { EVENT_PATH, EVENTS_PATH, STATUS_PATH } from '../src/paths.ts'
import { authStatus, fail, serviceOver, succeed } from './harness.ts'

const SCOPED = 'calendar:calendar.event:read calendar:calendar:read'

/** The agenda answer one month read returns. */
const AGENDA = [
  {
    event_id: 'e1',
    summary: 'Sync',
    start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
    end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    status: 'confirmed',
  },
]

/** Build a route set over one canned command runner. */
function routesOver(
  answer: (request: CommandRequest) => CommandOutcome,
  log?: (message: string) => void,
) {
  return serviceOver(answer, log === undefined ? {} : { log }).routes
}

/** Answer `auth status` with a fully scoped token and every other command with `data`. */
function scoped(data: unknown = AGENDA) {
  return (request: CommandRequest): CommandOutcome =>
    request.args[1] === 'status' ? authStatus(SCOPED) : succeed(data)
}

/** The route with one path. */
function routeOf(routes: readonly { path: string; fetch: (request: Request) => Promise<Response> }[], path: string) {
  const route = routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`no route ${path}`)
  return route
}

/** One JSON POST. */
function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) })
}

/** A complete update body for one timed event. */
function timedUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'update',
    eventId: 'e1',
    summary: 'Sync v2',
    allDay: false,
    start: '2026-12-15T10:00:00+08:00',
    end: '2026-12-15T10:30:00+08:00',
    timezone: 'Asia/Shanghai',
    ...overrides,
  }
}

describe('calendar status route', () => {
  it('answers status with the status payload itself', async () => {
    const routes = routesOver(() => authStatus(SCOPED))
    const answer = await routeOf(routes, STATUS_PATH).fetch(new Request(`http://localhost${STATUS_PATH}`))
    expect(answer.status).toBe(200)
    await expect(answer.json()).resolves.toEqual({
      ok: true,
      data: { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [], weekStart: 'monday' },
    })
  })
})

describe('calendar events route', () => {
  it('reads the month the query bounds it to', async () => {
    const routes = routesOver(scoped())
    const answer = await routeOf(routes, EVENTS_PATH)
      .fetch(new Request(`http://localhost${EVENTS_PATH}?start=2026-12-01&end=2027-01-01`))
    expect(answer.status).toBe(200)
    const body = await answer.json() as { ok: boolean; data: { events: { eventId: string }[] } }
    expect(body.data.events.map(event => event.eventId)).toEqual(['e1'])
  })

  it('rejects a range without bounds before starting a process', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return authStatus(SCOPED)
    })
    const answer = await routeOf(routes, EVENTS_PATH).fetch(new Request(`http://localhost${EVENTS_PATH}`))
    expect(answer.status).toBe(400)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    expect(calls.filter(call => call.args[1] === '+agenda')).toHaveLength(0)
  })

  it('creates one event from a complete body', async () => {
    const routes = routesOver(scoped({ event: { event_id: 'new_0' } }))
    const answer = await routeOf(routes, EVENTS_PATH).fetch(post(EVENTS_PATH, {
      summary: 'Trip',
      allDay: true,
      start: '2026-12-09',
      end: '2026-12-11',
      timezone: 'Asia/Shanghai',
      description: 'note',
    }))
    expect(answer.status).toBe(200)
    await expect(answer.json()).resolves.toEqual({ ok: true, data: { eventId: 'new_0' } })
  })

  it('creates one event without a description', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return request.args[1] === 'status' ? authStatus(SCOPED) : succeed({ event: { event_id: 'new_1' } })
    })
    await routeOf(routes, EVENTS_PATH).fetch(post(EVENTS_PATH, {
      summary: 'Trip',
      allDay: false,
      start: '2026-12-09T10:00:00+08:00',
      end: '2026-12-09T11:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }))
    const create = calls.find(call => call.args[1] === 'events')
    expect(JSON.parse(create?.stdin ?? '{}')).not.toHaveProperty('description')
  })

  it.each([
    [{ allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai' }],
    [{ summary: '   ', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai' }],
    [{ summary: 'Trip', start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai' }],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', timezone: 'Asia/Shanghai' }],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: 7, timezone: 'Asia/Shanghai' }],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: '2026-12-09' }],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: '  ' }],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai', description: 5 }],
  ])('rejects the create body %j before it calls the CLI', async (body) => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return succeed({ event: { event_id: 'new_0' } })
    })
    const answer = await routeOf(routes, EVENTS_PATH).fetch(post(EVENTS_PATH, body))
    expect(answer.status).toBe(400)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    expect(calls).toHaveLength(0)
  })

  it('rejects a create body that is not JSON with 400', async () => {
    const logged: string[] = []
    const routes = routesOver(scoped(), message => logged.push(message))
    const answer = await routeOf(routes, EVENTS_PATH)
      .fetch(new Request(`http://localhost${EVENTS_PATH}`, { method: 'POST', body: 'not json' }))
    expect(answer.status).toBe(400)
    const body = await answer.json() as { ok: boolean; error: { code: string; requestId: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('invalid-input')
    expect(body.error.requestId).not.toBe('')
    expect(logged[0]).toContain('invalid-input')
  })

  it.each([
    ['[]', 'an array'],
    ['null', 'null'],
    ['5', 'a number'],
  ])('rejects a create body holding %s because it is %s', async (raw) => {
    const routes = routesOver(scoped())
    const answer = await routeOf(routes, EVENTS_PATH)
      .fetch(new Request(`http://localhost${EVENTS_PATH}`, { method: 'POST', body: raw }))
    expect(answer.status).toBe(400)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })
})

describe('calendar event route', () => {
  it('answers an event detail as the flat event object', async () => {
    const routes = routesOver(() => succeed({
      event_id: 'e1',
      summary: 'Sync',
      status: 'confirmed',
      start_time: { datetime: '2026-11-25T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-11-25T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    const answer = await routeOf(routes, EVENT_PATH).fetch(new Request(`http://localhost${EVENT_PATH}?eventId=e1`))
    expect(answer.status).toBe(200)
    const body = await answer.json() as { ok: boolean; data: { summary: string; status: string } }
    expect(body.ok).toBe(true)
    expect(body.data.summary).toBe('Sync')
    expect(body.data.status).toBe('confirmed')
  })

  it('rejects a detail read without an event id', async () => {
    const routes = routesOver(() => succeed({}))
    const answer = await routeOf(routes, EVENT_PATH).fetch(new Request(`http://localhost${EVENT_PATH}`))
    expect(answer.status).toBe(400)
  })

  it('updates through the event route and answers the event id', async () => {
    const routes = routesOver(() => succeed({}))
    const answer = await routeOf(routes, EVENT_PATH).fetch(post(EVENT_PATH, timedUpdate()))
    expect(answer.status).toBe(200)
    await expect(answer.json()).resolves.toEqual({ ok: true, data: { eventId: 'e1' } })
  })

  it('updates with the recurring scope and a description', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return succeed({})
    })
    await routeOf(routes, EVENT_PATH).fetch(post(EVENT_PATH, timedUpdate({ applyTo: 'this-and-following', description: 'moved' })))
    expect(calls[0]?.args.slice(-4)).toEqual(['--description', 'moved', '--apply-to', 'this-and-following'])
  })

  it.each(['single', 'all', 'this-and-following'])('deletes with the %s scope', async (scope) => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return succeed({})
    })
    const answer = await routeOf(routes, EVENT_PATH)
      .fetch(post(EVENT_PATH, { action: 'delete', eventId: 'e1', applyTo: scope }))
    expect(answer.status).toBe(200)
    await expect(answer.json()).resolves.toEqual({ ok: true, data: { eventId: 'e1' } })
    expect(calls[0]?.args.slice(-2)).toEqual(['--apply-to', scope])
  })

  it('deletes without a scope for a single event', async () => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return succeed({})
    })
    await routeOf(routes, EVENT_PATH).fetch(post(EVENT_PATH, { action: 'delete', eventId: 'e1' }))
    expect(calls[0]?.args).not.toContain('--apply-to')
  })

  it('rejects an unknown action', async () => {
    const routes = routesOver(() => succeed({}))
    const answer = await routeOf(routes, EVENT_PATH).fetch(post(EVENT_PATH, { action: 'rename', eventId: 'e1' }))
    expect(answer.status).toBe(400)
  })

  it.each([
    [{ action: 'delete' }, 'eventId is required'],
    [{ action: 'delete', eventId: '   ' }, 'eventId is required'],
    [{ action: 'delete', eventId: 7 }, 'eventId is required'],
    [{ action: 'delete', eventId: 'e1', applyTo: 'weekly' }, 'applyTo must be single, all, or this-and-following'],
    [timedUpdate({ summary: '' }), 'summary is required'],
    [timedUpdate({ summary: 7 }), 'summary is required'],
    [timedUpdate({ allDay: 'yes' }), 'allDay must be a boolean'],
    [timedUpdate({ end: 7 }), 'start and end are required strings'],
    [timedUpdate({ timezone: '' }), 'timezone is required'],
    [timedUpdate({ timezone: 7 }), 'timezone is required'],
    [timedUpdate({ description: 7 }), 'description must be a string'],
  ])('rejects the mutation %j before it calls the CLI', async (body) => {
    const calls: CommandRequest[] = []
    const routes = routesOver((request) => {
      calls.push(request)
      return succeed({})
    })
    const answer = await routeOf(routes, EVENT_PATH).fetch(post(EVENT_PATH, body))
    expect(answer.status).toBe(400)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    expect(calls).toHaveLength(0)
  })

  it('answers a CLI failure with its stable status', async () => {
    const routes = routesOver(() => fail({ type: 'api', code: 190014, message: 'gone' }))
    const answer = await routeOf(routes, EVENT_PATH).fetch(new Request(`http://localhost${EVENT_PATH}?eventId=e1`))
    expect(answer.status).toBe(404)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})
