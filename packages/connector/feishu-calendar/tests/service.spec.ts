// Calendar service behavior over a recorded command runner: normalization, error mapping,
// caching, single-flight, and the three write payloads.

import { describe, expect, it } from 'vitest'
import type { RecurrenceScope } from '../src/types.ts'
import { authStatus, fail, serviceOver, succeed } from './harness.ts'

/** One agenda item covering a timed day. */
function timedItem(eventId: string, start: string, end: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    summary: eventId,
    start_time: { datetime: start, timezone: 'Asia/Shanghai' },
    end_time: { datetime: end, timezone: 'Asia/Shanghai' },
    ...extra,
  }
}

/** One agenda item covering an all-day span. */
function allDayItem(eventId: string, start: string, end: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    summary: eventId,
    start_time: { date: start, timezone: 'Asia/Shanghai' },
    end_time: { date: end, timezone: 'Asia/Shanghai' },
    ...extra,
  }
}

/** Treat a wire string as the closed scope union, the way the panel's own cast does. */
function wireScope(value: string): RecurrenceScope {
  return value as RecurrenceScope
}

describe('CalendarService.events', () => {
  it('normalizes all-day and timed instances, all-day first', async () => {
    const { service, calls } = serviceOver(() => succeed([
      timedItem('b_1797300000', '2026-12-15T10:00:00+08:00', '2026-12-15T11:00:00+08:00', { status: 'confirmed' }),
      allDayItem('a_0', '2026-12-09', '2026-12-11', {
        is_exception: true,
        app_link: 'https://example.test/e',
      }),
    ]))
    const data = await service.events('2026-12-01', '2027-01-01')
    expect(data.events.map(event => event.eventId)).toEqual(['a_0', 'b_1797300000'])
    expect(data.events[0]).toMatchObject({ allDay: true, start: '2026-12-09', end: '2026-12-11', isException: true })
    expect(data.events[1]).toMatchObject({ allDay: false, start: '2026-12-15T10:00:00+08:00', sourceTimezone: 'Asia/Shanghai' })
    expect(calls[0]?.args).toEqual(['calendar', '+agenda', '--start', '2026-12-01', '--end', '2027-01-01'])
  })

  it('falls back to empty defaults for a sparse item and keeps a numeric color', async () => {
    const { service } = serviceOver(() => succeed([
      {
        event_id: 'e1',
        start_time: { datetime: '2026-12-15T10:00:00+08:00' },
        end_time: { datetime: '2026-12-15T11:00:00+08:00' },
        color: 3,
      },
    ]))
    const [event] = (await service.events('2026-12-01', '2027-01-01')).events
    expect(event).toMatchObject({ eventId: 'e1', summary: '', sourceTimezone: '', status: 'confirmed', colorIndex: 3 })
    expect(event).not.toHaveProperty('appLink')
  })

  it('orders the whole agenda by start, with all-day events ahead of a later timed day', async () => {
    const { service } = serviceOver(() => succeed([
      timedItem('t2', '2026-12-16T10:00:00+08:00', '2026-12-16T11:00:00+08:00'),
      allDayItem('a2', '2026-12-20', '2026-12-20'),
      timedItem('t1', '2026-12-10T10:00:00+08:00', '2026-12-10T11:00:00+08:00'),
      allDayItem('a1', '2026-12-01', '2026-12-01'),
    ]))
    const { events } = await service.events('2026-12-01', '2027-01-01')
    expect(events.map(event => event.eventId)).toEqual(['a1', 'a2', 't1', 't2'])
  })

  it('answers an empty month when the CLI returns no list', async () => {
    const { service } = serviceOver(() => succeed({ items: [] }))
    await expect(service.events('2026-12-01', '2027-01-01')).resolves.toMatchObject({ events: [] })
  })

  it('fails with upstream when an agenda item is not an object', async () => {
    const { service } = serviceOver(() => succeed(['junk']))
    await expect(service.events('2026-12-01', '2027-01-01')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('fails with upstream when an item carries no id or bounds', async () => {
    const { service } = serviceOver(() => succeed([{ summary: 'no id' }]))
    await expect(service.events('2026-12-01', '2027-01-01'))
      .rejects.toThrowError(/returned an event without id or time bounds/)
  })

  it('fails with upstream when an item carries only one timed bound', async () => {
    const { service } = serviceOver(() => succeed([{
      event_id: 'e1',
      start_time: { datetime: '2026-12-15T10:00:00+08:00' },
    }]))
    await expect(service.events('2026-12-01', '2027-01-01')).rejects.toMatchObject({ code: 'upstream' })
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

  it.each([
    ['2026-13-45', '2027-01-01'],
    ['December 1, 2026', '2027-01-01'],
    ['2026-12-01', 'tomorrow'],
  ])('rejects the range %s – %s before starting a process', async (start, end) => {
    const { service, calls } = serviceOver(() => succeed([]))
    await expect(service.events(start, end)).rejects.toMatchObject({ code: 'invalid-input' })
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
    const { service } = serviceOver(() => authStatus('calendar:calendar.event:read'))
    await expect(service.status()).resolves.toEqual({
      cli: true,
      configured: true,
      connected: true,
      userName: 'Ada',
      missingScopes: ['calendar:calendar:read'],
      weekStart: 'monday',
    })
  })

  it('reports the configured Sunday week start without a name the CLI omitted', async () => {
    const { service } = serviceOver(() => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        appId: 'cli_x',
        identities: { user: { status: 'ready', available: true, scope: 'calendar:calendar.event:read calendar:calendar:read' } },
      }),
    }), { weekStart: 'sunday' })
    const status = await service.status()
    expect(status).toMatchObject({ missingScopes: [], weekStart: 'sunday', connected: true })
    expect(status).not.toHaveProperty('userName')
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

  it('keeps the whole detail fields the drawer renders', async () => {
    const { service } = serviceOver(() => succeed({
      event_id: 'e1',
      summary: 'Sync',
      description: 'Agenda',
      self_rsvp_status: 'accept',
      status: 'tentative',
      start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    await expect(service.event('e1')).resolves.toMatchObject({
      eventId: 'e1', description: 'Agenda', selfRsvpStatus: 'accept', status: 'tentative',
    })
  })

  it('does not read a master for an empty or identical recurring id', async () => {
    const { service, calls } = serviceOver(({ args }) => succeed({
      event_id: args[args.length - 1],
      summary: 'Weekly',
      recurring_event_id: args[args.length - 1] === 'e1' ? 'e1' : '',
      start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    await expect(service.event('e1')).resolves.toMatchObject({ eventId: 'e1' })
    await expect(service.event('e2')).resolves.toMatchObject({ eventId: 'e2' })
    expect(calls).toHaveLength(2)
  })

  it('omits the rule when the master answers none', async () => {
    const { service } = serviceOver(({ args }) => succeed({
      event_id: args[args.length - 1],
      summary: 'Weekly',
      ...(args[args.length - 1] === 'e1' ? { recurring_event_id: 'master_0' } : {}),
      start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    const detail = await service.event('e1')
    expect(detail).not.toHaveProperty('recurrence')
    expect(detail.recurringEventId).toBe('master_0')
  })

  it('rejects a blank id and an answer without an event object', async () => {
    const blank = serviceOver(() => succeed({}))
    await expect(blank.service.event('  ')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(blank.calls).toHaveLength(0)
    const empty = serviceOver(() => succeed([]))
    await expect(empty.service.event('e1')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('caches the detail for its window', async () => {
    const { service, calls } = serviceOver(() => succeed({
      event_id: 'e1',
      summary: 'Sync',
      start_time: { datetime: '2026-12-15T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      end_time: { datetime: '2026-12-15T11:00:00+08:00', timezone: 'Asia/Shanghai' },
    }))
    await service.event('e1')
    await service.event('e1')
    expect(calls).toHaveLength(1)
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
    expect(body).not.toHaveProperty('description')
  })

  it('drops an empty description instead of clearing the field', async () => {
    const { service, calls } = serviceOver(() => succeed({ event: { event_id: 'new_1' } }))
    await service.create({
      summary: 'Standup',
      allDay: false,
      start: '2026-12-15T10:00:00+08:00',
      end: '2026-12-15T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
      description: '',
    })
    expect(JSON.parse(calls[0]?.stdin ?? '{}')).not.toHaveProperty('description')
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

  it('reports unknown-outcome for a blank event id', async () => {
    const { service } = serviceOver(() => succeed({ event: { event_id: '' } }))
    await expect(service.create({
      summary: 'Trip',
      allDay: true,
      start: '2026-12-09',
      end: '2026-12-09',
      timezone: 'Asia/Shanghai',
    })).rejects.toMatchObject({ code: 'unknown-outcome' })
  })

  it.each([
    [{ summary: '  ', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai' }, 'summary must not be empty'],
    [{ summary: 'a'.repeat(101), allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai' }, 'summary must be at most 100 characters'],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: 'Asia/Shanghai', description: 'd'.repeat(5001) }, 'description must be at most 5000 characters'],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: '2026-12-09', timezone: '  ' }, 'timezone must not be empty'],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09T10:00', end: '2026-12-09', timezone: 'Asia/Shanghai' }, 'start must be YYYY-MM-DD for an all-day event'],
    [{ summary: 'Trip', allDay: true, start: '2026-12-09', end: 'later', timezone: 'Asia/Shanghai' }, 'end must be YYYY-MM-DD for an all-day event'],
    [{ summary: 'Trip', allDay: false, start: 'later', end: '2026-12-09T11:00:00+08:00', timezone: 'Asia/Shanghai' }, 'start must be an ISO 8601 instant'],
    [{ summary: 'Trip', allDay: false, start: '2026-12-09T10:00:00+08:00', end: 'later', timezone: 'Asia/Shanghai' }, 'end must be an ISO 8601 instant'],
  ])('refuses %j before starting a process', async (input, message) => {
    const { service, calls } = serviceOver(() => succeed({ event: { event_id: 'new_0' } }))
    await expect(service.create(input)).rejects.toThrowError(message)
    expect(calls).toHaveLength(0)
  })
})

describe('CalendarService.updateEvent', () => {
  it('patches an all-day event with dates, keeping it all-day', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await expect(service.updateEvent({
      eventId: 'e1', summary: 'Trip v2', allDay: true,
      start: '2026-12-19', end: '2026-12-20', timezone: 'Asia/Shanghai', description: 'note',
    })).resolves.toEqual({ eventId: 'e1' })
    expect(calls[0]?.args.slice(0, 7)).toEqual(['calendar', 'events', 'patch', '--calendar-id', 'primary', '--event-id', 'e1'])
    const body = JSON.parse(calls[0]?.stdin ?? '{}')
    expect(body).toEqual({
      summary: 'Trip v2',
      description: 'note',
      start_time: { date: '2026-12-19', timezone: 'Asia/Shanghai' },
      end_time: { date: '2026-12-20', timezone: 'Asia/Shanghai' },
    })
  })

  it('patches an all-day series without a description and with the whole-series scope', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await service.updateEvent({
      eventId: 'e1', summary: 'Trip', allDay: true,
      start: '2026-12-19', end: '2026-12-20', timezone: 'Asia/Shanghai', applyTo: 'all',
    })
    expect(JSON.parse(calls[0]?.stdin ?? '{}')).not.toHaveProperty('description')
  })

  it('updates a timed event through the shortcut with the series scope', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await service.updateEvent({
      eventId: 'e1', summary: 'Standup', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai', applyTo: 'single',
    })
    expect(calls[0]?.args).toContain('+update')
    expect(calls[0]?.args).toContain('--apply-to')
    expect(calls[0]?.args[calls[0].args.length - 1]).toBe('single')
  })

  it('updates a timed event without a scope or description', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await service.updateEvent({
      eventId: 'e1', summary: 'Standup', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    })
    expect(calls[0]?.args).not.toContain('--apply-to')
    expect(calls[0]?.args).not.toContain('--description')
  })

  it('updates a timed event description', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await service.updateEvent({
      eventId: 'e1', summary: 'Standup', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai', description: 'moved',
    })
    expect(calls[0]?.args.slice(-2)).toEqual(['--description', 'moved'])
  })

  it('refuses a partial all-day series edit before running anything', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await expect(service.updateEvent({
      eventId: 'e1', summary: 'Trip', allDay: true,
      start: '2026-12-19', end: '2026-12-19', timezone: 'Asia/Shanghai', applyTo: 'single',
    })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    [{ eventId: '  ' }, 'eventId must not be empty'],
    [{ summary: '  ' }, 'summary must not be empty'],
    [{ summary: 'a'.repeat(101) }, 'summary must be at most 100 characters'],
    [{ description: 'd'.repeat(5001) }, 'description must be at most 5000 characters'],
    [{ timezone: ' ' }, 'timezone must not be empty'],
    [{ applyTo: wireScope('weekly') }, 'applyTo must be single, all, or this-and-following'],
    [{ allDay: true, start: '2026-12-19T10:00', end: '2026-12-20' }, 'start must be YYYY-MM-DD for an all-day event'],
    [{ allDay: true, start: '2026-12-19', end: 'soon' }, 'end must be YYYY-MM-DD for an all-day event'],
    [{ allDay: true, start: '2026-12-20', end: '2026-12-19' }, 'end must not be earlier than start'],
    [{ allDay: false, start: 'later', end: '2026-12-19T10:00:00+08:00' }, 'start must be an ISO 8601 instant'],
    [{ allDay: false, start: '2026-12-19T10:00:00+08:00', end: 'soon' }, 'end must be an ISO 8601 instant'],
    [{ allDay: false, start: '2026-12-19T10:00:00+08:00', end: '2026-12-19T10:00:00+08:00' }, 'end must be later than start'],
  ])('refuses %j before starting a process', async (overrides, message) => {
    const { service, calls } = serviceOver(() => succeed({}))
    const input = {
      eventId: 'e1',
      summary: 'Trip',
      allDay: true,
      start: '2026-12-19',
      end: '2026-12-20',
      timezone: 'Asia/Shanghai',
      ...overrides,
    }
    await expect(service.updateEvent(input)).rejects.toThrowError(message)
    expect(calls).toHaveLength(0)
  })
})

describe('CalendarService.deleteEvent', () => {
  it('deletes with the confirmed flag and no scope for a single event', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await expect(service.deleteEvent({ eventId: 'e1' })).resolves.toEqual({ eventId: 'e1' })
    expect(calls[0]?.args).toEqual(['calendar', '+delete', '--event-id', 'e1', '--yes'])
  })

  it('passes the recurring scope through', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await service.deleteEvent({ eventId: 'e1', applyTo: 'all' })
    expect(calls[0]?.args.slice(-2)).toEqual(['--apply-to', 'all'])
  })

  it('refuses a blank id or an unknown scope before running anything', async () => {
    const blankId = serviceOver(() => succeed({}))
    await expect(blankId.service.deleteEvent({ eventId: ' ' })).rejects.toThrowError('eventId must not be empty')
    expect(blankId.calls).toHaveLength(0)
    const badScope = serviceOver(() => succeed({}))
    await expect(badScope.service.deleteEvent({ eventId: 'e1', applyTo: wireScope('weekly') }))
      .rejects.toThrowError('applyTo must be single, all, or this-and-following')
    expect(badScope.calls).toHaveLength(0)
  })

  it('drops every cached read after a successful write', async () => {
    const { service, bridge, calls } = serviceOver(request =>
      request.args[1] === '+agenda' ? succeed([]) : succeed({}))
    await service.events('2026-12-01', '2027-01-01')
    expect(bridge.cache.get('calendar:events:2026-12-01:2027-01-01')).toBeDefined()
    await service.deleteEvent({ eventId: 'e1' })
    expect(bridge.cache.get('calendar:events:2026-12-01:2027-01-01')).toBeUndefined()
    expect(calls).toHaveLength(2)
  })
})
