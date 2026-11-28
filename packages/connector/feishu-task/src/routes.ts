/**
 * Exact Fetch routes the tasks panel calls, registered inside Connection's authentication fence.
 * @module @deepseek-ai/dsh-feishu-task/routes
 */

import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { BridgeRoute, FeishuBridge, PanelRoute } from '@deepseek-ai/dsh-feishu-bridge'
import { STATUS_PATH, TASK_PATH, TASKS_PATH } from './paths.ts'
import type { TaskService } from './service.ts'
import type { CreateTaskInput, TaskView } from './types.ts'

/** What the route handlers need. */
export interface TaskRouteDeps {
  /** Task reads and writes. */
  readonly service: TaskService
  /** The shared bridge, which wraps these routes into Connection's form. */
  readonly bridge: FeishuBridge
  /** Host-side diagnostic sink; it must never receive task content. */
  readonly log?: (message: string) => void
}

/**
 * Build the task routes.
 * @param deps - service and diagnostic sink.
 * @returns routes in registration order, ready for `ctx.connection.fetch.register`.
 */
export function taskRoutes(deps: TaskRouteDeps): readonly BridgeRoute[] {
  const routes: readonly PanelRoute[] = [
    {
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => deps.service.status(),
    },
    {
      path: TASKS_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? readCreateBody(request).then(body => deps.service.create(body))
        : Promise.resolve(deps.service.list(
          viewOf(new URL(request.url).searchParams.get('view')),
          { query: new URL(request.url).searchParams.get('query') ?? '' },
        ))),
    },
    {
      path: TASK_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? readMutationBody(request).then(mutation => (mutation.action === 'complete'
          ? deps.service.complete(mutation.taskId)
          : deps.service.reopen(mutation.taskId)))
        : Promise.resolve(deps.service.detail(requireQuery(request, 'taskId')))),
    },
  ]
  return deps.bridge.routes('task', routes, deps.log)
}

/**
 * Validate the requested view.
 * @param value - `view` query parameter, absent for the default view.
 * @returns the view to read.
 * @throws FeishuError with `invalid-input` for an unknown view.
 */
function viewOf(value: string | null): TaskView {
  if (value === null || value === '') return 'pending'
  if (value === 'pending' || value === 'assigned' || value === 'done') return value
  throw new FeishuError('invalid-input', 'view must be pending, assigned, or done')
}

/**
 * Require one query parameter.
 * @param request - authenticated request.
 * @param name - parameter name.
 * @returns the trimmed value.
 * @throws FeishuError with `invalid-input` when the parameter is missing or blank.
 */
function requireQuery(request: Request, name: string): string {
  const value = new URL(request.url).searchParams.get(name)?.trim() ?? ''
  if (value === '') throw new FeishuError('invalid-input', `${name} is required`)
  return value
}

/**
 * Read the create request body.
 * @param request - authenticated request carrying JSON.
 * @returns the validated input.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readCreateBody(request: Request): Promise<CreateTaskInput> {
  const body = await readObject(request)
  const summary = body.summary
  const due = body.due
  const allDay = body.allDay
  const description = body.description
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new FeishuError('invalid-input', 'summary is required')
  }
  if (due !== undefined && typeof due !== 'string') throw new FeishuError('invalid-input', 'due must be a string')
  if (allDay !== undefined && typeof allDay !== 'boolean') {
    throw new FeishuError('invalid-input', 'allDay must be a boolean')
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new FeishuError('invalid-input', 'description must be a string')
  }
  return {
    summary,
    ...(typeof due === 'string' ? { due } : {}),
    ...(typeof allDay === 'boolean' ? { allDay } : {}),
    ...(typeof description === 'string' ? { description } : {}),
  }
}

/** One completion or reopening the panel posts. */
interface TaskMutation {
  /** Which write to run. */
  readonly action: 'complete' | 'reopen'
  /** Task the write addresses. */
  readonly taskId: string
}

/**
 * Read one mutation body.
 * @param request - authenticated request carrying JSON.
 * @returns the mutation to run.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readMutationBody(request: Request): Promise<TaskMutation> {
  const body = await readObject(request)
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
  if (taskId === '') throw new FeishuError('invalid-input', 'taskId is required')
  if (body.action !== 'complete' && body.action !== 'reopen') {
    throw new FeishuError('invalid-input', 'action must be complete or reopen')
  }
  return { action: body.action, taskId }
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
