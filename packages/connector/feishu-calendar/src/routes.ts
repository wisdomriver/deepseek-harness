/**
 * Exact Fetch routes the calendar panel calls, registered inside Connection's authentication fence.
 * @module @deepseek-ai/dsh-feishu-calendar/routes
 */

import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { BridgeRoute, FeishuBridge, PanelRoute } from '@deepseek-ai/dsh-feishu-bridge'
import { EVENT_PATH, EVENTS_PATH, STATUS_PATH } from './paths.ts'
import type { CalendarService } from './service.ts'
import type { CreateEventInput, DeleteEventInput, RecurrenceScope, UpdateEventInput } from './types.ts'

/** What the route handlers need. */
export interface CalendarRouteDeps {
  /** Calendar reads and writes. */
  readonly service: CalendarService
  /** The shared bridge, which wraps these routes into Connection's form. */
  readonly bridge: FeishuBridge
  /** Host-side diagnostic sink; it must never receive event content. */
  readonly log?: (message: string) => void
}

/**
 * Build the calendar routes.
 * @param deps - service and diagnostic sink.
 * @returns routes in registration order, ready for `ctx.connection.fetch.register`.
 */
export function calendarRoutes(deps: CalendarRouteDeps): readonly BridgeRoute[] {
  const routes: readonly PanelRoute[] = [
    {
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => deps.service.status(),
    },
    {
      path: EVENTS_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? readCreateBody(request).then(body => deps.service.create(body))
        : Promise.resolve(deps.service.events(
          new URL(request.url).searchParams.get('start') ?? '',
          new URL(request.url).searchParams.get('end') ?? '',
        ))),
    },
    {
      path: EVENT_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? readMutationBody(request).then(mutation => (mutation.action === 'delete'
          ? deps.service.deleteEvent(mutation.input)
          : deps.service.updateEvent(mutation.input)))
        : Promise.resolve(deps.service.event(new URL(request.url).searchParams.get('eventId') ?? ''))),
    },
  ]
  return deps.bridge.routes('calendar', routes, deps.log)
}

/**
 * Read the create request body.
 * @param request - authenticated request carrying JSON.
 * @returns the validated input.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readCreateBody(request: Request): Promise<CreateEventInput> {
  const body = await readObject(request)
  const summary = body.summary
  const allDay = body.allDay
  const start = body.start
  const end = body.end
  const timezone = body.timezone
  const description = body.description
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new FeishuError('invalid-input', 'summary is required')
  }
  if (typeof allDay !== 'boolean') throw new FeishuError('invalid-input', 'allDay must be a boolean')
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new FeishuError('invalid-input', 'start and end are required strings')
  }
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new FeishuError('invalid-input', 'timezone is required')
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new FeishuError('invalid-input', 'description must be a string')
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

/** One event mutation the panel posts. */
type EventMutation =
  | { readonly action: 'update'; readonly input: UpdateEventInput }
  | { readonly action: 'delete'; readonly input: DeleteEventInput }

/**
 * Read one event mutation body.
 * @param request - authenticated request carrying JSON.
 * @returns the mutation to run.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readMutationBody(request: Request): Promise<EventMutation> {
  const body = await readObject(request)
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  if (eventId === '') throw new FeishuError('invalid-input', 'eventId is required')
  const applyTo = scopeOf(body.applyTo)
  if (body.action === 'delete') {
    return { action: 'delete', input: { eventId, ...(applyTo === undefined ? {} : { applyTo }) } }
  }
  if (body.action !== 'update') throw new FeishuError('invalid-input', 'action must be update or delete')
  if (typeof body.summary !== 'string' || body.summary.trim() === '') {
    throw new FeishuError('invalid-input', 'summary is required')
  }
  if (typeof body.allDay !== 'boolean') throw new FeishuError('invalid-input', 'allDay must be a boolean')
  if (typeof body.start !== 'string' || typeof body.end !== 'string') {
    throw new FeishuError('invalid-input', 'start and end are required strings')
  }
  if (typeof body.timezone !== 'string' || body.timezone.trim() === '') {
    throw new FeishuError('invalid-input', 'timezone is required')
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    throw new FeishuError('invalid-input', 'description must be a string')
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
 * Read one JSON object body.
 * @param request - authenticated request carrying JSON.
 * @returns the body as a plain record.
 * @throws FeishuError with `invalid-input` when the body is not a JSON object.
 */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json().catch(() => {
    throw new FeishuError('invalid-input', 'request body must be JSON')
  })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FeishuError('invalid-input', 'request body must be a JSON object')
  }
  return raw as Record<string, unknown>
}

/**
 * Validate one recurring scope from the wire.
 * @param value - scope the browser sent.
 * @returns the scope, or undefined when absent.
 * @throws FeishuError with `invalid-input` for an unknown scope.
 */
function scopeOf(value: unknown): RecurrenceScope | undefined {
  if (value === undefined) return undefined
  if (value === 'single' || value === 'all' || value === 'this-and-following') return value
  throw new FeishuError('invalid-input', 'applyTo must be single, all, or this-and-following')
}
