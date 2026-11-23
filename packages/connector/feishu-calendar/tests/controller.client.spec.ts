// Panel controller behavior over recorded route answers: month read, detail read, and create submit.

import { describe, expect, it, vi } from 'vitest'
import { CalendarController } from '../src/client/controller.ts'
import { EVENT_ROUTE, EVENTS_ROUTE, STATUS_ROUTE } from '../src/paths.ts'
import type { CalendarEvent, CalendarEventDetail } from '../src/types.ts'

const STATUS = {
  cli: true,
  configured: true,
  connected: true,
  userName: 'Ada',
  missingScopes: [],
  weekStart: 'monday',
}

const EVENT: CalendarEvent = {
  eventId: 'e1',
  summary: 'Sync',
  allDay: false,
  start: '2026-11-25T10:00:00+08:00',
  end: '2026-11-25T11:00:00+08:00',
  sourceTimezone: 'Asia/Shanghai',
  status: 'confirmed',
  isException: false,
}

const DETAIL: CalendarEventDetail = { ...EVENT, organizer: 'Ada', recurrence: 'FREQ=WEEKLY;COUNT=3' }

/** Build a fetcher answering each route, recording every call. */
function routes(answers: {
  readonly status?: unknown
  readonly events?: unknown
  readonly event?: unknown
  readonly create?: unknown
}) {
  const calls: { route: string; init?: RequestInit | undefined }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const route = String(input)
    calls.push({ route, init })
    const path = route.split('?')[0]
    const value = path === STATUS_ROUTE ? answers.status
      : path === EVENT_ROUTE ? answers.event
        : answers.events
    if (init?.method === 'POST' && answers.create !== undefined) {
      const created = answers.create as { ok: boolean; data?: unknown; error?: unknown }
      return new Response(JSON.stringify(created), { status: created.ok ? 200 : 500 })
    }
    if (value === undefined) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'not-found', message: 'missing', requestId: 'r' } }), { status: 404 })
    }
    return new Response(JSON.stringify({ ok: true, data: value }), { status: 200 })
  }
  return { calls, fetcher }
}

describe('CalendarController month read', () => {
  it('reads status and the month grid, then reports ready', async () => {
    const { calls, fetcher } = routes({ status: STATUS, events: { events: [EVENT], fetchedAt: 'now' } })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    expect(controller.store.getSnapshot().events).toHaveLength(1)
    expect(controller.store.getSnapshot().userName).toBe('Ada')
    expect(calls[0]?.route).toBe(STATUS_ROUTE)
    expect(calls[1]?.route.startsWith(`${EVENTS_ROUTE}?start=`)).toBe(true)
  })

  it('reports the panel unavailable when the account is not signed in', async () => {
    const { fetcher } = routes({ status: { ...STATUS, connected: false } })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('unavailable') })
    expect(controller.store.getSnapshot().errorCode).toBe('not-connected')
  })
})

describe('CalendarController detail', () => {
  it('fills the drawer with the event detail', async () => {
    const { calls, fetcher } = routes({ status: STATUS, events: { events: [EVENT], fetchedAt: 'now' }, event: DETAIL })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openEvent('e1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    expect(controller.store.getSnapshot().selection?.detail?.organizer).toBe('Ada')
    expect(calls.at(-1)?.route).toBe(`${EVENT_ROUTE}?eventId=e1`)
  })

  it('closes the drawer and drops the selection', async () => {
    const { fetcher } = routes({ status: STATUS, events: { events: [EVENT], fetchedAt: 'now' }, event: DETAIL })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openEvent('e1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.closeEvent()
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })
})

describe('CalendarController create', () => {
  it('posts the form and re-reads the month after success', async () => {
    const { calls, fetcher } = routes({
      status: STATUS,
      events: { events: [EVENT], fetchedAt: 'now' },
      create: { ok: true, data: { eventId: 'new_0' } },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openCreate('2026-11-26')
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    controller.actions.submitCreate({
      summary: 'Trip',
      allDay: true,
      start: '2026-11-26',
      end: '2026-11-27',
      timezone: 'Asia/Shanghai',
      description: 'note',
    })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer).toBeUndefined() })
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(posted?.route).toBe(EVENTS_ROUTE)
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({ summary: 'Trip', allDay: true, timezone: 'Asia/Shanghai' })
    expect(controller.store.getSnapshot().highlightEventId).toBe('new_0')
    expect(calls.filter(call => call.route.startsWith(`${EVENTS_ROUTE}?start=`))).toHaveLength(2)
  })

  it('keeps the dialog open and reports the failure code', async () => {
    const { fetcher } = routes({
      status: STATUS,
      events: { events: [EVENT], fetchedAt: 'now' },
      create: { ok: false, error: { code: 'invalid-input', message: 'bad', requestId: 'r' } },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openCreate()
    controller.actions.submitCreate({
      summary: 'Trip',
      allDay: true,
      start: '2026-11-26',
      end: '2026-11-26',
      timezone: 'Asia/Shanghai',
    })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer?.errorCode).toBe('invalid-input') })
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })
})
describe('CalendarController edit and delete', () => {
  it('updates the edited event through the mutation route', async () => {
    const { calls, fetcher } = routes({
      status: STATUS,
      events: { events: [EVENT], fetchedAt: 'now' },
      event: DETAIL,
      create: { ok: true, data: { eventId: 'e1' } },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openEvent('e1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.openEdit(DETAIL)
    expect(controller.store.getSnapshot().composer?.mode).toBe('edit')
    controller.actions.submitCreate({
      summary: 'Sync v2',
      allDay: false,
      start: '2026-11-25T10:00:00+08:00',
      end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer).toBeUndefined() })
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(posted?.route).toBe(EVENT_ROUTE)
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({ action: 'update', eventId: 'e1', summary: 'Sync v2' })
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('deletes the open event and closes the drawer', async () => {
    const { calls, fetcher } = routes({
      status: STATUS,
      events: { events: [EVENT], fetchedAt: 'now' },
      event: DETAIL,
      create: { ok: true, data: { eventId: 'e1' } },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.openEvent('e1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.deleteEvent()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection).toBeUndefined() })
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({ action: 'delete', eventId: 'e1' })
  })
})
