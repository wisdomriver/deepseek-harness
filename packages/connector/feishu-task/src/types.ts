/**
 * Wire types shared by the Feishu task Host routes and the browser panel.
 * @module @deepseek-ai/dsh-feishu-task/types
 */

/** Which task list a view reads. */
export type TaskView = 'pending' | 'assigned' | 'done'

/** One normalized task row the panel lists. */
export interface TaskSummary {
  /** Feishu task GUID, not the display number. */
  readonly taskId: string
  /** Task title as Feishu stores it; empty when the task has none. */
  readonly summary: string
  /** Feishu status, `todo` or `done`. */
  readonly status: string
  /** Completion instant, when the task is complete. */
  readonly completedAt?: string
  /**
   * Due instant. A list row's `due_at` is local wall time without a zone, so the Host reads it
   * as the machine's local time; a detail's `due.timestamp` is already absolute.
   */
  readonly dueAt?: string
  /** Creation instant. */
  readonly createdAt?: string
  /** Last update instant. */
  readonly updatedAt?: string
  /** Member ids whose role is `assignee`. */
  readonly assignees: readonly string[]
  /** Member ids whose role is `follower`. */
  readonly followers: readonly string[]
  /** Link that opens the task in Feishu. */
  readonly appLink?: string
}

/** One task's full detail, read when the drawer opens. */
export interface TaskDetail extends TaskSummary {
  /** True when Feishu stores the due as a date. */
  readonly dueAllDay?: boolean
  /** Plain-text description. */
  readonly description?: string
  /** Creator member id. */
  readonly creator?: string
  /** Parent task GUID, when this task is a subtask. */
  readonly parentTaskId?: string
  /** Number of subtasks Feishu reports. */
  readonly subtaskCount?: number
  /** Tasklist GUIDs the task belongs to; Feishu's detail carries no tasklist names. */
  readonly tasklists: readonly string[]
}

/** List payload; `view` echoes what was read. */
export interface TaskListData {
  /** Normalized tasks in Host order: pending by due, completed by completion. */
  readonly tasks: readonly TaskSummary[]
  /** The view these tasks were read for. */
  readonly view: TaskView
  /** ISO instant the Host read the list. */
  readonly fetchedAt: string
}

/** CLI, account, and authorization facts the panel needs to choose between its states. */
export interface TaskStatus {
  /** True when the `lark-cli` executable resolved. */
  readonly cli: boolean
  /** True when the CLI has an application configured. */
  readonly configured: boolean
  /** True when a user identity is signed in and usable. */
  readonly connected: boolean
  /** Signed-in user's display name. */
  readonly userName?: string
  /** Task scopes the deployment asks for and the token lacks. */
  readonly missingScopes: readonly string[]
}

/** Body the panel posts to create one task. */
export interface CreateTaskInput {
  /** Non-empty title, at most 200 characters. */
  readonly summary: string
  /** `YYYY-MM-DD` for an all-day due; an ISO 8601 instant for a timed due. */
  readonly due?: string
  /** True when `due` is a date; a date-only due without this flag is rejected. */
  readonly allDay?: boolean
  /** Plain-text description, at most 5000 characters. */
  readonly description?: string
}

/** Successful create payload. */
export interface CreateTaskData {
  /** GUID of the task Feishu created. */
  readonly taskId: string
}

/** Successful complete or reopen payload. */
export interface TaskMutationData {
  /** GUID of the task the write addressed. */
  readonly taskId: string
  /** `done` after a completion, `todo` after a reopen. */
  readonly status: string
  /** Completion instant, present once the CLI reports one. */
  readonly completedAt?: string
}

/** Successful payload of every route. */
export interface TaskSuccess<T> {
  /** Discriminant of a successful answer. */
  readonly ok: true
  /** The route's own payload. */
  readonly data: T
}

/** Failure payload of every route; `code` is stable, `message` is for humans. */
export interface TaskFailure {
  /** Discriminant of a failed answer. */
  readonly ok: false
  /** Stable code and the Host diagnostic behind it. */
  readonly error: {
    /** One of the bridge's stable failure codes. */
    readonly code: string
    /** Host-side diagnostic; the panel localizes by `code`. */
    readonly message: string
    /** Identifier the Host logged for this answer. */
    readonly requestId: string
  }
}

/** One route answer. */
export type TaskResponse<T> = TaskSuccess<T> | TaskFailure
