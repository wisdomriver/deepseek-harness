// Calendar service behavior over a recorded command runner: envelope parsing, normalization,
// error mapping, caching, single-flight, and the create payload.

import { describe, expect, it } from 'vitest'
import { jsonObjectIn, type CommandOutcome, type CommandRequest, type CommandRunner } from '../src/cli.ts'
import { CalendarService } from '../src/service.ts'

/** Successful envelope for one command. */
function succeed(data: unknown, extra: Record<string, unknown> = {}): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data, ...extra }), stderr: '' }
}

/** Failure envelope `lark-cli` writes to standard error. */
function fail(error: Record<string, unknown>, exitCode = 1): CommandOutcome {
  return { exitCode, stdout: '', stderr: JSON.stringify({ ok: false, identity: 'user', error }) }
}

/** Build a service over a runner that records every request. */
function serviceOver(answers: (request: CommandRequest) => CommandOutcome) {
  const calls: CommandRequest[] = []
  const run: CommandRunner = async (request) => {
    calls.push(request)
    return answers(request)
  }
  const service = new CalendarService({
    run,
    readTimeoutMs: 15_000,
    writeTimeoutMs: 30_000,
    maxConcurrency: 2,
    queueLimit: 8,
    weekStart: 'monday',
  })
  return { calls, service }
}

describe('jsonObjectIn', () => {
  it('skips progress lines the CLI prints before the envelope', () => {
    expect(jsonObjectIn('[calendar +delete] deleting master event\n{"ok":true,"data":{"a":1}}')).toEqual({ ok: true, data: { a: 1 } })
  })

  it('returns undefined when a stream holds no object', () => {
    expect(jsonObjectIn('lark-cli: command not found')).toBeUndefined()
  })
})

describe('CalendarService.events', () => {
  it('normalizes all-day and timed instances, all-day first', async () => {
    const { service, calls } = serviceOver(() => succeed([
      {
        event_id: 'b_1797300000',
        summary: 'Weekly',
        start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
        end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
        status: 'confirmed',
      },
      {
        event_id: 'a_0',
        summary: 'Trip',
        start_time: { date: '2026-12-09', timezone: 'Asia/Shanghai' },
        end_time: { date: '2026-12-11', timezone: 'Asia/Shanghai' },
        is_exception: true,
        app_link: 'https://example.test/e',
      },
    ]))
    const data = await service.events('2026-12-01', '2027-01-01')
    expect(data.events.map(event => event.eventId)).toEqual(['a_0', 'b_1797300000'])
    expect(data.events[0]).toMatchObject({ allDay: true, start: '2026-12-09', end: '2026-12-11', isException: true })
    expect(data.events[1]).toMatchObject({ allDay: false, start: '2026-12-15T10:00:00+08:00', sourceTimezone: 'Asia/Shanghai' })
    expect(calls[0]?.args).toEqual(['calendar', '+agenda', '--start', '2026-12-01', '--end', '2027-01-01'])
  })

  it('maps a missing scope to permission-denied', async () => {
    const { service } = serviceOver(() => fail({ type: 'api', code: 99991672, message: 'no scope' }))
    await expect(service.events('2026-12-01', '2027-01-01')).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects an inverted range before starting a process', async () => {
    const { service, calls } = serviceOver(() => succeed([]))
    await expect(service.events('2026-12-10', '2026-12-01')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it('serves a repeated read from cache', async () => {
    const { service, calls } = serviceOver(() => succeed([]))
    await service.events('2026-12-01', '2027-01-01')
    await service.events('2026-12-01', '2027-01-01')
    expect(calls).toHaveLength(1)
  })

  it('shares one process between concurrent reads of one key', async () => {
    const { service, calls } = serviceOver(() => succeed([]))
    await Promise.all([service.events('2026-12-01', '2027-01-01'), service.events('2026-12-01', '2027-01-01')])
    expect(calls).toHaveLength(1)
  })
})

describe('CalendarService.status', () => {
  it('reports the scope the token lacks and the configured week start', async () => {
    const { service } = serviceOver(() => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        appId: 'cli_x',
        identities: { user: { status: 'ready', available: true, userName: 'Ada', scope: 'calendar:calendar.event:read' } },
      }),
    }))
    await expect(service.status()).resolves.toEqual({
      cli: true,
      configured: true,
      connected: true,
      userName: 'Ada',
      missingScopes: ['calendar:calendar:read'],
      weekStart: 'monday',
    })
  })

  it('reports an unconfigured CLI as not-configured', async () => {
    const { service } = serviceOver(() => fail({ type: 'config', subtype: 'not_configured' }, 3))
    await expect(service.status()).rejects.toMatchObject({ code: 'not-configured' })
  })
})

describe('CalendarService.event', () => {
  it('reads an instance, then its master for the recurrence rule', async () => {
    const { service, calls } = serviceOver(({ args }) => {
      const id = args[args.length - 1]
      if (id === 'master_0') {
        return succeed({
          event_id: 'master_0',
          summary: 'Weekly',
          recurrence: 'FREQ=WEEKLY;COUNT=3',
          start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
          end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
        })
      }
      return succeed({
        event_id: 'master_1797300000',
        summary: 'Weekly',
        recurring_event_id: 'master_0',
        start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
        end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
        event_organizer: { display_name: 'Ada' },
      })
    })
    await expect(service.event('master_1797300000')).resolves.toMatchObject({
      eventId: 'master_1797300000',
      organizer: 'Ada',
      recurrence: 'FREQ=WEEKLY;COUNT=3',
    })
    expect(calls.map(call => call.args)).toEqual([
      ['calendar', '+get', '--event-id', 'master_1797300000'],
      ['calendar', '+get', '--event-id', 'master_0'],
    ])
  })
})

describe('CalendarService.create', () => {
  it('creates an all-day event with an inclusive end date and no meeting or reminders', async () => {
    const { service, calls } = serviceOver(() => succeed({ event: { event_id: 'new_0' } }))
    await expect(service.create({
      summary: 'Trip',
      allDay: true,
      start: '2026-12-09',
      end: '2026-12-11',
      timezone: 'Asia/Shanghai',
      description: 'note',
    })).resolves.toEqual({ eventId: 'new_0' })
    const call = calls[0]
    expect(call?.args.slice(0, 7)).toEqual(['calendar', 'events', 'create', '--calendar-id', 'primary', '--data', '-'])
    expect(call?.args).toContain('--idempotency-key')
    expect(call?.stdin).toBeDefined()
    const body = JSON.parse(call?.stdin ?? '{}')
    expect(body).toEqual({
      summary: 'Trip',
      description: 'note',
      start_time: { date: '2026-12-09', timezone: 'Asia/Shanghai' },
      end_time: { date: '2026-12-11', timezone: 'Asia/Shanghai' },
    })
  })

  it('sends a timed event as epoch seconds with the browser timezone', async () => {
    const { service, calls } = serviceOver(() => succeed({ event: { event_id: 'new_1' } }))
    await service.create({
      summary: 'Standup',
      allDay: false,
      start: '2026-12-15T10:00:00+08:00',
      end: '2026-12-15T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    })
    const body = JSON.parse(calls[0]?.stdin ?? '{}')
    expect(body.start_time).toEqual({ timestamp: '1797300000', timezone: 'Asia/Shanghai' })
    expect(body.end_time).toEqual({ timestamp: '1797301800', timezone: 'Asia/Shanghai' })
    expect(body).not.toHaveProperty('vchat')
    expect(body).not.toHaveProperty('reminders')
    expect(body).not.toHaveProperty('location')
  })

  it('reports unknown-outcome when the answer carries no event id', async () => {
    const { service } = serviceOver(() => succeed({}))
    await expect(service.create({
      summary: 'Trip',
      allDay: true,
      start: '2026-12-09',
      end: '2026-12-09',
      timezone: 'Asia/Shanghai',
    })).rejects.toMatchObject({ code: 'unknown-outcome' })
  })
})
