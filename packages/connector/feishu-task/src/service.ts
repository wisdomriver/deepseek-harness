/**
 * Task reads and writes over the shared Feishu bridge: the three list views, one task's detail,
 * completion and reopening, and creation, with normalization into the panel's own types.
 * @module @deepseek-ai/dsh-feishu-task/service
 */

import { randomUUID } from 'node:crypto'
import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { CacheStore, CliRequest, FeishuBridge } from '@deepseek-ai/dsh-feishu-bridge'
import type {
  CreateTaskData,
  CreateTaskInput,
  TaskDetail,
  TaskListData,
  TaskMutationData,
  TaskStatus,
  TaskSummary,
  TaskView,
} from './types.ts'

/** The program name every diagnostic uses. */
const PROGRAM = 'lark-cli'

/** Scope the panel needs; a token lacking it cannot answer its own reads. */
export const REQUIRED_SCOPES = ['task:task:read'] as const

/** Cache lifetime per read kind. */
export const CACHE_TTL_MS = { list: 60_000, detail: 300_000 } as const

/** Longest title Feishu's create form accepts from this panel. */
const SUMMARY_LIMIT = 200

/** Longest description Feishu's create form accepts from this panel. */
const DESCRIPTION_LIMIT = 5000

/** Completed tasks a single read returns; Feishu lists newest completions first. */
const DONE_LIMIT = 50

/** One local wall-clock time as `lark-cli` writes it, without a zone. */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** Date-only spellings the CLI accepts for an all-day due. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Options one list read accepts. */
export interface TaskListOptions {
  /** Free-text search the CLI forwards as `--query`; empty reads the whole view. */
  readonly query?: string
}

/** Task service dependencies. */
export interface TaskServiceOptions {
  /** The shared bridge: one process gate, one cache, one set of failure codes. */
  readonly bridge: FeishuBridge
}

/** Reads and writes the signed-in user's Feishu tasks. */
export class TaskService {
  /**
   * @param options - the shared bridge.
   */
  constructor(private readonly options: TaskServiceOptions) {}

  /** The shared cache, namespaced with the `task:` prefix. */
  private get cache(): CacheStore {
    return this.options.bridge.cache
  }

  /**
   * Read the account's CLI, application, and sign-in facts.
   * @returns the status the panel needs to choose its state, including the scopes the token lacks.
   * @throws FeishuError when the CLI is missing, unconfigured, or signed out.
   */
  async status(): Promise<TaskStatus> {
    const facts = await this.options.bridge.status()
    const granted = new Set(facts.scopes)
    const missingScopes = REQUIRED_SCOPES.filter(required => !granted.has(required))
    return {
      cli: facts.cli,
      configured: facts.configured,
      connected: facts.connected,
      ...(facts.userName === undefined ? {} : { userName: facts.userName }),
      missingScopes,
    } satisfies TaskStatus
  }

  /**
   * Read one list view.
   * @param view - `pending` for every incomplete task, `assigned` for the signed-in user's own
   * incomplete tasks, `done` for completed ones.
   * @param options - the optional search text.
   * @returns the normalized tasks in Host order and the instant they were read.
   * @throws FeishuError with `permission-denied` when the token lacks the read scope, with
   * `not-connected` for an unreadable assignee filter, or the mapped CLI failure.
   */
  async list(view: TaskView, options: TaskListOptions = {}): Promise<TaskListData> {
    const query = options.query?.trim() ?? ''
    return this.cache.memo(`task:list:${view}:${query}`, CACHE_TTL_MS.list, async () => {
      await this.options.bridge.requireScopes('task', REQUIRED_SCOPES)
      const command = ['task', '+search', `--completed=${view === 'done' ? 'true' : 'false'}`]
      if (view === 'assigned') {
        const facts = await this.options.bridge.status()
        const openId = facts.openId
        if (openId === undefined || openId === '') {
          throw new FeishuError('not-connected', `${PROGRAM}: the signed-in account has no open id for the assignee filter`)
        }
        command.push('--assignee', openId)
      }
      if (query !== '') command.push('--query', query)
      const data = await this.read(command)
      const items = asRecord(data)?.items
      const tasks = (Array.isArray(items) ? items : []).map(item => toTask(requireRecord(item, 'task')))
      const sorted = view === 'done' ? byCompletion(tasks).slice(0, DONE_LIMIT) : byDue(tasks)
      return { tasks: sorted, view, fetchedAt: new Date().toISOString() } satisfies TaskListData
    })
  }

  /**
   * Read one task's detail.
   * @param taskId - Feishu task GUID.
   * @returns the detail the drawer renders.
   * @throws FeishuError with `invalid-input` for a blank id, `not-found` when Feishu returns no
   * task, or the mapped CLI failure.
   */
  async detail(taskId: string): Promise<TaskDetail> {
    const id = trimRequired(taskId, 'taskId')
    return this.cache.memo(`task:${id}`, CACHE_TTL_MS.detail, async () => {
      await this.options.bridge.requireScopes('task', REQUIRED_SCOPES)
      const data = await this.read(['task', 'tasks', 'get', '--task-guid', id])
      const task = asRecord(asRecord(data)?.task)
      if (task === undefined) throw new FeishuError('not-found', `${PROGRAM} returned no task ${id}`)
      return toDetail(task)
    })
  }

  /**
   * Mark one task complete.
   * @param taskId - Feishu task GUID.
   * @returns the task id and the status the CLI reported.
   * @throws FeishuError with `invalid-input` for a blank id, or the mapped CLI failure.
   */
  complete(taskId: string): Promise<TaskMutationData> {
    return this.mutate('complete', taskId)
  }

  /**
   * Reopen one completed task.
   * @param taskId - Feishu task GUID.
   * @returns the task id and the status the CLI reported.
   * @throws FeishuError with `invalid-input` for a blank id, or the mapped CLI failure.
   */
  reopen(taskId: string): Promise<TaskMutationData> {
    return this.mutate('reopen', taskId)
  }

  /**
   * Create one task owned by the signed-in user.
   * @param input - title, optional due, whether that due is date-only, and an optional description.
   * @returns the new task's GUID.
   * @throws FeishuError with `invalid-input` before any process starts, `unknown-outcome` when the
   * CLI accepted the request without returning a task id, or the mapped CLI failure.
   */
  async create(input: CreateTaskInput): Promise<CreateTaskData> {
    const summary = trimRequired(input.summary, 'summary')
    if (summary.length > SUMMARY_LIMIT) {
      throw new FeishuError('invalid-input', `summary must be at most ${SUMMARY_LIMIT} characters`)
    }
    if (input.description !== undefined && input.description.length > DESCRIPTION_LIMIT) {
      throw new FeishuError('invalid-input', `description must be at most ${DESCRIPTION_LIMIT} characters`)
    }
    const command = ['task', '+create', '--summary', summary]
    const due = input.due?.trim() ?? ''
    if (due === '') {
      if (input.allDay === true) throw new FeishuError('invalid-input', 'allDay requires a due date')
    } else if (input.allDay === true) {
      command.push('--due', requireDate(due, 'due'))
    } else {
      command.push('--due', requireInstant(due, 'due'))
    }
    if (input.description !== undefined && input.description !== '') {
      command.push('--description', input.description)
    }
    command.push('--idempotency-key', randomUUID())
    const data = await this.write(command)
    // Measured answer: `data.guid`. Older shortcuts nested the task under `data.task`.
    const record = asRecord(data)
    const taskId = asString(record?.guid)
      ?? asString(asRecord(record?.task)?.guid)
      ?? asString(asRecord(record?.task)?.task_id)
    if (taskId === undefined || taskId === '') {
      throw new FeishuError('unknown-outcome', `${PROGRAM} accepted the create request without a task id`)
    }
    this.invalidate()
    return { taskId }
  }

  /**
   * Run one completion or reopening and normalize its answer.
   * @param action - `complete` or `reopen`.
   * @param taskId - Feishu task GUID.
   * @returns the task id, the reported status, and the completion instant when reported.
   * @throws FeishuError with `invalid-input` for a blank id, or the mapped CLI failure.
   */
  private async mutate(action: 'complete' | 'reopen', taskId: string): Promise<TaskMutationData> {
    const id = trimRequired(taskId, 'taskId')
    const data = await this.write(['task', action === 'complete' ? '+complete' : '+reopen', '--task-id', id])
    const record = asRecord(data)
    const status = asString(record?.status) ?? (action === 'complete' ? 'done' : 'todo')
    const completedAt = parseInstant(record?.completed_at)
    this.invalidate()
    return {
      taskId: asString(record?.guid) ?? id,
      status,
      ...(completedAt === undefined ? {} : { completedAt }),
    } satisfies TaskMutationData
  }

  /**
   * Run one read through the shared bridge.
   * @param command - subcommand and arguments.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge.
   */
  private async read(command: readonly string[]): Promise<unknown> {
    const request: CliRequest = { command, mode: 'read' }
    return (await this.options.bridge.run(request)).data
  }

  /**
   * Run one write through the shared bridge.
   * @param command - subcommand and arguments.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge; writes never retry.
   */
  private async write(command: readonly string[]): Promise<unknown> {
    const request: CliRequest = { command, mode: 'write' }
    return (await this.options.bridge.run(request)).data
  }

  /** Drop every cached task read and detail after a successful write. */
  private invalidate(): void {
    this.cache.invalidate('task:')
  }
}

/**
 * Narrow one value to a non-array object.
 * @param value - value from the CLI envelope.
 * @returns the object, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Require one value to be a non-array object.
 * @param value - value from the CLI envelope.
 * @param subject - what the value should be, for the diagnostic.
 * @returns the object.
 * @throws FeishuError with `upstream` when the value is not an object.
 */
function requireRecord(value: unknown, subject: string): Record<string, unknown> {
  const record = asRecord(value)
  if (record === undefined) throw new FeishuError('upstream', `${PROGRAM} returned no ${subject}`)
  return record
}

/**
 * Read one optional string field.
 * @param value - field value.
 * @returns the string, or undefined for absent and non-string values.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Spread one optional property only when it is present.
 * @param key - property name.
 * @param value - value, if any.
 * @returns an object holding the property at most once.
 */
function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value }
}

/**
 * Convert one CLI time value into an ISO 8601 instant.
 *
 * A list row's times are local wall-clock strings without a zone, so they are read as the
 * machine's local time, which is the same reading Feishu's own client applies. Epoch
 * milliseconds, as task details report them, are absolute.
 * @param value - `YYYY-MM-DD HH:mm:ss`, epoch milliseconds, or an ISO 8601 instant.
 * @returns the instant in UTC ISO 8601 form, or undefined for absent and unparsable values.
 */
function parseInstant(value: unknown): string | undefined {
  if (typeof value === 'number') return instantOf(new Date(value))
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text === '0') return undefined
  const local = LOCAL_DATE_TIME.exec(text)
  if (local !== null) {
    const [, year, month, day, hour, minute, second] = local
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0'),
    )
    return instantOf(date)
  }
  if (/^\d{10,}$/.test(text)) return instantOf(new Date(Number(text)))
  return instantOf(new Date(text))
}

/**
 * Reject an invalid date while keeping a valid one.
 * @param date - the parsed date.
 * @returns the instant, or undefined when the date is invalid.
 */
function instantOf(date: Date): string | undefined {
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Collect the member ids holding one role.
 * @param members - the CLI's `members` array.
 * @param role - `assignee` or `follower`.
 * @returns member ids in the order Feishu reported them.
 */
function memberIds(members: unknown, role: 'assignee' | 'follower'): readonly string[] {
  if (!Array.isArray(members)) return []
  const ids: string[] = []
  for (const member of members) {
    const record = asRecord(member)
    if (record === undefined || record.role !== role) continue
    const id = asString(record.id)
    if (id !== undefined && id !== '') ids.push(id)
  }
  return ids
}

/**
 * Normalize one task from a list row or a detail answer.
 * @param raw - the CLI's task object.
 * @returns the row the panel lists.
 * @throws FeishuError with `upstream` when the task carries no GUID.
 */
function toTask(raw: Record<string, unknown>): TaskSummary {
  const taskId = asString(raw.guid) ?? asString(raw.task_id)
  if (taskId === undefined || taskId === '') {
    throw new FeishuError('upstream', `${PROGRAM} returned a task without a guid`)
  }
  return {
    taskId,
    summary: asString(raw.summary) ?? '',
    status: asString(raw.status) ?? 'todo',
    assignees: memberIds(raw.members, 'assignee'),
    followers: memberIds(raw.members, 'follower'),
    ...optional('completedAt', parseInstant(raw.completed_at)),
    ...optional('dueAt', parseInstant(raw.due_at)),
    ...optional('createdAt', parseInstant(raw.created_at)),
    ...optional('updatedAt', parseInstant(raw.updated_at)),
    ...optional('appLink', asString(raw.url)),
  }
}

/**
 * Normalize one `tasks get` answer, whose due object is the only absolute due source.
 * @param raw - the CLI's `data.task` object.
 * @returns the drawer's detail.
 * @throws FeishuError with `upstream` when the task carries no GUID.
 */
function toDetail(raw: Record<string, unknown>): TaskDetail {
  const base = toTask(raw)
  const due = asRecord(raw.due)
  const dueAt = parseInstant(due?.timestamp) ?? base.dueAt
  const description = asString(raw.description)
  const creator = asString(asRecord(raw.creator)?.id)
  const parentTaskId = asString(raw.parent_task_guid)
  const tasklists = Array.isArray(raw.tasklists)
    ? raw.tasklists.map(item => asString(asRecord(item)?.tasklist_guid)).filter((id): id is string => id !== undefined && id !== '')
    : []
  return {
    ...base,
    tasklists,
    ...optional('dueAt', dueAt),
    ...optional('dueAllDay', typeof due?.is_all_day === 'boolean' ? due.is_all_day : undefined),
    ...optional('description', description === '' ? undefined : description),
    ...optional('creator', creator),
    ...optional('parentTaskId', parentTaskId === '' ? undefined : parentTaskId),
    ...(typeof raw.subtask_count === 'number' ? { subtaskCount: raw.subtask_count } : {}),
  }
}

/**
 * Read one instant as a comparable number.
 * @param instant - ISO 8601 instant, if present.
 * @returns epoch milliseconds, or positive infinity when absent.
 */
function timeOf(instant: string | undefined): number {
  return instant === undefined ? Number.POSITIVE_INFINITY : Date.parse(instant)
}

/**
 * Order pending tasks: earliest due first, undated last, then by most recent update.
 * @param tasks - normalized tasks in CLI order.
 * @returns a new array in display order.
 */
function byDue(tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  return [...tasks].sort((left, right) => {
    const due = timeOf(left.dueAt) - timeOf(right.dueAt)
    if (due !== 0 && !Number.isNaN(due)) return due
    return timeOf(right.updatedAt) - timeOf(left.updatedAt)
  })
}

/**
 * Order completed tasks: most recently completed first, then by most recent update.
 * @param tasks - normalized tasks in CLI order.
 * @returns a new array in display order.
 */
function byCompletion(tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  return [...tasks].sort((left, right) =>
    timeOf(right.completedAt) - timeOf(left.completedAt) || timeOf(right.updatedAt) - timeOf(left.updatedAt))
}

/**
 * Require a non-empty trimmed string.
 * @param value - candidate value.
 * @param field - field name, for the diagnostic.
 * @returns the trimmed value.
 * @throws FeishuError with `invalid-input` when the value is empty.
 */
function trimRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new FeishuError('invalid-input', `${field} must not be empty`)
  return trimmed
}

/**
 * Require one `YYYY-MM-DD` due.
 * @param value - due from the wire.
 * @param field - field name, for the diagnostic.
 * @returns the date.
 * @throws FeishuError with `invalid-input` when the value is not a day.
 */
function requireDate(value: string, field: string): string {
  if (!DATE_ONLY.test(value) || Number.isNaN(Date.parse(value))) {
    throw new FeishuError('invalid-input', `${field} must be YYYY-MM-DD for an all-day due`)
  }
  return value
}

/**
 * Require one ISO 8601 instant due.
 * @param value - due from the wire.
 * @param field - field name, for the diagnostic.
 * @returns the instant.
 * @throws FeishuError with `invalid-input` when the value is not an instant.
 */
function requireInstant(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value)) || !/\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new FeishuError('invalid-input', `${field} must be an ISO 8601 instant`)
  }
  return value
}
