// Panel controller behavior over recorded route answers: month read, detail read, create, edit,
// delete, and the cancellation paths between them.

import { afterEach, describe, expect, it, vi } from 'vitest'
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

const MONTH = { events: [EVENT], fetchedAt: 'now' }

/** Answer one route call. */
type Handler = (call: { readonly route: string; readonly init: RequestInit | undefined }) => Response | Promise<Response>

/** One route's handlers. */
interface Handlers {
  readonly status?: Handler
  readonly events?: Handler
  readonly event?: Handler
  readonly mutate?: Handler
}

/** Wrap one payload in the route envelope. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

/** One failure envelope. */
function failure(code: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message: code, requestId: 'r' } }), { status: 500 })
}

/** A response one test completes by hand. */
function deferred(): { readonly promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** A gate every gated handler waits behind, so each call builds its own answer. */
function gateOf(): { readonly opened: Promise<void>; open: () => void } {
  let open: () => void = () => {}
  const opened = new Promise<void>((resolve) => { open = resolve })
  return { opened, open }
}

/** Build a fetcher answering each route, recording every call. */
function routes(handlers: Handlers = {}) {
  const calls: { route: string; init?: RequestInit | undefined }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const route = String(input)
    calls.push({ route, init })
    const path = route.split('?')[0]
    const handler = init?.method === 'POST'
      ? (handlers.mutate ?? (() => ok({ eventId: 'new_0' })))
      : path === STATUS_ROUTE
        ? (handlers.status ?? (() => ok(STATUS)))
        : path === EVENT_ROUTE
          ? (handlers.event ?? (() => ok(DETAIL)))
          : (handlers.events ?? (() => ok(MONTH)))
    return handler({ route, init })
  }
  return { calls, fetcher }
}

/** Wait for one snapshot predicate. */
async function settled(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => { expect(predicate()).toBe(true) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CalendarController month read', () => {
  it('reads status and the month grid, then reports ready', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    expect(controller.store.getSnapshot().events).toHaveLength(1)
    expect(controller.store.getSnapshot().userName).toBe('Ada')
    expect(calls[0]?.route).toBe(STATUS_ROUTE)
    expect(calls[1]?.route.startsWith(`${EVENTS_ROUTE}?start=`)).toBe(true)
  })

  it('reads through the ambient fetch when none is injected', async () => {
    const ambient = vi.fn(async () => ok(STATUS))
    vi.stubGlobal('fetch', ambient)
    const controller = new CalendarController()
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    expect(ambient).toHaveBeenCalled()
  })

  it('keeps the previous name when the account answer carries none', async () => {
    const { fetcher } = routes({ status: () => ok({ ...STATUS, userName: undefined }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    expect(controller.store.getSnapshot().userName).toBeUndefined()
    expect(controller.store.getSnapshot().weekStart).toBe('monday')
  })

  it('reports the panel unavailable when the account is not signed in', async () => {
    const { fetcher } = routes({ status: () => ok({ ...STATUS, connected: false }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'unavailable')
    expect(controller.store.getSnapshot().errorCode).toBe('not-connected')
  })

  it('reports a missing permission as its own unavailable code', async () => {
    const { fetcher } = routes({ status: () => ok({ ...STATUS, connected: false, missingScopes: ['calendar:calendar:read'] }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'unavailable')
    expect(controller.store.getSnapshot().errorCode).toBe('permission-denied')
  })

  it('reports a failed read with the stable code', async () => {
    const { fetcher } = routes({ status: () => failure('cli-missing') })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'error')
    expect(controller.store.getSnapshot().errorCode).toBe('cli-missing')
  })

  it('reports an unclassified failure as upstream', async () => {
    const controller = new CalendarController(async () => { throw new TypeError('offline') })
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'error')
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })

  it('drops a month read the panel cancelled by showing another month', async () => {
    const gate = gateOf()
    const { calls, fetcher } = routes({ status: async () => { await gate.opened; return ok(STATUS) } })
    const controller = new CalendarController(fetcher)
    controller.load()
    controller.load()
    gate.open()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    // Only the surviving read reaches the events route.
    expect(calls.filter(call => call.route.startsWith(EVENTS_ROUTE))).toHaveLength(1)
  })

  it('drops a month read the panel cancelled after the account answer', async () => {
    const gate = gateOf()
    let eventsAsked = 0
    const { fetcher } = routes({
      events: async () => {
        eventsAsked += 1
        await gate.opened
        return ok(MONTH)
      },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(eventsAsked).toBe(1) })
    controller.load()
    gate.open()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    expect(controller.store.getSnapshot().events).toEqual([EVENT])
  })

  it('drops a cancelled failure instead of reporting an error', async () => {
    const gate = gateOf()
    let asked = 0
    const { fetcher } = routes({
      status: async () => {
        asked += 1
        await gate.opened
        throw new Error('offline')
      },
    })
    const controller = new CalendarController(fetcher)
    controller.load()
    controller.dispose()
    gate.open()
    // One macrotask drains the whole rejection chain, so any report would have landed by now.
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(asked).toBe(1)
    expect(controller.store.getSnapshot().phase).toBe('loading')
    expect(controller.store.getSnapshot().errorCode).toBeUndefined()
  })

  it('moves between months and back to today', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    const shown = controller.store.getSnapshot().month
    controller.actions.previousMonth()
    expect(controller.store.getSnapshot().month < shown).toBe(true)
    controller.actions.nextMonth()
    expect(controller.store.getSnapshot().month).toBe(shown)
    controller.actions.previousMonth()
    controller.actions.goToToday()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    expect(controller.store.getSnapshot().month).toBe(shown)
    expect(calls.length).toBeGreaterThan(3)
  })

  it('re-reads the shown month on refresh', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.refresh()
    await vi.waitFor(() => { expect(calls.length).toBe(4) })
    expect(controller.store.getSnapshot().phase).toBe('ready')
  })

  it('cancels reads in flight when the panel is disposed', async () => {
    const status = deferred()
    const { fetcher } = routes({ status: () => status.promise })
    const controller = new CalendarController(fetcher)
    controller.load()
    controller.dispose()
    status.resolve(ok(STATUS))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('loading') })
    expect(controller.store.getSnapshot().phase).toBe('loading')
  })
})

describe('CalendarController detail', () => {
  it('fills the drawer with the event detail', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    expect(controller.store.getSnapshot().selection?.detail?.organizer).toBe('Ada')
    expect(calls.at(-1)?.route).toBe(`${EVENT_ROUTE}?eventId=e1`)
  })

  it('carries the link the month list already knew', async () => {
    const { fetcher } = routes({ events: () => ok({ events: [{ ...EVENT, appLink: 'https://example.test/e1' }], fetchedAt: 'now' }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openEvent('e1')
    expect(controller.store.getSnapshot().selection?.appLink).toBe('https://example.test/e1')
  })

  it('opens an event the month list does not hold', async () => {
    const { fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('unknown')
    expect(controller.store.getSnapshot().selection).toEqual({ eventId: 'unknown', phase: 'loading' })
  })

  it('reports a failed detail read and retries it', async () => {
    let attempts = 0
    const { fetcher } = routes({
      event: () => {
        attempts += 1
        return attempts === 1 ? failure('not-found') : ok(DETAIL)
      },
    })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'error')
    expect(controller.store.getSnapshot().selection?.errorCode).toBe('not-found')
    controller.actions.retryDetail()
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    expect(controller.store.getSnapshot().selection?.detail?.eventId).toBe('e1')
  })

  it('ignores a retry with no drawer open', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.actions.retryDetail()
    expect(calls).toHaveLength(0)
  })

  it('closes the drawer and drops the selection', async () => {
    const { fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    controller.actions.closeEvent()
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('drops a detail read cancelled by closing the drawer', async () => {
    const event = deferred()
    const { fetcher } = routes({ event: () => event.promise })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.closeEvent()
    event.resolve(ok(DETAIL))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection).toBeUndefined() })
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('drops a cancelled detail failure', async () => {
    const event = deferred()
    const { fetcher } = routes({ event: () => event.promise })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.openEvent('e2')
    event.resolve(failure('timeout'))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.eventId).toBe('e2') })
    expect(controller.store.getSnapshot().selection?.phase).toBe('loading')
  })

  it('reports a malformed route answer as upstream', async () => {
    const controller = new CalendarController(async () => new Response(JSON.stringify({ data: 1 }), { status: 200 }))
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'error')
    expect(controller.store.getSnapshot().selection?.errorCode).toBe('upstream')
  })
})

describe('CalendarController create', () => {
  it('posts the form and re-reads the month after success', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'new_0' }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openCreate('2026-11-26')
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    expect(controller.store.getSnapshot().composer?.prefillDate).toBe('2026-11-26')
    controller.actions.submitCreate({
      summary: 'Trip',
      allDay: true,
      start: '2026-11-26',
      end: '2026-11-27',
      timezone: 'Asia/Shanghai',
      description: 'note',
    })
    await settled(() => controller.store.getSnapshot().composer === undefined)
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(posted?.route).toBe(EVENTS_ROUTE)
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({ summary: 'Trip', allDay: true, timezone: 'Asia/Shanghai' })
    expect(controller.store.getSnapshot().highlightEventId).toBe('new_0')
    expect(calls.filter(call => call.route.startsWith(`${EVENTS_ROUTE}?start=`))).toHaveLength(2)
  })

  it('keeps the dialog open and reports the failure code', async () => {
    const { fetcher } = routes({ mutate: () => failure('invalid-input') })
    const controller = new CalendarController(fetcher)
    controller.actions.openCreate()
    controller.actions.submitCreate({
      summary: 'Trip',
      allDay: true,
      start: '2026-11-26',
      end: '2026-11-26',
      timezone: 'Asia/Shanghai',
    })
    await settled(() => controller.store.getSnapshot().composer?.errorCode === 'invalid-input')
    expect(controller.store.getSnapshot().composer?.open).toBe(true)
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })

  it('ignores a submit with no dialog open', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.actions.submitCreate({
      summary: 'Trip',
      allDay: true,
      start: '2026-11-26',
      end: '2026-11-26',
      timezone: 'Asia/Shanghai',
    })
    expect(calls).toHaveLength(0)
    expect(controller.store.getSnapshot().composer).toBeUndefined()
  })

  it('ignores a second submit while the first is running', async () => {
    const posted = deferred()
    const { calls, fetcher } = routes({ mutate: () => posted.promise })
    const controller = new CalendarController(fetcher)
    controller.actions.openCreate()
    controller.actions.submitCreate({
      summary: 'Trip', allDay: true, start: '2026-11-26', end: '2026-11-26', timezone: 'Asia/Shanghai',
    })
    controller.actions.submitCreate({
      summary: 'Trip', allDay: true, start: '2026-11-26', end: '2026-11-26', timezone: 'Asia/Shanghai',
    })
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(1)
    posted.resolve(ok({ eventId: 'new_0' }))
    await settled(() => controller.store.getSnapshot().composer === undefined)
  })
})

describe('CalendarController edit and delete', () => {
  it('updates the edited event through the mutation route', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'e1' }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    controller.actions.openEdit(DETAIL)
    expect(controller.store.getSnapshot().composer?.mode).toBe('edit')
    controller.actions.submitCreate({
      summary: 'Sync v2',
      allDay: false,
      start: '2026-11-25T10:00:00+08:00',
      end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    })
    await settled(() => controller.store.getSnapshot().composer === undefined)
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(posted?.route).toBe(EVENT_ROUTE)
    const body = JSON.parse(String(posted?.init?.body))
    expect(body).toMatchObject({ action: 'update', eventId: 'e1', summary: 'Sync v2' })
    expect(body).not.toHaveProperty('applyTo')
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('sends the whole-series scope for a recurring instance by default', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'e1' }) })
    const controller = new CalendarController(fetcher)
    controller.actions.openEdit({ ...DETAIL, recurringEventId: 'master_0' })
    controller.actions.submitCreate({
      summary: 'Sync v2', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai', description: 'moved',
    })
    await settled(() => controller.store.getSnapshot().composer === undefined)
    const body = JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body))
    expect(body).toMatchObject({ applyTo: 'all', description: 'moved' })
  })

  it('sends the scope the user picked for a recurring instance', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'e1' }) })
    const controller = new CalendarController(fetcher)
    controller.actions.openEdit({ ...DETAIL, recurringEventId: 'master_0' })
    controller.actions.submitCreate({
      summary: 'Sync v2', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    }, 'single')
    await settled(() => controller.store.getSnapshot().composer === undefined)
    expect(JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body))).toMatchObject({ applyTo: 'single' })
  })

  it('keeps the editor open when the update fails', async () => {
    const { fetcher } = routes({ mutate: () => failure('conflict') })
    const controller = new CalendarController(fetcher)
    controller.actions.openEdit(DETAIL)
    controller.actions.submitCreate({
      summary: 'Sync v2', allDay: false,
      start: '2026-11-25T10:00:00+08:00', end: '2026-11-25T10:30:00+08:00',
      timezone: 'Asia/Shanghai',
    })
    await settled(() => controller.store.getSnapshot().composer?.errorCode === 'conflict')
    expect(controller.store.getSnapshot().composer?.mode).toBe('edit')
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })

  it('closes the create dialog without writing', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.actions.openCreate()
    controller.actions.closeCreate()
    expect(controller.store.getSnapshot().composer).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('deletes the open event and closes the drawer', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'e1' }) })
    const controller = new CalendarController(fetcher)
    controller.load()
    await settled(() => controller.store.getSnapshot().phase === 'ready')
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    controller.actions.deleteEvent()
    await settled(() => controller.store.getSnapshot().selection === undefined)
    const posted = calls.find(call => call.init?.method === 'POST')
    expect(JSON.parse(String(posted?.init?.body))).toEqual({ action: 'delete', eventId: 'e1' })
  })

  it('deletes a recurring instance with the whole-series scope by default', async () => {
    const { calls, fetcher } = routes({
      event: () => ok({ ...DETAIL, recurringEventId: 'master_0' }),
      mutate: () => ok({ eventId: 'e1' }),
    })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    await settled(() => controller.store.getSnapshot().selection?.phase === 'ready')
    controller.actions.deleteEvent()
    await settled(() => controller.store.getSnapshot().selection === undefined)
    expect(JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body))).toMatchObject({ applyTo: 'all' })
  })

  it('deletes with the scope the user picked', async () => {
    const { calls, fetcher } = routes({ mutate: () => ok({ eventId: 'e1' }) })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.deleteEvent('this-and-following')
    await settled(() => controller.store.getSnapshot().selection === undefined)
    expect(JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body)))
      .toMatchObject({ applyTo: 'this-and-following' })
  })

  it('shows the delete confirmation while the request runs', async () => {
    const posted = deferred()
    const { fetcher } = routes({ mutate: () => posted.promise })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.deleteEvent()
    expect(controller.store.getSnapshot().deleting).toEqual({ eventId: 'e1', pending: true })
    posted.resolve(ok({ eventId: 'e1' }))
    await settled(() => controller.store.getSnapshot().deleting === undefined)
  })

  it('keeps the drawer open and reports a failed delete', async () => {
    const { fetcher } = routes({ mutate: () => failure('conflict') })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.deleteEvent('single')
    await settled(() => controller.store.getSnapshot().deleting?.pending === false)
    expect(controller.store.getSnapshot().deleting).toEqual({ eventId: 'e1', pending: false, errorCode: 'conflict', applyTo: 'single' })
    expect(controller.store.getSnapshot().selection?.eventId).toBe('e1')
  })

  it('reports a failed delete of a single event without a scope', async () => {
    const { fetcher } = routes({ mutate: () => failure('not-found') })
    const controller = new CalendarController(fetcher)
    controller.actions.openEvent('e1')
    controller.actions.deleteEvent()
    await settled(() => controller.store.getSnapshot().deleting?.errorCode === 'not-found')
    expect(controller.store.getSnapshot().deleting).toEqual({ eventId: 'e1', pending: false, errorCode: 'not-found' })
  })

  it('ignores a delete with no drawer open', async () => {
    const { calls, fetcher } = routes()
    const controller = new CalendarController(fetcher)
    controller.actions.deleteEvent()
    expect(calls).toHaveLength(0)
    expect(controller.store.getSnapshot().deleting).toBeUndefined()
  })
})
