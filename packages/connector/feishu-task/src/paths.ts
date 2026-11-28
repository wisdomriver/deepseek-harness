/**
 * Route paths the panel calls and the Host serves below Connection's `/api` prefix.
 * @module @deepseek-ai/dsh-feishu-task/paths
 */

/** CLI, account, and authorization facts, read on panel open and on every retry. */
export const STATUS_PATH = '/api/feishu-task/status'

/** Task list; `view` and `query` are the only query parameters, and POST creates one task. */
export const TASKS_PATH = '/api/feishu-task/tasks'

/** One task's detail; `taskId` is the only query parameter, and POST completes or reopens it. */
export const TASK_PATH = '/api/feishu-task/task'

/** Browser-relative form of {@link STATUS_PATH}. */
export const STATUS_ROUTE = STATUS_PATH.slice(1)

/** Browser-relative form of {@link TASKS_PATH}. */
export const TASKS_ROUTE = TASKS_PATH.slice(1)

/** Browser-relative form of {@link TASK_PATH}. */
export const TASK_ROUTE = TASK_PATH.slice(1)
