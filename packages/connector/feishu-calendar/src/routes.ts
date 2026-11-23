/**
 * Exact Fetch routes the panel calls, registered inside Connection's authentication fence.
 * @module @deepseek-ai/dsh-feishu-calendar/routes
 */

import { randomUUID } from 'node:crypto'
import { CalendarError, CALENDAR_HTTP_STATUS, calendarCodeOf } from './errors.ts'
import { EVENT_PATH, EVENTS_PATH, STATUS_PATH } from './paths.ts'
import type { CalendarResponse, CreateEventInput, DeleteEventInput, RecurrenceScope, UpdateEventInput } from './types.ts'
import type { CalendarService } from './service.ts'

/** Methods Connection admits on an exact route. */
type RouteMethod = 'GET' | 'HEAD' | 'POST'

/** One route in the structural form `ctx.connection.fetch.register` accepts. */
export interface CalendarRoute {
  /** Absolute path below `/api`, matched exactly. */
  readonly path: string
  /** Methods this route owns. */
  readonly methods: readonly RouteMethod[]
  /** How the bridge presents the request body. */
  readonly requestBody: 'buffered' | 'streaming'
  /** Handler; only owner principals reach it. */
  readonly fetch: (request: Request) => Promise<Response>
}

/** What the route handlers need. */
export interface CalendarRouteDeps {
  /** Calendar reads and writes. */
  readonly service: CalendarService
  /** Host-side diagnostic sink; it must never receive event content. */
  readonly log?: (message: string) => void
}

/**
 * Build the three calendar routes.
 * @param deps - service and diagnostic sink.
 * @returns routes in registration order.
 */
export function calendarRoutes(deps: CalendarRouteDeps): readonly CalendarRoute[] {
  return [
    {
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => answer(deps, request, () => deps.service.status()),
    },
    {
      path: EVENTS_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? answer(deps, request, async () => deps.service.create(await readCreateBody(request)))
        : answer(deps, request, () => {
          const query = new URL(request.url).searchParams
          const start = query.get('start') ?? ''
          const end = query.get('end') ?? ''
          return deps.service.events(start, end)
        })),
    },
    {
      path: EVENT_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? answer(deps, request, async () => {
          const mutation = await readMutationBody(request)
          return mutation.action === 'delete'
            ? deps.service.deleteEvent(mutation.input)
            : deps.service.updateEvent(mutation.input)
        })
        : answer(deps, request, () => deps.service.event(new URL(request.url).searchParams.get('eventId') ?? ''))),
    },
  ]
}

/**
 * Run one handler and shape its answer.
 * @param deps - service and diagnostic sink.
 * @param request - authenticated request.
 * @param handle - the operation, which returns `data` or a `{ status }` wrapper.
 * @returns a JSON response with the documented status.
 */
async function answer(
  deps: CalendarRouteDeps,
  request: Request,
  handle: () => Promise<unknown>,
): Promise<Response> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  try {
    return json({ ok: true, data: await handle() }, 200)
  } catch (error: unknown) {
    const code = calendarCodeOf(error)
    deps.log?.(`feishu-calendar: ${request.method} ${new URL(request.url).pathname} failed with ${code} after ${Date.now() - startedAt} ms (requestId ${requestId})`)
    return json({
      ok: false,
      error: { code, message: messageFor(code), requestId },
    }, CALENDAR_HTTP_STATUS[code])
  }
}

/**
 * Read the create request body.
 * @param request - authenticated request carrying JSON.
 * @returns the validated input.
 * @throws CalendarError with `invalid-input` for a malformed body.
 */
async function readCreateBody(request: Request): Promise<CreateEventInput> {
  const raw: unknown = await request.json().catch(() => {
    throw new CalendarError('invalid-input', 'request body must be JSON')
  })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CalendarError('invalid-input', 'request body must be a JSON object')
  }
  const body = raw as Record<string, unknown>
  const summary = body.summary
  const allDay = body.allDay
  const start = body.start
  const end = body.end
  const timezone = body.timezone
  const description = body.description
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new CalendarError('invalid-input', 'summary is required')
  }
  if (typeof allDay !== 'boolean') throw new CalendarError('invalid-input', 'allDay must be a boolean')
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new CalendarError('invalid-input', 'start and end are required strings')
  }
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new CalendarError('invalid-input', 'timezone is required')
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new CalendarError('invalid-input', 'description must be a string')
  }
  return {
    summary,
    allDay,
    start,
    end,
    timezone,
    ...(typeof description === 'string' ? { description } : {}),
  }
}

/**
 * Answer with one JSON body.
 * @param body - envelope to serialize.
 * @param status - HTTP status.
 * @returns the response with no-store caching.
 */
function json<T>(body: CalendarResponse<T>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Browser-facing copy for one code; the Client localizes it again by code.
 * @param code - stable failure code.
 * @returns English text for logs and non-localized clients.
 */
function messageFor(code: ReturnType<typeof calendarCodeOf>): string {
  return `feishu-calendar: ${code}`
}

/** One event mutation the panel posts. */
type EventMutation =
  | { readonly action: 'update'; readonly input: UpdateEventInput }
  | { readonly action: 'delete'; readonly input: DeleteEventInput }

/**
 * Read one event mutation body.
 * @param request - authenticated request carrying JSON.
 * @returns the mutation to run.
 * @throws CalendarError with `invalid-input` for a malformed body.
 */
async function readMutationBody(request: Request): Promise<EventMutation> {
  const raw: unknown = await request.json().catch(() => {
    throw new CalendarError('invalid-input', 'request body must be JSON')
  })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CalendarError('invalid-input', 'request body must be a JSON object')
  }
  const body = raw as Record<string, unknown>
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  if (eventId === '') throw new CalendarError('invalid-input', 'eventId is required')
  const applyTo = scopeOf(body.applyTo)
  if (body.action === 'delete') {
    return { action: 'delete', input: { eventId, ...(applyTo === undefined ? {} : { applyTo }) } }
  }
  if (body.action !== 'update') throw new CalendarError('invalid-input', 'action must be update or delete')
  if (typeof body.summary !== 'string' || body.summary.trim() === '') {
    throw new CalendarError('invalid-input', 'summary is required')
  }
  if (typeof body.allDay !== 'boolean') throw new CalendarError('invalid-input', 'allDay must be a boolean')
  if (typeof body.start !== 'string' || typeof body.end !== 'string') {
    throw new CalendarError('invalid-input', 'start and end are required strings')
  }
  if (typeof body.timezone !== 'string' || body.timezone.trim() === '') {
    throw new CalendarError('invalid-input', 'timezone is required')
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    throw new CalendarError('invalid-input', 'description must be a string')
  }
  return {
    action: 'update',
    input: {
      eventId,
      summary: body.summary,
      allDay: body.allDay,
      start: body.start,
      end: body.end,
      timezone: body.timezone,
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(applyTo === undefined ? {} : { applyTo }),
    },
  }
}

/**
 * Validate one recurring scope from the wire.
 * @param value - scope the browser sent.
 * @returns the scope, or undefined when absent.
 * @throws CalendarError with `invalid-input` for an unknown scope.
 */
function scopeOf(value: unknown): RecurrenceScope | undefined {
  if (value === undefined) return undefined
  if (value === 'single' || value === 'all' || value === 'this-and-following') return value
  throw new CalendarError('invalid-input', 'applyTo must be single, all, or this-and-following')
}
