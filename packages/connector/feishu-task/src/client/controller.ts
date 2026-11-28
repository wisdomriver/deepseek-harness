/** Panel data plumbing: list reads, task detail, completion, creation, and the snapshot store. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { STATUS_ROUTE, TASKS_ROUTE, TASK_ROUTE } from '../paths.ts'
import type {
  CreateTaskData,
  CreateTaskInput,
  TaskDetail,
  TaskListData,
  TaskMutationData,
  TaskResponse,
  TaskStatus,
  TaskSummary,
  TaskView,
} from '../types.ts'
import { groupTasks, type TaskGroup } from './groups.ts'

/** How long typing waits before the panel reads the matching list. */
export const SEARCH_DEBOUNCE_MS = 300

/** Panel phase; an empty ready list is the same phase as a filled one. */
export type TaskPhase = 'loading' | 'ready' | 'no-cli' | 'disconnected' | 'permission' | 'error'

/** One row's optimistic completion state, applied until the next read replaces it. */
export interface TaskMark {
  /** Task the mark belongs to. */
  readonly taskId: string
  /** Status the row shows while the write runs. */
  readonly status: 'done' | 'todo'
  /** True while the write is in flight; the circle is disabled meanwhile. */
  readonly pending: boolean
}

/** One open task detail. */
export interface TaskSelection {
  /** Task the drawer addresses. */
  readonly taskId: string
  /** Loading, ready, or failed. */
  readonly phase: 'loading' | 'ready' | 'error'
  /** Detail once loaded. */
  readonly detail?: TaskDetail
  /** Stable failure code when the read failed. */
  readonly errorCode?: string
  /** Feishu link known from the list, used when the detail answer omits it. */
  readonly appLink?: string
}

/** The create dialog. */
export interface TaskComposer {
  /** Whether the dialog shows. */
  readonly open: boolean
  /** True while the create request runs. */
  readonly pending: boolean
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
}

/** Snapshot the panel renders; the store replaces it wholesale on each transition. */
export interface TaskViewState {
  /** Loading, ready, or one of the four states that cannot show a list. */
  readonly phase: TaskPhase
  /** List currently shown. */
  readonly view: TaskView
  /** Search text the list was last read for. */
  readonly query: string
  /** Flattened tasks in the order the Host returned them. */
  readonly tasks: readonly TaskSummary[]
  /** Those tasks grouped by local due date. */
  readonly groups: readonly TaskGroup[]
  /** Scopes the token lacks, when the phase is `permission`. */
  readonly missingScopes: readonly string[]
  /** Signed-in user's display name, when known. */
  readonly userName?: string
  /** Stable failure code from the routes, when the phase is not ready. */
  readonly errorCode?: string
  /** Optimistic completion state by task id. */
  readonly marks: Readonly<Record<string, TaskMark>>
  /** Stable failure code from the last completion or reopening. */
  readonly actionErrorCode?: string
  /** Task the list highlights after a successful create. */
  readonly highlightTaskId?: string
  /** The open detail drawer, if any. */
  readonly selection?: TaskSelection
  /** The open create dialog, if any. */
  readonly composer?: TaskComposer
}

/** Panel interactions components call. */
export interface TaskActions {
  /** Re-read the shown view, bypassing no cache (the Host decides freshness). */
  readonly refresh: () => void
  /** Show another list view. */
  readonly setView: (view: TaskView) => void
  /** Update the search text; the read follows after the debounce. */
  readonly search: (query: string) => void
  /** Open one task's detail. */
  readonly openTask: (taskId: string) => void
  /** Close the detail drawer. */
  readonly closeTask: () => void
  /** Retry the drawer's detail read. */
  readonly retryDetail: () => void
  /** Mark one task complete. */
  readonly complete: (taskId: string) => void
  /** Reopen one completed task. */
  readonly reopen: (taskId: string) => void
  /** Open the create dialog. */
  readonly openCreate: () => void
  /** Close the create dialog. */
  readonly closeCreate: () => void
  /** Submit one task to Feishu. */
  readonly submitCreate: (input: CreateTaskInput) => void
}

/** A route answer that reported a stable failure code. */
export class TaskClientError extends Error {
  /**
   * @param code - stable code the Host sent.
   * @param message - Host diagnostic, kept for logs only.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'TaskClientError'
  }
}

/** Loads the shown view and the open detail, and submits completions and creates. */
export class TaskController {
  /** Snapshot store the renderer binds as `useTask`. */
  readonly store: SnapshotStore<TaskViewState>

  /** Components' actions. */
  readonly actions: TaskActions

  /** Route fetcher; tests replace it. */
  private readonly fetcher: typeof fetch

  /** List read in flight, cancelled when another read starts. */
  private abort: AbortController | undefined

  /** Detail read in flight, cancelled when the drawer closes. */
  private detailAbort: AbortController | undefined

  /** Pending debounced search read. */
  private searchTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param fetcher - same-origin fetch used for the relative routes.
   */
  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetcher = fetcher
    this.store = createSnapshotStore<TaskViewState>({
      phase: 'loading',
      view: 'pending',
      query: '',
      tasks: [],
      groups: [],
      missingScopes: [],
      marks: {},
    })
    this.actions = {
      refresh: () => { this.clearHighlight(); this.load() },
      setView: (view) => {
        this.clearHighlight()
        this.cancelSearch()
        this.store.set({ ...this.current(), view })
        this.load()
      },
      search: (query) => { this.clearHighlight(); this.store.set({ ...this.current(), query }); this.scheduleSearch() },
      openTask: (taskId) => { this.openTask(taskId) },
      closeTask: () => { this.closeTask() },
      retryDetail: () => {
        const selection = this.current().selection
        if (selection !== undefined) this.openTask(selection.taskId)
      },
      complete: (taskId) => { void this.mutate('complete', taskId) },
      reopen: (taskId) => { void this.mutate('reopen', taskId) },
      openCreate: () => { this.store.set({ ...this.current(), composer: { open: true, pending: false } }) },
      closeCreate: () => {
        const { composer: _closed, ...rest } = this.current()
        this.store.set(rest)
      },
      submitCreate: (input) => { void this.submitCreate(input) },
    }
  }

  /** Start reading the shown view. */
  load(): void {
    void this.read()
  }

  /** Cancel reads and the pending search; the panel is going away. */
  dispose(): void {
    this.abort?.abort()
    this.detailAbort?.abort()
    this.cancelSearch()
  }

  /** The current snapshot. */
  private current(): TaskViewState {
    return this.store.getSnapshot()
  }

  /** Drop the create highlight, leaving the rest of the snapshot alone. */
  private clearHighlight(): void {
    const { highlightTaskId: _dropped, ...rest } = this.current()
    this.store.set(rest)
  }

  /** Cancel a debounced search read, if one is pending. */
  private cancelSearch(): void {
    if (this.searchTimer === undefined) return
    clearTimeout(this.searchTimer)
    this.searchTimer = undefined
  }

  /** Schedule the read that follows typing. */
  private scheduleSearch(): void {
    this.cancelSearch()
    this.searchTimer = setTimeout(() => {
      this.searchTimer = undefined
      this.load()
    }, SEARCH_DEBOUNCE_MS)
  }

  /** Read status, then the shown view, into the snapshot. */
  private async read(): Promise<void> {
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    const shown = this.current()
    const { errorCode: _previousError, actionErrorCode: _previousAction, ...rest } = shown
    this.store.set({ ...rest, phase: 'loading' })
    try {
      const status = await this.request<TaskStatus>(STATUS_ROUTE, signal)
      if (signal.aborted) return
      const named: TaskViewState = {
        ...rest,
        phase: 'loading',
        missingScopes: status.missingScopes,
        ...(status.userName === undefined ? {} : { userName: status.userName }),
      }
      if (status.missingScopes.length > 0) {
        this.store.set({ ...named, phase: 'permission', errorCode: 'permission-denied' })
        return
      }
      if (!status.connected) {
        this.store.set({ ...named, phase: 'disconnected', errorCode: 'not-connected' })
        return
      }
      const params = new URLSearchParams({ view: shown.view })
      const query = shown.query.trim()
      if (query !== '') params.set('query', query)
      const data = await this.request<TaskListData>(`${TASKS_ROUTE}?${params.toString()}`, signal)
      if (signal.aborted) return
      this.store.set({ ...named, phase: 'ready', tasks: data.tasks, groups: groupTasks(data.tasks) })
    } catch (error: unknown) {
      if (signal.aborted) return
      const code = codeOf(error)
      this.store.set({ ...rest, phase: phaseOf(code), errorCode: code })
    }
  }

  /**
   * Read one task's detail into the drawer.
   * @param taskId - the task the user opened.
   */
  private openTask(taskId: string): void {
    this.detailAbort?.abort()
    const abort = new AbortController()
    this.detailAbort = abort
    const listed = this.current().tasks.find(task => task.taskId === taskId)?.appLink
    this.store.set({
      ...this.current(),
      selection: { taskId, phase: 'loading', ...(listed === undefined ? {} : { appLink: listed }) },
    })
    void this.readDetail(taskId, abort.signal)
  }

  /**
   * Fill the open drawer with the detail answer.
   * @param taskId - task addressed by the drawer.
   * @param signal - read cancellation.
   */
  private async readDetail(taskId: string, signal: AbortSignal): Promise<void> {
    try {
      const detail = await this.request<TaskDetail>(`${TASK_ROUTE}?taskId=${encodeURIComponent(taskId)}`, signal)
      if (signal.aborted) return
      this.store.set({ ...this.current(), selection: { taskId, phase: 'ready', detail } })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.store.set({ ...this.current(), selection: { taskId, phase: 'error', errorCode: codeOf(error) } })
    }
  }

  /** Close the drawer, cancelling its read. */
  private closeTask(): void {
    this.detailAbort?.abort()
    const { selection: _closed, ...rest } = this.current()
    this.store.set(rest)
  }

  /**
   * Run one completion or reopening, then re-read the list.
   * @param action - `complete` or `reopen`.
   * @param taskId - the task the user acted on.
   */
  private async mutate(action: 'complete' | 'reopen', taskId: string): Promise<void> {
    if (this.current().marks[taskId]?.pending === true) return
    this.setMark({ taskId, status: action === 'complete' ? 'done' : 'todo', pending: true }, taskId)
    try {
      const data = await this.request<TaskMutationData>(TASK_ROUTE, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, taskId }),
      })
      this.setMark(undefined, taskId)
      this.applyMutation(taskId, data)
      this.load()
    } catch (error: unknown) {
      this.setMark(undefined, taskId)
      this.store.set({ ...this.current(), actionErrorCode: codeOf(error) })
    }
  }

  /**
   * Replace the open drawer's status with the write's answer.
   * @param taskId - the task that was written.
   * @param data - the route's answer.
   */
  private applyMutation(taskId: string, data: TaskMutationData): void {
    const selection = this.current().selection
    if (selection === undefined || selection.taskId !== taskId || selection.detail === undefined) return
    const { completedAt: _previous, ...detail } = selection.detail
    this.store.set({
      ...this.current(),
      selection: {
        ...selection,
        detail: {
          ...detail,
          status: data.status,
          ...(data.completedAt === undefined ? {} : { completedAt: data.completedAt }),
        },
      },
    })
  }

  /**
   * Set or clear one row's optimistic mark.
   * @param mark - the mark to show, or undefined to clear it.
   * @param taskId - the task the mark belongs to.
   */
  private setMark(mark: TaskMark | undefined, taskId: string): void {
    const marks: Record<string, TaskMark> = {}
    for (const [id, value] of Object.entries(this.current().marks)) {
      if (id !== taskId) marks[id] = value
    }
    if (mark !== undefined) marks[taskId] = mark
    this.store.set({ ...this.current(), marks })
  }

  /**
   * Create one task and fold the result back into the list.
   * @param input - validated form values.
   */
  private async submitCreate(input: CreateTaskInput): Promise<void> {
    const composer = this.current().composer
    if (composer === undefined || composer.pending) return
    this.store.set({ ...this.current(), composer: { open: true, pending: true } })
    try {
      const data = await this.request<CreateTaskData>(TASKS_ROUTE, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const { composer: _closed, actionErrorCode: _previousAction, ...rest } = this.current()
      this.store.set({ ...rest, highlightTaskId: data.taskId })
      this.load()
    } catch (error: unknown) {
      this.store.set({
        ...this.current(),
        composer: { open: true, pending: false, errorCode: codeOf(error) },
      })
    }
  }

  /**
   * Read one route.
   * @param route - browser-relative route, including its query string.
   * @param signal - read cancellation.
   * @param init - extra fetch options, such as method and body.
   * @returns the successful payload.
   * @throws TaskClientError for a failure envelope or an unreadable answer.
   */
  private async request<T>(route: string, signal: AbortSignal | undefined, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(route, {
      ...init,
      ...(signal === undefined ? {} : { signal }),
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    })
    const body: unknown = await response.json()
    if (!isResponse(body)) throw new TaskClientError('upstream', 'feishu-task route answered malformed JSON')
    if (body.ok === false) throw new TaskClientError(body.error.code, body.error.message)
    return body.data as T
  }
}

/**
 * Read the stable code off a thrown value.
 * @param error - value caught from a route call.
 * @returns the code, or `upstream` for anything unclassified.
 */
function codeOf(error: unknown): string {
  return error instanceof TaskClientError ? error.code : 'upstream'
}

/**
 * Map one stable code onto the phase that explains it.
 * @param code - stable failure code.
 * @returns the phase the panel renders.
 */
function phaseOf(code: string): TaskPhase {
  if (code === 'cli-missing') return 'no-cli'
  if (code === 'not-configured' || code === 'not-connected') return 'disconnected'
  if (code === 'permission-denied') return 'permission'
  return 'error'
}

/**
 * Test one route answer's envelope.
 * @param value - parsed JSON.
 * @returns true when the value carries an `ok` discriminant.
 */
function isResponse(value: unknown): value is TaskResponse<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return ok === true || ok === false
}
