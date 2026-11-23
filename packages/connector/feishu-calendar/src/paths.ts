/**
 * Route paths the panel calls and the Host serves below Connection's `/api` prefix.
 * @module @deepseek-ai/dsh-feishu-calendar/paths
 */

/** CLI, account, and authorization facts, read on panel open and every 30 seconds while visible. */
export const STATUS_PATH = '/api/feishu-calendar/status'

/** Month event list; `start` and `end` query parameters bound the range. */
export const EVENTS_PATH = '/api/feishu-calendar/events'

/** One event's detail; `eventId` is the only query parameter. */
export const EVENT_PATH = '/api/feishu-calendar/event'

/** Browser-relative form of {@link STATUS_PATH}. */
export const STATUS_ROUTE = STATUS_PATH.slice(1)

/** Browser-relative form of {@link EVENTS_PATH}. */
export const EVENTS_ROUTE = EVENTS_PATH.slice(1)

/** Browser-relative form of {@link EVENT_PATH}. */
export const EVENT_ROUTE = EVENT_PATH.slice(1)
